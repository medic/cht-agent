import { expect } from 'chai';
import {
  parseTitleIssue,
  collectLinkedIssueRefs,
  sameRepoClosingRefs,
  });
});

describe('collectLinkedIssueRefs', () => {
  const REPO = 'medic/cht-core';

  it('orders sources closing-ref > title > body and tags provenance', () => {
    const refs = collectLinkedIssueRefs('feat(#20): x', 'Fixes #30', [{ number: 6299 }], REPO);
    expect(refs).to.deep.equal([
      { number: 6299, source: 'closing-ref' },
      { number: 20, source: 'title' },
      { number: 30, source: 'body' },
    ]);
  });

  it('dedupes a number appearing in multiple sources, keeping the most authoritative', () => {
    const refs = collectLinkedIssueRefs('fix(#6299): x', 'Fixes #6299', [{ number: 6299 }], REPO);
    expect(refs).to.deep.equal([{ number: 6299, source: 'closing-ref' }]);
  });

  it('rejects non-positive and non-integer numbers', () => {
    const refs = collectLinkedIssueRefs('', '', [
      { number: 0 },
      { number: -3 },
      { number: NaN as unknown as number },
      { number: 5 },
    ], REPO);
    expect(refs).to.deep.equal([{ number: 5, source: 'closing-ref' }]);
  });

  it('caps the result at MAX_LINKED_ISSUES to bound gh fan-out', () => {
    const body = Array.from({ length: MAX_LINKED_ISSUES + 5 }, (_v, i) => `Fixes #${i + 1}`).join('\n');
    const refs = collectLinkedIssueRefs('', body, [], REPO);
    expect(refs).to.have.lengthOf(MAX_LINKED_ISSUES);
  });

  it('returns an empty array when no source yields an issue', () => {
    expect(collectLinkedIssueRefs('My PR', 'no references here', [], REPO)).to.deep.equal([]);
  });

  it('drops a cross-repo body issue URL, keeps a same-repo URL and a bare #N', () => {
    const body = [
      'Closes https://github.com/medic/cht-conf/issues/5',   // cross-repo — dropped
      'Fixes https://github.com/medic/cht-core/issues/42',   // same-repo URL — kept
      'Resolves #7',                                          // bare — same-repo
    ].join('\n');
    const refs = collectLinkedIssueRefs('', body, [], REPO);
    expect(refs.map(r => r.number)).to.deep.equal([42, 7]);
  });
});

describe('sameRepoClosingRefs', () => {
  it('keeps same-repo sidebar links and drops cross-repo / crafted-path ones', () => {
    const meta = {
      closingIssuesReferences: [
        { number: 6299, url: 'https://github.com/medic/cht-core/issues/6299' },
        { number: 111, url: 'https://github.com/attacker/foo/issues/111' }, // other repo
        { number: 1, url: 'https://github.com/attacker/medic/cht-core/issues/1' }, // crafted path — must NOT pass
        { number: 9999 }, // no url
      ],
    };
    expect(sameRepoClosingRefs(meta, 'medic/cht-core')).to.deep.equal([{ number: 6299, url: 'https://github.com/medic/cht-core/issues/6299' }]);
  });

  it('returns [] when closingIssuesReferences is missing or not an array', () => {
    expect(sameRepoClosingRefs({}, 'medic/cht-core')).to.deep.equal([]);
    expect(sameRepoClosingRefs({ closingIssuesReferences: 'nope' }, 'medic/cht-core')).to.deep.equal([]);
  });
});
