import { expect } from 'chai';
import * as sinon from 'sinon';
import { TestEnvironmentAgent } from '../../src/agents/test-environment-agent';
import * as chtConfRunner from '../../src/utils/cht-conf-runner';
import {
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
      expect(handle.chtCorePath).to.equal(undefined);
    });

    it('should carry chtCorePath on the handle when built from local code', async () => {
      const handle = await agent.provision({ chtCorePath: '/workspace/cht-core' });

      expect(handle.chtCorePath).to.equal('/workspace/cht-core');
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

    describe('real mode (useMockDocker: false)', () => {
      let fetchStub: sinon.SinonStub;

      beforeEach(() => {
        fetchStub = sinon.stub(globalThis, 'fetch' as any);
      });

      afterEach(() => {
        sinon.restore();
      });

      it('returns a docker handle once the environment is healthy', async () => {
        fetchStub.resolves({ ok: true, status: 200 });
        const realAgent = new TestEnvironmentAgent({ useMockDocker: false });

        const handle = await realAgent.provision({ chtCorePath: '/workspace/cht-core' });

        expect(handle.source).to.equal('docker');
        expect(handle.url).to.equal('https://nginx');
        expect(handle.auth).to.deep.equal({ user: 'medic', password: 'password' });
        expect(handle.network).to.equal('cht-agent-net');
        expect(handle.chtCorePath).to.equal('/workspace/cht-core');
      });

      it('rejects if the environment never becomes ready', async () => {
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

      it('validates input before polling', async () => {
        const realAgent = new TestEnvironmentAgent({ useMockDocker: false });

        try {
          await realAgent.provision({});
          expect.fail('expected provision to reject');
        } catch (error) {
          expect((error as Error).message).to.include('requires either chtCorePath or version');
        }
      });
    });
  });

  describe('applyConfig', () => {
    it('should default to config/default and run all four upload buckets', async () => {
      const handle = await provisionMock();

      const result = await agent.applyConfig(handle);

      expect(result.configPath).to.equal('config/default');
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

      expect(result.artifact).to.equal(undefined);
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

      it('runs cht-conf per action against the instance and aggregates success', async () => {
        const realAgent = new TestEnvironmentAgent({ useMockDocker: false });

        const result = await realAgent.applyConfig(dockerHandle, { actions: ['app-settings', 'app-forms'] });

        expect(runBucketStub.callCount).to.equal(2);
        expect(result.succeeded).to.equal(true);
        expect(result.actions.map((a) => a.action)).to.deep.equal(['app-settings', 'app-forms']);
      });

      it('passes the credentialed instance URL and configPath to the runner', async () => {
        const realAgent = new TestEnvironmentAgent({ useMockDocker: false });

        await realAgent.applyConfig(dockerHandle, { configPath: '/mnt/conf', actions: ['app-forms'] });

        const passed = runBucketStub.firstCall.args[0];
        expect(passed.instanceUrl).to.equal('https://medic:password@nginx/');
        expect(passed.configPath).to.equal('/mnt/conf');
        expect(passed.action).to.equal('app-forms');
      });

      it('threads the targeted artifact through to the runner', async () => {
        const realAgent = new TestEnvironmentAgent({ useMockDocker: false });

        await realAgent.applyConfig(dockerHandle, { actions: ['app-forms'], artifact: 'pregnancy' });

        expect(runBucketStub.firstCall.args[0].artifact).to.equal('pregnancy');
      });

      it('reports succeeded:false when a bucket fails, without aborting the rest', async () => {
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

    it('should throw not-implemented in real mode', async () => {
      const realAgent = new TestEnvironmentAgent({ useMockDocker: false });
      const handle: EnvironmentHandle = {
        url: 'https://nginx',
        auth: { user: 'medic', password: 'password' },
        network: 'cht-agent-net',
        source: 'docker',
      };

      try {
        await realAgent.discoverConfig(handle);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect((error as Error).message).to.include('not yet implemented');
      }
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

    it('should throw not-implemented in real mode', async () => {
      const realAgent = new TestEnvironmentAgent({ useMockDocker: false });
      const handle: EnvironmentHandle = {
        url: 'https://nginx',
        auth: { user: 'medic', password: 'password' },
        network: 'cht-agent-net',
        source: 'docker',
      };

      try {
        await realAgent.prepareTestData(handle, sampleConfig);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect((error as Error).message).to.include('not yet implemented');
      }
    });
  });

  describe('reset', () => {
    const tiers: ResetTier[] = ['couchdb', 'restart', 'full'];

    tiers.forEach(tier => {
      it(`should resolve in mock mode for the "${tier}" tier`, async () => {
        const handle = await provisionMock();

        expect(await agent.reset(handle, tier)).to.equal(undefined);
      });
    });

    describe('real mode (useMockDocker: false)', () => {
      const realAgent = new TestEnvironmentAgent({ useMockDocker: false });
      const dockerHandle: EnvironmentHandle = {
        url: 'https://nginx',
        auth: { user: 'medic', password: 'password' },
        network: 'cht-agent-net',
        chtCorePath: '/workspace/cht-core',
        source: 'docker',
      };

      it('resolves the restart tier (human-gated, agent runs no Docker)', async () => {
        expect(await realAgent.reset(dockerHandle, 'restart')).to.equal(undefined);
      });

      it('resolves the full tier (human-gated, agent runs no Docker)', async () => {
        expect(await realAgent.reset(dockerHandle, 'full')).to.equal(undefined);
      });

      it('defers the couchdb tier to a later phase', async () => {
        try {
          await realAgent.reset(dockerHandle, 'couchdb');
          expect.fail('expected reset to reject');
        } catch (error) {
          expect((error as Error).message).to.include('Phase 3');
        }
      });
    });
  });

  describe('teardown', () => {
    it('should resolve in mock mode', async () => {
      const handle = await provisionMock();

      expect(await agent.teardown(handle)).to.equal(undefined);
    });

    it('resolves in real mode (prints the human teardown gate)', async () => {
      const realAgent = new TestEnvironmentAgent({ useMockDocker: false });
      const handle: EnvironmentHandle = {
        url: 'https://nginx',
        auth: { user: 'medic', password: 'password' },
        network: 'cht-agent-net',
        chtCorePath: '/workspace/cht-core',
        source: 'docker',
      };

      expect(await realAgent.teardown(handle)).to.equal(undefined);
    });
  });
});
