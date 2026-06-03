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
import { execFileSync } from 'node:child_process';
import matter from 'gray-matter';
import type { SkipLogEntry, OpenReviewOptions, ReviewPRResult } from '../types/pipeline';
import { CHT_DOMAINS, DEFAULT_PIPELINE_LOG_PATH, DEFAULT_PIPELINE_OUTPUT_DIR } from '../constants';
import { REPO_ROOT, buildValidator, normalizeFrontmatter, hasFrontmatter } from './schema-utils';

const DEFAULT_DOMAINS_DIR = path.join(REPO_ROOT, 'agent-memory', 'domains');

const validate = buildValidator();

/** Exec function type — wraps execFileSync or a test double. */
type ExecFn = (file: string, args: string[]) => string;

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
    const sourcePrStr = typeof fm.source_pr === 'string' ? fm.source_pr : '';
    const sourcePr = sourcePrStr
      ? ` — [${sourcePrStr}](https://github.com/${sourcePrStr})`
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

/**
 * Writes a skip entry to the audit log for a draft that failed validation.
 *
 * @param logPath   - Path to the NDJSON audit log file.
 * @param draftPath - Absolute path to the draft file being skipped.
 * @param reason    - Human-readable reason for skipping.
 *
 * @example
 * ```typescript
 * writeSkipEntry('/tmp/skipped.ndjson', '/tmp/drafts/42-foo.md', 'No frontmatter');
 * ```
 */
function writeSkipEntry(logPath: string, draftPath: string, reason: string): void {
  const filename = path.basename(draftPath);
  const match = filename.match(/^(\d+)-/);
  const entry: SkipLogEntry = {
    prNumber: match ? Number.parseInt(match[1], 10) : 0,
    decision: 'flag-for-human',
    reason: `open-review-pr: ${reason} — ${filename}`,
    timestamp: new Date().toISOString(),
  };
  fs.appendFileSync(logPath, JSON.stringify(entry) + '\n', 'utf8');
}

const MAX_BRANCH_SUFFIX = 99;

/**
 * Returns a unique branch name by appending a counter suffix if the base already exists.
 *
 * @param base - Base branch name.
 * @param exec - Exec function used to call git.
 * @returns A branch name that does not yet exist in the repository.
 * @throws {Error} When no unique name can be found within MAX_BRANCH_SUFFIX attempts.
 *
 * @example
 * ```typescript
 * const branch = uniqueBranchName('memory/review/contacts-20240101', execFn);
 * ```
 */
