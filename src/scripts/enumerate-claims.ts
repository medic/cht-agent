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

/**
 * `api/v2/broadcasts.json` is a RapidPro endpoint, not a file in this repo, but
 * it starts with `api/` and ends in `.json` like everything else.
 */
const URL_PATH_RE = /^api\/v\d+\//;

/** A filename is not a symbol. Real repo paths are already caught by PATH_RE. */
const FILE_EXT_RE =
  /\.(?:js|ts|tsx|jsx|mjs|cjs|json|html|less|css|scss|md|properties|sh|ya?ml|ico|png|svg|xml)$/i;

/**
 * Frontmatter keys of THIS corpus. A draft discussing its own metadata
 * (`source_sha`, `domainFit`) is not claiming a cht-core symbol exists.
 */
const OWN_SCHEMA_KEYS = new Set([
  'source_pr', 'source_prs', 'source_sha', 'issueNumber', 'issueUrl', 'domainFit', 'subDomain',
  'lastUpdated', 'distilled_at', 'reviewed_by', 'reviewed_at', 'related_issues', 'related_workflows',
  'secondaryDomains', 'techStack', 'related_domains',
]);

/**
 * Prose that says the thing named on this line is GONE, RENAMED or was never
 * adopted. Probing such a name for existence inverts the claim: the draft is
 * asserting its absence. Deliberately broad — skipping a real claim costs a
 * missed check, while reporting one of these costs a false "fabricated symbol",
 * which is what three review rounds were spent disproving.
 *
 * Real examples this silences, all previously hand-adjudicated:
 *   "the original `can_hide_target_count_past_goal` permission was superseded"
 *   "`isTelemetryOrFeedback` -> `isReplicableDoc`"
 *   "Removed the `parseResponseBody` helper"
 *   "the languages service still queried `doc_by_type`" (the fix removed it)
 */
// `->` and `→` sit outside the \b group on purpose: neither character is a word
// character, so \b can never match beside them and the alternative was dead.
const ABSENCE_CONTEXT = new RegExp([
  // NOT 'instead of' / 'rather than': those are comparison, not absence.
  // Design Choices is full of "chose X rather than Y" and "reused X instead of
  // building Y", and both name real symbols worth checking. Measured on the
  // configuration batch they suppressed 13 code-bearing lines — more than every
  // genuine absence pattern combined — which is pure lost coverage. A sentence
  // that really removes something says so with a verb the next line catches.
  '\\b(?:removed?|deleted?|dropped|drops|superseded|supersedes|renamed|replaced?|no longer',
  '|used to|formerly|former|obsolete|stale|deprecated)\\b',
  '|->|→',
  '|\\bstill (?:queried|used|referenced|pointed)\\b',
].join(''), 'i');

/**
 * A Related Files line that disclaims the file was touched — a draft listing the
 * endpoint under test, or a spec it explicitly did not modify.
 */
const NOT_TOUCHED =
  /\b(?:not modified|unchanged|pre-existing|existing spec|not added or edited|under test|not in this PR)\b/i;

/**
 * Prose that makes the FILE ITSELF the object of a create/delete verb, which is
 * the only shape from which a `status` may be inferred.
 *
 * The distinction is the whole design of these two patterns, and getting it
 * wrong is expensive in the direction this module cares about. "Added a
 * `dbQuery` wrapper in pouchdb-provider.js" adds a symbol to a file the PR
 * MODIFIED; "added webapp/tests/mocha/tsconfig.mocha.json" adds the file. A
 * screen that keys on verb-near-path conflates the two — measured over the
 * tasks-and-targets batch it produced 64 hits, 63 of them that first shape.
 * So the verb must govern the path directly: adjacent to it, or joined to it by
 * nothing more than an article. Any intervening `in`/`to`/`from` object means
 * the file is the location of the change, not its subject.
 *
 * `#10436` is the case that motivated this. Its Testing section said a mocha
 * harness "was added ... (webapp/tests/mocha/.mocharc.js, tsconfig.mocha.json,
 * tsconfig.spec.json)" when the PR's own diff is deletions only. The probe could
 * always have caught it — `checkFileTouched` compares a claimed status against
 * the PR file list — but nothing ever set `status` on a deterministic claim, so
 * the check only fired when the LLM extractor happened to volunteer one. It did
 * not, through three review rounds.
 */
