/**
 * enumerate-claims.ts — exhaustive, reproducible extraction of the claims a
 * draft makes that are shaped like code.
 *
 * WHY THIS EXISTS. `ground-claims` extracts claims with an LLM and then settles
 * them with git. The settling half is perfectly reproducible; the extraction
 * half is not, and the gap is much wider than it looks. Measured over 13 drafts
 * whose bytes did not change between two runs:
 *
 *     claims extracted   run 1: 165    run 2: 180
 *     present in both:    78           present in only one: 189
 *     union:             267    -> a single pass saw 61-67% of it
 *
 * A 29% overlap means a single run is a sample, not a census, and reporting
 * "N grounded, 0 ungrounded" from one run overstates what was checked.
 *
 * Prose has no canonical decomposition into claims, so the semantic tier
 * ("the fix throws on write errors") will always need a model and will always
 * be sampled. But the tier the reviewer keeps catching — a named file, a named
 * symbol, a path that has since moved — is code-shaped and can simply be
 * enumerated. That is this module: regex the draft, dedupe, hand every hit to
 * the same deterministic probes. Same bytes in, same claims out, forever.
 *
 * Used alongside the LLM extractor rather than instead of it: the union is
 * exhaustive over code-shaped claims and still sampled over semantic ones,
 * which is the honest description of what the tool can promise.
 *
 * DELIBERATELY NOT EXTRACTED, because the cost of a false "this is fabricated"
 * is far higher than a missed check:
 *   - bare lowercase words in backticks (`pending`, `due`) — usually state
 *     strings, indistinguishable from prose emphasis
 *   - anything containing whitespace
 *   - issue/PR references, which verify-drafts audits against the GitHub API
 */

import { Claim } from './claim-probes';

/** Top-level directories a cht-core path can start with. */
const REPO_DIRS = '(?:api|webapp|admin|sentinel|shared-libs|tests|ddocs|config|scripts)';
const PATH_RE = new RegExp(`\\b${REPO_DIRS}/[A-Za-z0-9_./-]+\\.[A-Za-z0-9]{1,6}\\b`, 'g');

/** Inline-code spans: `foo`. */
const BACKTICK_RE = /`([^`\n]+)`/g;

/**
 * A token worth probing as a symbol. Requires an identifier shape AND a "this is
 * code" signal — an underscore, a dot, camelCase, or a call suffix — so that a
 * bare English word in backticks is left alone.
 */
const IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$.]*$/;
const CODE_SIGNAL = /_|\.|[a-z][A-Z]/;

/** Frontmatter keys whose list values are paths. */
const PATH_LIST_KEYS = ['entities'];

const stripCall = (s: string): string => s.replace(/\(\s*\)$/, '').replace(/[.,;:]+$/, '');

/** The line a match sits on, as the human-locatable quote. */
function lineContaining(lines: string[], needle: string, from = 0): { quote: string; idx: number } {
  for (let i = from; i < lines.length; i++) {
    if (lines[i].includes(needle)) return { quote: lines[i].trim(), idx: i };
  }
  return { quote: needle, idx: -1 };
}

/**
 * Body span of a `## Heading` section, or '' when absent. Line-walked rather
 * than regexed: the obvious `(?=^## |\Z)` lookahead silently matches a literal
 * "Z" in JavaScript, so the section ran to end-of-file and every path in the
 * draft looked like a Related Files entry.
 */
function section(raw: string, heading: string): string {
  const lines = raw.split('\n');
  const start = lines.findIndex(l => l.trim() === `## ${heading}`);
  if (start < 0) return '';
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith('## ')) { end = i; break; }
  }
  return lines.slice(start + 1, end).join('\n');
}

/** `PATH_RE` carries /g/, whose lastIndex makes `.test()` stateful. */
const looksLikePath = (s: string): boolean => new RegExp(PATH_RE.source).test(s);

export interface EnumerateOptions {
  /** Cap per draft; a runaway regex should not produce thousands of probes. */
  max?: number;
}

/**
 * Every code-shaped claim in `raw`, deduped and stable across runs.
 *
 * Paths named under `## Related Files` become `file-touched` (the draft is
 * asserting its PR changed them); paths named anywhere else, and in the
 * `entities` frontmatter list, become `path-exists`.
 */
export function enumerateClaims(raw: string, opts: EnumerateOptions = {}): Claim[] {
  const lines = raw.split('\n');
  const out: Claim[] = [];
  const seen = new Set<string>();
  const add = (c: Claim): void => {
    const key = `${c.kind}|${'symbol' in c ? c.symbol : ''}|${'file' in c ? c.file : ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(c);
  };

  const related = section(raw, 'Related Files');
  const touched = new Set((related.match(PATH_RE) ?? []));
  for (const p of touched) {
    add({ kind: 'file-touched', file: p, quote: lineContaining(lines, p).quote });
  }

  // entities: frontmatter — paths the draft asserts exist, not necessarily touched
  const fmEnd = raw.indexOf('\n---', 4);
  const fm = fmEnd > 0 ? raw.slice(0, fmEnd) : '';
  for (const key of PATH_LIST_KEYS) {
    const block = new RegExp(`^${key}:\\s*$([\\s\\S]*?)(?=^\\S|\\Z)`, 'm').exec(fm);
    for (const p of block?.[1].match(PATH_RE) ?? []) {
      if (!touched.has(p)) add({ kind: 'path-exists', file: p, quote: lineContaining(lines, p).quote });
    }
  }

  // every other path mentioned in the prose
  for (const p of raw.match(PATH_RE) ?? []) {
    if (!touched.has(p)) add({ kind: 'path-exists', file: p, quote: lineContaining(lines, p).quote });
  }

  // backticked identifiers
  for (const m of raw.matchAll(BACKTICK_RE)) {
    const tok = stripCall(m[1].trim());
    if (tok.length < 3 || tok.length > 80) continue;
    if (!IDENT_RE.test(tok) || !CODE_SIGNAL.test(tok)) continue;
    if (looksLikePath(tok)) continue;                // already covered as a path
    add({ kind: 'symbol', symbol: tok, quote: lineContaining(lines, m[1]).quote });
  }

  return opts.max ? out.slice(0, opts.max) : out;
}
