import { expect } from 'chai';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  snapshotChtCore,
  captureChtCoreDiff,
  rollbackChtCore,
} from '../../../../../src/layers/code-gen/modules/claude-code-cli/workspace';

const execFileAsync = promisify(execFile);

/**
 * Integration-style coverage for the #140 dirty-checkout scenario, against a REAL
 * temp git repo (no proxyquire): the unit specs stub git, so only a real repo can
 * prove the git semantics that caused the data loss — stashing an uncommitted
 * .gitignore edit unmasks files that were ignored only by that edit, and a blanket
 * `git clean -fd` then deletes them beyond recovery (the stash never held them).
 */
describe('workspace.ts dirty-checkout acceptance (#140)', () => {
  let repo: string;

  const git = (...args: string[]) => execFileAsync('git', args, { cwd: repo });
  const write = (rel: string, content: string) => fs.writeFile(path.join(repo, rel), content, 'utf-8');
  const read = (rel: string) => fs.readFile(path.join(repo, rel), 'utf-8');
  const exists = async (rel: string) => {
    try {
      await fs.access(path.join(repo, rel));
      return true;
    } catch {
      return false;
    }
  };

  beforeEach(async () => {
    repo = await fs.mkdtemp(path.join(os.tmpdir(), 'ws-accept-'));
    await git('init');
    await git('config', 'user.name', 'Test');
    await git('config', 'user.email', 'test@example.com');
    await git('config', 'commit.gpgsign', 'false');
    // Committed baseline: a tracked source file and a .gitignore.
    await write('tracked.txt', 'committed content\n');
    await write('.gitignore', 'node_modules/\n');
    await git('add', '.');
    await git('commit', '-m', 'initial');
  });

  afterEach(async () => {
    await fs.rm(repo, { recursive: true, force: true });
  });

  /** The operator's dirty state, exactly as in the #110 manual run. */
  const makeDirty = async () => {
    await write('.gitignore', 'node_modules/\n.aider*\n');   // (a) uncommitted ignore-rule edit
    await write('.aider.chat', 'aider chat history\n');       // (b) ignored ONLY by that edit
    await write('.aider.tags', 'aider tag cache\n');
    await write('operator-notes.md', 'my notes\n');           // (c) plain untracked file
    await write('tracked.txt', 'operator work in progress\n'); // (d) uncommitted tracked edit
  };

  it('captures only session files and restores the tree byte-identically', async () => {
    await makeDirty();
    const snapshot = await snapshotChtCore(repo);

    // Simulate the CLI session: create 2 files, modify 1 tracked file.
    await write('src-new-a.ts', 'export const a = 1;\n');
    await write('src-new-b.ts', 'export const b = 2;\n');
    await write('tracked.txt', 'CLI rewrote this\n');

    const captured = await captureChtCoreDiff(repo, snapshot.headSha, snapshot.baselineUntracked);

    // Exactly the 3 session files; none of the operator's untracked files.
    expect(captured.map(f => f.path).sort()).to.deep.equal([
      'src-new-a.ts',
      'src-new-b.ts',
      'tracked.txt',
    ]);
    expect(captured.some(f => f.path.startsWith('.aider'))).to.equal(false);
    expect(captured.some(f => f.path === 'operator-notes.md')).to.equal(false);

    const rollback = await rollbackChtCore(repo, snapshot);
    expect(rollback.reset).to.equal('ok');
    expect(rollback.clean).to.equal('ok');
    expect(rollback.stashPop).to.equal('ok');

    // Tree is byte-identical to the pre-run dirty state.
    expect(await read('.gitignore')).to.equal('node_modules/\n.aider*\n');
    expect(await read('.aider.chat')).to.equal('aider chat history\n');
    expect(await read('.aider.tags')).to.equal('aider tag cache\n');
    expect(await read('operator-notes.md')).to.equal('my notes\n');
    expect(await read('tracked.txt')).to.equal('operator work in progress\n');

    // Session files are gone.
    expect(await exists('src-new-a.ts')).to.equal(false);
    expect(await exists('src-new-b.ts')).to.equal(false);

    // No stash of ours left behind.
    const { stdout: stashes } = await git('stash', 'list');
    expect(stashes).to.not.include('cht-agent-claude-code-cli-');
  });

  it('leaves a clean checkout untouched apart from the session files', async () => {
    const snapshot = await snapshotChtCore(repo);
    expect(snapshot.stashRef).to.be.null;

    await write('generated.ts', 'export const x = 1;\n');
    const captured = await captureChtCoreDiff(repo, snapshot.headSha, snapshot.baselineUntracked);
    expect(captured.map(f => f.path)).to.deep.equal(['generated.ts']);

    await rollbackChtCore(repo, snapshot);
    expect(await exists('generated.ts')).to.equal(false);
    expect(await read('tracked.txt')).to.equal('committed content\n');
  });

  it('does not glob-delete an operator file when a session filename holds metachars (#140 F-1)', async () => {
    // The operator file has to be BASELINE-untracked to be at risk, i.e. ignored
    // at stash time and unmasked once the .gitignore edit is stashed (the aider
    // shape). Passed raw, the session's `pages/[id].tsx` is an fnmatch bracket
    // expression that also matches `pages/d.tsx`, so `git clean` deletes both,
    // exits 0, and the verifier never runs. :(literal) prevents it.
    await fs.mkdir(path.join(repo, 'pages'), { recursive: true });
    await write('.gitignore', 'node_modules/\npages/d.tsx\n');
    await write('pages/d.tsx', 'operator component\n');
    const snapshot = await snapshotChtCore(repo);
    expect(snapshot.baselineUntracked).to.include('pages/d.tsx');

    await write('pages/[id].tsx', 'export default function Page() {}\n');

    const captured = await captureChtCoreDiff(repo, snapshot.headSha, snapshot.baselineUntracked);
    expect(captured.map(f => f.path)).to.deep.equal(['pages/[id].tsx']);

    const rollback = await rollbackChtCore(repo, snapshot);
    expect(rollback.clean).to.equal('ok');

    expect(await exists('pages/[id].tsx')).to.equal(false); // session file removed
    expect(await read('pages/d.tsx')).to.equal('operator component\n'); // operator file SURVIVES
    expect(await read('.gitignore')).to.equal('node_modules/\npages/d.tsx\n');
  });

  it('handles a session filename with a * metachar without collateral deletion', async () => {
    await write('.gitignore', 'node_modules/\nreport-2026.txt\n');
    await write('report-2026.txt', 'operator report\n');
    const snapshot = await snapshotChtCore(repo);
    expect(snapshot.baselineUntracked).to.include('report-2026.txt');

    // A literal asterisk in the name; as a glob it would match report-2026.txt.
    await write('report-*.txt', 'session scratch\n');

    await rollbackChtCore(repo, snapshot);
    expect(await exists('report-*.txt')).to.equal(false);
    expect(await read('report-2026.txt')).to.equal('operator report\n');
  });

  it('captures and cleans a non-ASCII session filename (#140 F-2)', async () => {
    // git C-quotes non-ASCII paths by default ("caf\303\251.txt"), so without -z
    // the file is dropped from capture and the clean matches nothing while still
    // reporting success, leaving phantom residue that pollutes the next baseline.
    const snapshot = await snapshotChtCore(repo);
    await write('café.txt', 'unicode content\n');
    await write('日本語.md', 'japanese content\n');

    const captured = await captureChtCoreDiff(repo, snapshot.headSha, snapshot.baselineUntracked);
    expect(captured.map(f => f.path).sort()).to.deep.equal(['café.txt', '日本語.md']);

    const rollback = await rollbackChtCore(repo, snapshot);
    expect(rollback.clean).to.equal('ok');
    expect(await exists('café.txt')).to.equal(false);
    expect(await exists('日本語.md')).to.equal(false);
  });

  it('captures and cleans a filename containing a newline (#140 C-5)', async () => {
    // THE discriminator for -z over core.quotePath=false: with quoting disabled,
    // the raw newline splits one path into two bogus ones.
    const weird = 'we\nird.txt';
    const snapshot = await snapshotChtCore(repo);
    await write(weird, 'newline in the name\n');

    const captured = await captureChtCoreDiff(repo, snapshot.headSha, snapshot.baselineUntracked);
    expect(captured.map(f => f.path)).to.deep.equal([weird]);

    const rollback = await rollbackChtCore(repo, snapshot);
    expect(rollback.clean).to.equal('ok');
    expect(await exists(weird)).to.equal(false);
    expect(await read('tracked.txt')).to.equal('committed content\n');
  });

  it('detects a stash leaked by a killed run and recovers with the printed command', async () => {
    await makeDirty();
    // Snapshot, then "die" before rollback.
    const snapshot = await snapshotChtCore(repo);
    expect(snapshot.stashRef).to.equal('stash@{0}');

    let message = '';
    try {
      await snapshotChtCore(repo);
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).to.match(/leftover cht-agent stash/i);
    expect(message).to.include(`git -C ${repo} stash pop stash@{0}`);

    // The recovery command in the message restores the operator's work.
    await git('stash', 'pop', 'stash@{0}');
    expect(await read('.gitignore')).to.equal('node_modules/\n.aider*\n');
    expect(await read('tracked.txt')).to.equal('operator work in progress\n');
    expect(await read('operator-notes.md')).to.equal('my notes\n');
  });
});
