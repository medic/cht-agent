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
import { verifyFormBinds } from '../../src/utils/xform-inspect';
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
  XlsformBindDiff,
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

  // F5: the development phase's XlsformApplyResult.bindDiff (nodeset + corrected
  // `after` relevant) must reach the QA verify set so the fix's OWN bind — even a
  // three-segment CHILD bind that extractTopLevelGroupBinds never snapshots — is
  // asserted red→green. The group-bind set is retained AFTER it as sibling
  // invariance. The echis case: the corrected local form gates a child bind
  // (/data/danger_signs/next_pnc_visit_date), absent from the two-segment group
  // set; without threading, deployed-vs-local matches on all group binds → no RED.
  describe('deriveVerifyOptions with a bindDiff (F5 — child-bind target)', () => {
    let dir: string;
    const CHILD_NODESET = '/data/danger_signs/next_pnc_visit_date';
    const childBindDiff: XlsformBindDiff = {
      nodeset: CHILD_NODESET,
      before: undefined, // deployed form has no relevant on this bind
      after: YES_GATE,
      siblingsUnchanged: 2,
    };

    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-conf-f5-'));
      fs.mkdirSync(path.join(dir, 'forms', 'app'), { recursive: true });
      // The CORRECTED local form: two top-level group binds PLUS the corrected
      // child bind carrying the gate.
      fs.writeFileSync(
        path.join(dir, 'forms', 'app', 'pregnancy_home_visit.xml'),
        '<h:html xmlns:h="http://www.w3.org/1999/xhtml" xmlns="http://www.w3.org/2002/xforms"><h:head><model>' +
          `<bind nodeset="/data/danger_signs" relevant="${YES_GATE}"/>` +
          `<bind nodeset="${CHILD_NODESET}" type="date" relevant="${YES_GATE}"/>` +
          `<bind nodeset="/data/summary" relevant="${YES_GATE}"/>` +
          '</model></h:head></h:html>'
      );
    });
    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    it('asserts the target child bind FIRST, then the group binds as siblings', () => {
      const verify = deriveVerifyOptions(dir, formIssue(), childBindDiff);
      expect(verify).to.not.equal(null);
      // Target bind first — its `relevant` is bindDiff.after (the corrected gate).
      expect(verify!.expectedBinds[0]).to.deep.equal({ nodeset: CHILD_NODESET, relevant: YES_GATE });
      // Group binds retained AFTER it as sibling invariance.
      const nodesets = verify!.expectedBinds.map((b) => b.nodeset);
      expect(nodesets).to.include('/data/danger_signs');
      expect(nodesets).to.include('/data/summary');
      // target(child) + 2 group binds = 3, asserted exactly once each
      expect(verify!.expectedBinds).to.have.lengthOf(3);
    });

    it('de-duplicates the target when the bindDiff nodeset is itself a group bind', () => {
      const groupDiff: XlsformBindDiff = { nodeset: '/data/danger_signs', after: YES_GATE, siblingsUnchanged: 2 };
      const verify = deriveVerifyOptions(dir, formIssue(), groupDiff);
      expect(verify).to.not.equal(null);
      // target first (from the diff), and NOT repeated in the sibling set
      expect(verify!.expectedBinds[0]).to.deep.equal({ nodeset: '/data/danger_signs', relevant: YES_GATE });
      const occurrences = verify!.expectedBinds.filter((b) => b.nodeset === '/data/danger_signs');
      expect(occurrences).to.have.lengthOf(1);
      // /data/danger_signs (target) + /data/summary (sibling) = 2
      expect(verify!.expectedBinds).to.have.lengthOf(2);
    });

    it('createQaInput threads args.bindDiff into the verify set (target present)', () => {
      const input = createQaInput({
        issue: formIssue(),
        configPath: dir,
        provision: { chtCorePath: '/x' },
        autoApprove: true,
        bindDiff: childBindDiff,
      });
      expect(input).to.not.equal(null);
      expect(input!.verify.expectedBinds[0].nodeset).to.equal(CHILD_NODESET);
    });

    // Fallback: no dev result → byte-identical current behavior (group set only).
    it('FALLBACK — without a bindDiff the verify set is the group binds only (unchanged)', () => {
      const verify = deriveVerifyOptions(dir, formIssue());
      expect(verify).to.not.equal(null);
      const nodesets = verify!.expectedBinds.map((b) => b.nodeset);
      // group binds only — the child bind is NOT in the set
      expect(nodesets).to.not.include(CHILD_NODESET);
      expect(nodesets).to.deep.equal(['/data/danger_signs', '/data/summary']);
    });

    // The load-bearing acceptance: the bindDiff-threaded expectation set, run
    // through the REAL verify oracle (verifyFormBinds — the same code path
    // TestEnvironmentAgent.verifyArtifact uses), must be RED against the
    // still-buggy DEPLOYED form (child bind present, no relevant) and GREEN once
    // the corrected XML is "deployed". This is the child-bind case that the
    // group-only fallback (asserted just above) cannot detect.
    describe('reproduce→verify red/green on the deployed form (child bind)', () => {
      const model = (inner: string): string =>
        '<h:html xmlns:h="http://www.w3.org/1999/xhtml" xmlns="http://www.w3.org/2002/xforms">' +
        `<h:head><model>${inner}</model></h:head></h:html>`;
      // DEPLOYED (still buggy): the child bind exists (the group renders) but was
      // never gated — no relevant. The two group binds already carry the gate, so
      // a group-only oracle would falsely PASS (no RED) — the live-run bug.
      const DEPLOYED_BUGGY = model(
        `<bind nodeset="/data/danger_signs" relevant="${YES_GATE}"/>` +
          `<bind nodeset="${CHILD_NODESET}" type="date"/>` +
          `<bind nodeset="/data/summary" relevant="${YES_GATE}"/>`
      );
      // DEPLOYED after the corrected apply: the child bind now carries the gate.
      const DEPLOYED_FIXED = model(
        `<bind nodeset="/data/danger_signs" relevant="${YES_GATE}"/>` +
          `<bind nodeset="${CHILD_NODESET}" type="date" relevant="${YES_GATE}"/>` +
          `<bind nodeset="/data/summary" relevant="${YES_GATE}"/>`
      );

      it('reproduce is RED against the buggy deployed form (child bind lacks relevant)', () => {
        const verify = deriveVerifyOptions(dir, formIssue(), childBindDiff);
        const red = verifyFormBinds(DEPLOYED_BUGGY, verify!.expectedBinds);
        expect(red.passed).to.equal(false); // reproduced = !passed → RED fires
        const target = red.checks.find((c) => c.nodeset === CHILD_NODESET);
        expect(target?.passed).to.equal(false);
        expect(target?.actual).to.equal('(none)'); // present-but-unrelevant MISMATCH
        // the group siblings still pass — the failure is isolated to the fix's bind
        const siblings = red.checks.filter((c) => c.nodeset !== CHILD_NODESET);
        expect(siblings.every((c) => c.passed)).to.equal(true);
      });

      it('verify is GREEN once the corrected XML is deployed', () => {
        const verify = deriveVerifyOptions(dir, formIssue(), childBindDiff);
        const green = verifyFormBinds(DEPLOYED_FIXED, verify!.expectedBinds);
        expect(green.passed).to.equal(true);
        expect(green.checks.every((c) => c.passed)).to.equal(true);
      });

      it('a GROUP-ONLY set (the old fallback) would NOT reproduce this — proves the threading is load-bearing', () => {
        // No bindDiff → group binds only → the buggy deployed form falsely PASSES.
        const groupOnly = deriveVerifyOptions(dir, formIssue());
        const wouldBeRed = verifyFormBinds(DEPLOYED_BUGGY, groupOnly!.expectedBinds);
        expect(wouldBeRed.passed).to.equal(true); // no RED — the exact live-run miss
      });
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
