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

export function validateFile(filePath: string, validate: ValidateFunction): FileResult {
  const content = fs.readFileSync(filePath, 'utf8');
  const issue = isIssueFile(filePath);

  if (!hasFrontmatter(content)) {
    // Issue entries must carry frontmatter; indexes/other markdown may not.
    return issue
      ? {
        file: filePath,
        passed: false,
        skipped: false,
        errors: ['Missing YAML frontmatter (expected --- delimiters)'],
      }
      : { file: filePath, passed: true, skipped: true, errors: [] };
  }

  const parsed = matter(content);
  const data = normalizeFrontmatter(parsed.data as Record<string, unknown>);
  const errors: string[] = [];

  if (!validate(data)) {
    for (const e of validate.errors ?? []) {
      errors.push(formatError(e));
    }
  }
  if (issue) {
    errors.push(...validateBody(parsed.content));
  }

  return { file: filePath, passed: errors.length === 0, skipped: false, errors };
}

/** Recursively collect *.md under a directory, skipping _pending, README, TEMPLATE. */
export function collectMarkdownFiles(dir: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '_pending') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectMarkdownFiles(full));
    } else if (
      entry.name.endsWith('.md') &&
      entry.name !== 'README.md' &&
      entry.name !== 'TEMPLATE.md'
    ) {
      out.push(full);
    }
  }
  return out.sort();
}

function main(): void {
  const validate = buildValidator();
  const specificFile = process.argv[2];

  let files: string[];
  if (specificFile) {
    const resolved = path.resolve(specificFile);
    if (!fs.existsSync(resolved)) {
      console.error(`File not found: ${resolved}`);
      process.exit(1);
    }
    files = [resolved];
  } else {
    files = collectMarkdownFiles(DOMAINS_DIR);
  }

  if (files.length === 0) {
    console.log('No context files found to validate.');
    process.exit(0);
  }

  console.log(`Validating ${files.length} context file(s)...\n`);

  let failed = 0;
  let skipped = 0;
  for (const file of files) {
    const result = validateFile(file, validate);
    const relative = path.relative(REPO_ROOT, file);
    if (result.skipped) {
      console.log(`  SKIP  ${relative}`);
      skipped++;
    } else if (result.passed) {
      console.log(`  PASS  ${relative}`);
    } else {
      console.log(`  FAIL  ${relative}`);
      for (const error of result.errors) {
        console.log(`        ${error}`);
      }
      failed++;
    }
  }

  const passed = files.length - failed - skipped;
  console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped (of ${files.length}).`);

  if (failed > 0) {
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
