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
 *   npm run full <ticket-file> [--verbose]
 *
 * Flags:
 *   --verbose, -v  Emit detailed debug output to stderr (redacted + truncated).
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
 *   npm run full tickets/my-ticket.md --verbose
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
import { createDebugLogger } from '../utils/debug-logger';
import { parseCliArgs } from './full-args';

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

function ensureTicketPath(ticketPath: string | null): string {
  if (!ticketPath) {
    console.error('❌ Error: No ticket file specified\n');
    console.log('Usage:');
    console.log('  npm run full <ticket-file> [--verbose]\n');
    console.log('Examples:');
    console.log('  npm run full tickets/my-ticket.md');
    console.log('  npm run full /path/to/ticket.md\n');
    console.log('💡 See tickets/README.md for ticket file format');
    console.log('💡 For research-only workflow, use: npm run research <ticket-file>\n');
    process.exit(1);
  }
  return path.resolve(ticketPath);
}

const main = async (): Promise<void> => {
  const { verbose, ticketPath } = parseCliArgs(process.argv);
  const debug = createDebugLogger({ enabled: verbose });

  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║        CHT Multi-Agent System - Full Workflow CLI              ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  debug.log('verbose mode enabled');
  ensureApiKey();
  const chtCorePath = ensureChtCorePath();
  debug.log('cht-core path', chtCorePath);

  try {
    const resolvedTicketPath = ensureTicketPath(ticketPath);
    console.log(`📄 Loading ticket from: ${resolvedTicketPath}\n`);

    const ticket = parseTicketFile(resolvedTicketPath);
    console.log('✅ Ticket parsed successfully!\n');
    debug.log('parsed ticket', {
      title: ticket.issue.title,
      type: ticket.issue.type,
      domain: ticket.issue.technical_context?.domain,
    });

    const modelName = getConfiguredModel();
    console.log(`🤖 Initializing Supervisors with model: ${modelName}\n`);
    debug.log('configured model', modelName);

    const researchSupervisor = new ResearchSupervisor({ modelName, useMockMCP: false });
    const developmentSupervisor = new DevelopmentSupervisor();

    displayIssueDetails(ticket);
    const developmentOptions = await askDevelopmentOptions(chtCorePath);
    debug.log('development options', developmentOptions);

    const stopTimer = debug.time('full workflow');
    const workflowResult = await executeFullWorkflow(
      researchSupervisor,
      developmentSupervisor,
      ticket,
      developmentOptions
    );
    stopTimer();
    displayFullWorkflowSummary(workflowResult);
    debug.log('workflow complete', {
      researchApproved: workflowResult.research.approved,
      developmentRan: workflowResult.development !== undefined,
    });
  } catch (error) {
    console.error('\n❌ Error running workflow:', error);
    if (error instanceof Error) {
      console.error('Message:', error.message);
      console.error('Stack:', error.stack);
    }
    process.exit(1);
  }
};

// Run the CLI only when invoked directly (not when imported by tests).
if (require.main === module) {
  main();
}
