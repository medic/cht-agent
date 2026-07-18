import { expect } from 'chai';
import * as sinon from 'sinon';
import { EventEmitter } from 'node:events';
import {
  buildChtConfArgs,
  classifyChtConfOutput,
  CONFIG_ACTION_COMMANDS,
  resolveChtConfBin,
} from '../../src/utils/cht-conf-runner';
import { ChtConfExecOptions, ChtConfExecResult, ChtConfRunOptions, ConfigActionResult } from '../../src/types';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const proxyquire = require('proxyquire').noCallThru();

// A fake child process: an EventEmitter with stdout/stderr emitters and a kill spy.
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

const baseOpts = (overrides: Partial<ChtConfRunOptions> = {}): ChtConfRunOptions => ({
  action: 'app-forms',
  instanceUrl: 'https://medic:password@nginx/',
  configPath: '/mnt/conf',
  ...overrides,
});

type SpawnLog = { cmd: string; args: string[]; opts: Record<string, unknown> };

// Load the runner with a stubbed spawn that returns `proc` and records the call.
const loadRunner = (proc: EventEmitter) => {
  const spawnLog: SpawnLog[] = [];
  const spawnStub = sinon.stub().callsFake((cmd: string, args: string[], opts: Record<string, unknown>) => {
    spawnLog.push({ cmd, args, opts });
    return proc;
  });
  const mod = proxyquire('../../src/utils/cht-conf-runner', {
    'node:child_process': { spawn: spawnStub },
  });
  return {
    runBucket: mod.runBucket as (o: ChtConfRunOptions) => Promise<ConfigActionResult>,
    runChtConf: mod.runChtConf as (o: ChtConfExecOptions) => Promise<ChtConfExecResult>,
    spawnLog,
  };
};

