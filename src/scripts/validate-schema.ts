/**
 * Validates all agent-memory /**\/*.md frontmatter against agent-memory/schema.json.
 *
 * Usage:
 *   npx ts-node src/scripts/validate-schema.ts
 *   npm run validate-schema
 *
 * Exits with code 1 if any file fails validation.
 *
 * @example
 * // Run via npm script:
 * // npm run validate-schema
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { ValidateFunction, ErrorObject } from 'ajv';
import matter from 'gray-matter';
import { REPO_ROOT, buildValidator, normalizeFrontmatter, hasFrontmatter } from './schema-utils';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const MEMORY_DIR = path.join(REPO_ROOT, 'agent-memory');

// ---------------------------------------------------------------------------
// File discovery
// ---------------------------------------------------------------------------

/**
 * Processes a single directory entry and returns matching file paths.
 * Recurses into subdirectories, skipping `_pending`.
 *
 * @param dir   - Parent directory path.
 * @param entry - Directory entry to process.
 * @returns Array of matching absolute file paths.
 *
 * @example
 * ```typescript
 * // Typically called from collectMarkdownFiles; not called directly.
 * ```
 */
function processEntry(dir: string, entry: import('node:fs').Dirent): string[] {
  const fullPath = path.join(dir, entry.name);
  if (entry.isDirectory() && entry.name !== '_pending') return collectMarkdownFiles(fullPath);
  if (entry.isFile() && entry.name.endsWith('.md')) return [fullPath];
  return [];
}

/**
 * Recursively collects all *.md file paths under `dir`,
 * excluding any path segment named `_pending`.
 *
 * @param dir - Directory to search.
 * @returns Array of absolute file paths.
 *
 * @example
 * ```typescript
 * const files = collectMarkdownFiles('/repo/agent-memory');
 * // => ['/repo/agent-memory/domains/messaging/issues/123-foo.md', ...]
 * ```
 */
function collectMarkdownFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => processEntry(dir, entry));
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

interface FileResult {
  file: string;
  passed: boolean;
  skipped: boolean;
  errors: string[];
}

/**
 * Formats a single AJV error into a human-readable string.
 *
 * @param err - AJV ErrorObject to format.
 * @returns Formatted error string.
 *
 * @example
 * const msg = formatError({ instancePath: '/domain', message: 'must be equal to one of the allowed values', params: {} });
 * // => '  field="domain" must be equal to one of the allowed values'
 */
function formatError(err: ErrorObject): string {
  const field = err.instancePath ? err.instancePath.replace(/^\//, '') : '(root)';
  const params =
    err.params && Object.keys(err.params).length > 0 ? ` (${JSON.stringify(err.params)})` : '';
  return `  field="${field}" ${err.message ?? 'unknown error'}${params}`;
}

/**
 * Validates the frontmatter of a single markdown file.
 *
 * @param filePath - Absolute path to the markdown file.
 * @param validate - Compiled AJV validate function.
 * @returns Validation result for the file.
 *
 * @example
 * const validate = buildValidator();
 * const result = validateFile('/repo/agent-memory/domains/x/foo.md', validate);
 * // result.passed === true if frontmatter is valid
 */
function validateFile(filePath: string, validate: ValidateFunction): FileResult {
  const content = fs.readFileSync(filePath, 'utf8');

  let parsed: ReturnType<typeof matter>;
  try {
    parsed = matter(content);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      file: filePath,
      passed: false,
      skipped: false,
      errors: [`  YAML parse error: ${message.split('\n')[0]}`],
    };
  }

  if (!hasFrontmatter(content)) {
    return { file: filePath, passed: true, skipped: true, errors: [] };
  }

  const data = normalizeFrontmatter(parsed.data as Record<string, unknown>);
  const valid = validate(data) as boolean;
  const errors = valid ? [] : (validate.errors ?? []).map(formatError);

  return { file: filePath, passed: valid, skipped: false, errors };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * Logs a single file's validation result and returns its outcome category.
 *
 * @param rel    - Relative file path for display.
 * @param result - Validation result for the file.
 * @returns The outcome category: 'pass', 'fail', or 'skip'.
 *
 * @example
 * ```typescript
 * const outcome = logFileResult('domains/x/foo.md', { passed: true, skipped: false, errors: [], file: '' });
 * // 'pass'
 * ```
 */
function logFileResult(rel: string, result: FileResult): 'pass' | 'fail' | 'skip' {
  if (result.skipped) {
    console.log(`  (skip) ${rel}`);
    return 'skip';
  }
  if (result.passed) {
    console.log(`  ✓ ${rel}`);
    return 'pass';
  }
  console.log(`  ✗ ${rel}`);
  for (const err of result.errors) {
    console.log(err);
  }
  return 'fail';
}

/**
 * Entry point: validates all agent-memory markdown files and reports results.
 *
 * @example
 * ```typescript
 * // Invoked via: npx ts-node src/scripts/validate-schema.ts
 * ```
 */
function main(): void {
  const validate = buildValidator();
  const files = collectMarkdownFiles(MEMORY_DIR);
  const counts = { pass: 0, fail: 0, skip: 0 };

  for (const filePath of files.toSorted()) {
    const rel = path.relative(REPO_ROOT, filePath);
    const result = validateFile(filePath, validate);
    const outcome = logFileResult(rel, result);
    counts[outcome]++;
  }

  console.log('');
  console.log(`Results: ${counts.pass} passed, ${counts.fail} failed, ${counts.skip} skipped`);

  if (counts.fail > 0) {
    process.exitCode = 1;
  }
}

main();
