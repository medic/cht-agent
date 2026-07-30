import { expect } from 'chai';
import * as os from 'os';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { verifyDrafts, formatReport, Finding, ExecFn } from '../../src/scripts/verify-drafts';
import { levenshtein, nearMiss, loadVocab, buildVocab, VocabFamily } from '../../src/scripts/vocab';

const FIXTURE_DIR = path.join(__dirname, '..', 'fixtures', 'drafts');

/** Findings of one check, by fixture basename. */
const checksFor = (findings: Finding[], file: string): string[] =>
  findings.filter(f => path.basename(f.file) === file).map(f => f.check);

const has = (findings: Finding[], file: string, check: string): boolean =>
  checksFor(findings, file).includes(check);

/** Write drafts into a throwaway `<tmp>/agent-memory` and return that path. */
function tmpCorpus(drafts: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-drafts-'));
  const dir = path.join(root, 'agent-memory');
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(drafts)) {
    fs.writeFileSync(path.join(dir, name), content, 'utf8');
  }
  return dir;
}

/** Minimal schema-valid frontmatter, with overrides appended verbatim. */
function draft(issue: number, extra: string[] = [], body = 'Body.'): string {
  return [
    '---',
    `id: cht-core-${issue}`,
    'category: bug',
    'domain: messaging',
    `issueNumber: ${issue}`,
    `issueUrl: https://github.com/medic/cht-core/issues/${issue}`,
    `title: Draft ${issue}`,
    'lastUpdated: 2026-07-27',
    'summary: A summary.',
    'services:',
    '  - api',
    'techStack:',
    '  - nodejs',
    ...extra,
    '---',
    '',
    body,
    '',
  ].join('\n');
}

const REPO_API = 'https://api.github.com/repos/medic/cht-core';

/** gh double: `issues/N` distinguishes issue / pr / missing / transient. */
function fakeGh(reg: {
  issues?: number[];
  prs?: number[];
  transient?: number[];
  /** Titles served for the gloss-mismatch check. */
  titles?: Record<number, string>;
}): ExecFn {
  const issues = new Set(reg.issues ?? []);
  const prs = new Set(reg.prs ?? []);
  const transient = new Set(reg.transient ?? []);
  const title = (n: number): Record<string, string> =>
    reg.titles?.[n] ? { title: reg.titles[n] } : {};
  return (file, args) => {
    if (file === 'git') throw new Error('git not stubbed in this test');
    if (file !== 'gh') throw new Error(`unexpected command: ${file}`);
    const n = Number(args[1].split('/').pop());
    if (transient.has(n)) throw new Error('HTTP 403: API rate limit exceeded');
    if (prs.has(n)) return JSON.stringify({ repository_url: REPO_API, pull_request: {}, ...title(n) });
    if (issues.has(n)) return JSON.stringify({ repository_url: REPO_API, ...title(n) });
    throw new Error('gh: Not Found (HTTP 404)');
  };
}

