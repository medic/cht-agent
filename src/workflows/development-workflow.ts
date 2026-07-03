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
  ResearchState,
  GeneratedFile,
  DevelopmentWorkflowResult,
  HumanFeedback,
} from '../types';
import { askYesNo, askForFeedback } from '../utils/prompt';
import {
  generateDiffs,
  displayDiffs,
  displayFileSummary,
  copyToTarget,
  clearStaging,
} from '../utils/staging';
import {
  renderCrossFileIssueBanner,
  renderCompileGateSkipBanner,
} from '../cli/display-helpers';

const MAX_DEVELOPMENT_ITERATIONS = 3;

/**
 * Display development results to the user
 */
export const displayDevelopmentResults = (state: DevelopmentState, duration: string): void => {
  displayDevelopmentHeader(state, duration);
  if (state.codeGeneration) displayCodeGenerationResults(state.codeGeneration);
  if (state.testGeneration) displayTestGenerationResults(state.testGeneration);
  if (state.validationResult) displayValidationResults(state.validationResult);
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

function displayValidationResults(validation: NonNullable<DevelopmentState['validationResult']>): void {
  console.log('✅ VALIDATION RESULTS');
  console.log('─'.repeat(70));
  console.log(`Overall Score: ${validation.overallScore}%`);
  const metCount = validation.requirementsMet.filter(r => r.met).length;
  console.log(`Requirements Met: ${metCount}/${validation.requirementsMet.length}`);
  const passedCount = validation.acceptanceCriteriaPassed.filter(c => c.passed).length;
  console.log(`Acceptance Criteria Passed: ${passedCount}/${validation.acceptanceCriteriaPassed.length}`);
  printNumberedList('💡 Recommendations:', validation.recommendations);
  console.log();
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
    options,
  };
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

  const { previewMode, chtCorePath } = input.options;

  while (!developmentApproved && iterationCount < MAX_DEVELOPMENT_ITERATIONS) {
    iterationCount++;
    const { state, duration } = await runDevelopment(supervisor, input, additionalContext);
    finalState = state;
    displayDevelopmentResults(state, duration);
    if (previewMode) {
      const outcome = await runPreviewModeIteration({
        supervisor, state, chtCorePath, iterationCount,
      });
      developmentApproved = outcome.approved;
      additionalContext = outcome.additionalContext;
      filesWritten = outcome.filesWritten;
    } else {
      developmentApproved = true;
      console.log('\n📝 Writing generated files directly to cht-core...');
      filesWritten = await supervisor.writeToChtCore(state, chtCorePath);
      console.log(`✅ Written ${filesWritten.length} files to ${chtCorePath}`);
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
  console.log(`📂 Target: ${options.chtCorePath}`);
  console.log(`🔄 Iterations: ${workflowResult.iterationCount}`);
  if (workflowResult.filesWritten.length > 0) {
    console.log(`\n📋 Written Files:`);
    workflowResult.filesWritten.forEach((file, i) => console.log(`   ${i + 1}. ${file}`));
  }
  if (workflowResult.result?.validationResult) {
    console.log(`\n📊 Validation Score: ${workflowResult.result.validationResult.overallScore}%`);
  }
  console.log('\n💡 Next Steps:');
  console.log('   1. Review the generated files');
  console.log('   2. Run the tests to verify implementation');
  console.log('   3. Make any necessary manual adjustments');
  console.log('   4. Submit for code review');
  console.log();
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
