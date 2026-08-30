import { expect } from 'chai';
import * as os from 'os';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  groundClaims, renderReport, extractionPrompt, DraftReport, ExtractFn,
  addedLinesByFile, gateAddedLines, renderAddedLinesReport,
} from '../../src/scripts/ground-claims';
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
      // grep -n -F -w -e <symbol> … — the `-e` keeps a symbol that starts with
      // a dash (a CLI flag named in prose) from being parsed as an option.
      expect(a[4]).to.equal('-e');
      const symbol = a[5];
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

  it('refuses to report "clean" when the diff matches no draft', async () => {
    // --dir outside the tool's own repo: git reports paths relative to THAT
    // repo, display paths are relative to this one, so nothing matches and a
    // silent empty selection would read as a passing run.
    const dir = tmpCorpus({ 'a.md': draft(7100) });
    let message = '';
    try {
      await groundClaims({
        dir, chtCorePath: '/fake', base: 'origin/main',
        exec: fakeGit({ changed: ['some/other/repo/path.md'] }),
        outDir: path.join(dir, '..', 'out'), extractFn: extractorFor([]),
      });
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message).to.match(/matched none of the 1 drafts/);
    expect(message).to.contain('outside the repo running the tool');
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

  it('clears drift when the draft time-scopes the entity elsewhere', async () => {
    // 10278's shape: one "Note on paths" paragraph qualifies the dead path, and
    // other sentences then name it plainly. One honest mention settles it.
    const DEAD = 'webapp/src/ts/services/resource-icons.service.ts';
    const exec: ExecFn = (file, args) => {
      expect(file).to.equal('git');
      const a = args.slice(2);
      if (a[0] === 'cat-file') return '';                       // every ref resolves
      if (a[0] === 'log' && a.includes('--diff-filter=D')) return '180c29ecf feat(#10224)';
      if (a[0] === 'log') return 'fix(#8027): partners doc';
      if (a[0] === 'rev-parse') return `${'d'.repeat(40)}\n`;
      if (a[0] === 'ls-tree') {
        // Present at the anchor sha, absent from origin/master.
        return a[2] === SHA ? DEAD : '';
      }
      throw Object.assign(new Error('no match'), { status: 1 });
    };
    const body = [
      `The Webapp service (${DEAD}) returns an empty array.`,
      '',
      `Note on paths: at the time of this fix the webapp service was ${DEAD}; since replaced by #11050.`,
    ].join('\n');
    const dir = tmpCorpus({ 'scoped.md': draft(8027, [`source_sha: ${SHA}`], body) });
    const claims: Claim[] = [{ kind: 'path-exists', file: DEAD, quote: `The Webapp service (${DEAD}) returns an empty array.` }];
    const { reports } = await groundClaims({
      dir, chtCorePath: '/fake', exec, outDir: path.join(dir, '..', 'out'),
      extractFn: async () => claims, apiResolve: false,
    });
    expect(reports[0].counts.grounded).to.equal(1);
    expect(reports[0].verdicts[0].drift).to.equal(undefined);
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

// ---------------------------------------------------------------------------
// --added-lines: the sentences an edit ADDED, gated exhaustively
// ---------------------------------------------------------------------------

describe('addedLinesByFile', () => {
  const parse = (diff: string): Record<string, number[]> => {
    const exec: ExecFn = () => diff;
    return Object.fromEntries(
      [...addedLinesByFile(exec, '/repo', 'base', '/repo/agent-memory')]
        .map(([f, ns]) => [f, [...ns].sort((a, b) => a - b)])
    );
  };

  it('reads the added line numbers out of a -U0 diff', () => {
    expect(parse([
      'diff --git a/x.md b/x.md',
      '--- a/x.md',
      '+++ b/x.md',
      '@@ -5,0 +6,2 @@',
      '+one',
      '+two',
      '@@ -20 +22 @@',
      '-old',
      '+new',
    ].join('\n'))).to.deep.equal({ 'x.md': [6, 7, 22] });
  });

  it('claims nothing for a pure deletion hunk', () => {
    // `+12,0` adds no lines; counting it would gate the line after the cut.
    expect(parse('+++ b/x.md\n@@ -12,3 +12,0 @@\n-gone\n')).to.deep.equal({});
  });

  it('ignores a file the diff deleted outright', () => {
    expect(parse('+++ /dev/null\n@@ -1,4 +0,0 @@\n')).to.deep.equal({});
  });
});

describe('gateAddedLines', () => {
  // Body lines land at 18 and 19 with the anchored frontmatter above them.
  const OLD_LINE = 'The handler calls `real_symbol` before writing.';
  const NEW_LINE = 'The retry path calls `fabricated_symbol` on failure.';
  const anchored = ['source_pr: medic/cht-core#10803', `source_sha: ${SHA}`];

  interface DeltaOpts { diff: string; dirty?: string; exists?: string[]; seen?: string[][] }
  /** The corpus repo is the parent of the `agent-memory` dir tmpCorpus builds. */
  const repoOf = (dir: string): string => path.dirname(dir);
  const deltaGit = (dir: string, opts: DeltaOpts): ExecFn => {
    const noMatch = (): never => { throw Object.assign(new Error('no match'), { status: 1 }); };
    return (file, args) => {
      expect(file).to.equal('git');
      opts.seen?.push(args);
      const a = args.slice(2);
      if (a[0] === 'rev-parse' && a[1] === '--show-toplevel') return `${repoOf(dir)}\n`;
      if (a[0] === 'status') return opts.dirty ?? '';
      if (a[0] === 'diff') return opts.diff;
      if (a[0] === 'cat-file') {
        if (a[2].startsWith(SHA)) return '';
        throw Object.assign(new Error('bad object'), { status: 128 });
      }
      if (a[0] === 'log') return 'fix(#10802): check status';
      if (a[0] === 'grep') {
        const needle = a[a.indexOf('-e') + 1];
        return (opts.exists ?? []).includes(needle) ? `${SHA}:api/src/a.js:10:${needle}` : noMatch();
      }
      return noMatch();
    };
  };

  /** A corpus dir the gate can read, plus a diff naming it relative to REPO. */
  const setup = (added: string): { dir: string; diff: string } => {
    const dir = tmpCorpus({ 'a.md': draft(10802, anchored, `${OLD_LINE}\n${NEW_LINE}`) });
    return { dir, diff: `+++ b/agent-memory/a.md\n@@ -18,0 +${added} @@\n` };
  };

  it('gates only the claims whose sentence sits on an added line', async () => {
    // Line 19 is the new sentence and names a symbol that does not exist; line
    // 18 is untouched, so its (real) symbol is out of scope entirely.
    const { dir, diff } = setup('19');
    const result = await gateAddedLines({
      dir, base: 'HEAD~1', chtCorePath: '/fake',
      exec: deltaGit(dir, { diff, exists: ['real_symbol'] }),
    });
    expect(result.claimCount).to.equal(1);
    expect(result.totals.ungrounded).to.equal(1);
    expect(result.drafts[0].verdicts[0].claim).to.have.property('symbol', 'fabricated_symbol');
  });

  it('passes when the added sentence checks out', async () => {
    const { dir, diff } = setup('18');
    const result = await gateAddedLines({
      dir, base: 'HEAD~1', chtCorePath: '/fake',
      exec: deltaGit(dir, { diff, exists: ['real_symbol'] }),
    });
    expect(result.totals).to.include({ grounded: 1, ungrounded: 0 });
  });

  it('takes the diff in the repo that owns the drafts, not the one running the tool', async () => {
    // The failure this flag exists to avoid: --changed-only diffs in the tool's
    // own repo, which has no drafts, so every run refused.
    const { dir, diff } = setup('19');
    const seen: string[][] = [];
    await gateAddedLines({
      dir, base: 'HEAD~1', chtCorePath: '/fake',
      exec: deltaGit(dir, { diff, exists: ['real_symbol'], seen }),
    });
    expect(seen[0]).to.deep.equal(['-C', dir, 'rev-parse', '--show-toplevel']);
    const diffCall = seen.find(a => a[2] === 'diff');
    expect(diffCall?.[1]).to.equal(repoOf(dir));
    expect(diffCall).to.include('HEAD~1..HEAD');
  });

  it('refuses to gate a dirty tree, because a verdict is about specific bytes', async () => {
    const { dir, diff } = setup('19');
    try {
      await gateAddedLines({
        dir, base: 'HEAD~1', chtCorePath: '/fake',
        exec: deltaGit(dir, { diff, dirty: ' M agent-memory/a.md' }),
      });
      expect.fail('should have thrown');
    } catch (err) {
      expect((err as Error).message).to.contain('uncommitted changes');
    }
  });

  it('reports an empty delta as empty rather than as a pass', async () => {
    const { dir } = setup('19');
    const result = await gateAddedLines({
      dir, base: 'HEAD~1', chtCorePath: '/fake', exec: deltaGit(dir, { diff: '' }),
    });
    expect(result.claimCount).to.equal(0);
    expect(renderAddedLinesReport(result)).to.contain('check --base');
  });

  it('says in its own header that no model was involved', async () => {
    const { dir, diff } = setup('19');
    const result = await gateAddedLines({
      dir, base: 'HEAD~1', chtCorePath: '/fake', exec: deltaGit(dir, { diff }),
    });
    const report = renderAddedLinesReport(result);
    expect(report).to.contain('no LLM extraction');
    expect(report).to.contain('✗');
  });
});

describe('renderReport — the unverifiable section names the actual obstacle', () => {
  const meta = {
    chtCorePath: '/x/cht-core', chtCoreSha: 'e'.repeat(40),
    totals: { grounded: 0, ungrounded: 0, unverifiable: 2, 'anchor-unusable': 0 },
  };

  // The blanket line used to read "claim(s) need the anchor commit; fetch
  // cht-core and re-run" for every unverifiable outcome. On contacts/9281 that
  // sent me to fetch the epic's pull ref; the anchor was already present and the
  // real obstacle was a three-line loop quoted as one line. Advice that costs a
  // verification step and changes nothing is worse than no advice.
  const report: DraftReport = {
    file: 'agent-memory/domains/contacts/issues/9281.md',
    contentHash: 'abc123',
    anchor: { sha: 'b'.repeat(40), subject: 'feat(#9238): getAll', isRevert: false },
    counts: { grounded: 0, ungrounded: 0, unverifiable: 2, 'anchor-unusable': 0 },
    verdicts: [
      {
        claim: {
          kind: 'literal-in-file', literal: 'for (const doc of docs.data) { yield doc }',
          file: 'shared-libs/cht-datasource/src/libs/data-context.ts', quote: 're-yields individually',
        },
        outcome: 'unverifiable',
        evidence: "git grep -nF 'for (const doc of docs.data) { yield doc }' → 0 hits (spans 3 lines in source)",
        provenance: 'anchor',
      },
      {
        claim: { kind: 'path-exists', file: 'agent-memory/schema.json', quote: 'PR #152 adds it' },
        outcome: 'unverifiable',
        evidence: "agent-memory/schema.json is a path in the agent-memory repo, not cht-core — out of this probe's tree",
        provenance: 'anchor',
      },
    ],
  };

  it('gives each claim its own recorded reason', () => {
    const md = renderReport([report], meta);
    expect(md).to.contain('spans 3 lines in source');
    expect(md).to.contain("out of this probe's tree");
  });

  it('no longer tells the reader to fetch cht-core for every unverifiable claim', () => {
    expect(renderReport([report], meta)).to.not.contain('fetch cht-core and re-run');
  });
});
