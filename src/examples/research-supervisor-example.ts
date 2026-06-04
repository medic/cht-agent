/**
 * Example: Research Supervisor Demo
 *
 * Usage:
 *   npm run example:research                           # Uses default ticket
 *   npm run example:research path/to/ticket.md         # Uses custom ticket
 */

import * as dotenv from 'dotenv';
import * as path from 'node:path';
import { runResearchWorkflow } from '../cli/display-helpers';

dotenv.config();

const getTicketPath = (): string => {
  if (process.argv[2]) {
    return path.resolve(process.argv[2]);
  }
  return path.join(__dirname, '../../tickets/contact-search-feature.md');
};

const HELP_HINTS = [
  'Frontmatter must have: title, type, priority, domain',
  'Content goes in markdown body with ## sections',
];

runResearchWorkflow(
  'CHT Multi-Agent System - Research Supervisor Demo',
  getTicketPath,
  HELP_HINTS,
).catch(error => {
  console.error('\n❌ Error running example:', error);
  if (error instanceof Error) {
    console.error('Message:', error.message);
    console.error('Stack:', error.stack);
  }
  process.exit(1);
});
