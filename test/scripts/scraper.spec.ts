import { expect } from 'chai';
import { ScraperError } from '../../src/types/pipeline';
import { GhTransientError } from '../../src/scripts/gh-classify';
import { stripBoilerplate } from '../../src/scripts/scraper';

// Use require for proxyquire to avoid ESM conflicts
const proxyquire = require('proxyquire').noCallThru();

/**
 * Helper: build a minimal gh mock where execFileSync dispatches on the
 * combination of `file` ('gh') and `args`.
 *
 * Each handler in the map receives the full args array and returns a string.
 * When a handler throws, the throw propagates to the caller.
 */
type ExecHandler = (_file: string, _args: string[]) => string;

function makeExecFileSync(handler: ExecHandler) {
  return (_file: string, args: string[]): string => handler(_file, args);
}

/**
 * Load the scraper module via proxyquire with the provided execFileSync mock.
 */
function loadScraper(execFileSync: ExecHandler) {
  return proxyquire('../../src/scripts/scraper', {
    'node:child_process': { execFileSync: makeExecFileSync(execFileSync) },
  });
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VALID_META = JSON.stringify({
  number: 42,
  title: 'My PR',
  body: 'Fixes #10\n\nSome description.',
  labels: [{ name: 'bug' }, { name: 'enhancement' }],
  mergeCommit: { oid: 'abc123sha' },
  mergedAt: '2024-01-15T12:00:00Z',
  files: [{ path: 'src/foo.ts' }, { path: 'src/bar.ts' }],
  author: { login: 'testuser' },
});

const VALID_DIFF = 'diff --git a/src/foo.ts b/src/foo.ts\n+added line\n';

const VALID_REVIEWS = JSON.stringify([
  { user: { login: 'alice' }, body: 'LGTM', state: 'APPROVED' },
  { user: { login: 'bob' }, body: 'Needs changes', state: 'CHANGES_REQUESTED' },
]);

const VALID_ISSUE_10 = JSON.stringify({
  body: 'Issue body for #10',
  comments: [{ body: 'Comment A' }, { body: 'Comment B' }],
});

// Org membership: alice is a member, bob is not
function defaultExecHandler(_file: string, args: string[]): string {
  const subcommand = args[0];

  if (subcommand === 'pr' && args[1] === 'view') return VALID_META;
  if (subcommand === 'pr' && args[1] === 'diff') return VALID_DIFF;
  if (subcommand === 'api' && args[1].startsWith('repos/') && args[1].endsWith('/reviews'))
    return VALID_REVIEWS;
  if (subcommand === 'api' && args[1].includes('/members/alice')) return ''; // 204 → exit 0
  if (subcommand === 'api' && args[1].includes('/members/bob')) {
    const err = Object.assign(new Error('Not found'), { status: 404 });
    throw err;
  }
  // classifyNumber probe: a plain issue record (no pull_request) in this repo
  if (subcommand === 'api' && /^repos\/.+\/issues\/\d+$/.test(args[1]))
    return JSON.stringify({ repository_url: 'https://api.github.com/repos/medic/cht-core' });
  if (subcommand === 'issue' && args[1] === 'view') return VALID_ISSUE_10;

  throw new Error(`Unexpected gh call: ${args.join(' ')}`);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('scrapePR', () => {
  describe('normal PR with a linked issue', () => {
    it('should return all ScrapedPR fields correctly populated', () => {
      const { scrapePR } = loadScraper(defaultExecHandler);
      const result = scrapePR(42);

      expect(result.prNumber).to.equal(42);
      expect(result.prTitle).to.equal('My PR');
      expect(result.prBody).to.include('Fixes #10');
      expect(result.labels).to.deep.equal(['bug', 'enhancement']);
      expect(result.mergeSha).to.equal('abc123sha');
      expect(result.mergedAt).to.equal('2024-01-15T12:00:00Z');
      expect(result.fileList).to.deep.equal(['src/foo.ts', 'src/bar.ts']);
      expect(result.diff).to.equal(VALID_DIFF);

      expect(result.linkedIssues).to.have.lengthOf(1);
      expect(result.linkedIssues[0].number).to.equal(10);
      expect(result.linkedIssues[0].body).to.equal('Issue body for #10');
      expect(result.linkedIssues[0].comments).to.deep.equal(['Comment A', 'Comment B']);

      expect(result.reviewComments).to.have.lengthOf(2);
      const alice = result.reviewComments.find((r: { author: string }) => r.author === 'alice');
      const bob = result.reviewComments.find((r: { author: string }) => r.author === 'bob');
      expect(alice.isOrgMember).to.equal(true);
      expect(bob.isOrgMember).to.equal(false);
    });
  });

  describe('PR without linked issues', () => {
    it('should return linkedIssues: [] when PR body has no Fixes/Closes/Resolves pattern', () => {
      const noLinksMeta = JSON.stringify({
        number: 7,
        title: 'No links PR',
        body: 'This PR has no linked issues.',
        labels: [],
        mergeCommit: { oid: 'deadbeef' },
        mergedAt: '2024-02-01T00:00:00Z',
        files: [],
      });

      const { scrapePR } = loadScraper((_file, args) => {
        if (args[0] === 'pr' && args[1] === 'view') return noLinksMeta;
        if (args[0] === 'pr' && args[1] === 'diff') return '';
        if (args[0] === 'api' && args[1].startsWith('repos/')) return '[]';
        throw new Error(`Unexpected: ${args.join(' ')}`);
      });

      const result = scrapePR(7);
      expect(result.linkedIssues).to.deep.equal([]);
    });
  });

  describe('base-branch gate', () => {
    function metaWithBase(baseRefName?: string): string {
      return JSON.stringify({
        number: 7,
        title: 'No links PR',
        body: 'This PR has no linked issues.',
        labels: [],
        mergeCommit: { oid: 'deadbeef' },
        mergedAt: '2024-02-01T00:00:00Z',
        files: [],
        ...(baseRefName === undefined ? {} : { baseRefName }),
      });
    }

    function loadWithBase(meta: string, repoView: () => string) {
      return loadScraper((_file, args) => {
        if (args[0] === 'repo' && args[1] === 'view') return repoView();
        if (args[0] === 'pr' && args[1] === 'view') return meta;
        if (args[0] === 'pr' && args[1] === 'diff') return '';
        if (args[0] === 'api' && args[1].startsWith('repos/')) return '[]';
        throw new Error(`Unexpected: ${args.join(' ')}`);
      });
    }

    const DEFAULT_MASTER = () => JSON.stringify({ defaultBranchRef: { name: 'master' } });

    it('scrapes a PR merged into the default branch', () => {
      const { scrapePR } = loadWithBase(metaWithBase('master'), DEFAULT_MASTER);
      expect(scrapePR(7).prNumber).to.equal(7);
    });

    it('throws ScraperError for a PR merged into a feature branch', () => {
      const { scrapePR } = loadWithBase(metaWithBase('10224-ui-extensions'), DEFAULT_MASTER);
      expect(() => scrapePR(7)).to.throw(ScraperError, /non-default branch '10224-ui-extensions'/);
    });

    it('fails open when the default-branch lookup fails', () => {
      const { scrapePR } = loadWithBase(metaWithBase('10224-ui-extensions'), () => {
        throw new Error('gh unavailable');
      });
      expect(scrapePR(7).prNumber).to.equal(7);
    });

    it('skips the gate when metadata carries no baseRefName', () => {
      const { scrapePR } = loadWithBase(metaWithBase(), () => {
        throw new Error('repo view must not be called');
      });
      expect(scrapePR(7).prNumber).to.equal(7);
    });
  });

  describe('linked-issue sources (title scope + closingIssuesReferences)', () => {
    const issueViewByNumber: ExecHandler = (_file, args) =>
      JSON.stringify({ body: `body ${args[2]}`, comments: [] });

    function metaWith(overrides: Record<string, unknown>): string {
      return JSON.stringify({
        number: 8773,
        title: 'My PR',
        body: '',
        labels: [],
        mergeCommit: { oid: 'sha8773' },
        mergedAt: '2024-03-01T00:00:00Z',
        files: [],
        ...overrides,
      });
    }

    function load(meta: string) {
      return loadScraper((_file, args) => {
        if (args[0] === 'pr' && args[1] === 'view') return meta;
        if (args[0] === 'pr' && args[1] === 'diff') return '';
        if (args[0] === 'api' && args[1].startsWith('repos/')) return '[]';
        if (args[0] === 'issue' && args[1] === 'view') return issueViewByNumber(_file, args);
        throw new Error(`Unexpected: ${args.join(' ')}`);
      });
    }

    it('resolves the issue from the PR title scope fix(#N): when the body has no keyword', () => {
      const { scrapePR } = load(metaWith({ title: 'fix(#6299): trigger sync', body: 'no keyword' }));
      const result = scrapePR(8773);
      expect(result.linkedIssues.map((i: { number: number }) => i.number)).to.deep.equal([6299]);
    });

    it('prefers closingIssuesReferences over the body and orders it first', () => {
      const { scrapePR } = load(
        metaWith({
          body: 'Fixes #20',
          closingIssuesReferences: [{ number: 6299, url: 'https://github.com/medic/cht-core/issues/6299' }],
        })
      );
      const result = scrapePR(8773);
      expect(result.linkedIssues.map((i: { number: number }) => i.number)).to.deep.equal([6299, 20]);
    });

    it('drops a cross-repo closingIssuesReferences entry', () => {
      const { scrapePR } = load(
        metaWith({
          body: 'Fixes #20',
          closingIssuesReferences: [{ number: 111, url: 'https://github.com/attacker/foo/issues/111' }],
        })
      );
      const result = scrapePR(8773);
      expect(result.linkedIssues.map((i: { number: number }) => i.number)).to.deep.equal([20]);
    });
  });

  describe('gh non-zero exit on PR metadata fetch', () => {
    it('should throw ScraperError with the correct prNumber', () => {
      const { scrapePR } = loadScraper((_file, args) => {
        if (args[0] === 'pr' && args[1] === 'view') {
          const err = Object.assign(new Error('gh exited with code 1'), { code: 1 });
          throw err;
        }
        throw new Error(`Unexpected: ${args.join(' ')}`);
      });

      let caught: unknown;
      try {
        scrapePR(99);
      } catch (err) {
        caught = err;
      }
      expect(caught).to.be.instanceOf(ScraperError);
      expect((caught as ScraperError).prNumber).to.equal(99);
    });
  });

  describe('non-integer prNumber', () => {
    it('should throw ScraperError immediately without calling execFileSync for NaN', () => {
      let execCalled = false;
      const { scrapePR } = loadScraper((_file, _args) => {
        execCalled = true;
        return '';
      });

      let caught: unknown;
      try {
        scrapePR(NaN);
      } catch (err) {
        caught = err;
      }
      expect(caught).to.be.instanceOf(ScraperError);
      expect(execCalled).to.equal(false);
    });

    it('should throw ScraperError immediately without calling execFileSync for 1.5', () => {
      let execCalled = false;
      const { scrapePR } = loadScraper((_file, _args) => {
        execCalled = true;
        return '';
      });

      let caught: unknown;
      try {
        scrapePR(1.5);
      } catch (err) {
        caught = err;
      }
      expect(caught).to.be.instanceOf(ScraperError);
      expect(execCalled).to.equal(false);
    });
  });

  describe('issue-vs-PR verification (B1)', () => {
    function meta(number: number, over: Record<string, unknown>): string {
      return JSON.stringify({
        number, title: 'My PR', body: '', labels: [],
        mergeCommit: { oid: 'sha' }, mergedAt: '2025-01-01T00:00:00Z', files: [],
        ...over,
      });
    }
    const issueRecord = JSON.stringify({ repository_url: 'https://api.github.com/repos/medic/cht-core' });
    const prRecord = JSON.stringify({ repository_url: 'https://api.github.com/repos/medic/cht-core', pull_request: {} });

    it('follows a title/body PR-number to the issue it closes (10399 → 10182[PR] → 10183)', () => {
      const { scrapePR } = loadScraper((_file, args) => {
        if (args[0] === 'pr' && args[1] === 'view' && args[2] === '10399') return meta(10399, { title: 'fix(#10182): x' });
        if (args[0] === 'pr' && args[1] === 'view' && args[2] === '10182')
          return JSON.stringify({ closingIssuesReferences: [{ number: 10183, url: 'https://github.com/medic/cht-core/issues/10183' }] });
        if (args[0] === 'pr' && args[1] === 'diff') return '';
        if (args[0] === 'api' && args[1].endsWith('/reviews')) return '[]';
        if (args[0] === 'api' && /issues\/10182$/.test(args[1])) return prRecord; // 10182 is a PR
        if (args[0] === 'issue' && args[1] === 'view' && args[2] === '10183')
          return JSON.stringify({ body: 'real issue', comments: [] });
        throw new Error(`Unexpected: ${args.join(' ')}`);
      });
      const result = scrapePR(10399);
      expect(result.linkedIssues.map((i: { number: number }) => i.number)).to.deep.equal([10183]);
    });

    it('keeps a genuine issue as linkedIssues[0] after one verification', () => {
      const { scrapePR } = loadScraper((_file, args) => {
        if (args[0] === 'pr' && args[1] === 'view') return meta(1, { title: 'fix(#6299): x', body: 'Fixes #6299' });
        if (args[0] === 'pr' && args[1] === 'diff') return '';
        if (args[0] === 'api' && args[1].endsWith('/reviews')) return '[]';
        if (args[0] === 'api' && /issues\/\d+$/.test(args[1])) return issueRecord;
        if (args[0] === 'issue' && args[1] === 'view') return JSON.stringify({ body: 'b', comments: [] });
        throw new Error(`Unexpected: ${args.join(' ')}`);
      });
      const result = scrapePR(1);
      expect(result.linkedIssues).to.have.lengthOf(1);
      expect(result.linkedIssues[0].number).to.equal(6299);
    });

    it('fails loud (does not silently drop) on a transient gh error, wrapped as ScraperError', () => {
      const { scrapePR } = loadScraper((_file, args) => {
        if (args[0] === 'pr' && args[1] === 'view') return meta(2, { body: 'Fixes #500' });
        if (args[0] === 'pr' && args[1] === 'diff') return '';
        if (args[0] === 'api' && args[1].endsWith('/reviews')) return '[]';
        if (args[0] === 'api' && /issues\/500$/.test(args[1])) throw new Error('HTTP 403: API rate limit exceeded');
        throw new Error(`Unexpected: ${args.join(' ')}`);
      });
      let caught: unknown;
      try {
        scrapePR(2);
      } catch (err) {
        caught = err;
      }
      expect(caught).to.be.instanceOf(ScraperError); // honors the module's error contract
      expect((caught as { cause?: unknown }).cause).to.be.instanceOf(GhTransientError); // transient signal preserved
    });
  });

  describe('unmerged PR (mergedAt is null)', () => {
    it('should throw ScraperError with message containing "not merged"', () => {
      const unmergedMeta = JSON.stringify({
        number: 5,
        title: 'Open PR',
        body: '',
        labels: [],
        mergeCommit: null,
        mergedAt: null,
        files: [],
      });

      const { scrapePR } = loadScraper((_file, args) => {
        if (args[0] === 'pr' && args[1] === 'view') return unmergedMeta;
        throw new Error(`Unexpected: ${args.join(' ')}`);
      });

      let caught: unknown;
      try {
        scrapePR(5);
      } catch (err) {
        caught = err;
      }
      expect(caught).to.be.instanceOf(ScraperError);
      expect((caught as ScraperError).message).to.include('not merged');
    });
  });

  describe('diff exceeds 50 MB (ENOBUFS)', () => {
    it('should throw ScraperError with message containing "50 MB"', () => {
      const { scrapePR } = loadScraper((_file, args) => {
        if (args[0] === 'pr' && args[1] === 'view') return VALID_META;
        if (args[0] === 'pr' && args[1] === 'diff') {
          const err = Object.assign(new Error('stdout maxBuffer exceeded'), { code: 'ENOBUFS' });
          throw err;
        }
        throw new Error(`Unexpected: ${args.join(' ')}`);
      });

      let caught: unknown;
      try {
        scrapePR(42);
      } catch (err) {
        caught = err;
      }
      expect(caught).to.be.instanceOf(ScraperError);
      expect((caught as ScraperError).message).to.include('50 MB');
    });
  });

  describe('multiple linked issues in PR body (with duplicates)', () => {
    it('should deduplicate and return exactly 2 LinkedIssue entries for Fixes #10, Closes #20, Resolves #10', () => {
      const multiLinkMeta = JSON.stringify({
        number: 3,
        title: 'Multi-link PR',
        body: 'Fixes #10\nCloses #20\nResolves #10',
        labels: [],
        mergeCommit: { oid: 'sha1' },
        mergedAt: '2024-03-01T00:00:00Z',
        files: [],
      });

      const { scrapePR } = loadScraper((_file, args) => {
        if (args[0] === 'pr' && args[1] === 'view') return multiLinkMeta;
        if (args[0] === 'pr' && args[1] === 'diff') return '';
        if (args[0] === 'api' && args[1].startsWith('repos/')) return '[]';
        if (args[0] === 'issue' && args[1] === 'view')
          return JSON.stringify({ body: 'body', comments: [] });
        throw new Error(`Unexpected: ${args.join(' ')}`);
      });

      const result = scrapePR(3);
      expect(result.linkedIssues).to.have.lengthOf(2);
      const nums = result.linkedIssues.map((i: { number: number }) => i.number);
      expect(nums).to.include(10);
      expect(nums).to.include(20);
    });
  });

  describe('case-insensitive linked issue keywords', () => {
    it('should match FIXES and closes and return 2 linked issues', () => {
      const caseBody = 'FIXES #99 and closes #88';
      const caseMeta = JSON.stringify({
        number: 4,
        title: 'Case test',
        body: caseBody,
        labels: [],
        mergeCommit: { oid: 'sha2' },
        mergedAt: '2024-04-01T00:00:00Z',
        files: [],
      });

      const { scrapePR } = loadScraper((_file, args) => {
        if (args[0] === 'pr' && args[1] === 'view') return caseMeta;
        if (args[0] === 'pr' && args[1] === 'diff') return '';
        if (args[0] === 'api' && args[1].startsWith('repos/')) return '[]';
        if (args[0] === 'issue' && args[1] === 'view')
          return JSON.stringify({ body: 'body', comments: [] });
        throw new Error(`Unexpected: ${args.join(' ')}`);
      });

      const result = scrapePR(4);
      expect(result.linkedIssues).to.have.lengthOf(2);
    });
  });

  describe('full GitHub URL linked issues', () => {
    it('should extract issue numbers from full GitHub issue URLs', () => {
      const urlBody = 'Fixes https://github.com/medic/cht-core/issues/11019\nCloses https://github.com/medic/cht-core/issues/11020';
      const urlMeta = JSON.stringify({
        number: 5,
        title: 'URL test',
        body: urlBody,
        labels: [],
        mergeCommit: { oid: 'sha3' },
        mergedAt: '2024-04-01T00:00:00Z',
        files: [],
      });

      const { scrapePR } = loadScraper((_file, args) => {
        if (args[0] === 'pr' && args[1] === 'view') return urlMeta;
        if (args[0] === 'pr' && args[1] === 'diff') return '';
        if (args[0] === 'api' && args[1].startsWith('repos/')) return '[]';
        if (args[0] === 'issue' && args[1] === 'view')
          return JSON.stringify({ body: 'issue body', comments: [] });
        throw new Error(`Unexpected: ${args.join(' ')}`);
      });

      const result = scrapePR(5);
      expect(result.linkedIssues).to.have.lengthOf(2);
      expect(result.linkedIssues.map((i: { number: number }) => i.number)).to.include.members([11019, 11020]);
    });

    it('should deduplicate when bare #NNN and URL form reference the same issue', () => {
      const mixedBody = 'Fixes #11019\nAlso fixes https://github.com/medic/cht-core/issues/11019';
      const mixedMeta = JSON.stringify({
        number: 6,
        title: 'Dedup test',
        body: mixedBody,
        labels: [],
        mergeCommit: { oid: 'sha4' },
        mergedAt: '2024-04-01T00:00:00Z',
        files: [],
      });

      const { scrapePR } = loadScraper((_file, args) => {
        if (args[0] === 'pr' && args[1] === 'view') return mixedMeta;
        if (args[0] === 'pr' && args[1] === 'diff') return '';
        if (args[0] === 'api' && args[1].startsWith('repos/')) return '[]';
        if (args[0] === 'issue' && args[1] === 'view')
          return JSON.stringify({ body: 'issue body', comments: [] });
        throw new Error(`Unexpected: ${args.join(' ')}`);
      });

      const result = scrapePR(6);
      expect(result.linkedIssues).to.have.lengthOf(1);
      expect(result.linkedIssues[0].number).to.equal(11019);
    });
  });

  describe('org membership', () => {
    it('should set isOrgMember: true when org API returns 204 (no throw)', () => {
      const singleReview = JSON.stringify([
        { user: { login: 'carol' }, body: 'Looks great', state: 'APPROVED' },
      ]);
      const simpleMeta = JSON.stringify({
        number: 8,
        title: 'Simple',
        body: '',
        labels: [],
        mergeCommit: { oid: 'sha3' },
        mergedAt: '2024-05-01T00:00:00Z',
        files: [],
      });

      const { scrapePR } = loadScraper((_file, args) => {
        if (args[0] === 'pr' && args[1] === 'view') return simpleMeta;
        if (args[0] === 'pr' && args[1] === 'diff') return '';
        if (args[0] === 'api' && args[1].startsWith('repos/')) return singleReview;
        if (args[0] === 'api' && args[1].includes('/members/carol')) return ''; // 204
        throw new Error(`Unexpected: ${args.join(' ')}`);
      });

      const result = scrapePR(8);
      expect(result.reviewComments[0].isOrgMember).to.equal(true);
    });

    it('should set isOrgMember: false and not throw when org API throws', () => {
      const singleReview = JSON.stringify([
        { user: { login: 'dave' }, body: 'Nice', state: 'APPROVED' },
      ]);
      const simpleMeta = JSON.stringify({
        number: 9,
        title: 'Simple',
        body: '',
        labels: [],
        mergeCommit: { oid: 'sha4' },
        mergedAt: '2024-06-01T00:00:00Z',
        files: [],
      });

      const { scrapePR } = loadScraper((_file, args) => {
        if (args[0] === 'pr' && args[1] === 'view') return simpleMeta;
        if (args[0] === 'pr' && args[1] === 'diff') return '';
        if (args[0] === 'api' && args[1].startsWith('repos/')) return singleReview;
        if (args[0] === 'api' && args[1].includes('/members/dave')) {
          throw Object.assign(new Error('HTTP 404'), { status: 404 });
        }
        throw new Error(`Unexpected: ${args.join(' ')}`);
      });

      let result: ReturnType<typeof scrapePR>;
      expect(() => {
        result = scrapePR(9);
      }).to.not.throw();
      expect(result!.reviewComments[0].isOrgMember).to.equal(false);
    });
  });

  describe('empty diff', () => {
    it('should return diff: "" and not throw', () => {
      const emptyDiffMeta = JSON.stringify({
        number: 11,
        title: 'Empty diff',
        body: '',
        labels: [],
        mergeCommit: { oid: 'sha5' },
        mergedAt: '2024-07-01T00:00:00Z',
        files: [],
      });

      const { scrapePR } = loadScraper((_file, args) => {
        if (args[0] === 'pr' && args[1] === 'view') return emptyDiffMeta;
        if (args[0] === 'pr' && args[1] === 'diff') return '';
        if (args[0] === 'api' && args[1].startsWith('repos/')) return '[]';
        throw new Error(`Unexpected: ${args.join(' ')}`);
      });

      const result = scrapePR(11);
      expect(result.diff).to.equal('');
    });
  });

  describe('empty reviews array', () => {
    it('should return reviewComments: []', () => {
      const noReviewMeta = JSON.stringify({
        number: 12,
        title: 'No reviews',
        body: '',
        labels: [],
        mergeCommit: { oid: 'sha6' },
        mergedAt: '2024-08-01T00:00:00Z',
        files: [],
      });

      const { scrapePR } = loadScraper((_file, args) => {
        if (args[0] === 'pr' && args[1] === 'view') return noReviewMeta;
        if (args[0] === 'pr' && args[1] === 'diff') return '';
        if (args[0] === 'api' && args[1].startsWith('repos/')) return '[]';
        throw new Error(`Unexpected: ${args.join(' ')}`);
      });

      const result = scrapePR(12);
      expect(result.reviewComments).to.deep.equal([]);
    });
  });

  describe('paginated reviews via --slurp', () => {
    it('should flatten an array-of-pages and preserve bodies containing "] ["', () => {
      const meta = JSON.stringify({
        number: 15,
        title: 'Paginated reviews',
        body: '',
        labels: [],
        mergeCommit: { oid: 'sha15' },
        mergedAt: '2024-09-05T00:00:00Z',
        files: [],
      });
      // gh --paginate --slurp returns an array whose elements are each page's
      // response (an array of reviews). A body literally containing "] [" must
      // survive — the old string-stitching merge corrupted exactly this.
      const slurpedReviews = JSON.stringify([
        [{ user: { login: 'alice' }, body: 'see arr[1] [2] note', state: 'APPROVED' }],
        [{ user: { login: 'carol' }, body: 'second page', state: 'COMMENTED' }],
      ]);

      const { scrapePR } = loadScraper((_file, args) => {
        if (args[0] === 'pr' && args[1] === 'view') return meta;
        if (args[0] === 'pr' && args[1] === 'diff') return '';
        if (args[0] === 'api' && args[1].includes('/members/')) return '';
        if (args[0] === 'api' && args[1].startsWith('repos/')) return slurpedReviews;
        throw new Error(`Unexpected: ${args.join(' ')}`);
      });

      const result = scrapePR(15);
      expect(result.reviewComments).to.have.lengthOf(2);
      expect(result.reviewComments[0].body).to.equal('see arr[1] [2] note');
      expect(result.reviewComments.map((r: { author: string }) => r.author)).to.deep.equal(['alice', 'carol']);
    });

    it('should request reviews with --paginate and --slurp', () => {
      let reviewArgs: string[] = [];
      const { scrapePR } = loadScraper((_file, args) => {
        if (args[0] === 'pr' && args[1] === 'view') {
          return JSON.stringify({
            number: 16, title: 't', body: '', labels: [],
            mergeCommit: { oid: 's16' }, mergedAt: '2024-09-06T00:00:00Z', files: [],
          });
        }
        if (args[0] === 'pr' && args[1] === 'diff') return '';
        if (args[0] === 'api' && args[1].startsWith('repos/')) { reviewArgs = args; return '[]'; }
        throw new Error(`Unexpected: ${args.join(' ')}`);
      });

      scrapePR(16);
      expect(reviewArgs).to.include('--paginate');
      expect(reviewArgs).to.include('--slurp');
    });
  });

  describe('linked issue fetch throws (404)', () => {
    it('should drop the unresolvable issue and not throw from scrapePR', () => {
      const linkMeta = JSON.stringify({
        number: 13,
        title: 'Issue fetch fails',
        body: 'Fixes #55',
        labels: [],
        mergeCommit: { oid: 'sha7' },
        mergedAt: '2024-09-01T00:00:00Z',
        files: [],
      });

      const { scrapePR } = loadScraper((_file, args) => {
        if (args[0] === 'pr' && args[1] === 'view') return linkMeta;
        if (args[0] === 'pr' && args[1] === 'diff') return '';
        if (args[0] === 'api' && args[1].startsWith('repos/')) return '[]';
        if (args[0] === 'issue' && args[1] === 'view') {
          throw Object.assign(new Error('Not Found'), { status: 404 });
        }
        throw new Error(`Unexpected: ${args.join(' ')}`);
      });

      let result: ReturnType<typeof scrapePR>;
      expect(() => {
        result = scrapePR(13);
      }).to.not.throw();
      // A reference that can't be fetched must not count as a real linked issue.
      expect(result!.linkedIssues).to.deep.equal([]);
    });

    it('should keep resolvable issues and drop only the failing one', () => {
      const linkMeta = JSON.stringify({
        number: 14,
        title: 'Mixed issue fetch',
        body: 'Fixes #55\nCloses #66',
        labels: [],
        mergeCommit: { oid: 'sha8' },
        mergedAt: '2024-09-02T00:00:00Z',
        files: [],
      });

      const { scrapePR } = loadScraper((_file, args) => {
        if (args[0] === 'pr' && args[1] === 'view') return linkMeta;
        if (args[0] === 'pr' && args[1] === 'diff') return '';
        if (args[0] === 'api' && args[1].startsWith('repos/')) return '[]';
        if (args[0] === 'issue' && args[1] === 'view') {
          if (args[2] === '66') throw Object.assign(new Error('Not Found'), { status: 404 });
          return JSON.stringify({ body: 'issue 55 body', comments: [] });
        }
        throw new Error(`Unexpected: ${args.join(' ')}`);
      });

      const result = scrapePR(14);
      expect(result.linkedIssues).to.have.lengthOf(1);
      expect(result.linkedIssues[0].number).to.equal(55);
    });
  });

  describe('malformed JSON is wrapped in ScraperError', () => {
    it('should throw ScraperError (not a raw SyntaxError) when PR metadata is not valid JSON', () => {
      const { scrapePR } = loadScraper((_file, args) => {
        if (args[0] === 'pr' && args[1] === 'view') return 'not-json{';
        throw new Error(`Unexpected: ${args.join(' ')}`);
      });

      let caught: unknown;
      try {
        scrapePR(21);
      } catch (err) {
        caught = err;
      }
      expect(caught).to.be.instanceOf(ScraperError);
      expect((caught as ScraperError).prNumber).to.equal(21);
    });

    it('should throw ScraperError when reviews JSON is malformed', () => {
      const meta = JSON.stringify({
        number: 22,
        title: 'Bad reviews',
        body: '',
        labels: [],
        mergeCommit: { oid: 'sha9' },
        mergedAt: '2024-09-03T00:00:00Z',
        files: [],
      });

      const { scrapePR } = loadScraper((_file, args) => {
        if (args[0] === 'pr' && args[1] === 'view') return meta;
        if (args[0] === 'pr' && args[1] === 'diff') return '';
        if (args[0] === 'api' && args[1].startsWith('repos/')) return 'broken][';
        throw new Error(`Unexpected: ${args.join(' ')}`);
      });

      let caught: unknown;
      try {
        scrapePR(22);
      } catch (err) {
        caught = err;
      }
      expect(caught).to.be.instanceOf(ScraperError);
      expect((caught as ScraperError).prNumber).to.equal(22);
    });
  });

  describe('diff execFileSync throws non-ENOBUFS error', () => {
    it('should rethrow as ScraperError', () => {
      const { scrapePR } = loadScraper((_file, args) => {
        if (args[0] === 'pr' && args[1] === 'view') return VALID_META;
        if (args[0] === 'pr' && args[1] === 'diff') {
          throw Object.assign(new Error('Connection refused'), { code: 'ECONNREFUSED' });
        }
        throw new Error(`Unexpected: ${args.join(' ')}`);
      });

      let caught: unknown;
      try {
        scrapePR(42);
      } catch (err) {
        caught = err;
      }
      expect(caught).to.be.instanceOf(ScraperError);
      expect((caught as ScraperError).prNumber).to.equal(42);
    });
  });

  describe('PENDING reviews are skipped', () => {
    it('should exclude PENDING reviews from reviewComments', () => {
      const pendingReviewMeta = JSON.stringify({
        number: 14,
        title: 'Pending review',
        body: '',
        labels: [],
        mergeCommit: { oid: 'sha8' },
        mergedAt: '2024-10-01T00:00:00Z',
        files: [],
      });
      const reviewsWithPending = JSON.stringify([
        { user: { login: 'eve' }, body: 'LGTM', state: 'APPROVED' },
        { user: { login: 'frank' }, body: 'Draft review', state: 'PENDING' },
      ]);

      const { scrapePR } = loadScraper((_file, args) => {
        if (args[0] === 'pr' && args[1] === 'view') return pendingReviewMeta;
        if (args[0] === 'pr' && args[1] === 'diff') return '';
        if (args[0] === 'api' && args[1].startsWith('repos/')) return reviewsWithPending;
        if (args[0] === 'api' && args[1].includes('/members/eve')) return '';
        throw new Error(`Unexpected: ${args.join(' ')}`);
      });

      const result = scrapePR(14);
      expect(result.reviewComments).to.have.lengthOf(1);
      expect(result.reviewComments[0].author).to.equal('eve');
    });
  });

  describe('review from a deleted GitHub account (user is null)', () => {
    it('should fall back to the ghost author instead of throwing', () => {
      const meta = JSON.stringify({
        number: 15,
        title: 'Deleted reviewer',
        body: '',
        labels: [],
        mergeCommit: { oid: 'sha15' },
        mergedAt: '2024-10-02T00:00:00Z',
        files: [],
      });
      // GitHub returns user: null for reviews left by since-deleted accounts.
      const reviewsWithNullUser = JSON.stringify([
        { user: null, body: 'Looks fine', state: 'APPROVED' },
      ]);

      const { scrapePR } = loadScraper((_file, args) => {
        if (args[0] === 'pr' && args[1] === 'view') return meta;
        if (args[0] === 'pr' && args[1] === 'diff') return '';
        if (args[0] === 'api' && args[1].startsWith('repos/')) return reviewsWithNullUser;
        if (args[0] === 'api' && args[1].includes('/members/ghost')) return '';
        throw new Error(`Unexpected: ${args.join(' ')}`);
      });

      const result = scrapePR(15);
      expect(result.reviewComments).to.have.lengthOf(1);
      expect(result.reviewComments[0].author).to.equal('ghost');
      expect(result.reviewComments[0].body).to.equal('Looks fine');
    });
  });

  describe('null/undefined fields in API responses (fallback branches)', () => {
    it('should use empty-string/array fallbacks when PR metadata fields are null', () => {
      // Exercises the ?? fallbacks for title, body, labels, mergeCommit, files
      const nullFieldsMeta = JSON.stringify({
        number: 20,
        title: null,
        body: null,
        labels: null,
        mergeCommit: null,
        mergedAt: '2024-11-01T00:00:00Z',
        files: null,
      });

      const { scrapePR } = loadScraper((_file, args) => {
        if (args[0] === 'pr' && args[1] === 'view') return nullFieldsMeta;
        if (args[0] === 'pr' && args[1] === 'diff') return '';
        if (args[0] === 'api' && args[1].startsWith('repos/')) return '[]';
        throw new Error(`Unexpected: ${args.join(' ')}`);
      });

      const result = scrapePR(20);
      expect(result.prTitle).to.equal('');
      expect(result.prBody).to.equal('');
      expect(result.labels).to.deep.equal([]);
      expect(result.mergeSha).to.equal('');
      expect(result.fileList).to.deep.equal([]);
    });

    it('should handle null review body and null issue comments/body', () => {
      // Exercises r.body ?? '' and parsed.comments ?? [] and parsed.body ?? ''
      const metaWithLink = JSON.stringify({
        number: 21,
        title: 'Null bodies',
        body: 'Fixes #30',
        labels: [],
        mergeCommit: { oid: 'sha9' },
        mergedAt: '2024-12-01T00:00:00Z',
        files: [],
      });
      const reviewWithNullBody = JSON.stringify([
        { user: { login: 'grace' }, body: null, state: 'APPROVED' },
      ]);
      const issueWithNullFields = JSON.stringify({ body: null, comments: null });

      const { scrapePR } = loadScraper((_file, args) => {
        if (args[0] === 'pr' && args[1] === 'view') return metaWithLink;
        if (args[0] === 'pr' && args[1] === 'diff') return '';
        if (args[0] === 'api' && args[1].startsWith('repos/') && args[1].endsWith('/reviews'))
          return reviewWithNullBody;
        if (args[0] === 'api' && args[1].includes('/members/grace')) return '';
        if (args[0] === 'api' && /^repos\/.+\/issues\/\d+$/.test(args[1]))
          return JSON.stringify({ repository_url: 'https://api.github.com/repos/medic/cht-core' });
        if (args[0] === 'issue' && args[1] === 'view') return issueWithNullFields;
        throw new Error(`Unexpected: ${args.join(' ')}`);
      });

      const result = scrapePR(21);
      expect(result.reviewComments[0].body).to.equal('');
      expect(result.linkedIssues[0].body).to.equal('');
      expect(result.linkedIssues[0].comments).to.deep.equal([]);
    });

    it('should rethrow non-Error as ScraperError when metadata fetch throws non-Error', () => {
      // Exercises the String(err) path in the metadata catch block
      const { scrapePR } = loadScraper((_file, args) => {
        if (args[0] === 'pr' && args[1] === 'view') {
          throw 'non-error string rejection';
        }
        throw new Error(`Unexpected: ${args.join(' ')}`);
      });

      let caught: unknown;
      try {
        scrapePR(22);
      } catch (err) {
        caught = err;
      }
      expect(caught).to.be.instanceOf(ScraperError);
      expect((caught as ScraperError).message).to.include('non-error string rejection');
    });

    it('should rethrow non-Error as ScraperError when diff fetch throws non-Error', () => {
      // Exercises the String(err) path in the diff catch block (non-ENOBUFS, non-Error)
      const { scrapePR } = loadScraper((_file, args) => {
        if (args[0] === 'pr' && args[1] === 'view') return VALID_META;
        if (args[0] === 'pr' && args[1] === 'diff') {
          throw 'plain string diff error';
        }
        throw new Error(`Unexpected: ${args.join(' ')}`);
      });

      let caught: unknown;
      try {
        scrapePR(42);
      } catch (err) {
        caught = err;
      }
      expect(caught).to.be.instanceOf(ScraperError);
      expect((caught as ScraperError).message).to.include('plain string diff error');
    });

    it('should throw ScraperError when reviews fetch fails', () => {
      // Exercises the reviews fetch error path
      const { scrapePR } = loadScraper((_file, args) => {
        if (args[0] === 'pr' && args[1] === 'view') return VALID_META;
        if (args[0] === 'pr' && args[1] === 'diff') return VALID_DIFF;
        if (args[0] === 'api' && args[1].startsWith('repos/')) {
          throw new Error('Reviews API failed');
        }
        throw new Error(`Unexpected: ${args.join(' ')}`);
      });

      let caught: unknown;
      try {
        scrapePR(42);
      } catch (err) {
        caught = err;
      }
      expect(caught).to.be.instanceOf(ScraperError);
      expect((caught as ScraperError).prNumber).to.equal(42);
    });

    it('should use cached org membership for duplicate reviewers', () => {
      // Exercises the membershipCache.has(author) === true branch (skip re-checking)
      const twoSameAuthorReviews = JSON.stringify([
        { user: { login: 'hank' }, body: 'First review', state: 'APPROVED' },
        { user: { login: 'hank' }, body: 'Second review', state: 'CHANGES_REQUESTED' },
      ]);
      const simpleMeta = JSON.stringify({
        number: 23,
        title: 'Duplicate reviewer',
        body: '',
        labels: [],
        mergeCommit: { oid: 'sha10' },
        mergedAt: '2025-01-01T00:00:00Z',
        files: [],
      });

      let orgCheckCount = 0;
      const { scrapePR } = loadScraper((_file, args) => {
        if (args[0] === 'pr' && args[1] === 'view') return simpleMeta;
        if (args[0] === 'pr' && args[1] === 'diff') return '';
        if (args[0] === 'api' && args[1].startsWith('repos/')) return twoSameAuthorReviews;
        if (args[0] === 'api' && args[1].includes('/members/hank')) {
          orgCheckCount++;
          return '';
        }
        throw new Error(`Unexpected: ${args.join(' ')}`);
      });

      const result = scrapePR(23);
      // Two reviews from same author — org check must only fire once
      expect(orgCheckCount).to.equal(1);
      expect(result.reviewComments).to.have.lengthOf(2);
    });
  });
});

describe('stripBoilerplate', () => {
  it('removes an HTML comment block', () => {
    expect(stripBoilerplate('<!-- PHI warning -->\nActual content')).to.equal('Actual content');
  });

  it('removes a multi-line HTML comment', () => {
    const input = '<!--\nDo not include PHI\nin this report\n-->\nReal body text here.';
    expect(stripBoilerplate(input)).to.equal('Real body text here.');
  });

  it('leaves text with no comments untouched (aside from trimming)', () => {
    expect(stripBoilerplate('Just a plain PR body.')).to.equal('Just a plain PR body.');
  });

  it('removes multiple comments in the same body', () => {
    const input = '<!-- a -->Keep this<!-- b -->and this<!-- c -->';
    expect(stripBoilerplate(input)).to.equal('Keep thisand this');
  });
});
