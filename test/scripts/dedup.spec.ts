import { expect } from 'chai';
import {
  sourcePrNumber,
  issueEqualsSourcePr,
  slugIssueNumber,
  slugContradictsIssueNumber,
  ciGuardReason,
  dedupeByIssueId,
  DedupEntry,
} from '../../src/scripts/dedup';

describe('sourcePrNumber', () => {
  it('parses the PR number from an owner/repo#number ref', () => {
    expect(sourcePrNumber('medic/cht-core#42')).to.equal(42);
  });

  it('returns null for a non-string value', () => {
    expect(sourcePrNumber(undefined)).to.equal(null);
  });

  it('returns null when there is no trailing #number', () => {
    expect(sourcePrNumber('medic/cht-core')).to.equal(null);
  });
});

describe('issueEqualsSourcePr', () => {
  it('is true when issueNumber equals its own source PR number', () => {
    expect(issueEqualsSourcePr({ issueNumber: 10198, source_pr: 'medic/cht-core#10198' })).to.equal(true);
  });

  it('is false when they differ', () => {
    expect(issueEqualsSourcePr({ issueNumber: 8026, source_pr: 'medic/cht-core#10198' })).to.equal(false);
  });

  it('is false when issueNumber is missing', () => {
    expect(issueEqualsSourcePr({ source_pr: 'medic/cht-core#10198' })).to.equal(false);
  });
});

describe('slugIssueNumber', () => {
  it('extracts the issue number embedded by a type(#N) title slug', () => {
    expect(slugIssueNumber('10043-feat10036-add-thing.md')).to.equal(10036);
  });

  it('returns null when the slug has no such prefix', () => {
    expect(slugIssueNumber('10043-fix-a-typo.md')).to.equal(null);
  });

  it('extracts the issue number from the new hyphen-separated slug format', () => {
    expect(slugIssueNumber('10043-feat-10036-add-thing.md')).to.equal(10036);
  });
});

describe('slugContradictsIssueNumber', () => {
  it('is false when the slug-embedded number matches frontmatter', () => {
    expect(slugContradictsIssueNumber('10043-feat10036-add-thing.md', { issueNumber: 10036 })).to.equal(false);
  });

  it('is true when they differ', () => {
    expect(slugContradictsIssueNumber('10043-feat10036-add-thing.md', { issueNumber: 10043 })).to.equal(true);
  });

  it('is false when the slug carries no embedded number', () => {
    expect(slugContradictsIssueNumber('10043-fix-a-typo.md', { issueNumber: 10043 })).to.equal(false);
  });
});

describe('ciGuardReason', () => {
  it('rejects a draft whose issueNumber aliases its own source PR', () => {
    const reason = ciGuardReason('10198-fix.md', { issueNumber: 10198, source_pr: 'medic/cht-core#10198' });
    expect(reason).to.include('equals its own source PR number');
  });

  it('rejects a draft whose filename slug contradicts its frontmatter issueNumber', () => {
    const reason = ciGuardReason('10043-feat10036-add-thing.md', {
      issueNumber: 10099,
      source_pr: 'medic/cht-core#10043',
    });
    expect(reason).to.include('filename slug implies issue #10036');
  });

  it('passes a correctly-resolved draft', () => {
    const reason = ciGuardReason('10043-feat10036-add-thing.md', {
      issueNumber: 10036,
      source_pr: 'medic/cht-core#10043',
    });
    expect(reason).to.equal(null);
  });
});

