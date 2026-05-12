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
import Ajv, { ValidateFunction, ErrorObject } from 'ajv';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const matter = require('gray-matter') as typeof import('gray-matter');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const addFormats = require('ajv-formats') as (ajv: Ajv) => void;

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const MEMORY_DIR = path.join(REPO_ROOT, 'agent-memory');
const SCHEMA_PATH = path.join(MEMORY_DIR, 'schema.json');

interface RootSchema {
  definitions: {
    frontmatter: Record<string, unknown>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/**
 * Loads schema.json and compiles the frontmatter sub-schema with AJV.
 *
 * @returns Compiled AJV validate function for the frontmatter definition.
 *
 * @example
 * const validate = buildValidator();
 * const isValid = validate({ domain: 'messaging', title: 'Foo', last_updated: '2025-01-01' });
 */
function buildValidator(): ValidateFunction {
  const schemaRaw = fs.readFileSync(SCHEMA_PATH, 'utf8');
  const schema = JSON.parse(schemaRaw) as RootSchema;

  const ajv = new Ajv({ strict: false, allErrors: true });
  addFormats(ajv);

  // Compile the frontmatter sub-schema; embed definitions so $ref resolution works
  return ajv.compile({
    ...schema.definitions.frontmatter,
    definitions: schema.definitions,
  });
}

// ---------------------------------------------------------------------------
// File discovery
// ---------------------------------------------------------------------------

/**
 * Recursively collects all *.md file paths under `dir`,
 * excluding any path segment named `_pending`.
 *
 * @param dir - Directory to search.
 * @returns Array of absolute file paths.
 *
 * @example
 * const files = collectMarkdownFiles('/repo/agent-memory');
 * // => ['/repo/agent-memory/domains/messaging/issues/123-foo.md', ...]
 */
function collectMarkdownFiles(dir: string): string[] {
  const results: string[] = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === '_pending') continue;
      results.push(...collectMarkdownFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      results.push(fullPath);
    }
  }

  return results;
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
 * Converts a value to an ISO date string (YYYY-MM-DD) if it is a Date object,
 * otherwise returns the value unchanged.
 *
 * @param value - Value to coerce.
 * @returns ISO date string or the original value.
 *
 * @example
 * toDateString(new Date('2025-11-04T00:00:00.000Z')); // => '2025-11-04'
 * toDateString('2025-11-04');                          // => '2025-11-04'
 * toDateString(42);                                    // => 42
 */
function toDateString(value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return value;
}

/**
 * Normalizes frontmatter data to reconcile:
 * - camelCase field names used in existing files (e.g. `lastUpdated`) with the
 *   schema's snake_case names (e.g. `last_updated`).
 * - JavaScript Date objects (parsed by gray-matter from bare YAML dates) into
 *   ISO date strings, as the schema expects `"type": "string"` with `"format": "date"`.
 *
 * The canonical schema field takes precedence if both forms are present.
 *
 * @param data - Raw frontmatter data object.
 * @returns Normalized data object safe to validate against the schema.
 *
 * @example
 * const out = normalizeFrontmatter({ lastUpdated: new Date('2025-01-01'), title: 'X' });
 * // => { last_updated: '2025-01-01', title: 'X' }
 */
function normalizeFrontmatter(data: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(data)) {
    normalized[key] = toDateString(value);
  }

  // Alias camelCase legacy field to snake_case schema field
  if ('lastUpdated' in normalized && !('last_updated' in normalized)) {
    normalized['last_updated'] = normalized['lastUpdated'];
    delete normalized['lastUpdated'];
  }

  return normalized;
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

  // Skip files with no frontmatter
  if (!parsed.matter || parsed.matter.trim() === '') {
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
 * Entry point: validates all agent-memory markdown files and reports results.
 *
 * @example
 * // Invoked via: npx ts-node src/scripts/validate-schema.ts
 */
function main(): void {
  const validate = buildValidator();
  const files = collectMarkdownFiles(MEMORY_DIR);

  let passCount = 0;
  let failCount = 0;
  let skipCount = 0;

  for (const filePath of files.sort()) {
    const rel = path.relative(REPO_ROOT, filePath);
    const result = validateFile(filePath, validate);

    if (result.skipped) {
      console.log(`  (skip) ${rel}`);
      skipCount++;
    } else if (result.passed) {
      console.log(`  ✓ ${rel}`);
      passCount++;
    } else {
      console.log(`  ✗ ${rel}`);
      for (const err of result.errors) {
        console.log(err);
      }
      failCount++;
    }
  }

  console.log('');
  console.log(`Results: ${passCount} passed, ${failCount} failed, ${skipCount} skipped`);

  if (failCount > 0) {
    process.exitCode = 1;
  }
}

main();
