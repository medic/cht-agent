/**
 * Pure helpers for resolving the issue(s) a PR closes. Shared by the scraper
 * (pipeline ingestion) and the one-off relink tool so both agree on linkage and
 * cannot drift — divergence here is exactly the mis-attribution class of bug.
 */

/** The source that contributed a linked-issue number, by descending authority. */
export type IssueSource = 'closing-ref' | 'title' | 'body';

/** A resolved issue number with the source that contributed it. */
export interface IssueRef {
  number: number;
  source: IssueSource;
}

/** Upper bound on linked issues per PR — bounds gh fan-out on hostile input. */
export const MAX_LINKED_ISSUES = 10;

/**
 * Extracts the issue number from a conventional-commit PR title scope `type(#N):`
 * (e.g. `fix(#6299): ...`). Returns null for any other shape — a bare `#N` in
 * prose, a multi-token scope, or issue 0 — to avoid false positives.
 */
export function parseTitleIssue(prTitle: string): number | null {
  const m = /^[a-z]+\(#(\d+)\)!?\s*:/i.exec(prTitle);
  if (!m) return null;
  const n = Number.parseInt(m[1], 10);
  return n > 0 ? n : null;
}

/**
 * Issue numbers referenced by Fixes/Closes/Resolves in a PR body. A full
 * `github.com/<owner>/<repo>/issues/N` URL pointing at a different repo is
 * dropped (cross-repo); a bare `#N` is same-repo by definition.
 */
function bodyIssueRefs(prBody: string, repo: string): number[] {
  const pattern = /(?:fixes|closes|resolves)\s+(?:https?:\/\/github\.com\/([^/]+\/[^/]+)\/issues\/|#)(\d+)/gi;
  const out: number[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(prBody)) !== null) {
    if (match[1] && match[1] !== repo) continue; // cross-repo URL — drop
    out.push(Number.parseInt(match[2], 10));
  }
  return out;
}

/**
): IssueRef[] {
  const seen = new Set<number>();
  const refs: IssueRef[] = [];
  const push = (n: number, source: IssueSource): void => {
    if (Number.isInteger(n) && n > 0 && !seen.has(n)) {
      seen.add(n);
      refs.push({ number: n, source });
    }
  };

  for (const ref of closingRefs) push(ref.number, 'closing-ref');

  const titleIssue = parseTitleIssue(prTitle);
  if (titleIssue !== null) push(titleIssue, 'title');

  for (const n of bodyIssueRefs(prBody, repo)) push(n, 'body');

  return refs.slice(0, MAX_LINKED_ISSUES);
}

/**
 * Same-repo `closingIssuesReferences` from PR metadata JSON. Drops cross-repo
 * sidebar links so a PR can't attribute another repo's issue to this one.
 */
export function sameRepoClosingRefs(
  meta: { closingIssuesReferences?: unknown },
  repo: string
): { number: number }[] {
  const raw: Array<{ number: number; url?: string }> = Array.isArray(meta.closingIssuesReferences)
    ? meta.closingIssuesReferences
    : [];
  // Anchor to the host so a crafted path (e.g. github.com/attacker/medic/cht-core/issues/1) can't pass.
  const prefix = `https://github.com/${repo}/issues/`;
  return raw.filter(r => typeof r.url === 'string' && r.url.startsWith(prefix));
}
