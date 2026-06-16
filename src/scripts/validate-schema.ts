#!/usr/bin/env node
/**
 * Context File Validator
 *
 * Validates markdown context files under agent-memory/domains against
 * schema.json using one AJV validator:
 *   - frontmatter: AJV enforces types, enums, patterns, format:date, and
 *     additionalProperties:false from definitions.frontmatter.
 *   - body: the 8 required H2 sections, for issue entries only.
 *
 * Issue entries (domains/<domain>/issues/<name>.md) MUST have frontmatter;
 * other markdown (domain indexes) is skipped when it has none. README.md and
 * TEMPLATE.md are excluded.
 *
 * Usage:
 *   npm run validate-schema
 *   npm run validate-schema -- path/to/specific-file.md
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import matter from 'gray-matter';
import type { ErrorObject, ValidateFunction } from 'ajv';
import { buildValidator, normalizeFrontmatter, hasFrontmatter, REPO_ROOT } from './schema-utils';

const DOMAINS_DIR = path.join(REPO_ROOT, 'agent-memory', 'domains');

export const REQUIRED_SECTIONS = [
  'Problem',
  'Root Cause',
  'Solution',
  'Code Patterns',
  'Design Choices',
  'Related Files',
  'Testing',
  'Related Issues',
];

export interface FileResult {
  file: string;
  passed: boolean;
  skipped: boolean;
  errors: string[];
}

/** Issue entries live at domains/<domain>/issues/<name>.md (the structured records). */
export function isIssueFile(filePath: string): boolean {
  const norm = filePath.split(path.sep).join('/');
  return /\/issues\/[^/]+\.md$/.test(norm);
}

/** Check the 8 required H2 sections. Returns one error per missing section. */
export function validateBody(body: string): string[] {
  const errors: string[] = [];
  for (const section of REQUIRED_SECTIONS) {
    if (!new RegExp(`^## ${section}`, 'm').test(body)) {
      errors.push(`Missing required section: ## ${section}`);
    }
  }
  return errors;
}

function formatError(e: ErrorObject): string {
  if (e.keyword === 'required') {
    return `(root): missing required field "${(e.params as { missingProperty: string }).missingProperty}"`;
  }
  if (e.keyword === 'additionalProperties') {
    return `(root): unexpected field "${(e.params as { additionalProperty: string }).additionalProperty}"`;
  }
  const field = e.instancePath ? e.instancePath.replace(/^\//, '') : '(root)';
  return `${field}: ${e.message ?? 'invalid'}`;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Result for a file with no frontmatter: issue entries fail, other markdown is skipped. */
function missingFrontmatterResult(filePath: string, issue: boolean): FileResult {
  return issue
    ? {
      file: filePath,
      passed: false,
      skipped: false,
      errors: ['Missing YAML frontmatter (expected --- delimiters)'],
    }
    : { file: filePath, passed: true, skipped: true, errors: [] };
}

/** AJV errors for the frontmatter, formatted for display (empty when valid). */
function collectFrontmatterErrors(
  data: Record<string, unknown>,
  validate: ValidateFunction
): string[] {
  if (validate(data)) return [];
  return (validate.errors ?? []).map(formatError);
}

export function validateFile(filePath: string, validate: ValidateFunction): FileResult {
  const content = fs.readFileSync(filePath, 'utf8');
  const issue = isIssueFile(filePath);

  if (!hasFrontmatter(content)) {
    return missingFrontmatterResult(filePath, issue);
  }

  let parsed: matter.GrayMatterFile<string>;
  try {
    parsed = matter(content);
  } catch (err) {
    // Unparseable YAML must be reported as a failed file, not crash the run.
    return {
      file: filePath,
      passed: false,
      skipped: false,
      errors: [`Invalid YAML frontmatter: ${errorMessage(err)}`],
    };
  }

  const data = normalizeFrontmatter(parsed.data as Record<string, unknown>);
  const errors = collectFrontmatterErrors(data, validate);
  if (issue) {
    errors.push(...validateBody(parsed.content));
  }

  return { file: filePath, passed: errors.length === 0, skipped: false, errors };
}

/** A .md file we validate (README.md and TEMPLATE.md are excluded). */
function isValidatableMarkdown(name: string): boolean {
  return name.endsWith('.md') && name !== 'README.md' && name !== 'TEMPLATE.md';
}

/** The validatable files contributed by a single directory entry. */
function filesForEntry(dir: string, entry: fs.Dirent): string[] {
  if (entry.name === '_pending') return [];
  const full = path.join(dir, entry.name);
  if (entry.isDirectory()) return collectMarkdownFiles(full);
  if (isValidatableMarkdown(entry.name)) return [full];
  return [];
}

/** Recursively collect *.md under a directory, skipping _pending, README, TEMPLATE. */
export function collectMarkdownFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const out = entries.flatMap((entry) => filesForEntry(dir, entry));
  return out.sort((a, b) => a.localeCompare(b));
}

/** The file list to validate: a single CLI-specified file, or the full corpus. */
export function resolveFiles(specificFile: string | undefined): string[] {
  if (!specificFile) return collectMarkdownFiles(DOMAINS_DIR);
  const resolved = path.resolve(specificFile);
  if (!fs.existsSync(resolved)) {
    console.error(`File not found: ${resolved}`);
    process.exit(1);
  }
  return [resolved];
}

/** Print one file's status line (and its errors when it failed). */
export function printResult(result: FileResult): void {
  const relative = path.relative(REPO_ROOT, result.file);
  if (result.skipped) {
    console.log(`  SKIP  ${relative}`);
    return;
  }
  if (result.passed) {
    console.log(`  PASS  ${relative}`);
    return;
  }
  console.log(`  FAIL  ${relative}`);
  for (const error of result.errors) {
    console.log(`        ${error}`);
  }
}

/**
 * Validate the selected files and return a process exit code (0 = all passed,
 * 1 = at least one failure). Free of process.exit so it is testable in-process.
 */
export function run(argv: string[]): number {
  const validate = buildValidator();
  const files = resolveFiles(argv[0]);

  if (files.length === 0) {
    console.log('No context files found to validate.');
    return 0;
  }

  console.log(`Validating ${files.length} context file(s)...\n`);

  const results = files.map((file) => validateFile(file, validate));
  results.forEach(printResult);

  const skipped = results.filter((r) => r.skipped).length;
  const failed = results.filter((r) => !r.skipped && !r.passed).length;
  const passed = files.length - failed - skipped;
  console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped (of ${files.length}).`);

  return failed > 0 ? 1 : 0;
}

// Thin CLI entry: all logic lives in the covered run().
/* istanbul ignore next */
if (require.main === module) {
  process.exit(run(process.argv.slice(2)));
}
