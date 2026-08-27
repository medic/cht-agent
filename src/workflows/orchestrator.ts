/**
 * Workflow Orchestrator
 *
 * Coordinates the full CHT development workflow:
 * 1. Research Phase - Documentation search, context analysis, orchestration plan
 * 2. Human Validation Checkpoint #1 - Approve research or provide feedback
 * 3. Development Phase - Code generation and validation
 * 4. Human Validation Checkpoint #2 (preview mode) - Approve changes before writing
 *
 * This orchestrator chains independent workflows together.
 * Each workflow (research, development) can also be run standalone.
 */

import { ResearchSupervisor } from '../supervisors/research-supervisor';
import { DevelopmentSupervisor } from '../supervisors/development-supervisor';
import { TestEnvironmentAgent } from '../agents/test-environment-agent';
import {
  IssueTemplate,
  DevelopmentOptions,
  DevelopmentWorkflowResult,
  ProvisionOptions,
  QaResult,
  XlsformBindDiff,
} from '../types';
import { askYesNo, askWithOptions } from '../utils/prompt';
import {
  tier2TailExcerpt,
  isTier2EnvironmentalFailure,
  tier2FailuresArePreExisting,
} from '../utils/cht-conf-tier2';
import {
  ScopeGateDecision,
  assessScope,
  buildScopeGateDecision,
  buildWidenBrief,
  buildWidenedTicket,
  parseScopeGateChoice,
  renderScopeAbandonBanner,
  renderScopeGatePanel,
  scopeGateOptions,
  stampHumanDecision,
} from '../utils/scope-gate';
import { writePrBundle } from '../utils/pr-bundle';
import { formatValidationScore } from '../utils/score-display';
import {
  executeResearchWorkflow,
  displayWorkflowCompletion as displayResearchCompletion,
  ResearchWorkflowResult,
} from './research-workflow';
import {
  executeDevelopmentWorkflow,
  createDevelopmentInput,
  displayDevelopmentCompletion,
} from './development-workflow';
import { createQaInput, executeQaWorkflow, displayQaCompletion } from './qa-workflow';

/**
 * Full workflow result combining research, development and (optionally) QA.
 */
export interface FullWorkflowResult {
  research: ResearchWorkflowResult;
  development?: DevelopmentWorkflowResult;
  /** Present only when the QA phase ran (cht-conf ticket + --qa). */
  qa?: QaResult;
  /**
   * HC5: the scope decision, when the gate had something to ask. `choice:
   * 'abandon'` means no PR bundle was written and the CLI must exit non-zero.
   */
  scopeGate?: ScopeGateDecision;
}

/**
 * QA phase options. Opt-in via the CLI `--qa` flag: default off so cht-core runs
 * are unchanged and the phase only fires for cht-conf tickets when an instance
 * is available. `agent` is injectable for tests.
 */
export interface QaOptions {
  enabled: boolean;
  agent?: TestEnvironmentAgent;
  useMockDocker?: boolean;
  testDataPath?: string;
  autoApprove?: boolean;
  provision?: ProvisionOptions;
  /** F7: opt-in tier-2 QA (`--qa-tier2`) — repo-pinned harness spec after GREEN. */
  tier2?: boolean;
}

/**
 * Bound on QA-driven development retries within one run.
 *
 * Each retry is human-approved, so this is a runaway guard rather than a policy
 * limit — it stops a wrong-but-plausible fix from cycling the destructive
 * seed/apply gate indefinitely if the operator keeps saying yes.
 */
const MAX_QA_RETRIES = 2;

/**
 * HC5 offers ONE scope-widening pass per run.
 *
 * Not a policy number: the gate is offered exactly once and is not re-entered
 * after the widened pass, which is what bounds the mechanism structurally rather
 * than by counting. The widened pass carries the GRAPH's iterationCount forward,
 * so MAX_ITERATIONS stays a per-ticket refinement budget and the pass gets
 * max(1, MAX_ITERATIONS - priorIterations) code-generation passes, never a fresh
 * budget.
 */
const MAX_SCOPE_WIDEN = 1;

/**
 * HC5 may only prompt a human at a terminal.
 *
 * `--qa-auto` must never sit on stdin (the same rule HC4 follows), and a run with
 * no TTY — piped, scripted, CI — used to complete without any post-QA question, so
 * a new blocking prompt there would hang a previously-working invocation. Both
 * cases record ACCEPT and print the panel, so the transcript still carries the
 * evidence.
 */
