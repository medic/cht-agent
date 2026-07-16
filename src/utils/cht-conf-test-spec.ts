/**
 * Layer-aware cht-conf test-harness spec generator (mission 05, F7).
 *
 * For a `layer: cht-conf` + `configArtifact: form` ticket the dev phase's whole
 * output is a deterministic XLSForm fix (descriptor → offline convert →
 * corrected `.xlsx`/`.xml`). The test artifact that ships WITH the partner repo
 * must therefore be a `cht-conf-test-harness` spec, not a generic unit test of
 * the descriptor JSON: the partner mocha glob is `test/**\/*.spec.js` and the
 * durable "fails before the fix, passes after" oracle is the compiled form's
 * target-bind `relevant`.
 *
 * This module is PURE + deterministic: it derives the spec's scenario (target
 * bind + corrected gate expression) from the fix descriptor / bindDiff, never
 * from free-form LLM imagination, and it NEVER overwrites an existing partner
 * spec (it falls back to a `<form>.agent.spec.js` sibling). House-pattern
 * detection reads 1-2 existing specs under `test/forms/` for the harness
 * require/lifecycle idiom, falling back to the canonical harness pattern when
 * the directory is empty.
 *
 * The generated spec is self-contained JavaScript (no workbench imports): it
 * requires only `chai`, `cht-conf-test-harness`, and Node `fs`/`path`, all of
 * which the partner repo already has, and it re-implements the tiny
 * attribute-order-agnostic bind extractor inline so it runs from the config repo
 * root with the repo's own toolchain.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { XlsformBindDiff } from '../types';
import { XlsformFixDescriptor } from './xlsform-fix';

/** Where the partner repo keeps its harness specs (relative to the config root). */
const FORMS_TEST_DIR = path.join('test', 'forms');

/** Detected house pattern for the harness require + construction. */
export interface HarnessHousePattern {
  /** The `require(...)` module id used for the harness (e.g. 'cht-conf-test-harness'). */
  harnessRequire: string;
  /** How the harness is constructed on the module top-level (verbatim RHS). */
  harnessConstruction: string;
  /** True when the detection fell back to the canonical default (dir empty / unreadable). */
  fromDefault: boolean;
}

const DEFAULT_HOUSE_PATTERN: HarnessHousePattern = {
  harnessRequire: 'cht-conf-test-harness',
  harnessConstruction: 'new TestHarness()',
  fromDefault: true,
};

/**
 * Result of deriving the generated spec's file location. `relPath` is the
 * config-repo-relative destination; `overwriteAvoided` is true when the primary
 * `<form>.spec.js` already existed and we fell back to `<form>.agent.spec.js`.
 */
export interface SpecPathResolution {
  relPath: string;
  overwriteAvoided: boolean;
}

/**
 * Resolve the destination for the generated harness spec, never overwriting a
 * partner spec. Primary path: `test/forms/<form>.spec.js`. If that already
 * exists on disk, fall back to `test/forms/<form>.agent.spec.js`. (If the agent
 * sibling also exists it is overwritten — it is our own prior output, not a
 * hand-authored partner spec.)
 */
export const resolveSpecPath = (configRoot: string, form: string): SpecPathResolution => {
  const primaryRel = path.join(FORMS_TEST_DIR, `${form}.spec.js`);
  const primaryAbs = path.join(configRoot, primaryRel);
  if (!fs.existsSync(primaryAbs)) {
    return { relPath: primaryRel, overwriteAvoided: false };
  }
  return { relPath: path.join(FORMS_TEST_DIR, `${form}.agent.spec.js`), overwriteAvoided: true };
};

/**
 * Detect the repo's house pattern for a harness spec by reading up to two
 * existing `.spec.js` files under `test/forms/` (excluding the destination
 * itself). Extracts the harness `require(...)` id and the `new <Harness>(...)`
 * construction so the generated spec matches the repo's own idiom (some repos
 * pass `{ subject: 'chu_id' }` etc.). Falls back to the canonical pattern when
 * the directory is missing/empty/unreadable.
 */
export const detectHousePattern = (configRoot: string, excludeRelPath?: string): HarnessHousePattern => {
  const dir = path.join(configRoot, FORMS_TEST_DIR);
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return DEFAULT_HOUSE_PATTERN;
  }
  const excludeBase = excludeRelPath ? path.basename(excludeRelPath) : undefined;
  const candidates = entries
    .filter((e) => e.endsWith('.spec.js') && e !== excludeBase)
    .slice(0, 2);
  for (const name of candidates) {
    const detected = extractHousePattern(readFileSafe(path.join(dir, name)));
    // Only adopt a detected construction that parses as valid JS — never emit an
    // un-parseable spec into the partner repo (which would break their `npm test`
    // and the tier-2 hook). A pathological construction falls back to the default.
    if (detected && isParseableConstruction(detected.harnessConstruction)) {
      return detected;
    }
  }
  return DEFAULT_HOUSE_PATTERN;
};