const ADD_VERB = /\b(?:add(?:s|ed|ing)?|introduc(?:e|es|ed|ing)|creat(?:e|es|ed|ing)|new)\b/gi;
const DELETE_VERB = /\b(?:remov(?:e|es|ed|ing|al)|delet(?:e|es|ed|ing)|drop(?:s|ped|ping)?)\b/gi;

/**
 * A preposition whose OBJECT is the path — "a wrapper in pouchdb-provider.js".
 * Only an article or a small quantifier may sit between, so that "for the webapp
 * (webapp/tests/...)" does not read as though `for` governs the path.
 */
const LOCATES = '(?:in|to|from|into|within|inside|under|for|of|on|per|via|alongside|against)';

/**
 * How far back a create/delete verb may sit and still govern the path, and what
 * stops it reaching. Both exist because this corpus writes a whole paragraph on
 * one line: 10423's Testing opens "Added mocha unit tests for the API target
 * controller (…)" and then names an e2e spec 200 characters later that the PR
 * merely modified. Without a bound, the opening verb claims every path in the
 * paragraph, and four of the fourteen statuses measured on the
 * tasks-and-targets batch were exactly that.
 */
const VERB_REACH = 90;
const CLAUSE_BREAK = /[;:]|\.\s|\s[—–-]\s/g;

/**
 * A create verb spelled inside a FILENAME is not a verb. Measured on
 * forms-and-reports: "Regenerated 53 config form fixtures … plus the e2e and
 * cht-form test fixtures (e.g. `tests/e2e/default/contacts/forms/ngo-create.xlsx`,
 * `tests/integration/cht-form/default/forms/dates.xml`)". The `create` in
 * `ngo-create.xlsx` matched ADD_VERB, sat within VERB_REACH of `dates.xml`, and
 * inferred that dates.xml was ADDED — it is `M`, so the probe reported a true
 * sentence as a defect. "Regenerated" is not in ADD_VERB precisely because
 * regenerating a file that exists modifies it; the fixture's own name was the
 * only thing that looked like a create.
 *
 * Blank out path-shaped tokens — anything unspaced carrying a `/` or a file
 * extension — keeping length so VERB_REACH still measures real distance. Verbs
 * contain neither slashes nor dots, so nothing real is masked.
 */
const PATHY_TOKEN = /\S*(?:\/\S+|\.[A-Za-z0-9]{1,5}\b)\S*/g;
const maskPaths = (s: string): string => s.replace(PATHY_TOKEN, m => ' '.repeat(m.length));

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The status the quote asserts for `file`, or undefined when the prose does not
 * make the file itself the thing created or deleted. Undefined is the safe
 * answer and the common one: it leaves the claim exactly as strong as it was
 * before, a plain "this PR touched the file".
 *
 * Two conditions, both required, and each earns its keep against a real shape
 * from the corpus:
 *
 *   the verb precedes the path — "reused ngrx global state (reducers/global.ts)
 *   instead of introducing new view-specific state" has a create verb in it, but
 *   after the path, and is about what the PR declined to do.
 *
 *   the path is not a locating preposition's object — "added a `dbQuery` wrapper
 *   in pouchdb-provider.js" creates a symbol, not the file.
 */
export function claimedStatus(quote: string, file: string): 'added' | 'deleted' | undefined {
  const base = file.split('/').pop() ?? file;
  const target = `(?:${escapeRe(file)}|${escapeRe(base)})`;
  const at = quote.search(new RegExp(target, 'i'));
  if (at < 0) return undefined;

  if (new RegExp(`\\b${LOCATES}\\s+(?:the\\s+|a\\s+|an\\s+|its\\s+|two\\s+|both\\s+)?${target}`, 'i')
    .test(quote)) {
    return undefined;
  }

  // Only the clause the path sits in, and only so far back within it.
  let before = quote.slice(Math.max(0, at - VERB_REACH), at);
  CLAUSE_BREAK.lastIndex = 0;
  let cut = -1;
  for (const m of before.matchAll(CLAUSE_BREAK)) cut = (m.index ?? 0) + m[0].length;
  if (cut > 0) before = before.slice(cut);
  // After the clause cut, so CLAUSE_BREAK still sees real punctuation.
  before = maskPaths(before);

  const lastIndexOfVerb = (re: RegExp): number => {
    re.lastIndex = 0;
    let last = -1;
    for (const m of before.matchAll(re)) {
      // "added no test files" asserts the opposite of what the verb suggests.
      if (/^\s*(?:no|not|zero|none)\b/i.test(before.slice((m.index ?? 0) + m[0].length))) continue;
      last = m.index ?? last;
    }
    return last;
  };
  const del = lastIndexOfVerb(DELETE_VERB);
  const add = lastIndexOfVerb(ADD_VERB);
  if (del < 0 && add < 0) return undefined;
  // Whichever verb is nearer the path is the one governing it.
  return del > add ? 'deleted' : 'added';
}

