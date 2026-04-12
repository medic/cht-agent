#!/usr/bin/env node
/**
 * Ticket Validation CLI
 * Validates ticket files for correct formatting and completeness
 *
 * Usage:
 *   npm run validate-ticket <file>
 *   npm run validate-ticket --dir <directory> [--verbose]
 */

import * as path from 'path';
import * as fs from 'fs';
import { validateTicketFile } from '../utils/ticket-parser';

function displayResult(result: any, filePath: string, verbose: boolean = false): void {
  console.log(`File: ${filePath}`);
  console.log(`Status: ${result.valid ? 'VALID' : 'INVALID'}`);

  if (result.errors.length > 0) {
    console.log('\nErrors:');
    result.errors.forEach((error: string) => {
      console.log(`  - ${error}`);
    });
  }

  if (verbose && result.warnings.length > 0) {
    console.log('\nWarnings:');
    result.warnings.forEach((warning: string) => {
      console.log(`  - ${warning}`);
    });
  }

  if (result.valid && result.errors.length === 0 && (verbose || result.warnings.length === 0)) {
    console.log('\nNo issues found');
  }
}

function displaySummary(results: any[], totalFiles: number): void {
  const validCount = results.filter(r => r.valid).length;
  const invalidCount = totalFiles - validCount;

  console.log('\nValidation Summary');
  console.log('-----------------');
  console.log(`Files checked: ${totalFiles}`);
  console.log(`Valid: ${validCount}`);
  console.log(`Invalid: ${invalidCount}`);

  if (invalidCount > 0) {
    console.log('\nFiles requiring attention:');
    results
      .filter(r => !r.valid)
      .forEach((result, index) => {
        const fileName = result.errors[0].split(': ')[1] || 'Unknown file';
        console.log(`  ${index + 1}. ${fileName}`);
      });
  }
}

function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error('Usage: npm run validate-ticket <file> [--dir] [--verbose]');
    process.exit(1);
  }

  const filePath = args[0];
  const isDirectory = args.includes('--dir');
  const verbose = args.includes('--verbose');

  const fullPath = path.resolve(filePath);

  if (!fs.existsSync(fullPath)) {
    console.error(`Error: Path does not exist: ${fullPath}`);
    process.exit(1);
  }

  if (isDirectory) {
    if (!fs.statSync(fullPath).isDirectory()) {
      console.error(`Error: Path is not a directory: ${fullPath}`);
      process.exit(1);
    }

    const { findTicketFiles } = require('../utils/ticket-parser');
    const ticketFiles = findTicketFiles(fullPath);

    if (ticketFiles.length === 0) {
      console.log(`No ticket files found in directory: ${fullPath}`);
      return;
    }

    const results = ticketFiles.map(file => validateTicketFile(file));

    if (verbose) {
      results.forEach((result, index) => {
        displayResult(result, ticketFiles[index], true);
        console.log();
      });
    }

    displaySummary(results, ticketFiles.length);

    if (results.some(r => !r.valid)) {
      process.exit(1);
    }
  } else {
    const result = validateTicketFile(fullPath);
    displayResult(result, fullPath, verbose);

    if (!result.valid) {
      process.exit(1);
    }
  }
}

main();