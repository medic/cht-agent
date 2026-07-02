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
import { ciGuardReason, dedupeByIssueId, DedupEntry, DedupDrop } from './dedup';

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
 * Escape characters that have structural meaning in inline Markdown, so a draft
 * title can't inject formatting (or break the list item) when interpolated into
 * the PR body.
 *
 * @example
 * ```typescript
 * escapeMarkdown('a*b_c[d]`e'); // 'a\\*b\\_c\\[d\\]\\`e'
 * ```
 */
function escapeMarkdown(text: string): string {
  return text.replace(/[\\`*_[\]<>]/g, String.raw`\$&`);
}

/**
 * Resolve a `source_pr` reference to a clickable GitHub PR URL.
 *
 * The distiller writes references in `owner/repo#number` form (e.g.
 * `medic/cht-core#42`). A naive `https://github.com/<ref>` only yields
 * `https://github.com/medic/cht-core#42` — a fragment anchor on the repo home
 * page, not the PR. This converts the `#number` suffix into a real `/pull/number`
 * path. References that don't match the expected shape fall back to a plain
 * `https://github.com/<ref>` link so nothing is silently dropped.
 *
 * @example
 * ```typescript
 * sourcePrUrl('medic/cht-core#42'); // 'https://github.com/medic/cht-core/pull/42'
 * sourcePrUrl('medic/cht-core');    // 'https://github.com/medic/cht-core'
 * ```
 */
export function sourcePrUrl(ref: string): string {
  const match = /^([^#]+)#(\d+)$/.exec(ref);
  if (match) {
    return `https://github.com/${match[1]}/pull/${match[2]}`;
  }
  return `https://github.com/${ref}`;
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
    const title = escapeMarkdown(String(fm.title ?? path.basename(draftPath)));
    const sourcePrStr = typeof fm.source_pr === 'string' ? fm.source_pr : '';
    const sourcePr = sourcePrStr
      ? ` — [${escapeMarkdown(sourcePrStr)}](${sourcePrUrl(sourcePrStr)})`
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
 * Validates one domain's draft paths against the schema and the CI guard
 * (`ciGuardReason` — rejects a mislinked draft or a slug/issueNumber
 * contradiction). Passing drafts are returned as `DedupEntry` objects so the
 * caller can run cross-domain dedup before promotion.
 *
 * @param domain     - CHT domain these drafts were discovered under.
 * @param draftPaths - Array of absolute draft file paths to validate.
 * @param logPath    - Path to the NDJSON audit log file.
 * @returns Array of entries that passed schema validation and the CI guard.
 *
 * @example
 * ```typescript
 * const valid = findValidEntries('contacts', ['/tmp/drafts/42-foo.md'], '/tmp/skipped.ndjson');
 * ```
 */
function findValidEntries(domain: string, draftPaths: string[], logPath: string): DedupEntry[] { // NOSONAR typescript:S3776 -- straight-line validation chain, not worth splitting
  const valid: DedupEntry[] = [];
  for (const draftPath of draftPaths) {
    const parsed = parseDraft(draftPath, logPath);
    if (parsed === null) continue;
    const data = normalizeFrontmatter(parsed.data as Record<string, unknown>);
    if (!validate(data)) {
      const errors = (validate.errors ?? []).map(e => e.message ?? 'invalid').join('; ');
      writeSkipEntry(logPath, draftPath, `Schema invalid: ${errors}`);
      continue;
    }
    const guardReason = ciGuardReason(draftPath, data);
    if (guardReason !== null) {
      writeSkipEntry(logPath, draftPath, `CI guard: ${guardReason}`);
      continue;
    }
    valid.push({ domain, path: draftPath, frontmatter: data });
  }
  return valid;
}

/**
 * Rewrites a draft's YAML frontmatter in place, preserving its markdown body.
 * Used after dedup adds `source_prs` to a canonical draft's frontmatter.
 *
 * @example
 * ```typescript
 * rewriteFrontmatterOnDisk('/tmp/drafts/42-foo.md', { ...frontmatter, source_prs: [...] });
 * ```
 */
function rewriteFrontmatterOnDisk(draftPath: string, frontmatter: Record<string, unknown>): void {
  const { content } = matter(fs.readFileSync(draftPath, 'utf8'));
  fs.writeFileSync(draftPath, matter.stringify(content, frontmatter), 'utf8');
}

/** Return value of `collectValidPlans` — the dedup outcome plus derived per-domain plans. */
interface CollectedPlans {
  plans: Map<string, string[]>;
  skipped: ReviewPRResult[];
  /** Surviving entries after dedup; a `source_prs`-bearing entry needs its on-disk frontmatter rewritten before staging. */
  kept: DedupEntry[];
  /** Duplicates collapsed away by dedup; their _pending files must be removed so they don't resurface as a fresh singleton next run. */
  dropped: DedupDrop[];
}

/**
 * Collects valid draft plans per domain and separates skipped domains. Pure
 * planning only — does not touch `_pending` file contents; the caller decides
 * whether to apply the resulting frontmatter rewrites/deletions (dry-run must
 * not mutate any files).
 *
 * Validates every domain's drafts against the schema and CI guard, then runs a
 * single cross-domain dedup pass (`dedupeByIssueId`) over all surviving drafts
 * so backport cherry-picks and multi-PR epics collapse into one canonical
 * draft — regardless of which domain each duplicate landed in.
 *
 * @param byDomain - Map of domain to its discovered draft paths.
 * @param logPath  - Path to the NDJSON audit log file.
 * @returns `plans`/`skipped` for building results, plus `kept`/`dropped` for the caller to apply.
 *
 * @example
 * ```typescript
 * const { plans, skipped, kept, dropped } = collectValidPlans(byDomain, '/tmp/skipped.ndjson');
 * ```
 */
function collectValidPlans(byDomain: Map<string, string[]>, logPath: string): CollectedPlans { // NOSONAR typescript:S3776 -- straight-line plan assembly, not worth splitting
  const allValid = Array.from(byDomain.entries()).flatMap(([domain, draftPaths]) =>
    findValidEntries(domain, draftPaths, logPath)
  );

  const { kept, dropped } = dedupeByIssueId(allValid);
  for (const drop of dropped) {
    writeSkipEntry(logPath, drop.path, drop.reason);
  }

  const plans = new Map<string, string[]>();
  for (const entry of kept) {
    const existing = plans.get(entry.domain);
    if (existing) existing.push(entry.path);
    else plans.set(entry.domain, [entry.path]);
  }

  const skipped: ReviewPRResult[] = [];
  for (const domain of byDomain.keys()) {
    if (!plans.has(domain)) {
      skipped.push({ domain, branch: '', filesPromoted: 0, status: 'skipped' });
    }
  }
  return { plans, skipped, kept, dropped };
}

/**
 * Applies the on-disk side effects of dedup: persists `source_prs` onto a
 * collapsed canonical draft's frontmatter, and removes every collapsed
 * duplicate from `_pending`. Apply-mode only — dry-run must report what would
 * happen without mutating any draft file.
 *
 * @example
 * ```typescript
 * applyDedupMutations(kept, dropped);
 * ```
 */
function applyDedupMutations(kept: DedupEntry[], dropped: DedupDrop[]): void { // NOSONAR typescript:S3776 -- two independent straight-line loops, not worth splitting
  for (const entry of kept) {
    if (entry.frontmatter.source_prs !== undefined) {
      rewriteFrontmatterOnDisk(entry.path, entry.frontmatter);
    }
  }
  for (const drop of dropped) {
    try {
      fs.unlinkSync(drop.path);
    } catch {
      // Already gone — nothing to clean up.
    }
  }
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
/**
 * Copy each draft into the domain's issues directory, returning the repo-relative
 * paths to stage with `git add`.
 *
 * @example
 * ```typescript
 * const paths = stageDrafts(['/tmp/pending/contacts/42-foo.md'], '/repo/agent-memory/domains/contacts/issues');
 * ```
 */
function stageDrafts(validDrafts: string[], targetDir: string): string[] {
  fs.mkdirSync(targetDir, { recursive: true });
  return validDrafts.map(draftPath => {
    const targetPath = path.join(targetDir, path.basename(draftPath));
    fs.copyFileSync(draftPath, targetPath);
    return path.relative(REPO_ROOT, targetPath);
  });
}

/**
 * Best-effort deletion of a pushed branch whose promotion later failed, so a
 * failure doesn't leave an orphan branch behind. Swallows its own errors — the
 * original failure is what matters.
 *
 * @example
 * ```typescript
 * deleteRemoteBranch(exec, 'memory/review/contacts-20240101');
 * ```
 */
function deleteRemoteBranch(exec: ExecFn, branch: string): void {
  try {
    exec('git', ['push', 'origin', '--delete', branch]);
  } catch {
    // Ignore cleanup failure — the original error is what matters.
  }
}

function promoteDomain(
  domain: string,
  validDrafts: string[],
  opts: { domainsDir: string; date: string; exec: ExecFn }
): ReviewPRResult {
  const { domainsDir, date, exec } = opts;
  const branch = uniqueBranchName(`memory/review/${domain}-${date}`, exec);

  exec('git', ['switch', '-c', branch, 'origin/main']);

  let pushed = false;
  try {
    const addPaths = stageDrafts(validDrafts, path.join(domainsDir, domain, 'issues'));
    exec('git', ['add', ...addPaths]);
    exec('git', ['commit', '-m',
      `feat(memory): promote ${validDrafts.length} ${domain} draft(s) for review`]);
    exec('git', ['push', '-u', 'origin', branch]);
    pushed = true;

    const prUrl = exec('gh', [
      'pr', 'create',
      '--title', `Memory review: ${domain}`,
      '--body', buildPRBody(domain, validDrafts),
      '--head', branch,
      '--base', 'main',
    ]).trim();

    validDrafts.forEach(draftPath => fs.unlinkSync(draftPath));

    return { domain, branch, prUrl, filesPromoted: validDrafts.length, status: 'created' };
  } catch (err) {
    if (pushed) deleteRemoteBranch(exec, branch);
    throw err;
  }
}

/**
 * Applies all planned domain promotions: fetches origin/main, then promotes each domain.
 * Each domain is isolated — a failure in one is recorded as a 'failed' result and
 * the remaining domains still run. The original branch is restored after each domain.
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
/**
 * Promote one domain, converting any thrown error into a 'failed' result so a
 * single domain's failure never aborts the whole run.
 *
 * @example
 * ```typescript
 * const r = promoteDomainSafely('contacts', ['/tmp/drafts/42-foo.md'], { domainsDir, date, exec });
 * // r.status is 'created' on success or 'failed' (with r.error) on error
 * ```
 */
function promoteDomainSafely(
  domain: string,
  validDrafts: string[],
  config: { domainsDir: string; date: string; exec: ExecFn }
): ReviewPRResult {
  try {
    return promoteDomain(domain, validDrafts, config);
  } catch (err) {
    return {
      domain,
      branch: '',
      filesPromoted: 0,
      status: 'failed',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

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
      results.push(promoteDomainSafely(domain, validDrafts, config));
    } finally {
      // Always restore the original branch, even if a promotion threw unexpectedly.
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

  const { plans, skipped, kept, dropped } = collectValidPlans(discoverDraftsByDomain(pendingDir), logPath);
  if (!apply) return [...skipped, ...buildDryRunResults(plans, date)];

  applyDedupMutations(kept, dropped);
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