const isScopeGateInteractive = (qaOptions?: QaOptions): boolean =>
  qaOptions?.autoApprove !== true && process.stdin.isTTY === true;

/**
 * HC5 (scope gate): development can end ABOVE the score bar while validation has
 * named correctness defects the fix did not make, and QA can report tier-2
 * failures that are NEW against the pre-fix baseline. Both say the same thing —
 * the change is inside its declared scope and the scope is wrong.
 *
 * HC4 cannot ask this: it only fires on `!qa.succeeded`, so a green run (m4's
 * shape) never reaches it, and it never fires at all when QA is off or the ticket
 * is cht-core. Its question is also different — "retry the same scope with this
 * evidence" versus "renegotiate the ticket".
 *
 * Returns undefined when there is nothing to decide.
 */
const askScopeGate = async (
  ticket: IssueTemplate,
  development: DevelopmentWorkflowResult,
  qa: QaResult | undefined,
  qaOptions?: QaOptions,
): Promise<ScopeGateDecision | undefined> => {
  // Nothing was shipped, or the XLSForm loop already ended loudly with no fix —
  // there is no scope to renegotiate.
  if (!development.approved || development.result?.xlsformApplyExhausted) {
    return undefined;
  }
  const findings = assessScope({
    ticket,
    ledger: development.result?.recommendationLedger ?? [],
    ...(qa ? { qa } : {}),
  });
  if (!findings.opens) {
    return undefined;
  }
  console.log(renderScopeGatePanel(findings));
  if (!isScopeGateInteractive(qaOptions)) {
    const why = qaOptions?.autoApprove ? 'non-interactive run (--qa-auto)' : 'no TTY on stdin';
    console.log(`ℹ️  ${why}: not prompting. Recording ACCEPT — every item above rides into the PR body.\n`);
    return buildScopeGateDecision({ findings, choice: 'accept', autoResolved: why });
  }
  const answer = await askWithOptions('🧭 How should this change proceed?', scopeGateOptions(findings));
  return buildScopeGateDecision({ findings, choice: parseScopeGateChoice(answer) });
};

/**
 * The single widened development pass HC5 can buy.
 *
 * Runs against a DERIVED ticket: the promoted recommendations are appended to
 * `requirements` (so the planner, the executor, the per-file prompts AND the
 * validator all score against them) and the relaxed constraints are rewritten in
 * place. The ORIGINAL ticket keeps driving QA. Carries previousPlan (so the pass
 * extends the fix instead of re-deriving it), the ledger, and the GRAPH iteration
 * count (so MAX_ITERATIONS is not reset).
 */
const runWidenPass = async (args: {
  developmentSupervisor: DevelopmentSupervisor;
  researchResult: ResearchWorkflowResult;
  developmentOptions: DevelopmentOptions;
  ticket: IssueTemplate;
  previous: DevelopmentWorkflowResult;
  decision: ScopeGateDecision;
}): Promise<{ development: DevelopmentWorkflowResult; ticket: IssueTemplate } | undefined> => {
  const { developmentSupervisor, researchResult, developmentOptions, previous, decision } = args;
  if (!researchResult.result) {
    return undefined;
  }
  const widenInput = createDevelopmentInput(researchResult.result, developmentOptions);
  if (!widenInput) {
    console.error('❌ Could not rebuild development input for the widened pass; keeping the current result.');
    return undefined;
  }
  const widenedTicket = buildWidenedTicket(args.ticket, decision);
  widenInput.issue = widenedTicket;
  widenInput.additionalContext = buildWidenBrief(decision);
  widenInput.previousPlan = previous.result?.codeGeneration?.plan;
  // The GRAPH's counter, not the HC2 rejection counter: MAX_ITERATIONS is a
  // per-ticket budget and a widened pass must not be handed a fresh one.
  widenInput.priorIterations = previous.result?.iterationCount ?? previous.iterationCount ?? 0;
  widenInput.priorRecommendationLedger = previous.result?.recommendationLedger;
  console.log(
    `\n🧭 Re-running development with a WIDENED scope (${MAX_SCOPE_WIDEN} pass; ` +
      `${decision.promoted.length} promoted requirement(s), ` +
      `${decision.relaxedConstraints.length} relaxed constraint(s))...\n`,
  );
  const development = await executeDevelopmentWorkflow(developmentSupervisor, widenInput);
  displayDevelopmentCompletion(development, developmentOptions);
  return { development, ticket: widenedTicket };
};

