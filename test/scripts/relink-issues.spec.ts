import { expect } from 'chai';
import * as os from 'os';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { relinkIssues, rewriteFrontmatter, RelinkResult, ExecFn } from '../../src/scripts/relink-issues';

const REPO_API = 'https://api.github.com/repos/medic/cht-core';

interface Registry {
  issues?: number[]; // numbers that are real issues
  prCloses?: Record<number, number[]>; // PR number → the issues it closes
  transient?: number[]; // numbers whose `gh api issues/N` throws a transient error
}

/** fakeExec modeling GitHub: `gh api …/issues/N` disambiguates issue/pr/missing, `gh pr view` lists closing issues. */
function fakeExec(reg: Registry): ExecFn {
  const issues = new Set(reg.issues ?? []);
  const prCloses = reg.prCloses ?? {};
  const transient = new Set(reg.transient ?? []);
  return (file, args) => {
    if (file !== 'gh') throw new Error(`unexpected: ${file}`);
    if (args[0] === '--version') return 'gh version 2.40.0';
    if (args[0] === 'api' && /^repos\/.+\/issues\/\d+$/.test(args[1])) {
      const n = Number(args[1].split('/').pop());
      if (transient.has(n)) throw new Error('HTTP 403: API rate limit exceeded');
      if (n in prCloses) return JSON.stringify({ repository_url: REPO_API, pull_request: {} });
      if (issues.has(n)) return JSON.stringify({ repository_url: REPO_API });
      throw new Error('gh: Not Found (HTTP 404)');
    }
    if (args[0] === 'pr' && args[1] === 'view') {
      const closes = prCloses[Number(args[2])] ?? [];
      return JSON.stringify({
        closingIssuesReferences: closes.map(c => ({ number: c, url: `https://github.com/medic/cht-core/issues/${c}` })),
      });
    }
    throw new Error(`unexpected gh call: ${args.join(' ')}`);
  };
}

interface DraftSpec {
  name: string;
  issueNumber: number;
  pr?: number; // omit => no source_pr (old-convention file)
  idRepo?: string; // default cht-core
}

function makeDraft(dir: string, d: DraftSpec): void {
  const repo = d.idRepo ?? 'cht-core';
  const lines = [
    '---',
    `id: ${repo}-${d.issueNumber}`,
    'category: bug',
    'domain: data-sync',
    `issueNumber: ${d.issueNumber}`,
    `issueUrl: https://github.com/medic/${repo}/issues/${d.issueNumber}`,
    'title: A draft',
    ...(d.pr !== undefined ? [`source_pr: medic/${repo}#${d.pr}`] : []),
    '---',
    '',
    '## Problem',
    '',
    'Original body — must not change.',
    '',
  ];
  fs.writeFileSync(path.join(dir, d.name), lines.join('\n'), 'utf8');
}

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'relink-'));
}

function byName(results: RelinkResult[], name: string): RelinkResult {
  return results.find(r => path.basename(r.file) === name)!;
}

