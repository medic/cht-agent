/**
 * open-review-pr.ts — promote pending knowledge drafts to per-domain GitHub review PRs.
 *
 * For each CHT domain that has .md draft files under agent-memory/_pending/<domain>/,
 * this script re-validates each draft against schema.json, then (when --apply is
 * passed) creates a branch from origin/main, commits the valid drafts under
 * agent-memory/domains/<domain>/issues/, pushes, and opens a PR for human review.
 *
 * Dry-run is the default — pass --apply to create real PRs.
 *
 * Usage:
 *   npx ts-node src/scripts/open-review-pr.ts [--apply]
 *   npm run open-review-pr [-- --apply]
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'child_process';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const matter = require('gray-matter') as typeof import('gray-matter');
import type { SkipLogEntry, OpenReviewOptions, ReviewPRResult } from '../types/pipeline';
import { CHT_DOMAINS, DEFAULT_PIPELINE_LOG_PATH, DEFAULT_PIPELINE_OUTPUT_DIR } from '../constants';
import { REPO_ROOT, buildValidator, normalizeFrontmatter, hasFrontmatter } from './schema-utils';

const DEFAULT_DOMAINS_DIR = path.join(REPO_ROOT, 'agent-memory', 'domains');

const validate = buildValidator();

/**
 * Collect .md draft paths (excluding .gitkeep) grouped by domain.
 *
 * @example
 * ```typescript
 * const map = discoverDraftsByDomain('/repo/agent-memory/_pending');
 * // Map { 'contacts' => ['/repo/agent-memory/_pending/contacts/42-foo.md'] }
 * ```
 */
export function discoverDraftsByDomain(pendingDir: string): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const domain of CHT_DOMAINS) {
    const domainDir = path.join(pendingDir, domain);
    let entries: string[];
    try {
      entries = fs.readdirSync(domainDir);
    } catch {
      continue;
    }
    const files = entries
      .filter(f => f.endsWith('.md'))
      .map(f => path.join(domainDir, f));
    if (files.length > 0) result.set(domain, files);
  }
  return result;
}

/**
 * Build a GitHub PR body that lists each draft with its source PR and a review checklist.
 *
 * @example
 * ```typescript
 * const body = buildPRBody('contacts', ['/tmp/pending/contacts/42-foo.md']);
 * // body.includes('## Knowledge drafts: contacts') === true
 * ```
 */
export function buildPRBody(domain: string, draftPaths: string[]): string {
  const lines: string[] = [
    `## Knowledge drafts: ${domain}`,
    '',
    `${draftPaths.length} draft(s) ready for review.`,
    '',
    '### Drafts',
    '',
  ];

  for (const draftPath of draftPaths) {
    const content = fs.readFileSync(draftPath, 'utf8');
    const parsed = matter(content);
    const fm = parsed.data as Record<string, unknown>;
    const title = String(fm.title ?? path.basename(draftPath));
    const sourcePr = fm.source_pr
      ? ` — [${fm.source_pr}](https://github.com/${fm.source_pr})`
      : '';
    lines.push(`- **${title}**${sourcePr}`);
  }

  lines.push(
    '',
    '### Review checklist',
    '',
    '- [ ] Summary accurately describes the change',
    '- [ ] Problem and root cause are technically correct',
    '- [ ] Solution matches the actual PR changes',
    '- [ ] Domain and category are correct',
    '- [ ] Tags and entities are useful for retrieval',
    '- [ ] No sensitive data or internal details included',
  );

  return lines.join('\n');
}

function writeSkipEntry(logPath: string, draftPath: string, reason: string): void {
  const filename = path.basename(draftPath);
  const match = filename.match(/^(\d+)-/);
  const entry: SkipLogEntry = {
    prNumber: match ? parseInt(match[1], 10) : 0,
    decision: 'flag-for-human',
    reason: `open-review-pr: ${reason} — ${filename}`,
    timestamp: new Date().toISOString(),
  };
  fs.appendFileSync(logPath, JSON.stringify(entry) + '\n', 'utf8');
}

const MAX_BRANCH_SUFFIX = 99;

function uniqueBranchName(
  base: string,
  exec: (file: string, args: string[]) => string
): string {
  let branch = base;
  for (let counter = 2; counter <= MAX_BRANCH_SUFFIX; counter++) {
    try {
      exec('git', ['rev-parse', '--verify', branch]);
      branch = `${base}-${counter}`;
    } catch {
      return branch;
    }
  }
  throw new Error(`Could not find a unique branch name for base: ${base}`);
}

/**
 * Promote pending drafts to per-domain review PRs.
 *
 * Validates all drafts first, then (when apply=true) creates one branch + PR
 * per domain. Original pending files are deleted after successful promotion.
 * Never creates PRs in dry-run mode (default).
 *
 * @example
 * ```typescript
 * // Dry-run: preview what would happen
 * const results = openReviewPR();
 *
 * // Actually create PRs
 * const results = openReviewPR({ apply: true });
 * ```
 */
