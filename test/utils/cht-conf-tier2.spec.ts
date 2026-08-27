import { expect } from 'chai';
import * as sinon from 'sinon';
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  findFormSpecs,
  findTier2Specs,
  parseMochaPassing,
  resolveRepoMocha,
  runTier2,
  tier2PassLine,
  tier2TailExcerpt,
} from '../../src/utils/cht-conf-tier2';

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

  // F9: tier-2 output visibility helpers (used by the QA panel/transition).
  describe('parseMochaPassing (F9)', () => {
    it('parses the mocha spec-reporter passing count', () => {
      expect(parseMochaPassing('  12 passing (3s)\n')).to.equal(12);
    });

    it('takes the LAST passing summary (ignores incidental "passing" text)', () => {
      const out = 'the run is passing along\n  ...\n  5 passing (1s)\n  1 pending\n';
      expect(parseMochaPassing(out)).to.equal(5);
    });

    it('returns undefined when there is no summary line', () => {
      expect(parseMochaPassing('No usable sandbox!\nboom\n')).to.equal(undefined);
      expect(parseMochaPassing(undefined)).to.equal(undefined);
      expect(parseMochaPassing('')).to.equal(undefined);
    });
  });

  describe('tier2PassLine (F9)', () => {
    it('includes the passing count when present', () => {
      expect(tier2PassLine('  9 passing (2s)')).to.equal('tier-2 passed (9 passing)');
    });

    it('degrades to a countless one-liner when no summary is present', () => {
      expect(tier2PassLine('crashed before epilogue')).to.equal('tier-2 passed');
      expect(tier2PassLine(undefined)).to.equal('tier-2 passed');
    });
  });

  describe('tier2TailExcerpt (F9)', () => {
    it('keeps only the last N lines, each prefixed', () => {
      const out = Array.from({ length: 40 }, (_, i) => `line${i}`).join('\n');
      const excerpt = tier2TailExcerpt(out, 5);
      const lines = excerpt.split('\n');
      expect(lines).to.have.length(5);
      expect(lines[0]).to.match(/^\s+│ line35$/);
      expect(lines[4]).to.match(/^\s+│ line39$/);
      // earlier lines are dropped
      expect(excerpt).to.not.include('line0');
    });

    it('trims leading/trailing blank lines before taking the tail', () => {
      const out = '\n\n  1 failing\n\n\n';
      const excerpt = tier2TailExcerpt(out);
      expect(excerpt.split('\n')).to.have.length(1);
      expect(excerpt).to.match(/1 failing$/);
    });

    it('reports a placeholder when there is no output', () => {
      expect(tier2TailExcerpt(undefined)).to.match(/no tier-2 output captured/);
      expect(tier2TailExcerpt('   \n  \n')).to.match(/no tier-2 output captured/);
    });
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

  describe('findTier2Specs — per-artifact selection (P5)', () => {
    const writeSpec = (r: string, ...rel: string[]) => {
      const abs = path.join(r, ...rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, '// spec\n');
    };

    it('form: the form harness spec(s) under test/forms/', () => {
      root = mkTmp();
      writeSpec(root, 'test', 'forms', `${FORM}.spec.js`);
      writeSpec(root, 'test', 'forms', `${FORM}.agent.spec.js`);
      const res = findTier2Specs(root, { configArtifact: 'form', artifactName: FORM });
      expect(res.specs).to.deep.equal([
        path.join('test', 'forms', `${FORM}.spec.js`),
        path.join('test', 'forms', `${FORM}.agent.spec.js`),
      ]);
      expect(res.reason).to.equal(undefined);
    });

    it('contact-form: the same test/forms/<form>*.spec.js selection', () => {
      root = mkTmp();
      writeSpec(root, 'test', 'forms', 'e_household-create.agent.spec.js');
      const res = findTier2Specs(root, { configArtifact: 'contact-form', artifactName: 'e_household-create' });
      expect(res.specs).to.deep.equal([path.join('test', 'forms', 'e_household-create.agent.spec.js')]);
    });

    it('form: honest skip (reason) when no spec exists', () => {
      root = mkTmp();
      const res = findTier2Specs(root, { configArtifact: 'form', artifactName: FORM });
      expect(res.specs).to.deep.equal([]);
      expect(res.reason).to.match(/no harness spec/);
    });

    it('task/target: every test/tasks/*.spec.js (sorted)', () => {
      root = mkTmp();
      writeSpec(root, 'test', 'tasks', 'b_service.spec.js');
      writeSpec(root, 'test', 'tasks', 'a_service.spec.js');
      writeSpec(root, 'test', 'tasks', 'notaspec.js'); // ignored (not *.spec.js)
      const task = findTier2Specs(root, { configArtifact: 'task', artifactName: 'x' });
      expect(task.specs).to.deep.equal([
        path.join('test', 'tasks', 'a_service.spec.js'),
        path.join('test', 'tasks', 'b_service.spec.js'),
      ]);
      const target = findTier2Specs(root, { configArtifact: 'target', artifactName: 'x' });
      expect(target.specs).to.deep.equal(task.specs);
    });

    it('task: honest skip when test/tasks has no specs', () => {
      root = mkTmp();
      const res = findTier2Specs(root, { configArtifact: 'task', artifactName: 'x' });
      expect(res.specs).to.deep.equal([]);
      expect(res.reason).to.match(/test\/tasks/);
    });

    it('contact-summary: the root spec + the directory suite', () => {
      root = mkTmp();
      writeSpec(root, 'test', 'contact-summary.spec.js');
      writeSpec(root, 'test', 'contact-summary', 'pregnancy.spec.js');
      const res = findTier2Specs(root, { configArtifact: 'contact-summary', artifactName: 'x' });
      expect(res.specs).to.deep.equal([
        path.join('test', 'contact-summary.spec.js'),
        path.join('test', 'contact-summary', 'pregnancy.spec.js'),
      ]);
    });

    it('app-settings: requires qaSpecs (honest skip recommending the frontmatter)', () => {
      root = mkTmp();
      const res = findTier2Specs(root, { configArtifact: 'app-settings', artifactName: 'app-settings' });
      expect(res.specs).to.deep.equal([]);
      expect(res.reason).to.match(/qaSpecs/);
    });

    it('generatedSpecs: unioned with pinned qaSpecs (pins must not displace them — m4)', () => {
      root = mkTmp();
      writeSpec(root, 'test', 'tasks', 'immunization_service.spec.js');
      writeSpec(root, 'test', 'contact-summary.agent.spec.js');
      const res = findTier2Specs(root, {
        configArtifact: 'contact-summary',
        artifactName: 'is_immunization_defaulter',
        qaSpecs: ['test/tasks/immunization_service.spec.js'],
        generatedSpecs: [path.join('test', 'contact-summary.agent.spec.js')],
      });
      expect(res.specs).to.deep.equal([
        'test/tasks/immunization_service.spec.js',
        path.join('test', 'contact-summary.agent.spec.js'),
      ]);
    });

    it('generatedSpecs: nonexistent entries are dropped silently', () => {
      root = mkTmp();
      writeSpec(root, 'test', 'tasks', 'a.spec.js');
      const res = findTier2Specs(root, {
        configArtifact: 'task',
        artifactName: 'x',
        generatedSpecs: [path.join('test', 'tasks', 'never-written.agent.spec.js')],
      });
      expect(res.specs).to.deep.equal([path.join('test', 'tasks', 'a.spec.js')]);
    });

    it('generatedSpecs: rescue an empty DEFAULT selection (they are the only coverage)', () => {
      root = mkTmp();
      writeSpec(root, 'test', 'contact-summary.agent.spec.js');
      const res = findTier2Specs(root, {
        configArtifact: 'app-settings', // default selection has no specs, only a reason
        artifactName: 'x',
        generatedSpecs: [path.join('test', 'contact-summary.agent.spec.js')],
      });
      expect(res.specs).to.deep.equal([path.join('test', 'contact-summary.agent.spec.js')]);
      expect(res.reason).to.equal(undefined);
    });

    it('generatedSpecs: never rescue a MISSING pinned entry (config error stays loud)', () => {
      root = mkTmp();
      writeSpec(root, 'test', 'contact-summary.agent.spec.js');
      const res = findTier2Specs(root, {
        configArtifact: 'contact-summary',
        artifactName: 'x',
        qaSpecs: ['test/tasks/does-not-exist.spec.js'],
        generatedSpecs: [path.join('test', 'contact-summary.agent.spec.js')],
      });
      expect(res.specs).to.deep.equal([]);
      expect(res.reason).to.match(/pinned qaSpecs not found/);
    });

    it('qaSpecs: runs EXACTLY the pinned specs (defaults ignored)', () => {
      root = mkTmp();
      writeSpec(root, 'test', 'tasks', 'immunization_service.spec.js');
      writeSpec(root, 'test', 'tasks', 'other.spec.js'); // present but NOT pinned
      const res = findTier2Specs(root, {
        configArtifact: 'task',
        artifactName: 'x',
        qaSpecs: ['test/tasks/immunization_service.spec.js'],
      });
      expect(res.specs).to.deep.equal(['test/tasks/immunization_service.spec.js']);
      expect(res.reason).to.equal(undefined);
    });

    it('qaSpecs: a directory entry expands to *.spec.js directly inside it', () => {
      root = mkTmp();
      writeSpec(root, 'test', 'tasks', 'a.spec.js');
      writeSpec(root, 'test', 'tasks', 'b.spec.js');
      writeSpec(root, 'test', 'tasks', 'nested', 'c.spec.js'); // NOT expanded (non-recursive)
      const res = findTier2Specs(root, {
        configArtifact: 'task',
        artifactName: 'x',
        qaSpecs: ['test/tasks'],
      });
      expect(res.specs).to.deep.equal([
        path.join('test', 'tasks', 'a.spec.js'),
        path.join('test', 'tasks', 'b.spec.js'),
      ]);
    });

    it('qaSpecs: a MISSING entry is an honest skip naming it (never a silent partial run)', () => {
      root = mkTmp();
      writeSpec(root, 'test', 'tasks', 'present.spec.js');
      const res = findTier2Specs(root, {
        configArtifact: 'task',
        artifactName: 'x',
        qaSpecs: ['test/tasks/present.spec.js', 'test/tasks/missing.spec.js'],
      });
      expect(res.specs).to.deep.equal([]);
      expect(res.reason).to.match(/not found/);
      expect(res.reason).to.include('test/tasks/missing.spec.js');
      expect(res.reason).to.not.include('present.spec.js');
    });

    it('qaSpecs: de-duplicates when two entries name the same file', () => {
      root = mkTmp();
      writeSpec(root, 'test', 'tasks', 'x.spec.js');
      const res = findTier2Specs(root, {
        configArtifact: 'task',
        artifactName: 'x',
        qaSpecs: ['test/tasks/x.spec.js', 'test/tasks/x.spec.js'],
      });
      expect(res.specs).to.deep.equal(['test/tasks/x.spec.js']);
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

    it('honors pinned qaSpecs, runs exactly those, and carries them on the result', async () => {
      root = mkTmp();
      scaffoldRunnableRepo(root, { withSpec: false });
      const formsDir = path.join(root, 'test', 'tasks');
      fs.mkdirSync(formsDir, { recursive: true });
      fs.writeFileSync(path.join(formsDir, 'immunization_service.spec.js'), '// spec\n');
      fs.writeFileSync(path.join(formsDir, 'other.spec.js'), '// not pinned\n');
      const proc = makeFakeProc();
      const { fn, calls } = makeSpawnFn(proc);
      const promise = runTier2({
        configRoot: root,
        configArtifact: 'task',
        artifactName: 'newborn-immunization-followup',
        qaSpecs: ['test/tasks/immunization_service.spec.js'],
        spawnFn: fn,
      });
      proc.emit('close', 0);
      const res = await promise;
      expect(res.ran).to.equal(true);
      expect(res.passed).to.equal(true);
      expect(res.specs).to.deep.equal(['test/tasks/immunization_service.spec.js']);
      // mocha got exactly the pinned spec, not the sibling.
      expect(calls[0].args[0]).to.equal('test/tasks/immunization_service.spec.js');
      expect(calls[0].args).to.not.include(path.join('test', 'tasks', 'other.spec.js'));
    });

    it('self-skips (ran:false) naming a missing pinned qaSpec', async () => {
      root = mkTmp();
      scaffoldRunnableRepo(root, { withSpec: false });
      const res = await runTier2({
        configRoot: root,
        configArtifact: 'task',
        artifactName: 'x',
        qaSpecs: ['test/tasks/missing.spec.js'],
      });
      expect(res.ran).to.equal(false);
      expect(res.reason).to.include('test/tasks/missing.spec.js');
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

describe('tier-2 failure classification and cause extraction', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires, n/no-missing-require, n/no-unpublished-require
  const { isTier2EnvironmentalFailure, tier2TailExcerpt } = require('../../src/utils/cht-conf-tier2');

  // Chromium prints its diagnosis first, then ~40 stack frames and a register
  // dump. A plain tail shows the operator register values instead of the cause.
  const CHROMIUM_CRASH = [
    'Error: Failed to launch the browser process!',
    '[0805/192020.615918:FATAL:zygote_host_impl_linux.cc(117)] No usable sandbox!',
    '#0 0x5b6ec534af49 base::debug::CollectStackTrace()',
    '#1 0x5b6ec52b4933 base::debug::StackTrace::StackTrace()',
    '  r8: 0000000000000000  r9: 0000000000000000 r10: 0000000000000008',
    ' trp: 0000000000000000 msk: 0000000000000000 cr2: 0000000000000000',
    '[end of stack trace]',
    '    at onClose (node_modules/puppeteer-core/lib/cjs/puppeteer/node/BrowserRunner.js:197:20)',
  ].join('\n');

  const ASSERTION_FAILURE = [
    '  1) PNC task resolves',
    '  0 passing (2s)',
    '  1 failing',
    '  AssertionError: expected 2 tasks to equal 1',
  ].join('\n');

  describe('isTier2EnvironmentalFailure', () => {
    it('detects a Chromium sandbox crash', () => {
      expect(isTier2EnvironmentalFailure(CHROMIUM_CRASH)).to.equal(true);
    });

    it('does not misread a genuine assertion failure as environmental', () => {
      expect(isTier2EnvironmentalFailure(ASSERTION_FAILURE)).to.equal(false);
    });

    it('is false when there is no output', () => {
      expect(isTier2EnvironmentalFailure(undefined)).to.equal(false);
    });
  });

  describe('tier2TailExcerpt cause preference', () => {
    it('surfaces the launch failure instead of the register dump', () => {
      const excerpt = tier2TailExcerpt(CHROMIUM_CRASH);
      expect(excerpt).to.contain('No usable sandbox!');
      expect(excerpt).to.contain('Failed to launch the browser process');
      expect(excerpt).to.not.contain('r8: 0000');
      expect(excerpt).to.not.contain('[end of stack trace]');
    });

    it('surfaces the assertion for a genuine spec failure', () => {
      const excerpt = tier2TailExcerpt(ASSERTION_FAILURE);
      expect(excerpt).to.contain('1 failing');
      expect(excerpt).to.contain('AssertionError');
    });

    it('falls back to the tail when no line names a cause', () => {
      const excerpt = tier2TailExcerpt('alpha\nbravo\ncharlie', 2);
      expect(excerpt).to.contain('bravo');
      expect(excerpt).to.contain('charlie');
    });
  });
});

describe('tier-2 baseline attribution', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires, n/no-missing-require, n/no-unpublished-require
  const t2 = require('../../src/utils/cht-conf-tier2');
  const { parseMochaFailing, newTier2Failures, tier2FailuresArePreExisting, tier2BaselineLine } = t2;

  const result = (over: Record<string, unknown> = {}) => ({
    ran: true, passed: false, outputTail: '129 passing\n4 failing', ...over,
  });

  describe('parseMochaFailing', () => {
    it('reads the failing count from the epilogue', () => {
      expect(parseMochaFailing('  129 passing (2m)\n  4 failing')).to.equal(4);
    });

    it('is undefined when the summary never printed (a crash)', () => {
      expect(parseMochaFailing('No usable sandbox!')).to.equal(undefined);
    });
  });

  describe('newTier2Failures', () => {
    it('subtracts pre-existing failures from the post-fix count', () => {
      expect(newTier2Failures(result({ baseline: { ran: true, passed: false, failing: 1 } }))).to.equal(3);
    });

    it('is 0 when the same failures were already there', () => {
      expect(newTier2Failures(result({ baseline: { ran: true, passed: false, failing: 4 } }))).to.equal(0);
    });

    it('counts every failure as new when the baseline passed', () => {
      expect(newTier2Failures(result({ baseline: { ran: true, passed: true, failing: 0 } }))).to.equal(4);
    });

    // Unknown must never be reported as "no new failures", or a real regression
    // would be silently excused.
    it('is undefined — not 0 — when no baseline could be established', () => {
      expect(newTier2Failures(result({ baseline: { ran: false, reason: 'no git' } }))).to.equal(undefined);
      expect(tier2FailuresArePreExisting(result({ baseline: { ran: false } }))).to.equal(false);
    });

    it('is undefined when the post-fix count is unparseable', () => {
      const crashed = result({ outputTail: 'No usable sandbox!', baseline: { ran: true, passed: false, failing: 1 } });
      expect(newTier2Failures(crashed)).to.equal(undefined);
    });
  });

  describe('tier2BaselineLine', () => {
    it('says every failure is new when the baseline passed', () => {
      expect(tier2BaselineLine(result({ baseline: { ran: true, passed: true, failing: 0 } })))
        .to.contain('every failure below is new');
    });

    it('names the pre-existing and new split', () => {
      expect(tier2BaselineLine(result({ baseline: { ran: true, passed: false, failing: 1 } })))
        .to.contain('1 pre-existing failure(s), 3 NEW');
    });

    it('says NO new failures when the counts match', () => {
      expect(tier2BaselineLine(result({ baseline: { ran: true, passed: false, failing: 4 } })))
        .to.contain('NO new failures');
    });

    it('is explicit when attribution was impossible', () => {
      expect(tier2BaselineLine(result({ baseline: { ran: false, reason: 'no HEAD' } })))
        .to.contain('NOT attributed');
    });
  });
});

describe('tier-2 baseline scoping (filesToRevert)', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires, n/no-missing-require, n/no-unpublished-require
  const { filesToRevert } = require('../../src/utils/cht-conf-tier2');

  const DIRTY = [
    'common-extras.js', 'tasks.js',           // the fix
    'harness.defaults.json',                  // environment: Chromium --no-sandbox args
    'README.md', 'translations/messages-en.properties',
  ];
  const FIX = ['common-extras.js', 'tasks.js'];

  // Reverting harness.defaults.json stripped the harness's --no-sandbox args, so
  // the baseline's Chromium could not launch and measured nothing.
  it('reverts only the fix, leaving environment and unrelated files alone', () => {
    const reverted = filesToRevert(DIRTY, FIX);
    expect(reverted).to.deep.equal(FIX);
    expect(reverted).to.not.include('harness.defaults.json');
    expect(reverted).to.not.include('README.md');
  });

  it('falls back to every tracked change when the fix list is unknown', () => {
    expect(filesToRevert(DIRTY, undefined)).to.deep.equal(DIRTY);
    expect(filesToRevert(DIRTY, [])).to.deep.equal(DIRTY);
  });

  it('does not mutate the caller\'s fix list', () => {
    const fix = [...FIX];
    filesToRevert(DIRTY, fix).push('injected.js');
    expect(fix).to.deep.equal(FIX);
  });

});
