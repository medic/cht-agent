import { ResearchSupervisor } from '../supervisors/research-supervisor';
import { IssueTemplate, OrchestrationPlan, ResearchState } from '../types';
import { parseTicketFile } from '../utils/ticket-parser';

export const validateEnvironment = () => {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('❌ Error: ANTHROPIC_API_KEY not found in environment variables');
    console.log('\nPlease create a .env file with your Anthropic API key:');
    console.log('ANTHROPIC_API_KEY=your_api_key_here\n');
    process.exit(1);
  }
};

export const displayIssueDetails = (ticket: IssueTemplate) => {
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

export const displayResearchFindings = (result: ResearchState) => {
  if (!result.researchFindings) return;

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
    console.log('\nSuggested Approaches:');
    result.researchFindings.suggestedApproaches.forEach((approach, i) => {
      console.log(`   ${i + 1}. ${approach}`);
    });
  }

  console.log();
};

export const displayContextAnalysis = (result: ResearchState) => {
  if (!result.contextAnalysis) return;

  console.log('🔎 CONTEXT ANALYSIS RESULTS');
  console.log('─'.repeat(70));
  console.log(`Similar Past Issues: ${result.contextAnalysis.similarContexts.length}`);
  console.log(`Reusable Patterns: ${result.contextAnalysis.reusablePatterns.length}`);
  console.log(`Design Decisions: ${result.contextAnalysis.relevantDesignDecisions.length}`);
  console.log(
    `Historical Success Rate: ${(result.contextAnalysis.historicalSuccessRate * 100).toFixed(0)}%`
  );

  if (result.contextAnalysis.recommendations.length > 0) {
    console.log('\nRecommendations:');
    result.contextAnalysis.recommendations.forEach((rec, i) => {
      console.log(`   ${i + 1}. ${rec}`);
    });
  }

  if (result.contextAnalysis.reusablePatterns.length > 0) {
    console.log('\nReusable Patterns:');
    result.contextAnalysis.reusablePatterns.forEach((pattern, i) => {
      console.log(`   ${i + 1}. ${pattern.pattern} (used ${pattern.frequency} times)`);
      console.log(`      ${pattern.description}`);
    });
  }

  console.log();
};

export const displayPlanPhases = (plan: OrchestrationPlan) => {
  console.log(`\nImplementation Phases (${plan.phases.length}):`);
  plan.phases.forEach((phase, i) => {
    console.log(`\n   ${i + 1}. ${phase.name} [${phase.estimatedComplexity}]`);
    console.log(`      ${phase.description}`);
    console.log(`      Components: ${phase.suggestedComponents.join(', ')}`);
    if (phase.dependencies.length > 0) {
      console.log(`      Dependencies: ${phase.dependencies.join(', ')}`);
    }
  });

  if (plan.riskFactors.length > 0) {
    console.log('\n⚠️  Risk Factors:');
    plan.riskFactors.forEach((risk, i) => {
      console.log(`   ${i + 1}. ${risk}`);
    });
  }
};

export const displayOrchestrationPlan = (result: ResearchState) => {
  if (!result.orchestrationPlan) return;

  console.log('📋 ORCHESTRATION PLAN');
  console.log('─'.repeat(70));
  console.log(
    `Estimated Complexity: ${result.orchestrationPlan.estimatedComplexity.toUpperCase()}`
  );
  console.log(`Estimated Effort: ${result.orchestrationPlan.estimatedEffort}`);
  console.log('\nProposed Approach:');
  console.log(`   ${result.orchestrationPlan.proposedApproach}`);

  console.log('\nKey Findings:');
  result.orchestrationPlan.keyFindings.forEach((finding, i) => {
    console.log(`   ${i + 1}. ${finding}`);
  });

  displayPlanPhases(result.orchestrationPlan);
  console.log();
};

export const loadTicket = (ticketPath: string, helpHints: string[]): IssueTemplate => {
  try {
    const ticket = parseTicketFile(ticketPath);
    console.log('✅ Ticket parsed successfully!\n');
    return ticket;
  } catch (error) {
    console.error('❌ Error parsing ticket file:');
    if (error instanceof Error) {
      console.error(`   ${error.message}`);
    }
    console.log('\n💡 Ticket file format:');
    helpHints.forEach(hint => console.log(`   - ${hint}`));
    console.log('   - See tickets/contact-search-feature.md for an example');
    console.log('   - See tickets/README.md for complete documentation\n');
    process.exit(1);
  }
};

export const runResearchWorkflow = async (
  bannerTitle: string,
  getTicketPath: () => string,
  helpHints: string[],
) => {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log(`║${bannerTitle.padStart(34 + bannerTitle.length / 2).padEnd(64)}║`);
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  validateEnvironment();

  const ticketPath = getTicketPath();
  console.log(`📄 Loading ticket from: ${ticketPath}\n`);

  const ticket = loadTicket(ticketPath, helpHints);

  console.log('🤖 Initializing Research Supervisor...\n');
  const supervisor = new ResearchSupervisor({
    modelName: 'claude-sonnet-4-20250514',
    useMockMCP: false,
  });

  displayIssueDetails(ticket);

  console.log('🔍 Running Research Phase...\n');
  const startTime = Date.now();
  const result = await supervisor.research(ticket);
  const duration = ((Date.now() - startTime) / 1000).toFixed(2);

  displayResults(result, duration);
};

export const displayResults = (result: ResearchState, duration: string) => {
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║                      RESEARCH RESULTS                          ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  console.log(`⏱️  Duration: ${duration} seconds`);
  console.log(`📊 Phase: ${result.currentPhase}`);
  console.log(`❌ Errors: ${result.errors.length}\n`);

  if (result.errors.length > 0) {
    console.log('⚠️  Errors encountered:');
    result.errors.forEach(error => console.log(`   - ${error}`));
    console.log();
  }

  displayResearchFindings(result);
  displayContextAnalysis(result);
  displayOrchestrationPlan(result);

  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║                  Research Phase Complete! ✅                   ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  console.log('💡 Next Steps:');
  console.log('   1. Review the orchestration plan');
  console.log('   2. Validate research findings');
  console.log('   3. Proceed to Development Phase');
  console.log();
};