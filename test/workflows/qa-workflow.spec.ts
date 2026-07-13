import { expect } from 'chai';
import * as sinon from 'sinon';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { TestEnvironmentAgent } from '../../src/agents/test-environment-agent';
import * as prompt from '../../src/utils/prompt';
import {
  createQaInput,
  defaultApplyActions,
  deriveVerifyOptions,
  executeQaWorkflow,
} from '../../src/workflows/qa-workflow';
import { CONFIG_ACTION_COMMANDS } from '../../src/utils/cht-conf-runner';
import { applyXlsformFixToProject } from '../../src/utils/xlsform-apply';
import { XlsformFixDescriptor } from '../../src/utils/xlsform-fix';
import { canOfflineConvert } from '../helpers/offline-convert';
import {
  ConfigApplyResult,
  DiscoveredConfig,
  EnvironmentHandle,
  IssueTemplate,
  QaInput,
  TestDataResult,
  VerifyArtifactResult,
} from '../../src/types';

const YES_GATE = "selected(../pregnancy_summary/visit_option, 'yes')";
const PLANTED_GATE = `${YES_GATE} or selected(../pregnancy_summary/visit_option, 'miscarriage')`;

const formIssue = (overrides: Partial<IssueTemplate['issue']['technical_context']> = {}): IssueTemplate => ({
  issue: {
    title: 'Pregnancy home visit danger-signs',
    type: 'bug',
    priority: 'high',
    description: 'miscarriage should skip danger_signs',
    technical_context: {
      domain: 'forms-and-reports',
      components: [],
      layer: 'cht-conf',
      configArtifact: 'form',
      artifactName: 'pregnancy_home_visit',
      ...overrides,
    },
    requirements: [],
    acceptance_criteria: [],
    constraints: [],
  },
} as IssueTemplate);

const HANDLE: EnvironmentHandle = {
  url: 'https://nginx',
  auth: { user: 'medic', password: 'password' },
  network: 'cht-agent-net',
  source: 'docker',
};

const discovered = (rev: string): DiscoveredConfig => ({
  contactTypes: [],
  roles: {},
  permissions: {},
  transitions: {},
  forms: ['pregnancy_home_visit'],
  formVersions: { pregnancy_home_visit: rev },
});

const verifyResult = (passed: boolean): VerifyArtifactResult => ({
  artifact: 'pregnancy_home_visit',
  configArtifact: 'form',
  passed,
  checks: [{ nodeset: '/data/danger_signs', expected: YES_GATE, actual: passed ? YES_GATE : PLANTED_GATE, passed }],
  summary: passed ? 'all bind assertion(s) passed' : '1 bind assertion(s) failed (/data/danger_signs)',
});

const applyOk: ConfigApplyResult = {
  configPath: '/mnt/conf',
  artifact: 'pregnancy_home_visit',
  actions: [{ action: 'app-forms', status: 'uploaded', commands: ['convert-app-forms', 'upload-app-forms'], warnings: [] }],
  succeeded: true,
  warnings: [],
};

const testData: TestDataResult = {
  placesCreated: 1, peopleCreated: 1, reportsCreated: 1, usersCreated: 1,
  warnings: [], succeeded: true, seededDocIds: ['seed-1'],
};

const makeQaInput = (overrides: Partial<QaInput> = {}): QaInput => ({
  issue: formIssue(),
  configPath: '/mnt/conf',
  verify: {
    configArtifact: 'form',
    artifactName: 'pregnancy_home_visit',
    expectedBinds: [{ nodeset: '/data/danger_signs', relevant: YES_GATE }],
  },
  applyActions: ['app-forms'],
  provision: { chtCorePath: '/workspace/cht-core' },
  autoApprove: true,
  ...overrides,
});

