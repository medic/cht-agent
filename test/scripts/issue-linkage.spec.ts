import { expect } from 'chai';
import {
  parseTitleIssue,
  collectLinkedIssueRefs,
  MAX_LINKED_ISSUES,
} from '../../src/scripts/issue-linkage';

describe('parseTitleIssue', () => {
  it('extracts the issue from a conventional type(#N): scope', () => {
    expect(parseTitleIssue('fix(#6299): trigger sync')).to.equal(6299);
    expect(parseTitleIssue('feat(#111): wire thing')).to.equal(111);
    expect(parseTitleIssue('chore(#1)!: breaking')).to.equal(1);
  });

  it('returns null for shapes that are not a strict (#N) scope', () => {
    expect(parseTitleIssue('chore!: no scope')).to.equal(null);
    expect(parseTitleIssue('My PR title')).to.equal(null);
    expect(parseTitleIssue('chore(deps #123): incidental')).to.equal(null);
    expect(parseTitleIssue('feat(api,#5): multi-token scope')).to.equal(null);
    expect(parseTitleIssue('Fix #5 in the thing')).to.equal(null); // bare prose
    expect(parseTitleIssue('build(#0): zero is not a valid issue')).to.equal(null);
  });
});

describe('collectLinkedIssueRefs', () => {
  it('orders sources closing-ref > title > body and tags provenance', () => {
    const refs = collectLinkedIssueRefs('feat(#20): x', 'Fixes #30', [{ number: 6299 }]);
    expect(refs).to.deep.equal([
      { number: 6299, source: 'closing-ref' },
      { number: 20, source: 'title' },
      { number: 30, source: 'body' },
    ]);
  });

  it('dedupes a number appearing in multiple sources, keeping the most authoritative', () => {
    const refs = collectLinkedIssueRefs('fix(#6299): x', 'Fixes #6299', [{ number: 6299 }]);
    expect(refs).to.deep.equal([{ number: 6299, source: 'closing-ref' }]);
  });

  it('rejects non-positive and non-integer numbers', () => {
    const refs = collectLinkedIssueRefs('', '', [
      { number: 0 },
      { number: -3 },
      { number: NaN as unknown as number },
      { number: 5 },
    ]);
    expect(refs).to.deep.equal([{ number: 5, source: 'closing-ref' }]);
  });

  it('caps the result at MAX_LINKED_ISSUES to bound gh fan-out', () => {
    const body = Array.from({ length: MAX_LINKED_ISSUES + 5 }, (_v, i) => `Fixes #${i + 1}`).join('\n');
    const refs = collectLinkedIssueRefs('', body, []);
    expect(refs).to.have.lengthOf(MAX_LINKED_ISSUES);
  });

  it('returns an empty array when no source yields an issue', () => {
    expect(collectLinkedIssueRefs('My PR', 'no references here', [])).to.deep.equal([]);
  });
});
