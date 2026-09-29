import { expect } from 'chai';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import proxyquire from 'proxyquire';
import {
  snapshotChtCore,
  captureChtCoreDiff,
  rollbackChtCore,
  buildRecoveryChecklist,
  settleRollback,
  isOperatorAbort,
  STASH_MARKER_PREFIX,
  ChtCoreSnapshot,
} from '../../../../../src/layers/code-gen/modules/claude-code-cli/workspace';

const execFileAsync = promisify(execFile);

const WORKSPACE = '../../../../../src/layers/code-gen/modules/claude-code-cli/workspace';

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

  it('captures the full original content of a tracked file above 1 MiB', async () => {
    const big = 'x'.repeat(2 * 1024 * 1024);
    await commitFile('big.txt', big);
    const snapshot = await snapshotChtCore(repo);
    await write('big.txt', `${big}session edit\n`);

    const captured = await captureChtCoreDiff(repo, snapshot.headSha, snapshot.baselineUntracked);
    await rollbackChtCore(repo, snapshot);

    const entry = captured.find(f => f.path === 'big.txt');
    expect(entry?.originalContent?.length).to.equal(big.length);
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

  it('works on the target, not on the repo that inherited GIT_DIR, GIT_WORK_TREE and GIT_INDEX_FILE point at', async () => {
    const other = await fs.mkdtemp(path.join(os.tmpdir(), 'ws-accept-env-'));
    const inOther = (...args: string[]) => execFileAsync('git', args, { cwd: other });
    try {
      await inOther('init', '-q');
      await fs.writeFile(path.join(other, 'o.txt'), 'other repo\n');
      await inOther('add', 'o.txt');
      await inOther('-c', 'user.name=T', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'o');
      await fs.writeFile(path.join(other, 'o.txt'), 'other repo wip\n');
      const otherBefore = [
        (await inOther('status', '--porcelain=v1', '-z', '--untracked-files=all')).stdout,
        (await inOther('ls-files', '-s')).stdout,
        (await inOther('stash', 'list')).stdout,
      ];
      await makeDirty();
      const before = await treeState();

      const vars = { GIT_DIR: path.join(other, '.git'), GIT_WORK_TREE: other, GIT_INDEX_FILE: path.join(other, '.git', 'index') };
      const saved = Object.fromEntries(Object.keys(vars).map(k => [k, process.env[k]]));
      Object.assign(process.env, vars);
      let captured;
      try {
        const snapshot = await snapshotChtCore(repo);
        await write('session.ts', 'export const s = 1;\n');
        captured = await captureChtCoreDiff(repo, snapshot.headSha, snapshot.baselineUntracked);
        await rollbackChtCore(repo, snapshot);
      } finally {
        for (const [k, v] of Object.entries(saved)) {
          if (v === undefined) delete process.env[k];
          else process.env[k] = v;
        }
      }

      expect(captured.map(f => f.path)).to.deep.equal(['session.ts']);
      expect(await treeState()).to.deep.equal(before);
      expect([
        (await inOther('status', '--porcelain=v1', '-z', '--untracked-files=all')).stdout,
        (await inOther('ls-files', '-s')).stdout,
        (await inOther('stash', 'list')).stdout,
      ]).to.deep.equal(otherBefore);
    } finally {
      await fs.rm(other, { recursive: true, force: true });
    }
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
    const captured = await captureChtCoreDiff(repo, snapshot.headSha, snapshot.baselineUntracked);
    expect(captured.map(f => f.path)).to.not.include('.env');
    expect(captured.some(f => f.content.includes('SECRET'))).to.equal(false);
    await write('.git/index.lock', '');                         // the reset now fails
    const rollback = await rollbackChtCore(repo, snapshot);
    await fs.rm(path.join(repo, '.git', 'index.lock'));

    expect(rollback.reset).to.equal('failed');
    expect(await read('.env')).to.equal('SECRET=operator\n');
    const lines = buildRecoveryChecklist(repo, snapshot, rollback).join('\n');
    expect(lines).to.include('index.lock');
    expect(lines).to.include('only if no git process runs');
  });

  it('leaves baseline files out of the survivors and the clean step after a failed reset', async () => {
    await makeDirty(); // .aider.chat is baseline-untracked
    const snapshot = await snapshotChtCore(repo);
    await write('tracked.txt', 'session edit\n'); // so the locked reset really fails
    await write('session.ts', 'export const s = 1;\n');
    await write('.git/index.lock', '');
    const rollback = await rollbackChtCore(repo, snapshot);
    await fs.rm(path.join(repo, '.git', 'index.lock'));

    expect(rollback.reset).to.equal('failed');
    expect(rollback.survivors).to.deep.equal(['session.ts']);
    const lines = buildRecoveryChecklist(repo, snapshot, rollback).join('\n');
    expect(lines).to.include(":(literal)session.ts'");
    expect(lines).to.not.include('.aider');
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
      message = (err as { lines: string[] }).lines.join('\n');
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

  it('continues past an accepted leftover, pops only its own stash, and leaves the leftover in place', async () => {
    await write('tracked.txt', 'work in a leftover stash\n');
    await git('stash', 'push', '-m', `${STASH_MARKER_PREFIX}1700000000000`);
    const leftoverSha = (await git('rev-parse', 'stash@{0}')).stdout.trim();
    await makeDirty();
    const before = await treeState();

    const snapshot = await snapshotChtCore(repo, { acceptedLeftoverShas: [leftoverSha] })
      .catch((err: Error) => expect.fail(`the snapshot refused: ${err.message}`));
    await write('session.ts', 'export const s = 1;\n');
    const rollback = await rollbackChtCore(repo, snapshot);

    expect(rollback.stashPop).to.equal('ok');
    expect(await treeState()).to.deep.equal(before);
    const { stdout } = await git('stash', 'list', '--format=%H');
    expect(stdout.trim().split('\n')).to.deep.equal([leftoverSha]);
  });

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

  /**
   * Put a `git` shim first on PATH that runs `before` once, right before the
   * first `git stash drop`, then hands every call to the real git.
   */
  const withGitShim = async (before: string, body: () => Promise<void>) => {
    const shimDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws-accept-shim-'));
    const realGit = (await execFileAsync('sh', ['-c', 'command -v git'])).stdout.trim();
    const armed = path.join(shimDir, 'armed');
    await fs.writeFile(armed, '');
    await fs.writeFile(path.join(shimDir, 'git'), [
      '#!/bin/sh',
      `if [ "$1" = stash ] && [ "$2" = drop ] && [ -f ${shellWord(armed)} ]; then`,
      `  rm -f ${shellWord(armed)}`,
      `  ${before.replaceAll('GIT', shellWord(realGit))}`,
      'fi',
      `exec ${shellWord(realGit)} "$@"`,
      '',
    ].join('\n'), { mode: 0o755 });
    const prevPath = process.env.PATH;
    process.env.PATH = `${shimDir}:${prevPath}`;
    try {
      await body();
    } finally {
      process.env.PATH = prevPath;
      await fs.rm(shimDir, { recursive: true, force: true });
    }
  };
  const shellWord = (w: string) => `'${w.replaceAll("'", "'\\''")}'`;

  it('keeps an operator stash that is pushed right before our drop', async () => {
    await makeDirty();
    const snapshot = await snapshotChtCore(repo);
    await write('session.ts', 'export const s = 1;\n');

    let stashPop = '';
    await withGitShim(
      "echo 'operator note written during the session' > op-new.txt && GIT stash push -q -u -m 'operator new stash'",
      async () => { stashPop = (await rollbackChtCore(repo, snapshot)).stashPop; },
    );

    expect(stashPop).to.equal('ok');
    const { stdout: list } = await git('stash', 'list', '--format=%gs');
    expect(list).to.include('operator new stash');
    expect(list).to.not.include(String(snapshot.stashName));
    const { stdout: held } = await git('stash', 'show', '--include-untracked', '--name-only', 'stash@{0}');
    expect(held).to.include('op-new.txt');
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

  it('tells the operator, on a HEAD move with a stash taken, where the work is and what the session left', async () => {
    await makeDirty();
    const snapshot = await snapshotChtCore(repo);
    await write('tracked.txt', 'session edit\n');
    await write('session.ts', 'export const s = 1;\n');
    await write('op.txt', 'operator commit\n');
    await git('add', 'op.txt');
    await git('commit', '-m', 'operator commit');

    const err = await rejection(() => rollbackChtCore(repo, snapshot));

    const lines = (err?.lines ?? []).join('\n');
    expect(err?.kind).to.equal('drift');
    expect(lines).to.include(`Your uncommitted work is still in stash ${snapshot.stashName}. It was NOT restored.`);
    expect(lines).to.include('Find the stash: ');
    expect(lines).to.include('Tracked files that differ from HEAD:\n  - "tracked.txt"');
    expect(lines).to.include('Untracked files that appeared during the session:\n  - "session.ts"');
  });

  it('does not say "still in stash" on a HEAD move after the operator popped our stash', async () => {
    await makeDirty();
    const snapshot = await snapshotChtCore(repo);
    await git('stash', 'pop', '--index');
    await write('op.txt', 'operator commit\n');
    await git('add', 'op.txt');
    await git('commit', '-m', 'operator commit');

    const err = await rejection(() => rollbackChtCore(repo, snapshot));

    const lines = (err?.lines ?? []).join('\n');
    expect(err?.kind).to.equal('drift');
    expect(lines).to.not.include('still in stash');
    expect(lines).to.include(`Stash ${snapshot.stashName} is no longer in the stash list`);
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

  it('refuses a rollback at a subdirectory, changing nothing, and rolls back at the top level after', async () => {
    // The unmask shape inside sub/: stashing the .gitignore edit makes op.cfg a baseline file.
    await commitFile('sub/.gitignore', 'build/\n');
    await write('sub/.gitignore', 'build/\nop.cfg\n');
    await write('sub/op.cfg', 'operator config\n');
    const snapshot = await snapshotChtCore(repo);
    expect(snapshot.baselineUntracked).to.include('sub/op.cfg');
    await write('session.ts', 'export const s = 1;\n');

    const err = await rejection(() => rollbackChtCore(path.join(repo, 'sub'), snapshot));

    expect(err?.kind).to.equal('drift');
    expect(await read('sub/op.cfg')).to.equal('operator config\n');
    expect((await git('stash', 'list', '--format=%gs')).stdout).to.include(String(snapshot.stashName));
    const rollback = await rollbackChtCore(repo, snapshot);
    expect(rollback.stashPop).to.equal('ok');
    expect(await read('sub/.gitignore')).to.equal('build/\nop.cfg\n');
    expect(await read('sub/op.cfg')).to.equal('operator config\n');
    expect(await exists('session.ts')).to.equal(false);
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

  describe('the choices at a failed restore', () => {
    /** Run the git steps of a printed checklist in bash, in order; prose steps and the lookup are skipped. */
    const runPrintedSteps = async (lines: readonly string[]) => {
      for (const line of lines) {
        const step = /^\s+\d+\. (.*)$/.exec(line)?.[1] ?? '';
        const command = step.startsWith('Restore it: ') ? step.slice('Restore it: '.length) : step;
        if (command.startsWith('git -C ') || step.startsWith('Restore it: ')) await execFileAsync('bash', ['-c', command]);
      }
    };

    /** A restore that fails on a read-only dir; `resolve` answers the screen, and `session` makes the session's files. */
    const failedRestore = async (
      resolveStashFailure: (f: { step: string; lines: readonly string[] }) => Promise<'handled' | 'retry' | 'abort'>,
      session: () => Promise<void> = () => write('session.ts', 'export const s = 1;\n'),
    ) => {
      await commitFile('ro/f.txt', 'committed\n');
      await write('ro/f.txt', 'operator work in ro\n');
      const before = await treeState();
      const snapshot = await snapshotChtCore(repo);
      await session();
      await fs.chmod(path.join(repo, 'ro'), 0o555);
      try {
        return { before, snapshot, rollback: await rollbackChtCore(repo, snapshot, { resolveStashFailure }) };
      } finally {
        await fs.chmod(path.join(repo, 'ro'), 0o755);
      }
    };

    it('ends the rollback with the work back when the operator runs the printed steps and chooses "handled"', async function () {
      if (process.getuid?.() === 0) this.skip(); // root ignores the read-only dir
      const steps: string[] = [];
      const { before, rollback } = await failedRestore(async failure => {
        steps.push(failure.step);
        await fs.chmod(path.join(repo, 'ro'), 0o755); // the cause step, by hand
        await runPrintedSteps(failure.lines);
        return 'handled';
      });
      expect(steps).to.deep.equal(['restore']);
      expect(rollback.stashPop).to.equal('ok');
      expect(await treeState()).to.deep.equal(before);
      expect((await git('stash', 'list', '--format=%gs')).stdout).to.not.include(STASH_MARKER_PREFIX);
    });

    it('keeps a halt whose printed steps restore the tree after "handled" with no change, then Abort', async function () {
      if (process.getuid?.() === 0) this.skip(); // root ignores the read-only dir
      const answers: Array<'handled' | 'abort'> = ['handled', 'abort'];
      const { before, snapshot, rollback } = await failedRestore(async () => answers.shift() ?? 'abort');
      expect(answers).to.deep.equal([]);
      let halt: { kind?: string; lines?: string[] } | undefined;
      try {
        settleRollback(rollback, { logPrefix: '[acc]', label: 'acc', chtCorePath: repo, snapshot });
      } catch (err) {
        halt = err as { kind?: string; lines?: string[] };
      }
      expect(halt?.kind).to.equal('stash');
      expect(isOperatorAbort(halt)).to.equal(true);
      await runPrintedSteps(halt?.lines ?? []);
      expect(await treeState()).to.deep.equal(before);
      expect((await git('stash', 'list', '--format=%gs')).stdout).to.not.include(STASH_MARKER_PREFIX);
    });

    it('restores byte-identically on Retry after the fix, and the used snapshot still refuses a second rollback', async function () {
      if (process.getuid?.() === 0) this.skip(); // root ignores the read-only dir
      const { before, snapshot, rollback } = await failedRestore(async () => {
        await fs.chmod(path.join(repo, 'ro'), 0o755);
        return 'retry';
      });
      expect(rollback.stashPop).to.equal('ok');
      expect(await treeState()).to.deep.equal(before);
      expect((await git('stash', 'list', '--format=%gs')).stdout).to.not.include(STASH_MARKER_PREFIX);
      const again = await rejection(() => rollbackChtCore(repo, snapshot));
      expect(again?.kind).to.equal('drift');
      expect(again?.lines?.[0]).to.include('already rolled back');
    });

    it('says the restore failed again on Retry before the fix, then restores on Retry after it', async function () {
      if (process.getuid?.() === 0) this.skip(); // root ignores the read-only dir
      const printed: string[] = [];
      const consoleError = console.error;
      console.error = (...args: unknown[]) => { printed.push(args.map(String).join(' ')); };
      let asked = 0;
      let outcome;
      try {
        outcome = await failedRestore(async () => {
          asked += 1;
          if (asked === 2) await fs.chmod(path.join(repo, 'ro'), 0o755);
          return 'retry';
        });
      } finally {
        console.error = consoleError;
      }
      expect(asked).to.equal(2);
      expect(printed.some(l => l.startsWith('[claude-code-cli] The restore failed again: '))).to.equal(true);
      expect(outcome.rollback.stashPop).to.equal('ok');
      expect(await treeState()).to.deep.equal(outcome.before);
    });

    it('restores on Retry next to a session repo that the clean could not remove, and keeps the clean failure', async function () {
      if (process.getuid?.() === 0) this.skip(); // root ignores the read-only dir
      const { before, rollback } = await failedRestore(async () => {
        await fs.chmod(path.join(repo, 'ro'), 0o755);
        return 'retry';
      }, async () => {
        await fs.mkdir(path.join(repo, 'nr'));
        await execFileAsync('git', ['init', '-q'], { cwd: path.join(repo, 'nr') });
        await write('nr/x.txt', 'a session file in a nested repo\n');
      });
      expect(rollback.stashPop).to.equal('ok');
      expect(rollback.clean).to.equal('failed');
      expect(rollback.survivors).to.deep.equal(['nr/']);
      await fs.rm(path.join(repo, 'nr'), { recursive: true, force: true });
      expect(await treeState()).to.deep.equal(before);
      expect((await git('stash', 'list', '--format=%gs')).stdout).to.not.include(STASH_MARKER_PREFIX);
    });

    it('never asks after a failed reset', async function () {
      if (process.getuid?.() === 0) this.skip(); // root ignores the read-only dir
      await commitFile('rt/t.txt', 'committed\n');
      await makeDirty();
      const snapshot = await snapshotChtCore(repo);
      await write('rt/t.txt', 'session edit\n');
      await fs.chmod(path.join(repo, 'rt'), 0o555);
      let asked = false;
      let rollback;
      try {
        rollback = await rollbackChtCore(repo, snapshot, {
          resolveStashFailure: async () => {
            asked = true;
            return 'abort';
          },
        });
      } finally {
        await fs.chmod(path.join(repo, 'rt'), 0o755);
      }
      expect(rollback.reset).to.equal('failed');
      expect(asked).to.equal(false);
    });
  });

  describe('a choice after the operator changed the tree while a screen waited', () => {
    /**
     * workspace.ts on real git, except that the 2nd and 3rd `git stash list`
     * reads fail: the push runs, then the list cannot be read.
     */
    const loadWithUnreadableList = () => {
      const realExecFile = promisify(execFile);
      let lists = 0;
      const execFileStub = Object.assign(() => undefined, {
        [promisify.custom]: (cmd: string, args: string[], opts: object) => {
          if (args[0] === 'stash' && args[1] === 'list') {
            lists += 1;
            if (lists === 2 || lists === 3) {
              return Promise.reject(Object.assign(new Error('Command failed: git stash list'), { code: 128, stderr: 'fatal: bad index' }));
            }
          }
          return realExecFile(cmd, args, opts);
        },
      });
      return proxyquire.noCallThru()(WORKSPACE, { 'node:child_process': { execFile: execFileStub } });
    };

    const ourStashShas = async () =>
      (await git('stash', 'list', '--format=%H %gs')).stdout.split('\n')
        .filter(l => l.includes(STASH_MARKER_PREFIX)).map(l => l.split(' ')[0]);

    /** Run with the screens' lines captured instead of printed. */
    const quietly = async <T>(run: () => Promise<T>): Promise<T> => {
      const saved = { error: console.error, warn: console.warn, log: console.log };
      console.error = console.warn = console.log = () => undefined;
      try {
        return await run();
      } finally {
        Object.assign(console, saved);
      }
    };

    it('writes nothing over a branch that the operator checked out at an unreadable list, then "handled"', async () => {
      await commitFile('c.txt', 'c on the first branch\n');
      await git('checkout', '-q', '-b', 'other');
      await commitFile('c.txt', 'c on other\n');
      await commitFile('other-only.txt', 'only on other\n');
      await git('checkout', '-q', '-');
      await write('tracked.txt', 'operator work in progress\n');
      const ws = loadWithUnreadableList();
      const steps: string[] = [];
      const resolveStashFailure = async (failure: { step: string }) => {
        steps.push(failure.step);
        if (steps.length > 1) return 'abort' as const;
        await git('checkout', '-q', 'other');
        await write('c.txt', 'operator edit on other\n');
        return 'handled' as const;
      };
      const err = await quietly(() => rejection(() => ws.snapshotChtCore(repo, { resolveStashFailure })));
      expect(steps).to.deep.equal(['push', 'push']);
      expect(ws.isOperatorAbort(err)).to.equal(true);
      expect(err?.lines?.[0]).to.match(/^HEAD is at .* on refs\/heads\/other now, not /);
      expect((await git('symbolic-ref', '--short', 'HEAD')).stdout.trim()).to.equal('other');
      expect(await read('c.txt')).to.equal('operator edit on other\n');
      expect(await read('other-only.txt')).to.equal('only on other\n');
      expect((await git('status', '--porcelain')).stdout).to.equal(' M c.txt\n');
      const shas = await ourStashShas();
      expect(shas).to.have.length(1);
      expect((await git('show', `${shas[0]}:tracked.txt`)).stdout).to.equal('operator work in progress\n');
    });

    const EDIT = 'an operator edit made while the screen waited\n';
    const OUTSIDE = 'These paths changed after cht-agent stashed your work, and stash ';

    it('keeps an edit to a file outside the stash on "handled" after an unreadable list, and names the file', async () => {
      await commitFile('x.txt', 'x committed\n');
      await write('tracked.txt', 'operator work in progress\n');
      const ws = loadWithUnreadableList();
      const screens: Array<readonly string[]> = [];
      const resolveStashFailure = async (failure: { lines: readonly string[] }) => {
        screens.push(failure.lines);
        if (screens.length > 1) return 'abort' as const;
        await write('x.txt', EDIT);
        return 'handled' as const;
      };
      const err = await quietly(() => rejection(() => ws.snapshotChtCore(repo, { resolveStashFailure })));
      expect(screens).to.have.length(2);
      expect(screens[1][0].startsWith(OUTSIDE)).to.equal(true);
      expect(screens[1][1]).to.equal('  - "x.txt"');
      expect(ws.isOperatorAbort(err)).to.equal(true);
      expect(await read('x.txt')).to.equal(EDIT);
      expect(await read('tracked.txt')).to.equal('committed content\n');
      const shas = await ourStashShas();
      expect(shas).to.have.length(1);
      expect((await git('show', `${shas[0]}:tracked.txt`)).stdout).to.equal('operator work in progress\n');
    });

    it('keeps an edit to a file outside the stash on Retry at a failed restore, and names the file', async function () {
      if (process.getuid?.() === 0) this.skip(); // root ignores the read-only dir
      await commitFile('ro/f.txt', 'committed\n');
      await commitFile('x.txt', 'x committed\n');
      await write('ro/f.txt', 'operator work in ro\n');
      const snapshot = await quietly(() => snapshotChtCore(repo));
      await write('session.ts', 'export const s = 1;\n');
      const screens: Array<readonly string[]> = [];
      const resolveStashFailure = async (failure: { lines: readonly string[] }) => {
        screens.push(failure.lines);
        if (screens.length > 1) return 'abort' as const;
        await fs.chmod(path.join(repo, 'ro'), 0o755);
        await write('x.txt', EDIT);
        return 'retry' as const;
      };
      await fs.chmod(path.join(repo, 'ro'), 0o555);
      let rollback;
      try {
        rollback = await quietly(() => rollbackChtCore(repo, snapshot, { resolveStashFailure }));
      } finally {
        await fs.chmod(path.join(repo, 'ro'), 0o755);
      }
      expect(screens).to.have.length(2);
      expect(screens[1][0].startsWith(OUTSIDE)).to.equal(true);
      expect(screens[1][1]).to.equal('  - "x.txt"');
      expect(rollback.stashPop).to.equal('failed');
      expect(await read('x.txt')).to.equal(EDIT);
      const shas = await ourStashShas();
      expect(shas).to.deep.equal([snapshot.stashSha]);
    });
  });

  it('leaves baseline files out of the residue and its clean step after a failed restore', async function () {
    if (process.getuid?.() === 0) this.skip(); // root ignores the read-only dir
    // The unmask shape inside ro/: stashing the ro/.gitignore edit makes ro/secret.cfg a
    // baseline file, and the failed restore cannot put the edit back (ro/ is read-only).
    await commitFile('ro/.gitignore', 'build/\n');
    await write('ro/.gitignore', 'build/\nsecret.cfg\n');
    await write('ro/secret.cfg', 'operator secret\n');
    const snapshot = await snapshotChtCore(repo);
    expect(snapshot.baselineUntracked).to.include('ro/secret.cfg');
    await fs.chmod(path.join(repo, 'ro'), 0o555);
    let rollback;
    try {
      rollback = await rollbackChtCore(repo, snapshot);
    } finally {
      await fs.chmod(path.join(repo, 'ro'), 0o755);
    }

    expect(rollback.stashPop).to.equal('failed');
    expect(rollback.popResidue ?? []).to.not.include('ro/secret.cfg');
    expect(buildRecoveryChecklist(repo, snapshot, rollback).join('\n')).to.not.include('secret.cfg');
    expect(await read('ro/secret.cfg')).to.equal('operator secret\n');
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

    it('captures and cleans a new session file two levels into dirs that hold only ignored files', async () => {
      await commitFile('.gitignore', 'node_modules/\n*.log\n');
      await fs.mkdir(path.join(repo, 'tools', 'deep'), { recursive: true });
      await write('tools/deep/run.log', 'operator log\n');
      const snapshot = await snapshotChtCore(repo);
      expect(snapshot.baselineUntracked).to.not.include('tools/');
      expect(snapshot.baselineUntracked).to.not.include('tools/deep/');

      await write('tools/deep/new.ts', 'export const t = 1;\n');
      const captured = await captureChtCoreDiff(repo, snapshot.headSha, snapshot.baselineUntracked);
      await rollbackChtCore(repo, snapshot);

      expect(captured.map(f => f.path)).to.deep.equal(['tools/deep/new.ts']);
      expect(await exists('tools/deep/new.ts')).to.equal(false);
      expect(await read('tools/deep/run.log')).to.equal('operator log\n');
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
      // Left behind, as documented: the dir was ignored at snapshot, so its new file counts as the operator's.
      expect(await exists('build/new.js')).to.equal(true);
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

    it('puts a tracked dir that is now a file back, and names only what the push left, on a partial push', async function () {
      skipAsRoot(this);
      await commitFile('d/b.txt', 'b\n');
      await fs.rm(path.join(repo, 'd'), { recursive: true });
      await write('d', 'a file where the tracked dir was\n');
      await fs.mkdir(path.join(repo, 'ro'));
      await write('ro/u.txt', 'untracked in a read-only dir\n');
      const before = await treeState();

      let err: { kind?: string; lines?: string[] } | undefined;
      await withReadOnlyDir('ro', async () => {
        err = await rejection(() => snapshotChtCore(repo));
      });

      expect(err?.kind).to.equal('stash');
      const lines = err?.lines ?? [];
      expect(lines[0]).to.include('git stash did not clear these paths');
      expect(lines).to.include('  - "ro/u.txt"');
      expect(lines).to.not.include('  - "d"');
      expect(await treeState()).to.deep.equal(before);
      expect(await read('d')).to.equal('a file where the tracked dir was\n');
      expect(await ourStashes()).to.deep.equal([]);
    });

    it('runs a byte-identical cycle after the operator removes an index.lock and chooses Retry', async () => {
      await makeDirty();
      const before = await treeState();
      const lock = path.join(repo, '.git', 'index.lock');
      await fs.writeFile(lock, '');
      const steps: string[] = [];
      const resolveStashFailure = async (failure: { step: string }) => {
        steps.push(failure.step);
        await fs.rm(lock);
        return 'retry' as const;
      };
      const snapshot = await snapshotChtCore(repo, { resolveStashFailure })
        .catch((err: Error) => expect.fail(`the snapshot failed: ${err.message}`));
      expect(steps).to.deep.equal(['push']);
      await write('session.ts', 'export const s = 1;\n');
      const rollback = await rollbackChtCore(repo, snapshot);
      expect(rollback.stashPop).to.equal('ok');
      expect(await treeState()).to.deep.equal(before);
      expect(await ourStashes()).to.deep.equal([]);
    });

    it('runs a byte-identical cycle after the operator fixes a read-only dir at a partial push and chooses "handled"', async function () {
      skipAsRoot(this);
      await commitFile('a.txt', 'a1\n');
      await write('a.txt', 'a2\n');
      await fs.mkdir(path.join(repo, 'ro'));
      await write('ro/u.txt', 'untracked in a read-only dir\n');
      const before = await treeState();
      await fs.chmod(path.join(repo, 'ro'), 0o555);
      const steps: string[] = [];
      const resolveStashFailure = async (failure: { step: string }) => {
        steps.push(failure.step);
        await fs.chmod(path.join(repo, 'ro'), 0o755);
        return 'handled' as const;
      };
      const snapshot = await snapshotChtCore(repo, { resolveStashFailure })
        .catch((err: Error) => expect.fail(`the snapshot failed: ${err.message}`));
      expect(steps).to.deep.equal(['push']);
      await write('session.ts', 'export const s = 1;\n');
      const rollback = await rollbackChtCore(repo, snapshot);
      expect(rollback.stashPop).to.equal('ok');
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
        const lines = (err?.lines ?? []).join('\n');
        expect(lines).to.include('"d.txt"');
        // The cause comes first: the read-only dir, named, before the reset.
        const fixAt = lines.indexOf('git cannot write inside "rt" (Permission denied). Fix the permissions');
        expect(fixAt).to.be.greaterThan(-1);
        expect(fixAt).to.be.lessThan(lines.indexOf('reset --hard'));
        expect(lines).to.include('git stash did not complete (');
      } else {
        expect(await treeState()).to.deep.equal(before);
      }
    });

    it('never drops the stash while an ignored file that the stash deletes is back on disk', async function () {
      skipAsRoot(this);
      await commitFile('.gitignore', 'node_modules/\n*.log\n');
      await commitFile('rt/t.txt', 't1\n');
      await write('d.log', 'd\n');
      await git('add', '-f', 'd.log');
      await git('commit', '-m', 'track an ignored log');
      await git('rm', '-q', 'd.log');       // staged delete of an ignored, tracked file
      await write('rt/t.txt', 't2\n');     // a tracked edit the push cannot reset
      const ignoredState = async () => (await git('status', '--porcelain=v1', '-z', '--ignored', '--untracked-files=all')).stdout;
      const before = { ...(await treeState()), ignored: await ignoredState() };

      let err: { kind?: string; lines?: string[] } | undefined;
      await withReadOnlyDir('rt', async () => {
        err = await rejection(() => snapshotChtCore(repo));
      });

      expect(err?.kind).to.equal('stash');
      if ((await ourStashes()).length > 0) {
        expect((err?.lines ?? []).join('\n')).to.include('"d.log"');
      } else {
        expect({ ...(await treeState()), ignored: await ignoredState() }).to.deep.equal(before);
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

    it('stops on submodule dirt even when the repo config hides it (submodule.<name>.ignore=all)', async () => {
      const source = await fs.mkdtemp(path.join(os.tmpdir(), 'ws-accept-sub-'));
      try {
        const inSource = (...args: string[]) => execFileAsync('git', args, { cwd: source });
        await inSource('init', '-q');
        await fs.writeFile(path.join(source, 'inner.txt'), 'inner\n');
        await inSource('add', 'inner.txt');
        await inSource('-c', 'user.name=T', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'inner');
        await git('-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', source, 'sub');
        await git('commit', '-m', 'add submodule');
        await git('config', 'submodule.sub.ignore', 'all');
        await write('sub/inner.txt', 'edited inside the submodule\n');
        await write('tracked.txt', 'operator work in progress\n');
        const before = await treeState();

        const err = await rejection(() => snapshotChtCore(repo));

        expect(err?.kind).to.equal('stash');
        expect(await treeState()).to.deep.equal(before);
        expect(await read('sub/inner.txt')).to.equal('edited inside the submodule\n');
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

  describe('states that git stash cannot put back exactly', () => {
    /** Refused before anything changes, the same way on a second run. */
    const expectRefusedUnchanged = async (named: string) => {
      const before = await treeState();
      const first = await rejection(() => snapshotChtCore(repo));
      const second = await rejection(() => snapshotChtCore(repo));
      expect(first?.kind).to.equal('precondition');
      expect((first?.lines ?? []).join('\n')).to.include(named);
      expect((first?.lines ?? []).join('\n')).to.include('Nothing was changed.');
      expect(await treeState()).to.deep.equal(before);
      const { stdout: stashes } = await git('stash', 'list');
      expect(stashes).to.not.include(STASH_MARKER_PREFIX);
      expect(second?.kind).to.equal('precondition');
      expect(second?.message).to.equal(first?.message);
      return (first?.lines ?? []).join('\n');
    };

    /** The snapshot, or a failed assert that names why it rejected. */
    const snapshotOrFail = (): Promise<ChtCoreSnapshot> =>
      snapshotChtCore(repo).catch((err: Error) => expect.fail(`the snapshot rejected: ${err.message}`));

    it('refuses a path that is deleted in the index but still on disk', async () => {
      await commitFile('d.txt', 'd\n');
      await git('rm', '-q', '--cached', 'd.txt');
      await write('tracked.txt', 'operator work in progress\n');
      await expectRefusedUnchanged('"d.txt" is deleted in the index but still on disk');
    });

    it('refuses a staged rename whose source is on disk again', async () => {
      await commitFile('a.txt', 'a\n');
      await git('mv', 'a.txt', 'b.txt');
      await write('a.txt', 'a new file at the old path\n');
      await expectRefusedUnchanged('"a.txt" is the source of a staged rename');
    });

    it('refuses a tracked file whose path is now a directory', async () => {
      await commitFile('b.txt', 'b\n');
      await fs.rm(path.join(repo, 'b.txt'));
      await fs.mkdir(path.join(repo, 'b.txt'));
      await write('b.txt/inner.txt', 'inside the new dir\n');
      await expectRefusedUnchanged('"b.txt" is a tracked file whose path is now a directory');
    });

    it('refuses an ignored file where a tracked directory was, and the file stays', async () => {
      await commitFile('d/b.txt', 'b\n');
      await commitFile('.gitignore', 'node_modules/\n/d\n');
      await fs.rm(path.join(repo, 'd'), { recursive: true });
      await write('d', 'an ignored operator file\n');
      await expectRefusedUnchanged('"d" is an ignored file where the tracked directory of "d/b.txt" was');
      expect(await read('d')).to.equal('an ignored operator file\n');
    });

    it('refuses a worktree delete below a directory that is now a symbolic link, naming the link', async () => {
      await commitFile('p/n.txt', 'n\n');
      await fs.rm(path.join(repo, 'p'), { recursive: true });
      await fs.mkdir(path.join(repo, 'q'));
      await write('q/n.txt', 'a file the link leads to\n');
      await fs.symlink('q', path.join(repo, 'p'));
      const text = await expectRefusedUnchanged('"p", a directory above "p/n.txt", is now a symbolic link');
      expect(text).to.include('Move "p" away.');
      expect(text).to.not.include('deleted in the index');
    });

    const flagLocalConfig = async () => {
      await commitFile('cfg.txt', 'committed\n');
      await git('update-index', '--assume-unchanged', 'cfg.txt');
      await write('cfg.txt', 'LOCAL EDIT\n');
    };

    it('refuses an assume-unchanged file with a local edit, and the edit stays', async () => {
      await flagLocalConfig();
      await expectRefusedUnchanged('"cfg.txt" is marked assume-unchanged');
      expect(await read('cfg.txt')).to.equal('LOCAL EDIT\n');
    });

    it('its printed way out lets the next run save and restore the edit', async () => {
      await flagLocalConfig();
      const text = await expectRefusedUnchanged('"cfg.txt" is marked assume-unchanged');
      const clear = /Clear the flag with: (git .*)$/m.exec(text)?.[1];
      expect(clear).to.be.a('string');
      await execFileAsync('bash', ['-c', String(clear)]);
      const afterWayOut = await treeState();
      const snapshot = await snapshotOrFail();
      expect(snapshot.stashSha).to.be.a('string');
      await write('cfg.txt', 'a session edit\n');
      const rollback = await rollbackChtCore(repo, snapshot);
      expect(rollback.stashPop).to.equal('ok');
      expect(await treeState()).to.deep.equal(afterWayOut);
      expect(await read('cfg.txt')).to.equal('LOCAL EDIT\n');
    });

    it('refuses a staged symbolic link where a tracked directory was, with no command', async () => {
      await commitFile('d/b.txt', 'b\n');
      await git('rm', '-q', '-r', 'd');
      await fs.symlink('tracked.txt', path.join(repo, 'd'));
      await git('add', 'd');
      const text = await expectRefusedUnchanged('"d", a directory above "d/b.txt", is now a staged symbolic link');
      expect(text).to.include('Commit the change first.');
      expect(text).to.not.include('git -C');
    });

    for (const [variant, stageFileAtD] of [
      ['git add d', async () => {
        await write('d', 'a staged file where the tracked dir was\n');
        await git('add', 'd');
      }],
      ['an AM edit', async () => {
        await write('d', 'a staged file where the tracked dir was\n');
        await git('add', 'd');
        await write('d', 'edited after the add\n');
      }],
      ['git mv x.txt d', async () => {
        await git('mv', 'x.txt', 'd');
      }],
    ] as Array<[string, () => Promise<void>]>) {
      it(`runs a full cycle when a staged file replaced a tracked directory (${variant})`, async () => {
        await commitFile('d/b.txt', 'b\n');
        await commitFile('x.txt', 'a file that git mv moves\n');
        await git('rm', '-q', '-r', 'd');
        await stageFileAtD();
        const before = await treeState();
        const bytes = await read('d');
        const snapshot = await snapshotOrFail();
        await write('session.ts', 'export const s = 1;\n');
        const rollback = await rollbackChtCore(repo, snapshot);
        expect(rollback.stashPop).to.equal('ok');
        expect(await treeState()).to.deep.equal(before);
        expect(await read('d')).to.equal(bytes);
        const { stdout: stashes } = await git('stash', 'list');
        expect(stashes).to.not.include(STASH_MARKER_PREFIX);
      });
    }

    it('refuses a staged add whose file is deleted, and its printed restore lets the next run through', async () => {
      await write('n.txt', 'staged new content\n');
      await git('add', 'n.txt');
      await fs.rm(path.join(repo, 'n.txt'));
      const text = await expectRefusedUnchanged('"n.txt" is staged but deleted from the working tree');
      const restore = /put the file back with: (git .*)$/m.exec(text)?.[1];
      expect(restore).to.be.a('string');
      await execFileAsync('bash', ['-c', String(restore)]);
      expect(await read('n.txt')).to.equal('staged new content\n');
      const afterWayOut = await treeState();
      const snapshot = await snapshotOrFail();
      await write('session.ts', 'export const s = 1;\n');
      const rollback = await rollbackChtCore(repo, snapshot);
      expect(rollback.stashPop).to.equal('ok');
      expect(await treeState()).to.deep.equal(afterWayOut);
    });

    it('refuses a staged rename whose target is deleted', async () => {
      await commitFile('a.txt', 'a\n');
      await git('mv', 'a.txt', 'b.txt');
      await fs.rm(path.join(repo, 'b.txt'));
      await expectRefusedUnchanged('"b.txt" is staged but deleted from the working tree');
    });

    for (const [suffix, withTrackedWork] of [['', false], [' next to tracked work', true]] as Array<[string, boolean]>) {
      it(`runs a full cycle when a tracked directory is now an untracked file${suffix}`, async () => {
        await commitFile('d/b.txt', 'b\n');
        await fs.rm(path.join(repo, 'd'), { recursive: true });
        await write('d', 'a file where the tracked dir was\n');
        if (withTrackedWork) await write('tracked.txt', 'operator work in progress\n');
        const before = await treeState();
        const snapshot = await snapshotOrFail();
        await write('session.ts', 'export const s = 1;\n');
        const rollback = await rollbackChtCore(repo, snapshot);
        expect(rollback.stashPop).to.equal('ok');
        expect(await treeState()).to.deep.equal(before);
        expect(await read('d')).to.equal('a file where the tracked dir was\n');
        const { stdout: stashes } = await git('stash', 'list');
        expect(stashes).to.not.include(STASH_MARKER_PREFIX);
      });
    }

    for (const [label, setUp] of [
      ['a plain staged rename', async () => {
        await commitFile('a.txt', 'a\n');
        await git('mv', 'a.txt', 'b.txt');
      }],
      ['a tracked file replaced by a symlink', async () => {
        await fs.rm(path.join(repo, 'tracked.txt'));
        await fs.symlink('.gitignore', path.join(repo, 'tracked.txt'));
      }],
      ['a staged delete whose file is gone', async () => {
        await commitFile('d.txt', 'd\n');
        await git('rm', '-q', 'd.txt');
      }],
      ['a staged modify whose file is then deleted (MD)', async () => {
        await commitFile('m.txt', 'm1\n');
        await write('m.txt', 'm2\n');
        await git('add', 'm.txt');
        await fs.rm(path.join(repo, 'm.txt'));
      }],
    ] as Array<[string, () => Promise<void>]>) {
      it(`does not refuse ${label}, and a full cycle puts it back exactly`, async () => {
        await setUp();
        const before = await treeState();
        const snapshot = await snapshotChtCore(repo);
        await write('session.ts', 'export const s = 1;\n');
        const rollback = await rollbackChtCore(repo, snapshot);
        expect(rollback.stashPop).to.equal('ok');
        expect(await treeState()).to.deep.equal(before);
      });
    }
  });
});
