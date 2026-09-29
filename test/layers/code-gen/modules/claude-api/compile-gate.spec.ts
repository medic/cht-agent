/* eslint-disable @typescript-eslint/no-var-requires */
import { expect } from 'chai';
import * as sinon from 'sinon';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { execFileSync } from 'node:child_process';
import * as realWorkspace from '../../../../../src/layers/code-gen/modules/claude-code-cli/workspace';
import {
  WorkspaceSafetyError,
  buildRecoveryChecklist,
  ChtCoreSnapshot,
  RollbackResult,
  STASH_MARKER_PREFIX,
} from '../../../../../src/layers/code-gen/modules/claude-code-cli/workspace';

const proxyquire = require('proxyquire').noCallThru();


/** The real workspace module with snapshot and rollback replaced. */
const workspaceStub = (stubs: Record<string, unknown>) => ({ ...realWorkspace, ...stubs });

describe('runApiCompileGate (claude-api compile gate)', () => {
  const CHT = '/tmp/fake-cht-core';

  let snapshotStub: sinon.SinonStub;
  let rollbackStub: sinon.SinonStub;
  let compileStub: sinon.SinonStub;
  let existsSyncStub: sinon.SinonStub;
  let mkdirStub: sinon.SinonStub;
  let writeStub: sinon.SinonStub;
  let realpathSyncStub: sinon.SinonStub;
  let lstatSyncStub: sinon.SinonStub;

  // (Re)build the stubs and load the module fresh; workspace, compile-validator,
  // and node:fs are all stubbed so no real git/tsc/disk is touched. realpathSync
  // defaults to identity (no symlinks); tests override it to simulate an escape.
  const load = () => {
    snapshotStub = sinon.stub().resolves({
      headSha: 'abc1234', headRef: 'refs/heads/master', repoRoot: '/tmp/fake-cht-core',
      stashSha: null, stashName: null, baselineUntracked: [],
    });
    rollbackStub = sinon.stub().resolves({ reset: 'ok', clean: 'ok', stashPop: 'skipped', errors: [] });
    compileStub = sinon.stub().resolves({ passed: true, issues: [] });
    existsSyncStub = sinon.stub().returns(true); // .git present + ancestors exist by default
    mkdirStub = sinon.stub();
    writeStub = sinon.stub();
    realpathSyncStub = sinon.stub().callsFake((p: string) => p); // identity: no symlinks
    // Default: leaf does not exist yet (normal create case). Tests override per path.
    lstatSyncStub = sinon.stub().throws(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    const mod = proxyquire('../../../../../src/layers/code-gen/modules/claude-api/compile-gate', {
      'node:fs': {
        existsSync: existsSyncStub,
        mkdirSync: mkdirStub,
        writeFileSync: writeStub,
        realpathSync: realpathSyncStub,
        lstatSync: lstatSyncStub,
      },
      '../claude-code-cli/workspace': workspaceStub({ snapshotChtCore: snapshotStub, rollbackChtCore: rollbackStub }),
      '../../../../agents/compile-validator': { compileCheck: compileStub },
    });
    return mod.runApiCompileGate as (
      chtCorePath: string,
      files: ReadonlyArray<{ path: string; content: string }>,
    ) => Promise<{ passed: boolean; issues: unknown[]; skipped?: boolean; skipReason?: string }>;
  };

  const file = (p = 'webapp/x.ts') => ({ path: p, content: 'export const x = 1;\n' });

  afterEach(() => sinon.restore());

  it('returns pass without touching disk when there are no files', async () => {
    const run = load();
    const result = await run(CHT, []);
    expect(result.passed).to.equal(true);
    expect(result.skipped).to.not.equal(true);
    expect(snapshotStub.called).to.equal(false);
  });

  it('skips with a reason when cht-core is not a git repo', async () => {
    const run = load();
    existsSyncStub.returns(false);
    const result = await run(CHT, [file()]);
    expect(result.skipped).to.equal(true);
    expect(result.skipReason).to.match(/not a git repo/);
    expect(snapshotStub.called).to.equal(false);
  });

  it('skips (no rollback) when the snapshot fails', async () => {
    const run = load();
    snapshotStub.rejects(new Error('cht-core has unmerged paths'));
    const warnSpy = sinon.stub(console, 'warn');
    const result = await run(CHT, [file()]);
    expect(result.skipped).to.equal(true);
    expect(result.skipReason).to.match(/snapshot failed/);
    expect(rollbackStub.called).to.equal(false);
    expect(warnSpy.getCalls().map(c => String(c.args[0])).join('\n')).to.include('Compile gate skipped: snapshot failed');
  });

  it("passes the run's stash policy, with its own prefix, to the snapshot and the rollback", async () => {
    // Loaded here, not at the top, so that this file still loads where the holder does not exist.
    const holder = await import('../../../../../src/utils/stash-policy');
    holder.setStashPolicy({ acceptedLeftoverShas: ['a'.repeat(40)] });
    try {
      const run = load();
      await run(CHT, [file()]);
      const expected = { acceptedLeftoverShas: ['a'.repeat(40)], logPrefix: '[claude-api compile-gate]' };
      expect(snapshotStub.firstCall.args[1]).to.deep.equal(expected);
      expect(rollbackStub.firstCall.args[2]).to.deep.equal(expected);
    } finally {
      holder.__resetStashPolicyForTests();
    }
  });

  it('skips when the snapshot refused before it changed anything', async () => {
    const run = load();
    snapshotStub.rejects(new WorkspaceSafetyError('precondition', 'in the middle of a merge (MERGE_HEAD)'));
    sinon.stub(console, 'warn');
    const result = await run(CHT, [file()]);
    expect(result.skipped).to.equal(true);
    expect(result.skipReason).to.include('MERGE_HEAD');
    expect(rollbackStub.called).to.equal(false);
  });

  it('prints every line of a snapshot refusal once, then skips', async () => {
    const run = load();
    const refusal = new WorkspaceSafetyError('precondition', 'git stash cannot put these changes back exactly.', {
      lines: ['git stash cannot put these changes back exactly.', '  - "d" is an ignored file. Move "d" away.', 'Then run again.'],
    });
    snapshotStub.rejects(refusal);
    const errSpy = sinon.stub(console, 'error');
    const warnSpy = sinon.stub(console, 'warn');
    const result = await run(CHT, [file()]);
    expect(result.skipped).to.equal(true);
    expect(result.skipReason).to.equal('snapshot failed: git stash cannot put these changes back exactly.');
    expect(errSpy.getCalls().map(c => String(c.args[0]))).to.deep.equal([
      '[claude-api compile-gate] git stash cannot put these changes back exactly.',
      '[claude-api compile-gate]   - "d" is an ignored file. Move "d" away.',
      '[claude-api compile-gate] Then run again.',
    ]);
    expect(warnSpy.getCalls().map(c => String(c.args[0]))).to.deep.equal([
      '[claude-api compile-gate] Compile gate skipped (see the lines above).',
    ]);
    expect(rollbackStub.called).to.equal(false);
  });

  it('halts, without a rollback, when the snapshot stash step failed', async () => {
    const run = load();
    const stashFailure = new WorkspaceSafetyError('stash', 'git stash could not save your work', {
      lines: ['git stash could not save your work'],
    });
    snapshotStub.rejects(stashFailure);
    const errSpy = sinon.stub(console, 'error');
    let thrown: unknown;
    try {
      await run(CHT, [file()]);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).to.equal(stashFailure);
    expect(rollbackStub.called).to.equal(false);
    expect(errSpy.getCalls().map(c => String(c.args[0]))).to.include('[claude-api compile-gate] git stash could not save your work');
  });

  it('materializes files, compiles, and rolls back on a clean pass', async () => {
    const run = load();
    const result = await run(CHT, [file('webapp/x.ts')]);
    expect(result.passed).to.equal(true);
    expect(writeStub.calledOnce).to.equal(true);
    expect(writeStub.firstCall.args[0]).to.equal(path.resolve(CHT, 'webapp/x.ts'));
    expect(compileStub.calledOnceWith(CHT)).to.equal(true);
    expect(rollbackStub.calledOnce).to.equal(true);
  });

  it('folds compile failures into the result and still rolls back', async () => {
    const run = load();
    const issue = { filePath: 'webapp/x.ts', issueType: 'compile-error', description: 'TS2322 at line 1: nope' };
    compileStub.resolves({ passed: false, issues: [issue] });
    const result = await run(CHT, [file()]);
    expect(result.passed).to.equal(false);
    expect(result.issues).to.deep.equal([issue]);
    expect(rollbackStub.calledOnce).to.equal(true);
  });

  it('propagates a compile-validator skip (e.g., tsc unavailable) and rolls back', async () => {
    const run = load();
    compileStub.resolves({ passed: true, issues: [], skipped: true, skipReason: 'tsc not available' });
    const result = await run(CHT, [file()]);
    expect(result.skipped).to.equal(true);
    expect(result.skipReason).to.match(/tsc not available/);
    expect(rollbackStub.calledOnce).to.equal(true);
  });

  it('throws a halt error and logs a recovery checklist when the rollback hard reset fails', async () => {
    const run = load();
    rollbackStub.resolves({ reset: 'failed', clean: 'skipped', stashPop: 'skipped', errors: ['reset: reset blew up'] });
    const errSpy = sinon.stub(console, 'error');
    let thrown: unknown;
    try {
      await run(CHT, [file()]);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).to.be.instanceOf(WorkspaceSafetyError);
    expect((thrown as Error).message).to.match(/rollback failed/);
    expect(errSpy.called).to.equal(true);
  });

  it('rejects path-traversal files but still compiles in-bounds ones', async () => {
    const run = load();
    const warnSpy = sinon.stub(console, 'warn');
    await run(CHT, [file('../evil.ts'), file('ok.ts')]);
    expect(writeStub.calledOnce).to.equal(true);
    expect(writeStub.firstCall.args[0]).to.equal(path.resolve(CHT, 'ok.ts'));
    expect(warnSpy.called).to.equal(true);
    expect(compileStub.calledOnce).to.equal(true);
  });

  it('rejects absolute file paths (outside cht-core)', async () => {
    const run = load();
    const warnSpy = sinon.stub(console, 'warn');
    await run(CHT, [file('/etc/evil.ts'), file('ok.ts')]);
    expect(writeStub.calledOnce).to.equal(true);
    expect(writeStub.firstCall.args[0]).to.equal(path.resolve(CHT, 'ok.ts'));
    expect(warnSpy.called).to.equal(true);
  });

  it('rejects a file whose lexically-in-bounds path escapes via a symlinked ancestor directory', async () => {
    const run = load();
    const warnSpy = sinon.stub(console, 'warn');
    // 'app/link' is (pretends to be) a symlink whose real path is outside cht-core.
    realpathSyncStub.withArgs(path.resolve(CHT, 'app/link')).returns('/tmp/outside/SECRET');
    await run(CHT, [file('app/link/pwned.ts'), file('ok.ts')]);
    expect(writeStub.calledOnce).to.equal(true);
    expect(writeStub.firstCall.args[0]).to.equal(path.resolve(CHT, 'ok.ts'));
    expect(warnSpy.called).to.equal(true);
  });

  it('rejects any path inside a .git directory (those writes survive rollback)', async () => {
    const run = load();
    const warnSpy = sinon.stub(console, 'warn');
    await run(CHT, [file('.git/hooks/pre-commit'), file('.git/config'), file('ok.ts')]);
    expect(writeStub.calledOnce).to.equal(true);
    expect(writeStub.firstCall.args[0]).to.equal(path.resolve(CHT, 'ok.ts'));
    expect(warnSpy.called).to.equal(true);
  });

  it('rejects a pre-existing symlink at the write leaf', async () => {
    const run = load();
    const warnSpy = sinon.stub(console, 'warn');
    // The leaf 'link.ts' is a pre-existing symlink; lstat detects it before write.
    lstatSyncStub.withArgs(path.resolve(CHT, 'link.ts')).returns({ isSymbolicLink: () => true });
    await run(CHT, [file('link.ts'), file('ok.ts')]);
    expect(writeStub.calledOnce).to.equal(true);
    expect(writeStub.firstCall.args[0]).to.equal(path.resolve(CHT, 'ok.ts'));
    expect(warnSpy.called).to.equal(true);
  });

  it('walks up to the nearest existing ancestor when the immediate parent does not exist', async () => {
    const run = load();
    existsSyncStub.withArgs(path.resolve(CHT, 'a/b')).returns(false);
    existsSyncStub.withArgs(path.resolve(CHT, 'a')).returns(false);
    const result = await run(CHT, [file('a/b/c.ts')]);
    expect(result.passed).to.equal(true);
    expect(writeStub.calledOnce).to.equal(true);
    expect(writeStub.firstCall.args[0]).to.equal(path.resolve(CHT, 'a/b/c.ts'));
  });

  it('skips when the compile validator itself throws', async () => {
    const run = load();
    compileStub.rejects(new Error('tsc process exploded'));
    const result = await run(CHT, [file()]);
    expect(result.skipped).to.equal(true);
    expect(result.skipReason).to.match(/compile gate raised/);
    expect(rollbackStub.calledOnce).to.equal(true);
  });

  it('prints the outcome-based checklist, with the stash kept, when the reset fails', async () => {
    const run = load();
    const snapshot: ChtCoreSnapshot = {
      headSha: 'abc1234', headRef: 'refs/heads/master', repoRoot: '/tmp/fake-cht-core',
      stashSha: '1111111111111111111111111111111111111111', stashName: `${STASH_MARKER_PREFIX}1700000000000`,
      baselineUntracked: [],
    };
    const rollback: RollbackResult = {
      reset: 'failed', clean: 'skipped', stashPop: 'skipped',
      errors: ["reset: fatal: Unable to create '/tmp/fake-cht-core/.git/index.lock': File exists."],
      sessionEdits: ['webapp/x.ts'], survivors: [],
    };
    snapshotStub.resolves(snapshot);
    rollbackStub.resolves(rollback);
    const errSpy = sinon.stub(console, 'error');
    let thrown: unknown;
    try {
      await run(CHT, [file()]);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).to.be.instanceOf(WorkspaceSafetyError);
    const logged = errSpy.getCalls().map(c => String(c.args[0]));
    const expected = buildRecoveryChecklist(CHT, snapshot, rollback).map(l => `[claude-api compile-gate] ${l}`);
    expect(expected.length).to.be.greaterThan(0);
    expect(logged).to.include.members(expected);
    const text = logged.join('\n');
    expect(text).to.include(`still in stash ${STASH_MARKER_PREFIX}1700000000000`);
    expect(text).to.include('only if no git process runs');
    expect(text).to.not.match(/stash@\{\d+\}/);
    expect(text).to.not.include('stash drop');
  });

  it('returns the session files the rollback could not remove as warnings', async () => {
    const run = load();
    rollbackStub.resolves({
      reset: 'ok', clean: 'failed', stashPop: 'skipped', errors: ['clean: still on disk'], survivors: ['webapp/.gitignore'],
    });
    sinon.stub(console, 'error');
    const result = await run(CHT, [file()]) as { warnings?: string[] };
    expect(result.warnings).to.have.length(1);
    expect(result.warnings![0]).to.include('"webapp/.gitignore"');
  });

  it('throws a stash halt error when the rollback could not restore the stash', async () => {
    const run = load();
    rollbackStub.resolves({
      reset: 'ok', clean: 'ok', stashPop: 'failed', errors: ['stash apply: error: conflicts in index'],
    });
    sinon.stub(console, 'error');
    let thrown: unknown;
    try {
      await run(CHT, [file()]);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).to.be.instanceOf(WorkspaceSafetyError);
    expect((thrown as { kind: string }).kind).to.equal('stash');
  });

  it('skips compilation (no compileCheck) when every file is out of bounds', async () => {
    const run = load();
    sinon.stub(console, 'warn');
    const result = await run(CHT, [file('../evil.ts')]);
    expect(result.skipped).to.equal(true);
    expect(result.skipReason).to.match(/no in-bounds files/);
    expect(compileStub.called).to.equal(false);
    expect(rollbackStub.calledOnce).to.equal(true);
  });

  it('skips with a reason when materialization throws, and still rolls back', async () => {
    const run = load();
    writeStub.throws(new Error('EACCES'));
    const result = await run(CHT, [file()]);
    expect(result.skipped).to.equal(true);
    expect(result.skipReason).to.match(/materialization failed/);
    expect(rollbackStub.calledOnce).to.equal(true);
  });

  describe('with the real workspace module', () => {
    let repo: string;
    const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });

    beforeEach(() => {
      repo = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-prefix-'));
      git('init', '-q');
      git('config', 'user.name', 'Test');
      git('config', 'user.email', 'test@example.com');
      git('config', 'commit.gpgsign', 'false');
      fs.writeFileSync(path.join(repo, 'tracked.txt'), 'committed\n');
      git('add', '.');
      git('commit', '-q', '-m', 'initial');
    });

    afterEach(() => fs.rmSync(repo, { recursive: true, force: true }));

    it('prints its own prefix, not the claude-code-cli one, for the stash it takes', async () => {
      fs.writeFileSync(path.join(repo, 'tracked.txt'), 'operator work\n');
      const compileCheck = sinon.stub().resolves({ passed: true, issues: [] });
      const { runApiCompileGate } = proxyquire('../../../../../src/layers/code-gen/modules/claude-api/compile-gate', {
        '../../../../agents/compile-validator': { compileCheck },
      });
      const printed: string[] = [];
      for (const level of ['log', 'warn', 'error'] as const) {
        sinon.stub(console, level).callsFake((...args: unknown[]) => { printed.push(args.map(String).join(' ')); });
      }
      const result = await runApiCompileGate(repo, [file('src/new.ts')]);
      sinon.restore();
      expect(compileCheck.calledOnce).to.equal(true);
      expect(result.skipped).to.not.equal(true);
      expect(printed.some(l => l.startsWith('[claude-api compile-gate] Stashed your uncommitted work'))).to.equal(true);
      expect(printed.filter(l => l.includes('[claude-code-cli]'))).to.deep.equal([]);
      expect(fs.readFileSync(path.join(repo, 'tracked.txt'), 'utf8')).to.equal('operator work\n');
      expect(fs.existsSync(path.join(repo, 'src/new.ts'))).to.equal(false);
    });
  });
});
