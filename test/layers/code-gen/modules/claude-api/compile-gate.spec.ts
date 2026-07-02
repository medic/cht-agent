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

  // (Re)build the stubs and load the module fresh; workspace, compile-validator,
  // and node:fs are all stubbed so no real git/tsc/disk is touched.
  const load = () => {
    snapshotStub = sinon.stub().resolves({ headSha: 'abc1234', stashRef: null, stashName: null });
    rollbackStub = sinon.stub().resolves({ reset: 'ok', clean: 'ok', stashPop: 'skipped', errors: [] });
    compileStub = sinon.stub().resolves({ passed: true, issues: [] });
    existsSyncStub = sinon.stub().returns(true); // .git present by default
    mkdirStub = sinon.stub();
    writeStub = sinon.stub();
    const mod = proxyquire('../../../../../src/layers/code-gen/modules/claude-api/compile-gate', {
      'node:fs': { existsSync: existsSyncStub, mkdirSync: mkdirStub, writeFileSync: writeStub },
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