/**
 * Guard: does `const harness = <construction>;` parse as valid JavaScript? Used
 * so a detected house-pattern construction can never be emitted un-parseable.
 */
const isParseableConstruction = (construction: string): boolean => {
  try {
    // `new Function` throws on a syntax error; the free identifiers (TestHarness,
    // path, __dirname) are fine — only syntactic validity is checked.
    new Function(`const harness = ${construction};`);
    return true;
  } catch {
    return false;
  }
};

const readFileSafe = (abs: string): string => {
  try {
    return fs.readFileSync(abs, 'utf8');
  } catch {
    return '';
  }
};

/**
 * Parse a spec's source for the harness require id and construction. Matches the
 * conventional `const TestHarness = require('<id>')` + `new TestHarness(<args>)`
 * idiom. Returns undefined when the file does not follow the harness pattern
 * (e.g. a *.properties.spec.js that only reads JSON).
 */
const extractHousePattern = (source: string): HarnessHousePattern | undefined => {
  if (!source) {
    return undefined;
  }
  // `const X = require('cht-conf-test-harness')` — capture the binding name + id.
  const requireMatch = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\(\s*['"]([^'"]*harness[^'"]*)['"]\s*\)/i.exec(
    source
  );
  if (!requireMatch) {
    return undefined;
  }
  const bindingName = requireMatch[1];
  const harnessRequire = requireMatch[2];
  // `new TestHarness( ... )` — capture the exact construction so per-repo options
  // survive. A naive `\(([^)]*)\)` stops at the FIRST `)`, which truncates the
  // very common cht-conf idiom `new TestHarness({ xformFolderPath: path.resolve(
  // __dirname, '../forms/app') })` (or any nested call) mid-expression and yields
  // syntactically invalid JS when embedded. Scan for the balanced closing paren
  // (string-literal aware) instead.
  const args = extractBalancedCtorArgs(source, bindingName);
  if (args === undefined) {
    return undefined;
  }
  return {
    harnessRequire,
    harnessConstruction: `new TestHarness(${args})`,
    fromDefault: false,
  };
};

/**
 * Extract the argument region of `new <bindingName>( ... )` by scanning to the
 * balanced closing paren, honoring single/double/backtick string literals (and
 * their escapes) so an interior `)` inside a nested call or a string does not
 * terminate the capture early. Returns the trimmed argument text, or undefined
 * when no construction is found / the parens never balance.
 */
const extractBalancedCtorArgs = (source: string, bindingName: string): string | undefined => {
  const startRe = new RegExp(String.raw`new\s+${escapeRe(bindingName)}\s*\(`);
  const startMatch = startRe.exec(source);
  if (!startMatch) {
    return undefined;
  }
  const openIdx = startMatch.index + startMatch[0].length - 1; // index of the '('
  let depth = 0;
  let inStr: string | null = null;
  for (let i = openIdx; i < source.length; i++) {
    const ch = source[i];
    if (inStr) {
      if (ch === '\\') {
        i++; // skip the escaped char
        continue;
      }
      if (ch === inStr) {
        inStr = null;
      }
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      inStr = ch;
      continue;
    }
    if (ch === '(') {
      depth++;
    } else if (ch === ')') {
      depth--;
      if (depth === 0) {
        return source.slice(openIdx + 1, i).trim();
      }
    }
  }
  return undefined; // parens never balanced
};

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** JS string literal for embedding in the generated spec (single-quoted). */
const jsString = (value: string): string => JSON.stringify(value);

/**
 * Extract the HOUSE_OPTIONS object-literal source from a detected harness
 * construction so the emitted spec can spread it and merge sandbox-safe launch
 * args at RUNTIME (F9). The construction is always `new TestHarness(<args>)`
 * (produced by `extractHousePattern` / the canonical default). We accept ONLY a
 * single object-literal argument — `new TestHarness({ ... })` — and return its
 * verbatim `{ ... }` text; anything else (empty `new TestHarness()`, an
 * identifier `new TestHarness(config)`, or multiple/positional args) falls back
 * to `{}` so we never spread a non-object into `puppeteer.launch()`.
 *
 * The returned text is embedded verbatim into the emitted spec, so it must parse
 * as an object literal in isolation — verified with `isObjectLiteral`.
 */
