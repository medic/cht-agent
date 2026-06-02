#!/usr/bin/env node
/**
 * CHT Agent - Full Workflow CLI
 *
 * Command-line interface for running the complete workflow:
 * 1. Research Phase - Documentation search, context analysis, orchestration plan
 * 2. Human Validation Checkpoint #1 - Approve research or provide feedback
 * 3. Development Phase - Code generation and validation
 * 4. Human Validation Checkpoint #2 (preview mode) - Approve changes before writing
 *
 * For research-only workflow, use:
 *   npm run research <ticket-file>
 *
 * Usage:
 *   npm run full <ticket-file>
 *
 * Environment Variables:
 *   ANTHROPIC_API_KEY - Required when CODE_GEN_MODULE=claude-api
 *   CHT_CORE_PATH     - Path to cht-core codebase (required for development)
 *   CODE_GEN_MODULE   - Optional: 'claude-code-cli' (default; uses Claude Code CLI as a tool-using agent;
 *                                 requires Claude MAX subscription + claude binary on PATH)
 *                                 or 'claude-api' (uses Anthropic API directly; requires ANTHROPIC_API_KEY).
 *                                 'claude-cli' is an alias for 'claude-code-cli'.
 *   LLM_PROVIDER      - Optional: 'anthropic' (default) or 'claude-cli'. Affects research,
 *                                 validation and domain inference only. Does NOT
 *                                 affect code-gen module selection (use CODE_GEN_MODULE for that).
 *
 * Examples:
 *   npm run full tickets/my-ticket.md
 *   npm run full /path/to/ticket.md
 */

import * as dotenv from 'dotenv';
import * as path from 'node:path';
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

function ensureApiKey(): void {
  const usingCLI = isUsingCLIProvider();
  if (!usingCLI && !process.env.ANTHROPIC_API_KEY) {
    console.error('❌ Error: ANTHROPIC_API_KEY not found in environment variables');
    console.log('\nPlease create a .env file with your Anthropic API key:');
    console.log('ANTHROPIC_API_KEY=your_api_key_here');
    console.log('\nOr use Claude Code CLI mode:');
    console.log('LLM_PROVIDER=claude-cli\n');
    process.exit(1);
  }
  if (usingCLI) console.log('🔧 Using Claude Code CLI provider (no API key required)\n');
}

function ensureChtCorePath(): string {
  const chtCorePath = process.env.CHT_CORE_PATH;
  if (!chtCorePath) {
    console.error('❌ Error: CHT_CORE_PATH not found in environment variables');
    console.log('\nPlease add CHT_CORE_PATH to your .env file:');
    console.log('CHT_CORE_PATH=/path/to/cht-core\n');
    process.exit(1);
  }
  return chtCorePath;
}

function ensureTicketPath(): string {
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
  return path.resolve(process.argv[2]);
}

const main = async (): Promise<void> => {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║        CHT Multi-Agent System - Full Workflow CLI              ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  ensureApiKey();
  const chtCorePath = ensureChtCorePath();

  try {
    const ticketPath = ensureTicketPath();
    console.log(`📄 Loading ticket from: ${ticketPath}\n`);

    const ticket = parseTicketFile(ticketPath);
    console.log('✅ Ticket parsed successfully!\n');

    const modelName = getConfiguredModel();
    console.log(`🤖 Initializing Supervisors with model: ${modelName}\n`);

    const researchSupervisor = new ResearchSupervisor({ modelName, useMockMCP: false });
    const developmentSupervisor = new DevelopmentSupervisor();

    displayIssueDetails(ticket);
    const developmentOptions = await askDevelopmentOptions(chtCorePath);

    const workflowResult = await executeFullWorkflow(
      researchSupervisor,
      developmentSupervisor,
      ticket,
      developmentOptions
    );
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
