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

const MAX_DEVELOPMENT_ITERATIONS = 3;

/**
 * Display development results to the user
 */
export const displayDevelopmentResults = (state: DevelopmentState, duration: string): void => {
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║                    DEVELOPMENT RESULTS                         ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  console.log(`⏱️  Duration: ${duration} seconds`);
  console.log(`📊 Phase: ${state.currentPhase}`);
  console.log(`❌ Errors: ${state.errors.length}\n`);

  if (state.errors.length > 0) {
    console.log('⚠️  Errors encountered:');
    state.errors.forEach((error) => console.log(`   - ${error}`));
    console.log();
  }

  // Code Generation Results
  if (state.codeGeneration) {
    console.log('💻 CODE GENERATION RESULTS');
    console.log('─'.repeat(70));
    console.log(`Generated Files: ${state.codeGeneration.files.length}`);
    console.log(`Confidence: ${(state.codeGeneration.confidence * 100).toFixed(0)}%`);

    console.log(`\nSummary:`);
    console.log(`   ${state.codeGeneration.summary}`);

    if (state.codeGeneration.implementedRequirements.length > 0) {
      console.log(`\n✅ Implemented Requirements:`);
      state.codeGeneration.implementedRequirements.forEach((req, i) => {
        console.log(`   ${i + 1}. ${req}`);
      });
    }

    if (state.codeGeneration.pendingRequirements.length > 0) {
      console.log(`\n⏳ Pending Requirements:`);
      state.codeGeneration.pendingRequirements.forEach((req, i) => {
        console.log(`   ${i + 1}. ${req}`);
      });
    }

    if (state.codeGeneration.notes.length > 0) {
      console.log(`\n📝 Notes:`);
      state.codeGeneration.notes.forEach((note, i) => {
        console.log(`   ${i + 1}. ${note}`);
      });
    }

    console.log(`\nGenerated Files:`);
    state.codeGeneration.files.forEach((file, i) => {
      console.log(`   ${i + 1}. ${file.relativePath}`);
      console.log(`      Type: ${file.type} | Language: ${file.language} | Action: ${file.action}`);
      if (file.description) {
        console.log(`      ${file.description}`);
      }
    });

    console.log();
  }

  // Test Environment Results
  if (state.testEnvironment) {
    console.log('🧪 TEST ENVIRONMENT RESULTS');
    console.log('─'.repeat(70));
    console.log(`Test Files: ${state.testEnvironment.testFiles.length}`);
    console.log(`Fixture Files: ${state.testEnvironment.testDataFiles.length}`);
    console.log(`Estimated Coverage: ${state.testEnvironment.estimatedCoverage}%`);

    if (state.testEnvironment.configs.length > 0) {
      console.log(`\nTest Configurations:`);
      state.testEnvironment.configs.forEach((config, i) => {
        console.log(`   ${i + 1}. ${config.type.toUpperCase()} (${config.framework})`);
        console.log(`      Dependencies: ${config.dependencies.join(', ')}`);
      });
    }

    if (state.testEnvironment.testFiles.length > 0) {
      console.log(`\nTest Files:`);
      state.testEnvironment.testFiles.forEach((file, i) => {
        console.log(`   ${i + 1}. ${file.relativePath}`);
      });
    }

    console.log();
  }

  // Validation Results
  if (state.validationResult) {
    console.log('✅ VALIDATION RESULTS');
    console.log('─'.repeat(70));
    console.log(`Overall Score: ${state.validationResult.overallScore}%`);

    const metCount = state.validationResult.requirementsMet.filter((r) => r.met).length;
    const totalReqs = state.validationResult.requirementsMet.length;
    console.log(`Requirements Met: ${metCount}/${totalReqs}`);

    const passedCount = state.validationResult.acceptanceCriteriaPassed.filter((c) => c.passed).length;
    const totalCriteria = state.validationResult.acceptanceCriteriaPassed.length;
    console.log(`Acceptance Criteria Passed: ${passedCount}/${totalCriteria}`);

    if (state.validationResult.recommendations.length > 0) {
      console.log(`\n💡 Recommendations:`);
      state.validationResult.recommendations.forEach((rec, i) => {
        console.log(`   ${i + 1}. ${rec}`);
      });
    }

    console.log();
  }
};

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

  if (iterationCount > 1) {
    console.log(`📝 This is development iteration #${iterationCount}\n`);
  }

  // Get all generated files
  const allFiles: GeneratedFile[] = [];
  if (state.codeGeneration) {
    allFiles.push(...state.codeGeneration.files);
  }
  if (state.testEnvironment) {
    allFiles.push(...state.testEnvironment.testFiles);
    allFiles.push(...state.testEnvironment.testDataFiles);
  }

  // Display file summary
  console.log('📂 FILES TO BE WRITTEN');
  console.log('─'.repeat(70));
  displayFileSummary(allFiles);
  console.log();

  // Generate and display diffs
  console.log('📝 FILE DIFFS');
  console.log('─'.repeat(70));
  const diffs = await generateDiffs(allFiles, stagingPath, chtCorePath);
  displayDiffs(diffs);
  console.log();

  const isApproved = await askYesNo(
    '✅ Do you approve these changes to be written to cht-core?'
  );

  if (isApproved) {
    return {
      approved: true,
      timestamp: new Date().toISOString(),
    };
  }

  // Development not satisfactory - collect feedback
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
};

