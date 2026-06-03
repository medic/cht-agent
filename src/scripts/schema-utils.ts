/**
 * Shared utilities for agent-memory pipeline scripts: schema validation,
 * frontmatter normalization, and common path constants.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import Ajv, { ValidateFunction } from 'ajv';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const addFormats = require('ajv-formats') as (ajv: Ajv) => void;

export const REPO_ROOT = path.resolve(__dirname, '..', '..');
export const SCHEMA_PATH = path.join(REPO_ROOT, 'agent-memory', 'schema.json');

/**
 * Loads schema.json and compiles the frontmatter sub-schema with AJV.
 *
 * @example
 * const validate = buildValidator();
 * const ok = validate({ domain: 'messaging', title: 'Foo', last_updated: '2025-01-01' });
 */
export function buildValidator(): ValidateFunction {
  const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8')) as {
    definitions: { frontmatter: Record<string, unknown>; [k: string]: unknown };
  };
  const ajv = new Ajv({ strict: false, allErrors: true });
  addFormats(ajv);
  // Embed definitions so $ref resolution works within the frontmatter sub-schema
  return ajv.compile({
    ...schema.definitions.frontmatter,
    definitions: schema.definitions,
  });
}

/**
 * Normalizes raw gray-matter frontmatter data for schema validation:
 * converts Date objects to ISO date strings and aliases `lastUpdated` → `last_updated`.
 *
 * @example
 * normalizeFrontmatter({ lastUpdated: new Date('2025-01-01'), title: 'X' });
 * // => { last_updated: '2025-01-01', title: 'X' }
 */
export function normalizeFrontmatter(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    out[k] = v instanceof Date ? v.toISOString().slice(0, 10) : v;
  }
  if ('lastUpdated' in out && !('last_updated' in out)) {
    out.last_updated = out.lastUpdated;
    delete out.lastUpdated;
  }
  return out;
}

/**
 * Returns true if the content string begins with a YAML front-matter fence.
 * Strips a leading BOM before checking. Avoids relying on gray-matter's
 * non-enumerable `.matter` property, which is unreliable after cache hits.
 *
 * @example
 * hasFrontmatter('---\ntitle: Foo\n---\n'); // true
 * hasFrontmatter('No front matter here');    // false
 */
export function hasFrontmatter(content: string): boolean {
  const s = content.replace(/^\uFEFF/, '');
  return s.startsWith('---\n') || s.startsWith('---\r\n');
}
