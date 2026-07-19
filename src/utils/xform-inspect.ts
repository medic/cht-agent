/**
 * XForm bind inspection for the QA verify step (mission 04 A2, closes G3).
 *
 * The QA Supervisor fetches a deployed form's XML (cht-api.fetchFormXml) and
 * asserts specific binds' compiled attributes against the ticket's acceptance
 * criterion — real content verification, not "the CouchDB rev changed". These
 * helpers are pure so the agent path and the unit tests exercise the exact same
 * parsing.
 *
 * The XForm the CHT API serves is `xls2xform`-generated: every field/group has
 * a single self-closing `<bind nodeset="/data/..." relevant="..." .../>` in
 * <h:head>/<model>. We match a bind by its EXACT nodeset (attribute-order
 * agnostic) and read arbitrary attributes off it (P2 — `relevant`, `calculate`,
 * `constraint`, `required`, …), asserting either a value or its ABSENCE.
 */

import { FormBindCheck, FormBindExpectation } from '../types';

export interface FormBindVerifyResult {
  passed: boolean;
  checks: FormBindCheck[];
}

// Named + numeric XML entities that can appear inside an attribute value.
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

/** Decode the XML entities `xls2xform` emits inside attribute values. */
export const decodeXmlAttr = (value: string): string =>
  value.replace(/&(#\d+|#x[0-9a-fA-F]+|amp|lt|gt|quot|apos);/g, (whole, code: string) => {
    if (code.startsWith('#x') || code.startsWith('#X')) {
      return String.fromCodePoint(Number.parseInt(code.slice(2), 16));
    }
    if (code.startsWith('#')) {
      return String.fromCodePoint(Number.parseInt(code.slice(1), 10));
    }
    return NAMED_ENTITIES[code] ?? whole;
  });

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Extract an arbitrary attribute of the <bind> whose nodeset EQUALS `nodeset`
 * (P2 — generalizes the former `relevant`-only reader). Matches the whole
 * `<bind ...>` tag first so attribute order does not matter, then reads `attr`.
 * Returns undefined when the bind is absent OR present but lacking `attr` — the
 * caller distinguishes the two with {@link bindExists}. The exact-quote match
 * means `/data/danger_signs` never matches a longer `/data/danger_signs/child`
 * bind, and the `\b`-anchored attr name means `calculate` never matches inside
 * another attribute name.
 */
export const extractBindAttr = (
  xml: string,
  nodeset: string,
  attr: string
): string | undefined => {
  const tagRe = new RegExp(`<bind\\b[^>]*\\bnodeset="${escapeRegExp(nodeset)}"[^>]*>`);
  const tag = tagRe.exec(xml);
  if (!tag) {
    return undefined;
  }
  const attrMatch = new RegExp(`\\b${escapeRegExp(attr)}="([^"]*)"`).exec(tag[0]);
  return attrMatch ? decodeXmlAttr(attrMatch[1]) : undefined;
};

/**
 * Thin back-compat wrapper: the `relevant` attribute of the target bind. Kept so
 * the untouched relevant-centric callers (the dev-phase apply's before/after
 * read-back) work unchanged while the generalized {@link extractBindAttr} backs
 * the attrs oracle.
 */
export const extractBindRelevant = (xml: string, nodeset: string): string | undefined =>
  extractBindAttr(xml, nodeset, 'relevant');

/**
 * True when a `<bind>` with EXACTLY this nodeset is present in the XML, regardless
 * of whether it carries a `relevant` attribute. Distinguishes the two ways
 * `extractBindRelevant` returns undefined: an ABSENT bind vs. a bind PRESENT
 * without `relevant`. The QA verify step needs the distinction — an expected
 * `relevant` whose deployed bind exists but lacks the attribute is a genuine
 * MISMATCH (the fix was not deployed), not a "bind not found" wiring error.
 */
export const bindExists = (xml: string, nodeset: string): boolean => {
  const tagRe = new RegExp(`<bind\\b[^>]*\\bnodeset="${escapeRegExp(nodeset)}"[^>]*>`);
  return tagRe.test(xml);
};

// Matches a self-closing/opening <bind ...> tag and, within it, nodeset + relevant.
const BIND_TAG_RE = /<bind\b[^>]*>/g;
const NODESET_ATTR_RE = /\bnodeset="([^"]*)"/;
const RELEVANT_ATTR_RE = /\brelevant="([^"]*)"/;
// The leading segment of any absolute nodeset: /<root>/… (root itself has no
// further slash). Derives the primary-instance root from the form's own binds
// instead of assuming `/data` — real partner forms use the form id as root
// (e.g. `/postnatal_care_service/…`).
const NODESET_ROOT_RE = /^\/([^/]+)\//;

/**
 * Derive the primary-instance root segment from the form's binds. The first
 * absolute bind nodeset names it (`/<root>/…`). Returns undefined when no
 * multi-segment absolute nodeset is present (nothing to snapshot).
 */
