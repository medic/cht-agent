#!/usr/bin/env node
/**
 * CHT Agent - Research CLI
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
import { runResearchWorkflow } from './display-helpers';

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

const HELP_HINTS = [
  'Frontmatter must have: title, type, priority',
  'Domain is optional (will be inferred if not provided)',
  'Content goes in markdown body with ## sections',
];

runResearchWorkflow(
  'CHT Multi-Agent System - Research CLI',
  getTicketPath,
  HELP_HINTS,
).catch(error => {
  console.error('\n❌ Error running research workflow:', error);
  if (error instanceof Error) {
    console.error('Message:', error.message);
    console.error('Stack:', error.stack);
  }
  process.exit(1);
});
