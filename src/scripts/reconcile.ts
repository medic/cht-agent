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

function bucket(reason: unknown): keyof Omit<ReconciliationSummary, 'total'> {
  if (typeof reason !== 'string') return 'otherFlags';
  if (reason.includes('CI guard:')) return 'ciGuardRejections';
  return reason.includes('duplicate of') ? 'dedupCollapses' : 'otherFlags';
}

/** Summarize a batch of `_skipped.ndjson` entries. */
export function reconcile(entries: SkipLogEntry[]): ReconciliationSummary {
  const summary: ReconciliationSummary = { total: entries.length, ciGuardRejections: 0, dedupCollapses: 0, otherFlags: 0 };
  for (const entry of entries) summary[bucket(entry.reason)]++;
  return summary;
}

/** Format a reconciliation summary for console output. */
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
 */
export function hallucinationRate(claimed: string[], fileList: string[]): number {
  if (claimed.length === 0) return 0;
  const known = new Set(fileList);
  const unmatched = claimed.filter(c => !known.has(c)).length;
  return unmatched / claimed.length;
}