export function openReviewPR(opts: OpenReviewOptions = {}): ReviewPRResult[] {
  const pendingDir = opts.pendingDir ?? DEFAULT_PIPELINE_OUTPUT_DIR;
  const domainsDir = opts.domainsDir ?? DEFAULT_DOMAINS_DIR;
  const logPath = opts.logPath ?? DEFAULT_PIPELINE_LOG_PATH;
  const apply = opts.apply ?? false;
  const date = opts.date ?? new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const exec = opts.execFn ??
    ((file: string, args: string[]) => execFileSync(file, args, { encoding: 'utf8' }) as string);

  const byDomain = discoverDraftsByDomain(pendingDir);
  const results: ReviewPRResult[] = [];
  const plans = new Map<string, string[]>();
  for (const [domain, draftPaths] of byDomain) {
    const validDrafts: string[] = [];
    for (const draftPath of draftPaths) {
      const content = fs.readFileSync(draftPath, 'utf8');
      if (!hasFrontmatter(content)) {
        writeSkipEntry(logPath, draftPath, 'No frontmatter');
        continue;
      }
      let parsed: ReturnType<typeof matter>;
      try {
        parsed = matter(content);
      } catch {
        writeSkipEntry(logPath, draftPath, 'YAML parse error');
        continue;
      }
      const data = normalizeFrontmatter(parsed.data as Record<string, unknown>);
      if (!validate(data)) {
        const errors = (validate.errors ?? []).map(e => e.message ?? 'invalid').join('; ');
        writeSkipEntry(logPath, draftPath, `Schema invalid: ${errors}`);
        continue;
      }
      validDrafts.push(draftPath);
    }
    if (validDrafts.length > 0) {
      plans.set(domain, validDrafts);
    } else {
      results.push({ domain, branch: '', filesPromoted: 0, status: 'skipped' });
    }
  }

  if (!apply) {
    for (const [domain, validDrafts] of plans) {
      results.push({
        domain,
        branch: `memory/review/${domain}-${date}`,
        filesPromoted: validDrafts.length,
        status: 'dry-run',
      });
    }
    return results;
  }

  if (plans.size === 0) return results;

  exec('git', ['fetch', 'origin', 'main']);
  const originalBranch = exec('git', ['rev-parse', '--abbrev-ref', 'HEAD']).trim();

  for (const [domain, validDrafts] of plans) {
    const branchBase = `memory/review/${domain}-${date}`;
    const branch = uniqueBranchName(branchBase, exec);

    try {
      exec('git', ['switch', '-c', branch, 'origin/main']);

      const targetDir = path.join(domainsDir, domain, 'issues');
      fs.mkdirSync(targetDir, { recursive: true });

      const addPaths: string[] = [];
      for (const draftPath of validDrafts) {
        const filename = path.basename(draftPath);
        const targetPath = path.join(targetDir, filename);
        fs.copyFileSync(draftPath, targetPath);
        addPaths.push(path.relative(REPO_ROOT, targetPath));
      }

      exec('git', ['add', ...addPaths]);
      exec('git', ['commit', '-m',
        `feat(memory): promote ${validDrafts.length} ${domain} draft(s) for review`]);
      exec('git', ['push', '-u', 'origin', branch]);

      const prBody = buildPRBody(domain, validDrafts);
      const prUrl = exec('gh', [
        'pr', 'create',
        '--title', `Memory review: ${domain}`,
        '--body', prBody,
        '--head', branch,
        '--base', 'main',
      ]).trim();

      exec('git', ['switch', originalBranch]);

      for (const draftPath of validDrafts) {
        fs.unlinkSync(draftPath);
      }

      results.push({ domain, branch, prUrl, filesPromoted: validDrafts.length, status: 'created' });
    } catch (err) {
      exec('git', ['switch', originalBranch]);
      throw err;
    }
  }

  return results;
}

// CLI entry point
if (require.main === module) {
  const apply = process.argv.includes('--apply');

  if (!apply) {
    console.log('Dry-run — pass --apply to create PRs\n');
  }

  const results = openReviewPR({ apply });

  for (const r of results) {
    if (r.status === 'skipped') continue;
    if (r.status === 'dry-run') {
      console.log(`[dry-run]  ${r.domain}: ${r.filesPromoted} draft(s) → ${r.branch}`);
    } else {
      console.log(`[created]  ${r.domain}: ${r.filesPromoted} draft(s) → ${r.prUrl}`);
    }
  }

  if (results.every(r => r.status === 'skipped')) {
    console.log('No pending drafts found.');
  }
}
