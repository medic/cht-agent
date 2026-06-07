import { expect } from 'chai';
import { TestEnvironmentAgent } from '../../src/agents/test-environment-agent';
import { DiscoveredConfig, EnvironmentHandle, ProvisionOptions, ResetTier } from '../../src/types';

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

    it('should throw not-implemented in real mode', async () => {
      const realAgent = new TestEnvironmentAgent({ useMockDocker: false });

      try {
        await realAgent.provision({ chtCorePath: '/workspace/cht-core' });
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect((error as Error).message).to.include('not yet implemented');
      }
    });
  });

  describe('applyConfig', () => {
    it('should resolve in mock mode with the default config path', async () => {
      const handle = await provisionMock();

      await agent.applyConfig(handle);
    });

    it('should resolve in mock mode with an explicit config path', async () => {
      const handle = await provisionMock();

      await agent.applyConfig(handle, 'config/standard');
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
        await realAgent.applyConfig(handle);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect((error as Error).message).to.include('not yet implemented');
      }
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

        await agent.reset(handle, tier);
      });
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
        await realAgent.reset(handle, 'full');
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect((error as Error).message).to.include('not yet implemented');
      }
    });
  });

  describe('teardown', () => {
    it('should resolve in mock mode', async () => {
      const handle = await provisionMock();

      await agent.teardown(handle);
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
        await realAgent.teardown(handle);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect((error as Error).message).to.include('not yet implemented');
      }
    });
  });
});
