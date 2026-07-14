/**
 * QA Workflow (mission 04 A3 — the closed loop, closes G1)
 *
 * Drives the Test Environment Agent (the QA "supervisor") against an
 * operator-provisioned CHT instance to prove a cht-conf fix in the
 * red -> fix -> green discipline CHT docs require ("at least one test should fail
 * before the fix; it should pass after"):
 *
 *   provision -> discoverConfig(pre) -> reproduce (REQUIRE red) -> HC3 gate
 *     -> prepareTestData(seed) -> applyConfig(fix) -> discoverConfig(post)
 *     -> verifyArtifact (REQUIRE green)
 *
 * reproduce() and verify are the SAME content assertion (A2 tier 1); reproduce
 * runs it against the AS-DEPLOYED (buggy) form and requires it to FAIL, verify
 * runs it against the deployed (fixed) form and requires it to PASS. The
 * expectation set is snapshotted from the CORRECTED local form, so the deployed
 * pre-fix form necessarily fails it and the post-fix form passes it. The QaResult
 * carries BOTH the red and green evidence so the report shows the transition.
 *
 * Ordering note: discoverConfig(pre) precedes prepareTestData because
 * prepareTestData needs a DiscoveredConfig to classify seeded docs; reproduce
 * (read-only) runs before HC3 so the human approves the destructive seed/apply
 * only once the symptom is confirmed reproduced.
 *
 * Mirrors development-workflow.ts: createQaInput / executeQaWorkflow /
 * humanQaValidationCheckpoint.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  ConfigArtifact,
  ConfigUploadAction,
  DiscoveredConfig,
  HumanFeedback,
  IssueTemplate,
  ProvisionOptions,
  QaInput,
  QaResult,
  VerifyArtifactOptions,
  VerifyArtifactResult,
  VerifyArtifactType,
  XlsformBindDiff,
} from '../types';
import { TestEnvironmentAgent } from '../agents/test-environment-agent';
import { extractTopLevelGroupBinds } from '../utils/xform-inspect';
import { guardConfigFix } from '../utils/config-type';
import { resolveDeploymentConfigRoot } from '../utils/canonical-diff';
import { askYesNo } from '../utils/prompt';

/** cht-conf upload buckets to apply for each verifiable artifact kind. */
const APPLY_ACTIONS_BY_ARTIFACT: Record<VerifyArtifactType, ConfigUploadAction[]> = {
  form: ['app-forms'],
};

export const defaultApplyActions = (artifact: VerifyArtifactType): ConfigUploadAction[] =>
  APPLY_ACTIONS_BY_ARTIFACT[artifact] ?? ['app-forms'];

/**
 * Snapshot the verification set from the CORRECTED local form. Returns null when
 * the ticket is not a form fix, names no artifact, or the corrected form is not
 * on disk (so QA fails closed rather than verifying nothing).
 *
 * F5: `bindDiff` is the target-bind delta the development phase's deterministic
 * XLSForm apply produced (nodeset + the corrected `after` relevant). When it is
 * present the target bind is asserted FIRST — so the red/green oracle fires on
 * the fix's OWN bind, even a three-segment child bind that
 * `extractTopLevelGroupBinds` (two-segment groups only) never snapshots. The
 * group-bind set is retained AFTER it as the sibling-invariance oracle (the
 * target nodeset is de-duplicated out so it is not asserted twice). When
 * `bindDiff` is undefined (standalone QA, cht-core tickets, dev-phase-skipped
 * runs) the behavior is byte-identical to before: the group-bind set only.
 */
export const deriveVerifyOptions = (
  configPath: string,
  issue: IssueTemplate,
  bindDiff?: XlsformBindDiff
): VerifyArtifactOptions | null => {
  const tc = issue.issue.technical_context;
  if (tc.configArtifact !== 'form' || !tc.artifactName) {
    return null;
  }
  const formPath = path.join(configPath, 'forms', 'app', `${tc.artifactName}.xml`);
  if (!fs.existsSync(formPath)) {
    return null;
  }
  const groupBinds = extractTopLevelGroupBinds(fs.readFileSync(formPath, 'utf8'));
  if (bindDiff) {
    // Target bind FIRST, then group binds as sibling invariance (drop the target
    // nodeset from the group set so it is asserted exactly once).
    const expectedBinds = [
      { nodeset: bindDiff.nodeset, relevant: bindDiff.after },
      ...groupBinds.filter((b) => b.nodeset !== bindDiff.nodeset),
    ];
    return { configArtifact: 'form', artifactName: tc.artifactName, expectedBinds };
  }
  // Fallback (no dev result): group-bind set only — unchanged behavior.
  if (groupBinds.length === 0) {
    return null;
  }
  return { configArtifact: 'form', artifactName: tc.artifactName, expectedBinds: groupBinds };
};

