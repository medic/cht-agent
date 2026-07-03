import { expect } from 'chai';
import * as sinon from 'sinon';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { TestEnvironmentAgent } from '../../src/agents/test-environment-agent';
import { runQaPhase, QaOptions } from '../../src/workflows/orchestrator';
import {
  ConfigApplyResult,
  DevelopmentOptions,
  DiscoveredConfig,
  EnvironmentHandle,
  IssueTemplate,
  VerifyArtifactResult,
} from '../../src/types';

const YES_GATE = "selected(../pregnancy_summary/visit_option, 'yes')";

const ticket = (layer?: 'cht-core' | 'cht-conf'): IssueTemplate => ({
  issue: {
    title: 'danger-signs',
    type: 'bug',
    priority: 'high',
    description: 'x',
    technical_context: {
      domain: 'forms-and-reports',
      components: [],
      ...(layer ? { layer } : {}),
      ...(layer === 'cht-conf' ? { configArtifact: 'form', artifactName: 'pregnancy_home_visit' } : {}),
    },
    requirements: [],
    acceptance_criteria: [],
    constraints: [],
  },
} as IssueTemplate);

const HANDLE: EnvironmentHandle = {
  url: 'https://nginx', auth: { user: 'medic', password: 'password' }, network: 'cht-agent-net', source: 'docker',
};
const discovered = (rev: string): DiscoveredConfig => ({
  contactTypes: [], roles: {}, permissions: {}, transitions: {}, forms: ['pregnancy_home_visit'],
  formVersions: { pregnancy_home_visit: rev },
});
const verifyResult = (passed: boolean): VerifyArtifactResult => ({
  artifact: 'pregnancy_home_visit', configArtifact: 'form', passed,
  checks: [{ nodeset: '/data/danger_signs', expected: YES_GATE, passed }], summary: passed ? 'passed' : 'failed',
});
const applyOk: ConfigApplyResult = { configPath: '/mnt/conf', actions: [], succeeded: true, warnings: [] };

const stubbedAgent = () => {
  const agent = new TestEnvironmentAgent({ useMockDocker: true });
  const provision = sinon.stub(agent, 'provision').resolves(HANDLE);
  const discoverConfig = sinon.stub(agent, 'discoverConfig');
  discoverConfig.onFirstCall().resolves(discovered('1-pre')).onSecondCall().resolves(discovered('2-post'));
  const verifyArtifact = sinon.stub(agent, 'verifyArtifact');
  verifyArtifact.onFirstCall().resolves(verifyResult(false)).onSecondCall().resolves(verifyResult(true));
  sinon.stub(agent, 'applyConfig').resolves(applyOk);
  return { agent, provision };
};

describe('orchestrator runQaPhase wiring (#66 / mission 04 A3)', () => {
  let confDir: string;
  let devOptions: DevelopmentOptions;

  beforeEach(() => {
    confDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-conf-'));
    fs.mkdirSync(path.join(confDir, 'forms', 'app'), { recursive: true });
    fs.writeFileSync(
      path.join(confDir, 'forms', 'app', 'pregnancy_home_visit.xml'),
      '<h:html xmlns:h="http://www.w3.org/1999/xhtml" xmlns="http://www.w3.org/2002/xforms"><h:head><model>' +
        `<bind nodeset="/data/danger_signs" relevant="${YES_GATE}"/></model></h:head></h:html>`
    );
    devOptions = {
      chtCorePath: '/workspace/cht-core',
      previewMode: false,
      developmentTarget: { repoPath: confDir, toolchain: 'cht-conf' },
    };
  });
  afterEach(() => {
    sinon.restore();
    fs.rmSync(confDir, { recursive: true, force: true });
  });

  it('runs the QA closed loop for a cht-conf ticket when --qa is enabled', async () => {
    const { agent, provision } = stubbedAgent();
    const qaOptions: QaOptions = { enabled: true, agent, autoApprove: true, provision: { chtCorePath: '/x' } };

    const result = await runQaPhase(ticket('cht-conf'), devOptions, qaOptions);

    expect(result).to.not.equal(undefined);
    expect(result!.ran).to.equal(true);
    expect(result!.succeeded).to.equal(true);
    expect(provision.calledOnce).to.equal(true);
  });

  it('skips QA entirely for a cht-core ticket even when --qa is enabled', async () => {
    const { agent, provision } = stubbedAgent();
    const qaOptions: QaOptions = { enabled: true, agent, autoApprove: true, provision: { chtCorePath: '/x' } };

    const result = await runQaPhase(ticket('cht-core'), devOptions, qaOptions);

    expect(result).to.equal(undefined);
    expect(provision.called).to.equal(false);
  });

  it('skips QA when --qa is off (default), even for a cht-conf ticket', async () => {
    const { agent, provision } = stubbedAgent();

    const result = await runQaPhase(ticket('cht-conf'), devOptions, { enabled: false, agent });

    expect(result).to.equal(undefined);
    expect(provision.called).to.equal(false);
  });

  it('skips QA when no qaOptions are provided', async () => {
    const result = await runQaPhase(ticket('cht-conf'), devOptions, undefined);
    expect(result).to.equal(undefined);
  });
});
