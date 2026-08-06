/**
 * Development Workflow
 *
 * Shared workflow logic for running development with optional human validation checkpoint.
 * Used by both CLI and example commands.
 *
 * Two modes:
 * - Preview Mode: Write to staging, show diffs, human validation checkpoint #2, then write to cht-core
 * - Direct Mode: Write directly to cht-core (no checkpoint #2)
 */

import { DevelopmentSupervisor } from '../supervisors/development-supervisor';
import {
  IssueTemplate,
  DevelopmentState,
  DevelopmentInput,
  DevelopmentOptions,
  DevelopmentTarget,
  ResearchState,
  GeneratedFile,
  DevelopmentWorkflowResult,
  HumanFeedback,
  TriagedRecommendation,
} from '../types';
import { resolveDevelopmentTarget } from '../utils/dev-target';
import { askYesNo, askForFeedback } from '../utils/prompt';
import {
  generateDiffs,
  displayDiffs,
  displayFileSummary,
  copyToTarget,
  clearStaging,
  removeFromStaging,
} from '../utils/staging';
import {
  renderCrossFileIssueBanner,
  renderCompileGateSkipBanner,
  renderXlsformBindDiffBanner,
  renderXlsformExhaustedBanner,
  renderRecommendationLedgerBanner,
} from '../cli/display-helpers';
import { formatValidationScore } from '../utils/score-display';
import { recommendationText, summarizeLedger } from '../utils/recommendation-triage';

const MAX_DEVELOPMENT_ITERATIONS = 3;

/**
 * Display development results to the user
 */
export const displayDevelopmentResults = (state: DevelopmentState, duration: string): void => {
  displayDevelopmentHeader(state, duration);
  if (state.codeGeneration) displayCodeGenerationResults(state.codeGeneration);
  if (state.testGeneration) displayTestGenerationResults(state.testGeneration);
  if (state.validationResult) {
    displayValidationResults(
      state.validationResult,
      state.xlsformApply !== undefined,
      state.recommendationLedger,
    );
  }
};

function displayDevelopmentHeader(state: DevelopmentState, duration: string): void {
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║                    DEVELOPMENT RESULTS                         ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');
  console.log(`⏱️  Duration: ${duration} seconds`);
  console.log(`📊 Phase: ${state.currentPhase}`);
  console.log(`❌ Errors: ${state.errors.length}\n`);
  if (state.errors.length > 0) {
    console.log('⚠️  Errors encountered:');
    state.errors.forEach(error => console.log(`   - ${error}`));
    console.log();
  }
}

function displayCodeGenerationResults(codeGen: NonNullable<DevelopmentState['codeGeneration']>): void {
  console.log('💻 CODE GENERATION RESULTS');
  console.log('─'.repeat(70));
  console.log(`Generated Files: ${codeGen.files.length}`);
  console.log(`Confidence: ${(codeGen.confidence * 100).toFixed(0)}%`);
  console.log(`\nSummary:`);
  console.log(`   ${codeGen.summary}`);
  printNumberedList('✅ Implemented Requirements:', codeGen.implementedRequirements);
  printNumberedList('⏳ Pending Requirements:', codeGen.pendingRequirements);
  printNumberedList('📝 Notes:', codeGen.notes);
  if (codeGen.files.length > 0) {
    console.log(`\nGenerated Files:`);
    codeGen.files.forEach((file, i) => {
      console.log(`   ${i + 1}. ${file.relativePath}`);
      console.log(`      Type: ${file.type} | Language: ${file.language} | Action: ${file.action}`);
      if (file.description) console.log(`      ${file.description}`);
    });
  }
  console.log();
}

function displayTestGenerationResults(testGen: NonNullable<DevelopmentState['testGeneration']>): void {
  console.log('🧪 TEST GENERATION RESULTS');
  console.log('─'.repeat(70));
  console.log(`Generated Files: ${testGen.files.length}`);
  if (testGen.explanation) {
    console.log(`\nSummary:`);
    console.log(`   ${testGen.explanation}`);
  }
  if (testGen.files.length > 0) {
    console.log(`\nGenerated Files:`);
    testGen.files.forEach((file, i) => {
      console.log(`   ${i + 1}. ${file.relativePath}`);
      console.log(`      Type: ${file.type} | Language: ${file.language} | Action: ${file.action}`);
      if (file.description) console.log(`      ${file.description}`);
    });
  }
  if (testGen.requirementsChecklist.length > 0) {
    console.log(`\nRequirements Checklist:`);
    testGen.requirementsChecklist.forEach((item, i) => {
      const scenarios = item.scenarios.map(s => s.name).join(', ');
      console.log(`   ${i + 1}. ${item.requirement}: ${scenarios}`);
    });
  }
  printNumberedList('⚠️  Warnings:', testGen.warnings ?? []);
  console.log();
}