/** A mock-mode agent with every method stubbed; verifyArtifact returns red then green. */
const stubbedAgent = () => {
  const agent = new TestEnvironmentAgent({ useMockDocker: true });
  const stubs = {
    provision: sinon.stub(agent, 'provision').resolves(HANDLE),
    discoverConfig: sinon.stub(agent, 'discoverConfig'),
    verifyArtifact: sinon.stub(agent, 'verifyArtifact'),
    prepareTestData: sinon.stub(agent, 'prepareTestData').resolves(testData),
    applyConfig: sinon.stub(agent, 'applyConfig').resolves(applyOk),
  };
  stubs.discoverConfig.onFirstCall().resolves(discovered('1-pre')).onSecondCall().resolves(discovered('2-post'));
  stubs.verifyArtifact.onFirstCall().resolves(verifyResult(false)).onSecondCall().resolves(verifyResult(true));
  return { agent, stubs };
};

describe('qa-workflow', () => {
  afterEach(() => sinon.restore());

  describe('executeQaWorkflow — red → fix → green', () => {
    it('runs the phases in order and reports the red→green transition', async () => {
      const { agent, stubs } = stubbedAgent();

      const result = await executeQaWorkflow(agent, makeQaInput({ testDataPath: '/mnt/conf' }));

      expect(result.succeeded).to.equal(true);
      expect(result.reproduced).to.equal(true);
      expect(result.verified).to.equal(true);
      expect(result.redEvidence?.passed).to.equal(false);
      expect(result.greenEvidence?.passed).to.equal(true);
      expect(result.revChanged).to.equal(true);
      // Phase order: provision → discover → reproduce → seed → apply → verify
      expect(stubs.provision.calledBefore(stubs.discoverConfig)).to.equal(true);
      expect(stubs.discoverConfig.getCall(0).calledBefore(stubs.verifyArtifact.getCall(0))).to.equal(true);
      expect(stubs.verifyArtifact.getCall(0).calledBefore(stubs.applyConfig.getCall(0))).to.equal(true);
      expect(stubs.prepareTestData.calledBefore(stubs.applyConfig)).to.equal(true);
      expect(stubs.applyConfig.getCall(0).calledBefore(stubs.verifyArtifact.getCall(1))).to.equal(true);
    });

    it('applies the fix to the named artifact via the app-forms bucket', async () => {
      const { agent, stubs } = stubbedAgent();

      await executeQaWorkflow(agent, makeQaInput({ testDataPath: '/mnt/conf' }));

      const applyArgs = stubs.applyConfig.firstCall.args[1];
      expect(applyArgs).to.deep.include({ configPath: '/mnt/conf', actions: ['app-forms'], artifact: 'pregnancy_home_visit' });
    });

    it('aborts BEFORE apply when the symptom does not reproduce (no red)', async () => {
      const { agent, stubs } = stubbedAgent();
      stubs.verifyArtifact.reset();
      stubs.verifyArtifact.resolves(verifyResult(true)); // reproduce would already pass = no red

      const result = await executeQaWorkflow(agent, makeQaInput({ testDataPath: '/mnt/conf' }));

      expect(result.reproduced).to.equal(false);
      expect(result.succeeded).to.equal(false);
      expect(result.abortReason).to.match(/did not reproduce/);
      expect(stubs.applyConfig.called).to.equal(false);
      expect(stubs.prepareTestData.called).to.equal(false);
    });

    it('HC3 gates the destructive seed/apply — a decline aborts with nothing applied', async () => {
      const { agent, stubs } = stubbedAgent();
      const askStub = sinon.stub(prompt, 'askYesNo').resolves(false);

      const result = await executeQaWorkflow(agent, makeQaInput({ autoApprove: false, testDataPath: '/mnt/conf' }));

      expect(askStub.calledOnce).to.equal(true);
      expect(result.approved).to.equal(false);
      expect(result.reproduced).to.equal(true); // red confirmed before HC3
      expect(result.abortReason).to.match(/CHECKPOINT #3/);
      expect(stubs.prepareTestData.called).to.equal(false);
      expect(stubs.applyConfig.called).to.equal(false);
    });

    it('config-type guard blocks a needs-source ticket before provisioning', async () => {
      const emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-nosrc-'));
      try {
        const { agent, stubs } = stubbedAgent();
        const input = makeQaInput({ issue: formIssue({ configArtifact: 'task' }), configPath: emptyRoot });

        const result = await executeQaWorkflow(agent, input);

        expect(result.abortReason).to.match(/config-type guard/);
        expect(result.abortReason).to.match(/tasks\.js/);
        expect(stubs.provision.called).to.equal(false);
      } finally {
        fs.rmSync(emptyRoot, { recursive: true, force: true });
      }
    });
  });

  describe('deriveVerifyOptions / createQaInput', () => {
    let dir: string;
    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-conf-'));
      fs.mkdirSync(path.join(dir, 'forms', 'app'), { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'forms', 'app', 'pregnancy_home_visit.xml'),
        '<h:html xmlns:h="http://www.w3.org/1999/xhtml" xmlns="http://www.w3.org/2002/xforms"><h:head><model>' +
          `<bind nodeset="/data/danger_signs" relevant="${YES_GATE}"/>` +
          `<bind nodeset="/data/summary" relevant="${YES_GATE}"/>` +
          '</model></h:head></h:html>'
      );
    });
    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    it('snapshots the corrected form top-level group binds', () => {
      const verify = deriveVerifyOptions(dir, formIssue());
      expect(verify).to.not.equal(null);
      expect(verify!.artifactName).to.equal('pregnancy_home_visit');
      const danger = verify!.expectedBinds.find((b) => b.nodeset === '/data/danger_signs');
      expect(danger?.relevant).to.equal(YES_GATE);
      expect(verify!.expectedBinds).to.have.lengthOf(2);
    });

    it('createQaInput builds a QaInput from the mounted config', () => {
      const input = createQaInput({ issue: formIssue(), configPath: dir, provision: { chtCorePath: '/x' }, autoApprove: true });
      expect(input).to.not.equal(null);
      expect(input!.configPath).to.equal(dir);
      expect(input!.applyActions).to.deep.equal(['app-forms']);
    });

    it('returns null for a non-form ticket', () => {
      expect(deriveVerifyOptions(dir, formIssue({ configArtifact: 'task' }))).to.equal(null);
      expect(createQaInput({ issue: formIssue({ configArtifact: 'task' }), configPath: dir })).to.equal(null);
    });
  });

  describe('mission-05 QA seam (bucket untouched + node→verify loop closure)', () => {
    it('leaves the QA app-forms bucket at convert+upload (non-goal: no bucket change)', () => {
      expect(defaultApplyActions('form')).to.deep.equal(['app-forms']);
      expect(CONFIG_ACTION_COMMANDS['app-forms']).to.deep.equal(['convert-app-forms', 'upload-app-forms']);
    });

    const withConvert = canOfflineConvert() ? it : it.skip;
    withConvert('deriveVerifyOptions snapshots the CORRECTED bind the node wrote (self-skips without cht)', async function () {
      this.timeout(180000);
      const descriptor: XlsformFixDescriptor = {
        version: 1,
        form: 'pregnancy_home_visit',
        edits: [
          { sheet: 'survey', match: { column: 'name', value: 'danger_signs' }, set: { column: 'relevant', value: YES_GATE } },
        ],
        expect: { nodeset: '/data/danger_signs', relevant: YES_GATE, siblingsUnchanged: true },
        rationale: 'restore the yes-only gate',
      };
      const outcome = await applyXlsformFixToProject(descriptor, path.resolve('demo/config-pnc-demo'));
      expect(outcome.ok, outcome.ok ? '' : outcome.error).to.equal(true);
      if (!outcome.ok) {
        return;
      }
      try {
        // QA reads <configPath>/forms/app/<name>.xml — here the node's sandbox
        // stands in for the mount after copyToTarget. The snapshot must be the
        // corrected gate, not the planted one.
        const verify = deriveVerifyOptions(outcome.result.sandboxDir, formIssue());
        expect(verify).to.not.equal(null);
        const danger = verify!.expectedBinds.find((b) => b.nodeset === '/data/danger_signs');
        expect(danger?.relevant).to.equal(YES_GATE);
        expect(danger?.relevant).to.not.equal(PLANTED_GATE);
      } finally {
        fs.rmSync(outcome.result.sandboxDir, { recursive: true, force: true });
      }
    });
  });
});