export const extractHouseOptions = (harnessConstruction: string): string => {
  const args = extractBalancedCtorArgs(harnessConstruction, 'TestHarness');
  if (args === undefined || args.trim() === '') {
    return '{}';
  }
  return isObjectLiteral(args) ? args : '{}';
};

/**
 * True when `source` parses as a single object literal (so it can be safely
 * spread with `...` in the emitted construction).
 *
 * The guard parses the EXACT statement the caller emits — `const _ = <source>;`
 * — because that is the only shape that faithfully rejects a positional
 * two-object ctor like `new TestHarness({a:1}, {b:2})`. A tempting
 * `return (${trimmed})` (or `const _ = (${trimmed})`) does NOT: inside the
 * parentheses the top-level comma is the legal comma operator (`{a:1}, {b:2}`
 * evaluates to `{b:2}`), so the guard wrongly returns true and
 * `extractHouseOptions` emits `const HOUSE_OPTIONS = {a:1}, {b:2};` — a second
 * declarator with no initializer, which is a SyntaxError at statement position
 * and breaks the partner repo's `npm test` / the tier-2 hook. Un-parenthesized,
 * the same top-level comma is illegal (a `const` declarator's initializer is an
 * AssignmentExpression, not a full Expression), so the guard throws — exactly
 * what we want. A single object literal (including nested objects / interior
 * commas that live inside brackets) parses fine.
 */
const isObjectLiteral = (source: string): boolean => {
  const trimmed = source.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
    return false;
  }
  try {
    new Function(`const _ = ${trimmed};`);
    return true;
  } catch {
    return false;
  }
};

/**
 * The scenario the generated spec asserts, derived deterministically from the
 * fix descriptor / bindDiff.
 */
export interface SpecScenario {
  form: string;
  /** The target bind nodeset the fix corrected. */
  nodeset: string;
  /** The corrected `relevant` expression the compiled form must now carry. */
  expectedRelevant: string;
  /** The buggy `relevant` expression the pre-fix form carried (for the doc/comment). */
  previousRelevant?: string;
  /** Free-text rationale from the descriptor (for the doc comment). */
  rationale?: string;
}

/**
 * Derive the spec scenario from the descriptor + the verified bindDiff. The
 * bindDiff is authoritative for the compiled expressions (it is what the offline
 * conversion actually produced); the descriptor supplies the rationale.
 */
export const deriveScenario = (
  descriptor: XlsformFixDescriptor,
  bindDiff: XlsformBindDiff
): SpecScenario => ({
  form: descriptor.form,
  nodeset: bindDiff.nodeset,
  expectedRelevant: bindDiff.after,
  ...(bindDiff.before !== undefined ? { previousRelevant: bindDiff.before } : {}),
  ...(descriptor.rationale ? { rationale: descriptor.rationale } : {}),
});

/**
 * Render the self-contained harness spec. The spec:
 *  - loads the corrected form through the repo-pinned harness (a smoke test that
 *    the form compiles + loads with no console errors — the harness lifecycle
 *    the house pattern uses);
 *  - asserts the compiled `forms/app/<form>.xml` target bind carries the
 *    corrected `relevant` expression (the durable red→green oracle: the pre-fix
 *    XML fails it, the post-fix XML passes it), using an inline
 *    attribute-order-agnostic extractor so it needs no workbench imports.
 */