function displayValidationResults(
  validation: NonNullable<DevelopmentState['validationResult']>,
  hasVerifiedApply: boolean,
  ledger?: ReadonlyArray<TriagedRecommendation>,
): void {
  console.log('✅ VALIDATION RESULTS');
  console.log('─'.repeat(70));
  // F9: annotate when a verified deterministic apply overrode a below-threshold
  // LLM score (F8 economics), so a low number is not misread as a failed run.
  console.log(`Overall Score: ${formatValidationScore({ overallScore: validation.overallScore, hasVerifiedApply })}`);
  const metCount = validation.requirementsMet.filter(r => r.met).length;
  console.log(`Requirements Met: ${metCount}/${validation.requirementsMet.length}`);
  const passedCount = validation.acceptanceCriteriaPassed.filter(c => c.passed).length;
  console.log(`Acceptance Criteria Passed: ${passedCount}/${validation.acceptanceCriteriaPassed.length}`);
  // m4: show each recommendation's DISPOSITION, not a flat list a reader can
  // mistake for "handled". Falls back to the flat list when there is no ledger
  // (heuristic validation path).
  if (ledger && ledger.length > 0) {
    printRecommendationDispositions(ledger);
  } else {
    printNumberedList('💡 Recommendations:', validation.recommendations.map(recommendationText));
  }
  console.log();
}

function printRecommendationDispositions(ledger: ReadonlyArray<TriagedRecommendation>): void {
  const counts = summarizeLedger(ledger);
  console.log(
    `\n💡 Recommendations: ${counts.applied} applied, ${counts.deferredBlocking} deferred (correctness), ` +
      `${counts.deferredAdvisory} deferred (advisory)`,
  );
  ledger.forEach((entry, i) => {
    const tag = entry.disposition === 'applied' ? 'APPLIED' : `DEFERRED/${entry.severity}`;
    console.log(`   ${i + 1}. [${tag}] ${entry.text}`);
    const detail = entry.disposition === 'applied' ? entry.evidence : entry.deferralReason;
    if (detail) {
      console.log(`      ${detail}`);
    }
  });
}

function printNumberedList(heading: string, items: ReadonlyArray<string>): void {
  if (items.length === 0) return;
  console.log(`\n${heading}`);
  items.forEach((item, i) => console.log(`   ${i + 1}. ${item}`));
}

/**
 * Run development phase and return results with duration
 */
export const runDevelopment = async (
  supervisor: DevelopmentSupervisor,
  input: DevelopmentInput,
  additionalContext?: string
): Promise<{ state: DevelopmentState; duration: string }> => {
  console.log('🔧 Running Development Phase...\n');
  const startTime = Date.now();

  const inputWithContext: DevelopmentInput = additionalContext
    ? { ...input, additionalContext }
    : input;

  const state = await supervisor.develop(inputWithContext);

  const endTime = Date.now();
  const duration = ((endTime - startTime) / 1000).toFixed(2);

  return { state, duration };
};

/**
 * Human validation checkpoint #2 after development (preview mode only)
 * Returns the human feedback with approval status
 */
export const humanDevelopmentValidationCheckpoint = async (
  state: DevelopmentState,
  stagingPath: string,
  chtCorePath: string,
  iterationCount: number
): Promise<HumanFeedback> => {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║            HUMAN VALIDATION CHECKPOINT #2                      ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');
  if (iterationCount > 1) console.log(`📝 This is development iteration #${iterationCount}\n`);

  const allFiles = collectAllGeneratedFiles(state);
  console.log('📂 FILES TO BE WRITTEN');
  console.log('─'.repeat(70));
  displayFileSummary(allFiles);
  console.log();
  displayCheckpointBanners(state, chtCorePath);

  console.log('📝 FILE DIFFS');
  console.log('─'.repeat(70));
  const diffs = await generateDiffs(allFiles, stagingPath, chtCorePath);
  displayDiffs(diffs);
  console.log();

  return await captureCheckpointFeedback();
};

function collectAllGeneratedFiles(state: DevelopmentState): GeneratedFile[] {
  const allFiles: GeneratedFile[] = [];
  if (state.codeGeneration) allFiles.push(...state.codeGeneration.files);
  if (state.testGeneration) allFiles.push(...state.testGeneration.files);
  return allFiles;
}

