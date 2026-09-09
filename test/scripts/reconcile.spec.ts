import { expect } from 'chai';
import { reconcile, formatReconciliation, hallucinationRate } from '../../src/scripts/reconcile';
import type { SkipLogEntry } from '../../src/types/pipeline';

/** Minimal valid SkipLogEntry for testing */
function makeEntry(overrides: Partial<SkipLogEntry> = {}): SkipLogEntry {
  return {
    prNumber: 1,
    decision: 'flag-for-human',
    reason: 'some reason',
    timestamp: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('reconcile', () => {
  it('returns all-zero counts for an empty batch', () => {
    expect(reconcile([])).to.deep.equal({ total: 0, ciGuardRejections: 0, dedupCollapses: 0, otherFlags: 0 });
  });

  it('counts a CI-guard rejection using the real open-review-pr prefixed reason', () => {
    // writeSkipEntry in open-review-pr.ts composes `open-review-pr: ${reason} — ${filename}`,
    // so the reason never literally starts with "CI guard:" — it's always prefixed.
    const entries = [
      makeEntry({ reason: 'open-review-pr: CI guard: issueNumber (10198) equals its own source PR number — 10198-fix.md' }),
    ];
    expect(reconcile(entries)).to.deep.equal({ total: 1, ciGuardRejections: 1, dedupCollapses: 0, otherFlags: 0 });
  });

  it('counts a dedup collapse using the real open-review-pr prefixed reason', () => {
    const entries = [
      makeEntry({ reason: 'open-review-pr: duplicate of cht-core-8985 — collapsed into medic/cht-core#9027 (source_prs: medic/cht-core#9027, medic/cht-core#9098) — 9098-fix.md' }),
    ];
    expect(reconcile(entries)).to.deep.equal({ total: 1, ciGuardRejections: 0, dedupCollapses: 1, otherFlags: 0 });
  });

  it('buckets everything else (e.g. bare filter/distiller reasons) as otherFlags', () => {
    const entries = [
      makeEntry({ reason: 'PR closes no tracked issue' }),
      makeEntry({ reason: 'LLM triage skipped' }),
    ];
    expect(reconcile(entries)).to.deep.equal({ total: 2, ciGuardRejections: 0, dedupCollapses: 0, otherFlags: 2 });
  });

  it('tolerates a malformed audit entry without failing the batch', () => {
    const malformed = { ...makeEntry(), reason: null } as unknown as SkipLogEntry;
    expect(reconcile([malformed])).to.deep.equal({ total: 1, ciGuardRejections: 0, dedupCollapses: 0, otherFlags: 1 });
  });

  it('tallies a mixed batch correctly', () => {
    const entries = [
      makeEntry({ reason: 'open-review-pr: CI guard: mislink — a.md' }),
      makeEntry({ reason: 'open-review-pr: CI guard: slug mismatch — b.md' }),
      makeEntry({ reason: 'open-review-pr: duplicate of cht-core-1 — c.md' }),
      makeEntry({ reason: 'PR closes no tracked issue' }),
    ];
    expect(reconcile(entries)).to.deep.equal({ total: 4, ciGuardRejections: 2, dedupCollapses: 1, otherFlags: 1 });
  });
});

describe('formatReconciliation', () => {
  it('renders a one-line summary from the counts', () => {
    const summary = { total: 3, ciGuardRejections: 1, dedupCollapses: 1, otherFlags: 1 };
    const line = formatReconciliation(summary);
    expect(line).to.include('3 flagged/skipped');
    expect(line).to.include('1 CI-guard rejection(s)');
    expect(line).to.include('1 dedup collapse(s)');
    expect(line).to.include('1 other');
  });
});

describe('hallucinationRate', () => {
  it('returns 0 when claimed is empty', () => {
    expect(hallucinationRate([], ['api/a.ts'])).to.equal(0);
  });

  it('returns 0 when every claimed path is in fileList', () => {
    expect(hallucinationRate(['api/a.ts'], ['api/a.ts', 'webapp/b.ts'])).to.equal(0);
  });

  it('returns 1 when no claimed path is in fileList', () => {
    expect(hallucinationRate(['made/up.ts'], ['api/a.ts'])).to.equal(1);
  });

  it('returns the fraction of unmatched claimed paths', () => {
    expect(hallucinationRate(['api/a.ts', 'made/up.ts'], ['api/a.ts', 'webapp/b.ts'])).to.equal(0.5);
  });
});
