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
  buildRecoveryChecklist,
  STASH_MARKER_PREFIX,
} from '../../../../../src/layers/code-gen/modules/claude-code-cli/workspace';

const execFileAsync = promisify(execFile);

/**
 * Integration-style coverage for the dirty-checkout scenario, against a REAL
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
    // A chmod test that failed midway must not block the removal.
    await execFileAsync('chmod', ['-R', 'u+w', repo]).catch(() => undefined);
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
    expect(stashes).to.not.include(STASH_MARKER_PREFIX);
  });

  it('residual: a session overwrite of a file untracked at snapshot is neither captured nor undone', async () => {
    await makeDirty(); // .aider.chat is unmasked by the stashed .gitignore edit: baseline-untracked
    const snapshot = await snapshotChtCore(repo);
    expect(snapshot.baselineUntracked).to.include('.aider.chat');

    await write('.aider.chat', 'the session overwrote this\n');
    const captured = await captureChtCoreDiff(repo, snapshot.headSha, snapshot.baselineUntracked);
    await rollbackChtCore(repo, snapshot);

    expect(captured.map(f => f.path)).to.not.include('.aider.chat');
    // OVERWRITE: it was never stashed, so rollback cannot bring the old content back.
    expect(await read('.aider.chat')).to.equal('the session overwrote this\n');
    expect(await read('tracked.txt')).to.equal('operator work in progress\n');
  });

  it('residual: a session delete of a file untracked at snapshot is neither captured nor undone', async () => {
    await makeDirty();
    const snapshot = await snapshotChtCore(repo);
    expect(snapshot.baselineUntracked).to.include('.aider.tags');

    await fs.rm(path.join(repo, '.aider.tags'));
    const captured = await captureChtCoreDiff(repo, snapshot.headSha, snapshot.baselineUntracked);
    await rollbackChtCore(repo, snapshot);

    expect(captured.map(f => f.path)).to.not.include('.aider.tags');
    // DELETE: it was never stashed, so rollback cannot bring it back.
    expect(await exists('.aider.tags')).to.equal(false);
    expect(await read('.aider.chat')).to.equal('aider chat history\n');
  });

  it('leaves a clean checkout untouched apart from the session files', async () => {
    const snapshot = await snapshotChtCore(repo);
    expect(snapshot.stashSha).to.be.null;

    await write('generated.ts', 'export const x = 1;\n');
    const captured = await captureChtCoreDiff(repo, snapshot.headSha, snapshot.baselineUntracked);
    expect(captured.map(f => f.path)).to.deep.equal(['generated.ts']);

    await rollbackChtCore(repo, snapshot);
    expect(await exists('generated.ts')).to.equal(false);
    expect(await read('tracked.txt')).to.equal('committed content\n');
  });

  it('does not glob-delete an operator file when a session filename holds metachars ', async () => {
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

  it('captures and cleans a non-ASCII session filename', async () => {
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

  it('captures and cleans a filename containing a newline', async () => {
    // git C-quotes control characters even with core.quotePath=false, so only
    // -z gives this path verbatim.
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

  /** Set an env var for the duration of `body` only. */
  const withEnv = async (name: string, value: string, body: () => Promise<void>) => {
    const prev = process.env[name];
    process.env[name] = value;
    try {
      await body();
    } finally {
      if (prev === undefined) delete process.env[name];
      else process.env[name] = prev;
    }
  };

  it('never runs a core.fsmonitor or hook program planted in the repo config', async () => {
    const hookDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws-hooks-'));
    const marker = path.join(hookDir, 'ran.log');
    try {
      const record = (exitCode: number) => `#!/bin/sh\necho "$0" >> '${marker}'\nexit ${exitCode}\n`;
      await fs.writeFile(path.join(hookDir, 'fsmonitor.sh'), record(1), { mode: 0o755 });
      for (const hook of ['reference-transaction', 'post-checkout', 'post-merge']) {
        await fs.writeFile(path.join(hookDir, hook), record(0), { mode: 0o755 });
      }
      await git('config', 'core.fsmonitor', path.join(hookDir, 'fsmonitor.sh'));
      await git('config', 'core.hooksPath', hookDir);

      await makeDirty();
      const snapshot = await snapshotChtCore(repo);
      await write('session.ts', 'export const s = 1;\n');
      await captureChtCoreDiff(repo, snapshot.headSha, snapshot.baselineUntracked);
      await rollbackChtCore(repo, snapshot);

      const ran = await fs.readFile(marker, 'utf-8').catch(() => '');
      expect(ran, 'programs that ran').to.equal('');
      expect(await read('tracked.txt')).to.equal('operator work in progress\n');
    } finally {
      await fs.rm(hookDir, { recursive: true, force: true });
    }
  });

  it('cleans the session file even when GIT_LITERAL_PATHSPECS is inherited', async () => {
    const snapshot = await snapshotChtCore(repo);
    await write('session.txt', 'session scratch\n');

    await withEnv('GIT_LITERAL_PATHSPECS', '1', async () => {
      const rollback = await rollbackChtCore(repo, snapshot);
      expect(rollback.clean).to.equal('ok');
    });
    expect(await exists('session.txt')).to.equal(false);
  });

  it('spares a case-variant operator file when GIT_ICASE_PATHSPECS is inherited', async () => {
    // The operator file is baseline-untracked (ignored only by an uncommitted
    // .gitignore edit), so it is on disk while the clean runs.
    await write('.gitignore', 'node_modules/\nSess3.TXT\n');
    await write('Sess3.TXT', 'operator file\n');
    const snapshot = await snapshotChtCore(repo);
    expect(snapshot.baselineUntracked).to.include('Sess3.TXT');
    await write('sess3.txt', 'session file\n');

    await withEnv('GIT_ICASE_PATHSPECS', '1', async () => {
      await rollbackChtCore(repo, snapshot);
    });
    expect(await read('Sess3.TXT')).to.equal('operator file\n');
    expect(await exists('sess3.txt')).to.equal(false);
  });

  it('keeps the stash and the session files when the reset fails, and prints the safe order', async function () {
    if (process.getuid?.() === 0) this.skip(); // root ignores the read-only dir
    await fs.mkdir(path.join(repo, 'rt'));
    await write('rt/t.txt', 'committed\n');
    await git('add', 'rt');
    await git('commit', '-m', 'rt');
    await makeDirty();
    const snapshot = await snapshotChtCore(repo);
    const stashName = String(snapshot.stashName);

    // Session: edit a tracked file inside a dir the reset cannot write, and add a file.
    await write('rt/t.txt', 'session edit\n');
    await write('session-new.ts', 'export const n = 1;\n');
    await fs.chmod(path.join(repo, 'rt'), 0o555);
    let rollback;
    try {
      rollback = await rollbackChtCore(repo, snapshot);
    } finally {
      await fs.chmod(path.join(repo, 'rt'), 0o755);
    }

    const { stdout: stashes } = await git('stash', 'list');
    expect(stashes, 'no pop over a failed reset').to.include(stashName);
    expect(await exists('session-new.ts'), 'clean skipped').to.equal(true);
    expect(rollback.reset).to.equal('failed');
    expect(rollback.sessionEdits).to.include('rt/t.txt');
    expect(rollback.survivors).to.include('session-new.ts');

    const lines = buildRecoveryChecklist(repo, snapshot, rollback).join('\n');
    // Step 1 names the read-only dir that holds the session edit.
    expect(lines).to.include('1. git cannot write inside "rt" (Permission denied). Fix the permissions');
    const resetAt = lines.indexOf(`reset --hard ${snapshot.headSha}`);
    expect(resetAt).to.be.greaterThan(-1);
    expect(resetAt).to.be.lessThan(lines.indexOf('stash list'));
    expect(lines).to.not.match(/stash@\{\d+\}/);
    expect(lines).to.not.include('stash drop');
  });

  it('never deletes an ignored operator file that a session rule unmasked when the reset fails', async () => {
    await write('.gitignore', 'node_modules/\n.env\n');
    await git('commit', '-am', 'ignore .env');
    await write('.env', 'SECRET=operator\n');
    const snapshot = await snapshotChtCore(repo);

    await write('.gitignore', 'node_modules/\n.env\n!.env\n'); // the session un-ignores .env
    await captureChtCoreDiff(repo, snapshot.headSha, snapshot.baselineUntracked);
    await write('.git/index.lock', '');                         // the reset now fails
    const rollback = await rollbackChtCore(repo, snapshot);
    await fs.rm(path.join(repo, '.git', 'index.lock'));

    expect(rollback.reset).to.equal('failed');
    expect(await read('.env')).to.equal('SECRET=operator\n');
    const lines = buildRecoveryChecklist(repo, snapshot, rollback).join('\n');
    expect(lines).to.include('index.lock');
    expect(lines).to.include('only if no git process runs');
  });

  it('detects a stash leaked by a killed run and recovers with the printed command', async () => {
    await makeDirty();
    // Snapshot, then "die" before rollback.
    const snapshot = await snapshotChtCore(repo);
    const { stdout: ourSha } = await git('rev-parse', 'refs/stash');
    expect(snapshot.stashSha).to.equal(ourSha.trim());

    let message = '';
    try {
      await snapshotChtCore(repo);
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).to.match(/leftover cht-agent stash/i);
    expect(message).to.not.match(/stash@\{\d+\}/);
    expect(message).to.not.match(/interrupted run/);

    // The operator then stashes other work, with a decoy message that mentions our name.
    await write('tracked.txt', 'other operator work\n');
    await git('stash', 'push', '-m', `note about ${snapshot.stashName} crash`);

    // Follow the printed guidance for real: each command runs alone, as copied.
    const commandAfter = (label: string) => {
      const line = message.split('\n').find(l => l.startsWith(label));
      expect(line, `the message has a "${label}" line`).to.exist;
      return String(line).slice(label.length);
    };
    const { stdout: hit } = await execFileAsync('sh', ['-c', commandAfter('Find the stash: ')]);
    expect(hit.split('\n').filter(Boolean), 'exactly our entry, not the decoy').to.have.length(1);
    await execFileAsync('sh', ['-c', commandAfter('Restore it: ')]);

    expect(await read('.gitignore')).to.equal('node_modules/\n.aider*\n');
    expect(await read('tracked.txt')).to.equal('operator work in progress\n');
    expect(await read('operator-notes.md')).to.equal('my notes\n');
    const { stdout: left } = await git('stash', 'list', '--format=%gs');
    expect(left.trim().split('\n')).to.have.length(1);
    expect(left.trim().endsWith(`: note about ${snapshot.stashName} crash`)).to.equal(true);
  });

  /** status (all untracked) and the index, byte for byte. */
  const treeState = async () => ({
    status: (await git('status', '--porcelain=v1', '-z', '--untracked-files=all')).stdout,
    index: (await git('ls-files', '-s', '-z')).stdout,
  });

  const commitFile = async (rel: string, content: string) => {
    await fs.mkdir(path.dirname(path.join(repo, rel)), { recursive: true });
    await write(rel, content);
    await git('add', rel);
    await git('commit', '-m', `add ${rel}`);
  };

  /** The error a call rejects with, or undefined. */
  const rejection = async (run: () => Promise<unknown>): Promise<{ kind?: string; lines?: string[]; message?: string } | undefined> => {
    try {
      await run();
    } catch (err) {
      return err as { kind?: string; lines?: string[]; message?: string };
    }
    return undefined;
  };

  it('restores and drops only our stash when the operator stashes during the session', async () => {
    await makeDirty();
    const snapshot = await snapshotChtCore(repo);
    // The operator stashes new work on top of ours mid-session.
    await write('tracked.txt', 'operator mid-session edit\n');
    await git('stash', 'push', '-m', 'operator mid-session wip');
    await write('src-new.ts', 'export const s = 1;\n');

    const rollback = await rollbackChtCore(repo, snapshot);

    expect(rollback.stashPop).to.equal('ok');
    expect(await read('tracked.txt')).to.equal('operator work in progress\n');
    const { stdout } = await git('stash', 'list', '--format=%gs');
    expect(stdout.trim().split('\n')).to.have.length(1);
    expect(stdout).to.include('operator mid-session wip');
  });

  it('changes nothing when the operator restored our stash during the session', async () => {
    await commitFile('older.txt', 'older\n');
    await write('older.txt', 'older operator stash\n');
    await git('stash', 'push', '-m', 'older operator stash');
    await makeDirty();
    const snapshot = await snapshotChtCore(repo);
    await write('src-new.ts', 'export const s = 1;\n');
    await git('stash', 'pop', 'stash@{0}'); // the operator takes our stash back

    const err = await rejection(() => rollbackChtCore(repo, snapshot));

    expect(err?.kind).to.equal('drift');
    expect(await read('tracked.txt')).to.equal('operator work in progress\n');
    expect(await read('operator-notes.md')).to.equal('my notes\n');
    expect(await read('.aider.chat')).to.equal('aider chat history\n');
    const { stdout } = await git('stash', 'list', '--format=%gs');
    expect(stdout).to.include('older operator stash');
    const lines = (err?.lines ?? []).join('\n');
    expect(lines).to.include(`Stash ${snapshot.stashName} is no longer in the stash list`);
    expect(lines).to.include('"src-new.ts"');
    expect(lines).to.not.include('reset --hard');
    expect(lines).to.not.match(/stash@\{\d+\}/);
  });

  it('refuses capture and rollback when the operator commits during the session', async () => {
    const snapshot = await snapshotChtCore(repo);
    await write('session.ts', 'export const s = 1;\n');
    await commitFile('op.txt', 'operator commit\n');
    const { stdout: opCommit } = await git('rev-parse', 'HEAD');

    const captureErr = await rejection(() => captureChtCoreDiff(repo, snapshot.headSha, snapshot.baselineUntracked));
    const rollbackErr = await rejection(() => rollbackChtCore(repo, snapshot));

    expect(captureErr?.kind).to.equal('drift');
    expect(rollbackErr?.kind).to.equal('drift');
    expect((await git('rev-parse', 'HEAD')).stdout).to.equal(opCommit);
    expect(await read('op.txt')).to.equal('operator commit\n');
    expect((rollbackErr?.lines ?? []).join('\n')).to.not.include('reset --hard');
  });

  it('refuses capture and rollback when the operator switches branch during the session', async () => {
    const { stdout: home } = await git('symbolic-ref', '--short', 'HEAD');
    await git('checkout', '-b', 'other');
    await commitFile('o.txt', 'other branch file\n');
    await git('checkout', home.trim());
    const { stdout: homeTip } = await git('rev-parse', 'HEAD');
    const { stdout: otherTip } = await git('rev-parse', 'other');

    const snapshot = await snapshotChtCore(repo);
    await write('session.ts', 'export const s = 1;\n');
    await git('checkout', 'other');

    expect((await rejection(() => captureChtCoreDiff(repo, snapshot.headSha, snapshot.baselineUntracked)))?.kind).to.equal('drift');
    expect((await rejection(() => rollbackChtCore(repo, snapshot)))?.kind).to.equal('drift');
    expect((await git('rev-parse', 'other')).stdout).to.equal(otherTip);
    expect((await git('rev-parse', home.trim())).stdout).to.equal(homeTip);
    expect(await read('o.txt')).to.equal('other branch file\n');
  });

  it("keeps the operator's staged and unstaged split through a full cycle", async () => {
    await commitFile('a.txt', 'a1\n');
    await commitFile('b.txt', 'b1\n');
    await write('a.txt', 'a2\n');
    await git('add', 'a.txt');
    await write('a.txt', 'a3\n'); // MM a.txt
    await write('b.txt', 'b2\n');
    await git('add', 'b.txt'); // M  b.txt
    const before = await treeState();

    const snapshot = await snapshotChtCore(repo);
    await write('session.ts', 'export const s = 1;\n');
    await rollbackChtCore(repo, snapshot);

    expect(await treeState()).to.deep.equal(before);
  });

  it('refuses to snapshot during an uncommitted merge, and keeps MERGE_HEAD', async () => {
    const { stdout: home } = await git('symbolic-ref', '--short', 'HEAD');
    await git('checkout', '-b', 'side');
    await commitFile('side.txt', 'side\n');
    await git('checkout', home.trim());
    await git('merge', '--no-commit', '--no-ff', 'side');

    const err = await rejection(() => snapshotChtCore(repo));

    expect(err?.kind).to.equal('precondition');
    expect(err?.message).to.include('MERGE_HEAD');
    expect((await git('rev-parse', '-q', '--verify', 'MERGE_HEAD')).stdout.trim()).to.not.equal('');
  });

  it('refuses a second rollback and a rollback against another repo, changing nothing', async () => {
    await makeDirty();
    const snapshot = await snapshotChtCore(repo);
    const other = await fs.mkdtemp(path.join(os.tmpdir(), 'ws-accept-other-'));
    try {
      await execFileAsync('git', ['init'], { cwd: other });
      await fs.writeFile(path.join(other, 'other-untracked.txt'), 'another repo\n');

      const crossErr = await rejection(() => rollbackChtCore(other, snapshot));
      expect(crossErr?.kind).to.equal('drift');
      expect((crossErr?.lines ?? []).join('\n')).to.include(`This snapshot belongs to ${snapshot.repoRoot}`);
      expect(await fs.readFile(path.join(other, 'other-untracked.txt'), 'utf-8')).to.equal('another repo\n');

      // The refused call did not use up the snapshot.
      expect((await rollbackChtCore(repo, snapshot)).stashPop).to.equal('ok');
      await write('after.txt', 'written after the rollback\n');
      const againErr = await rejection(() => rollbackChtCore(repo, snapshot));
      expect(againErr?.kind).to.equal('drift');
      expect((againErr?.lines ?? []).join('\n')).to.include('already rolled back; nothing was changed');
      expect(await read('after.txt')).to.equal('written after the rollback\n');
      expect(await read('tracked.txt')).to.equal('operator work in progress\n');
    } finally {
      await fs.rm(other, { recursive: true, force: true });
    }
  });

  it('refuses a subdirectory path but accepts a symlink to the toplevel', async () => {
    await commitFile('sub/keep.txt', 'keep\n');
    const subErr = await rejection(() => snapshotChtCore(path.join(repo, 'sub')));
    expect(subErr?.kind).to.equal('precondition');

    const linkDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws-accept-link-'));
    const link = path.join(linkDir, 'cht-core');
    try {
      await fs.symlink(repo, link);
      const snapshot = await snapshotChtCore(link);
      await write('generated.ts', 'export const x = 1;\n');
      const rollback = await rollbackChtCore(link, snapshot);
      expect(rollback.clean).to.equal('ok');
      expect(await exists('generated.ts')).to.equal(false);
    } finally {
      await fs.rm(linkDir, { recursive: true, force: true });
    }
  });

  it('keeps our stash and names the read-only dir when the restore fails', async function () {
    if (process.getuid?.() === 0) this.skip(); // root ignores the read-only dir
    await commitFile('ro/f.txt', 'committed\n');
    await write('ro/f.txt', 'operator work in ro\n');
    const snapshot = await snapshotChtCore(repo);
    await write('session.ts', 'export const s = 1;\n');
    await fs.chmod(path.join(repo, 'ro'), 0o555);
    let rollback;
    try {
      rollback = await rollbackChtCore(repo, snapshot);
    } finally {
      await fs.chmod(path.join(repo, 'ro'), 0o755);
    }

    expect(rollback.stashPop).to.equal('failed');
    expect((await git('stash', 'list', '--format=%gs')).stdout).to.include(String(snapshot.stashName));
    const lines = buildRecoveryChecklist(repo, snapshot, rollback).join('\n');
    expect(lines).to.include('"ro/f.txt"');
    expect(lines).to.include('inside "ro" (Permission denied)');
    expect(lines).to.match(/Fix the permissions/);
    expect(lines).to.not.match(/stash@\{\d+\}/);
    expect(lines).to.not.include('stash drop');
  });

  describe('ignore rules that change during the session', () => {
    const capturedPaths = async (snapshot: { headSha: string; baselineUntracked: string[] }) =>
      (await captureChtCoreDiff(repo, snapshot.headSha, snapshot.baselineUntracked)).map(f => f.path).sort();

    /** A repo-local core.excludesFile (never the real global config) that ignores `.env`. */
    const ignoreEnvThroughExcludesFile = async () => {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws-accept-excludes-'));
      await fs.writeFile(path.join(dir, 'excludes'), '.env\n');
      await git('config', 'core.excludesFile', path.join(dir, 'excludes'));
      return dir;
    };

    it('never captures or deletes an operator file that a session sub/.gitignore un-ignores', async () => {
      await commitFile('.gitignore', 'node_modules/\nsecret*\n');
      await fs.mkdir(path.join(repo, 'sub'));
      await write('sub/secret.txt', 'operator secret\n');
      const snapshot = await snapshotChtCore(repo);

      await write('sub/.gitignore', '!secret*\n');
      expect(await capturedPaths(snapshot)).to.deep.equal(['sub/.gitignore']);
      const rollback = await rollbackChtCore(repo, snapshot);

      expect(rollback.clean).to.equal('ok');
      expect(await read('sub/secret.txt')).to.equal('operator secret\n');
      expect(await exists('sub/.gitignore')).to.equal(false);
    });

    it('never captures an ignored operator .env that a session edit of the tracked .gitignore un-ignores', async () => {
      await commitFile('.gitignore', 'node_modules/\n.env\n');
      await write('.env', 'SECRET=operator\n');
      const snapshot = await snapshotChtCore(repo);

      await write('.gitignore', 'node_modules/\n.env\n!.env\n');
      const captured = await captureChtCoreDiff(repo, snapshot.headSha, snapshot.baselineUntracked);
      await rollbackChtCore(repo, snapshot);

      expect(captured.map(f => f.path)).to.deep.equal(['.gitignore']);
      expect(captured.some(f => f.content.includes('SECRET'))).to.equal(false);
      expect(await read('.env')).to.equal('SECRET=operator\n');
    });

    it('never reads the target of a session symlink, untracked or in place of a tracked file', async () => {
      const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'ws-accept-outside-'));
      try {
        await fs.writeFile(path.join(outside, 'secret.txt'), 'OUTSIDE SECRET\n');
        const snapshot = await snapshotChtCore(repo);
        await fs.symlink(path.join(outside, 'secret.txt'), path.join(repo, 'link.txt'));
        await fs.rm(path.join(repo, 'tracked.txt'));
        await fs.symlink(path.join(outside, 'secret.txt'), path.join(repo, 'tracked.txt'));

        const captured = await captureChtCoreDiff(repo, snapshot.headSha, snapshot.baselineUntracked);
        await rollbackChtCore(repo, snapshot);

        expect(captured.some(f => f.content.includes('OUTSIDE SECRET'))).to.equal(false);
        expect(captured.map(f => f.path)).to.deep.equal([]);
        expect(await read('tracked.txt')).to.equal('committed content\n');
        expect(await fs.lstat(path.join(repo, 'link.txt')).then(() => true, () => false)).to.equal(false);
        expect(await fs.readFile(path.join(outside, 'secret.txt'), 'utf-8')).to.equal('OUTSIDE SECRET\n');
      } finally {
        await fs.rm(outside, { recursive: true, force: true });
      }
    });

    it('keeps an operator file ignored by core.excludesFile when the session un-ignores it in info/exclude', async () => {
      const excludesDir = await ignoreEnvThroughExcludesFile();
      try {
        await write('.env', 'SECRET=operator\n');
        const snapshot = await snapshotChtCore(repo);

        await fs.mkdir(path.join(repo, '.git', 'info'), { recursive: true });
        await fs.writeFile(path.join(repo, '.git', 'info', 'exclude'), '!.env\n');
        expect(await capturedPaths(snapshot)).to.deep.equal([]);
        await rollbackChtCore(repo, snapshot);

        expect(await read('.env')).to.equal('SECRET=operator\n');
      } finally {
        await fs.rm(excludesDir, { recursive: true, force: true });
      }
    });

    it('keeps an ignored root file when the session creates a root .gitignore that un-ignores it', async () => {
      await git('rm', '-q', '.gitignore');
      await git('commit', '-m', 'no root ignore file');
      const excludesDir = await ignoreEnvThroughExcludesFile();
      try {
        await write('.env', 'SECRET=operator\n');
        const snapshot = await snapshotChtCore(repo);

        await write('.gitignore', '!.env\n');
        expect(await capturedPaths(snapshot)).to.deep.equal(['.gitignore']);
        await rollbackChtCore(repo, snapshot);

        expect(await read('.env')).to.equal('SECRET=operator\n');
        expect(await exists('.gitignore')).to.equal(false);
      } finally {
        await fs.rm(excludesDir, { recursive: true, force: true });
      }
    });

    for (const negation of ['!*', '!node_modules/']) {
      it(`keeps an ignored node_modules when a nested .gitignore holds ${negation}`, async () => {
        await fs.mkdir(path.join(repo, 'webapp', 'node_modules', 'pkg'), { recursive: true });
        await write('webapp/node_modules/pkg/index.js', 'module.exports = 1;\n');
        await write('webapp/node_modules/pkg/package.json', '{}\n');
        const snapshot = await snapshotChtCore(repo);

        await write('webapp/.gitignore', `${negation}\n`);
        expect(await capturedPaths(snapshot)).to.deep.equal(['webapp/.gitignore']);
        await rollbackChtCore(repo, snapshot);

        expect(await read('webapp/node_modules/pkg/index.js')).to.equal('module.exports = 1;\n');
        expect(await read('webapp/node_modules/pkg/package.json')).to.equal('{}\n');
        expect(await exists('webapp/.gitignore')).to.equal(false);
      });
    }

    it('keeps the files of a self-ignoring dir when the session deletes its .gitignore', async () => {
      await fs.mkdir(path.join(repo, 'cache'));
      await write('cache/.gitignore', '*\n');
      await write('cache/data.bin', 'operator cache\n');
      const snapshot = await snapshotChtCore(repo);

      await fs.rm(path.join(repo, 'cache', '.gitignore'));
      await write('cache/new.txt', 'session file\n');
      expect(await capturedPaths(snapshot)).to.deep.equal(['cache/new.txt']);
      await rollbackChtCore(repo, snapshot);

      expect(await read('cache/data.bin')).to.equal('operator cache\n');
      expect(await exists('cache/new.txt')).to.equal(false);
      // DELETE residual: the deleted .gitignore was never stashed, so it stays deleted.
      expect(await exists('cache/.gitignore')).to.equal(false);
    });

    it('keeps the files of an operator nested repo when the session deletes its .git', async () => {
      await fs.mkdir(path.join(repo, 'onr'));
      await execFileAsync('git', ['init', '-q'], { cwd: path.join(repo, 'onr') });
      await write('onr/work.txt', 'operator nested work\n');
      const snapshot = await snapshotChtCore(repo);

      await fs.rm(path.join(repo, 'onr', '.git'), { recursive: true, force: true });
      expect(await capturedPaths(snapshot)).to.deep.equal([]);
      await rollbackChtCore(repo, snapshot);

      expect(await read('onr/work.txt')).to.equal('operator nested work\n');
    });

    it('captures and cleans a new session file in a dir that holds only ignored files', async () => {
      await commitFile('.gitignore', 'node_modules/\n*.log\n');
      await fs.mkdir(path.join(repo, 'tools'));
      await write('tools/run.log', 'operator log\n');
      const snapshot = await snapshotChtCore(repo);
      // git lists tools/ as an ignored dir entry here; as a prefix it would hide the session file.
      expect(snapshot.baselineUntracked).to.not.include('tools/');

      await write('tools/new-tool.ts', 'export const t = 1;\n');
      expect(await capturedPaths(snapshot)).to.deep.equal(['tools/new-tool.ts']);
      await rollbackChtCore(repo, snapshot);

      expect(await exists('tools/new-tool.ts')).to.equal(false);
      expect(await read('tools/run.log')).to.equal('operator log\n');
    });

    it('residual: a session file in an ignored dir that the session un-ignores is neither captured nor cleaned', async () => {
      await commitFile('.gitignore', 'node_modules/\nbuild/\n');
      await fs.mkdir(path.join(repo, 'build'));
      await write('build/old.js', 'operator build\n');
      const snapshot = await snapshotChtCore(repo);

      await write('.gitignore', 'node_modules/\n'); // the session un-ignores build/
      await write('build/new.js', 'session build\n');
      expect(await capturedPaths(snapshot)).to.deep.equal(['.gitignore']);
      await rollbackChtCore(repo, snapshot);

      expect(await read('build/old.js')).to.equal('operator build\n');
      expect(await exists('build/new.js')).to.equal(true); // left behind: the documented T1 residual
    });
  });

  describe('a stash push that does not clean the tree', () => {
    const skipAsRoot = (ctx: Mocha.Context) => {
      if (process.getuid?.() === 0) ctx.skip(); // root ignores the read-only dir
    };

    /** Make `dir` read-only for the body only. */
    const withReadOnlyDir = async (dir: string, body: () => Promise<void>) => {
      await fs.chmod(path.join(repo, dir), 0o555);
      try {
        await body();
      } finally {
        await fs.chmod(path.join(repo, dir), 0o755);
      }
    };

    const ourStashes = async () =>
      (await git('stash', 'list', '--format=%gs')).stdout.split('\n').filter(l => l.includes(STASH_MARKER_PREFIX));

    it('puts staged, unstaged and untracked work back byte for byte when an untracked file cannot be removed', async function () {
      skipAsRoot(this);
      await commitFile('a.txt', 'a1\n');
      await commitFile('b.txt', 'b1\n');
      await write('a.txt', 'a2\n');
      await git('add', 'a.txt');
      await write('b.txt', 'b2\n');
      await fs.mkdir(path.join(repo, 'ro'));
      await write('ro/u.txt', 'untracked in a read-only dir\n');
      await write('top.txt', 'untracked at the top\n');
      const before = await treeState();

      let err: { kind?: string; lines?: string[] } | undefined;
      await withReadOnlyDir('ro', async () => {
        err = await rejection(() => snapshotChtCore(repo));
      });

      expect(err?.kind).to.equal('stash');
      const lines = (err?.lines ?? []).join('\n');
      expect(lines).to.include('inside "ro" (Permission denied)');
      expect(lines).to.include('Fix the permissions, then run again.');
      expect(await treeState()).to.deep.equal(before);
      expect(await ourStashes()).to.deep.equal([]);
    });

    it('catches an untracked file the push could not remove even with no tracked work', async function () {
      skipAsRoot(this);
      await fs.mkdir(path.join(repo, 'ro'));
      await write('ro/u.txt', 'untracked in a read-only dir\n');
      const before = await treeState();

      let err: { kind?: string } | undefined;
      await withReadOnlyDir('ro', async () => {
        err = await rejection(() => snapshotChtCore(repo));
      });

      expect(err?.kind).to.equal('stash');
      expect(await treeState()).to.deep.equal(before);
      expect(await ourStashes()).to.deep.equal([]);
    });

    it('never drops the stash when a staged delete comes back as an extra untracked file', async function () {
      skipAsRoot(this);
      await commitFile('rt/t.txt', 't1\n');
      await commitFile('d.txt', 'd1\n');
      await write('rt/t.txt', 't2\n');
      await git('rm', '-q', 'd.txt');
      const before = await treeState();

      let err: { kind?: string; lines?: string[] } | undefined;
      await withReadOnlyDir('rt', async () => {
        err = await rejection(() => snapshotChtCore(repo));
      });

      expect(err?.kind).to.equal('stash');
      if ((await ourStashes()).length > 0) {
        expect((err?.lines ?? []).join('\n')).to.include('"d.txt"');
      } else {
        expect(await treeState()).to.deep.equal(before);
      }
    });

    it('restores an untracked symlink as a symlink when it undoes a partial stash', async function () {
      skipAsRoot(this);
      await fs.symlink('tracked.txt', path.join(repo, 'lnk'));
      await fs.mkdir(path.join(repo, 'ro'));
      await write('ro/u.txt', 'untracked in a read-only dir\n');
      const before = await treeState();

      let err: { kind?: string } | undefined;
      await withReadOnlyDir('ro', async () => {
        err = await rejection(() => snapshotChtCore(repo));
      });

      expect(err?.kind).to.equal('stash');
      expect(await treeState()).to.deep.equal(before);
      expect(await fs.readlink(path.join(repo, 'lnk'))).to.equal('tracked.txt');
      expect(await ourStashes(), 'the verify accepted the restored link').to.deep.equal([]);
    });

    it('names an unreadable untracked file when the push cannot read it', async function () {
      skipAsRoot(this);
      await write('tracked.txt', 'operator work in progress\n');
      await write('secret.txt', 'operator secret\n');
      await fs.chmod(path.join(repo, 'secret.txt'), 0o000);
      const before = await treeState();

      let err: { kind?: string; lines?: string[] } | undefined;
      try {
        err = await rejection(() => snapshotChtCore(repo));
      } finally {
        await fs.chmod(path.join(repo, 'secret.txt'), 0o644);
      }

      expect(err?.kind).to.equal('stash');
      expect((err?.lines ?? []).join('\n')).to.include('git cannot read "secret.txt" (Permission denied)');
      expect(await treeState()).to.deep.equal(before);
      expect(await ourStashes()).to.deep.equal([]);
    });

    it('names the read-only parent when the push cannot remove a dir below it', async function () {
      skipAsRoot(this);
      await commitFile('p/t.txt', 'tracked in p\n');
      await write('tracked.txt', 'operator work in progress\n');
      await fs.mkdir(path.join(repo, 'p', 'd'));
      await write('p/d/x.txt', 'untracked below p\n');
      const before = await treeState();

      let err: { kind?: string; lines?: string[] } | undefined;
      await withReadOnlyDir('p', async () => {
        err = await rejection(() => snapshotChtCore(repo));
      });

      expect(err?.kind).to.equal('stash');
      const lines = (err?.lines ?? []).join('\n');
      expect(lines).to.include('git cannot write inside "p" (Permission denied)');
      expect(lines).to.not.include('inside "p/d"');
      expect(await treeState()).to.deep.equal(before);
      expect(await ourStashes()).to.deep.equal([]);
    });

    it('stops on a dirty submodule, which a stash push does not save', async () => {
      const source = await fs.mkdtemp(path.join(os.tmpdir(), 'ws-accept-sub-'));
      try {
        const inSource = (...args: string[]) => execFileAsync('git', args, { cwd: source });
        await inSource('init', '-q');
        await fs.writeFile(path.join(source, 'inner.txt'), 'inner\n');
        await inSource('add', 'inner.txt');
        await inSource('-c', 'user.name=T', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'inner');
        await git('-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', source, 'sub');
        await git('commit', '-m', 'add submodule');
        await write('sub/inner.txt', 'edited inside the submodule\n');

        const err = await rejection(() => snapshotChtCore(repo));

        expect(err?.kind).to.equal('stash');
        expect((err?.lines ?? []).join('\n')).to.include('"sub"');
        expect(await read('sub/inner.txt')).to.equal('edited inside the submodule\n');
        expect(await ourStashes()).to.deep.equal([]);
      } finally {
        await fs.rm(source, { recursive: true, force: true });
      }
    });

    for (const withWork of [false, true]) {
      it(`runs a full cycle around an operator nested repo${withWork ? ' next to tracked work' : ''}`, async () => {
        await fs.mkdir(path.join(repo, 'tools'));
        await execFileAsync('git', ['init', '-q'], { cwd: path.join(repo, 'tools') });
        await write('tools/tool.sh', 'echo tool\n');
        if (withWork) await write('tracked.txt', 'operator work in progress\n');

        const snapshot = await snapshotChtCore(repo);
        await write('session.ts', 'export const s = 1;\n');
        const rollback = await rollbackChtCore(repo, snapshot);

        expect(rollback.reset).to.equal('ok');
        expect(await read('tools/tool.sh')).to.equal('echo tool\n');
        expect(await exists('tools/.git')).to.equal(true);
        expect(await read('tracked.txt')).to.equal(withWork ? 'operator work in progress\n' : 'committed content\n');
        expect(await exists('session.ts')).to.equal(false);
      });
    }
  });

  it('names a nested repo that the session created and the clean cannot remove, and runs again after it', async () => {
    const snapshot = await snapshotChtCore(repo);
    await fs.mkdir(path.join(repo, 'nr'));
    await execFileAsync('git', ['init', '-q'], { cwd: path.join(repo, 'nr') });
    await write('nr/f.txt', 'session nested repo\n');

    const warned: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => { warned.push(String(args[0])); };
    let captured;
    let rollback;
    try {
      captured = await captureChtCoreDiff(repo, snapshot.headSha, snapshot.baselineUntracked);
      rollback = await rollbackChtCore(repo, snapshot);
    } finally {
      console.warn = originalWarn;
    }

    expect(captured.map(f => f.path)).to.deep.equal([]);
    expect(warned).to.include('[claude-code-cli] Not captured: nr/ (nested repository).');
    expect(rollback.clean).to.equal('failed');
    expect(rollback.survivors).to.include('nr/');
    expect(await read('nr/f.txt')).to.equal('session nested repo\n');

    // The next snapshot accepts the tree: a nested repo is never stashed, so the
    // post-push check does not count it as a leftover.
    const next = await snapshotChtCore(repo);
    expect(next.baselineUntracked).to.include('nr/');
    expect((await rollbackChtCore(repo, next)).reset).to.equal('ok');
  });
});
