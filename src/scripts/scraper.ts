/**
 * scraper.ts — Synchronous GitHub PR scraper using `gh` CLI.
 *
 * Linked issues are merged from three sources in descending authority: the
 * GraphQL `closingIssuesReferences` (sidebar links), the PR title scope
 * `type(#N):`, and the PR body `Fixes/Closes/Resolves #N` keywords.
 *
 * Known limitation:
 *  - Accurate `isOrgMember` results require the `read:org` scope on the gh CLI
 *    token. Without that scope, the /orgs/:org/members/:username endpoint may
 *    return 404 even for genuine members.
 */

import { execFileSync } from 'node:child_process';
import { LinkedIssue, ReviewComment, ScrapedPR, ScraperError } from '../types/pipeline';
import { IssueRef, collectLinkedIssueRefs, sameRepoClosingRefs } from './issue-linkage';

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
 * Hydrates each collected issue reference via `gh issue view`, preserving order.
 * A failed fetch (404/permissions/bad JSON) drops that issue rather than
 * returning an empty stub — an unresolvable reference must not count as a real
 * linked issue downstream (e.g. flipping a filter skip into a distill).
 */
function fetchLinkedIssues(refs: IssueRef[], repo: string): LinkedIssue[] {
  return refs
    .map((ref): LinkedIssue | null => {
      try {
        const raw = execFileSync(
          'gh',
          ['issue', 'view', String(ref.number), '--repo', repo, '--json', 'body,comments'],
          EXEC_OPTS
        );
        const parsed = JSON.parse(raw);
        const commentBodies: string[] = (parsed.comments ?? []).map(
          (c: { body: string }) => c.body
        );
        return { number: ref.number, body: parsed.body ?? '', comments: commentBodies };
      } catch {
        return null;
      }
    })
    .filter((issue): issue is LinkedIssue => issue !== null);
}

/**
 * Fetches raw PR metadata JSON string from the gh CLI.
 *
 * @param prNumber - A positive integer GitHub PR number.
 * @param repo     - Repository in `owner/repo` format.
 * @returns Raw JSON string of PR metadata.
 * @throws {ScraperError} On gh CLI failure.
 *
 * @example
 * ```typescript
 * // In production calls gh CLI; in tests mocked via proxyquire.
 * const raw = fetchMetadata(1234, 'medic/cht-core');
 * ```
 */