describe('relinkIssues (classification)', () => {
  it('relinks an aliased draft to the issue its source PR closes', () => {
    const dir = tmpDir();
    makeDraft(dir, { name: '9559-fix9467-x.md', issueNumber: 9559, pr: 9559 }); // issueNumber === PR (alias)
    const r = byName(relinkIssues({ dir, exec: fakeExec({ prCloses: { 9559: [9467] }, issues: [9467] }) }), '9559-fix9467-x.md');
    expect(r.status).to.equal('relinked');
    expect(r.to).to.equal(9467);
    expect(r.source).to.equal('gh');
    expect(r.tokenMismatch).to.equal(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('leaves a non-alias draft whose issueNumber is a real issue unchanged', () => {
    const dir = tmpDir();
    makeDraft(dir, { name: '100-feat50-x.md', issueNumber: 50, pr: 100 });
    const r = byName(relinkIssues({ dir, exec: fakeExec({ issues: [50] }) }), '100-feat50-x.md');
    expect(r.status).to.equal('unchanged');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('relinks a non-alias draft whose issueNumber is a PR — the 10399 → 10182[PR] → 10183 case (B2/B3)', () => {
    const dir = tmpDir();
    makeDraft(dir, { name: '10399-fix10182-x.md', issueNumber: 10182, pr: 10399 });
    // source_pr 10399 closes no issue (its body pointed at a PR); issueNumber 10182 is a PR closing 10183.
    const exec = fakeExec({ prCloses: { 10399: [], 10182: [10183] }, issues: [10183] });
    const r = byName(relinkIssues({ dir, exec }), '10399-fix10182-x.md');
    expect(r.status).to.equal('relinked');
    expect(r.to).to.equal(10183);
    expect(r.source).to.equal('gh');
    expect(r.tokenMismatch).to.equal(true); // token 10182 ≠ resolved 10183
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('relinks a tokenless aliased draft via its source PR closing-ref', () => {
    const dir = tmpDir();
    makeDraft(dir, { name: '300-app-skeleton.md', issueNumber: 300, pr: 300 });
    const r = byName(relinkIssues({ dir, exec: fakeExec({ prCloses: { 300: [7000] }, issues: [7000] }) }), '300-app-skeleton.md');
    expect(r.status).to.equal('relinked');
    expect(r.to).to.equal(7000);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('flags an aliased draft whose source PR closes no issue', () => {
    const dir = tmpDir();
    makeDraft(dir, { name: '400-app-config.md', issueNumber: 400, pr: 400 });
    const r = byName(relinkIssues({ dir, exec: fakeExec({ prCloses: { 400: [] } }) }), '400-app-config.md');
    expect(r.status).to.equal('flagged');
    expect(r.reason).to.match(/no-issue|resolve/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('flags a multi-issue PR rather than guessing', () => {
    const dir = tmpDir();
    makeDraft(dir, { name: '500-feat5555-x.md', issueNumber: 500, pr: 500 });
    const r = byName(relinkIssues({ dir, exec: fakeExec({ prCloses: { 500: [5555, 5556] }, issues: [5555, 5556] }) }), '500-feat5555-x.md');
    expect(r.status).to.equal('flagged');
    expect(r.reason).to.match(/multi-issue/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('flags (not follows issueNumber) when the source PR is multi-issue', () => {
    const dir = tmpDir();
    // Non-alias: issueNumber 700 is a PR closing one issue, but the SOURCE PR 600 closes two.
    makeDraft(dir, { name: '600-fix700-x.md', issueNumber: 700, pr: 600 });
    const exec = fakeExec({ prCloses: { 600: [601, 602], 700: [800] }, issues: [601, 602, 800] });
    const r = byName(relinkIssues({ dir, exec }), '600-fix700-x.md');
    expect(r.status).to.equal('flagged');
    expect(r.reason).to.match(/multi-issue/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('is idempotent: a relinked draft with a stale filename token stays unchanged on re-run', () => {
    const dir = tmpDir();
    // issueNumber already the real issue 10183, but the filename token is the old 10182.
    makeDraft(dir, { name: '10399-fix10182-x.md', issueNumber: 10183, pr: 10399 });
    const r = byName(relinkIssues({ dir, exec: fakeExec({ issues: [10183] }) }), '10399-fix10182-x.md');
    expect(r.status).to.equal('unchanged'); // stale-token mismatch suppressed
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('flags (does not silently skip) when a transient gh error blocks verification', () => {
    const dir = tmpDir();
    makeDraft(dir, { name: '888-fix999-x.md', issueNumber: 999, pr: 888 });
    const r = byName(relinkIssues({ dir, exec: fakeExec({ transient: [999] }) }), '888-fix999-x.md');
    expect(r.status).to.equal('flagged');
    expect(r.reason).to.match(/could not verify|manual/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('flags an aliased draft when a transient gh error blocks resolution', () => {
    const dir = tmpDir();
    makeDraft(dir, { name: '9559-fix9467-x.md', issueNumber: 9559, pr: 9559 });
    const r = byName(relinkIssues({ dir, exec: fakeExec({ transient: [9559] }) }), '9559-fix9467-x.md');
    expect(r.status).to.equal('flagged');
    expect(r.reason).to.match(/gh error resolving/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('offline: flags a non-alias draft whose issueNumber disagrees with the token', () => {
    const dir = tmpDir();
    makeDraft(dir, { name: '200-fix60-x.md', issueNumber: 137, pr: 200 }); // token 60 ≠ issueNumber 137
    const r = byName(relinkIssues({ dir, offline: true, exec: fakeExec({}) }), '200-fix60-x.md');
    expect(r.status).to.equal('flagged');
    expect(r.reason).to.match(/suspect/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('offline: leaves a non-alias draft whose issueNumber matches the token unchanged', () => {
    const dir = tmpDir();
    makeDraft(dir, { name: '200-fix137-x.md', issueNumber: 137, pr: 200 }); // token 137 === issueNumber
    const r = byName(relinkIssues({ dir, offline: true, exec: fakeExec({}) }), '200-fix137-x.md');
    expect(r.status).to.equal('unchanged');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('detects the new→old collision and surfaces the shared issue number', () => {
    const dir = tmpDir();
    makeDraft(dir, { name: '9559-fix9467-x.md', issueNumber: 9559, pr: 9559 }); // relinks → 9467
    makeDraft(dir, { name: '9467-old.md', issueNumber: 9467 }); // old, no source_pr → unchanged
    const results = relinkIssues({ dir, exec: fakeExec({ prCloses: { 9559: [9467] }, issues: [9467] }) });
    const relinked = byName(results, '9559-fix9467-x.md');
    const old = byName(results, '9467-old.md');
    expect(old.status).to.equal('unchanged');
    expect(relinked.issue).to.equal(9467);
    expect(old.issue).to.equal(9467);
    expect(relinked.collidesWith).to.include('9467-old.md');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('relinks a non-alias draft whose issueNumber is missing (404) via its source PR', () => {
    const dir = tmpDir();
    makeDraft(dir, { name: '500-fix404-x.md', issueNumber: 404, pr: 500 }); // 404 is missing; PR 500 closes 600
    const r = byName(relinkIssues({ dir, exec: fakeExec({ prCloses: { 500: [600] }, issues: [600] }) }), '500-fix404-x.md');
    expect(r.status).to.equal('relinked');
    expect(r.to).to.equal(600);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('runs token-only when gh is unavailable (detection), relinking from the filename token', () => {
    const dir = tmpDir();
    makeDraft(dir, { name: '9559-fix9467-x.md', issueNumber: 9559, pr: 9559 });
    const noGh: ExecFn = (_file, args) => {
      if (args[0] === '--version') throw new Error('gh: command not found');
      throw new Error(`unexpected: ${args.join(' ')}`);
    };
    const r = byName(relinkIssues({ dir, exec: noGh }), '9559-fix9467-x.md');
    expect(r.status).to.equal('relinked');
    expect(r.source).to.equal('filename-token');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('flags a tokenless aliased draft when offline (no gh, no token)', () => {
    const dir = tmpDir();
    makeDraft(dir, { name: '400-app-config.md', issueNumber: 400, pr: 400 }); // no fix<issue> token
    const r = byName(relinkIssues({ dir, offline: true, exec: fakeExec({}) }), '400-app-config.md');
    expect(r.status).to.equal('flagged');
    expect(r.reason).to.match(/tokenless and offline/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('leaves legitimate multi-PR→one-issue drafts unchanged and reports the collision', () => {
    const dir = tmpDir();
    for (const [name, pr] of [['10793-fix10792-a.md', 10793], ['10798-fix10792-b.md', 10798], ['10799-fix10792-c.md', 10799]] as const) {
      makeDraft(dir, { name, issueNumber: 10792, pr });
    }
    const results = relinkIssues({ dir, exec: fakeExec({ issues: [10792] }) });
    for (const r of results) {
      expect(r.status).to.equal('unchanged');
      expect(r.issue).to.equal(10792);
      expect(r.collidesWith).to.have.lengthOf(2);
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('relinkIssues (offline)', () => {
  it('relinks an aliased draft from the filename token when gh is disabled', () => {
    const dir = tmpDir();
    makeDraft(dir, { name: '9559-fix9467-x.md', issueNumber: 9559, pr: 9559 });
    const r = byName(relinkIssues({ dir, offline: true, exec: fakeExec({}) }), '9559-fix9467-x.md');
    expect(r.status).to.equal('relinked');
    expect(r.to).to.equal(9467);
    expect(r.source).to.equal('filename-token');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('relinkIssues (apply + idempotency)', () => {
  it('rewrites only the identity lines, leaves body/source_pr intact, and a re-run is a no-op', () => {
    const dir = tmpDir();
    const file = path.join(dir, '9559-fix9467-x.md');
    makeDraft(dir, { name: '9559-fix9467-x.md', issueNumber: 9559, pr: 9559 });
    const exec = fakeExec({ prCloses: { 9559: [9467] }, issues: [9467] });

    expect(relinkIssues({ dir, apply: true, exec })[0].status).to.equal('relinked');
    const after = fs.readFileSync(file, 'utf8');
    expect(after).to.include('id: cht-core-9467');
    expect(after).to.include('issueNumber: 9467');
    expect(after).to.include('issueUrl: https://github.com/medic/cht-core/issues/9467');
    expect(after).to.include('source_pr: medic/cht-core#9559'); // untouched
    expect(after).to.include('Original body — must not change.');

    // Re-run: issueNumber 9467 now classifies as a real issue → unchanged.
    expect(relinkIssues({ dir, apply: true, exec })[0].status).to.equal('unchanged');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('flags (does not corrupt) an affected draft missing a target line', () => {
    const dir = tmpDir();
    const file = path.join(dir, '9559-fix9467-x.md');
    fs.writeFileSync(
      file,
      ['---', 'id: cht-core-9559', 'category: bug', 'domain: data-sync',
        'issueNumber: 9559', 'title: t', 'source_pr: medic/cht-core#9559', // no issueUrl line
        '---', '', '## Problem', '', 'body', ''].join('\n'),
      'utf8'
    );
    const r = relinkIssues({ dir, apply: true, exec: fakeExec({ prCloses: { 9559: [9467] }, issues: [9467] }) })[0];
    expect(r.status).to.equal('flagged');
    expect(r.reason).to.match(/rewrite failed/);
    expect(fs.readFileSync(file, 'utf8')).to.include('id: cht-core-9559'); // not corrupted
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('rewriteFrontmatter', () => {
  it('throws when an identity line is missing (flagged rather than corrupted)', () => {
    const content = '---\nid: cht-core-1\ncategory: bug\n---\n\nbody\n'; // no issueNumber/issueUrl
    expect(() => rewriteFrontmatter(content, 'medic/cht-core', 2)).to.throw(/issueNumber/);
  });
});
