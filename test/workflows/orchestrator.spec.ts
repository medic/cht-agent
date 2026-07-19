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
  FormBindExpectation,
  IssueTemplate,
  VerifyArtifactOptions,
  VerifyArtifactResult,
} from '../../src/types';

const YES_GATE = "selected(../pregnancy_summary/visit_option, 'yes')";

/** Narrow union verify options to the form-xml expectedBinds (P4). */
const formExpectedBinds = (options: VerifyArtifactOptions): FormBindExpectation[] => {
  expect(options.kind).to.equal('form-xml');
  return (options as Extract<VerifyArtifactOptions, { kind: 'form-xml' }>).expectedBinds;
};

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
  kind: 'form-xml', artifact: 'pregnancy_home_visit', configArtifact: 'form', passed,
  checks: [{ nodeset: '/data/danger_signs', attr: 'relevant', expected: YES_GATE, passed }], summary: passed ? 'passed' : 'failed',
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
  return { agent, provision, verifyArtifact };
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

  // F5: the dev phase's XlsformApplyResult.bindDiff must reach the verify set so
  // QA asserts the fix's OWN bind (incl. a child bind the group snapshot misses).
  describe('F5 — bindDiff from the dev result threads into the verify set', () => {
    const CHILD_NODESET = '/data/danger_signs/next_pnc_visit_date';
    const bindDiff = {
      nodeset: CHILD_NODESET,
      before: undefined,
      after: YES_GATE,
      attrs: { relevant: YES_GATE },
      attrsBefore: { relevant: null },
      siblingsUnchanged: 1,
    };

    it('asserts the target child bind FIRST when a bindDiff is threaded in', async () => {
      const { agent, verifyArtifact } = stubbedAgent();
      const qaOptions: QaOptions = { enabled: true, agent, autoApprove: true, provision: { chtCorePath: '/x' } };

      const result = await runQaPhase(ticket('cht-conf'), devOptions, qaOptions, bindDiff);

      expect(result).to.not.equal(undefined);
      // reproduce (call 0) received the child target bind first, then the group bind as sibling
      const expectedBinds = formExpectedBinds(verifyArtifact.firstCall.args[1]);
      expect(expectedBinds[0]).to.deep.equal({
        nodeset: CHILD_NODESET,
        attrs: { relevant: YES_GATE },
      });
      const nodesets = expectedBinds.map((b) => b.nodeset);
      expect(nodesets).to.include('/data/danger_signs'); // group bind retained as sibling invariance
    });

    it('FALLBACK — no bindDiff → the verify set is the group binds only (byte-identical to before)', async () => {
      const { agent, verifyArtifact } = stubbedAgent();
      const qaOptions: QaOptions = { enabled: true, agent, autoApprove: true, provision: { chtCorePath: '/x' } };

      // runQaPhase called WITHOUT a bindDiff (the executeFullWorkflow path when
      // the dev phase produced no XlsformApplyResult).
      await runQaPhase(ticket('cht-conf'), devOptions, qaOptions);

      const nodesets = formExpectedBinds(verifyArtifact.firstCall.args[1]).map((b) => b.nodeset);
      expect(nodesets).to.not.include(CHILD_NODESET);
      expect(nodesets).to.deep.equal(['/data/danger_signs']);
    });
  });

  // F7: runQaPhase must thread the tier-2 opt-in from QaOptions into createQaInput
  // so the QA phase runs the repo harness spec after GREEN.
  describe('F7 — tier-2 opt-in threads through runQaPhase', () => {
    const scaffoldMocha = (root: string) => {
      const binDir = path.join(root, 'node_modules', '.bin');
      fs.mkdirSync(binDir, { recursive: true });
      fs.writeFileSync(path.join(binDir, 'mocha'), '#!/bin/sh\nexit 0\n');
      fs.chmodSync(path.join(binDir, 'mocha'), 0o755);
      fs.mkdirSync(path.join(root, 'node_modules', 'cht-conf-test-harness'), { recursive: true });
      const formsDir = path.join(root, 'test', 'forms');
      fs.mkdirSync(formsDir, { recursive: true });
      fs.writeFileSync(path.join(formsDir, 'pregnancy_home_visit.spec.js'), '// spec\n');
    };

    it('runs the harness spec after GREEN when tier2 is set on QaOptions', async () => {
      scaffoldMocha(confDir);
      const { agent } = stubbedAgent();
      const qaOptions: QaOptions = { enabled: true, agent, autoApprove: true, tier2: true, provision: { chtCorePath: '/x' } };
      const result = await runQaPhase(ticket('cht-conf'), devOptions, qaOptions);
      expect(result!.tier2?.ran).to.equal(true);
      expect(result!.tier2?.passed).to.equal(true);
    });

    it('leaves tier-2 off (QaResult.tier2 absent) when the flag is unset', async () => {
      scaffoldMocha(confDir);
      const { agent } = stubbedAgent();
      const qaOptions: QaOptions = { enabled: true, agent, autoApprove: true, provision: { chtCorePath: '/x' } };
      const result = await runQaPhase(ticket('cht-conf'), devOptions, qaOptions);
      expect(result!.tier2).to.equal(undefined);
    });
  });
});
