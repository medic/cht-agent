import { expect } from 'chai';
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
      // Provision reads these; isolate every test from the ambient env.
      const PROVISION_ENV_KEYS = ['CHT_URL', 'COUCHDB_USER', 'COUCHDB_PASSWORD'];
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
        fetchStub.resolves({ ok: true, status: 200 });
        const realAgent = new TestEnvironmentAgent({ useMockDocker: false });

        const handle = await realAgent.provision({ chtCorePath: '/workspace/cht-core' });

        expect(handle.source).to.equal('docker');
        expect(handle.url).to.equal('https://nginx');
        expect(handle.auth).to.deep.equal({ user: 'medic', password: 'password' });
        expect(handle.network).to.equal('cht-agent-net');
        expect(handle.chtCorePath).to.equal('/workspace/cht-core');
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

      describe('CHT_URL fallback', () => {
        // Env save/clear/restore is handled by the enclosing describe.

        it('should fall back to process.env.CHT_URL when no url option is given', async () => {
          fetchStub.resolves({ ok: true, status: 200 });
          process.env.CHT_URL = 'https://cht.example';
          const realAgent = new TestEnvironmentAgent({ useMockDocker: false });

          const handle = await realAgent.provision({ version: '4.18.0' });

          expect(handle.url).to.equal('https://cht.example');
          expect(fetchStub.firstCall.args[0]).to.equal('https://cht.example/api/v2/monitoring');
        });

        it('should prefer an explicit url option over CHT_URL', async () => {
          fetchStub.resolves({ ok: true, status: 200 });
          process.env.CHT_URL = 'https://cht.example';
          const realAgent = new TestEnvironmentAgent({ useMockDocker: false });

          const handle = await realAgent.provision({ version: '4.18.0', url: 'https://explicit.example' });

          expect(handle.url).to.equal('https://explicit.example');
        });

        it('should ignore a blank CHT_URL and use the on-network default', async () => {
          fetchStub.resolves({ ok: true, status: 200 });
          process.env.CHT_URL = '   ';
          const realAgent = new TestEnvironmentAgent({ useMockDocker: false });

          const handle = await realAgent.provision({ version: '4.18.0' });

          expect(handle.url).to.equal('https://nginx');
        });

        it('should canonicalize a trailing slash so appended paths and tracking keys stay stable', async () => {
          fetchStub.resolves({ ok: true, status: 200 });
          process.env.CHT_URL = 'https://cht.example/';
          const realAgent = new TestEnvironmentAgent({ useMockDocker: false });

          const handle = await realAgent.provision({ version: '4.18.0' });

          expect(handle.url).to.equal('https://cht.example');
          expect(fetchStub.firstCall.args[0]).to.equal('https://cht.example/api/v2/monitoring');
        });

        it('should strip embedded credentials out of the URL (logged + fetch()ed) into the auth fallback', async () => {
          fetchStub.resolves({ ok: true, status: 200 });
          // undici's fetch() rejects credentialed URLs, and handle.url is logged.
          process.env.CHT_URL = 'https://ops:p%40ss@cht.example';
          const realAgent = new TestEnvironmentAgent({ useMockDocker: false });

          const handle = await realAgent.provision({ version: '4.18.0' });

          expect(handle.url).to.equal('https://cht.example');
          expect(handle.auth).to.deep.equal({ user: 'ops', password: 'p@ss' });
          expect(fetchStub.firstCall.args[0]).to.equal('https://cht.example/api/v2/monitoring');
        });

        it('should tolerate a raw % in embedded credentials instead of crashing provision', async () => {
          fetchStub.resolves({ ok: true, status: 200 });
          process.env.CHT_URL = 'https://ops:p%ss@cht.example';
          const realAgent = new TestEnvironmentAgent({ useMockDocker: false });

          const handle = await realAgent.provision({ version: '4.18.0' });

          expect(handle.auth).to.deep.equal({ user: 'ops', password: 'p%ss' });
          expect(handle.url).to.equal('https://cht.example');
        });

        it('should honor the COUCHDB_USER/COUCHDB_PASSWORD env seam (test-env-up.sh parity)', async () => {
          fetchStub.resolves({ ok: true, status: 200 });
          process.env.COUCHDB_USER = 'admin';
          process.env.COUCHDB_PASSWORD = 'not-the-default';
          const realAgent = new TestEnvironmentAgent({ useMockDocker: false });

          const handle = await realAgent.provision({ version: '4.18.0' });

          expect(handle.auth).to.deep.equal({ user: 'admin', password: 'not-the-default' });
        });

        it('should prefer explicit auth over URL-embedded and env credentials', async () => {
          fetchStub.resolves({ ok: true, status: 200 });
          process.env.CHT_URL = 'https://ops:urlpass@cht.example';
          process.env.COUCHDB_PASSWORD = 'envpass';
          const realAgent = new TestEnvironmentAgent({ useMockDocker: false });

          const handle = await realAgent.provision({
            version: '4.18.0',
            auth: { user: 'explicit', password: 'explicitpass' },
          });

          expect(handle.auth).to.deep.equal({ user: 'explicit', password: 'explicitpass' });
        });
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
      let cleanSeededDocsStub: sinon.SinonStub;

      beforeEach(() => {
        realAgent = new TestEnvironmentAgent({ useMockDocker: false });
        runChtConfStub = sinon.stub(chtConfRunner, 'runChtConf');
        runChtConfStub.onCall(0).resolves(okRun(ansiInfo('Summary: 5 of 5 docs uploaded OK.')));
        runChtConfStub.onCall(1).resolves(okRun(ansiInfo('Creating user alice')));
        readSeededDocsStub = sinon.stub(testData, 'readSeededDocs').returns(seededDocs);
        hasUsersCsvStub = sinon.stub(testData, 'hasUsersCsv').returns(true);
        cleanSeededDocsStub = sinon.stub(testData, 'cleanSeededDocs').returns(0);
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

      it('should clear a previous run\'s stale json_docs before converting', async () => {
        cleanSeededDocsStub.returns(3);

        await realAgent.prepareTestData(dockerHandle, sampleConfig, { dataPath });

        expect(cleanSeededDocsStub.calledOnceWith(dataPath)).to.equal(true);
        expect(cleanSeededDocsStub.calledBefore(runChtConfStub)).to.equal(true);
      });

      it('should run csv-to-docs + upload-docs, then create-users, via the runner', async () => {
        await realAgent.prepareTestData(dockerHandle, sampleConfig, { dataPath });

        expect(runChtConfStub.callCount).to.equal(2);
        const docsCall = runChtConfStub.firstCall.args[0];
        expect(docsCall.verbs).to.deep.equal(['csv-to-docs', 'upload-docs']);
        expect(docsCall.instanceUrl).to.equal('https://medic:password@nginx/');
        expect(docsCall.configPath).to.equal(dataPath);
        expect(docsCall.cwd).to.equal(dataPath);
        const usersCall = runChtConfStub.secondCall.args[0];
        expect(usersCall.verbs).to.deep.equal(['create-users']);
        expect(usersCall.configPath).to.equal(dataPath);
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
        runChtConfStub.onCall(1).resolves(okRun([ansiInfo('Creating user alice'), ansiInfo('Creating user bob')].join('\n')));

        const result = await realAgent.prepareTestData(dockerHandle, sampleConfig, { dataPath });

        expect(result.usersCreated).to.equal(2);
      });

      it('should skip create-users when the data project has no users.csv', async () => {
        hasUsersCsvStub.returns(false);

        const result = await realAgent.prepareTestData(dockerHandle, sampleConfig, { dataPath });

        expect(runChtConfStub.callCount).to.equal(1);
        expect(result.usersCreated).to.equal(0);
        expect(result.succeeded).to.equal(true);
      });

      it('should warn on a partial upload without failing the seed', async () => {
        runChtConfStub.onCall(0).resolves(okRun(ansiInfo('Summary: 3 of 5 docs uploaded OK.')));

        const result = await realAgent.prepareTestData(dockerHandle, sampleConfig, { dataPath });

        expect(result.succeeded).to.equal(true);
        expect(result.warnings.join(' ')).to.include('only 3 of 5 docs uploaded');
      });

      it('should warn when nothing was uploaded (no csv inputs)', async () => {
        runChtConfStub.onCall(0).resolves(okRun(ansiInfo('No csv directory found at /mnt/test-data/csv.')));
        readSeededDocsStub.returns([]);
        hasUsersCsvStub.returns(false);

        const result = await realAgent.prepareTestData(dockerHandle, sampleConfig, { dataPath });

        expect(result.seededDocIds).to.deep.equal([]);
        expect(result.warnings.join(' ')).to.include('no docs were uploaded');
      });

      it('should report succeeded:false when the docs run fails, still returning the disk evidence', async () => {
        runChtConfStub.onCall(0).resolves({ exitCode: 1, output: 'ERROR boom', timedOut: false });

        const result = await realAgent.prepareTestData(dockerHandle, sampleConfig, { dataPath });

        expect(result.succeeded).to.equal(false);
        expect(result.warnings.join(' ')).to.include('exited with code 1');
        expect(result.seededDocIds).to.have.lengthOf(5);
      });

      it('should not count the create-users attempt that failed', async () => {
        runChtConfStub
          .onCall(1)
          .resolves({
            exitCode: 1,
            output: [ansiInfo('Creating user alice'), ansiInfo('Creating user bob'), 'ERROR 400'].join('\n'),
            timedOut: false,
          });

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
      it(`should resolve in mock mode for the "${tier}" tier`, async () => {
        const handle = await provisionMock();

        expect(await agent.reset(handle, tier)).to.equal(undefined);
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

      it('should resolve the restart tier (human-gated, agent runs no Docker)', async () => {
        expect(await realAgent.reset(dockerHandle, 'restart')).to.be.undefined;
      });

      it('should resolve the full tier (human-gated, agent runs no Docker)', async () => {
        expect(await realAgent.reset(dockerHandle, 'full')).to.be.undefined;
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
          sinon.stub(testData, 'cleanSeededDocs').returns(0);
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
          await agentUnderTest.reset(dockerHandle, 'couchdb');

          expect(fetchDocRevsStub.called).to.equal(false);
          expect(bulkDocsStub.called).to.equal(false);
          expect(runChtConfStub.called).to.equal(false);
        });

        it('should wipe the tracked docs at their CURRENT revs and reseed from the tracked project', async () => {
          await seedTracking();

          await agentUnderTest.reset(dockerHandle, 'couchdb');

          expect(fetchDocRevsStub.calledOnceWith('https://nginx', dockerHandle.auth, ['place-1', 'person-1']))
            .to.equal(true);
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
          fetchDocRevsStub.resolves([
            { id: 'place-1', rev: '7-live' },
            { id: 'person-1', rev: '2-tomb', deleted: true },
          ]);

          await agentUnderTest.reset(dockerHandle, 'couchdb');

          expect(bulkDocsStub.firstCall.args[2]).to.deep.equal([
            { _id: 'place-1', _rev: '7-live', _deleted: true },
          ]);
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

        it('should throw when the reseed only partially uploads', async () => {
          await seedTracking();
          runChtConfStub.resolves(okRun(ansiInfo('Summary: 1 of 2 docs uploaded OK.')));

          try {
            await agentUnderTest.reset(dockerHandle, 'couchdb');
            expect.fail('expected reset to reject');
          } catch (error) {
            expect((error as Error).message).to.include('reseed uploaded only 1 of 2');
          }
        });

        it('should fail closed BEFORE the wipe when the reseed source is gone', async () => {
          await seedTracking();
          readSeededDocsStub.returns([]); // json_docs vanished since seeding

          try {
            await agentUnderTest.reset(dockerHandle, 'couchdb');
            expect.fail('expected reset to reject');
          } catch (error) {
            expect((error as Error).message).to.include('no docs to reseed from');
          }
          expect(fetchDocRevsStub.called).to.equal(false);
          expect(bulkDocsStub.called).to.equal(false);
        });

        it('should throw when the reseed uploads nothing (upload-docs prints no summary)', async () => {
          await seedTracking();
          runChtConfStub.resolves(okRun(ansiInfo('No docs directory found at /mnt/test-data/json_docs.')));

          try {
            await agentUnderTest.reset(dockerHandle, 'couchdb');
            expect.fail('expected reset to reject');
          } catch (error) {
            expect((error as Error).message).to.include('reseed uploaded only 0 of 2');
          }
        });

        it('should refresh the tracking to the reseeded docs when the dataset shrank', async () => {
          await seedTracking();
          readSeededDocsStub.returns([{ id: 'place-1', type: 'clinic' }]);
          runChtConfStub.resolves(okRun(ansiInfo('Summary: 1 of 1 docs uploaded OK.')));
          await agentUnderTest.reset(dockerHandle, 'couchdb'); // wipes 2, reseeds 1

          fetchDocRevsStub.resetHistory();
          fetchDocRevsStub.resolves([{ id: 'place-1', rev: '9-x' }]);
          bulkDocsStub.resolves([{ id: 'place-1', ok: true }]);
          await agentUnderTest.reset(dockerHandle, 'couchdb');

          expect(fetchDocRevsStub.firstCall.args[2]).to.deep.equal(['place-1']);
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

        it('should clear the tracking on teardown, so a later couchdb reset is a no-op', async () => {
          await seedTracking();

          await agentUnderTest.teardown(dockerHandle);
          await agentUnderTest.reset(dockerHandle, 'couchdb');

          expect(fetchDocRevsStub.called).to.equal(false);
        });
      });
    });
  });

  describe('teardown', () => {
    it('should resolve in mock mode', async () => {
      const handle = await provisionMock();

      expect(await agent.teardown(handle)).to.equal(undefined);
    });

    it('should resolve in real mode (prints the human teardown gate)', async () => {
      const realAgent = new TestEnvironmentAgent({ useMockDocker: false });
      const handle: EnvironmentHandle = {
        url: 'https://nginx',
        auth: { user: 'medic', password: 'password' },
        network: 'cht-agent-net',
        chtCorePath: '/workspace/cht-core',
        source: 'docker',
      };

      expect(await realAgent.teardown(handle)).to.be.undefined;
    });
  });
});
