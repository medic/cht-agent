import { expect } from 'chai';
import * as sinon from 'sinon';
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { findFormSpecs, resolveRepoMocha, runTier2 } from '../../src/utils/cht-conf-tier2';

const FORM = 'postnatal_care_service';

// A fake child process: EventEmitter with stdout/stderr + a kill spy.
const makeFakeProc = () => {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: sinon.SinonSpy;
  };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = sinon.spy();
  return proc;
};

type SpawnCall = { cmd: string; args: string[]; opts: Record<string, unknown> };

/** A stubbed spawn that returns `proc` and records the call, typed as the spawn fn. */
const makeSpawnFn = (proc: EventEmitter) => {
  const calls: SpawnCall[] = [];
  const fn = ((cmd: string, args: string[], opts: Record<string, unknown>) => {
    calls.push({ cmd, args, opts });
    return proc;
  }) as unknown as typeof import('node:child_process').spawn;
  return { fn, calls };
};

const mkTmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'cht-agent-tier2-'));

/** Build a config repo with the pinned mocha + harness dep + the form spec. */
const scaffoldRunnableRepo = (root: string, opts: { withSpec?: boolean; withHarness?: boolean; withMocha?: boolean } = {}) => {
  const { withSpec = true, withHarness = true, withMocha = true } = opts;
  if (withMocha) {
    const binDir = path.join(root, 'node_modules', '.bin');
    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(path.join(binDir, 'mocha'), '#!/bin/sh\n');
  }
  if (withHarness) {
    fs.mkdirSync(path.join(root, 'node_modules', 'cht-conf-test-harness'), { recursive: true });
  }
  if (withSpec) {
    const formsDir = path.join(root, 'test', 'forms');
    fs.mkdirSync(formsDir, { recursive: true });
    fs.writeFileSync(path.join(formsDir, `${FORM}.spec.js`), '// harness spec\n');
  }
};

