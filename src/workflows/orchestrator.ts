/**
 * Workflow Orchestrator
 *
 * Coordinates the full CHT development workflow:
 * 1. Research Phase - Documentation search, context analysis, orchestration plan
 * 2. Human Validation Checkpoint #1 - Approve research or provide feedback
 * 3. Development Phase - Code generation, test environment setup
 * 4. Human Validation Checkpoint #2 (preview mode) - Approve changes before writing
 *
 * This orchestrator chains independent workflows together.
 * Each workflow (research, development) can also be run standalone.
 */

import { ResearchSupervisor } from '../supervisors/research-supervisor';
import { DevelopmentSupervisor } from '../supervisors/development-supervisor';
import {
  IssueTemplate,
  DevelopmentOptions,
  DevelopmentWorkflowResult,
} from '../types';
import { askYesNo } from '../utils/prompt';
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

/**
 * Full workflow result combining research and development
 */
export interface FullWorkflowResult {
  research: ResearchWorkflowResult;
  development?: DevelopmentWorkflowResult;
}

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
 * Execute the full workflow: Research -> Development
 * Chains research to development automatically when research is approved
 */
export const executeFullWorkflow = async (
  researchSupervisor: ResearchSupervisor,
  developmentSupervisor: DevelopmentSupervisor,
  ticket: IssueTemplate,
  developmentOptions: DevelopmentOptions
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
  const developmentResult = await executeDevelopmentWorkflow(
    developmentSupervisor,
    developmentInput
  );

  // Display development completion
  displayDevelopmentCompletion(developmentResult, developmentOptions);

  return {
    research: researchResult,
    development: developmentResult,
  };
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
    console.log('\n📊 Development Phase:');
    console.log(`   Iterations: ${result.development.iterationCount}`);
    console.log(`   Approved: ${result.development.approved ? '✅' : '❌'}`);
    console.log(`   Files Written: ${result.development.filesWritten.length}`);

    if (result.development.result?.validationResult) {
      console.log(`   Validation Score: ${result.development.result.validationResult.overallScore}%`);
    }
  } else {
    console.log('\n📊 Development Phase: Not executed');
  }

  console.log();
};
