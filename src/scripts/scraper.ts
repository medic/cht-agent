/**
 * scraper.ts — Synchronous GitHub PR scraper using `gh` CLI.
 *
 * Known limitations:
 *  - GitHub sidebar-linked issues (added via the PR UI) require the GraphQL
 *    `closingIssuesReferences` field and are NOT captured here; only issues
 *    mentioned in the PR body via Fixes/Closes/Resolves patterns are fetched.
 *  - Accurate `isOrgMember` results require the `read:org` scope on the gh CLI
 *    token. Without that scope, the /orgs/:org/members/:username endpoint may
 *    return 404 even for genuine members.
 */

import { execFileSync } from 'child_process';
import { LinkedIssue, ReviewComment, ScrapedPR, ScraperError } from '../types/pipeline';

/** Options shared across all execFileSync calls. */
const EXEC_OPTS = { maxBuffer: 50 * 1024 * 1024, encoding: 'utf8' as const };

/**
 * Validates that a value is a positive integer suitable for use as a PR number.
 *
 * @param n - The value to check.
 * @returns `true` when n is a positive integer, `false` otherwise.
 *
 * @example
 * ```typescript
 * isPositiveInt(42);   // true
 * isPositiveInt(1.5);  // false
 * isPositiveInt(NaN);  // false
 * isPositiveInt(0);    // false
 * ```
 */
function isPositiveInt(n: number): boolean {
  return Number.isInteger(n) && n > 0;
}

/**
 * Checks whether a GitHub username is a member of the `medic` organisation.
 * Returns `false` gracefully on any error (404, network, missing scope, etc.).
 *
 * Note: accurate results require the `read:org` scope on the gh CLI token.
 *
 * @param username - GitHub username to check.
 * @returns `true` when the API responds with HTTP 204, `false` otherwise.
 *
 * @example
 * ```typescript
 * // In production this calls gh CLI; in tests it is mocked via proxyquire.
 * const member = checkOrgMembership('octocat');
 * ```
 */
function checkOrgMembership(username: string): boolean {
  try {
    execFileSync('gh', ['api', `/orgs/medic/members/${username}`], EXEC_OPTS);
    // gh exits 0 on HTTP 204; non-zero exit throws — caught below.
    return true;
  } catch {
    return false;
  }
}

/**
 * Fetches all linked issues referenced in a PR body.
 *
 * Searches for `Fixes/Closes/Resolves #N` patterns (case-insensitive),
 * deduplicates issue numbers, then fetches each issue via `gh issue view`.
 * If an individual issue fetch fails (404, permissions, etc.), it falls back
 * to `{ number, body: '', comments: [] }` — it does NOT propagate the error.
 *
 * @param prBody  - The raw PR body markdown text.
 * @param repo    - The `owner/repo` string used when calling the gh CLI.
 * @returns Array of LinkedIssue objects for every unique issue number found.
 *
 * @example
 * ```typescript
 * const issues = fetchLinkedIssues('Fixes #10\nCloses #20', 'medic/cht-core');
 * // issues.length === 2
 * ```
 */
function fetchLinkedIssues(prBody: string, repo: string): LinkedIssue[] {
  const pattern = /(?:fixes|closes|resolves)\s+#(\d+)/gi;
  const seen = new Set<number>();
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(prBody)) !== null) {
    seen.add(parseInt(match[1], 10));
  }

  return Array.from(seen).map((issueNumber) => {
    try {
      const raw = execFileSync(
        'gh',
        ['issue', 'view', String(issueNumber), '--repo', repo, '--json', 'body,comments'],
        EXEC_OPTS
      );
      const parsed = JSON.parse(raw);
      const commentBodies: string[] = (parsed.comments ?? []).map(
        (c: { body: string }) => c.body
      );
      return { number: issueNumber, body: parsed.body ?? '', comments: commentBodies };
    } catch {
      return { number: issueNumber, body: '', comments: [] };
    }
  });
}

/**
 * Fetches and assembles all data for a single merged GitHub PR.
 *
 * Steps performed (all synchronous via `gh` CLI):
 *  1. Fetch PR metadata (title, body, labels, merge SHA, file list).
 *  2. Fetch the unified diff.
 *  3. Fetch review summaries and resolve org-membership per unique reviewer.
 *  4. Extract and fetch issues linked in the PR body.
 *
 * @param prNumber - A positive integer GitHub PR number.
 * @param repo     - Repository in `owner/repo` format. Defaults to `'medic/cht-core'`.
 * @returns A fully-populated ScrapedPR object.
 * @throws {ScraperError} When `prNumber` is not a positive integer.
 * @throws {ScraperError} When the PR has not been merged (`mergedAt` is null).
 * @throws {ScraperError} When the diff exceeds 50 MB (`ENOBUFS`).
 * @throws {ScraperError} On any other `gh` CLI failure.
 *
 * @example
 * ```typescript
 * const pr = scrapePR(1234);
 * console.log(pr.prTitle, pr.diff.length);
 * ```
 */