/**
 * Render a failed QA run as development feedback.
 *
 * QA is the only phase that observes the fix against a real instance, so its
 * evidence is the highest-signal input the next development iteration can get —
 * without it the retry re-derives from the same static context that produced
 * the failing fix. Reaches code generation as `additionalContext`, which the
 * supervisor stores as `validationFeedback` and the plan prompt renders under
 * "Validation Feedback from Previous Iteration".
 */
export const formatQaFeedback = (qa: QaResult): string => {
  const lines: string[] = [
    'The previous fix was applied to a live CHT instance and QA did not pass.',
    `Reproduced (red baseline): ${qa.reproduced ? 'yes' : 'NO — the symptom never reproduced pre-fix'}`,
    `Verified (green): ${qa.verified ? 'yes' : 'NO — the deployed artifact still fails the assertion'}`,
  ];
  if (qa.abortReason) {
    lines.push(`Abort reason: ${qa.abortReason}`);
  }
  if (qa.redEvidence?.summary) {
    lines.push(`Red evidence: ${qa.redEvidence.summary}`);
  }
  if (qa.greenEvidence?.summary) {
    lines.push(`Green evidence: ${qa.greenEvidence.summary}`);
  }
  // Tier-2 is the only behavioural evidence in the pipeline (repo-pinned mocha
  // over the harness specs), so its failure tail is the most actionable thing
  // we can hand back — it names the assertion that broke, not just that one did.
  if (qa.tier2?.ran && qa.tier2.passed === false) {
    lines.push(`Tier-2 harness specs FAILED (${(qa.tier2.specs ?? []).join(', ') || 'specs unknown'}):`);
    lines.push(tier2TailExcerpt(qa.tier2.outputTail));
  }
  if (qa.messages.length > 0) {
    lines.push('QA transition log:', ...qa.messages.map(m => `  - ${m}`));
  }
  const blocker = qaRetryBlocker(qa);
  if (blocker) {
    lines.push(`NOTE: ${blocker}`);
  }
  return lines.join('\n');
};

/**
 * Why a development retry cannot help, when that is knowable.
 *
 * Every one of these is a QA run that failed for a reason the code cannot fix,
 * and each was observed steering an operator toward rewriting a correct fix.
 * Returns undefined when the failure genuinely does implicate the change.
 */
export const qaRetryBlocker = (qa: QaResult): string | undefined => {
  if (!qa.reproduced) {
    return 'the red baseline did not reproduce, so this run proves nothing about the fix. ' +
      'Check whether the deployed config already matches the corrected config before changing the implementation.';
  }
  if (qa.applyResult && !qa.applyResult.succeeded) {
    // Verify then re-reads an unchanged instance and echoes the red string, so
    // "green failed" here is arithmetic, not evidence about the fix.
    return 'the config apply FAILED, so the fix was never deployed and never tested. ' +
      'Green repeats red because the instance never changed. Fix the apply failure ' +
      '(see the cht-conf output above), not the code.';
  }
  if (qa.verified && qa.tier2?.ran && qa.tier2.passed === false
      && isTier2EnvironmentalFailure(qa.tier2.outputTail)) {
    return 'green PASSED and tier-2 did not fail an assertion — the harness browser ' +
      'failed to launch, so the specs never ran. This is an environment problem ' +
      '(Chromium needs --no-sandbox under cap_drop ALL), not a defect in the fix.';
  }
  if (qa.verified && tier2FailuresArePreExisting(qa.tier2)) {
    // The baseline run proved these specs were already red before the change.
    return 'green PASSED and every tier-2 failure was already failing before this ' +
      'change (see the baseline line above) — the fix introduced no new failures. ' +
      'Retrying would send development to chase pre-existing breakage.';
  }
  return undefined;
};

/**
 * HC4: surface a failed QA run and let the operator decide whether to spend
 * another development pass on it. Never prompts under --qa-auto-approve; an
 * unattended run must not sit waiting on stdin.
 */
const askQaRetry = async (qa: QaResult, qaOptions?: QaOptions): Promise<boolean> => {
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║            HUMAN VALIDATION CHECKPOINT #4                      ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');
  console.log('❌ QA did not pass. Evidence:\n');
  console.log(formatQaFeedback(qa));
  console.log('');

  // Don't offer a retry the evidence already rules out — the prompt itself
  // reads as a recommendation, and answering yes would rewrite a fix that was
  // never tested or is already proven.
  const blocker = qaRetryBlocker(qa);
  if (blocker) {
    console.log('⛔ Not offering a development retry — it cannot change this outcome.');
    console.log(`   ${blocker}\n`);
    return false;
  }

  if (qaOptions?.autoApprove) {
    console.log('ℹ️  Non-interactive run (--qa-auto-approve): not retrying development.\n');
    return false;
  }
  return askYesNo('🔁 Retry development with this QA feedback? [yes/no]: ');
};

