#!/usr/bin/env node
/**
 * CHT Agent - Full Workflow CLI
 *
 * Command-line interface for running the complete workflow:
 * 1. Research Phase - Documentation search, context analysis, orchestration plan
 * 2. Human Validation Checkpoint #1 - Approve research or provide feedback
 * 3. Development Phase - Code generation, test environment setup
 * 4. Human Validation Checkpoint #2 (preview mode) - Approve changes before writing
 *
 * For research-only workflow, use:
 *   npm run research <ticket-file>
 *
 * Usage:
 *   npm run full <ticket-file>
 *
 * Environment Variables:
 *   ANTHROPIC_API_KEY - Required for Claude API access
 *   CHT_CORE_PATH - Path to cht-core codebase (required for development)
 *
 * Examples:
 *   npm run full tickets/my-ticket.md
 *   npm run full /path/to/ticket.md
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import { ResearchSupervisor } from '../supervisors/research-supervisor';
import { DevelopmentSupervisor } from '../supervisors/development-supervisor';
import { parseTicketFile } from '../utils/ticket-parser';
import { displayIssueDetails } from '../workflows/research-workflow';
import {
  executeFullWorkflow,
  askDevelopmentOptions,
  displayFullWorkflowSummary,
} from '../workflows/orchestrator';
import { getConfiguredModel } from '../llm/types';
import { isUsingCLIProvider } from '../llm';

// Load environment variables
dotenv.config();

const main = async (): Promise<void> => {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║        CHT Multi-Agent System - Full Workflow CLI              ║');
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
      console.log('  npm run full <ticket-file>\n');
      console.log('Examples:');
      console.log('  npm run full tickets/my-ticket.md');
      console.log('  npm run full /path/to/ticket.md\n');
      console.log('💡 See tickets/README.md for ticket file format');
      console.log('💡 For research-only workflow, use: npm run research <ticket-file>\n');
      process.exit(1);
    }

    // Get ticket file path
    const ticketPath = path.resolve(process.argv[2]);
    console.log(`📄 Loading ticket from: ${ticketPath}\n`);

    // Parse ticket file
    const ticket = parseTicketFile(ticketPath);
    console.log('✅ Ticket parsed successfully!\n');

    // Create supervisors
    const modelName = getConfiguredModel();
    console.log(`🤖 Initializing Supervisors with model: ${modelName}\n`);

    const researchSupervisor = new ResearchSupervisor({
      modelName,
      useMockMCP: false, // Use real MCP server
    });

    const developmentSupervisor = new DevelopmentSupervisor({
      useMock: false, // Use real LLM for code generation
      skipTestEnvironment: true, // TODO(#62): re-enable once test gen layer is integrated
    });

    // Display issue details
    displayIssueDetails(ticket);

    // Ask for development options before starting
    const developmentOptions = await askDevelopmentOptions(chtCorePath);

    // Execute full workflow: Research -> Checkpoint #1 -> Development -> Checkpoint #2
    const workflowResult = await executeFullWorkflow(
      researchSupervisor,
      developmentSupervisor,
      ticket,
      developmentOptions
    );

    // Display final summary
    displayFullWorkflowSummary(workflowResult);

  } catch (error) {
    console.error('\n❌ Error running workflow:', error);
    if (error instanceof Error) {
      console.error('Message:', error.message);
      console.error('Stack:', error.stack);
    }
    process.exit(1);
  }
};

// Run the CLI
main();