const deriveInstanceRoot = (xml: string): string | undefined => {
  for (const tag of xml.match(BIND_TAG_RE) ?? []) {
    const nodeset = NODESET_ATTR_RE.exec(tag)?.[1];
    const rootMatch = nodeset ? NODESET_ROOT_RE.exec(nodeset) : null;
    if (rootMatch) {
      return rootMatch[1];
    }
  }
  return undefined;
};

/**
 * Snapshot every top-level group bind (`/<root>/<segment>`) that carries a
 * `relevant` expression, where `<root>` is the form's own primary-instance root
 * (derived from the binds; `/data` for the demo form, `/postnatal_care_service`
 * for the partner form). The QA loop uses the CORRECTED local form's snapshot as
 * the expectation set: the deployed pre-fix form differs from it (reproduce =
 * red), and the deployed post-fix form matches it (verify = green). Restricting
 * to single-segment group nodesets keeps the set to the page/group gates (the
 * level the danger_signs fix lives at) and excludes noisy child-field binds.
 */
export const extractTopLevelGroupBinds = (xml: string): FormBindExpectation[] => {
  const root = deriveInstanceRoot(xml);
  if (root === undefined) {
    return [];
  }
  // /<root>/<segment> with no further path segments.
  const topLevelGroupRe = new RegExp(`^/${escapeRegExp(root)}/[^/]+$`);
  const binds: FormBindExpectation[] = [];
  const seen = new Set<string>();
  for (const tag of xml.match(BIND_TAG_RE) ?? []) {
    const nodeset = NODESET_ATTR_RE.exec(tag)?.[1];
    const relevant = RELEVANT_ATTR_RE.exec(tag)?.[1];
    if (nodeset && relevant !== undefined && topLevelGroupRe.test(nodeset) && !seen.has(nodeset)) {
      seen.add(nodeset);
      // A top-level group bind qualifies on carrying a `relevant` gate; the
      // snapshot asserts exactly that attribute (P2 attrs shape).
      binds.push({ nodeset, attrs: { relevant: decodeXmlAttr(relevant) } });
    }
  }
  return binds;
};

/**
 * Verify a deployed form's binds against their expected `attrs` map (P2 —
 * generalized from the single-`relevant` oracle). Each asserted attribute yields
 * one {@link FormBindCheck}; the roll-up passes only when EVERY attribute check
 * holds. Three-way per attribute, honest in BOTH directions:
 *
 *   - expected VALUE (`attrs[a] = "<expr>"`):
 *       · deployed value matches           → pass;
 *       · deployed bind present, attr absent → MISMATCH, `actual: '(none)'`
 *         (the fix was not deployed — the child-bind reproduce case, must fire
 *         RED, not silently pass and not read as a wiring error);
 *       · deployed value differs           → MISMATCH, `actual: <deployed>`.
 *   - expected ABSENT (`attrs[a] = null`):
 *       · deployed bind present, attr absent → pass;
 *       · deployed value present            → MISMATCH, `actual: <deployed>`,
 *         note "attribute should be absent" (the M8 case: a lingering deployed
 *         `calculate` reads RED).
 *   - bind ABSENT entirely (no `<bind>` tag): every attr check on that nodeset
 *     is a distinct "bind not found" failure (no `actual`), so a genuine
 *     wiring/nodeset mistake is not disguised as a missing/extra-attribute
 *     mismatch. An expected-absent attr on a missing bind is still reported as
 *     "bind not found" rather than a silent pass — the caller asked to assert on
 *     a bind that does not exist, which is a wiring problem to surface.
 */
export const verifyFormBinds = (
  xml: string,
  expectations: FormBindExpectation[]
): FormBindVerifyResult => {
  const checks: FormBindCheck[] = [];
  for (const exp of expectations) {
    const present = bindExists(xml, exp.nodeset);
    for (const [attr, expected] of Object.entries(exp.attrs)) {
      const actual = present ? extractBindAttr(xml, exp.nodeset, attr) : undefined;
      if (!present) {
        checks.push({
          nodeset: exp.nodeset,
          attr,
          expected,
          passed: false,
          note: 'bind not found in the deployed XML',
        });
        continue;
      }
      if (expected === null) {
        // Absence assertion: the attribute must NOT be on the bind.
        if (actual === undefined) {
          checks.push({ nodeset: exp.nodeset, attr, expected, passed: true });
        } else {
          checks.push({
            nodeset: exp.nodeset,
            attr,
            expected,
            actual,
            passed: false,
            note: `attribute should be absent but the deployed bind carries ${attr}="${actual}"`,
          });
        }
        continue;
      }
      // Value assertion.
      if (actual === undefined) {
        checks.push({
          nodeset: exp.nodeset,
          attr,
          expected,
          actual: '(none)',
          passed: false,
          note: `deployed bind is present but carries no ${attr} attribute (fix not deployed)`,
        });
      } else if (actual === expected) {
        checks.push({ nodeset: exp.nodeset, attr, expected, actual, passed: true });
      } else {
        checks.push({
          nodeset: exp.nodeset,
          attr,
          expected,
          actual,
          passed: false,
          note: `${attr} does not match the expected value`,
        });
      }
    }
  }
  return { passed: checks.every((check) => check.passed), checks };
};