/**
 * A sentence crediting exactly one PR with creating something: "#10099 added X",
 * "X was introduced by PR #10099". Returns that PR number, or undefined when the
 * sentence is not an attribution or the credit is not unambiguous.
 *
 * Deliberately narrow, because the failure mode is expensive in one direction.
 * Two PR numbers in the same sentence ("place's via #10065 and #10089") is the
 * shape a *correct* draft uses when work spans PRs, so crediting either one and
 * probing it would manufacture a defect out of an accurate sentence. A past
 * tense create verb must also be present: "#10099 aligned their validation" is
 * an attribution about a PR that introduces nothing.
 */
const CREATE_CREDIT =
  /\b(?:add(?:ed|s)|introduc(?:ed|es)|creat(?:ed|es)|implement(?:ed|s))\b/i;

export function solePrCredit(quote: string): number | undefined {
  if (!CREATE_CREDIT.test(quote)) return undefined;
  const prs = [...new Set([...quote.matchAll(/#(\d{3,6})/g)].map(m => Number.parseInt(m[1], 10)))];
  return prs.length === 1 ? prs[0] : undefined;
}

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

/**
 * Does `text` name this exact file, rather than merely containing its letters?
 * A plain substring test says `index.js` mentions `x.js`, which would let an
 * invented path be "rescued" onto an unrelated file.
 */
function mentionsName(text: string, name: string): boolean {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^\\w./-])${esc}(?![\\w-])`).test(text);
}

/**
 * Sections that describe the state the PR CHANGED rather than the state it
 * produced. A claim from here is about the tree *before* the fix, so probing it
 * at the post-fix anchor refutes a correct sentence: 10604's Root Cause says the
 * service "queried `medic-client/doc_by_type`", which is exactly what the fix
 * removed, and 10073's names the `parseResponseBody` helper the PR deleted.
 */
const PRE_FIX_SECTIONS = new Set(['Problem', 'Root Cause']);

/** Which `## Heading` a verbatim quote sits under, or '' if it cannot be placed. */
export function sectionOfQuote(raw: string, quote: string): string {
  const needle = (quote || '').trim().slice(0, 60);
  if (!needle) return '';
  const at = raw.indexOf(needle);
  if (at < 0) return '';
  let current = '';
  for (const m of raw.matchAll(/^## (.+)$/gm)) {
    if (m.index !== undefined && m.index < at) current = m[1].trim();
  }
  return current;
}

/** True when the quote sits in a section describing the pre-fix tree. */
export const quoteIsPreFix = (raw: string, quote: string): boolean =>
  PRE_FIX_SECTIONS.has(sectionOfQuote(raw, quote));

/**
 * True when the line a quote came from disclaims the thing it names — it was
 * removed, renamed, superseded, or explicitly not touched. Exported so the
 * filter applies to MODEL-extracted claims too, not just enumerated ones: the
 * model read 4278's "was not untested" sentence and produced a file-touched
 * claim from it.
 */
export function quoteDisclaims(raw: string, quote: string): boolean {
  const needle = (quote || '').trim().slice(0, 60);
  if (!needle) return false;
  const line = raw.split('\n').find(l => l.includes(needle)) ?? quote;
  return ABSENCE_CONTEXT.test(line) || NOT_TOUCHED.test(line);
}

/**
 * Sections whose prose is about OTHER issues, not this PR's tree. A Related
 * Issues gloss quotes another ticket's title — 9486 cites #9432, "Merge
 * ensureTaskFreshness and ensureTargetFreshness into single event", and the
 * model dutifully produced two symbol claims that were never about 9486.
 */
const FOREIGN_SECTIONS = new Set(['Related Issues']);

/**
 * Normalise a claim from ANY source, or drop it. The enumerator applies these
 * rules while extracting; the model's claims never passed through them, so
 * every filter leaked on the LLM half — bare filenames probed as symbols
 * (`emitter.nools.js`, `provider-wireup.js`), `Number()` with its parens still
 * attached, and symbols lifted out of a Related Issues gloss.
 */
export function normaliseClaim<T extends { kind: string; quote: string }>(
  raw: string, claim: T
): T | null {
  const section = sectionOfQuote(raw, claim.quote);

  // A PATH THE DRAFT NEVER WRITES WAS INVENTED BY THE EXTRACTOR. 10390 says
  // "bespoke code in target-aggregates.service.ts" and "via
  // analytics.getTargetDocs"; the model supplied
  // webapp/src/ts/modules/analytics/target-aggregates.service.ts and
  // webapp/src/ts/services/analytics.service.ts, neither of which occurs
  // anywhere in the file. Probing an invented path proves nothing about the
  // draft. Fall back to the basename the draft DOES write — the basename
  // resolvers settle it — and drop the attribution entirely when even that is
  // absent.
  // A "file" that is not shaped like a file. The model produced
  // symbol-in-file with file = "analytics.getTargetDocs" — the dotted symbol
  // itself, which git then searched for as a pathspec and unsurprisingly did
  // not find, reporting the symbol as misattributed to a path that never was
  // one. No slash and no file extension means it is not a path.
  const rawFile = (claim as { file?: unknown }).file;
  if (typeof rawFile === 'string' && rawFile && !rawFile.includes('/') && !FILE_EXT_RE.test(rawFile)) {
    if ('symbol' in claim) {
      claim = { ...claim, kind: 'symbol' } as T;
      delete (claim as { file?: unknown }).file;
    } else {
      return null;
    }
  }

  const file = (claim as { file?: unknown }).file;
  if (typeof file === 'string' && file && !raw.includes(file)) {
    const base = file.split('/').pop() ?? '';
    if (base && mentionsName(raw, base)) {
      claim = { ...claim, file: base };
    } else if ('symbol' in claim) {
      claim = { ...claim, kind: 'symbol' } as T;          // check the symbol, not the guess
      delete (claim as { file?: unknown }).file;
    } else {
      return null;
    }
  }

  if (!('symbol' in claim)) return claim;

  const tok = stripCall(String((claim as { symbol: string }).symbol).trim());
  if (!tok || tok.length < 3 || tok.length > 80) return null;
  if (tok.includes('..')) return null;
  if (FILE_EXT_RE.test(tok)) return null;          // a filename is not a symbol
  if (OWN_SCHEMA_KEYS.has(tok)) return null;       // this corpus's own frontmatter
  if (looksLikePath(tok)) return null;
  // A NOUN PHRASE IS NOT AN IDENTIFIER. 9718's Root Cause reads "The interval
  // turnover mechanism in provider-wireup.js …" and the model offered
  // "interval turnover" as the symbol. git grep -F -w then reports it missing
  // from the file the sentence names, which reads as a misattributed symbol
  // rather than what it is — prose. No identifier in any language this corpus
  // covers contains whitespace.
  if (/\s/.test(tok)) return null;
  // A FILE DOES NOT CONTAIN ITS OWN NAME. 10230 says "Added a dedicated
  // api/src/services/nepal-doit-sms.js service"; extraction produced the
  // symbol `nepal-doit-sms` inside api/src/services/nepal-doit-sms.js, and
  // git reported the service missing from itself. Whatever the draft is
  // asserting there, it is the file-touched claim it already makes elsewhere.
  const own = (claim as { file?: unknown }).file;
  if (typeof own === 'string' && own) {
    const stem = (own.split('/').pop() ?? '').replace(/\.[^.]+$/, '');
    if (stem && stem === tok) return null;
  }
  if (FOREIGN_SECTIONS.has(section)) return null;  // describes a different issue
  return { ...claim, symbol: tok };
}

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
    if (seen.has(key)) {
      // A path can be claimed twice — bare under Related Files, and again in
      // prose that says what happened to it. The prose is the stronger claim, so
      // let a status upgrade the stored one rather than being deduped away.
      if (c.kind === 'file-touched' && c.status) {
        const prior = out.find(
          p => p.kind === 'file-touched' && p.file === c.file
        ) as (Claim & { kind: 'file-touched' }) | undefined;
        if (prior && !prior.status) prior.status = c.status;
      }
      return;
    }
    seen.add(key);
    out.push(c);
  };

  /**
   * A sentence that credits another PR ("#10507 had added it", "removed from
   * master by #9718") is describing someone else's diff, and checking its verb
   * against THIS PR's file list would manufacture a defect. The bare claim still
   * gets enumerated; only the status is withheld.
   */
  const statusFor = (quote: string, file: string): 'added' | 'deleted' | undefined =>
    /#\d{3,}/.test(quote) ? undefined : claimedStatus(quote, file);

  const usable = (p: string, quote: string): boolean =>
    !URL_PATH_RE.test(p) && !ABSENCE_CONTEXT.test(quote);

  const related = section(raw, 'Related Files');
  const touched = new Set<string>();
  for (const p of new Set(related.match(PATH_RE) ?? [])) {
    const { quote } = lineContaining(lines, p);
    if (URL_PATH_RE.test(p)) continue;
    // A line that disclaims the edit is not asserting the PR touched the file;
    // it still asserts the path exists, so downgrade rather than drop.
    if (NOT_TOUCHED.test(quote)) {
      if (!ABSENCE_CONTEXT.test(quote)) add({ kind: 'path-exists', file: p, quote });
      touched.add(p);                                  // claimed here; do not re-add below
      continue;
    }
    if (!ABSENCE_CONTEXT.test(quote)) {
      add({ kind: 'file-touched', file: p, quote, status: statusFor(quote, p) });
    }
    touched.add(p);
  }

  // entities: frontmatter — paths the draft asserts exist, not necessarily touched
  const fmEnd = raw.indexOf('\n---', 4);
  const fm = fmEnd > 0 ? raw.slice(0, fmEnd) : '';
  for (const key of PATH_LIST_KEYS) {
    const block = new RegExp(`^${key}:\\s*$([\\s\\S]*?)(?=^\\S)`, 'm').exec(fm);
    for (const p of block?.[1].match(PATH_RE) ?? []) {
      const { quote } = lineContaining(lines, p);
      if (!touched.has(p) && usable(p, quote)) add({ kind: 'path-exists', file: p, quote });
    }
  }

  // every other path mentioned in the prose
  for (const p of raw.match(PATH_RE) ?? []) {
    const { quote } = lineContaining(lines, p);
    if (touched.has(p) || URL_PATH_RE.test(p)) continue;
    // Prose that makes the file the object of a create/delete verb is asserting
    // what this PR DID to it, which the diff can settle — a strictly stronger
    // check than "does this path exist". Deletion says so with a word
    // ABSENCE_CONTEXT suppresses, and rightly so for a symbol that will not be
    // in the tree; a deleted file is still in the diff, so the claim survives.
    const status = statusFor(quote, p);
    if (status) {
      add({ kind: 'file-touched', file: p, quote, status });
      continue;
    }
    if (usable(p, quote)) add({ kind: 'path-exists', file: p, quote });
  }

  // backticked identifiers
  for (const m of raw.matchAll(BACKTICK_RE)) {
    const tok = stripCall(m[1].trim());
    if (tok.length < 3 || tok.length > 80) continue;
    if (!IDENT_RE.test(tok) || !CODE_SIGNAL.test(tok)) continue;
    if (tok.includes('..')) continue;                // `for...of` and friends
    if (FILE_EXT_RE.test(tok)) continue;             // a filename is not a symbol
    if (OWN_SCHEMA_KEYS.has(tok)) continue;          // this corpus's own frontmatter
    if (looksLikePath(tok)) continue;                // already covered as a path
    const { quote } = lineContaining(lines, m[1]);
    if (ABSENCE_CONTEXT.test(quote)) continue;       // the draft says it is gone
    add({ kind: 'symbol', symbol: tok, quote });

    // "#10099 added `createPlace`" / "`createPlace` was added by PR #10099" —
    // an attribution rather than an existence claim, and a separate probe. Only
    // emitted when one PR reference governs the sentence: two numbers in the
    // same clause ("#10065 and #10089") make the credit ambiguous, and guessing
    // which one is meant is how a true sentence gets reported as a defect.
    const creditedPr = solePrCredit(quote);
    if (creditedPr !== undefined) {
      add({ kind: 'introduced-by', symbol: tok, prNumber: creditedPr, quote });
    }
  }

  return opts.max ? out.slice(0, opts.max) : out;
}
