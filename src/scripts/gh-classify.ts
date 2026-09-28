/**
 * Classify a GitHub number as issue | pr | missing, and resolve a PR to the single
 * issue it closes. GitHub serves PRs via the issues endpoint, so the `pull_request`
 * key on `repos/<repo>/issues/N` is the only reliable signal. Kept out of the pure
 * issue-linkage.ts; a transient gh error surfaces as GhTransientError so a throttled
 * lookup never demotes a real issue.
 */

import { sameRepoClosingRefs } from './issue-linkage';

export type ExecFn = (file: string, args: string[]) => string;

export type NumberKind = 'issue' | 'pr' | 'missing';

export interface ResolveResult {
  issue: number | null;
  reason?: 'missing' | 'no-issue' | 'multi-issue';
}

/** A number that could not be classified due to a transient gh failure (rate-limit/5xx/network). */
export class GhTransientError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'GhTransientError';
  }
}

/** Per-run classification cache, keyed `repo#number`. */
export type ClassifyCache = Map<string, NumberKind>;

/**
 * Memoises the full record, not just the kind. Anonymous GitHub allows 60
 * requests an hour, and a corpus cites the same issue from many drafts — without
 * this, a 25-draft scan spends its whole budget re-fetching a handful of numbers
 * and reports the rest as "unverified", which reads like a clean run.
 */
export type DescribeCache = Map<string, { kind: NumberKind; title: string | null }>;

function errText(err: unknown): string {
  if (err instanceof Error) {
    const stderr = (err as { stderr?: unknown }).stderr;
    return err.message + (typeof stderr === 'string' ? ` ${stderr}` : '');
  }
  return String(err);
}

/**
 * Anonymous fallback for hosts with no `gh`. Returns the parsed body, `null` on a
 * genuine 404, or throws for anything else — the same three-way answer `gh` gives,
 * so the caller's "404 means missing, everything else means transient" rule holds.
 * The status code is appended on its own line so it can be told from the body.
 */
function fetchViaCurl(repo: string, n: number, exec: ExecFn): Record<string, unknown> | null {
  const raw = exec('curl', [
    '-s', '--max-time', '20', '-w', '\n%{http_code}',
    `https://api.github.com/repos/${repo}/issues/${n}`,
  ]);
  const cut = raw.lastIndexOf('\n');
  const status = raw.slice(cut + 1).trim();
  if (status === '404') return null;
  if (status !== '200') throw new Error(`HTTP ${status}`);
  return JSON.parse(raw.slice(0, cut)) as Record<string, unknown>;
}

/** Issues-endpoint record; null on 404; throws GhTransientError on any other failure. */
function fetchIssueRecord(repo: string, n: number, exec: ExecFn): Record<string, unknown> | null {
  let raw: string;
  try {
    raw = exec('gh', ['api', `repos/${repo}/issues/${n}`]);
  } catch (err) {
    const text = errText(err);
    if (/HTTP 404/i.test(text)) return null; // 404 only — never treat a transient "not found" as missing
    // `gh` absent or unauthenticated is not a verdict about the issue. Retry
    // anonymously before giving up, so a host without gh still gets checked.
    try {
      return fetchViaCurl(repo, n, exec);
    } catch (curlErr) {
      throw new GhTransientError(
        `classifyNumber(${repo}#${n}): gh api failed: ${text}; curl fallback: ${errText(curlErr)}`,
        { cause: err }
      );
    }
  }
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch (err) {
    throw new GhTransientError(`classifyNumber(${repo}#${n}): unparseable gh response`, { cause: err });
  }
}

function recordKind(obj: Record<string, unknown>, repo: string): NumberKind {
  const repoUrl = typeof obj.repository_url === 'string' ? obj.repository_url : '';
  if (repoUrl && !repoUrl.endsWith(`/repos/${repo}`)) return 'missing'; // transferred elsewhere
  return Object.hasOwn(obj, 'pull_request') ? 'pr' : 'issue';
}

/**
 * Classify `n` in `repo` via the issues endpoint's `pull_request` key. Memoized.
 * @throws {GhTransientError} on a non-404 gh failure.
 */
export function classifyNumber(repo: string, n: number, exec: ExecFn, cache?: ClassifyCache): NumberKind {
  const key = `${repo}#${n}`;
  const cached = cache?.get(key);
  if (cached !== undefined) return cached;
  const obj = fetchIssueRecord(repo, n, exec);
  const kind: NumberKind = obj === null ? 'missing' : recordKind(obj, repo);
  cache?.set(key, kind);
  return kind;
}

/**
 * Kind plus title for `n`. The title is what lets a caller check a draft's
 * one-line gloss of a cross-reference against reality: a draft citing #10754 as
 * "Scheduled task duplicate processing" is only catchable by reading that the
 * real title is "Cookies not being sent with `secure: true`".
 *
 * @throws {GhTransientError} on a non-404 gh failure.
 */
export function describeNumber(
  repo: string, n: number, exec: ExecFn, cache?: DescribeCache
): { kind: NumberKind; title: string | null } {
  const key = `${repo}#${n}`;
  const hit = cache?.get(key);
  if (hit) return hit;
  const obj = fetchIssueRecord(repo, n, exec);
  const out = obj === null
    ? { kind: 'missing' as NumberKind, title: null }
    : { kind: recordKind(obj, repo), title: typeof obj.title === 'string' ? obj.title : null };
  cache?.set(key, out);
  return out;
}

/** Same-repo issues a PR closes (cross-repo closing-refs dropped). */
function prClosingIssues(repo: string, n: number, exec: ExecFn): number[] {
  let raw: string;
  try {
    raw = exec('gh', ['pr', 'view', String(n), '--repo', repo, '--json', 'closingIssuesReferences']);
  } catch (err) {
    throw new GhTransientError(`resolveRealIssue(${repo}#${n}): gh pr view failed: ${errText(err)}`, { cause: err });
  }
  let meta: { closingIssuesReferences?: unknown };
  try {
    meta = JSON.parse(raw);
  } catch (err) {
    throw new GhTransientError(`resolveRealIssue(${repo}#${n}): unparseable gh response`, { cause: err });
  }
  return [...new Set(sameRepoClosingRefs(meta, repo).map(r => r.number))];
}

/**
 * Resolve `n` to the single real same-repo issue it represents: an issue resolves
 * to itself; a PR to its sole closing issue (one hop — closing-refs are issues).
 * Returns issue:null with a reason for missing / no-issue / multi-issue.
 * @throws {GhTransientError} on a transient gh failure.
 */
export function resolveRealIssue(repo: string, n: number, exec: ExecFn, cache?: ClassifyCache): ResolveResult {
  const kind = classifyNumber(repo, n, exec, cache);
  if (kind === 'issue') return { issue: n };
  if (kind === 'missing') return { issue: null, reason: 'missing' };
  const issues = prClosingIssues(repo, n, exec);
  if (issues.length === 1) return { issue: issues[0] };
  return { issue: null, reason: issues.length === 0 ? 'no-issue' : 'multi-issue' };
}
