/**
 * XForm bind inspection for the QA verify step (mission 04 A2, closes G3).
 *
 * The QA Supervisor fetches a deployed form's XML (cht-api.fetchFormXml) and
 * asserts specific binds' `relevant` expressions against the ticket's
 * acceptance criterion — real content verification, not "the CouchDB rev
 * changed". These helpers are pure so the agent path and the unit tests
 * exercise the exact same parsing.
 *
 * The XForm the CHT API serves is `xls2xform`-generated: every field/group has
 * a single self-closing `<bind nodeset="/data/..." relevant="..."/>` in
 * <h:head>/<model>. We match a bind by its EXACT nodeset (attribute-order
 * agnostic) and read its `relevant`.
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
 * Extract the `relevant` attribute of the <bind> whose nodeset EQUALS `nodeset`.
 * Matches the whole `<bind ...>` tag first so attribute order does not matter,
 * then reads its `relevant`. Returns undefined when the bind is absent or has no
 * `relevant`. The exact-quote match means `/data/danger_signs` never matches a
 * longer `/data/danger_signs/child` bind.
 */
export const extractBindRelevant = (xml: string, nodeset: string): string | undefined => {
  const tagRe = new RegExp(`<bind\\b[^>]*\\bnodeset="${escapeRegExp(nodeset)}"[^>]*>`);
  const tag = tagRe.exec(xml);
  if (!tag) {
    return undefined;
  }
  const relMatch = /\brelevant="([^"]*)"/.exec(tag[0]);
  return relMatch ? decodeXmlAttr(relMatch[1]) : undefined;
};

// Matches a self-closing/opening <bind ...> tag and, within it, nodeset + relevant.
const BIND_TAG_RE = /<bind\b[^>]*>/g;
const NODESET_ATTR_RE = /\bnodeset="([^"]*)"/;
const RELEVANT_ATTR_RE = /\brelevant="([^"]*)"/;
// A top-level group nodeset: /data/<segment> with no further path segments.
const TOP_LEVEL_GROUP_RE = /^\/data\/[^/]+$/;

/**
 * Snapshot every top-level group bind (`/data/<segment>`) that carries a
 * `relevant` expression. The QA loop uses the CORRECTED local form's snapshot as
 * the expectation set: the deployed pre-fix form differs from it (reproduce =
 * red), and the deployed post-fix form matches it (verify = green). Restricting
 * to single-segment group nodesets keeps the set to the page/group gates (the
 * level the danger_signs fix lives at) and excludes noisy child-field binds.
 */
export const extractTopLevelGroupBinds = (xml: string): FormBindExpectation[] => {
  const binds: FormBindExpectation[] = [];
  const seen = new Set<string>();
  for (const tag of xml.match(BIND_TAG_RE) ?? []) {
    const nodeset = NODESET_ATTR_RE.exec(tag)?.[1];
    const relevant = RELEVANT_ATTR_RE.exec(tag)?.[1];
    if (nodeset && relevant !== undefined && TOP_LEVEL_GROUP_RE.test(nodeset) && !seen.has(nodeset)) {
      seen.add(nodeset);
      binds.push({ nodeset, relevant: decodeXmlAttr(relevant) });
    }
  }
  return binds;
};

/**
 * Verify a deployed form's binds against their expected `relevant` expressions.
 * A missing bind or a mismatched expression fails the check; the roll-up passes
 * only when every expectation holds.
 */
export const verifyFormBinds = (
  xml: string,
  expectations: FormBindExpectation[]
): FormBindVerifyResult => {
  const checks: FormBindCheck[] = expectations.map((exp) => {
    const actual = extractBindRelevant(xml, exp.nodeset);
    if (actual === undefined) {
      return {
        nodeset: exp.nodeset,
        expected: exp.relevant,
        passed: false,
        note: 'bind (or its relevant attribute) not found in the deployed XML',
      };
    }
    if (actual === exp.relevant) {
      return { nodeset: exp.nodeset, expected: exp.relevant, actual, passed: true };
    }
    return {
      nodeset: exp.nodeset,
      expected: exp.relevant,
      actual,
      passed: false,
      note: 'relevant does not match the expected expression',
    };
  });
  return { passed: checks.every((check) => check.passed), checks };
};
