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
 * Merges the issue numbers a PR resolves from closingIssuesReferences (sidebar),
 * the title scope, and the body Fixes/Closes/Resolves keywords — deduped, ordered
 * by descending authority (so the first entry is the most authoritative), and
 * capped at MAX_LINKED_ISSUES.
 */
export function collectLinkedIssueRefs(
  prTitle: string,
  prBody: string,
  closingRefs: { number: number }[]
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

  const bodyPattern = /(?:fixes|closes|resolves)\s+(?:https?:\/\/github\.com\/[^/]+\/[^/]+\/issues\/|#)(\d+)/gi;
  let match: RegExpExecArray | null;
  while ((match = bodyPattern.exec(prBody)) !== null) {
    push(Number.parseInt(match[1], 10), 'body');
  }

  return refs.slice(0, MAX_LINKED_ISSUES);
}