describe('cht-conf-runner', () => {
  describe('buildChtConfArgs', () => {
    it('includes the url, source, autonomous-safe flags, and the bucket verbs', () => {
      const args = buildChtConfArgs(baseOpts());

      expect(args).to.include('--url=https://medic:password@nginx/');
      expect(args).to.include('--source=/mnt/conf');
      expect(args).to.include('--force');
      expect(args).to.include('--accept-self-signed-certs');
      expect(args).to.include('convert-app-forms');
      expect(args).to.include('upload-app-forms');
    });

    it('appends the artifact as a `--`-separated form filter for form buckets', () => {
      const args = buildChtConfArgs(baseOpts({ action: 'app-forms', artifact: 'pregnancy' }));

      // main.js rejects bare positionals as unsupported actions; only
      // `-- <arg>` reaches environment.extraArgs / args-form-filter.
      expect(args.slice(-2)).to.deep.equal(['--', 'pregnancy']);
    });

    it('does not emit a dangling `--` separator when there is no artifact', () => {
      const args = buildChtConfArgs(baseOpts({ action: 'app-forms' }));

      expect(args).to.not.include('--');
    });

    it('does not append the artifact for non-form buckets', () => {
      const args = buildChtConfArgs(baseOpts({ action: 'app-settings', artifact: 'pregnancy' }));

      expect(args).to.not.include('pregnancy');
    });

    it('app-settings-only uploads without compiling (pre-compiled deployment recovery)', () => {
      expect(CONFIG_ACTION_COMMANDS['app-settings-only']).to.deep.equal(['upload-app-settings']);
      const args = buildChtConfArgs(baseOpts({ action: 'app-settings-only' }));
      expect(args).to.include('upload-app-settings');
      expect(args).to.not.include('compile-app-settings');
    });
  });

  describe('resolveChtConfBin', () => {
    let saved: string | undefined;
    beforeEach(() => { saved = process.env.CHT_CONF_BIN; });
    afterEach(() => {
      if (saved === undefined) { delete process.env.CHT_CONF_BIN; } else { process.env.CHT_CONF_BIN = saved; }
    });

    it('defaults to the global cht binary', () => {
      delete process.env.CHT_CONF_BIN;
      expect(resolveChtConfBin()).to.equal('cht');
    });

    it('honours CHT_CONF_BIN so the agent can run a deployment-pinned cht-conf from a full path', () => {
      process.env.CHT_CONF_BIN = '/workspace/site-config-test/node_modules/.bin/cht';
      expect(resolveChtConfBin()).to.equal('/workspace/site-config-test/node_modules/.bin/cht');
    });
  });

  describe('classifyChtConfOutput', () => {
    // Literal cht-conf log strings (verified against the installed cht-conf src:
    // upload-forms.js, upload-app-settings.js, upload-custom-translations.js,
    // upload-configuration-docs.js). The skip strings all contain "uploaded"/
    // "updated", so naive substring matching misclassifies them — these guard
    // that regression.
    const UPLOADED = {
      form: 'Form forms/app/pregnancy.xml uploaded',
      settings: 'Settings updated successfully',
      translation: 'Translation translations/messages-en.properties uploaded',
      config: 'Configuration upload complete!',
    };
    const SKIPPED = {
      form: 'Form forms/app/pregnancy.xml not uploaded, no changes',
      settings: 'Settings not updated - no changes detected',
      translation: 'Translation translations/messages-en.properties not uploaded as no changes were found',
      config: 'Configuration not uploaded as no changes found',
    };

    it('returns failed for a non-zero exit code regardless of output', () => {
      expect(classifyChtConfOutput(UPLOADED.form, 1)).to.equal('failed');
    });

    it('classifies each bucket-type real upload line as uploaded', () => {
      expect(classifyChtConfOutput(UPLOADED.form, 0)).to.equal('uploaded');
      expect(classifyChtConfOutput(UPLOADED.settings, 0)).to.equal('uploaded');
      expect(classifyChtConfOutput(UPLOADED.translation, 0)).to.equal('uploaded');
      expect(classifyChtConfOutput(UPLOADED.config, 0)).to.equal('uploaded');
    });

    it('classifies each bucket-type real "no changes" line as skipped (despite the word "uploaded")', () => {
      expect(classifyChtConfOutput(SKIPPED.form, 0)).to.equal('skipped');
      expect(classifyChtConfOutput(SKIPPED.settings, 0)).to.equal('skipped');
      expect(classifyChtConfOutput(SKIPPED.translation, 0)).to.equal('skipped');
      expect(classifyChtConfOutput(SKIPPED.config, 0)).to.equal('skipped');
    });

    it('returns uploaded for a multi-form bucket where some uploaded and some skipped', () => {
      const output = [SKIPPED.form, UPLOADED.form].join('\n');

      expect(classifyChtConfOutput(output, 0)).to.equal('uploaded');
    });

    it('defaults to uploaded on a clean exit with ambiguous output', () => {
      expect(classifyChtConfOutput('done', 0)).to.equal('uploaded');
    });
  });

  describe('runChtConf', () => {
    const execOpts = (overrides: Partial<ChtConfExecOptions> = {}): ChtConfExecOptions => ({
      verbs: ['csv-to-docs', 'upload-docs'],
      instanceUrl: 'https://medic:password@nginx/',
      configPath: '/mnt/data',
      ...overrides,
    });

    afterEach(() => {
      sinon.restore();
    });

    it('spawns the verbs in order after the url, source, and autonomous-safe flags', async () => {
      const proc = makeFakeProc();
      const { runChtConf, spawnLog } = loadRunner(proc);

      const promise = runChtConf(execOpts({ extraArgs: ['pregnancy'] }));
      proc.emit('close', 0);
      await promise;

      const args = spawnLog[0].args;
      expect(args[0]).to.equal('--url=https://medic:password@nginx/');
      expect(args[1]).to.equal('--source=/mnt/data');
      expect(args).to.include('--force');
      // Verbs run in the given order; extras ride after the `--` separator
      // (a bare positional would make cht-conf throw "Unsupported action(s)").
      expect(args.slice(-4)).to.deep.equal(['csv-to-docs', 'upload-docs', '--', 'pregnancy']);
    });

    it('passes the cwd through so cht-conf report files land in the data project', async () => {
      const proc = makeFakeProc();
      const { runChtConf, spawnLog } = loadRunner(proc);

      const promise = runChtConf(execOpts({ cwd: '/mnt/data' }));
      proc.emit('close', 0);
      await promise;

      expect(spawnLog[0].opts.cwd).to.equal('/mnt/data');
    });

    it('does not set a cwd (and never a shell) unless asked', async () => {
      const proc = makeFakeProc();
      const { runChtConf, spawnLog } = loadRunner(proc);

      const promise = runChtConf(execOpts());
      proc.emit('close', 0);
      await promise;

      expect(spawnLog[0].opts).to.not.have.property('cwd');
      expect(spawnLog[0].opts).to.not.have.property('shell');
    });

    it('applies the minimal env allow-list to the child', async () => {
      const proc = makeFakeProc();
      const { runChtConf, spawnLog } = loadRunner(proc);
      const prior = process.env.ANTHROPIC_API_KEY;
      process.env.ANTHROPIC_API_KEY = 'sk-should-not-leak';

      const promise = runChtConf(execOpts());
      proc.emit('close', 0);
      await promise;

      const childEnv = spawnLog[0].opts.env as NodeJS.ProcessEnv;
      expect(childEnv).to.not.have.property('ANTHROPIC_API_KEY');
      expect(childEnv).to.have.property('PATH');
      if (prior === undefined) {
        delete process.env.ANTHROPIC_API_KEY;
      } else {
        process.env.ANTHROPIC_API_KEY = prior;
      }
    });

    it('collects interleaved stdout and stderr into output with the exit code', async () => {
      const proc = makeFakeProc();
      const { runChtConf } = loadRunner(proc);

      const promise = runChtConf(execOpts());
      proc.stdout.emit('data', Buffer.from('INFO Summary: 3 of 3 docs uploaded OK.\n'));
      proc.stderr.emit('data', Buffer.from('some stderr noise\n'));
      proc.emit('close', 3);

      const result = await promise;
      expect(result.exitCode).to.equal(3);
      expect(result.timedOut).to.equal(false);
      expect(result.output).to.include('Summary: 3 of 3 docs uploaded OK.');
      expect(result.output).to.include('some stderr noise');
    });

    it('kills the process and reports timedOut when the run times out', async () => {
      const proc = makeFakeProc();
      const { runChtConf } = loadRunner(proc);

      // Tiny timeout, and the fake proc never emits 'close' → the timer fires.
      const result = await runChtConf(execOpts({ timeoutMs: 5 }));

      expect(proc.kill.calledWith('SIGTERM')).to.equal(true);
      expect(result.timedOut).to.equal(true);
      expect(result.exitCode).to.equal(null);
    });

    it('folds a spawn failure into startError instead of rejecting', async () => {
      const proc = makeFakeProc();
      const { runChtConf } = loadRunner(proc);

      const promise = runChtConf(execOpts());
      proc.emit('error', new Error('ENOENT'));

      const result = await promise;
      expect(result.startError).to.equal('ENOENT');
      expect(result.exitCode).to.equal(null);
    });
  });

  describe('runBucket', () => {
    afterEach(() => {
      sinon.restore();
    });

    it('spawns the configured bin with no shell and resolves uploaded on clean exit', async () => {
      const proc = makeFakeProc();
      const { runBucket, spawnLog } = loadRunner(proc);

      const promise = runBucket(baseOpts({ bin: 'fake-cht' }));
      proc.stdout.emit('data', Buffer.from('Form forms/app/pregnancy.xml uploaded'));
      proc.emit('close', 0);

      const result = await promise;
      expect(spawnLog).to.have.length(1);
      expect(spawnLog[0].cmd).to.equal('fake-cht');
      expect(spawnLog[0].opts).to.not.have.property('shell');
      expect(result.status).to.equal('uploaded');
      expect(result.commands).to.deep.equal(['convert-app-forms', 'upload-app-forms']);
    });

    it('does not pass secret-bearing env vars to the cht-conf child', async () => {
      const proc = makeFakeProc();
      const { runBucket, spawnLog } = loadRunner(proc);
      const prior = process.env.ANTHROPIC_API_KEY;
      process.env.ANTHROPIC_API_KEY = 'sk-should-not-leak';

      const promise = runBucket(baseOpts());
      proc.emit('close', 0);
      await promise;

      const childEnv = spawnLog[0].opts.env as NodeJS.ProcessEnv;
      expect(childEnv).to.not.have.property('ANTHROPIC_API_KEY');
      expect(childEnv).to.have.property('PATH');
      if (prior === undefined) {
        delete process.env.ANTHROPIC_API_KEY;
      } else {
        process.env.ANTHROPIC_API_KEY = prior;
      }
    });

    it('resolves skipped on cht-conf\'s real "not uploaded, no changes" line', async () => {
      const proc = makeFakeProc();
      const { runBucket } = loadRunner(proc);

      const promise = runBucket(baseOpts());
      proc.stdout.emit('data', Buffer.from('Form forms/app/pregnancy.xml not uploaded, no changes'));
      proc.emit('close', 0);

      const result = await promise;
      expect(result.status).to.equal('skipped');
    });

    it('kills the process and resolves failed when the bucket times out', async () => {
      const proc = makeFakeProc();
      const { runBucket } = loadRunner(proc);

      // Tiny timeout, and the fake proc never emits 'close' → the timer fires.
      const result = await runBucket(baseOpts({ timeoutMs: 5 }));

      expect(proc.kill.calledWith('SIGTERM')).to.equal(true);
      expect(result.status).to.equal('failed');
      expect(result.warnings.join(' ')).to.include('timed out');
    });

    it('resolves failed on a non-zero exit', async () => {
      const proc = makeFakeProc();
      const { runBucket } = loadRunner(proc);

      const promise = runBucket(baseOpts());
      proc.stderr.emit('data', Buffer.from('boom'));
      proc.emit('close', 2);

      const result = await promise;
      expect(result.status).to.equal('failed');
    });

    it('resolves failed (not throws) when the process fails to start', async () => {
      const proc = makeFakeProc();
      const { runBucket } = loadRunner(proc);

      const promise = runBucket(baseOpts());
      proc.emit('error', new Error('ENOENT'));

      const result = await promise;
      expect(result.status).to.equal('failed');
      expect(result.warnings.join(' ')).to.include('failed to start');
    });

    it('warns and ignores artifact targeting for non-form buckets', async () => {
      const proc = makeFakeProc();
      const { runBucket } = loadRunner(proc);

      const promise = runBucket(baseOpts({ action: 'app-settings', artifact: 'pregnancy' }));
      proc.emit('close', 0);

      const result = await promise;
      expect(result.warnings.join(' ')).to.include('artifact targeting ignored');
    });
  });
});
