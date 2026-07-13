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

/** Validate already-parsed data against the descriptor schema. */
export const validateXlsformFixDescriptor = (data: unknown): XlsformFixValidation => {
  const validate = getValidator();
  if (validate(data)) {
    return { valid: true, errors: [], descriptor: data as XlsformFixDescriptor };
  }
  return { valid: false, errors: (validate.errors ?? []).map(formatError) };
};

/** Parse a descriptor file's text and validate it. Malformed JSON is a failure. */
export const parseXlsformFixDescriptor = (content: string): XlsformFixValidation => {
  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch (err) {
    return { valid: false, errors: [`invalid JSON: ${(err as Error).message}`] };
  }
  return validateXlsformFixDescriptor(data);
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
