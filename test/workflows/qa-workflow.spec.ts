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
  displayQaCompletion,
  executeQaWorkflow,
  humanQaValidationCheckpoint,
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

    it('createQaInput threads the F7 tier-2 opt-in onto the QaInput', () => {
      const input = createQaInput({ issue: formIssue(), configPath: dir, tier2: true, autoApprove: true });
      expect(input!.tier2).to.equal(true);
      const off = createQaInput({ issue: formIssue(), configPath: dir, autoApprove: true });
      expect(off!.tier2).to.equal(undefined);
    });
  });

  // F7: opt-in tier-2 QA — after the tier-1 GREEN, shell the config repo's own
  // pinned mocha over the affected form's harness spec. The runner is exercised
  // for real against a scaffolded repo with a fake mocha (exit 0 / exit 1) so the
  // full seam — succeeded-folding + honest self-skip + QaResult.tier2 — is proven.
  describe('executeQaWorkflow — F7 tier-2 hook', () => {
    let dir: string;
    const FORM = 'pregnancy_home_visit';

    const writeCorrectedForm = (root: string) => {
      fs.mkdirSync(path.join(root, 'forms', 'app'), { recursive: true });
      fs.writeFileSync(
        path.join(root, 'forms', 'app', `${FORM}.xml`),
        `<model><bind nodeset="/data/danger_signs" relevant="${YES_GATE}"/></model>`,
      );
    };
    const scaffoldMocha = (root: string, exitCode: number) => {
      const binDir = path.join(root, 'node_modules', '.bin');
      fs.mkdirSync(binDir, { recursive: true });
      const mocha = path.join(binDir, 'mocha');
      fs.writeFileSync(mocha, `#!/bin/sh\necho "tier-2 fake mocha ran"\nexit ${exitCode}\n`);
      fs.chmodSync(mocha, 0o755);
      fs.mkdirSync(path.join(root, 'node_modules', 'cht-conf-test-harness'), { recursive: true });
    };
    const writeFormSpec = (root: string) => {
      const formsDir = path.join(root, 'test', 'forms');
      fs.mkdirSync(formsDir, { recursive: true });
      fs.writeFileSync(path.join(formsDir, `${FORM}.spec.js`), '// spec\n');
    };

    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-tier2-'));
    });
    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    it('runs after GREEN and keeps succeeded true when the harness spec passes', async () => {
      writeCorrectedForm(dir);
      scaffoldMocha(dir, 0);
      writeFormSpec(dir);
      const { agent } = stubbedAgent();
      const result = await executeQaWorkflow(agent, makeQaInput({ configPath: dir, tier2: true }));
      expect(result.tier2?.ran).to.equal(true);
      expect(result.tier2?.passed).to.equal(true);
      expect(result.succeeded).to.equal(true);
      // F9: the transition entry carries the honest pass one-liner (with the
      // parsed passing count when the fake mocha printed one; here it did not,
      // so the countless form is expected).
      expect(result.messages.some((m) => /tier-2 passed/.test(m))).to.equal(true);
    });

    it('fails succeeded when the harness spec fails (tier-2 folds in)', async () => {
      writeCorrectedForm(dir);
      scaffoldMocha(dir, 1);
      writeFormSpec(dir);
      const { agent } = stubbedAgent();
      const result = await executeQaWorkflow(agent, makeQaInput({ configPath: dir, tier2: true }));
      expect(result.tier2?.ran).to.equal(true);
      expect(result.tier2?.passed).to.equal(false);
      expect(result.verified).to.equal(true); // tier-1 still green
      expect(result.succeeded).to.equal(false); // tier-2 pulled it down
      // F9: the transition carries the bounded output excerpt, not "see outputTail".
      expect(result.messages.some((m) => /tier-2 FAILED — last output:/.test(m))).to.equal(true);
      expect(result.messages.some((m) => /tier-2 fake mocha ran/.test(m))).to.equal(true);
      expect(result.messages.some((m) => /see outputTail/.test(m))).to.equal(false);
    });

    it('self-skips honestly (succeeded unchanged) when no harness spec exists', async () => {
      writeCorrectedForm(dir);
      scaffoldMocha(dir, 0); // mocha + harness present, but no form spec
      const { agent } = stubbedAgent();
      const result = await executeQaWorkflow(agent, makeQaInput({ configPath: dir, tier2: true }));
      expect(result.tier2?.ran).to.equal(false);
      expect(result.tier2?.reason).to.match(/no harness spec/);
      expect(result.succeeded).to.equal(true); // green loop untouched
    });

    it('does not run tier-2 when the flag is off (QaResult.tier2 absent)', async () => {
      writeCorrectedForm(dir);
      scaffoldMocha(dir, 0);
      writeFormSpec(dir);
      const { agent } = stubbedAgent();
      const result = await executeQaWorkflow(agent, makeQaInput({ configPath: dir }));
      expect(result.tier2).to.equal(undefined);
      expect(result.succeeded).to.equal(true);
    });

    it('HC3 banner mentions the tier-2 run when enabled (and not when disabled)', async () => {
      const logs: string[] = [];
      const spy = sinon.stub(console, 'log').callsFake((...a: unknown[]) => logs.push(a.join(' ')));
      try {
        await humanQaValidationCheckpoint(makeQaInput({ tier2: true }), verifyResult(false));
        await humanQaValidationCheckpoint(makeQaInput(), verifyResult(false));
      } finally {
        spy.restore();
      }
      const tier2Lines = logs.filter((l) => /after GREEN: tier-2 harness spec/.test(l));
      expect(tier2Lines).to.have.length(1); // exactly the tier2:true call surfaced it
    });

    it('displayQaCompletion reports the tier-2 outcome', () => {
      const logs: string[] = [];
      const spy = sinon.stub(console, 'log').callsFake((...a: unknown[]) => logs.push(a.join(' ')));
      try {
        displayQaCompletion({
          ran: true, approved: true, reproduced: true, verified: true, succeeded: true,
          messages: [], tier2: { ran: true, passed: true, outputTail: '2 passing' },
        });
      } finally {
        spy.restore();
      }
      expect(logs.some((l) => /Tier-2 \(harness spec\).*passed/.test(l))).to.equal(true);
    });

    // F9: on success the panel shows the parsed mocha passing count (one line).
    it('displayQaCompletion — tier-2 pass shows the parsed passing count', () => {
      const logs: string[] = [];
      const spy = sinon.stub(console, 'log').callsFake((...a: unknown[]) => logs.push(a.join(' ')));
      try {
        displayQaCompletion({
          ran: true, approved: true, reproduced: true, verified: true, succeeded: true,
          messages: [],
          tier2: { ran: true, passed: true, outputTail: 'some noise\n  7 passing (3s)\n' },
        });
      } finally {
        spy.restore();
      }
      expect(logs.some((l) => /Tier-2 \(harness spec\).*tier-2 passed \(7 passing\)/.test(l))).to.equal(true);
    });

    // F9: on failure the panel prints a bounded, prefixed excerpt of the output
    // (last lines) INLINE — the diagnosis no longer needs a manual rerun.
    it('displayQaCompletion — tier-2 failure prints a bounded output excerpt inline', () => {
      const logs: string[] = [];
      const spy = sinon.stub(console, 'log').callsFake((...a: unknown[]) => logs.push(a.join(' ')));
      const outputTail = [
        'No usable sandbox!',
        '  1) postnatal_care_service — loads the corrected form',
        '  0 passing (1s)',
        '  1 failing',
      ].join('\n');
      try {
        displayQaCompletion({
          ran: true, approved: true, reproduced: true, verified: true, succeeded: false,
          messages: [], tier2: { ran: true, passed: false, outputTail },
        });
      } finally {
        spy.restore();
      }
      const joined = logs.join('\n');
      expect(joined).to.match(/Tier-2 \(harness spec\).*failed — last output:/);
      // The actual failing lines are echoed (prefixed), not "see outputTail".
      expect(joined).to.include('No usable sandbox!');
      expect(joined).to.include('1 failing');
      expect(joined).to.not.include('see outputTail');
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

  // F6: the whole-document QA oracle. ACTIVE only when a dev-phase bindDiff is in
  // scope. reproduce (RED) additionally requires the deployed form to differ from
  // the corrected local `.xml` EXACTLY at the target bind — any other canonical
  // diff aborts as ENVIRONMENT DRIFT (unless QA_ALLOW_DRIFT=1). verify (GREEN)
  // additionally requires whole-document canonical identity. No bindDiff ⇒
  // byte-identical targeted-oracle behavior. The comparator is the dev phase's
  // canonicalDiffLines (attr-order-insensitive, multi-line-tag safe).
  describe('executeQaWorkflow — F6 whole-document oracle', () => {
    let dir: string;
    const TARGET = '/data/danger_signs/next_pnc_visit_date';
    const bindDiff: XlsformBindDiff = { nodeset: TARGET, before: undefined, after: YES_GATE, siblingsUnchanged: 2 };

    // A form model; `targetRelevant` undefined renders the target bind WITHOUT a
    // relevant (the buggy deployed state); `summary` lets a spec perturb a
    // non-target line to synthesize drift/collateral.
    const model = (targetRelevant: string | undefined, summary = 'S'): string =>
      [
        '<h:html xmlns:h="http://www.w3.org/1999/xhtml" xmlns="http://www.w3.org/2002/xforms">',
        '<h:head><model>',
        `<bind nodeset="/data/danger_signs" relevant="${YES_GATE}"/>`,
        targetRelevant === undefined
          ? `<bind nodeset="${TARGET}" type="date"/>`
          : `<bind nodeset="${TARGET}" type="date" relevant="${targetRelevant}"/>`,
        `<bind nodeset="/data/summary" relevant="${summary}"/>`,
        '</model></h:head>',
        '</h:html>',
      ].join('\n');

    // The CORRECTED local form: target bind carries the gate.
    const LOCAL = model(YES_GATE);
    // DEPLOYED buggy: differs from LOCAL ONLY at the target bind (no relevant).
    const DEPLOYED_BUGGY = model(undefined);
    // DEPLOYED buggy WITH environment drift: target ungated AND a sibling differs.
    const DEPLOYED_DRIFT = model(undefined, 'DRIFTED');
    // DEPLOYED after a clean apply: canonically identical to LOCAL.
    const DEPLOYED_FIXED = model(YES_GATE);
    // DEPLOYED after apply but with collateral damage: target fixed, sibling changed.
    const DEPLOYED_COLLATERAL = model(YES_GATE, 'COLLATERAL');

    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-f6-'));
      fs.mkdirSync(path.join(dir, 'forms', 'app'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'forms', 'app', 'pregnancy_home_visit.xml'), LOCAL);
    });
    afterEach(() => {
      fs.rmSync(dir, { recursive: true, force: true });
      delete process.env.QA_ALLOW_DRIFT;
    });

    const f6Input = (overrides: Partial<QaInput> = {}): QaInput =>
      makeQaInput({
        configPath: dir,
        bindDiff,
        verify: { configArtifact: 'form', artifactName: 'pregnancy_home_visit', expectedBinds: [{ nodeset: TARGET, relevant: YES_GATE }] },
        ...overrides,
      });

    /** Stub fetchDeployedFormXml: RED call returns `red`, GREEN call returns `green`. */
    const withDeployed = (agent: TestEnvironmentAgent, red: string, green: string) => {
      const stub = sinon.stub(agent, 'fetchDeployedFormXml');
      stub.onFirstCall().resolves(red).onSecondCall().resolves(green);
      return stub;
    };

    it('RED-exact-target — deployed differs from local ONLY at the target bind → passes to green', async () => {
      const { agent, stubs } = stubbedAgent();
      withDeployed(agent, DEPLOYED_BUGGY, DEPLOYED_FIXED);

      const result = await executeQaWorkflow(agent, f6Input({ testDataPath: dir }));

      expect(result.succeeded).to.equal(true);
      expect(result.abortReason).to.equal(undefined);
      expect(stubs.applyConfig.called).to.equal(true);
      expect(result.messages.join('\n')).to.contain('RED oracle: whole-document');
      expect(result.messages.join('\n')).to.contain('ONLY at the target bind');
    });

    it('RED-with-extra-drift — aborts as ENVIRONMENT DRIFT BEFORE seed/apply', async () => {
      const { agent, stubs } = stubbedAgent();
      withDeployed(agent, DEPLOYED_DRIFT, DEPLOYED_FIXED);

      const result = await executeQaWorkflow(agent, f6Input({ testDataPath: dir }));

      expect(result.succeeded).to.equal(false);
      expect(result.abortReason).to.match(/ENVIRONMENT DRIFT/);
      expect(result.abortReason).to.contain(TARGET);
      // the drift sample surfaces the offending sibling line
      expect(result.abortReason).to.contain('/data/summary');
      // reproduced is still true (the bind DID reproduce) but nothing destructive ran
      expect(result.reproduced).to.equal(true);
      expect(stubs.prepareTestData.called).to.equal(false);
      expect(stubs.applyConfig.called).to.equal(false);
    });

    it('RED-with-extra-drift + QA_ALLOW_DRIFT=1 — proceeds with a warning (targeted fallback)', async () => {
      process.env.QA_ALLOW_DRIFT = '1';
      const { agent, stubs } = stubbedAgent();
      withDeployed(agent, DEPLOYED_DRIFT, DEPLOYED_FIXED);

      const result = await executeQaWorkflow(agent, f6Input({ testDataPath: dir }));

      expect(result.abortReason).to.equal(undefined);
      expect(result.succeeded).to.equal(true);
      expect(stubs.applyConfig.called).to.equal(true);
      expect(result.messages.join('\n')).to.match(/drift TOLERATED \(QA_ALLOW_DRIFT=1\)/);
    });

    it('GREEN-identical — deployed is canonically identical to local after apply → verified', async () => {
      const { agent } = stubbedAgent();
      withDeployed(agent, DEPLOYED_BUGGY, DEPLOYED_FIXED);

      const result = await executeQaWorkflow(agent, f6Input({ testDataPath: dir }));

      expect(result.verified).to.equal(true);
      expect(result.succeeded).to.equal(true);
      expect(result.messages.join('\n')).to.contain('GREEN oracle: whole-document');
      expect(result.messages.join('\n')).to.contain('canonically identical');
    });

    it('GREEN-with-collateral — bind assertions pass but the doc differs → verify FAILS listing lines', async () => {
      const { agent, stubs } = stubbedAgent();
      // verifyArtifact (bind assertions) passes on the GREEN call (target is fixed),
      // but the whole-document oracle sees a changed sibling → verify must fail.
      withDeployed(agent, DEPLOYED_BUGGY, DEPLOYED_COLLATERAL);

      const result = await executeQaWorkflow(agent, f6Input({ testDataPath: dir }));

      expect(stubs.applyConfig.called).to.equal(true);
      expect(result.verified).to.equal(false);
      expect(result.succeeded).to.equal(false);
      const log = result.messages.join('\n');
      expect(log).to.contain('GREEN oracle: whole-document FAILED');
      expect(log).to.contain('/data/summary');
    });

    it('FALLBACK — no bindDiff ⇒ the whole-document oracle never runs (byte-identical behavior)', async () => {
      const { agent } = stubbedAgent();
      const fetchStub = withDeployed(agent, DEPLOYED_DRIFT, DEPLOYED_COLLATERAL);

      // No bindDiff on the input → oracle inactive even though deployed drift exists.
      const result = await executeQaWorkflow(agent, makeQaInput({ configPath: dir, testDataPath: dir }));

      expect(result.succeeded).to.equal(true); // targeted oracle only (bind assertions)
      expect(fetchStub.called).to.equal(false); // the oracle never fetched the deployed XML
      expect(result.messages.join('\n')).to.not.contain('oracle: whole-document');
    });

    it('self-skips to the targeted oracle when the deployed XML is unavailable (mock mode)', async () => {
      const { agent } = stubbedAgent();
      // No fetchDeployedFormXml stub → the real mock-mode method returns undefined.
      const result = await executeQaWorkflow(agent, f6Input({ testDataPath: dir }));

      expect(result.succeeded).to.equal(true);
      const log = result.messages.join('\n');
      expect(log).to.contain('RED oracle: targeted');
      expect(log).to.contain('GREEN oracle: targeted');
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
