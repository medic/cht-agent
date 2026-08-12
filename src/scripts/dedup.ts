/**
 * dedup.ts — collapse duplicate/backport drafts and reject mislinked ones before promotion.
 *
 * Two independent checks, both keyed on the frontmatter set by the R1 issue-resolution
 * fix (distiller.ts buildFrontmatter):
 *  - CI guard (`ciGuardReason`): reject a draft whose issueNumber equals its own source
 *    PR number, or whose filename slug embeds a different issue number than the
 *    frontmatter — both indicate the resolution regressed. The `/issues/N -> /pull/N`
 *    GitHub redirect makes this the only reliable detector short of hitting the API.
 *  - Cross-PR/cross-domain dedup (`dedupeByIssueId`): multiple PRs (backport
 *    cherry-picks, multi-PR epics, or independent domain promotions) that resolve to
 *    the same issue `id` collapse into one canonical draft — the lowest source PR
 *    number — carrying a `source_prs` list of every contributing PR. The rest are
 *    dropped and logged rather than promoted twice.
 */

import * as path from 'node:path';
import { FILENAME_TOKEN_RE } from './relink-issues';

export interface DedupEntry {
  domain: string;
  path: string;
  frontmatter: Record<string, unknown>;
}

export interface DedupDrop {
  path: string;
  canonicalPath: string;
  reason: string;
}

export interface DedupResult {
  kept: DedupEntry[];
  dropped: DedupDrop[];
}

/** Parse the PR number from an `owner/repo#123` reference. */
export function sourcePrNumber(sourcePr: unknown): number | null {
  if (typeof sourcePr !== 'string') return null;
  const m = /#(\d+)$/.exec(sourcePr);
  return m ? Number.parseInt(m[1], 10) : null;
}

/**
 * True when a draft's issueNumber equals its own source PR number — the exact
 * shape of the pre-R1 mislink (id/issueNumber aliasing the merge PR instead of
 * the resolved issue).
 */
export function issueEqualsSourcePr(frontmatter: Record<string, unknown>): boolean {
  const issueNumber = frontmatter.issueNumber;
  if (typeof issueNumber !== 'number') return false;
  return issueNumber === sourcePrNumber(frontmatter.source_pr);
}

/**
 * The issue number embedded in a `<prNumber>-<slug>.md` filename when the slug
 * itself starts with a CHT `type(#N):` conventional-commit prefix (slugified to
 * `type<n>-...` or `type-<n>-...`, e.g. `10043-feat10036-add-thing.md` and
 * `10043-feat-10036-add-thing.md` both -> 10036 — old drafts predate the
 * slugify separator fix and are never rewritten, so both forms must keep
 * resolving). Returns null when the slug carries no such prefix.
 */
export function slugIssueNumber(filePath: string): number | null {
  const base = path.basename(filePath, '.md');
  const m = FILENAME_TOKEN_RE.exec(base);
  return m ? Number.parseInt(m[2], 10) : null;
}

/**
 * True when the filename's embedded issue number (if any) contradicts the
 * frontmatter's issueNumber — a stale slug or a resolution regression.
 */
export function slugContradictsIssueNumber(filePath: string, frontmatter: Record<string, unknown>): boolean {
  const slugIssue = slugIssueNumber(filePath);
  if (slugIssue === null) return false;
  return slugIssue !== frontmatter.issueNumber;
}

/**
 * Validates a draft against the CI guard: rejects a mislinked draft (issueNumber
 * aliasing its own source PR) or one whose filename slug contradicts its
 * frontmatter issueNumber. Returns a rejection reason, or null when the draft passes.
 */
export function ciGuardReason(filePath: string, frontmatter: Record<string, unknown>): string | null {
  if (issueEqualsSourcePr(frontmatter)) {
    return `issueNumber (${frontmatter.issueNumber}) equals its own source PR number — issue likely unresolved`;
  }
  if (slugContradictsIssueNumber(filePath, frontmatter)) {
    return `filename slug implies issue #${slugIssueNumber(filePath)} but frontmatter issueNumber is ${frontmatter.issueNumber}`;
  }
  return null;
}

/** Extract the `owner/repo#pr` source PR ref, or null when absent/malformed. */
function sourcePrRef(frontmatter: Record<string, unknown>): string | null {
  return typeof frontmatter.source_pr === 'string' ? frontmatter.source_pr : null;
}

/**
 * Collapses drafts that resolve to the same `id` (set by the distiller's
 * canonical-issue resolution) into one canonical draft — the one from the lowest
 * source PR number — carrying a `source_prs` list of every contributing PR ref.
 * Drops every other member of the group. Cross-domain duplicates collapse the
 * same way; the canonical entry keeps its own domain.
 */
export function dedupeByIssueId(entries: DedupEntry[]): DedupResult { // NOSONAR typescript:S3776 -- linear grouping/sort, not worth splitting
  const groups = new Map<string, DedupEntry[]>();
  const kept: DedupEntry[] = [];
  const dropped: DedupDrop[] = [];
  for (const entry of entries) {
    const rawId = entry.frontmatter.id;
    if (typeof rawId !== 'string' && typeof rawId !== 'number') {
      kept.push(entry);
      continue;
    }
    const id = String(rawId);
    const group = groups.get(id);
    if (group) group.push(entry);
    else groups.set(id, [entry]);
  }

  for (const group of groups.values()) {
    if (group.length === 1) {
      kept.push(group[0]);
      continue;
    }
    const ranked = [...group].sort((a, b) => {
      const fit = (b.frontmatter.domainFit === 'strong' ? 1 : 0) - (a.frontmatter.domainFit === 'strong' ? 1 : 0);
      if (fit !== 0) return fit;
      const pa = sourcePrNumber(a.frontmatter.source_pr) ?? Infinity;
      const pb = sourcePrNumber(b.frontmatter.source_pr) ?? Infinity;
      return pa === pb ? a.path.localeCompare(b.path) : pa - pb;
    });
    const [canonical, ...rest] = ranked;
    const sourcePrs = ranked.map(e => sourcePrRef(e.frontmatter)).filter((s): s is string => s !== null);
    canonical.frontmatter.source_prs = sourcePrs;
    kept.push(canonical);
    for (const dup of rest) {
      dropped.push({
        path: dup.path,
        canonicalPath: canonical.path,
        reason:
          `duplicate of ${String(canonical.frontmatter.id)} — collapsed into ` +
          `${sourcePrRef(canonical.frontmatter) ?? 'canonical'} (source_prs: ${sourcePrs.join(', ')})`,
      });
    }
  }

  return { kept, dropped };
}