function fetchMetadata(prNumber: number, repo: string): string {
  try {
    return execFileSync(
      'gh',
      [
        'pr',
        'view',
        String(prNumber),
        '--repo',
        repo,
        '--json',
        'number,title,body,labels,mergeCommit,mergedAt,files,author,closingIssuesReferences',
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
}

/**
 * Fetches the unified diff for a PR from the gh CLI.
 *
 * @param prNumber - A positive integer GitHub PR number.
 * @param repo     - Repository in `owner/repo` format.
 * @returns The raw unified diff string.
 * @throws {ScraperError} When the diff exceeds 50 MB (`ENOBUFS`).
 * @throws {ScraperError} On any other gh CLI failure.
 *
 * @example
 * ```typescript
 * // In production calls gh CLI; in tests mocked via proxyquire.
 * const diff = fetchDiff(1234, 'medic/cht-core');
 * ```
 */
function fetchDiff(prNumber: number, repo: string): string {
  try {
    return execFileSync('gh', ['pr', 'diff', String(prNumber), '--repo', repo], EXEC_OPTS);
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
}

/**
 * Fetches raw review JSON string for a PR from the gh CLI.
 *
 * Uses `--paginate --slurp` so multi-page results come back as a single,
 * well-formed JSON array of pages (each page is itself an array of reviews) —
 * not raw concatenated arrays. This avoids corrupting review bodies that happen
 * to contain `] [` and avoids breaking on empty pages.
 *
 * @param prNumber - A positive integer GitHub PR number.
 * @param repo     - Repository in `owner/repo` format.
 * @returns Raw JSON string: an array of page-arrays.
 * @throws {ScraperError} On gh CLI failure.
 *
 * @example
 * ```typescript
 * // In production calls gh CLI; in tests mocked via proxyquire.
 * const raw = fetchReviews(1234, 'medic/cht-core');
 * ```
 */
function fetchReviews(prNumber: number, repo: string): string {
  const [owner, repoName] = repo.split('/');
  try {
    return execFileSync(
      'gh',
      ['api', `repos/${owner}/${repoName}/pulls/${prNumber}/reviews`, '--paginate', '--slurp'],
      EXEC_OPTS
    );
  } catch (err) {
    throw new ScraperError(
      `Failed to fetch reviews for PR #${prNumber}: ${err instanceof Error ? err.message : String(err)}`,
      prNumber,
      { cause: err }
    );
  }
}

/** A raw review from the gh API; `user` is null for since-deleted accounts. */
type RawReview = { user: { login: string } | null; body: string | null; state: string };

/** Fetch + parse PR metadata, asserting the PR is merged. */
function fetchAndParseMetadata(prNumber: number, repo: string): Record<string, unknown> {
  const metaRaw = fetchMetadata(prNumber, repo);
  let meta;
  try {
    meta = JSON.parse(metaRaw);
  } catch (err) {
    throw new ScraperError(`Failed to parse PR metadata for #${prNumber}`, prNumber, { cause: err });
  }
  if (meta.mergedAt === null || meta.mergedAt === undefined) {
    throw new ScraperError(`PR #${prNumber} is not merged`, prNumber);
  }
  return meta;
}

/**
 * Parse the `--paginate --slurp` reviews payload. gh returns one array element
 * per page (each itself an array), so flatten one level; `.flat()` is a no-op if
 * gh ever returns an already-flat array.
 */
function parseReviews(reviewsRaw: string, prNumber: number): RawReview[] {
  try {
    const parsed = JSON.parse(reviewsRaw.trim() || '[]');
    return (Array.isArray(parsed) ? parsed : []).flat() as RawReview[];
  } catch (err) {
    throw new ScraperError(`Failed to parse reviews for #${prNumber}`, prNumber, { cause: err });
  }
}

/** Map reviews to comments, resolving org membership once per unique author. */
function buildReviewComments(reviews: RawReview[]): ReviewComment[] {
  const membershipCache = new Map<string, boolean>();
  return reviews
    .filter(r => r.state !== 'PENDING')
    .map(r => {
      const author = r.user?.login ?? 'ghost'; // null for since-deleted accounts
      if (!membershipCache.has(author)) membershipCache.set(author, checkOrgMembership(author));
      return { author, isOrgMember: membershipCache.get(author) as boolean, body: r.body ?? '' };
    });
}

/**
 * Fetches and assembles all data for a single merged GitHub PR (metadata, diff,
 * reviews with org-membership, and linked issues).
 *
 * @param prNumber - A positive integer GitHub PR number.
 * @param repo     - Repository in `owner/repo` format. Defaults to `'medic/cht-core'`.
 * @returns A fully-populated ScrapedPR object.
 * @throws {ScraperError} When `prNumber` is invalid, the PR is not merged, the diff
 *   exceeds 50 MB, or any `gh` CLI call fails.
 *
 * @example
 * ```typescript
 * const pr = scrapePR(1234);
 * console.log(pr.prTitle, pr.diff.length);
 * ```
 */
export function scrapePR(prNumber: number, repo: string = 'medic/cht-core'): ScrapedPR {
  if (!isPositiveInt(prNumber)) {
    throw new ScraperError(`Invalid PR number: ${prNumber}`, prNumber);
  }
  const meta = fetchAndParseMetadata(prNumber, repo);
  const prTitle = (meta.title as string) ?? '';
  const prBody = (meta.body as string) ?? '';
  // Preserve the original fetch order (diff before reviews) so a diff error surfaces first.
  const diff = fetchDiff(prNumber, repo);
  const reviews = parseReviews(fetchReviews(prNumber, repo), prNumber);
  const linkedIssues: LinkedIssue[] = fetchLinkedIssues(
    collectLinkedIssueRefs(prTitle, prBody, sameRepoClosingRefs(meta, repo)),
    repo
  );

  return {
    prNumber,
    prTitle,
    prBody,
    labels: ((meta.labels as { name: string }[]) ?? []).map(l => l.name),
    mergeSha: (meta.mergeCommit as { oid?: string })?.oid ?? '',
    mergedAt: meta.mergedAt as string,
    fileList: ((meta.files as { path: string }[]) ?? []).map(f => f.path),
    diff,
    linkedIssues,
    reviewComments: buildReviewComments(reviews),
    author: (meta.author as { login?: string })?.login ?? '',
  };
}

/* istanbul ignore next */
if (require.main === module) {
  const prNumberArg = Number.parseInt(process.argv[2], 10);
  try {
    const result = scrapePR(prNumberArg);
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error(err instanceof ScraperError ? err.message : String(err));
    process.exit(1);
  }
}