function uniqueBranchName(
  base: string,
  exec: ExecFn
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
 * Attempts to parse a draft file, returning null (and writing a skip entry) on failure.
 *
 * @param draftPath - Absolute path to the draft .md file.
 * @param logPath   - Path to the NDJSON audit log file.
 * @returns Parsed matter result, or null if parsing fails.
 *
 * @example
 * ```typescript
 * const parsed = parseDraft('/tmp/drafts/42-foo.md', '/tmp/skipped.ndjson');
 * // null if no frontmatter or YAML parse error
 * ```
 */
function parseDraft(draftPath: string, logPath: string): ReturnType<typeof matter> | null {
  const content = fs.readFileSync(draftPath, 'utf8');
  if (!hasFrontmatter(content)) {
    writeSkipEntry(logPath, draftPath, 'No frontmatter');
    return null;
  }
  try {
    return matter(content);
  } catch {
    writeSkipEntry(logPath, draftPath, 'YAML parse error');
    return null;
  }
}

/**
 * Filters a list of draft paths to those that pass schema validation.
 *
 * @param draftPaths - Array of absolute draft file paths to validate.
 * @param logPath    - Path to the NDJSON audit log file.
 * @returns Array of draft paths that passed schema validation.
 *
 * @example
 * ```typescript
 * const valid = findValidDrafts(['/tmp/drafts/42-foo.md'], '/tmp/skipped.ndjson');
 * ```
 */
function findValidDrafts(draftPaths: string[], logPath: string): string[] {
  const valid: string[] = [];
  for (const draftPath of draftPaths) {
    const parsed = parseDraft(draftPath, logPath);
    if (parsed === null) continue;
    const data = normalizeFrontmatter(parsed.data as Record<string, unknown>);
    if (!validate(data)) {
      const errors = (validate.errors ?? []).map(e => e.message ?? 'invalid').join('; ');
      writeSkipEntry(logPath, draftPath, `Schema invalid: ${errors}`);
      continue;
    }
    valid.push(draftPath);
  }
  return valid;
}

/**
 * Collects valid draft plans per domain and separates skipped domains.
 *
 * @param byDomain - Map of domain to its discovered draft paths.
 * @param logPath  - Path to the NDJSON audit log file.
 * @returns Object with `plans` (valid domains) and `skipped` (ReviewPRResult for empty domains).
 *
 * @example
 * ```typescript
 * const { plans, skipped } = collectValidPlans(byDomain, '/tmp/skipped.ndjson');
 * ```
 */
function collectValidPlans(
  byDomain: Map<string, string[]>,
  logPath: string
): { plans: Map<string, string[]>; skipped: ReviewPRResult[] } {
  const plans = new Map<string, string[]>();
  const skipped: ReviewPRResult[] = [];
  for (const [domain, draftPaths] of byDomain) {
    const validDrafts = findValidDrafts(draftPaths, logPath);
    if (validDrafts.length > 0) {
      plans.set(domain, validDrafts);
    } else {
      skipped.push({ domain, branch: '', filesPromoted: 0, status: 'skipped' });
    }
  }
  return { plans, skipped };
}

/**
 * Builds dry-run ReviewPRResult entries for each planned domain.
 *
 * @param plans - Map of domain to valid draft paths.
 * @param date  - Date string in YYYYMMDD format for branch naming.
 * @returns Array of dry-run ReviewPRResult objects.
 *
 * @example
 * ```typescript
 * const results = buildDryRunResults(plans, '20240101');
 * // [{ domain: 'contacts', branch: 'memory/review/contacts-20240101', status: 'dry-run', ... }]
 * ```
 */
function buildDryRunResults(plans: Map<string, string[]>, date: string): ReviewPRResult[] {
  return Array.from(plans.entries()).map(([domain, validDrafts]) => ({
    domain,
    branch: `memory/review/${domain}-${date}`,
    filesPromoted: validDrafts.length,
    status: 'dry-run' as const,
  }));
}

/**
 * Creates a branch, copies draft files, commits, pushes, and opens a GitHub PR for one domain.
 *
 * @param domain      - CHT domain name.
 * @param validDrafts - Array of valid draft file paths to promote.
 * @param opts        - Options including domainsDir, date, and exec function.
 * @returns ReviewPRResult with status 'created' and the PR URL.
 *
 * @example
 * ```typescript
 * const result = promoteDomain('contacts', ['/tmp/drafts/42-foo.md'], { domainsDir, date, exec });
 * // { domain: 'contacts', branch: '...', prUrl: 'https://...', status: 'created' }
 * ```
 */
function promoteDomain(
  domain: string,
  validDrafts: string[],
  opts: { domainsDir: string; date: string; exec: ExecFn }
): ReviewPRResult {
  const { domainsDir, date, exec } = opts;
  const branchBase = `memory/review/${domain}-${date}`;
  const branch = uniqueBranchName(branchBase, exec);

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

  for (const draftPath of validDrafts) {
    fs.unlinkSync(draftPath);
  }

  return { domain, branch, prUrl, filesPromoted: validDrafts.length, status: 'created' };
}

/**
 * Applies all planned domain promotions: fetches origin/main, then promotes each domain.
 * Restores the original branch in a finally block per domain.
 *
 * @param plans  - Map of domain to valid draft paths.
 * @param config - Options including domainsDir, date, and exec function.
 * @returns Array of ReviewPRResult objects for each promoted domain.
 *
 * @example
 * ```typescript
 * const results = executeApply(plans, { domainsDir, date, exec });
 * ```
 */
function executeApply(
  plans: Map<string, string[]>,
  config: { domainsDir: string; date: string; exec: ExecFn }
): ReviewPRResult[] {
  const { exec } = config;
  const results: ReviewPRResult[] = [];

  exec('git', ['fetch', 'origin', 'main']);
  const originalBranch = exec('git', ['rev-parse', '--abbrev-ref', 'HEAD']).trim();

  for (const [domain, validDrafts] of plans) {
    try {
      results.push(promoteDomain(domain, validDrafts, config));
    } finally {
      exec('git', ['switch', originalBranch]);
    }
  }

  return results;
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
  const date = opts.date ?? new Date().toISOString().slice(0, 10).replaceAll('-', '');
  const exec: ExecFn = opts.execFn ??
    ((file: string, args: string[]) => execFileSync(file, args, { encoding: 'utf8' }) as string);

  const { plans, skipped } = collectValidPlans(discoverDraftsByDomain(pendingDir), logPath);
  if (!apply) return [...skipped, ...buildDryRunResults(plans, date)];
  return [...skipped, ...executeApply(plans, { domainsDir, date, exec })];
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
