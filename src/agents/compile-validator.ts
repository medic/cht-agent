/**
 * Compile-time validation gate (v6 Move 2 / H.1).
 *
 * Runs `tsc --noEmit` against every tsconfig*.json discovered in cht-core,
 * parses the compiler output into {@link CrossFileIssue}[] entries with
 * `issueType: 'compile-error'`, and dedupes them.
 *
 * Multi-tsconfig discovery is essential because cht-core is a monorepo: the
 * root tsconfig does not `include` the webapp/ or api/ subtrees, so a single
 * `tsc -p tsconfig.json` would miss every error in those subtrees.
 *
 * The gate degrades gracefully:
 *  - Returns `skipped: true` when no tsconfig is found or when `tsc` itself
 *    cannot be located (ENOENT). Production policy is to surface the skip at
 *    HC2 (so the user knows the gate did not run) rather than fail the run.
 *  - The regex parser captures the primary line of each error block; multi-
 *    line continuation lines ("Property X is missing in type ...") are not
 *    captured individually but the head error is enough to trigger the
 *    refinement loop and direct the user.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as path from 'node:path';
import { readdir } from 'node:fs/promises';
import { CrossFileIssue } from '../types';

const execFileAsync = promisify(execFile);

/** ~10 MB. Real cht-core compile output rarely exceeds a few hundred KB. */
const TSC_MAX_BUFFER = 10 * 1024 * 1024;

/** Depth limit for the tsconfig walk. cht-core's deepest tsconfig is 2-3 levels deep. */
const TSCONFIG_DISCOVERY_MAX_DEPTH = 5;

const DISCOVERY_SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.git',
  '.next',
  '.nuxt',
]);

export interface CompileValidationResult {
  passed: boolean;
  issues: CrossFileIssue[];
  skipped?: boolean;
  skipReason?: string;
  /** Relative paths of every tsconfig*.json the validator ran against. */
  tsconfigsRun?: string[];
}

/**
 * Run the compile gate over every tsconfig*.json the cht-core workspace
 * publishes. The result merges errors across tsconfigs and dedupes by
 * (filePath, description) so a file `include`d by two tsconfigs is not
 * reported twice.
 */
export async function compileCheck(chtCorePath: string): Promise<CompileValidationResult> {
  const tsconfigs = await discoverTsconfigs(chtCorePath);
  if (tsconfigs.length === 0) {
    return {
      passed: true,
      issues: [],
      skipped: true,
      skipReason: `No tsconfig*.json files found under ${chtCorePath}`,
    };
  }

  const allIssues: CrossFileIssue[] = [];
  const tsconfigsRun: string[] = [];

  for (const tsconfig of tsconfigs) {
    try {
      await execFileAsync(
        'npx',
        ['--no-install', 'tsc', '--noEmit', '-p', tsconfig],
        { cwd: chtCorePath, maxBuffer: TSC_MAX_BUFFER },
      );
      tsconfigsRun.push(path.relative(chtCorePath, tsconfig));
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string; code?: string };
      // tsc not available at all — degrade gracefully so the user can choose
      // at HC2 whether to accept the diff without a compile check.
      if (e.code === 'ENOENT' || /not found/i.test(e.stderr ?? '')) {
        return {
          passed: true,
          issues: [],
          skipped: true,
          skipReason: 'tsc not available in cht-core workspace (run `npm install` there to enable the compile gate)',
        };
      }
      tsconfigsRun.push(path.relative(chtCorePath, tsconfig));
      allIssues.push(...parseTscOutput(e.stdout ?? '', chtCorePath));
    }
  }

  const deduped = dedupIssues(allIssues);
  return {
    passed: deduped.length === 0,
    issues: deduped,
    tsconfigsRun,
  };
}

/**
 * Walk the workspace looking for tsconfig*.json files. Skips node_modules and
 * other directories that should never contain authoritative project configs.
 */
async function discoverTsconfigs(root: string): Promise<string[]> {
  const found: string[] = [];

  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > TSCONFIG_DISCOVERY_MAX_DEPTH) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!DISCOVERY_SKIP_DIRS.has(entry.name)) {
          await walk(path.join(dir, entry.name), depth + 1);
        }
      } else if (entry.isFile() && /^tsconfig.*\.json$/.test(entry.name)) {
        found.push(path.join(dir, entry.name));
      }
    }
  };

  await walk(root, 0);
  return found;
}

function dedupIssues(issues: CrossFileIssue[]): CrossFileIssue[] {
  const seen = new Set<string>();
  const out: CrossFileIssue[] = [];
  for (const issue of issues) {
    const key = `${issue.filePath}|${issue.description ?? issue.reason ?? ''}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(issue);
    }
  }
  return out;
}

/**
 * Parse tsc --noEmit output. Each error block opens with a line of the form:
 *   path/to/file.ts(LINE,COL): error TSXXXX: <message>
 * followed by zero or more indented continuation lines we do not capture.
 * The `error` literal (not `warning`) means warnings are filtered out
 * automatically.
 */
function parseTscOutput(output: string, chtCorePath: string): CrossFileIssue[] {
  const re = /^(.+?)\((\d+),(\d+)\):\s+error\s+(TS\d+):\s+(.+)$/gm;
  const issues: CrossFileIssue[] = [];
  let m;
  while ((m = re.exec(output)) !== null) {
    const rawPath = m[1];
    const filePath = path.isAbsolute(rawPath) ? path.relative(chtCorePath, rawPath) : rawPath;
    const description = `${m[4]} at line ${m[2]}: ${m[5]}`;
    issues.push({
      filePath,
      issueType: 'compile-error',
      description,
      reason: description,
    });
  }
  return issues;
}