function displayCheckpointBanners(state: DevelopmentState, chtCorePath: string): void {
  // H.4 (v6): surface compile-gate skip + unresolved cross-file issues
  // BEFORE the diff so the user reads the warnings in context.
  if (state.codeGeneration?.compileGateSkipped) {
    const reason = state.codeGeneration.compileGateSkipReason ?? 'reason not provided';
    console.log(renderCompileGateSkipBanner(reason, chtCorePath));
    console.log();
  }
  const banner = renderCrossFileIssueBanner(state.codeGeneration?.crossFileIssues);
  if (banner) {
    console.log(banner);
    console.log();
  }
  // m4: deferred validation recommendations — the human at HC2 is the last
  // chance to catch a correctness item the loop chose not to spend a pass on.
  const ledgerBanner = renderRecommendationLedgerBanner(state.recommendationLedger);
  if (ledgerBanner) {
    console.log(ledgerBanner);
    console.log();
  }
  // Mission 05: for an XLSForm fix, show the bind-level diff — the regenerated
  // XML is a full rewrite, so the positional file diff below is uninformative.
  const bindBanner = renderXlsformBindDiffBanner(state.xlsformApply);
  if (bindBanner) {
    console.log(bindBanner);
    console.log();
  }
}

async function captureCheckpointFeedback(): Promise<HumanFeedback> {
  const isApproved = await askYesNo('✅ Do you approve these changes to be written to cht-core?');
  if (isApproved) return { approved: true, timestamp: new Date().toISOString() };
  console.log('\n📝 Please provide feedback on what should be changed.');
  const feedback = await askForFeedback(
    'What changes or improvements should be made to the generated code?'
  );
  return {
    approved: false,
    feedback,
    additionalContext: feedback,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Create development input from research results
 */
export const createDevelopmentInput = (
  researchResult: ResearchState,
  options: DevelopmentOptions
): DevelopmentInput | null => {
  const missingFields: string[] = [];
  if (!researchResult.issue) missingFields.push('issue');
  if (!researchResult.orchestrationPlan) missingFields.push('orchestrationPlan');
  if (!researchResult.researchFindings) missingFields.push('researchFindings');
  if (!researchResult.contextAnalysis) missingFields.push('contextAnalysis');

  if (missingFields.length > 0) {
    console.error('❌ Missing required data from research phase:');
    missingFields.forEach(field => console.error(`   - ${field}`));
    return null;
  }

  // At this point we've validated all required fields exist
  return {
    issue: researchResult.issue!,
    orchestrationPlan: researchResult.orchestrationPlan!,
    researchFindings: researchResult.researchFindings!,
    contextAnalysis: researchResult.contextAnalysis!,
    // Bridge (#63): carry the research phase's DeepWiki / canonical-config
    // findings into development. Optional on ResearchState, so undefined passes
    // through cleanly when the research phase produced none.
    codeContextFindings: researchResult.codeContextFindings,
    options,
  };
};

/**
 * Resolve where the development phase writes its fix, layer-routed (#134).
 *
 * Precedence:
 *  1. A target already resolved upstream (the CLI resolves it so a missing /
 *     placeholder config mount fails loudly before any work starts) — honour it.
 *  2. Otherwise resolve from the ticket's layer: a cht-conf ticket targets the
 *     mounted deployment config (CHT_CONF_PATH) via resolveDevelopmentTarget,
 *     which throws when no real config is mounted (fail closed).
 *  3. Everything else (cht-core / unset / investigate) stays on the chtCorePath
 *     working copy — byte-identical to the pre-routing behaviour.
 */
export const resolveWriteTarget = (input: DevelopmentInput): DevelopmentTarget => {
  if (input.options.developmentTarget) {
    return input.options.developmentTarget;
  }
  if (input.issue.issue.technical_context.layer === 'cht-conf') {
    return resolveDevelopmentTarget('cht-conf');
  }
  return { repoPath: input.options.chtCorePath, toolchain: 'cht-core' };
};

/**
 * Run the complete development workflow with optional human validation
 */
export const executeDevelopmentWorkflow = async (
  supervisor: DevelopmentSupervisor,
  input: DevelopmentInput
): Promise<DevelopmentWorkflowResult> => {
  let iterationCount = 0;
  let additionalContext: string | undefined;
  let developmentApproved = false;
  let finalState: DevelopmentState | undefined;
  let filesWritten: string[] = [];

  const { previewMode } = input.options;
  const writeTarget = resolveWriteTarget(input);
  const targetPath = writeTarget.repoPath;
  // A cht-conf fix must be generated INSIDE the deployment config repo (so the
  // code-gen agent can read/edit the form) and written there — never the
  // cht-core working copy. Rewrite the workspace so code generation and the
  // write agree on the target. For cht-core (targetPath === chtCorePath) this
  // is a no-op, keeping that path byte-identical.
  const runInput: DevelopmentInput =
    targetPath === input.options.chtCorePath
      ? input
      : { ...input, options: { ...input.options, chtCorePath: targetPath, developmentTarget: writeTarget } };
  const targetLabel = writeTarget.toolchain === 'cht-conf' ? 'the deployment config' : 'cht-core';

  while (!developmentApproved && iterationCount < MAX_DEVELOPMENT_ITERATIONS) {
    iterationCount++;
    const { state, duration } = await runDevelopment(supervisor, runInput, additionalContext);
    finalState = state;
    displayDevelopmentResults(state, duration);
    // Mission 05 (F4): the XLSForm-fix loop exhausted without a converting
    // descriptor — a loud stop. Print the NO FIX PRODUCED banner, stage/write
    // NOTHING, and leave developmentApproved false so the workflow result is a
    // failure (non-zero CLI exit). Break out of the HC2 retry loop: re-running
    // development cannot help (the supervisor already spent its refinement
    // budget), and there is nothing to approve.
    if (state.xlsformApplyExhausted) {
      console.log(renderXlsformExhaustedBanner(state.xlsformApplyExhausted));
      console.log();
      developmentApproved = false;
      filesWritten = [];
      break;
    }
    if (previewMode) {
      const outcome = await runPreviewModeIteration({
        supervisor, state, chtCorePath: targetPath, iterationCount,
      });
      developmentApproved = outcome.approved;
      additionalContext = outcome.additionalContext;
      filesWritten = outcome.filesWritten;
    } else {
      developmentApproved = true;
      console.log(`\n📝 Writing generated files directly to ${targetLabel}...`);
      filesWritten = await supervisor.writeToChtCore(state, targetPath);
      console.log(`✅ Written ${filesWritten.length} files to ${targetPath}`);
    }
  }

  return {
    approved: developmentApproved,
    result: finalState,
    iterationCount,
    filesWritten,
  };
};

interface PreviewIterationOutcome {
  approved: boolean;
  stagingPath?: string;
  additionalContext?: string;
  filesWritten: string[];
}

async function runPreviewModeIteration(args: {
  supervisor: DevelopmentSupervisor;
  state: DevelopmentState;
  chtCorePath: string;
  iterationCount: number;
}): Promise<PreviewIterationOutcome> {
  const { supervisor, state, chtCorePath, iterationCount } = args;
  console.log('\n📦 Writing generated files to staging area...');
  const { stagingPath } = await supervisor.writeToStaging(state);
  const validation = await humanDevelopmentValidationCheckpoint(state, stagingPath, chtCorePath, iterationCount);
  if (validation.approved) {
    console.log('\n📝 Copying approved files to cht-core...');
    // Mission 05: the .cht-agent descriptor is orchestration-internal — strip it
    // from staging so it never lands in the partner repo. Its content + bind
    // diff live on the returned state (codeGeneration.files / xlsformApply) for
    // the report. No-op when absent.
    await removeFromStaging(stagingPath, '.cht-agent');
    const filesWritten = await copyToTarget(stagingPath, chtCorePath);
    console.log(`✅ Written ${filesWritten.length} files to ${chtCorePath}`);
    await clearStaging(stagingPath);
    return { approved: true, stagingPath, filesWritten };
  }
  if (iterationCount >= MAX_DEVELOPMENT_ITERATIONS) {
    console.log(`\n⚠️  Maximum development iterations (${MAX_DEVELOPMENT_ITERATIONS}) reached.`);
    console.log('Please review the generated code and consider manual adjustments.\n');
    await clearStaging(stagingPath);
    return { approved: false, stagingPath, filesWritten: [] };
  }
  console.log(`\n🔄 Re-running development with your feedback (iteration ${iterationCount + 1}/${MAX_DEVELOPMENT_ITERATIONS})...\n`);
  await clearStaging(stagingPath);
  return { approved: false, stagingPath, additionalContext: validation.additionalContext, filesWritten: [] };
}

/**
 * Display final development workflow completion status
 */
export const displayDevelopmentCompletion = (
  workflowResult: DevelopmentWorkflowResult,
  options: DevelopmentOptions
): void => {
  if (workflowResult.approved && workflowResult.result) {
    displayDevelopmentSuccess(workflowResult, options);
  } else {
    displayDevelopmentNeedsReview();
  }
};

function displayDevelopmentSuccess(
  workflowResult: DevelopmentWorkflowResult,
  options: DevelopmentOptions,
): void {
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║                Development Phase Complete! ✅                  ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');
  console.log(`📁 Files Written: ${workflowResult.filesWritten.length}`);
  // Mission 05 (F4): report the REAL write target. For a cht-conf ticket the fix
  // lands in the mounted deployment config (developmentTarget.repoPath), not the
  // cht-core working copy that chtCorePath points at — echoing chtCorePath here
  // was the cosmetic "Target: /workspace/cht-core" lie.
  const targetPath = resolveCompletionTargetPath(workflowResult, options);
  console.log(`📂 Target: ${targetPath}`);
  console.log(`🔄 Iterations: ${workflowResult.iterationCount}`);
  if (workflowResult.filesWritten.length > 0) {
    console.log(`\n📋 Written Files:`);
    workflowResult.filesWritten.forEach((file, i) => console.log(`   ${i + 1}. ${file}`));
  }
  if (workflowResult.result?.validationResult) {
    // F9: annotate an apply-overridden below-threshold LLM score.
    console.log(
      `\n📊 Validation Score: ${formatValidationScore({
        overallScore: workflowResult.result.validationResult.overallScore,
        hasVerifiedApply: workflowResult.result.xlsformApply !== undefined,
      })}`,
    );
  }
  // Mission 05: echo the verified XLSForm bind fix into the completion summary
  // (report payload) — the descriptor itself never reaches the partner repo.
  const apply = workflowResult.result?.xlsformApply;
  if (apply) {
    // P1: the workbook may live under forms/app or forms/contact — the apply
    // result carries the resolved path. P2: render every asserted attribute
    // (an attrs-only fix, e.g. a removed calculate, has no `relevant` delta).
    const show = (v: string | null | undefined): string =>
      v === null || v === undefined ? '(absent)' : v;
    console.log(`\n🔧 XLSForm fix applied to ${apply.xlsxRelPath} + regenerated .xml`);
    for (const attr of Object.keys(apply.bindDiff.attrs)) {
      console.log(
        `   ${apply.bindDiff.nodeset} ${attr}: ${show(apply.bindDiff.attrsBefore[attr])} → ${show(apply.bindDiff.attrs[attr])}`,
      );
    }
    console.log(`   ${apply.bindDiff.siblingsUnchanged} sibling bind(s) unchanged.`);
  }
  console.log('\n💡 Next Steps:');
  console.log('   1. Review the generated files');
  console.log('   2. Run the tests to verify implementation');
  console.log('   3. Make any necessary manual adjustments');
  console.log('   4. Submit for code review');
  console.log();
}

/**
 * Resolve the path to report as the completion "Target" (F4 cosmetic fix).
 *
 * Ground truth is the workspace the supervisor actually developed + wrote into:
 * `executeDevelopmentWorkflow` rewrites `options.chtCorePath` to the resolved
 * write target for a cht-conf ticket, and the returned state carries that
 * rewritten value. Fall back to the pre-resolved developmentTarget, then to the
 * caller's chtCorePath, so cht-core runs stay byte-identical.
 */
function resolveCompletionTargetPath(
  workflowResult: DevelopmentWorkflowResult,
  options: DevelopmentOptions,
): string {
  return (
    workflowResult.result?.options.chtCorePath ??
    options.developmentTarget?.repoPath ??
    options.chtCorePath
  );
}

function displayDevelopmentNeedsReview(): void {
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║              Development Phase Needs Review ⚠️                 ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');
  console.log('💡 Suggestions:');
  console.log('   1. Review the generated code manually');
  console.log('   2. Refine the requirements in the ticket');
  console.log('   3. Re-run development with more specific feedback');
  console.log();
}

/**
 * Run complete workflow: Research -> Development
 * This chains research and development together
 */
export const executeFullWorkflow = async (
  _issue: IssueTemplate,
  researchResult: ResearchState,
  developmentSupervisor: DevelopmentSupervisor,
  options: DevelopmentOptions
): Promise<DevelopmentWorkflowResult> => {
  console.log('\n🚀 Starting Development Phase...\n');

  // Create development input from research results
  const developmentInput = createDevelopmentInput(researchResult, options);

  if (!developmentInput) {
    return {
      approved: false,
      result: undefined,
      iterationCount: 0,
      filesWritten: [],
    };
  }

  // Execute development workflow
  const result = await executeDevelopmentWorkflow(developmentSupervisor, developmentInput);

  // Display completion status
  displayDevelopmentCompletion(result, options);

  return result;
};
