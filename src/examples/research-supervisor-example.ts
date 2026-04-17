/**
 * Example: Research Supervisor Demo
 *
 * Demonstrates the Research Supervisor workflow with a sample issue
 *
 * Usage:
 *   npm run example:research                           # Uses default ticket
 *   npm run example:research path/to/ticket.md         # Uses custom ticket
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
} from '../cli/display-helpers';

dotenv.config();

const getTicketPath = (): string => {
  if (process.argv[2]) {
    return path.resolve(process.argv[2]);
  }
  return path.join(__dirname, '../../tickets/contact-search-feature.md');
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
    console.log('   - Frontmatter must have: title, type, priority, domain');
    console.log('   - Content goes in markdown body with ## sections');
    console.log('   - See tickets/contact-search-feature.md for an example');
    console.log('   - See tickets/README.md for complete documentation\n');
    process.exit(1);
  }
};

const runExample = async () => {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║       CHT Multi-Agent System - Research Supervisor Demo        ║');
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

runExample().catch(error => {
  console.error('\n❌ Error running example:', error);
  if (error instanceof Error) {
    console.error('Message:', error.message);
    console.error('Stack:', error.stack);
  }
  process.exit(1);
});