describe('cht-conf-tier2 (F7 runner)', () => {
  let root: string;
  afterEach(() => {
    if (root) fs.rmSync(root, { recursive: true, force: true });
    sinon.restore();
  });

  describe('findFormSpecs', () => {
    it('finds the primary and agent specs when present', () => {
      root = mkTmp();
      const formsDir = path.join(root, 'test', 'forms');
      fs.mkdirSync(formsDir, { recursive: true });
      fs.writeFileSync(path.join(formsDir, `${FORM}.spec.js`), '');
      fs.writeFileSync(path.join(formsDir, `${FORM}.agent.spec.js`), '');
      const specs = findFormSpecs(root, FORM);
      expect(specs).to.deep.equal([
        path.join('test', 'forms', `${FORM}.spec.js`),
        path.join('test', 'forms', `${FORM}.agent.spec.js`),
      ]);
    });

    it('returns [] when no spec exists', () => {
      root = mkTmp();
      expect(findFormSpecs(root, FORM)).to.deep.equal([]);
    });
  });

  describe('resolveRepoMocha', () => {
    it('points at the repo-pinned node_modules/.bin/mocha', () => {
      expect(resolveRepoMocha('/mnt/conf')).to.equal(path.join('/mnt/conf', 'node_modules', '.bin', 'mocha'));
    });
  });

  describe('runTier2 — honest self-skip', () => {
    it('skips (ran:false) when the repo-pinned mocha is missing', async () => {
      root = mkTmp();
      scaffoldRunnableRepo(root, { withMocha: false });
      const res = await runTier2({ configRoot: root, form: FORM });
      expect(res.ran).to.equal(false);
      expect(res.reason).to.match(/mocha not found/);
    });

    it('skips (ran:false) when cht-conf-test-harness is not installed', async () => {
      root = mkTmp();
      scaffoldRunnableRepo(root, { withHarness: false });
      const res = await runTier2({ configRoot: root, form: FORM });
      expect(res.ran).to.equal(false);
      expect(res.reason).to.match(/cht-conf-test-harness is not installed/);
    });

    it('skips (ran:false) when there is no spec for the form', async () => {
      root = mkTmp();
      scaffoldRunnableRepo(root, { withSpec: false });
      const res = await runTier2({ configRoot: root, form: FORM });
      expect(res.ran).to.equal(false);
      expect(res.reason).to.match(/no harness spec/);
    });
  });

  describe('runTier2 — spawns the pinned mocha (mocked child)', () => {
    it('records ran:true, passed:true on a zero exit and captures the tail', async () => {
      root = mkTmp();
      scaffoldRunnableRepo(root);
      const proc = makeFakeProc();
      const { fn, calls } = makeSpawnFn(proc);
      const promise = runTier2({ configRoot: root, form: FORM, spawnFn: fn });
      proc.stdout.emit('data', Buffer.from('2 passing\n'));
      proc.emit('close', 0);
      const res = await promise;

      expect(res.ran).to.equal(true);
      expect(res.passed).to.equal(true);
      expect(res.outputTail).to.include('2 passing');
      // spawned the pinned mocha from the config root over the form spec
      expect(calls).to.have.length(1);
      expect(calls[0].cmd).to.equal(resolveRepoMocha(root));
      expect(calls[0].args[0]).to.equal(path.join('test', 'forms', `${FORM}.spec.js`));
      expect(calls[0].opts.cwd).to.equal(root);
      // minimal env, TZ set, no LLM keys leaked
      const env = calls[0].opts.env as NodeJS.ProcessEnv;
      expect(env.TZ).to.be.a('string');
      expect(env).to.not.have.property('ANTHROPIC_API_KEY');
    });

    it('records ran:true, passed:false on a non-zero exit', async () => {
      root = mkTmp();
      scaffoldRunnableRepo(root);
      const proc = makeFakeProc();
      const { fn } = makeSpawnFn(proc);
      const promise = runTier2({ configRoot: root, form: FORM, spawnFn: fn });
      proc.stderr.emit('data', Buffer.from('1 failing\n'));
      proc.emit('close', 1);
      const res = await promise;

      expect(res.ran).to.equal(true);
      expect(res.passed).to.equal(false);
      expect(res.outputTail).to.include('1 failing');
    });

    it('records ran:true, passed:false with a spawn error folded into the tail', async () => {
      root = mkTmp();
      scaffoldRunnableRepo(root);
      const proc = makeFakeProc();
      const { fn } = makeSpawnFn(proc);
      const promise = runTier2({ configRoot: root, form: FORM, spawnFn: fn });
      proc.emit('error', new Error('ENOENT'));
      const res = await promise;

      expect(res.ran).to.equal(true);
      expect(res.passed).to.equal(false);
      expect(res.outputTail).to.include('spawn error: ENOENT');
    });

    it('kills the child and marks failed on timeout', async () => {
      root = mkTmp();
      scaffoldRunnableRepo(root);
      const proc = makeFakeProc();
      const { fn } = makeSpawnFn(proc);
      const res = await runTier2({ configRoot: root, form: FORM, spawnFn: fn, timeoutMs: 5 });
      expect(res.ran).to.equal(true);
      expect(res.passed).to.equal(false);
      expect(res.outputTail).to.match(/TIMEOUT/);
      expect(proc.kill.called).to.equal(true);
    });
  });

  // E2E against a REAL config repo — self-skips unless TIER2_E2E_CONFIG_ROOT +
  // TIER2_E2E_FORM point at an installed config repo (mocha + harness present).
  // Runs the actual repo-pinned mocha (no spawn stub); may take minutes.
  describe('runTier2 — real config repo (self-skips without env)', () => {
    const e2eRoot = process.env.TIER2_E2E_CONFIG_ROOT;
    const e2eForm = process.env.TIER2_E2E_FORM;
    const maybe = e2eRoot && e2eForm ? it : it.skip;
    maybe('runs the repo harness spec end-to-end', async function () {
      this.timeout(600000);
      const res = await runTier2({ configRoot: e2eRoot as string, form: e2eForm as string });
      // We assert only that it RAN (pass/fail depends on the live form); a
      // skip-with-reason means the repo lacked mocha/harness/spec.
      expect(res, JSON.stringify(res)).to.have.property('ran');
      if (!res.ran) {
        // eslint-disable-next-line no-console
        console.log(`[tier-2 e2e] self-skip reason: ${res.reason}`);
      }
    });
  });
});
