/**
 * Research Workflow
 *
 * Shared workflow logic for running research with human validation checkpoint #1.
 * Used by CLI, examples, and orchestrator.
 *
 * This workflow is independent and can be run standalone.
 * For the full workflow (research + development), use the orchestrator.
 */

import { ResearchSupervisor } from '../supervisors/research-supervisor';
import { IssueTemplate, ResearchState, HumanFeedback } from '../types';
import { askYesNo, askForFeedback } from '../utils/prompt';

const MAX_RESEARCH_ITERATIONS = 3;

/**
 * Display research results to the user
 */
export const displayResearchResults = (result: ResearchState, duration: string): void => {
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║                      RESEARCH RESULTS                          ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  console.log(`⏱️  Duration: ${duration} seconds`);
  console.log(`📊 Phase: ${result.currentPhase}`);
  console.log(`❌ Errors: ${result.errors.length}\n`);

  if (result.errors.length > 0) {
    console.log('⚠️  Errors encountered:');
    result.errors.forEach((error) => console.log(`   - ${error}`));
    console.log();
  }

  // Documentation Search Results
  if (result.researchFindings) {
    console.log('📚 DOCUMENTATION SEARCH RESULTS');
    console.log('─'.repeat(70));
    console.log(`Source: ${result.researchFindings.source}`);
    console.log(`Confidence: ${(result.researchFindings.confidence * 100).toFixed(0)}%`);
    console.log(
      `\nDocumentation References (${result.researchFindings.documentationReferences.length}):`
    );

    result.researchFindings.documentationReferences.forEach((ref, i) => {
      console.log(`\n${i + 1}. ${ref.title}`);
      console.log(`   URL: ${ref.url}`);
      console.log(`   Topics: ${ref.topics.join(', ')}`);
      if (ref.relevantSections && ref.relevantSections.length > 0) {
        console.log(`   Sections: ${ref.relevantSections.join(', ')}`);
      }
    });

    if (result.researchFindings.suggestedApproaches.length > 0) {
      console.log(`\nSuggested Approaches:`);
      result.researchFindings.suggestedApproaches.forEach((approach, i) => {
        console.log(`   ${i + 1}. ${approach}`);
      });
    }

    console.log();
  }

  // Context Analysis Results
  if (result.contextAnalysis) {
    console.log('🔎 CONTEXT ANALYSIS RESULTS');
    console.log('─'.repeat(70));
    console.log(`Similar Past Issues: ${result.contextAnalysis.similarContexts.length}`);
    console.log(`Reusable Patterns: ${result.contextAnalysis.reusablePatterns.length}`);
    console.log(`Design Decisions: ${result.contextAnalysis.relevantDesignDecisions.length}`);
    console.log(
      `Historical Success Rate: ${(result.contextAnalysis.historicalSuccessRate * 100).toFixed(0)}%`
    );

    if (result.contextAnalysis.recommendations.length > 0) {
      console.log(`\nRecommendations:`);
      result.contextAnalysis.recommendations.forEach((rec, i) => {
        console.log(`   ${i + 1}. ${rec}`);
      });
    }

    if (result.contextAnalysis.reusablePatterns.length > 0) {
      console.log(`\nReusable Patterns:`);
      result.contextAnalysis.reusablePatterns.forEach((pattern, i) => {
        console.log(`   ${i + 1}. ${pattern.pattern} (used ${pattern.frequency} times)`);
        console.log(`      ${pattern.description}`);
      });
    }

    console.log();
  }

  // Orchestration Plan
  if (result.orchestrationPlan) {
    console.log('📋 ORCHESTRATION PLAN');
    console.log('─'.repeat(70));
    console.log(
      `Estimated Complexity: ${result.orchestrationPlan.estimatedComplexity.toUpperCase()}`
    );
    console.log(`Estimated Effort: ${result.orchestrationPlan.estimatedEffort}`);
    console.log(`\nProposed Approach:`);
    console.log(`   ${result.orchestrationPlan.proposedApproach}`);

    console.log(`\nKey Findings:`);
    result.orchestrationPlan.keyFindings.forEach((finding, i) => {
      console.log(`   ${i + 1}. ${finding}`);
    });

    console.log(`\nImplementation Phases (${result.orchestrationPlan.phases.length}):`);
    result.orchestrationPlan.phases.forEach((phase, i) => {
      console.log(`\n   ${i + 1}. ${phase.name} [${phase.estimatedComplexity}]`);
      console.log(`      ${phase.description}`);
      console.log(`      Components: ${phase.suggestedComponents.join(', ')}`);
      if (phase.dependencies.length > 0) {
        console.log(`      Dependencies: ${phase.dependencies.join(', ')}`);
      }
    });

    if (result.orchestrationPlan.riskFactors.length > 0) {
      console.log(`\n⚠️  Risk Factors:`);
      result.orchestrationPlan.riskFactors.forEach((risk, i) => {
        console.log(`   ${i + 1}. ${risk}`);
      });
    }

    console.log();
  }
};

