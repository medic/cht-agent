import { expect } from 'chai';
import {
  classifyNumber,
  resolveRealIssue,
  GhTransientError,
  ExecFn,
  ClassifyCache,
} from '../../src/scripts/gh-classify';

const REPO = 'medic/cht-core';
const issueUrl = (n: number, repo = REPO) => `https://github.com/${repo}/issues/${n}`;
const repoApiUrl = (repo = REPO) => `https://api.github.com/repos/${repo}`;

interface NumberSpec {
  kind: 'issue' | 'pr' | 'missing' | 'transient';
  repoUrl?: string; // override repository_url (transfer-redirect test)
  closes?: number[]; // for PRs: closingIssuesReferences (same-repo issues)
  closesUrls?: string[]; // for PRs: raw urls (cross-repo test)
}

/** Build a fakeExec dispatching on `gh api repos/<repo>/issues/N` and `gh pr view N ...`. */
function fakeExec(numbers: Record<number, NumberSpec>, counter?: { n: number }): ExecFn {
  return (file, args) => {
    if (counter) counter.n++;
    if (file !== 'gh') throw new Error(`unexpected: ${file}`);

    if (args[0] === 'api' && /^repos\/.+\/issues\/\d+$/.test(args[1])) {
      const num = Number(args[1].split('/').pop());
      const spec = numbers[num];
      if (!spec || spec.kind === 'missing') throw new Error('gh: Not Found (HTTP 404)');
      if (spec.kind === 'transient') throw new Error('HTTP 403: API rate limit exceeded');
      const obj: Record<string, unknown> = {
        number: num,
        repository_url: spec.repoUrl ?? repoApiUrl(),
      };
      if (spec.kind === 'pr') obj.pull_request = { url: `https://api.github.com/repos/${REPO}/pulls/${num}` };
      return JSON.stringify(obj);
    }

    if (args[0] === 'pr' && args[1] === 'view') {
      const num = Number(args[2]);
      const spec = numbers[num] ?? {};
      const refs = (spec.closesUrls ?? (spec.closes ?? []).map(n => issueUrl(n))).map((url, i) => ({
        number: spec.closesUrls ? Number(url.split('/').pop()) : spec.closes![i],
        url,
      }));
      return JSON.stringify({ closingIssuesReferences: refs });
    }

    throw new Error(`unexpected gh call: ${args.join(' ')}`);
  };
}

describe('classifyNumber', () => {
  it('classifies a real issue as "issue"', () => {
    expect(classifyNumber(REPO, 10183, fakeExec({ 10183: { kind: 'issue' } }))).to.equal('issue');
  });

  it('classifies a PR (pull_request key present) as "pr"', () => {
    expect(classifyNumber(REPO, 10182, fakeExec({ 10182: { kind: 'pr' } }))).to.equal('pr');
  });

  it('classifies a 404 as "missing"', () => {
    expect(classifyNumber(REPO, 999999, fakeExec({}))).to.equal('missing');
  });

  it('throws GhTransientError on a 403/rate-limit (never silently "missing")', () => {
    expect(() => classifyNumber(REPO, 10182, fakeExec({ 10182: { kind: 'transient' } }))).to.throw(
      GhTransientError
    );
  });

  it('treats a transferred record (repository_url ≠ probed repo) as "missing"', () => {
    const exec = fakeExec({ 5: { kind: 'issue', repoUrl: repoApiUrl('medic/other-repo') } });
    expect(classifyNumber(REPO, 5, exec)).to.equal('missing');
  });

  it('memoizes via the cache (one gh call per repo#number)', () => {
    const counter = { n: 0 };
    const cache: ClassifyCache = new Map();
    const exec = fakeExec({ 10183: { kind: 'issue' } }, counter);
    classifyNumber(REPO, 10183, exec, cache);
    classifyNumber(REPO, 10183, exec, cache);
    expect(counter.n).to.equal(1);
  });
});

describe('resolveRealIssue', () => {
  it('returns the number itself when it is a real issue', () => {
    expect(resolveRealIssue(REPO, 10183, fakeExec({ 10183: { kind: 'issue' } }))).to.deep.equal({ issue: 10183 });
  });

  it('resolves a PR to its single closing issue (the verified 10182 → 10183 hop)', () => {
    const exec = fakeExec({ 10182: { kind: 'pr', closes: [10183] }, 10183: { kind: 'issue' } });
    expect(resolveRealIssue(REPO, 10182, exec)).to.deep.equal({ issue: 10183 });
  });

  it('flags a PR that closes no issue', () => {
    expect(resolveRealIssue(REPO, 500, fakeExec({ 500: { kind: 'pr', closes: [] } }))).to.deep.equal({
      issue: null,
      reason: 'no-issue',
    });
  });

  it('flags a PR that closes multiple issues', () => {
    const exec = fakeExec({ 600: { kind: 'pr', closes: [601, 602] } });
    expect(resolveRealIssue(REPO, 600, exec)).to.deep.equal({ issue: null, reason: 'multi-issue' });
  });

  it('drops a PR whose only closing-ref is cross-repo, leaving no-issue', () => {
    const exec = fakeExec({
      700: { kind: 'pr', closesUrls: ['https://github.com/medic/cht-conf/issues/5'] },
    });
    expect(resolveRealIssue(REPO, 700, exec)).to.deep.equal({ issue: null, reason: 'no-issue' });
  });

  it('flags a missing number', () => {
    expect(resolveRealIssue(REPO, 999999, fakeExec({}))).to.deep.equal({ issue: null, reason: 'missing' });
  });
});

describe('gh-classify error paths', () => {
  it('throws GhTransientError on an unparseable issues response', () => {
    const exec: ExecFn = () => 'not json';
    expect(() => classifyNumber(REPO, 1, exec)).to.throw(GhTransientError);
  });

  it('throws GhTransientError when a non-Error is thrown (no 404 text)', () => {
    const exec: ExecFn = () => {
      throw 'boom'; // non-Error value
    };
    expect(() => classifyNumber(REPO, 1, exec)).to.throw(GhTransientError);
  });

  it('throws GhTransientError when gh pr view fails while following a PR', () => {
    const exec: ExecFn = (_file, args) => {
      if (args[0] === 'api') return JSON.stringify({ number: 2, repository_url: repoApiUrl(), pull_request: {} });
      throw new Error('HTTP 502 Bad Gateway'); // transient on `gh pr view`
    };
    expect(() => resolveRealIssue(REPO, 2, exec)).to.throw(GhTransientError);
  });

  it('throws GhTransientError on an unparseable gh pr view response', () => {
    const exec: ExecFn = (_file, args) => {
      if (args[0] === 'api') return JSON.stringify({ number: 3, repository_url: repoApiUrl(), pull_request: {} });
      return 'not json';
    };
    expect(() => resolveRealIssue(REPO, 3, exec)).to.throw(GhTransientError);
  });
});
