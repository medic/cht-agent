#!/usr/bin/env node
/**
 * CHT Agent - Research CLI
 *
 * Command-line interface for running the research workflow
 *
 * Usage:
 *   npm run research <ticket-file>
 *
 * Examples:
 *   npm run research tickets/my-ticket.md
 *   npm run research /path/to/ticket.md
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import { ResearchSupervisor } from '../supervisors/research-supervisor';
import { parseTicketFile } from '../utils/ticket-parser';

// Load environment variables
dotenv.config();

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║              CHT Multi-Agent System - Research CLI             ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  // Check for API key
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('❌ Error: ANTHROPIC_API_KEY not found in environment variables');
    console.log('\nPlease create a .env file with your Anthropic API key:');
    console.log('ANTHROPIC_API_KEY=your_api_key_here\n');
    process.exit(1);
  }

  try {
    // Check if ticket file is provided
    if (!process.argv[2]) {
      console.error('❌ Error: No ticket file specified\n');
      console.log('Usage:');
      console.log('  npm run research <ticket-file>\n');
      console.log('Examples:');
      console.log('  npm run research tickets/my-ticket.md');
      console.log('  npm run research /path/to/ticket.md\n');
      console.log('💡 See tickets/README.md for ticket file format\n');
      process.exit(1);
    }

    // Get ticket file path
    const ticketPath = path.resolve(process.argv[2]);
    console.log(`📄 Loading ticket from: ${ticketPath}\n`);

    // Parse ticket file
    let ticket;
    try {
      ticket = parseTicketFile(ticketPath);
      console.log('✅ Ticket parsed successfully!\n');
    } catch (error) {
      console.error('❌ Error parsing ticket file:');
      if (error instanceof Error) {
        console.error(`   ${error.message}`);
      }
      console.log('\n💡 Ticket file format:');
      console.log('   - Frontmatter must have: title, type, priority');
      console.log('   - Domain is optional (will be inferred if not provided)');
      console.log('   - Content goes in markdown body with ## sections');
      console.log('   - See tickets/contact-search-feature.md for an example');
      console.log('   - See tickets/README.md for complete documentation\n');
      process.exit(1);
    }

    // Create Research Supervisor instance
    console.log('🤖 Initializing Research Supervisor...\n');
    const supervisor = new ResearchSupervisor({
      modelName: 'claude-sonnet-4-20250514',
      useMockMCP: false, // Use real MCP by default 
    });

    // Display issue details
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

    // Run research phase
    console.log('🔍 Running Research Phase...\n');
    const startTime = Date.now();

    const result = await supervisor.research(ticket);

    const endTime = Date.now();
    const duration = ((endTime - startTime) / 1000).toFixed(2);

    // Display results
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

    console.log('╔════════════════════════════════════════════════════════════════╗');
    console.log('║                  Research Phase Complete! ✅                   ║');
    console.log('╚════════════════════════════════════════════════════════════════╝\n');

    console.log('💡 Next Steps:');
    console.log('   1. Review the orchestration plan');
    console.log('   2. Validate research findings');
    console.log('   3. Proceed to Development Phase (coming soon)');
    console.log();
  } catch (error) {
    console.error('\n❌ Error running research workflow:', error);
    if (error instanceof Error) {
      console.error('Message:', error.message);
      console.error('Stack:', error.stack);
    }
    process.exit(1);
  }
}

// Run the CLI
main();
