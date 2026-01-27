/**
 * Example: Full Workflow Demo
 *
 * Demonstrates the complete CHT development workflow:
 * 1. Research Phase - Documentation search, context analysis, orchestration plan
 * 2. Human Validation Checkpoint #1 - Approve research or provide feedback
 * 3. Development Phase - Code generation, test environment setup
 * 4. Human Validation Checkpoint #2 (preview mode) - Approve changes before writing
 *
 * For research-only workflow, use:
 *   npm run example:research
 *
 * Usage:
 *   npm run example:full                           # Uses default ticket
 *   npm run example:full path/to/ticket.md         # Uses custom ticket
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

// Load environment variables
dotenv.config();

const runExample = async (): Promise<void> => {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║       CHT Multi-Agent System - Full Workflow Demo              ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  // Check for API key
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('❌ Error: ANTHROPIC_API_KEY not found in environment variables');
    console.log('\nPlease create a .env file with your Anthropic API key:');
    console.log('ANTHROPIC_API_KEY=your_api_key_here\n');
    process.exit(1);
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
    // Determine ticket file path
    const ticketPath = process.argv[2]
      ? path.resolve(process.argv[2])
      : path.join(__dirname, '../../tickets/contact-search-feature.md');

    console.log(`📄 Loading ticket from: ${ticketPath}\n`);

    // Parse ticket file
    const ticket = parseTicketFile(ticketPath);
    console.log('✅ Ticket parsed successfully!\n');

    // Create supervisors
    const modelName = getConfiguredModel();
    console.log(`🤖 Initializing Supervisors with model: ${modelName}\n`);

    const researchSupervisor = new ResearchSupervisor({
      modelName,
      useMockMCP: true, // Using mocked MCP for demo
    });

    const developmentSupervisor = new DevelopmentSupervisor({
      useMock: true, // Using mock mode for demo
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
    console.error('\n❌ Error running example:', error);
    if (error instanceof Error) {
      console.error('Message:', error.message);
      console.error('Stack:', error.stack);
    }
    process.exit(1);
  }
};

// Run the example
runExample();