export const renderSpec = (scenario: SpecScenario, house: HarnessHousePattern): string => {
  const { form, nodeset, expectedRelevant } = scenario;
  // Neutralize any `*/` so a value can never close the doc block early.
  const cmt = (s: string): string => s.replace(/\*\//g, '* /');
  const prevComment = scenario.previousRelevant !== undefined
    ? ` *   before the fix: ${cmt(scenario.previousRelevant || '(none)')}\n`
    : '';
  const rationaleComment = scenario.rationale ? ` *   rationale: ${cmt(scenario.rationale)}\n` : '';
  // F9: the detected partner construction (or the canonical default) becomes the
  // HOUSE_OPTIONS object literal; the emitted spec spreads it and concatenates
  // the sandbox-safe Chromium flags AT RUNTIME so the harness boots under the
  // container's cap_drop ALL hardening. `{}` when detection produced no
  // spreadable object literal (empty / identifier / positional args).
  const houseOptions = extractHouseOptions(house.harnessConstruction);
  return `const { expect } = require('chai');
const fs = require('node:fs');
const path = require('node:path');
const TestHarness = require(${jsString(house.harnessRequire)});

// The harness forwards its options straight to puppeteer.launch(), so the
// Chromium launch \`args\` ride through. This container runs cap_drop ALL, under
// which Chromium's SUID sandbox cannot initialize ("No usable sandbox!"), so we
// merge --no-sandbox + --disable-dev-shm-usage into the launch args at runtime.
// Partner-supplied options (HOUSE_OPTIONS) and any partner args are preserved
// (concatenated, then de-duplicated) — nothing is clobbered.
const HOUSE_OPTIONS = ${houseOptions};
const SANDBOX_ARGS = ['--no-sandbox', '--disable-dev-shm-usage'];
const harness = new TestHarness({
  ...HOUSE_OPTIONS,
  args: [...(HOUSE_OPTIONS.args || []), ...SANDBOX_ARGS].filter(
    (arg, i, all) => all.indexOf(arg) === i
  ),
});

/**
 * Generated by the CHT agent (mission 05 XLSForm fix) — do not overwrite by hand.
 * Durable red→green oracle for the ${form} form fix:
 *   target bind: ${cmt(nodeset)}
 *   expected relevant (after the fix): ${cmt(expectedRelevant)}
${prevComment}${rationaleComment} *
 * Asserting the compiled forms/app/${form}.xml carries the corrected \`relevant\`
 * fails against the pre-fix form and passes against the fixed form.
 */

const FORM = ${jsString(form)};
const TARGET_NODESET = ${jsString(nodeset)};
const EXPECTED_RELEVANT = ${jsString(expectedRelevant)};

// Attribute-order-agnostic \`relevant\` extractor for a specific <bind nodeset>.
// (Inlined so the spec needs no workbench dependency.)
function extractBindRelevant(xml, nodeset) {
  const bindRe = /<bind\\b([^>]*)\\/?>/g;
  let m;
  while ((m = bindRe.exec(xml)) !== null) {
    const attrs = m[1];
    const ns = /\\bnodeset\\s*=\\s*"([^"]*)"/.exec(attrs);
    if (ns && ns[1] === nodeset) {
      const rel = /\\brelevant\\s*=\\s*"([^"]*)"/.exec(attrs);
      return rel ? decodeXmlAttr(rel[1]) : undefined;
    }
  }
  return undefined;
}

function decodeXmlAttr(value) {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function normalizeWhitespace(value) {
  return value.replace(/\\s+/g, ' ').trim();
}

describe(${jsString(`${form} — relevant-gate fix (${nodeset})`)}, () => {
  before(async () => harness.start());
  after(async () => harness.stop());
  beforeEach(async () => harness.clear());
  afterEach(() => {
    expect(harness.consoleErrors).to.be.empty;
  });

  it('loads the corrected form without console errors', async () => {
    await harness.loadForm(FORM);
    expect(harness.consoleErrors).to.be.empty;
  });

  it(${jsString(`gates ${nodeset} on the corrected relevant expression`)}, () => {
    const xmlPath = path.resolve(__dirname, '..', '..', 'forms', 'app', FORM + '.xml');
    const xml = fs.readFileSync(xmlPath, 'utf8');
    const actual = extractBindRelevant(xml, TARGET_NODESET);
    expect(actual, 'target bind ' + TARGET_NODESET + ' not found in ' + xmlPath).to.not.be.undefined;
    expect(normalizeWhitespace(actual)).to.equal(normalizeWhitespace(EXPECTED_RELEVANT));
  });
});
`;
};

/** The generated spec file: a config-repo-relative path + its JS content. */
export interface GeneratedHarnessSpec {
  relPath: string;
  content: string;
  /** True when the primary path existed and we wrote the `.agent.spec.js` sibling. */
  overwriteAvoided: boolean;
  /** True when the house pattern fell back to the canonical default. */
  housePatternFromDefault: boolean;
}

/**
 * Generate the one cht-conf-test-harness spec for a form fix: resolve a
 * non-overwriting destination, detect the house pattern, derive the scenario
 * from the descriptor/bindDiff, and render the self-contained JS. Pure aside
 * from the two on-disk probes (path existence + house-pattern read).
 */
export const generateHarnessSpec = (
  descriptor: XlsformFixDescriptor,
  bindDiff: XlsformBindDiff,
  configRoot: string
): GeneratedHarnessSpec => {
  const { relPath, overwriteAvoided } = resolveSpecPath(configRoot, descriptor.form);
  const house = detectHousePattern(configRoot, relPath);
  const scenario = deriveScenario(descriptor, bindDiff);
  const content = renderSpec(scenario, house);
  return {
    relPath,
    content,
    overwriteAvoided,
    housePatternFromDefault: house.fromDefault,
  };
};
