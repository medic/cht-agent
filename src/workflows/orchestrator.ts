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
import { createQaInput, executeQaWorkflow, displayQaCompletion } from './qa-workflow';

/**
 * Full workflow result combining research, development and (optionally) QA.
 */
export interface FullWorkflowResult {
  research: ResearchWorkflowResult;
  development?: DevelopmentWorkflowResult;
  /** Present only when the QA phase ran (cht-conf ticket + --qa). */
  qa?: QaResult;
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
  const developmentResult = await executeDevelopmentWorkflow(
    developmentSupervisor,
    developmentInput
  );

  // Display development completion
  displayDevelopmentCompletion(developmentResult, developmentOptions);

  // QA phase (closed loop) — only when enabled, development approved, cht-conf.
  // F5: thread the dev phase's XLSForm apply bind-diff (nodeset + corrected
  // relevant) into QA so the fix's OWN bind is asserted red→green — a child bind
  // the group snapshot misses now fires RED against the still-buggy deployed form.
  const qa = developmentResult.approved
    ? await runQaPhase(
      ticket,
      developmentOptions,
      qaOptions,
      developmentResult.result?.xlsformApply?.bindDiff
    )
    : undefined;

  return {
    research: researchResult,
    development: developmentResult,
    ...(qa ? { qa } : {}),
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
  bindDiff?: XlsformBindDiff
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
    console.log(`   Validation Score: ${development.result.validationResult.overallScore}%`);
  }
}
