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

export interface DedupEntry {
  domain: string;
  path: string;
  frontmatter: Record<string, unknown>;
}

export interface DedupDrop {
  path: string;
  reason: string;
}

export interface DedupResult {
  kept: DedupEntry[];
  dropped: DedupDrop[];
}

/**
 * Parses the PR number out of a `owner/repo#123` source_pr reference.
 *
 * @example
 * ```typescript
 * sourcePrNumber('medic/cht-core#42'); // 42
 * sourcePrNumber(undefined); // null
 * ```
 */
export function sourcePrNumber(sourcePr: unknown): number | null {
  if (typeof sourcePr !== 'string') return null;
  const m = /#(\d+)$/.exec(sourcePr);
  return m ? Number.parseInt(m[1], 10) : null;
}

/**
 * True when a draft's issueNumber equals its own source PR number — the exact
 * shape of the pre-R1 mislink (id/issueNumber aliasing the merge PR instead of
 * the resolved issue).
 *
 * @example
 * ```typescript
 * issueEqualsSourcePr({ issueNumber: 10198, source_pr: 'medic/cht-core#10198' }); // true
 * issueEqualsSourcePr({ issueNumber: 8026, source_pr: 'medic/cht-core#10198' }); // false
 * ```
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
 * resolving). Returns null when the slug carries no such prefix — nothing to
 * cross-check.
 *
 * @example
 * ```typescript
 * slugIssueNumber('10043-feat10036-add-thing.md'); // 10036
 * slugIssueNumber('10043-feat-10036-add-thing.md'); // 10036
 * slugIssueNumber('10043-fix-a-typo.md'); // null
 * ```
 */
export function slugIssueNumber(filePath: string): number | null {
  const base = path.basename(filePath, '.md');
  const m = /^\d+-[a-z]+-?(\d+)-/.exec(base);
  return m ? Number.parseInt(m[1], 10) : null;
}

/**
 * True when the filename's embedded issue number (if any) contradicts the
 * frontmatter's issueNumber — a stale slug or a resolution regression.
 *
 * @example
 * ```typescript
 * slugContradictsIssueNumber('10043-feat10036-add-thing.md', { issueNumber: 10036 }); // false
 * slugContradictsIssueNumber('10043-feat10036-add-thing.md', { issueNumber: 10043 }); // true
 * ```
 */
export function slugContradictsIssueNumber(filePath: string, frontmatter: Record<string, unknown>): boolean {
  const slugIssue = slugIssueNumber(filePath);
  if (slugIssue === null) return false;
  return slugIssue !== frontmatter.issueNumber;
}

/**
 * Validates a draft against the CI guard: rejects a mislinked draft (issueNumber
 * aliasing its own source PR) or one whose filename slug contradicts its
 * frontmatter issueNumber. Returns a rejection reason, or null when the draft
 * passes.
 *
 * @example
 * ```typescript
 * ciGuardReason('10198-fix.md', { issueNumber: 10198, source_pr: 'medic/cht-core#10198' });
 * // 'issueNumber (10198) equals its own source PR number — issue likely unresolved'
 * ```
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
 *
 * @example
 * ```typescript
 * const { kept, dropped } = dedupeByIssueId([
 *   { domain: 'data-sync', path: 'a.md', frontmatter: { id: 'cht-core-8985', source_pr: 'medic/cht-core#9098' } },
 *   { domain: 'data-sync', path: 'b.md', frontmatter: { id: 'cht-core-8985', source_pr: 'medic/cht-core#9027' } },
 * ]);
 * // kept === [b], b.frontmatter.source_prs === ['medic/cht-core#9027', 'medic/cht-core#9098']
 * // dropped === [{ path: 'a.md', reason: '...' }]
 * ```
 */
/** Stringifies a frontmatter `id` for grouping, without falling back to `[object Object]`. */
function draftId(frontmatter: Record<string, unknown>): string {
  const rawId = frontmatter.id;
  return typeof rawId === 'string' || typeof rawId === 'number' ? String(rawId) : '';
}

function groupByIssueId(entries: DedupEntry[]): Map<string, DedupEntry[]> {
  const groups = new Map<string, DedupEntry[]>();
  for (const entry of entries) {
    const id = draftId(entry.frontmatter);
    const group = groups.get(id);
    if (group) group.push(entry);
    else groups.set(id, [entry]);
  }
  return groups;
}

/** Picks the canonical entry (lowest source PR, path tiebreak) and builds drop reasons for the rest. */
function collapseGroup(group: DedupEntry[]): { canonical: DedupEntry; dropped: DedupDrop[] } {
  const ranked = [...group].sort((a, b) => {
    const pa = sourcePrNumber(a.frontmatter.source_pr) ?? Infinity;
    const pb = sourcePrNumber(b.frontmatter.source_pr) ?? Infinity;
    return pa === pb ? a.path.localeCompare(b.path) : pa - pb;
  });
  const [canonical, ...rest] = ranked;
  const sourcePrs = ranked.map(e => sourcePrRef(e.frontmatter)).filter((s): s is string => s !== null);
  canonical.frontmatter.source_prs = sourcePrs;
  const dropped = rest.map(dup => ({
    path: dup.path,
    reason:
      `duplicate of ${String(canonical.frontmatter.id)} — collapsed into ` +
      `${sourcePrRef(canonical.frontmatter) ?? 'canonical'} (source_prs: ${sourcePrs.join(', ')})`,
  }));
  return { canonical, dropped };
}

export function dedupeByIssueId(entries: DedupEntry[]): DedupResult {
  const kept: DedupEntry[] = [];
  const dropped: DedupDrop[] = [];

  for (const group of groupByIssueId(entries).values()) {
    if (group.length === 1) {
      kept.push(group[0]);
      continue;
    }
    const { canonical, dropped: groupDropped } = collapseGroup(group);
    kept.push(canonical);
    dropped.push(...groupDropped);
  }

  return { kept, dropped };
}