/**
 * Create development input from research results
 */
export const createDevelopmentInput = (
  researchResult: ResearchState,
  options: DevelopmentOptions
): DevelopmentInput | null => {
  if (!researchResult.issue ||
      !researchResult.orchestrationPlan ||
      !researchResult.researchFindings ||
      !researchResult.contextAnalysis) {
    console.error('❌ Missing required data from research phase');
    return null;
  }

  return {
    issue: researchResult.issue,
    orchestrationPlan: researchResult.orchestrationPlan,
    researchFindings: researchResult.researchFindings,
    contextAnalysis: researchResult.contextAnalysis,
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
  let stagingPath: string | undefined;

  const { previewMode, chtCorePath } = input.options;

  while (!developmentApproved && iterationCount < MAX_DEVELOPMENT_ITERATIONS) {
    iterationCount++;

    // Run development phase
    const { state, duration } = await runDevelopment(supervisor, input, additionalContext);
    finalState = state;

    // Display results
    displayDevelopmentResults(state, duration);

    if (previewMode) {
      // Preview Mode: Write to staging, show diffs, ask for approval
      console.log('\n📦 Writing generated files to staging area...');
      const stagingResult = await supervisor.writeToStaging(state);
      stagingPath = stagingResult.stagingPath;

      // Human validation checkpoint #2
      const validation = await humanDevelopmentValidationCheckpoint(
        state,
        stagingPath,
        chtCorePath,
        iterationCount
      );

      if (validation.approved) {
        developmentApproved = true;

        // Copy files from staging to cht-core
        console.log('\n📝 Copying approved files to cht-core...');
        filesWritten = await copyToTarget(stagingPath, chtCorePath);
        console.log(`✅ Written ${filesWritten.length} files to ${chtCorePath}`);

        // Clean up staging
        await clearStaging(stagingPath);
      } else {
        if (iterationCount >= MAX_DEVELOPMENT_ITERATIONS) {
          console.log(`\n⚠️  Maximum development iterations (${MAX_DEVELOPMENT_ITERATIONS}) reached.`);
          console.log('Please review the generated code and consider manual adjustments.\n');

          // Clean up staging
          if (stagingPath) {
            await clearStaging(stagingPath);
          }
        } else {
          console.log(`\n🔄 Re-running development with your feedback (iteration ${iterationCount + 1}/${MAX_DEVELOPMENT_ITERATIONS})...\n`);
          additionalContext = validation.additionalContext;

          // Clean up staging before next iteration
          await clearStaging(stagingPath);
        }
      }
    } else {
      // Direct Mode: Write directly to cht-core, no checkpoint #2
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

/**
 * Display final development workflow completion status
 */
export const displayDevelopmentCompletion = (
  workflowResult: DevelopmentWorkflowResult,
  options: DevelopmentOptions
): void => {
  if (workflowResult.approved && workflowResult.result) {
    console.log('\n╔════════════════════════════════════════════════════════════════╗');
    console.log('║                Development Phase Complete! ✅                  ║');
    console.log('╚════════════════════════════════════════════════════════════════╝\n');

    console.log(`📁 Files Written: ${workflowResult.filesWritten.length}`);
    console.log(`📂 Target: ${options.chtCorePath}`);
    console.log(`🔄 Iterations: ${workflowResult.iterationCount}`);

    if (workflowResult.filesWritten.length > 0) {
      console.log(`\n📋 Written Files:`);
      workflowResult.filesWritten.forEach((file, i) => {
        console.log(`   ${i + 1}. ${file}`);
      });
    }

    if (workflowResult.result.validationResult) {
      console.log(`\n📊 Validation Score: ${workflowResult.result.validationResult.overallScore}%`);
    }

    console.log('\n💡 Next Steps:');
    console.log('   1. Review the generated files');
    console.log('   2. Run the tests to verify implementation');
    console.log('   3. Make any necessary manual adjustments');
    console.log('   4. Submit for code review');
    console.log();
  } else {
    console.log('\n╔════════════════════════════════════════════════════════════════╗');
    console.log('║              Development Phase Needs Review ⚠️                 ║');
    console.log('╚════════════════════════════════════════════════════════════════╝\n');

    console.log('💡 Suggestions:');
    console.log('   1. Review the generated code manually');
    console.log('   2. Refine the requirements in the ticket');
    console.log('   3. Re-run development with more specific feedback');
    console.log();
  }
};

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