/**
 * Ask user for development options (preview mode, etc.)
 */
export const askDevelopmentOptions = async (
  chtCorePath: string
): Promise<DevelopmentOptions> => {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║                  DEVELOPMENT OPTIONS                           ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  const previewMode = await askYesNo(
    '👁️  Would you like to preview changes before writing to cht-core? (recommended)'
  );

  return {
    chtCorePath,
    previewMode,
  };
};

/**
 * Execute the full workflow: Research -> Development -> (optional) QA
 * Chains research to development automatically when research is approved; runs
 * the QA closed loop after development when QA is enabled for a cht-conf ticket.
 */
export const executeFullWorkflow = async (
  researchSupervisor: ResearchSupervisor,
  developmentSupervisor: DevelopmentSupervisor,
  ticket: IssueTemplate,
  developmentOptions: DevelopmentOptions,
  qaOptions?: QaOptions
): Promise<FullWorkflowResult> => {
  // Run research workflow with human validation checkpoint #1
  const researchResult = await executeResearchWorkflow(researchSupervisor, ticket);

  // Display research completion status
  displayResearchCompletion(researchResult);

  if (!researchResult.approved || !researchResult.result) {
    return {
      research: researchResult,
    };
  }

  // Research approved - proceed to development
  console.log('🚀 Starting Development Phase...\n');

  // Create development input from research results
  const developmentInput = createDevelopmentInput(researchResult.result, developmentOptions);

  if (!developmentInput) {
    console.error('❌ Failed to create development input from research results');
    return {
      research: researchResult,
    };
  }

  // Execute development workflow (with optional human validation checkpoint #2 in preview mode)
  let developmentResult = await executeDevelopmentWorkflow(
    developmentSupervisor,
    developmentInput
  );

  // Display development completion
  displayDevelopmentCompletion(developmentResult, developmentOptions);

  // Every file THIS ticket wrote, across passes. A QA retry's filesWritten covers
  // only that pass — the code-gen module captures its diff against a tree the
  // previous pass's edits were stashed out of — yet those earlier files are still
  // in the config mount and still part of this change. Both consumers need the
  // union: the PR bundle scopes its patch to this set, and the tier-2 baseline
  // reverts it to reconstruct the pre-fix sources.
  const ticketFiles = new Set<string>(developmentResult.filesWritten ?? []);

  // QA phase (closed loop) — only when enabled, development approved, cht-conf.
  // F5: thread the dev phase's XLSForm apply bind-diff (nodeset + corrected
  // relevant) into QA so the fix's OWN bind is asserted red→green — a child bind
  // the group snapshot misses now fires RED against the still-buggy deployed form.
  let qa = developmentResult.approved
    ? await runQaPhase(
      ticket,
      developmentOptions,
      qaOptions,
      developmentResult.result?.xlsformApply?.bindDiff,
      [...ticketFiles]
    )
    : undefined;

  // HC4: QA is the only phase that tests the fix against a real instance, but
  // its verdict used to be terminal — a failing fix ended the run with the
  // evidence printed and nothing consuming it. Offer to spend another
  // development pass with that evidence as feedback. Human-gated because each
  // retry re-runs the destructive HC3 seed/apply against the live instance.
  let qaRetries = 0;
  while (qa?.ran && !qa.succeeded && qaRetries < MAX_QA_RETRIES) {
    if (!(await askQaRetry(qa, qaOptions))) {
      break;
    }
    qaRetries++;
    console.log(`\n🔁 Re-running development with QA feedback (retry ${qaRetries}/${MAX_QA_RETRIES})...\n`);

    const retryInput = createDevelopmentInput(researchResult.result, developmentOptions);
    if (!retryInput) {
      console.error('❌ Could not rebuild development input for the QA retry; keeping the current result.');
      break;
    }
    retryInput.additionalContext = formatQaFeedback(qa);
    // Carry the executed plan and the iteration count across the retry: without
    // them the fresh graph re-plans from scratch (observed reverting the prior
    // pass's fixes) and its log restarts at "iteration 1".
    retryInput.previousPlan = developmentResult.result?.codeGeneration?.plan;
    retryInput.priorIterations = developmentResult.iterationCount ?? 0;
    // m4: a QA retry starts a fresh graph; without this the previous pass's
    // deferrals disappear from the final state and never reach the PR body.
    retryInput.priorRecommendationLedger = developmentResult.result?.recommendationLedger;

    developmentResult = await executeDevelopmentWorkflow(developmentSupervisor, retryInput);
    displayDevelopmentCompletion(developmentResult, developmentOptions);
    for (const rel of developmentResult.filesWritten ?? []) {
      ticketFiles.add(rel);
    }

    if (!developmentResult.approved) {
      // The operator rejected the regenerated diff at HC2 — re-running QA would
      // test a fix nobody accepted.
      console.log('ℹ️  Development was not approved on retry; skipping the QA re-run.\n');
      break;
    }
    qa = await runQaPhase(
      ticket,
      developmentOptions,
      qaOptions,
      developmentResult.result?.xlsformApply?.bindDiff,
      [...ticketFiles]
    );
  }
  if (qa?.ran && !qa.succeeded && qaRetries >= MAX_QA_RETRIES) {
    console.log(`\n⚠️  QA still failing after ${MAX_QA_RETRIES} retries — stopping. Review the evidence above.\n`);
  }

  // HC5 (scope gate). Placed AFTER the HC4 loop settles: the cheap same-scope
  // retry is offered first, and scope renegotiation only once that is declined or
  // exhausted. Offered ONCE — there is no loop here, which is what bounds it.
  const scopeGate = await askScopeGate(ticket, developmentResult, qa, qaOptions);
  // The PR body must describe the requirements the change was actually built to.
  let prTicket = ticket;
  if (scopeGate && (scopeGate.choice === 'widen' || scopeGate.choice === 'widen-relax')) {
    const widened = await runWidenPass({
      developmentSupervisor,
      researchResult,
      developmentOptions,
      ticket,
      previous: developmentResult,
      decision: scopeGate,
    });
    if (widened) {
      developmentResult = widened.development;
      prTicket = widened.ticket;
      for (const rel of developmentResult.filesWritten ?? []) {
        ticketFiles.add(rel);
      }
      if (developmentResult.approved) {
        // Re-prove the widened fix against the instance, using the ORIGINAL
        // ticket: qaSpecs and the reproduce/verify assertions belong to the issue
        // as filed, not to the renegotiated scope.
        qa = await runQaPhase(
          ticket,
          developmentOptions,
          qaOptions,
          developmentResult.result?.xlsformApply?.bindDiff,
          [...ticketFiles],
        );
      } else {
        console.log('ℹ️  The widened pass was not approved at HC2; skipping the QA re-run.\n');
      }
    }
  }

  // Handoff artefact, written last so it can carry the QA verdict. The agent
  // never pushes or opens PRs, so this is the only thing the operator needs to
  // copy out of the container to raise the change against the real config repo.
  const configRoot = developmentOptions.developmentTarget?.repoPath;
  if (scopeGate?.choice === 'abandon') {
    // A human judged the change unfit to raise: no bundle, and name the files
    // HC2 already wrote so the mount can be reverted before the next ticket.
    console.log(renderScopeAbandonBanner([...ticketFiles], configRoot));
  } else if (configRoot && developmentResult.approved) {
    const ledger = stampHumanDecision(
      developmentResult.result?.recommendationLedger ?? [],
      scopeGate,
    );
    const testVerification = developmentResult.result?.testGeneration?.verification;
    await writePrBundle({
      configRoot,
      ticket: prTicket,
      filesWritten: [...ticketFiles],
      ...(qa ? { qa } : {}),
      ...(ledger.length > 0 ? { recommendations: ledger } : {}),
      ...(testVerification ? { testVerification } : {}),
    });
  }

  return {
    research: researchResult,
    development: developmentResult,
    ...(qa ? { qa } : {}),
    ...(scopeGate ? { scopeGate } : {}),
  };
};

