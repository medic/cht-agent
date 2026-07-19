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
  EnvironmentHandle,
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
import { canonicalDiffLines } from '../utils/xlsform-apply';
import { runTier2, tier2PassLine, tier2TailExcerpt } from '../utils/cht-conf-tier2';
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
 * F5/P2: `bindDiff` is the target-bind delta the development phase's
 * deterministic XLSForm apply produced (nodeset + the full `attrs` map the fix
 * asserted). When it is present the target bind is asserted FIRST — so the
 * red/green oracle fires on the fix's OWN bind, even a three-segment child bind
 * that `extractTopLevelGroupBinds` (two-segment groups only) never snapshots —
 * carrying the WHOLE attrs map (P2): value attrs the corrected bind carries AND
 * absence assertions (null) for attrs the corrected bind lacks but the fix cares
 * about (the M8 case: a lingering deployed `calculate` reads RED against
 * `attrs: {calculate: null}`). The group-bind set is retained AFTER it as the
 * sibling-invariance oracle (target nodeset de-duplicated out, asserted once).
 * When `bindDiff` is undefined (standalone QA, cht-core tickets, dev-phase-
 * skipped runs) the behavior is byte-identical to before: the group-bind set
 * (each asserting its `relevant`) only.
 *
 * Shape note (P3/P4 extension seam): the returned expectation set is entirely
 * `{nodeset, attrs}` — no relevant-special path — so contact-form QA (P3) and
 * the settings oracle (P4) extend the target/section derivation without
 * re-touching this snapshot logic.
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
    // Target bind FIRST (full attrs map — value + absence), then group binds as
    // sibling invariance (drop the target nodeset so it is asserted exactly once).
    const expectedBinds = [
      { nodeset: bindDiff.nodeset, attrs: bindDiff.attrs },
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
  /** F7: opt-in tier-2 QA (repo-pinned mocha over the form's harness spec). */
  tier2?: boolean;
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
    // F6: carry the bindDiff onto the input so executeQaWorkflow activates the
    // whole-document oracle (deployed-vs-local RED-exact-target / GREEN-identity).
    ...(args.bindDiff ? { bindDiff: args.bindDiff } : {}),
    // F7: carry the tier-2 opt-in so executeQaWorkflow runs the repo harness spec.
    ...(args.tier2 ? { tier2: args.tier2 } : {}),
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
  if (input.tier2) {
    console.log('   • after GREEN: tier-2 harness spec run (repo-pinned mocha over the form spec)');
  }
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

/** How many collateral sample lines to surface in a drift / collateral message. */
const DRIFT_SAMPLE_LINES = 5;

/** Escape hatch: QA_ALLOW_DRIFT=1 downgrades the RED drift abort to a warning. */
const driftAllowed = (): boolean => process.env.QA_ALLOW_DRIFT === '1';

/**
 * Read the corrected local form the QA phase applies
 * (`<configPath>/forms/app/<form>.xml`) — the whole-document reference the F6
 * oracle diffs the deployed XML against. Returns undefined (with no throw) when
 * the file is absent so the oracle self-skips rather than crashing QA.
 */
const readCorrectedLocalForm = (configPath: string, form: string): string | undefined => {
  const formPath = path.join(configPath, 'forms', 'app', `${form}.xml`);
  if (!fs.existsSync(formPath)) {
    return undefined;
  }
  return fs.readFileSync(formPath, 'utf8');
};

/** Outcome of one whole-document (F6) oracle evaluation. */
type WholeDocOracle =
  | { level: 'whole-document'; ok: true }
  // The deployed and corrected-local docs diverge beyond the declared target(s).
  | { level: 'whole-document'; ok: false; extraLines: string[] }
  // The oracle could not run (mock mode / deployed XML or local form absent); the
  // caller falls back to the targeted bind oracle unchanged.
  | { level: 'targeted'; ok: true; reason: string };

/**
 * F6 whole-document canonical comparison of the deployed form against the
 * corrected local `.xml`, using the SAME comparator the dev phase's collateral
 * oracle uses (`canonicalDiffLines`). `excludeTarget` excludes the declared
 * target bind's line(s) (RED — the docs are SUPPOSED to differ there); omit it
 * for the GREEN identity check (the target must now match too). When the deployed
 * XML or the local form is unavailable, the oracle self-skips to the targeted
 * level so mock/standalone runs are byte-identical.
 */
const runWholeDocOracle = async (
  agent: TestEnvironmentAgent,
  handle: EnvironmentHandle,
  configPath: string,
  bindDiff: XlsformBindDiff,
  form: string,
  excludeTarget: boolean
): Promise<WholeDocOracle> => {
  const deployedXml = await agent.fetchDeployedFormXml(handle, form);
  if (deployedXml === undefined) {
    return { level: 'targeted', ok: true, reason: 'deployed XML unavailable (mock mode)' };
  }
  const localXml = readCorrectedLocalForm(configPath, form);
  if (localXml === undefined) {
    return { level: 'targeted', ok: true, reason: `corrected local form not found at forms/app/${form}.xml` };
  }
  const extraLines = canonicalDiffLines(
    deployedXml,
    localXml,
    excludeTarget ? { excludeNodeset: bindDiff.nodeset } : {}
  );
  if (extraLines.length === 0) {
    return { level: 'whole-document', ok: true };
  }
  return { level: 'whole-document', ok: false, extraLines };
};

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

  // 3b. F6 whole-document RED oracle (ACTIVE only when a dev-phase bindDiff is in
  // scope). The deployed form must differ from the corrected local `.xml` EXACTLY
  // at the target bind and nowhere else — proving both the bug AND that the mount
  // is a faithful pre-image of the deployment. Any OTHER canonical diff is
  // ENVIRONMENT DRIFT: abort loudly (sample lines) BEFORE the destructive
  // seed/apply, unless QA_ALLOW_DRIFT=1 downgrades it to a warning + the targeted
  // oracle. No bindDiff ⇒ this whole block is skipped (targeted-oracle behavior).
  if (input.bindDiff) {
    const redDoc = await runWholeDocOracle(
      agent,
      handle,
      input.configPath,
      input.bindDiff,
      artifact,
      /* excludeTarget */ true
    );
    if (redDoc.level === 'targeted') {
      messages.push(`RED oracle: targeted (whole-document skipped — ${redDoc.reason})`);
    } else if (redDoc.ok) {
      messages.push('RED oracle: whole-document — deployed differs from local ONLY at the target bind');
    } else if (driftAllowed()) {
      messages.push(
        `RED oracle: whole-document drift TOLERATED (QA_ALLOW_DRIFT=1) — ${redDoc.extraLines.length} ` +
          `unexpected line(s); falling back to the targeted oracle: ` +
          redDoc.extraLines.slice(0, DRIFT_SAMPLE_LINES).join(' | ')
      );
    } else {
      return abort(
        messages.concat(
          `RED oracle: whole-document ENVIRONMENT DRIFT — ${redDoc.extraLines.length} line(s)`
        ),
        `ENVIRONMENT DRIFT — the deployed form differs from the corrected local config at ` +
          `${redDoc.extraLines.length} line(s) BEYOND the target bind ${input.bindDiff.nodeset}. The ` +
          `mount is not a faithful pre-image of the deployment (converter/version skew or an ` +
          `out-of-band edit), so a red/green result would be meaningless. Sample: ` +
          `${redDoc.extraLines.slice(0, DRIFT_SAMPLE_LINES).join(' | ')}. Set QA_ALLOW_DRIFT=1 to ` +
          `proceed with the targeted oracle instead.`,
        { reproduced: true, redEvidence, preFormRev }
      );
    }
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
  const bindsVerified = greenEvidence.passed;
  messages.push(
    bindsVerified ? `GREEN verified — ${greenEvidence.summary}` : `verify FAILED — ${greenEvidence.summary}`
  );

  // 7b. F6 whole-document GREEN oracle (ACTIVE only when a dev-phase bindDiff is
  // in scope). Beyond the bind assertions, the deployed form must now be
  // canonically IDENTICAL to the corrected local `.xml` (target bind included —
  // no exclusion). Any residual canonical diff FAILS verify and lists the
  // collateral lines. No bindDiff ⇒ the bind assertions alone decide verify
  // (targeted-oracle behavior, unchanged).
  let verified = bindsVerified;
  if (input.bindDiff && bindsVerified) {
    const greenDoc = await runWholeDocOracle(
      agent,
      handle,
      input.configPath,
      input.bindDiff,
      artifact,
      /* excludeTarget */ false
    );
    if (greenDoc.level === 'targeted') {
      messages.push(`GREEN oracle: targeted (whole-document skipped — ${greenDoc.reason})`);
    } else if (greenDoc.ok) {
      messages.push('GREEN oracle: whole-document — deployed is canonically identical to local');
    } else {
      verified = false;
      messages.push(
        `GREEN oracle: whole-document FAILED — deployed differs from local at ` +
          `${greenDoc.extraLines.length} line(s): ` +
          greenDoc.extraLines.slice(0, DRIFT_SAMPLE_LINES).join(' | ')
      );
    }
  }

  let succeeded = reproduced && applyResult.succeeded && verified;

  // 8. F7 tier-2 (opt-in): after the tier-1 GREEN, run the config repo's OWN
  // pinned mocha over the affected form's harness spec(s). It folds into
  // `succeeded` when it ran; a missing harness/spec is an honest self-skip that
  // leaves `succeeded` unchanged. Only attempted when tier-1 already succeeded —
  // there is nothing to strengthen about an already-failed loop.
  let tier2;
  if (input.tier2 && succeeded) {
    tier2 = await runTier2({ configRoot: input.configPath, form: artifact });
    if (tier2.ran) {
      succeeded = succeeded && tier2.passed === true;
      if (tier2.passed) {
        // F9: carry the parsed passing count in the transition, not a bare label.
        messages.push(tier2PassLine(tier2.outputTail));
      } else {
        // F9: carry the bounded output excerpt in the transition instead of the
        // useless "see outputTail" (the diagnosis needed a manual rerun before).
        messages.push(
          `tier-2 FAILED — last output:\n${tier2TailExcerpt(tier2.outputTail)}`,
        );
      }
    } else {
      messages.push(`tier-2: skipped — ${tier2.reason}`);
    }
  }

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
    ...(tier2 ? { tier2 } : {}),
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
  if (result.tier2) {
    const t = result.tier2;
    if (!t.ran) {
      console.log(`🔬 Tier-2 (harness spec): ⏭️  skipped (${t.reason})`);
    } else if (t.passed) {
      // F9: one-line pass with the parsed mocha passing count when available.
      console.log(`🔬 Tier-2 (harness spec): ✅ ${tier2PassLine(t.outputTail)}`);
    } else {
      // F9: print a bounded tail excerpt inline so the failure is diagnosable
      // from the panel itself (no manual rerun to see why it failed).
      console.log('🔬 Tier-2 (harness spec): ❌ failed — last output:');
      console.log(tier2TailExcerpt(t.outputTail));
    }
  }
  if (result.abortReason) {
    console.log(`\n⚠️  Aborted: ${result.abortReason}`);
  }
  if (result.messages.length > 0) {
    console.log('\n📋 Transition:');
    result.messages.forEach((message, i) => console.log(`   ${i + 1}. ${message}`));
  }
  console.log();
};
