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
import * as path from 'node:path';
import { ResearchSupervisor } from '../supervisors/research-supervisor';
import { IssueTemplate } from '../types';
import { parseTicketFile } from '../utils/ticket-parser';
import {
  validateEnvironment,
  displayIssueDetails,
  displayResults,
} from './display-helpers';

dotenv.config();

const getTicketPath = (): string => {
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

  return path.resolve(process.argv[2]);
};

const loadTicket = (ticketPath: string): IssueTemplate => {
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
    console.log('   - Frontmatter must have: title, type, priority');
    console.log('   - Domain is optional (will be inferred if not provided)');
    console.log('   - Content goes in markdown body with ## sections');
    console.log('   - See tickets/contact-search-feature.md for an example');
    console.log('   - See tickets/README.md for complete documentation\n');
    process.exit(1);
  }
};

const main = async () => {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║              CHT Multi-Agent System - Research CLI             ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  validateEnvironment();

  const ticketPath = getTicketPath();
  console.log(`📄 Loading ticket from: ${ticketPath}\n`);

  const ticket = loadTicket(ticketPath);

  console.log('🤖 Initializing Research Supervisor...\n');
  const supervisor = new ResearchSupervisor({
    modelName: 'claude-sonnet-4-20250514',
    useMockMCP: true,
  });

  displayIssueDetails(ticket);

  console.log('🔍 Running Research Phase...\n');
  const startTime = Date.now();
  const result = await supervisor.research(ticket);
  const duration = ((Date.now() - startTime) / 1000).toFixed(2);

  displayResults(result, duration);
};

main().catch(error => {
  console.error('\n❌ Error running research workflow:', error);
  if (error instanceof Error) {
    console.error('Message:', error.message);
    console.error('Stack:', error.stack);
  }
  process.exit(1);
});