const buildProvisionFromEnv = (): ProvisionOptions => ({
  chtCorePath: process.env.CHT_CORE_PATH || undefined,
  version: process.env.CHT_VERSION || undefined,
  url: process.env.CHT_URL || undefined,
});

export interface CreateQaInputArgs {
  issue: IssueTemplate;
  /** CHT_CONF_PATH (the corrected config to apply); defaults to the mounted deployment root. */
  configPath?: string;
  provision?: ProvisionOptions;
  testDataPath?: string;
  autoApprove?: boolean;
  /**
   * F5: the target-bind delta from the development phase's XLSForm apply
   * (`XlsformApplyResult.bindDiff`). Threaded into the verify expectation set so
   * the fix's own bind (incl. a child bind the group snapshot misses) is
   * asserted red→green. Undefined for standalone QA / cht-core / dev-skipped runs.
   */
  bindDiff?: XlsformBindDiff;
}

/**
 * Assemble a QaInput from the ticket + resolved config, or null (with a logged
 * reason) when QA is not applicable. Mirrors createDevelopmentInput.
 */
export const createQaInput = (args: CreateQaInputArgs): QaInput | null => {
  const configPath = args.configPath ?? resolveDeploymentConfigRoot();
  if (!configPath) {
    console.error('❌ QA: no deployment config mounted — set CHT_CONF_PATH to the corrected config');
    return null;
  }
  const verify = deriveVerifyOptions(configPath, args.issue, args.bindDiff);
  if (!verify) {
    console.error(
      '❌ QA: could not derive form verification — needs configArtifact: form, an artifactName, ' +
        'and the corrected form on disk at forms/app/<artifactName>.xml'
    );
    return null;
  }
  return {
    issue: args.issue,
    configPath,
    verify,
    applyActions: defaultApplyActions(verify.configArtifact),
    provision: args.provision ?? buildProvisionFromEnv(),
    ...(args.testDataPath ? { testDataPath: args.testDataPath } : {}),
    ...(args.autoApprove ? { autoApprove: args.autoApprove } : {}),
  };
};

const CHECKPOINT_RULE = '─'.repeat(70);

/**
 * HUMAN VALIDATION CHECKPOINT #3 — gate the destructive seed + apply. Mirrors
 * HC1/HC2. Auto-approves (with a notice) when input.autoApprove is set, so
 * automated/CI runs do not block on stdin.
 */
export const humanQaValidationCheckpoint = async (
  input: QaInput,
  redEvidence: VerifyArtifactResult
): Promise<HumanFeedback> => {
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║            HUMAN VALIDATION CHECKPOINT #3                      ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');
  console.log('🔴 Reproduced (red baseline):');
  console.log(`   ${redEvidence.summary}`);
  console.log(CHECKPOINT_RULE);
  console.log('⚠️  About to perform DESTRUCTIVE operations on the live instance:');
  console.log(`   • seed test data${input.testDataPath ? ` from ${input.testDataPath}` : ' (skipped — no data path)'}`);
  console.log(`   • upload the corrected config from ${input.configPath}`);
  console.log(`     (buckets: ${(input.applyActions ?? []).join(', ')}; artifact: ${input.verify.artifactName})`);
  console.log(`   • target instance: ${input.provision.url ?? process.env.CHT_URL ?? 'https://nginx'}`);
  console.log(CHECKPOINT_RULE);

  const timestamp = new Date().toISOString();
  if (input.autoApprove) {
    console.log('✅ Auto-approved (non-interactive QA run)\n');
    return { approved: true, timestamp };
  }
  const approved = await askYesNo('✅ Proceed with seeding + applying the fix to the live instance?');
  return { approved, timestamp };
};

const abort = (
  messages: string[],
  abortReason: string,
  extra: Partial<QaResult> = {}
): QaResult => ({
  ran: true,
  approved: false,
  reproduced: false,
  verified: false,
  succeeded: false,
  messages,
  abortReason,
  ...extra,
});

/**
 * Run the closed-loop QA workflow: reproduce (red) -> HC3 -> seed -> apply ->
 * verify (green). Never applies a fix to a symptom that did not reproduce, and
 * never runs the destructive seed/apply without HC3 approval.
 */
