/**
 * relink-issues.ts — one-off, idempotent repair of id/issueNumber/issueUrl on
 * promoted drafts whose distiller aliased the merge-PR number as the issue number
 * (the bug fixed for future runs in distiller.ts). It reuses the SAME linkage
 * logic as the scraper (issue-linkage.ts) so the relink and the pipeline agree.
 *
 * A draft is AFFECTED only when its issueNumber equals its source_pr PR number
 * (the alias signature). For each affected draft it resolves the true issue via,
 * in order, gh `closingIssuesReferences` (sidebar) + PR title + body, then the
 * filename token `<pr>-<type><issue>-` as a cross-check, and rewrites ONLY the
 * three identity lines. Ambiguous cases (multi-issue, tokenless with no gh,
 * gh/token conflict, suspect mismatches) are flagged, never guessed.
 *
 * Dry-run is the default — pass --apply to write.
 *
 * Usage:
 *   npx ts-node src/scripts/relink-issues.ts --dir agent-memory/domains/data-sync/issues [--apply] [--offline]
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import matter from 'gray-matter';
import { collectLinkedIssueRefs } from './issue-linkage';

/** Exec function type — wraps execFileSync or a test double. */
export type ExecFn = (file: string, args: string[]) => string;

export type RelinkStatus = 'relinked' | 'unchanged' | 'flagged';

export interface RelinkResult {
  file: string;
  status: RelinkStatus;
  from?: number;
  to?: number;
  source?: 'gh' | 'title-body' | 'filename-token';
  reason?: string;
  /** gh was authoritative but the filename token disagreed — surfaced for audit. */
  tokenMismatch?: boolean;
  /** Other files resolving to the same issue (the #135 dedup worklist). */
  collidesWith?: string[];
}

export interface RelinkOptions {
  /** Directory to walk recursively for *.md (default: agent-memory/domains). */
  dir?: string;
  /** Write changes; default is dry-run. */
  apply?: boolean;
  /** Force filename-token-only resolution (no gh). */
  offline?: boolean;
  /** owner/repo used for gh lookups (default: medic/cht-core). */
  repo?: string;
  /** Injected exec for tests. */
  exec?: ExecFn;
}