describe('vocab', () => {
  describe('levenshtein', () => {
    it('is zero for identical strings', () => {
      expect(levenshtein('doc_by_type', 'doc_by_type', 2)).to.equal(0);
    });

    it('measures the real near-miss pairs the reviewer found', () => {
      expect(levenshtein('docs_by_type', 'doc_by_type', 2)).to.equal(1);
      expect(levenshtein('con_create_people', 'can_create_people', 2)).to.equal(1);
      expect(levenshtein('task.status', 'task.state', 2)).to.equal(2);
    });

    it('abandons past the limit rather than computing the true distance', () => {
      expect(levenshtein('completely', 'different', 2)).to.equal(3);
    });

    it('short-circuits on a length gap wider than the limit', () => {
      expect(levenshtein('a', 'aaaaaaaa', 2)).to.equal(3);
    });
  });

  describe('nearMiss', () => {
    const family: VocabFamily = {
      name: 'permission',
      description: 'test',
      candidatePattern: '\\bcan_[a-z_]+\\b',
      maxDistance: 2,
      terms: ['can_create_people', 'can_edit_places'],
    };

    it('returns null for a term that really exists', () => {
      expect(nearMiss('can_create_people', family)).to.equal(null);
    });

    it('returns the closest real term for a fabricated near-miss', () => {
      expect(nearMiss('con_create_people', family)).to.equal('can_create_people');
    });

    it('returns null for a token too far from anything to be a typo', () => {
      expect(nearMiss('totally_unrelated_symbol', family)).to.equal(null);
    });
  });

  describe('the committed snapshot', () => {
    it('contains the real symbols and not the fabricated ones', () => {
      const vocab = loadVocab();
      const terms = (name: string) => vocab.families.find(f => f.name === name)?.terms ?? [];
      expect(terms('permission')).to.include('can_create_people');
      expect(terms('permission')).to.not.include('con_create_people');
      expect(terms('couch-view')).to.include('doc_by_type');
      expect(terms('couch-view')).to.not.include('docs_by_type');
      expect(terms('task-field')).to.include('task.state');
      expect(terms('task-field')).to.not.include('task.status');
    });

    it('does not read a longer dotted key as a fabricated task field', () => {
      // `task.list.complete` is a real translation key; matching its `task.list`
      // prefix reported it as a fabricated field on a correct draft.
      const family = loadVocab().families.find(f => f.name === 'task-field');
      const re = new RegExp(family!.candidatePattern, 'g');
      expect([...'renders task.list.complete above'.matchAll(re)].map(m => m[0])).to.deep.equal([]);
      // a sentence-ending period must still leave a real field detectable
      expect([...'the field is task.status.'.matchAll(re)].map(m => m[0])).to.deep.equal(['task.status']);
    });

    it('records the cht-core commit it was mined from', () => {
      expect(loadVocab().sha).to.match(/^[0-9a-f]{40}$/);
    });
  });

  describe('buildVocab', () => {
    const gitDouble = (out: Record<string, string>, fail?: { status: number }): ExecFn =>
      (file, args) => {
        expect(file).to.equal('git');
        if (args.includes('rev-parse')) return 'abc123\n';
        if (fail) throw Object.assign(new Error('git grep failed'), fail);
        const pattern = args[args.indexOf('-hoE') + 1];
        return out[pattern] ?? '';
      };

    it('mines, dedupes and sorts terms per family', () => {
      const vocab = buildVocab('/fake', 'medic/cht-core', gitDouble({
        '\\bcan_[a-z][a-z_]{2,}\\b': 'can_edit_places\ncan_create_people\ncan_create_people\n',
      }));
      const permission = vocab.families.find(f => f.name === 'permission');
      expect(permission?.terms).to.deep.equal(['can_create_people', 'can_edit_places']);
      expect(vocab.sha).to.equal('abc123');
    });

    it('treats git-grep exit 1 as an empty family', () => {
      const vocab = buildVocab('/fake', 'medic/cht-core', gitDouble({}, { status: 1 }));
      expect(vocab.families.every(f => f.terms.length === 0)).to.equal(true);
    });

    it('throws on a fatal git-grep failure instead of yielding an empty family', () => {
      // An empty family silently disables its whole check while still reporting success.
      expect(() => buildVocab('/fake', 'medic/cht-core', gitDouble({}, { status: 128 })))
        .to.throw(/mining family "permission" failed \(git grep exit 128\)/);
    });
  });
});