/**
 * Run the QA closed loop after an approved Development phase. Returns undefined
 * (skips) when QA is disabled or the ticket is not layer: cht-conf, so cht-core
 * runs are unchanged. Extracted + exported so the wiring is unit-testable.
 *
 * F5: `bindDiff` is the development phase's `XlsformApplyResult.bindDiff` (the
 * corrected target bind). When present it is threaded into the verify
 * expectation set so QA's reproduce/verify asserts the fix's own bind. Undefined
 * (no dev result in scope — the caller passes it only when the dev phase
 * produced one) leaves the verify set at its group-bind fallback, unchanged.
 */
export const runQaPhase = async (
  ticket: IssueTemplate,
  developmentOptions: DevelopmentOptions,
  qaOptions?: QaOptions,
  bindDiff?: XlsformBindDiff,
  /** Files the development phase wrote — the tier-2 baseline reverts exactly these. */
  fixFiles?: string[]
): Promise<QaResult | undefined> => {
  if (!qaOptions?.enabled) {
    return undefined;
  }
  if (ticket.issue.technical_context.layer !== 'cht-conf') {
    console.log('ℹ️  QA phase skipped — the closed loop only runs for layer: cht-conf tickets\n');
    return undefined;
  }

  console.log('\n🧪 Starting QA Phase (closed loop: reproduce → fix → verify)...\n');
  const qaInput = createQaInput({
    issue: ticket,
    configPath: developmentOptions.developmentTarget?.repoPath,
    provision: qaOptions.provision,
    testDataPath: qaOptions.testDataPath,
    autoApprove: qaOptions.autoApprove,
    ...(bindDiff ? { bindDiff } : {}),
    ...(fixFiles && fixFiles.length > 0 ? { fixFiles } : {}),
    ...(qaOptions.tier2 ? { tier2: qaOptions.tier2 } : {}),
  });
  if (!qaInput) {
    console.error('❌ QA phase could not start — see the reason above; skipping QA.\n');
    return undefined;
  }

  const agent =
    qaOptions.agent ?? new TestEnvironmentAgent({ useMockDocker: qaOptions.useMockDocker ?? false });
  const result = await executeQaWorkflow(agent, qaInput);
  displayQaCompletion(result);
  return result;
};

