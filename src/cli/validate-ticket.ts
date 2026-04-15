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
import { validateTicketFile, ValidationResult, findTicketFiles } from '../utils/ticket-parser';

const displayResult = (
  result: ValidationResult,
  filePath: string,
  verbose: boolean = false
): void => {
  console.log(`File: ${filePath}`);
  console.log(`Status: ${result.valid ? 'VALID' : 'INVALID'}`);

  if (result.errors.length > 0) {
    console.log('\nErrors:');
    result.errors.forEach((error) => {
      console.log(`  - ${error}`);
    });
  }

  if (result.valid && result.errors.length === 0 && result.warnings.length === 0) {
    console.log('\nNo issues found');
  } else if (verbose && result.warnings.length > 0) {
    console.log('\nWarnings:');
    result.warnings.forEach((warning) => {
      console.log(`  - ${warning}`);
    });
  }
};

const displaySummary = (results: ValidationResult[], filePaths: string[]): void => {
  const validCount = results.filter((r) => r.valid).length;
  const invalidCount = results.length - validCount;

  console.log('\nValidation Summary');
  console.log('-----------------');
  console.log(`Files checked: ${results.length}`);
  console.log(`Valid: ${validCount}`);
  console.log(`Invalid: ${invalidCount}`);

  if (invalidCount > 0) {
    console.log('\nFiles requiring attention:');
    results
      .filter((r) => !r.valid)
      .forEach((result, index) => {
        const invalidIndex = results.indexOf(result);
        console.log(`  ${index + 1}. ${filePaths[invalidIndex]}`);
      });
  }
};

const main = (): void => {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error('Usage: npm run validate-ticket <file> [--dir] [--verbose]');
    process.exit(1);
  }

  const isDirectory = args.includes('--dir');
  const verbose = args.includes('--verbose');

  // Get path argument (first non-flag argument)
  const pathArg = args.find((arg) => !arg.startsWith('--'));
  if (!pathArg) {
    console.error('Error: No file or directory path provided');
    process.exit(1);
  }

  const fullPath = path.resolve(pathArg);

  if (!fs.existsSync(fullPath)) {
    console.error(`Error: Path does not exist: ${fullPath}`);
    process.exit(1);
  }

  if (isDirectory) {
    if (!fs.statSync(fullPath).isDirectory()) {
      console.error(`Error: Path is not a directory: ${fullPath}`);
      process.exit(1);
    }

    const ticketFiles = findTicketFiles(fullPath);

    if (ticketFiles.length === 0) {
      console.log(`No ticket files found in directory: ${fullPath}`);
      return;
    }

    const results = ticketFiles.map((file: string) => validateTicketFile(file));

    if (verbose) {
      results.forEach((result: ValidationResult, index: number) => {
        displayResult(result, ticketFiles[index], true);
        console.log();
      });
    }

    displaySummary(results, ticketFiles);

    if (results.some((r: ValidationResult) => !r.valid)) {
      process.exit(1);
    }
  } else {
    const result = validateTicketFile(fullPath);
    displayResult(result, fullPath, verbose);

    if (!result.valid) {
      process.exit(1);
    }
  }
};

main();
