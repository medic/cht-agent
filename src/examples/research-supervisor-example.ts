/**
 * Example: Research Supervisor Demo
 *
 * Demonstrates the Research Supervisor workflow with a sample issue.
 * This example runs only the research phase (without development).
 *
 * For the full workflow (research + development), use:
 *   npm run example:full
 *
 * Usage:
 *   npm run example:research                           # Uses default ticket
 *   npm run example:research path/to/ticket.md         # Uses custom ticket
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import { ResearchSupervisor } from '../supervisors/research-supervisor';
import { parseTicketFile } from '../utils/ticket-parser';
import {
  displayIssueDetails,
  executeResearchWorkflow,
  displayWorkflowCompletion,
} from '../workflows/research-workflow';

// Load environment variables
dotenv.config();

const runExample = async (): Promise<void> => {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║       CHT Multi-Agent System - Research Supervisor Demo        ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  // Check for API key
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('❌ Error: ANTHROPIC_API_KEY not found in environment variables');
    console.log('\nPlease create a .env file with your Anthropic API key:');
    console.log('ANTHROPIC_API_KEY=your_api_key_here\n');
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

    // Create Research Supervisor instance
    console.log('🤖 Initializing Research Supervisor...\n');
    const supervisor = new ResearchSupervisor({
      modelName: 'claude-sonnet-4-20250514',
      useMockMCP: true, // Using mocked MCP for demo
    });

    // Display issue details
    displayIssueDetails(ticket);

    // Execute research workflow with human validation
    const workflowResult = await executeResearchWorkflow(supervisor, ticket);

    // Display final status
    displayWorkflowCompletion(workflowResult);

    if (workflowResult.approved) {
      console.log('💡 To run the full workflow including development, use:');
      console.log('   npm run example:full\n');
    }
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