export function scrapePR(prNumber: number, repo: string = 'medic/cht-core'): ScrapedPR {
  // --- Validate input ---
  if (!isPositiveInt(prNumber)) {
    throw new ScraperError(`Invalid PR number: ${prNumber}`, prNumber);
  }

  // --- Step 1: Fetch PR metadata ---
  let metaRaw: string;
  try {
    metaRaw = execFileSync(
      'gh',
      [
        'pr',
        'view',
        String(prNumber),
        '--repo',
        repo,
        '--json',
        'number,title,body,labels,mergeCommit,mergedAt,files',
      ],
      EXEC_OPTS
    );
  } catch (err) {
    throw new ScraperError(
      `Failed to fetch PR #${prNumber} metadata: ${err instanceof Error ? err.message : String(err)}`,
      prNumber,
      { cause: err }
    );
  }

  const meta = JSON.parse(metaRaw);

  if (meta.mergedAt === null || meta.mergedAt === undefined) {
    throw new ScraperError(`PR #${prNumber} is not merged`, prNumber);
  }

  const prTitle: string = meta.title ?? '';
  const prBody: string = meta.body ?? '';
  const labels: string[] = (meta.labels ?? []).map((l: { name: string }) => l.name);
  const mergeSha: string = meta.mergeCommit?.oid ?? '';
  const mergedAt: string = meta.mergedAt;
  const fileList: string[] = (meta.files ?? []).map((f: { path: string }) => f.path);

  // --- Step 2: Fetch diff ---
  let diff: string;
  try {
    diff = execFileSync('gh', ['pr', 'diff', String(prNumber), '--repo', repo], EXEC_OPTS);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOBUFS') {
      throw new ScraperError(`Diff for PR #${prNumber} exceeds 50 MB limit`, prNumber, {
        cause: err,
      });
    }
    throw new ScraperError(
      `Failed to fetch diff for PR #${prNumber}: ${err instanceof Error ? err.message : String(err)}`,
      prNumber,
      { cause: err }
    );
  }

  // --- Step 3: Fetch review summaries ---
  const [owner, repoName] = repo.split('/');
  let reviewsRaw: string;
  try {
    reviewsRaw = execFileSync(
      'gh',
      ['api', `repos/${owner}/${repoName}/pulls/${prNumber}/reviews`, '--paginate'],
      EXEC_OPTS
    );
  } catch (err) {
    throw new ScraperError(
      `Failed to fetch reviews for PR #${prNumber}: ${err instanceof Error ? err.message : String(err)}`,
      prNumber,
      { cause: err }
    );
  }

  // --paginate concatenates JSON arrays as `[...][...]` — merge into one array before parsing.
  const normalizedReviews = reviewsRaw.trim().replace(/\]\s*\[/g, ',');
  const reviews: Array<{ user: { login: string }; body: string | null; state: string }> =
    JSON.parse(normalizedReviews);

  // Cache org membership lookups — one call per unique username.
  const membershipCache = new Map<string, boolean>();

  const reviewComments: ReviewComment[] = reviews
    .filter((r) => r.state !== 'PENDING')
    .map((r) => {
      const author = r.user.login;
      if (!membershipCache.has(author)) {
        membershipCache.set(author, checkOrgMembership(author));
      }
      return {
        author,
        isOrgMember: membershipCache.get(author) as boolean,
        body: r.body ?? '',
      };
    });

  // --- Step 4: Fetch linked issues ---
  const linkedIssues: LinkedIssue[] = fetchLinkedIssues(prBody, repo);

  return {
    prNumber,
    prTitle,
    prBody,
    labels,
    mergeSha,
    mergedAt,
    fileList,
    diff,
    linkedIssues,
    reviewComments,
  };
}

/* istanbul ignore next */
if (require.main === module) {
  const prNumberArg = parseInt(process.argv[2], 10);
  try {
    const result = scrapePR(prNumberArg);
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error(err instanceof ScraperError ? err.message : String(err));
    process.exit(1);
  }
}