describe('dedupeByIssueId', () => {
  function entry(domain: string, path: string, id: string, sourcePr?: string): DedupEntry {
    const fm: Record<string, unknown> = { id };
    if (sourcePr !== undefined) fm.source_pr = sourcePr;
    return { domain, path, frontmatter: fm };
  }

  it('keeps a single draft unchanged', () => {
    const { kept, dropped } = dedupeByIssueId([entry('data-sync', 'a.md', 'cht-core-8985', 'medic/cht-core#9027')]);
    expect(kept).to.have.length(1);
    expect(dropped).to.have.length(0);
    expect(kept[0].frontmatter.source_prs).to.equal(undefined);
  });

  it('collapses a backport pair into the lowest-numbered PR, tagging source_prs', () => {
    const backport = entry('data-sync', 'backport.md', 'cht-core-8985', 'medic/cht-core#9098');
    const original = entry('data-sync', 'original.md', 'cht-core-8985', 'medic/cht-core#9027');
    const { kept, dropped } = dedupeByIssueId([backport, original]);

    expect(kept).to.have.length(1);
    expect(kept[0].path).to.equal('original.md');
    expect(kept[0].frontmatter.source_prs).to.deep.equal(['medic/cht-core#9027', 'medic/cht-core#9098']);
    expect(dropped).to.have.length(1);
    expect(dropped[0].path).to.equal('backport.md');
    expect(dropped[0].reason).to.include('cht-core-8985');
  });

  it('collapses cross-domain duplicates, keeping the canonical domain', () => {
    const inContacts = entry('contacts', 'contacts.md', 'cht-core-9835', 'medic/cht-core#10001');
    const inAuth = entry('authentication', 'auth.md', 'cht-core-9835', 'medic/cht-core#10050');
    const { kept, dropped } = dedupeByIssueId([inAuth, inContacts]);

    expect(kept).to.have.length(1);
    expect(kept[0].domain).to.equal('contacts');
    expect(dropped.map(d => d.path)).to.deep.equal(['auth.md']);
  });

  it('collapses a multi-PR epic to one canonical draft', () => {
    const entries = [
      entry('tasks-and-targets', 'p1.md', 'cht-core-10792', 'medic/cht-core#10799'),
      entry('tasks-and-targets', 'p2.md', 'cht-core-10792', 'medic/cht-core#10793'),
      entry('tasks-and-targets', 'p3.md', 'cht-core-10792', 'medic/cht-core#10798'),
    ];
    const { kept, dropped } = dedupeByIssueId(entries);
    expect(kept).to.have.length(1);
    expect(kept[0].path).to.equal('p2.md');
    expect(dropped).to.have.length(2);
  });

  it('uses alphabetical path tiebreaker when both entries lack source_pr', () => {
    const a = { domain: 'data-sync', path: 'b.md', frontmatter: { id: 'cht-core-1' } };
    const b = { domain: 'data-sync', path: 'a.md', frontmatter: { id: 'cht-core-1' } };
    const { kept, dropped } = dedupeByIssueId([a, b]);
    expect(kept).to.have.length(1);
    expect(kept[0].path).to.equal('a.md');
    expect(dropped).to.have.length(1);
    expect(dropped[0].path).to.equal('b.md');
  });

  it('uses alphabetical path tiebreaker when both entries have the same source_pr', () => {
    const a = entry('data-sync', 'b.md', 'cht-core-2', 'medic/cht-core#500');
    const b = entry('data-sync', 'a.md', 'cht-core-2', 'medic/cht-core#500');
    const { kept, dropped } = dedupeByIssueId([a, b]);
    expect(kept).to.have.length(1);
    expect(kept[0].path).to.equal('a.md');
    expect(dropped).to.have.length(1);
    expect(dropped[0].path).to.equal('b.md');
  });

  it('picks the lowest source PR even when others are sourceless', () => {
    const withSrc = entry('data-sync', 'b.md', 'cht-core-3', 'medic/cht-core#100');
    const noSrcA = { domain: 'data-sync', path: 'a.md', frontmatter: { id: 'cht-core-3' } };
    const noSrcB = { domain: 'data-sync', path: 'c.md', frontmatter: { id: 'cht-core-3' } };
    const { kept, dropped } = dedupeByIssueId([noSrcA, withSrc, noSrcB]);
    expect(kept).to.have.length(1);
    expect(kept[0].path).to.equal('b.md');
    expect(dropped).to.have.length(2);
  });

  it('uses alphabetical tiebreaker when duplicate drafts share the same source PR number', () => {
    const a = entry('data-sync', 'a.md', 'cht-core-8985', 'medic/cht-core#9027');
    const b = entry('data-sync', 'b.md', 'cht-core-8985', 'medic/cht-core#9027');
    const { kept, dropped } = dedupeByIssueId([b, a]);

    expect(kept).to.have.length(1);
    expect(kept[0].path).to.equal('a.md');
    expect(dropped).to.have.length(1);
    expect(dropped[0].path).to.equal('b.md');
  });

  it('uses alphabetical tiebreaker when duplicate drafts both lack source_pr', () => {
    const a = entry('data-sync', 'a.md', 'cht-core-8985');
    const b = entry('data-sync', 'b.md', 'cht-core-8985');
    const { kept, dropped } = dedupeByIssueId([b, a]);

    expect(kept).to.have.length(1);
    expect(kept[0].path).to.equal('a.md');
    expect(dropped).to.have.length(1);
    expect(dropped[0].path).to.equal('b.md');
  });
});