/**
 * Execute research-only workflow
 * Useful when you want to run just the research phase
 */
export const executeResearchOnly = async (
  researchSupervisor: ResearchSupervisor,
  ticket: IssueTemplate
): Promise<ResearchWorkflowResult> => {
  const result = await executeResearchWorkflow(researchSupervisor, ticket);
  displayResearchCompletion(result);
  return result;
};

/**
 * Execute development-only workflow
 * Useful when you already have research results and want to run just development
 */
export const executeDevelopmentOnly = async (
  developmentSupervisor: DevelopmentSupervisor,
  researchResult: ResearchWorkflowResult,
  developmentOptions: DevelopmentOptions
): Promise<DevelopmentWorkflowResult | null> => {
  if (!researchResult.result) {
    console.error('❌ No research result available for development');
    return null;
  }

  const developmentInput = createDevelopmentInput(researchResult.result, developmentOptions);

  if (!developmentInput) {
    console.error('❌ Failed to create development input from research results');
    return null;
  }

  const result = await executeDevelopmentWorkflow(developmentSupervisor, developmentInput);
  displayDevelopmentCompletion(result, developmentOptions);
  return result;
};

/**
 * Display final full workflow summary
 */
export const displayFullWorkflowSummary = (result: FullWorkflowResult): void => {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║                      WORKFLOW SUMMARY                          ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  console.log('📊 Research Phase:');
  console.log(`   Iterations: ${result.research.iterationCount}`);
  console.log(`   Approved: ${result.research.approved ? '✅' : '❌'}`);

  if (result.development) {
    displayDevelopmentSummary(result.development);
  } else {
    console.log('\n📊 Development Phase: Not executed');
  }

  if (result.qa) {
    console.log('\n📊 QA Phase (closed loop):');
    console.log(`   Reproduced (red): ${result.qa.reproduced ? '✅' : '❌'}`);
    console.log(`   Verified (green): ${result.qa.verified ? '✅' : '❌'}`);
    console.log(`   Succeeded: ${result.qa.succeeded ? '✅' : '❌'}`);
    if (result.qa.abortReason) {
      console.log(`   Aborted: ${result.qa.abortReason}`);
    }
  } else {
    console.log('\n📊 QA Phase: Not executed');
  }

  console.log();
};

function displayDevelopmentSummary(development: NonNullable<FullWorkflowResult['development']>): void {
  console.log('\n📊 Development Phase:');
  console.log(`   Iterations: ${development.iterationCount}`);
  console.log(`   Approved: ${development.approved ? '✅' : '❌'}`);
  console.log(`   Files Written: ${development.filesWritten.length}`);
  if (development.result?.validationResult) {
    // F9: annotate an apply-overridden below-threshold LLM score (F8 economics).
    console.log(
      `   Validation Score: ${formatValidationScore({
        overallScore: development.result.validationResult.overallScore,
        hasVerifiedApply: development.result.xlsformApply !== undefined,
      })}`,
    );
  }
}
