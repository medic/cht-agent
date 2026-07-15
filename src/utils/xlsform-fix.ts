/**
 * The XLSForm fix descriptor contract (mission 05).
 *
 * For a `layer: cht-conf` + `configArtifact: form` ticket the sandboxed code-gen
 * CLI does NOT touch the binary `.xlsx`; it writes a single structured file,
 * `.cht-agent/xlsform-fix.json`, describing which cell to change and the
 * outcome it expects from the offline conversion. This module owns the type,
 * the JSON-Schema validator (ajv), and the ticket predicate the prompts and the
 * supervisor node key off.
 *
 * The schema JSON lives at `src/schemas/xlsform-fix.schema.json` and is read at
 * runtime from the repo tree (the `src/` directory ships in the runtime image
 * alongside `dist/`), mirroring `src/scripts/schema-utils.ts` — `tsc` does not
 * copy `.json` assets into `dist/`, so a bundled `import` would break at run
 * time.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import Ajv, { ErrorObject, ValidateFunction } from 'ajv';
import { IssueTemplate } from '../types';
import { XlsformEdit } from './xlsform-editor';

/** Repo-relative path the descriptor is written to (config-project root). */
export const XLSFORM_FIX_DESCRIPTOR_PATH = '.cht-agent/xlsform-fix.json';

/** The dev-phase oracle block: what the offline-converted XML must show. */
export interface XlsformFixExpectation {
  nodeset: string;
  relevant: string;
  /** Default true: every other top-level group bind must stay byte-invariant. */
  siblingsUnchanged?: boolean;
}

/** The whole output of a cht-conf form fix — contract AND oracle. */
export interface XlsformFixDescriptor {
  version: 1;
  form: string;
  edits: XlsformEdit[];
  expect: XlsformFixExpectation;
  rationale: string;
}

export interface XlsformFixValidation {
  valid: boolean;
  errors: string[];
  descriptor?: XlsformFixDescriptor;
}

// REPO_ROOT is two levels up from both src/utils and dist/utils, so the same
// join reaches src/schemas in ts-node and in the built image.
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SCHEMA_PATH = path.join(REPO_ROOT, 'src', 'schemas', 'xlsform-fix.schema.json');

let validator: ValidateFunction | undefined;

const getValidator = (): ValidateFunction => {
  if (!validator) {
    const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
    const ajv = new Ajv({ allErrors: true, strict: false });
    validator = ajv.compile(schema);
  }
  return validator;
};

const formatError = (error: ErrorObject): string =>
  `${error.instancePath || '(root)'} ${error.message ?? 'is invalid'}`.trim();

/**
 * Coerce a string `match.groupPath` to a one-element array in place (F8): the
 * schema (and applier) require an array, but the LLM sometimes emits the bare
 * string. Warns on each coercion so the live-run transcript records the salvage.
 * No-op for well-formed descriptors (groupPath already an array or absent) and
 * for shapes the applier will reject anyway.
 */
const normalizeGroupPaths = (data: unknown): void => {
  if (typeof data !== 'object' || data === null) return;
  const edits = (data as Record<string, unknown>).edits;
  if (!Array.isArray(edits)) return;
  for (const edit of edits) {
    if (typeof edit !== 'object' || edit === null) continue;
    const match = (edit as Record<string, unknown>).match;
    if (typeof match !== 'object' || match === null) continue;
    const gp = (match as Record<string, unknown>).groupPath;
    if (typeof gp === 'string') {
      (match as Record<string, unknown>).groupPath = [gp];
      console.warn(`[xlsform-fix] WARN: coerced string groupPath "${gp}" to a one-element array`);
    }
  }
};

/** Validate already-parsed data against the descriptor schema. */
export const validateXlsformFixDescriptor = (data: unknown): XlsformFixValidation => {
  normalizeGroupPaths(data);
  const validate = getValidator();
  if (validate(data)) {
    return { valid: true, errors: [], descriptor: data as XlsformFixDescriptor };
  }
  return { valid: false, errors: (validate.errors ?? []).map(formatError) };
};

/**
 * Extract the first balanced, top-level JSON object from arbitrary text (F8).
 *
 * The sandboxed CLI is told to write ONLY the JSON object, but live runs keep
 * producing trailing prose and ```json fences after (or around) the object.
 * Rather than reject the whole file, scan for the first `{` and walk forward
 * tracking brace depth — string-literal-aware (so braces or quotes inside string
 * values never mislead the scan) — and return the substring of the first
 * balanced object. Anything before the `{` or after the matching `}` is dropped.
 *
 * Returns null when no balanced object exists (genuine garbage still errors).
 */
const extractFirstJsonObject = (text: string): string | null => {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
};

/**
 * Parse a descriptor file's text and validate it. Tolerant (F8): first tries a
 * strict JSON parse of the whole content; on failure, falls back to extracting
 * the first balanced top-level JSON object (stripping code fences and trailing
 * prose) with a WARN. Only when no parseable object exists at all does it fail.
 */
export const parseXlsformFixDescriptor = (content: string): XlsformFixValidation => {
  // Strip a leading UTF-8 BOM (U+FEFF): JSON.parse rejects it, but an otherwise
  // clean descriptor should still parse on the strict path. Without this, the
  // salvage guard below is defeated for a BOM-only prefix — String.trim() strips
  // the BOM, so `extracted === content.trim()` and the short-circuit skips salvage.
  const normalized = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
  const strict = tryParseJson(normalized);
  if (strict.ok) return validateXlsformFixDescriptor(strict.data);

  const extracted = extractFirstJsonObject(normalized);
  if (extracted !== null && extracted !== normalized.trim()) {
    const salvaged = tryParseJson(extracted);
    if (salvaged.ok) {
      console.warn(
        '[xlsform-fix] WARN: descriptor carried extra content (fences/prose) around the JSON object; ' +
          'salvaged the first balanced object. The prompt requires ONLY the JSON object with no fences or trailing text.',
      );
      return validateXlsformFixDescriptor(salvaged.data);
    }
  }
  return { valid: false, errors: [`invalid JSON: ${strict.error}`] };
};

const tryParseJson = (text: string): { ok: true; data: unknown } | { ok: false; error: string } => {
  try {
    return { ok: true, data: JSON.parse(text) };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
};

/**
 * True when a ticket routes to the XLSForm-fix path: a cht-conf deployment
 * config ticket whose artifact is a form. Everything else (all cht-core
 * tickets, non-form config artifacts) is unaffected — the prompts and the
 * supervisor node stay byte-identical for them.
 */
export const isXlsformFixTicket = (ticket: IssueTemplate): boolean => {
  const ctx = ticket.issue.technical_context;
  return ctx.layer === 'cht-conf' && ctx.configArtifact === 'form';
};
