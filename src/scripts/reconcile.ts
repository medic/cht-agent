/**
 * reconcile.ts — per-run reconciliation report for the memory distillation pipeline.
 *
 * Summarizes what a batch of `_skipped.ndjson` entries actually did — how many
 * drafts were rejected by the CI mislink/slug guard (dedup.ts's `ciGuardReason`),
 * how many were collapsed as duplicates (`dedupeByIssueId`), and how many were
 * flagged for human review for any other reason. `writeSkipEntry` in
 * open-review-pr.ts prefixes every reason with `open-review-pr: `, so matchers
 * here use `includes` rather than `startsWith`.
 *
 * Also exposes `hallucinationRate` — a ground-truth check comparing a distilled
 * draft's claimed `relatedFiles`/`entities` against the PR's real `fileList`.
 * `entities` may legitimately name a module or concept rather than a literal
 * path, so this is a noisy signal by construction — surface it as a count/rate
 * for human review, never as a pass/fail gate.
 */

import type { SkipLogEntry } from '../types/pipeline';

/** Counts produced by `reconcile` for one batch of skip-log entries. */
export interface ReconciliationSummary {
  total: number;
  ciGuardRejections: number;
  dedupCollapses: number;
  otherFlags: number;
}

/**
 * Summarizes a batch of `_skipped.ndjson` entries into reconciliation counts.
 *
 * @param entries - Skip-log entries produced by a pipeline run.
 * @returns Counts of CI-guard rejections, dedup collapses, and other flags.
 *
 * @example
 * ```typescript
 * reconcile([
 *   { prNumber: 1, decision: 'flag-for-human', reason: 'open-review-pr: CI guard: mislink — 1-x.md', timestamp: 't' },
 *   { prNumber: 2, decision: 'flag-for-human', reason: 'open-review-pr: duplicate of cht-core-9 — 2-y.md', timestamp: 't' },
 *   { prNumber: 3, decision: 'flag-for-human', reason: 'PR closes no tracked issue', timestamp: 't' },
 * ]);
 * // { total: 3, ciGuardRejections: 1, dedupCollapses: 1, otherFlags: 1 }
 * ```
 */
export function reconcile(entries: SkipLogEntry[]): ReconciliationSummary {
  let ciGuardRejections = 0;
  let dedupCollapses = 0;
  let otherFlags = 0;

  for (const entry of entries) {
    if (entry.reason.includes('CI guard:')) {
      ciGuardRejections++;
    } else if (entry.reason.includes('duplicate of')) {
      dedupCollapses++;
    } else {
      otherFlags++;
    }
  }

  return { total: entries.length, ciGuardRejections, dedupCollapses, otherFlags };
}

/**
 * Formats a `ReconciliationSummary` as a short human-readable report block.
 *
 * @example
 * ```typescript
 * formatReconciliation({ total: 3, ciGuardRejections: 1, dedupCollapses: 1, otherFlags: 1 });
 * // 'Reconciliation: 3 flagged/skipped — 1 CI-guard rejection(s), 1 dedup collapse(s), 1 other'
 * ```
 */
export function formatReconciliation(summary: ReconciliationSummary): string {
  return (
    `Reconciliation: ${summary.total} flagged/skipped — ` +
    `${summary.ciGuardRejections} CI-guard rejection(s), ` +
    `${summary.dedupCollapses} dedup collapse(s), ` +
    `${summary.otherFlags} other`
  );
}

/**
 * Ground-truth check: the fraction of claimed `relatedFiles`/`entities` that do
 * NOT appear anywhere in the PR's real `fileList`. `entities` may legitimately
 * name a module or architectural concept rather than a literal file path, so a
 * nonzero rate is expected and this must stay a reported metric, not a gate.
 *
 * @param claimed  - The distilled draft's `relatedFiles` and/or `entities`.
 * @param fileList - The scraped PR's actual list of changed file paths.
 * @returns A number in [0, 1]; 0 when `claimed` is empty (nothing to hallucinate).
 *
 * @example
 * ```typescript
 * hallucinationRate(['api/a.ts', 'made/up.ts'], ['api/a.ts', 'webapp/b.ts']); // 0.5
 * hallucinationRate([], ['api/a.ts']); // 0
 * ```
 */
export function hallucinationRate(claimed: string[], fileList: string[]): number {
  if (claimed.length === 0) return 0;
  const known = new Set(fileList);
  const unmatched = claimed.filter(c => !known.has(c)).length;
  return unmatched / claimed.length;
}
