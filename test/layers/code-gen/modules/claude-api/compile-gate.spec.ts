/* eslint-disable @typescript-eslint/no-var-requires */
import { expect } from 'chai';
import * as sinon from 'sinon';
import * as path from 'node:path';

const proxyquire = require('proxyquire').noCallThru();

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
      headSha: 'abc1234', stashRef: null, stashName: null, baselineUntracked: [],
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
      '../claude-code-cli/workspace': { snapshotChtCore: snapshotStub, rollbackChtCore: rollbackStub },
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
    const result = await run(CHT, [file()]);
    expect(result.skipped).to.equal(true);
    expect(result.skipReason).to.match(/snapshot failed/);
    expect(rollbackStub.called).to.equal(false);
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

  it('throws and logs a recovery checklist when the rollback hard reset fails', async () => {
    const run = load();
    rollbackStub.resolves({ reset: 'failed', clean: 'ok', stashPop: 'skipped', errors: ['reset blew up'] });
    const errSpy = sinon.stub(console, 'error');
    let threw = false;
    try {
      await run(CHT, [file()]);
    } catch (err) {
      threw = true;
      expect((err as Error).message).to.match(/rollback failed/);
    }
    expect(threw).to.equal(true);
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

  it('includes the stash-pop line in the recovery checklist when a stash was taken', async () => {
    const run = load();
    snapshotStub.resolves({
      headSha: 'abc1234', stashRef: 'stash@{0}', stashName: 'api-gate', baselineUntracked: [],
    });
    rollbackStub.resolves({ reset: 'failed', clean: 'ok', stashPop: 'failed', errors: ['reset failed'] });
    const errSpy = sinon.stub(console, 'error');
    let threw = false;
    try {
      await run(CHT, [file()]);
    } catch {
      threw = true;
    }
    expect(threw).to.equal(true);
    const logged = errSpy.getCalls().map(c => String(c.args[0])).join('\n');
    expect(logged).to.match(/git stash pop stash@\{0\}/);
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
});
