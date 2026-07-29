import { expect } from 'chai';
import * as os from 'os';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { groundClaims, renderReport, extractionPrompt, DraftReport, ExtractFn } from '../../src/scripts/ground-claims';
import { Claim, ExecFn } from '../../src/scripts/claim-probes';

const SHA = 'c'.repeat(40);

function tmpCorpus(drafts: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ground-claims-'));
  const dir = path.join(root, 'agent-memory');
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(drafts)) {
    fs.writeFileSync(path.join(dir, name), content, 'utf8');
  }
  return dir;
}

function draft(issue: number, extra: string[] = [], body = 'Body text.'): string {
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

/** git double: the anchor sha resolves, one symbol exists, one does not. */
function fakeGit(opts: { changed?: string[] } = {}): ExecFn {
  const noMatch = (): never => { throw Object.assign(new Error('no match'), { status: 1 }); };
  return (file, args) => {
    expect(file).to.equal('git');
    if (args[1] === 'diff' || args.includes('diff')) {
      if (args.includes('--name-only')) return (opts.changed ?? []).join('\n');
    }
    const a = args.slice(2);
    if (a[0] === 'cat-file') {
      if (a[2].startsWith(SHA)) return '';
      throw Object.assign(new Error('bad object'), { status: 128 });
    }
    if (a[0] === 'log') return 'fix(#10802): check status';
    if (a[0] === 'rev-parse') return `${'d'.repeat(40)}\n`;
    if (a[0] === 'grep') {
      const symbol = a[4];
      return symbol === 'realSymbol' ? `${SHA}:api/src/a.js:10:realSymbol` : noMatch();
    }
    return noMatch();
  };
}

const extractorFor = (claims: Claim[]): ExtractFn => async () => claims;

describe('ground-claims', () => {
  const anchored = ['source_pr: medic/cht-core#10803', `source_sha: ${SHA}`];

  it('requires a cht-core checkout', async () => {
    const dir = tmpCorpus({ 'a.md': draft(1) });
    const prev = process.env.CHT_CORE_PATH;
    delete process.env.CHT_CORE_PATH;
    try {
      await groundClaims({ dir, extractFn: extractorFor([]) });
      expect.fail('should have thrown');
    } catch (err) {
      expect((err as Error).message).to.contain('cht-core checkout required');
    } finally {
      if (prev) process.env.CHT_CORE_PATH = prev;
    }
  });

  it('grounds and refutes claims, tallying both', async () => {
    const dir = tmpCorpus({ 'a.md': draft(10802, anchored) });
    const result = await groundClaims({
      dir, chtCorePath: '/fake', exec: fakeGit(), outDir: path.join(dir, '..', 'out'),
      extractFn: extractorFor([
        { kind: 'symbol', symbol: 'realSymbol', quote: 'uses realSymbol' },
        { kind: 'symbol', symbol: 'fabricated', quote: 'uses fabricated' },
      ]),
    });
    expect(result.totals.grounded).to.equal(1);
    expect(result.totals.ungrounded).to.equal(1);
    expect(result.reports[0].anchor?.sha).to.equal(SHA);
  });

  it('stamps a content hash so a report cannot be reused for edited bytes', async () => {
    const dir = tmpCorpus({ 'a.md': draft(10802, anchored) });
    const run = (): Promise<{ reports: DraftReport[] }> => groundClaims({
      dir, chtCorePath: '/fake', exec: fakeGit(), outDir: path.join(dir, '..', 'out'),
      extractFn: extractorFor([]),
    });
    const first = (await run()).reports[0].contentHash;
    fs.writeFileSync(path.join(dir, 'a.md'), draft(10802, anchored, 'Edited body.'), 'utf8');
    expect((await run()).reports[0].contentHash).to.not.equal(first);
  });

  it('records an extraction failure instead of reporting the draft as clean', async () => {
    const dir = tmpCorpus({ 'a.md': draft(10802, anchored) });
    const failing: ExtractFn = async () => { throw new Error('CLI timed out'); };
    const result = await groundClaims({
      dir, chtCorePath: '/fake', exec: fakeGit(), outDir: path.join(dir, '..', 'out'), extractFn: failing,
    });
    expect(result.reports[0].error).to.contain('CLI timed out');
    expect(result.reports[0].verdicts).to.deep.equal([]);
  });

  it('skips prose files with no frontmatter', async () => {
    const dir = tmpCorpus({ 'a.md': draft(1, anchored), 'README.md': '# Just prose\n' });
    const result = await groundClaims({
      dir, chtCorePath: '/fake', exec: fakeGit(), outDir: path.join(dir, '..', 'out'),
      extractFn: extractorFor([]),
    });
    expect(result.reports).to.have.lengthOf(1);
  });

  it('honours --limit for a cheap prompt smoke-test', async () => {
    const drafts: Record<string, string> = {};
    for (let i = 0; i < 5; i++) drafts[`d${i}.md`] = draft(100 + i, anchored);
    const result = await groundClaims({
      dir: tmpCorpus(drafts), chtCorePath: '/fake', exec: fakeGit(),
      outDir: path.join(os.tmpdir(), 'gc-out'), extractFn: extractorFor([]), limit: 2,
    });
    expect(result.reports).to.have.lengthOf(2);
  });

  it('restricts to changed drafts and rejects an empty diff', async () => {
    const dir = tmpCorpus({ 'changed.md': draft(1, anchored), 'other.md': draft(2, anchored) });
    const result = await groundClaims({
      dir, chtCorePath: '/fake', base: 'origin/main', exec: fakeGit({ changed: ['agent-memory/changed.md'] }),
      outDir: path.join(dir, '..', 'out'), extractFn: extractorFor([]),
    });
    expect(result.reports.map(r => path.basename(r.file))).to.deep.equal(['changed.md']);

    try {
      await groundClaims({
        dir, chtCorePath: '/fake', base: 'origin/main', exec: fakeGit({ changed: [] }),
        outDir: path.join(dir, '..', 'out'), extractFn: extractorFor([]),
      });
      expect.fail('should have thrown');
    } catch (err) {
      expect((err as Error).message).to.contain('empty diff');
    }
  });

  it('anchors a draft that carries only source_prs (hand-authored shape)', async () => {
    // 10729/10802/9467: no source_pr, no source_sha — the first source_prs
    // entry is the canonical PR and must anchor the draft.
    const ANCHOR = 'a'.repeat(40);
    const exec: ExecFn = (file, args) => {
      expect(file).to.equal('git');
      const a = args.slice(2);
      if (a[0] === 'cat-file') throw Object.assign(new Error('bad object'), { status: 128 });
      if (a[0] === 'log' && a.includes('--all')) {
        const g = a.find(x => x.startsWith('--grep='))?.slice('--grep='.length);
        if (g === '(#10803)') return `${ANCHOR}\0fix(#10802): check status before a scheduled_task is updated (#10803)`;
        throw Object.assign(new Error('no match'), { status: 1 });
      }
      if (a[0] === 'rev-parse') return `${'d'.repeat(40)}\n`;
      throw new Error(`unexpected git call: ${a.join(' ')}`);
    };
    const dir = tmpCorpus({
      'only-prs.md': draft(10802, ['source_prs:', '  - "medic/cht-core#10803"', '  - "medic/cht-core#10811"']),
    });
    const { reports } = await groundClaims({
      dir, chtCorePath: '/fake', exec, outDir: path.join(dir, '..', 'out'),
      extractFn: async () => [], apiResolve: false,
    });
    expect(reports[0].anchor?.sha).to.equal(ANCHOR);
    expect(reports[0].anchor?.subject).to.contain('(#10803)');
  });

  it('writes REPORT.md and claims.json to the output directory', async () => {
    const dir = tmpCorpus({ 'a.md': draft(10802, anchored) });
    const outDir = path.join(dir, '..', 'report-out');
    await groundClaims({
      dir, chtCorePath: '/fake', exec: fakeGit(), outDir,
      extractFn: extractorFor([{ kind: 'symbol', symbol: 'fabricated', quote: 'q' }]),
    });
    expect(fs.existsSync(path.join(outDir, 'REPORT.md'))).to.equal(true);
    const parsed = JSON.parse(fs.readFileSync(path.join(outDir, 'claims.json'), 'utf8'));
    expect(parsed.reports).to.have.lengthOf(1);
    expect(parsed.chtCoreSha).to.be.a('string');
  });
});

describe('extractionPrompt', () => {
  it('asks only what the draft asserts, never whether it is true', () => {
    const prompt = extractionPrompt({
      file: 'a.md', frontmatter: { id: 'cht-core-1' }, body: 'The oidcLogin handler.', raw: '',
    });
    expect(prompt).to.contain('Your ONLY job is to say what the document ASSERTS');
    expect(prompt).to.contain('never silently correct a spelling');
    expect(prompt).to.contain('The oidcLogin handler.');
  });
});

describe('renderReport', () => {
  const meta = { chtCorePath: '/x/cht-core', chtCoreSha: 'e'.repeat(40), totals: { grounded: 1, ungrounded: 1, unverifiable: 0, 'anchor-unusable': 0 } };

  it('leads with ungrounded claims and shows the probe as evidence', () => {
    const md = renderReport([{
      file: 'agent-memory/a.md',
      contentHash: 'abc123',
      anchor: { sha: 'f'.repeat(40), subject: 'feat: x', isRevert: false },
      counts: { grounded: 1, ungrounded: 1, unverifiable: 0, 'anchor-unusable': 0 },
      verdicts: [{
        claim: { kind: 'symbol', symbol: 'getOidc', quote: 'A getOidc handler in login.js' },
        outcome: 'ungrounded',
        evidence: 'git grep -nFw getOidc → 0 hits',
        provenance: 'anchor',
      }],
    }], meta);

    expect(md).to.contain('`getOidc` does not exist');
    expect(md).to.contain('A getOidc handler in login.js');
    expect(md).to.contain('git grep -nFw getOidc → 0 hits');
    expect(md).to.contain('abc123');
  });

  it('states that unverifiable is not a pass', () => {
    const md = renderReport([], meta);
    expect(md).to.contain('is NOT a pass');
    expect(md).to.contain('_None._');
  });

  it('lists drafts blocked by a revert anchor separately from findings', () => {
    const md = renderReport([{
      file: 'agent-memory/b.md',
      contentHash: 'def456',
      anchor: { sha: 'a'.repeat(40), subject: 'Revert "feat: x"', isRevert: true },
      counts: { grounded: 0, ungrounded: 0, unverifiable: 0, 'anchor-unusable': 2 },
      verdicts: [],
    }], meta);
    expect(md).to.contain('Could not be verified');
    expect(md).to.contain('anchor is a revert');
  });
});
