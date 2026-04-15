#!/usr/bin/env node
/**
 * Ticket Validation CLI
 * Validates ticket files for correct formatting and completeness
 *
 * Usage:
 *   npm run validate-ticket <file>
 *   npm run validate-ticket --dir <directory> [--verbose]
 */

import * as path from 'node:path';
import * as fs from 'node:fs';
import { validateTicketFile, ValidationResult, findTicketFiles } from '../utils/ticket-parser';

const displayErrors = (errors: string[]): void => {
  console.log('\nErrors:');
  errors.forEach((error) => {
    console.log(`  - ${error}`);
  });
};

const displayWarnings = (warnings: string[]): void => {
  console.log('\nWarnings:');
  warnings.forEach((warning) => {
    console.log(`  - ${warning}`);
  });
};

const displayResult = (
  result: ValidationResult,
  filePath: string,
  verbose: boolean = false
): void => {
  console.log(`File: ${filePath}`);
  console.log(`Status: ${result.valid ? 'VALID' : 'INVALID'}`);

  if (result.errors.length > 0) {
    displayErrors(result.errors);
  }

  const hasNoIssues = result.valid && result.errors.length === 0;
  const hasWarnings = result.warnings.length > 0;

  if (hasNoIssues && !hasWarnings) {
    console.log('\nNo issues found');
  } else if (verbose && hasWarnings) {
    displayWarnings(result.warnings);
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

const getPathArgument = (args: string[]): string | null => {
  return args.find((arg) => !arg.startsWith('--')) || null;
};

const validateDirectory = (dirPath: string, verbose: boolean): void => {
  const ticketFiles = findTicketFiles(dirPath);

  if (ticketFiles.length === 0) {
    console.log(`No ticket files found in directory: ${dirPath}`);
    return;
  }

  const results = ticketFiles.map((file) => validateTicketFile(file));

  if (verbose) {
    results.forEach((result, index) => {
      displayResult(result, ticketFiles[index], true);
      console.log();
    });
  }

  displaySummary(results, ticketFiles);

  if (results.some((r) => !r.valid)) {
    process.exit(1);
  }
};

const validateFile = (filePath: string, verbose: boolean): void => {
  const result = validateTicketFile(filePath);
  displayResult(result, filePath, verbose);

  if (!result.valid) {
    process.exit(1);
  }
};

const validatePath = (pathArg: string): string => {
  const fullPath = path.resolve(pathArg);

  if (!fs.existsSync(fullPath)) {
    console.error(`Error: Path does not exist: ${fullPath}`);
    process.exit(1);
  }

  return fullPath;
};

const main = (): void => {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error('Usage: npm run validate-ticket <file> [--dir] [--verbose]');
    process.exit(1);
  }

  const isDirectory = args.includes('--dir');
  const verbose = args.includes('--verbose');
  const pathArg = getPathArgument(args);

  if (!pathArg) {
    console.error('Error: No file or directory path provided');
    process.exit(1);
  }

  const fullPath = validatePath(pathArg);

  if (isDirectory) {
    if (!fs.statSync(fullPath).isDirectory()) {
      console.error(`Error: Path is not a directory: ${fullPath}`);
      process.exit(1);
    }
    validateDirectory(fullPath, verbose);
  } else {
    validateFile(fullPath, verbose);
  }
};

main();
