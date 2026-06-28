import { expect } from 'chai';
import * as os from 'os';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { relinkIssues, rewriteFrontmatter, RelinkResult, ExecFn } from '../../src/scripts/relink-issues';

type ClosingRef = { number: number; url?: string };
type PrData = Record<number, { title?: string; body?: string; closing?: ClosingRef[] }>;

function url(n: number, repo = 'medic/cht-core'): string {
  return `https://github.com/${repo}/issues/${n}`;
}

function fakeExec(prData: PrData): ExecFn {
  return (file, args) => {
    if (file === 'gh' && args[0] === '--version') return 'gh version 2.40.0';
    if (file === 'gh' && args[0] === 'pr' && args[1] === 'view') {
      const d = prData[Number(args[2])] ?? {};
      return JSON.stringify({
        title: d.title ?? '',
        body: d.body ?? '',
        closingIssuesReferences: d.closing ?? [],
      });
    }
    throw new Error(`unexpected exec: ${file} ${args.join(' ')}`);
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

describe('relinkIssues (dry-run classification)', () => {
  let dir: string;

  before(() => {
    dir = tmpDir();
    makeDraft(dir, { name: '9559-fix9467-better-handling.md', issueNumber: 9559, pr: 9559 }); // aliased, gh single
    makeDraft(dir, { name: '100-feat50-clean.md', issueNumber: 50, pr: 100 }); // clean (50 != 100, == token)
    makeDraft(dir, { name: '200-feat60-suspect.md', issueNumber: 137, pr: 200 }); // suspect (137 != PR, != token 60)
    makeDraft(dir, { name: '300-app-skeleton.md', issueNumber: 300, pr: 300 }); // aliased tokenless, gh resolves
    makeDraft(dir, { name: '400-app-config.md', issueNumber: 400, pr: 400 }); // aliased tokenless, gh empty
    makeDraft(dir, { name: '500-feat5555-multi.md', issueNumber: 500, pr: 500 }); // aliased, gh multi-issue
    makeDraft(dir, { name: '600-feat6001-titleonly.md', issueNumber: 600, pr: 600 }); // aliased, gh title agrees token
    makeDraft(dir, { name: '700-feat7001-conflict.md', issueNumber: 700, pr: 700 }); // aliased, gh title disagrees token
    makeDraft(dir, { name: '9467-rapidpro-old.md', issueNumber: 9467 }); // old, no source_pr; collides with 9559->9467
  });

  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const prData: PrData = {
    9559: { closing: [{ number: 9467, url: url(9467) }] },
    300: { closing: [{ number: 7000, url: url(7000) }] },
    400: { title: 'chore: no issue', closing: [] },
    500: { closing: [{ number: 5555, url: url(5555) }, { number: 5556, url: url(5556) }] },
    600: { title: 'feat(#6001): aligns with token', closing: [] },
    700: { title: 'feat(#9999): disagrees with token', closing: [] },
  };

  function run(): RelinkResult[] {
    return relinkIssues({ dir, exec: fakeExec(prData) });
  }

  it('relinks an aliased draft to the gh sidebar issue (token agrees)', () => {
    const r = byName(run(), '9559-fix9467-better-handling.md');
    expect(r.status).to.equal('relinked');
    expect(r.from).to.equal(9559);
    expect(r.to).to.equal(9467);
    expect(r.source).to.equal('gh');
    expect(r.tokenMismatch).to.equal(false);
  });

  it('leaves a clean draft (issueNumber != PR, == token) unchanged', () => {
    expect(byName(run(), '100-feat50-clean.md').status).to.equal('unchanged');
  });

  it('flags a suspect draft whose issueNumber disagrees with the token', () => {
    const r = byName(run(), '200-feat60-suspect.md');
    expect(r.status).to.equal('flagged');
    expect(r.reason).to.match(/suspect/);
  });

  it('relinks a tokenless aliased draft via gh', () => {
    const r = byName(run(), '300-app-skeleton.md');
    expect(r.status).to.equal('relinked');
    expect(r.to).to.equal(7000);
    expect(r.source).to.equal('gh');
  });

  it('flags a tokenless aliased draft when gh resolves no issue', () => {
    const r = byName(run(), '400-app-config.md');
    expect(r.status).to.equal('flagged');
    expect(r.reason).to.match(/no issue/);
  });

  it('flags a multi-issue PR rather than guessing', () => {
    const r = byName(run(), '500-feat5555-multi.md');
    expect(r.status).to.equal('flagged');
    expect(r.reason).to.match(/multi-issue/);
  });

  it('relinks via gh title/body when no sidebar but the token agrees', () => {
    const r = byName(run(), '600-feat6001-titleonly.md');
    expect(r.status).to.equal('relinked');
    expect(r.to).to.equal(6001);
    expect(r.source).to.equal('title-body');
  });

  it('flags when gh has no sidebar and title/body disagrees with the token', () => {
    const r = byName(run(), '700-feat7001-conflict.md');
    expect(r.status).to.equal('flagged');
    expect(r.reason).to.match(/verify/);
  });

  it('detects the new->old collision on issue 9467 and surfaces the shared issue number', () => {
    const results = run();
    const relinked = byName(results, '9559-fix9467-better-handling.md');
    const old = byName(results, '9467-rapidpro-old.md');
    expect(old.status).to.equal('unchanged');
    expect(relinked.collidesWith).to.include('9467-rapidpro-old.md');
    expect(old.collidesWith).to.include('9559-fix9467-better-handling.md');
    // Both carry the shared issue, including the unchanged old file (no from/to).
    expect(relinked.issue).to.equal(9467);
    expect(old.issue).to.equal(9467);
  });
});

describe('relinkIssues (legitimate many-PRs-to-one-issue, already linked)', () => {
  it('leaves three distinct PRs already pointing at one issue unchanged and reports the collision with its issue number', () => {
    const dir = tmpDir();
    // Mirrors data-sync 10793/10798/10799 -> issue 10792: distinct PRs, already correct.
    makeDraft(dir, { name: '10793-fix10792-a.md', issueNumber: 10792, pr: 10793 });
    makeDraft(dir, { name: '10798-fix10792-b.md', issueNumber: 10792, pr: 10798 });
    makeDraft(dir, { name: '10799-fix10792-c.md', issueNumber: 10792, pr: 10799 });
    const results = relinkIssues({ dir, exec: fakeExec({}) });
    for (const r of results) {
      expect(r.status).to.equal('unchanged');
      expect(r.issue).to.equal(10792);
      expect(r.collidesWith).to.have.lengthOf(2);
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('relinkIssues (apply + idempotency)', () => {
  it('rewrites only the three identity lines, leaves the body and source_pr intact, and is idempotent', () => {
    const dir = tmpDir();
    const file = path.join(dir, '9559-fix9467-better-handling.md');
    makeDraft(dir, { name: '9559-fix9467-better-handling.md', issueNumber: 9559, pr: 9559 });
    const exec = fakeExec({ 9559: { closing: [{ number: 9467, url: url(9467) }] } });

    const first = relinkIssues({ dir, apply: true, exec });
    expect(first[0].status).to.equal('relinked');

    const after = fs.readFileSync(file, 'utf8');
    expect(after).to.include('id: cht-core-9467');
    expect(after).to.include('issueNumber: 9467');
    expect(after).to.include('issueUrl: https://github.com/medic/cht-core/issues/9467');
    expect(after).to.include('source_pr: medic/cht-core#9559'); // untouched
    expect(after).to.include('Original body — must not change.');
    expect(after).to.not.include('cht-core-9559');

    // Re-run: now issueNumber != PR, so it is unchanged (idempotent).
    const second = relinkIssues({ dir, apply: true, exec });
    expect(second[0].status).to.equal('unchanged');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('relinkIssues (offline)', () => {
  it('relinks an aliased draft from the filename token when gh is disabled', () => {
    const dir = tmpDir();
    makeDraft(dir, { name: '9559-fix9467-better-handling.md', issueNumber: 9559, pr: 9559 });
    const r = relinkIssues({ dir, offline: true, exec: fakeExec({}) });
    expect(r[0].status).to.equal('relinked');
    expect(r[0].to).to.equal(9467);
    expect(r[0].source).to.equal('filename-token');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('relinkIssues (gh failure)', () => {
  it('falls back to the filename token when gh errors for a PR', () => {
    const dir = tmpDir();
    makeDraft(dir, { name: '9559-fix9467-better-handling.md', issueNumber: 9559, pr: 9559 });
    const exec: ExecFn = (file, args) => {
      if (file === 'gh' && args[0] === '--version') return 'gh version 2.40.0';
      throw new Error('gh pr view failed');
    };
    const r = relinkIssues({ dir, exec });
    expect(r[0].status).to.equal('relinked');
    expect(r[0].to).to.equal(9467);
    expect(r[0].source).to.equal('filename-token');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('relinkIssues (apply rewrite failure)', () => {
  it('flags (does not corrupt) an affected draft missing a target line', () => {
    const dir = tmpDir();
    const file = path.join(dir, '9559-fix9467-better-handling.md');
    // Aliased, but frontmatter is missing the issueUrl line.
    fs.writeFileSync(
      file,
      ['---', 'id: cht-core-9559', 'category: bug', 'domain: data-sync',
        'issueNumber: 9559', 'title: t', 'source_pr: medic/cht-core#9559',
        '---', '', '## Problem', '', 'body', ''].join('\n'),
      'utf8'
    );
    const exec = fakeExec({ 9559: { closing: [{ number: 9467, url: url(9467) }] } });
    const r = relinkIssues({ dir, apply: true, exec });
    expect(r[0].status).to.equal('flagged');
    expect(r[0].reason).to.match(/rewrite failed/);
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