/**
 * Run research phase and return results with duration
 */
export const runResearch = async (
  supervisor: ResearchSupervisor,
  ticket: IssueTemplate,
  additionalContext?: string
): Promise<{ result: ResearchState; duration: string }> => {
  console.log('🔍 Running Research Phase...\n');
  const startTime = Date.now();

  const result = await supervisor.research(ticket, additionalContext);

  const endTime = Date.now();
  const duration = ((endTime - startTime) / 1000).toFixed(2);

  return { result, duration };
};

/**
 * Human validation checkpoint after research
 * Returns the human feedback with approval status
 */
export const humanValidationCheckpoint = async (
  iterationCount: number
): Promise<HumanFeedback> => {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║            HUMAN VALIDATION CHECKPOINT #1                      ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  if (iterationCount > 1) {
    console.log(`📝 This is research iteration #${iterationCount}\n`);
  }

  const isApproved = await askYesNo(
    '✅ Is the research satisfactory? Do you want to proceed to development?'
  );

  if (isApproved) {
    return {
      approved: true,
      timestamp: new Date().toISOString(),
    };
  }

  // Research not satisfactory - collect feedback
  console.log('\n📝 Please provide additional context or feedback to refine the research.');
  const feedback = await askForFeedback(
    'What additional information or areas should the research focus on?'
  );

  return {
    approved: false,
    feedback,
    additionalContext: feedback,
    timestamp: new Date().toISOString(),
  };
};

/**
 * Display issue details
 */
export const displayIssueDetails = (ticket: IssueTemplate): void => {
  console.log('📋 Issue Details:');
  console.log('━'.repeat(70));
  console.log(`Title: ${ticket.issue.title}`);
  console.log(`Type: ${ticket.issue.type}`);
  console.log(`Priority: ${ticket.issue.priority}`);
  if (ticket.issue.technical_context.domain) {
    console.log(`Domain: ${ticket.issue.technical_context.domain}`);
  }
  if (ticket.issue.technical_context.components.length > 0) {
    console.log(`Components: ${ticket.issue.technical_context.components.join(', ')}`);
  }
  console.log('━'.repeat(70));
  console.log();
};

/**
 * Result of the research workflow
 */
export interface ResearchWorkflowResult {
  approved: boolean;
  result: ResearchState | undefined;
  iterationCount: number;
}

/**
 * Run the complete research workflow with human validation loop
 */
export const executeResearchWorkflow = async (
  supervisor: ResearchSupervisor,
  ticket: IssueTemplate
): Promise<ResearchWorkflowResult> => {
  let iterationCount = 0;
  let additionalContext: string | undefined;
  let researchApproved = false;
  let finalResult: ResearchState | undefined;

  while (!researchApproved && iterationCount < MAX_RESEARCH_ITERATIONS) {
    iterationCount++;

    // Run research phase
    const { result, duration } = await runResearch(supervisor, ticket, additionalContext);
    finalResult = result;

    // Display results
    displayResearchResults(result, duration);

    // Human validation checkpoint
    const validation = await humanValidationCheckpoint(iterationCount);

    if (validation.approved) {
      researchApproved = true;
      console.log('\n✅ Research approved! Ready to proceed to Development Phase.\n');
    } else {
      if (iterationCount >= MAX_RESEARCH_ITERATIONS) {
        console.log(`\n⚠️  Maximum research iterations (${MAX_RESEARCH_ITERATIONS}) reached.`);
        console.log('Please review the results and consider refining the ticket manually.\n');
      } else {
        console.log(`\n🔄 Re-running research with your feedback (iteration ${iterationCount + 1}/${MAX_RESEARCH_ITERATIONS})...\n`);
        additionalContext = validation.additionalContext;
      }
    }
  }

  return {
    approved: researchApproved,
    result: finalResult,
    iterationCount,
  };
};

/**
 * Display final research workflow status
 */
export const displayWorkflowCompletion = (workflowResult: ResearchWorkflowResult): void => {
  if (workflowResult.approved && workflowResult.result) {
    console.log('╔════════════════════════════════════════════════════════════════╗');
    console.log('║                  Research Phase Complete! ✅                   ║');
    console.log('╚════════════════════════════════════════════════════════════════╝\n');

    console.log('💡 Research approved and ready for next phase.\n');
  } else {
    console.log('╔════════════════════════════════════════════════════════════════╗');
    console.log('║              Research Phase Needs Review ⚠️                    ║');
    console.log('╚════════════════════════════════════════════════════════════════╝\n');

    console.log('💡 Suggestions:');
    console.log('   1. Review and refine the ticket requirements');
    console.log('   2. Add more specific technical context');
    console.log('   3. Re-run the research with updated ticket');
    console.log();
  }
};
