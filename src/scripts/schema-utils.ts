/**
 * Shared schema/validator helpers for context-file validation.
 *
 * One AJV validator compiled from agent-memory/schema.json's frontmatter
 * definition. This is the converged validator stack for #11/#87 and #109; both
 * PRs build their validator here so the repo ends with a single implementation.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import Ajv, { ValidateFunction } from 'ajv';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const addFormats = require('ajv-formats') as (ajv: Ajv) => void;

export const REPO_ROOT = path.resolve(__dirname, '..', '..');
export const SCHEMA_PATH = path.join(REPO_ROOT, 'agent-memory', 'schema.json');

/**
 * Compile a validator for the frontmatter definition. `addFormats` enables
 * `format: date` (real calendar validation, not a bare regex). `strict: false`
 * tolerates the schema's annotation keywords and unreferenced definitions.
 */
export function buildValidator(): ValidateFunction {
  const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8')) as {
    definitions: { frontmatter: Record<string, unknown>; [k: string]: unknown };
  };
  const ajv = new Ajv({ strict: false, allErrors: true });
  addFormats(ajv);
  return ajv.compile({
    ...schema.definitions.frontmatter,
    definitions: schema.definitions,
  });
}

/**
 * Coerce gray-matter's parsed frontmatter for AJV. gray-matter turns an
 * unquoted `lastUpdated: 2025-01-01` into a JS Date; `format: date` needs a
 * YYYY-MM-DD string. No `lastUpdated -> last_updated` alias: the reconciled
 * schema's canonical date field is camelCase `lastUpdated`.
 */
export function normalizeFrontmatter(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    out[k] = v instanceof Date ? v.toISOString().slice(0, 10) : v;
  }
  return out;
}

/** True if the content opens with a YAML frontmatter fence (tolerating a BOM). */
export function hasFrontmatter(content: string): boolean {
  const s = content.replace(/^\uFEFF/, '');
  return s.startsWith('---\n') || s.startsWith('---\r\n');
}