const SOURCE_PR_RE = /^([^#]+)#(\d+)$/;
const FILENAME_TOKEN_RE =
  /^(\d+)-(?:fix|feat|perf|chore|refactor|docs|ci|build|test|style|revert)?(\d+)-/;

/** Parse `medic/cht-core#42` → { repo, prNumber }. */
function parseSourcePr(ref: unknown): { repo: string; prNumber: number } | null {
  if (typeof ref !== 'string') return null;
  const m = SOURCE_PR_RE.exec(ref);
  if (!m) return null;
  return { repo: m[1], prNumber: Number.parseInt(m[2], 10) };
}

/** Parse `8773-fix6299-slug` → { prNumber: 8773, issueNumber: 6299 }; null when tokenless. */
function parseFilenameToken(filename: string): { prNumber: number; issueNumber: number } | null {
  const m = FILENAME_TOKEN_RE.exec(path.basename(filename));
  if (!m) return null;
  return { prNumber: Number.parseInt(m[1], 10), issueNumber: Number.parseInt(m[2], 10) };
}

/** True once if gh is callable. */
function ghAvailable(exec: ExecFn): boolean {
  try {
    exec('gh', ['--version']);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve the issues a PR closes via gh, using the SAME merge logic as the
 * scraper. Returns the ordered IssueRefs and how many came from the sidebar.
 * Returns null on any gh/parse failure so the caller can fall back.
 */
function resolveViaGh(
  prNumber: number,
  repo: string,
  exec: ExecFn
): { issues: number[]; closingRefCount: number } | null {
  try {
    const raw = exec('gh', [
      'pr', 'view', String(prNumber), '--repo', repo,
      '--json', 'title,body,closingIssuesReferences',
    ]);
    const meta = JSON.parse(raw);
    const rawClosing: Array<{ number: number; url?: string }> = Array.isArray(
      meta.closingIssuesReferences
    )
      ? meta.closingIssuesReferences
      : [];
    const closingRefs = rawClosing.filter(
      r => typeof r.url === 'string' && r.url.includes(`/${repo}/issues/`)
    );
    const refs = collectLinkedIssueRefs(meta.title ?? '', meta.body ?? '', closingRefs);
    return {
      issues: refs.map(r => r.number),
      closingRefCount: refs.filter(r => r.source === 'closing-ref').length,
    };
  } catch {
    return null;
  }
}

/** Outcome of resolving a single affected draft. */
type Resolution =
  | { kind: 'relink'; to: number; source: 'gh' | 'title-body' | 'filename-token'; tokenMismatch?: boolean }
  | { kind: 'flag'; reason: string };

/**
 * Decide the true issue for an affected draft. gh closing-ref is authoritative
 * and overrides the token (mismatch recorded). Genuinely ambiguous cases flag.
 */
function resolveAffected(
  filename: string,
  prNumber: number,
  repo: string,
  online: boolean,
  exec: ExecFn
): Resolution {
  const token = parseFilenameToken(filename);

  if (online) {
    const gh = resolveViaGh(prNumber, repo, exec);
    if (gh) {
      if (gh.closingRefCount > 1) {
        return { kind: 'flag', reason: `multi-issue PR: sidebar closes ${gh.issues.slice(0, gh.closingRefCount).join(', ')} — choose manually` };
      }
      if (gh.issues.length === 0) {
        return { kind: 'flag', reason: 'gh resolves no issue for this PR — verify (may close none)' };
      }
      const authoritative = gh.issues[0];
      if (gh.closingRefCount === 1) {
        // Sidebar link is ground truth; use it even if the token disagrees.
        return { kind: 'relink', to: authoritative, source: 'gh', tokenMismatch: token ? token.issueNumber !== authoritative : undefined };
      }
      // No sidebar; gh fell back to title/body. Require the token to agree.
      if (token && token.issueNumber !== authoritative) {
        return { kind: 'flag', reason: `no sidebar link; gh title/body says ${authoritative} but filename token says ${token.issueNumber} — verify` };
      }
      return { kind: 'relink', to: authoritative, source: 'title-body' };
    }
    // gh failed for this PR — fall through to token (treated as offline).
  }

  if (token) {
    return { kind: 'relink', to: token.issueNumber, source: 'filename-token' };
  }
  return { kind: 'flag', reason: 'tokenless and no gh resolution — manual relink required' };
}

/**
 * Rewrite exactly the three identity lines in the frontmatter block, repo-agnostic
 * (cht-core | cht-interoperability). Throws if any line is missing or not unique,
 * so a malformed draft is flagged rather than silently corrupted. Body untouched.
 */
export function rewriteFrontmatter(content: string, repo: string, newIssue: number): string {
  const block = /^(---\r?\n)([\s\S]*?\r?\n)(---\r?\n?)/.exec(content);
  if (!block) throw new Error('no frontmatter block');
  let fm = block[2];
  const repoName = repo.split('/')[1]; // medic/cht-core -> cht-core
  const edits: Array<[RegExp, string]> = [
    [/^id: cht-(?:core|interoperability)-\d+$/m, `id: ${repoName}-${newIssue}`],
    [/^issueNumber: \d+$/m, `issueNumber: ${newIssue}`],
    [
      /^issueUrl: https:\/\/github\.com\/medic\/(?:cht-core|cht-interoperability)\/issues\/\d+$/m,
      `issueUrl: https://github.com/${repo}/issues/${newIssue}`,
    ],
  ];
  for (const [re, repl] of edits) {
    const all = fm.match(new RegExp(re.source, 'gm'));
    if (!all || all.length !== 1) {
      throw new Error(`expected exactly one ${re.source} line, found ${all?.length ?? 0}`);
    }
    fm = fm.replace(re, repl);
  }
  return block[1] + fm + block[3] + content.slice(block[0].length);
}

/** Recursively collect *.md paths under dir (skips .gitkeep). */
function walkMarkdown(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkMarkdown(full));
    else if (entry.isFile() && entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}

/** Per-file plan built in phase 1 before any write or collision analysis. */
interface FilePlan {
  file: string;
  content: string;
  result: RelinkResult;
  /** Issue number this file will own after relink (for collision detection). */
  finalIssue?: number;
  sourcePrNumber?: number;
}

function planFile(file: string, online: boolean, exec: ExecFn): FilePlan {
  const rel = file;
  const content = fs.readFileSync(file, 'utf8');
  const fm = matter(content).data as Record<string, unknown>;
  const issueNumber = typeof fm.issueNumber === 'number' ? fm.issueNumber : undefined;
  const src = parseSourcePr(fm.source_pr);

  // Old-convention files have no source_pr — not the alias bug, leave untouched.
  if (!src) {
    return { file: rel, content, result: { file: rel, status: 'unchanged' }, finalIssue: issueNumber };
  }

  const token = parseFilenameToken(file);

  // Affected = the alias signature: issueNumber === source_pr PR number.
  if (issueNumber === src.prNumber) {
    const res = resolveAffected(file, src.prNumber, src.repo, online, exec);
    if (res.kind === 'flag') {
      return {
        file: rel, content,
        result: { file: rel, status: 'flagged', from: issueNumber, reason: res.reason },
        finalIssue: issueNumber, sourcePrNumber: src.prNumber,
      };
    }
    return {
      file: rel, content,
      result: { file: rel, status: 'relinked', from: issueNumber, to: res.to, source: res.source, tokenMismatch: res.tokenMismatch },
      finalIssue: res.to, sourcePrNumber: src.prNumber,
    };
  }

  // Not aliased, but the third class: issueNumber disagrees with the filename token.
  if (token && issueNumber !== undefined && issueNumber !== token.issueNumber) {
    return {
      file: rel, content,
      result: {
        file: rel, status: 'flagged', from: issueNumber,
        reason: `suspect: issueNumber ${issueNumber} disagrees with filename token ${token.issueNumber} — verify against gh`,
      },
      finalIssue: issueNumber, sourcePrNumber: src.prNumber,
    };
  }

  return { file: rel, content, result: { file: rel, status: 'unchanged' }, finalIssue: issueNumber, sourcePrNumber: src.prNumber };
}

/** Annotate plans with collision clusters (same final issue across the scanned set). */
function detectCollisions(plans: FilePlan[]): void {
  const byIssue = new Map<number, FilePlan[]>();
  for (const p of plans) {
    if (p.finalIssue === undefined) continue;
    const arr = byIssue.get(p.finalIssue) ?? [];
    arr.push(p);
    byIssue.set(p.finalIssue, arr);
  }
  for (const [, group] of byIssue) {
    if (group.length < 2) continue;
    for (const p of group) {
      p.result.collidesWith = group
        .filter(o => o.file !== p.file)
        .map(o => path.basename(o.file));
    }
  }
}

/**
 * Relink affected drafts in `dir`. Idempotent: a file whose issueNumber already
 * differs from its PR number is left unchanged, so re-runs are no-ops.
 */
export function relinkIssues(opts: RelinkOptions = {}): RelinkResult[] {
  const dir = opts.dir ?? path.join('agent-memory', 'domains');
  const apply = opts.apply ?? false;
  const repo = opts.repo ?? 'medic/cht-core';
  const exec: ExecFn =
    opts.exec ?? ((file, args) => execFileSync(file, args, { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 }) as string);
  const online = !opts.offline && ghAvailable(exec);

  if (!online) {
    console.warn(
      'WARNING: gh unavailable or --offline — running in filename-token-only mode. ' +
        'gh-authoritative resolution and multi-issue detection are DISABLED; treat results as provisional.'
    );
  }

  const plans = walkMarkdown(dir).map(f => planFile(f, online, exec));
  detectCollisions(plans);

  if (apply) {
    for (const p of plans) {
      if (p.result.status !== 'relinked' || p.result.to === undefined) continue;
      const src = parseSourcePr(matter(p.content).data.source_pr);
      const fileRepo = src?.repo ?? repo;
      try {
        fs.writeFileSync(p.file, rewriteFrontmatter(p.content, fileRepo, p.result.to), 'utf8');
      } catch (err) {
        p.result.status = 'flagged';
        p.result.reason = `rewrite failed: ${err instanceof Error ? err.message : String(err)}`;
      }
    }
  }

  return plans.map(p => p.result);
}

/* istanbul ignore next */
function printReport(results: RelinkResult[], apply: boolean): void {
  const relinked = results.filter(r => r.status === 'relinked');
  const flagged = results.filter(r => r.status === 'flagged');
  const collisions = results.filter(r => r.collidesWith && r.collidesWith.length > 0);

  console.log(`\n${apply ? 'APPLIED' : 'DRY-RUN'} — ${relinked.length} relinked, ${flagged.length} flagged, ${results.length - relinked.length - flagged.length} unchanged\n`);
  for (const r of relinked) {
    const note = [r.source, r.tokenMismatch ? 'TOKEN-MISMATCH' : ''].filter(Boolean).join(' ');
    console.log(`  relink  ${r.from} -> ${r.to}  [${note}]  ${path.basename(r.file)}`);
  }
  if (flagged.length) {
    console.log('\nFLAGGED (manual):');
    for (const r of flagged) console.log(`  ${path.basename(r.file)} (issue ${r.from ?? '?'}): ${r.reason}`);
  }
  if (collisions.length) {
    console.log('\nCOLLISIONS (#135 dedup worklist — confirm each is genuine multi-PR-to-one-issue):');
    for (const r of collisions) console.log(`  ${path.basename(r.file)} -> issue ${r.to ?? r.from}  also: ${r.collidesWith!.join(', ')}`);
  }
}

/* istanbul ignore next */
if (require.main === module) {
  const argv = process.argv.slice(2);
  const dirIdx = argv.indexOf('--dir');
  const opts: RelinkOptions = {
    dir: dirIdx >= 0 ? argv[dirIdx + 1] : undefined,
    apply: argv.includes('--apply'),
    offline: argv.includes('--offline'),
  };
  const results = relinkIssues(opts);
  printReport(results, opts.apply ?? false);
  if (opts.apply && results.some(r => r.status === 'flagged')) process.exit(1);
}