describe('verifyDrafts', () => {
  describe('over the committed defect corpus', () => {
    const report = verifyDrafts({ dir: FIXTURE_DIR });

    it('scans every draft and skips only allowlisted prose', () => {
      expect(report.skipped.map(f => path.basename(f))).to.deep.equal(['README.md']);
      expect(report.scanned).to.be.greaterThan(5);
    });

    it('catches a draft keyed to its own merge PR', () => {
      expect(has(report.findings, '8773-fix8773-identity-alias.md', 'identity-alias')).to.equal(true);
    });

    it('catches id / issueNumber / issueUrl disagreeing', () => {
      const checks = checksFor(report.findings, 'invalid-identity-incoherent.md');
      expect(checks.filter(c => c === 'identity-incoherent')).to.have.lengthOf(2);
    });

    it('catches a filename issue token contradicting the frontmatter', () => {
      expect(has(report.findings, '9955-feat9760-filename-mismatch.md', 'filename-issue-mismatch')).to.equal(true);
    });

    it('does NOT invent a mismatch for the tokenless <pr>-<type>-<slug> filename form', () => {
      expect(checksFor(report.findings, '10555-feat-add-pt-br-translations.md')).to.deep.equal([]);
    });

    it('catches each fabricated near-miss symbol the reviewer found', () => {
      expect(has(report.findings, 'invalid-permission-near-miss.md', 'vocab-near-miss')).to.equal(true);
      expect(has(report.findings, 'invalid-view-near-miss.md', 'vocab-near-miss')).to.equal(true);
      expect(has(report.findings, 'invalid-task-field-near-miss.md', 'vocab-near-miss')).to.equal(true);
    });

    it('names the real symbol in the near-miss message', () => {
      const f = report.findings.find(x =>
        path.basename(x.file) === 'invalid-permission-near-miss.md' && x.check === 'vocab-near-miss');
      expect(f?.message).to.contain('can_create_people');
      expect(f?.line).to.be.a('number');
    });

    it('catches both halves of a duplicate cluster', () => {
      expect(has(report.findings, 'dup-cluster-a.md', 'duplicate-issue')).to.equal(true);
      expect(has(report.findings, 'dup-cluster-b.md', 'duplicate-issue')).to.equal(true);
    });

    it('flags classifier scaffolding as a warning, not a blocker', () => {
      const leaks = report.findings.filter(f =>
        path.basename(f.file) === 'invalid-process-leakage.md' && f.check === 'process-leakage');
      expect(leaks.length).to.be.greaterThan(0);
      expect(leaks.every(f => f.severity === 'warning')).to.equal(true);
    });

    it('reports a non-allowlisted file with no frontmatter', () => {
      expect(has(report.findings, 'invalid-missing-frontmatter.md', 'missing-frontmatter')).to.equal(true);
    });

    it('reports nothing against the clean baseline draft', () => {
      expect(checksFor(report.findings, 'valid-baseline.md')).to.deep.equal([]);
    });
  });

  describe('malformed input', () => {
    it('reports unparseable frontmatter instead of throwing', () => {
      const dir = tmpCorpus({ 'broken.md': '---\ntitle: "unterminated\n  bad: [\n---\n\nBody.\n' });
      const report = verifyDrafts({ dir });
      expect(report.findings.some(f => f.check === 'unparseable-frontmatter')).to.equal(true);
    });
  });

  describe('distribution lints', () => {
    it('flags a corpus whose every draft self-reports a strong domain fit', () => {
      const drafts: Record<string, string> = {};
      for (let i = 0; i < 12; i++) {
        drafts[`d${i}.md`] = draft(9000 + i, ['domainFit: strong', 'related_issues: []']);
      }
      const report = verifyDrafts({ dir: tmpCorpus(drafts) });
      const checks = report.findings.filter(f => f.file === '(corpus)').map(f => f.check);
      expect(checks).to.include.members(['uniform-domain-fit', 'related-issues-empty']);
      expect(report.findings.filter(f => f.file === '(corpus)').every(f => f.severity === 'warning')).to.equal(true);
    });

    it('stays quiet when at least one draft reports a weak fit', () => {
      const drafts: Record<string, string> = {};
      for (let i = 0; i < 12; i++) {
        drafts[`d${i}.md`] = draft(9100 + i, [`domainFit: ${i === 0 ? 'weak' : 'strong'}`]);
      }
      const report = verifyDrafts({ dir: tmpCorpus(drafts) });
      expect(report.findings.some(f => f.check === 'uniform-domain-fit')).to.equal(false);
    });
  });

  describe('--online issue-vs-PR check', () => {
    it('blocks when issueNumber is really a pull request', () => {
      const dir = tmpCorpus({ 'a.md': draft(10082) });
      const report = verifyDrafts({ dir, online: true, exec: fakeGh({ prs: [10082] }) });
      expect(report.findings.some(f => f.check === 'issue-number-is-pr')).to.equal(true);
      expect(report.unverified).to.equal(0);
    });

    it('passes when issueNumber is a real issue', () => {
      const dir = tmpCorpus({ 'a.md': draft(10068) });
      const report = verifyDrafts({ dir, online: true, exec: fakeGh({ issues: [10068] }) });
      expect(report.findings.some(f => f.check === 'issue-number-is-pr')).to.equal(false);
    });

    it('blocks when the number does not exist in the repo', () => {
      const dir = tmpCorpus({ 'a.md': draft(137) });
      const report = verifyDrafts({ dir, online: true, exec: fakeGh({}) });
      const f = report.findings.find(x => x.check === 'issue-number-is-pr');
      expect(f?.message).to.contain('does not exist');
    });

    it('counts a throttled lookup as unverified rather than a pass or a defect', () => {
      const dir = tmpCorpus({ 'a.md': draft(10082) });
      const report = verifyDrafts({ dir, online: true, exec: fakeGh({ transient: [10082] }) });
      expect(report.findings.some(f => f.check === 'issue-number-is-pr')).to.equal(false);
      expect(report.unverified).to.equal(1);
    });

    it('makes no network call when online is off', () => {
      const dir = tmpCorpus({ 'a.md': draft(10082) });
      const exploding: ExecFn = () => { throw new Error('should not be called'); };
      expect(() => verifyDrafts({ dir, exec: exploding })).to.not.throw();
    });
  });

  describe('--online Related Issues cross-references', () => {
    const withRefs = (refs: string[]): string =>
      draft(9000, [], ['## Related Issues', '', ...refs, ''].join('\n'));

    it('blocks a gloss that describes a different issue than the one cited', () => {
      // The 10802 defect: #10754 is a cookie bug, glossed as a scheduling issue.
      const dir = tmpCorpus({ 'a.md': withRefs(['- #10754: Scheduled task duplicate processing (similar issue)']) });
      const report = verifyDrafts({
        dir, online: true,
        exec: fakeGh({ issues: [9000, 10754], titles: { 10754: 'Cookies not being sent with `secure: true`' } }),
      });
      const f = report.findings.find(x => x.check === 'related-ref-gloss-mismatch');
      expect(f?.severity).to.equal('blocking');
      expect(f?.message).to.contain('Cookies not being sent');
    });

    it('accepts a paraphrase that shares substantive words', () => {
      const dir = tmpCorpus({
        'a.md': withRefs(['- #10598: Admin app privacy policies change page not loading any policies']),
      });
      const report = verifyDrafts({
        dir, online: true,
        exec: fakeGh({ issues: [9000, 10598], titles: { 10598: 'Admin privacy policies do not load' } }),
      });
      expect(report.findings.some(x => x.check === 'related-ref-gloss-mismatch')).to.equal(false);
    });

    it('warns when a PR is cited as though it were an issue, unless labelled', () => {
      const bare = tmpCorpus({ 'a.md': withRefs(['- #4374: Refuse duplicate SMS messages']) });
      const gh = fakeGh({ issues: [9000], prs: [4374], titles: { 4374: 'Refuse duplicate SMS messages' } });
      expect(verifyDrafts({ dir: bare, online: true, exec: gh })
        .findings.some(x => x.check === 'related-ref-is-pr')).to.equal(true);

      const labelled = tmpCorpus({ 'a.md': withRefs(['- PR #4374: Refuse duplicate SMS messages']) });
      expect(verifyDrafts({ dir: labelled, online: true, exec: gh })
        .findings.some(x => x.check === 'related-ref-is-pr')).to.equal(false);
    });

    it('exempts a relationship gloss from the title comparison', () => {
      // "Blocker for #10908" describes linkage, not the issue's subject.
      const dir = tmpCorpus({ 'a.md': withRefs(['- #10901: Blocker for #10908']) });
      const report = verifyDrafts({
        dir, online: true,
        exec: fakeGh({
          issues: [9000, 10901],
          titles: { 10901: 'Add `webapp` support for showing `app_drawer_tab` in legacy header menu' },
        }),
      });
      expect(report.findings.some(x => x.check === 'related-ref-gloss-mismatch')).to.equal(false);
    });

    it('blocks a reference to a number that does not exist', () => {
      const dir = tmpCorpus({ 'a.md': withRefs(['- #99999: Something invented']) });
      const report = verifyDrafts({ dir, online: true, exec: fakeGh({ issues: [9000] }) });
      expect(report.findings.some(x => x.check === 'related-ref-missing')).to.equal(true);
    });

    it('counts a throttled cross-reference lookup as unverified, not a defect', () => {
      const dir = tmpCorpus({ 'a.md': withRefs(['- #10754: whatever']) });
      const report = verifyDrafts({
        dir, online: true, exec: fakeGh({ issues: [9000], transient: [10754] }),
      });
      expect(report.findings.some(x => x.check.startsWith('related-ref'))).to.equal(false);
      expect(report.unverified).to.equal(1);
    });

    it('does not re-flag the draft\'s own issue number', () => {
      const dir = tmpCorpus({ 'a.md': withRefs(['- #9000: totally unrelated words here']) });
      const report = verifyDrafts({
        dir, online: true, exec: fakeGh({ issues: [9000], titles: { 9000: 'Draft 9000' } }),
      });
      expect(report.findings.some(x => x.check.startsWith('related-ref'))).to.equal(false);
    });
  });

  describe('stale-timestamp', () => {
    const gitLog = (date: string): ExecFn => (file, args) => {
      expect(file).to.equal('git');
      expect(args).to.include('--date=short');
      return `${date}\n`;
    };

    it('warns when lastUpdated predates the file\'s last commit', () => {
      const dir = tmpCorpus({ 'a.md': draft(7000) }); // stamped 2026-07-27
      const report = verifyDrafts({ dir, exec: gitLog('2026-07-29') });
      const f = report.findings.find(x => x.check === 'stale-timestamp');
      expect(f?.severity).to.equal('warning');
      expect(f?.message).to.contain('2026-07-27');
      expect(f?.message).to.contain('2026-07-29');
    });

    it('passes when the stamp is current or newer', () => {
      const dir = tmpCorpus({ 'a.md': draft(7000) });
      expect(verifyDrafts({ dir, exec: gitLog('2026-07-27') })
        .findings.some(x => x.check === 'stale-timestamp')).to.equal(false);
      expect(verifyDrafts({ dir, exec: gitLog('2026-07-01') })
        .findings.some(x => x.check === 'stale-timestamp')).to.equal(false);
    });

    it('stays silent when git cannot answer', () => {
      const dir = tmpCorpus({ 'a.md': draft(7000) });
      const exploding: ExecFn = () => { throw new Error('not a git repo'); };
      expect(verifyDrafts({ dir, exec: exploding })
        .findings.some(x => x.check === 'stale-timestamp')).to.equal(false);
    });
  });

  describe('--changed-only', () => {
    const twoDrafts = { 'changed.md': draft(7100), 'untouched.md': draft(7200, ['domainFit: strong']) };
    const gitDiff = (files: string[]): ExecFn => (file, args) => {
      expect(file).to.equal('git');
      expect(args).to.include('--name-only');
      return files.join('\n');
    };

    it('reports per-file findings only for changed files', () => {
      const dir = tmpCorpus({
        'changed.md': draft(7100, [], 'The permission con_create_people is used.'),
        'untouched.md': draft(7200, [], 'The view docs_by_type is queried.'),
      });
      const report = verifyDrafts({ dir, base: 'origin/main', exec: gitDiff(['agent-memory/changed.md']) });
      expect(report.scanned).to.equal(1);
      expect(has(report.findings, 'changed.md', 'vocab-near-miss')).to.equal(true);
      expect(has(report.findings, 'untouched.md', 'vocab-near-miss')).to.equal(false);
    });

    it('still catches a duplicate against an unchanged (already-landed) draft', () => {
      const dir = tmpCorpus({ 'new.md': draft(8034), 'landed.md': draft(8034) });
      const report = verifyDrafts({ dir, base: 'origin/main', exec: gitDiff(['agent-memory/new.md']) });
      expect(has(report.findings, 'new.md', 'duplicate-issue')).to.equal(true);
      expect(has(report.findings, 'landed.md', 'duplicate-issue')).to.equal(false);
    });

    it('skips corpus distribution lints, which need the whole tree', () => {
      const dir = tmpCorpus(twoDrafts);
      const report = verifyDrafts({ dir, base: 'origin/main', exec: gitDiff(['agent-memory/changed.md']) });
      expect(report.findings.some(f => f.file === '(corpus)')).to.equal(false);
    });

    it('throws on an empty diff rather than silently verifying nothing', () => {
      // A depth-1 CI checkout cannot reach the base commit; an empty diff would
      // otherwise read as "all clear".
      const dir = tmpCorpus(twoDrafts);
      expect(() => verifyDrafts({ dir, base: 'origin/main', exec: gitDiff([]) }))
        .to.throw(/empty diff.*shallow checkout/s);
    });
  });
});

describe('formatReport', () => {
  it('summarises counts, groups by severity and stamps the vocab commit', () => {
    const text = formatReport({
      scanned: 2,
      skipped: [],
      unverified: 0,
      findings: [
        { file: 'a.md', check: 'identity-alias', severity: 'blocking', message: 'keyed to its own PR', line: 6 },
        { file: 'b.md', check: 'process-leakage', severity: 'warning', message: 'rubric text' },
      ],
    }, 'd096ac155dda53592af9979f0bffb926ea58ddaa');

    expect(text).to.contain('2 drafts checked, 1 blocking, 1 warnings');
    expect(text).to.contain('vocab @ d096ac155d');
    expect(text).to.contain('[identity-alias] a.md:6');
    expect(text.indexOf('BLOCKING:')).to.be.lessThan(text.indexOf('WARNINGS:'));
  });

  it('states plainly that unverified drafts are not a pass', () => {
    const text = formatReport({ scanned: 1, skipped: [], unverified: 1, findings: [] }, 'abc1234567');
    expect(text).to.contain('not a pass');
  });
});
