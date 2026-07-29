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

function errText(err: unknown): string {
  if (err instanceof Error) {
    const stderr = (err as { stderr?: unknown }).stderr;
    return err.message + (typeof stderr === 'string' ? ` ${stderr}` : '');
  }
  return String(err);
}

/** Issues-endpoint record; null on 404; throws GhTransientError on any other failure. */
function fetchIssueRecord(repo: string, n: number, exec: ExecFn): Record<string, unknown> | null {
  let raw: string;
  try {
    raw = exec('gh', ['api', `repos/${repo}/issues/${n}`]);
  } catch (err) {
    const text = errText(err);
    if (/HTTP 404/i.test(text)) return null; // 404 only — never treat a transient "not found" as missing
    throw new GhTransientError(`classifyNumber(${repo}#${n}): gh api failed: ${text}`, { cause: err });
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
  repo: string, n: number, exec: ExecFn
): { kind: NumberKind; title: string | null } {
  const obj = fetchIssueRecord(repo, n, exec);
  if (obj === null) return { kind: 'missing', title: null };
  return {
    kind: recordKind(obj, repo),
    title: typeof obj.title === 'string' ? obj.title : null,
  };
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