export const executeQaWorkflow = async (
  agent: TestEnvironmentAgent,
  input: QaInput
): Promise<QaResult> => {
  const messages: string[] = [];
  const artifact = input.verify.artifactName;

  // Pre-flight: config-type boundary. A fix that needs source the mount cannot
  // yield must not reach the destructive seed/apply.
  const configArtifact: ConfigArtifact = input.issue.issue.technical_context.configArtifact ?? 'form';
  const guard = guardConfigFix({ artifact: configArtifact, configRoot: input.configPath });
  if (!guard.ok) {
    return abort(messages, `config-type guard: ${guard.message}`);
  }
  if (input.verify.configArtifact !== 'form') {
    return abort(messages, `QA verify supports configArtifact: form only (got ${input.verify.configArtifact})`);
  }

  console.log('\n🧪 QA WORKFLOW — reproduce → fix → verify');

  // 1. provision the instance
  const handle = await agent.provision(input.provision);

  // 2. discoverConfig (pre) — before prepareTestData (needs a config) and for the rev diff
  const preConfig: DiscoveredConfig = await agent.discoverConfig(handle);
  const preFormRev = preConfig.formVersions?.[artifact];

  // 3. reproduce (RED) — read-only content assertion against the as-deployed form
  const redEvidence = await agent.verifyArtifact(handle, input.verify);
  const reproduced = !redEvidence.passed;
  messages.push(reproduced ? `RED reproduced — ${redEvidence.summary}` : `no reproduction — ${redEvidence.summary}`);
  if (!reproduced) {
    return abort(
      messages,
      'symptom did not reproduce against the as-deployed config — either the bug is not where the ' +
        'ticket says or the mounted config is not the affected version; refusing to "fix" a non-reproduced symptom',
      { reproduced: false, redEvidence, preFormRev }
    );
  }

  // 4. HC3 — gate the destructive seed + apply (red is now confirmed)
  const approval = await humanQaValidationCheckpoint(input, redEvidence);
  if (!approval.approved) {
    return abort(messages.concat('HC3 declined — no seed/apply performed'),
      'HUMAN VALIDATION CHECKPOINT #3 declined', { reproduced: true, redEvidence, preFormRev });
  }

  // 5. prepareTestData (seed) — optional; tier-1 verify is content-only
  if (input.testDataPath) {
    const seed = await agent.prepareTestData(handle, preConfig, { dataPath: input.testDataPath });
    messages.push(
      `seeded ${seed.placesCreated} places / ${seed.peopleCreated} people / ` +
        `${seed.reportsCreated} reports / ${seed.usersCreated} users`
    );
  } else {
    messages.push('seed skipped (no testDataPath; tier-1 verify is content-only)');
  }

  // 6. applyConfig (the fix)
  const applyResult = await agent.applyConfig(handle, {
    configPath: input.configPath,
    actions: input.applyActions ?? defaultApplyActions(input.verify.configArtifact),
    artifact,
  });
  messages.push(`applied ${input.configPath} — ${applyResult.succeeded ? 'ok' : 'FAILED'}`);

  // 7. discoverConfig (post) + verifyArtifact (GREEN)
  const postConfig = await agent.discoverConfig(handle);
  const postFormRev = postConfig.formVersions?.[artifact];
  const revChanged =
    preFormRev !== undefined && postFormRev !== undefined ? preFormRev !== postFormRev : undefined;
  const greenEvidence = await agent.verifyArtifact(handle, input.verify);
  const verified = greenEvidence.passed;
  messages.push(verified ? `GREEN verified — ${greenEvidence.summary}` : `verify FAILED — ${greenEvidence.summary}`);

  const succeeded = reproduced && applyResult.succeeded && verified;
  return {
    ran: true,
    approved: true,
    reproduced,
    verified,
    succeeded,
    redEvidence,
    greenEvidence,
    applyResult,
    preFormRev,
    postFormRev,
    revChanged,
    messages,
  };
};

/** Print the QA red -> green transition. */
export const displayQaCompletion = (result: QaResult): void => {
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║                        QA PHASE RESULT                         ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');
  if (!result.ran) {
    console.log('QA phase did not run.');
    return;
  }
  console.log(`🔴 Reproduced (red): ${result.reproduced ? '✅' : '❌'}`);
  console.log(`🟢 Verified (green): ${result.verified ? '✅' : '❌'}`);
  if (result.revChanged !== undefined) {
    console.log(`🔁 Form rev changed: ${result.revChanged ? '✅' : '❌'} (${result.preFormRev ?? '?'} → ${result.postFormRev ?? '?'})`);
  }
  console.log(`🏁 Closed loop succeeded: ${result.succeeded ? '✅' : '❌'}`);
  if (result.abortReason) {
    console.log(`\n⚠️  Aborted: ${result.abortReason}`);
  }
  if (result.messages.length > 0) {
    console.log('\n📋 Transition:');
    result.messages.forEach((message, i) => console.log(`   ${i + 1}. ${message}`));
  }
  console.log();
};
