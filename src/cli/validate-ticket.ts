#!/usr/bin/env node
/**
 * Ticket Validation CLI
 * Validates ticket files for correct formatting and completeness
 *
 * Usage:
 *   npm run validate-ticket <file>
 *   npm run validate-ticket --dir <directory> [--verbose]
 */

import { resolve } from 'path';
import { existsSync, statSync } from 'fs';
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

const shouldShowNoIssues = (result: ValidationResult): boolean => {
  return result.valid && result.warnings.length === 0;
};

const shouldShowWarnings = (result: ValidationResult, verbose: boolean): boolean => {
  return verbose && result.warnings.length > 0;
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

  if (shouldShowNoIssues(result)) {
    console.log('\nNo issues found');
  } else if (shouldShowWarnings(result, verbose)) {
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
  const fullPath = resolve(pathArg);

  if (!existsSync(fullPath)) {
    console.error(`Error: Path does not exist: ${fullPath}`);
    process.exit(1);
  }

  return fullPath;
};

const parseArgs = (args: string[]): { isDirectory: boolean; verbose: boolean; pathArg: string | null } => {
  return {
    isDirectory: args.includes('--dir'),
    verbose: args.includes('--verbose'),
    pathArg: getPathArgument(args),
  };
};

const validateDirectoryPath = (fullPath: string): void => {
  if (!statSync(fullPath).isDirectory()) {
    console.error(`Error: Path is not a directory: ${fullPath}`);
    process.exit(1);
  }
};

const main = (): void => {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error('Usage: npm run validate-ticket <file> [--dir] [--verbose]');
    process.exit(1);
  }

  const { isDirectory, verbose, pathArg } = parseArgs(args);

  if (!pathArg) {
    console.error('Error: No file or directory path provided');
    process.exit(1);
  }

  const fullPath = validatePath(pathArg);

  if (isDirectory) {
    validateDirectoryPath(fullPath);
    validateDirectory(fullPath, verbose);
  } else {
    validateFile(fullPath, verbose);
  }
};

main();
