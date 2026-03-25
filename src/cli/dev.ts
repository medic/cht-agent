#!/usr/bin/env node
/**
 * CHT Agent - Development-Only CLI
 *
 * Runs only the development phase (code generation + validation) by synthesizing
 * minimal research stubs from the ticket file. Useful for testing the code gen
 * layer independently without spending tokens on the research phase.
 *
 * Usage:
 *   npm run dev <ticket-file>
 *
 * Environment Variables:
 *   ANTHROPIC_API_KEY - Required for Claude API access (unless using CLI provider)
 *   CHT_CORE_PATH    - Path to cht-core codebase (required)
 *   LLM_PROVIDER     - Optional: 'anthropic' (default) or 'claude-cli'
 *
 * Examples:
 *   npm run dev tickets/10139.md
 *   npm run dev /path/to/ticket.md
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import { DevelopmentSupervisor } from '../supervisors/development-supervisor';
import { parseTicketFile } from '../utils/ticket-parser';
import { displayIssueDetails } from '../workflows/research-workflow';
import {
  executeDevelopmentWorkflow,
  displayDevelopmentCompletion,
} from '../workflows/development-workflow';
import {
  IssueTemplate,
  DevelopmentInput,
  ResearchFindings,
  ContextAnalysisResult,
  OrchestrationPlan,
} from '../types';
import { isUsingCLIProvider } from '../llm';
import { loadIndex } from '../utils/context-loader';

// Load environment variables
dotenv.config();

/**
 * Synthesize minimal research findings from the ticket itself.
 * These stubs provide enough structure for the code gen module
 * without requiring a real research phase.
 */
function synthesizeResearchFindings(ticket: IssueTemplate): ResearchFindings {
  return {
    documentationReferences: [],
    relevantExamples: [],
    suggestedApproaches: ticket.issue.requirements.map(r => `Implement: ${r}`),
    relatedDomains: [ticket.issue.technical_context.domain],
    confidence: 0.5,
    source: 'mock',
  };
}

function synthesizeContextAnalysis(ticket: IssueTemplate): ContextAnalysisResult {
  return {
    similarContexts: [],
    reusablePatterns: [],
    relevantDesignDecisions: [],
    recommendations: ticket.issue.requirements,
    historicalSuccessRate: null,
    relatedDomains: [ticket.issue.technical_context.domain],
    codeContext: null,
  };
}

function synthesizeOrchestrationPlan(ticket: IssueTemplate): OrchestrationPlan {
  // Load domain index to get real file paths instead of generic component strings
  const domainIndex = loadIndex('domain-to-components');
  const domain = ticket.issue.technical_context.domain;
  let suggestedComponents = ticket.issue.technical_context.components;

  if (domainIndex?.domains?.[domain]) {
    const domainData = domainIndex.domains[domain];
    const realPaths: string[] = [];

    for (const section of ['api', 'webapp', 'sentinel']) {
      const sectionData = domainData[section];
      if (sectionData && typeof sectionData === 'object') {
        for (const [, entries] of Object.entries(sectionData)) {
          if (Array.isArray(entries)) {
            for (const entry of entries) {
              if (typeof entry === 'string') {
                realPaths.push(entry);
              }
            }
          }
        }
      }
    }

    if (realPaths.length > 0) {
      // Use real file paths, plus any original components that look like file paths
      const originalPaths = suggestedComponents.filter(c => c.includes('/') && /\.\w+$/.test(c));
      suggestedComponents = [...new Set([...realPaths, ...originalPaths])];
    }
  }

  return {
    summary: `Implement: ${ticket.issue.title}`,
    keyFindings: [],
    recommendedApproach: ticket.issue.description,
    estimatedComplexity: ticket.issue.priority === 'high' ? 'high' : 'medium',
    phases: [
      {
        name: 'Implementation',
        description: ticket.issue.description,
        estimatedComplexity: 'medium',
        suggestedComponents,
        dependencies: [],
      },
    ],
    riskFactors: ticket.issue.constraints,
    estimatedEffort: 'unknown',
  };
}

const main = async (): Promise<void> => {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║      CHT Multi-Agent System - Development Only CLI            ║');
  console.log('║      (Research phase skipped — using synthesized stubs)        ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  // Check for API key (not required in CLI mode)
  const usingCLI = isUsingCLIProvider();
  if (!usingCLI && !process.env.ANTHROPIC_API_KEY) {
    console.error('❌ Error: ANTHROPIC_API_KEY not found in environment variables');
    console.log('\nPlease create a .env file with your Anthropic API key:');
    console.log('ANTHROPIC_API_KEY=your_api_key_here');
    console.log('\nOr use Claude Code CLI mode:');
    console.log('LLM_PROVIDER=claude-cli\n');
    process.exit(1);
  }

  if (usingCLI) {
    console.log('🔧 Using Claude Code CLI provider (no API key required)\n');
  }

  // Check for CHT_CORE_PATH
  const chtCorePath = process.env.CHT_CORE_PATH;
  if (!chtCorePath) {
    console.error('❌ Error: CHT_CORE_PATH not found in environment variables');
    console.log('\nPlease add CHT_CORE_PATH to your .env file:');
    console.log('CHT_CORE_PATH=/path/to/cht-core\n');
    process.exit(1);
  }

  try {
    // Check if ticket file is provided
    if (!process.argv[2]) {
      console.error('❌ Error: No ticket file specified\n');
      console.log('Usage:');
      console.log('  npm run dev <ticket-file>\n');
      console.log('Examples:');
      console.log('  npm run dev tickets/10139.md');
      console.log('  npm run dev /path/to/ticket.md\n');
      process.exit(1);
    }

    // Get ticket file path
    const ticketPath = path.resolve(process.argv[2]);
    console.log(`📄 Loading ticket from: ${ticketPath}\n`);

    // Parse ticket file
    const ticket = parseTicketFile(ticketPath);
    console.log('✅ Ticket parsed successfully!\n');

    // Display issue details
    displayIssueDetails(ticket);

    // Synthesize research stubs from ticket data
    console.log('📋 Synthesizing research stubs from ticket data (no LLM calls)...\n');
    const researchFindings = synthesizeResearchFindings(ticket);
    const contextAnalysis = synthesizeContextAnalysis(ticket);
    const orchestrationPlan = synthesizeOrchestrationPlan(ticket);

    // Create development supervisor
    const developmentSupervisor = new DevelopmentSupervisor({
      useMock: false,
      skipTestEnvironment: true,
    });

    // Build development input
    const developmentInput: DevelopmentInput = {
      issue: ticket,
      orchestrationPlan,
      researchFindings,
      contextAnalysis,
      options: {
        chtCorePath,
        previewMode: true, // Always preview in dev-only mode
      },
    };

    // Execute development workflow directly
    console.log('🚀 Starting Development Phase (code generation only)...\n');
    const workflowResult = await executeDevelopmentWorkflow(
      developmentSupervisor,
      developmentInput
    );

    // Display completion
    displayDevelopmentCompletion(workflowResult, developmentInput.options);

  } catch (error) {
    console.error('\n❌ Error running development:', error);
    if (error instanceof Error) {
      console.error('Message:', error.message);
      console.error('Stack:', error.stack);
    }
    process.exit(1);
  }
};

// Run the CLI
main();
