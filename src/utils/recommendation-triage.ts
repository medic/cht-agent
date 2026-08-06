/**
 * Recommendation triage — make validation recommendations actionable (m4).
 *
 * Observed on live ticket m4: the validation node produced six specific, correct
 * recommendations ("add opv0 to the birth entry of totalVaccinesDueByAge",
 * "re-add the yellow-fever rule", "key measles off months not weeks"). The
 * overall score was 80% — above REFINEMENT_THRESHOLD — so
 * resolveValidateImplEdge ended the loop and every recommendation was discarded.
 * The shipped fix carried the clinical false negatives they had already named.
 *
 * The triage step:
 *
 *  1. SEVERITY, deterministically and with NO extra LLM call. Severity comes from
 *     lexical signals over the text, plus (for free) whatever severity the
 *     validator volunteered in the SAME already-paid-for JSON response. A
 *     validator that under-calls severity cannot suppress an escalation: either
 *     source saying "blocking" makes it blocking.
 *  2. A DISPOSITION for every item, always: 'applied' (with evidence) or
 *     'deferred' (with a reason). No third state, no silent drop — a mid-run
 *     ledger snapshot is as complete as the final one.
 *  3. A BOUNDED escalation. Open blocking items buy AT MOST ONE extra refinement
 *     pass per development run: the caller stamps a sticky state channel and
 *     never requests a second one. Advisory items never buy an iteration.
 */

import {
  FileValidationFeedback,
  GeneratedFile,
  RawRecommendation,
  RecommendationSeverity,
  TriagedRecommendation,
} from '../types';

/** Deferral reasons as constants, so display and PR-body grouping stay in sync. */
export const DEFERRAL_REASONS = {
  ADVISORY: 'advisory (cosmetic or hedged) — not worth a refinement iteration',
  QUEUED: 'blocking — queued for one targeted refinement pass',
  STILL_RAISED: 'blocking — one targeted refinement pass ran and the validator still raises it',
  UNVERIFIED: 'no longer raised by validation, but no refinement pass targeted it — unverified',
  BUDGET_SPENT: 'blocking — the refinement iteration budget was already spent',
  ONE_PASS_SPENT: 'blocking — this run already spent its one recommendation-driven refinement pass',
  NO_TARGET_FILE: 'blocking — no generated file could be mapped, so regeneration had no target',
  XLSFORM_APPLY: 'blocking — the deterministic XLSForm apply owns the verdict on this path',
  EXECUTE_NO_OP: 'blocking — code generation abstained (execute-no-op); another pass cannot help',
} as const;

/** A lexical signal: an audit label plus the pattern that fires it. */
interface Signal {
  label: string;
  re: RegExp;
}

/** Word-boundary alternation over `alts`, case-insensitive. */
function buildWordRe(alts: string[]): RegExp {
  return new RegExp(`\\b(?:${alts.join('|')})\\b`, 'i');
}

/** Start-anchored alternation over `alts`, case-insensitive. */
function buildPrefixRe(alts: string[]): RegExp {
  return new RegExp(`^\\s*(?:${alts.join('|')})\\b`, 'i');
}

/**
 * Defect vocabulary — a recommendation that speaks this way is naming a
 * correctness problem. Checked FIRST, so it outranks the cosmetic list below: a
 * model hedging about a real defect ("consider whether the measles rule is
 * wrong") escalates instead of being filed as a nit.
 */
const DEFECT_SIGNALS: Signal[] = [
  {
    label: 'missing/omitted',
    re: buildWordRe([
      'missing', 'absent', 'omits?', 'omitted', 'dropped', 'drops', 'lost', 'no longer',
      'not (present|included|handled|covered|applied|implemented|checked|counted|emitted)',
    ]),
  },
  {
    label: 'incorrect',
    re: buildWordRe([
      'incorrect(ly)?', 'wrong', 'invalid', 'inaccurate', 'mismatch(ed|es)?', 'off by',
      'inverted', 'backwards?', 'duplicate[ds]?', 'double[- ]?count(s|ed|ing)?',
    ]),
  },
  {
    label: 'regression/false verdict',
    re: buildWordRe([
      'regress(es|ion|ions)?', 'false (negative|positive)s?', 'breaks?', 'broken', 'fails?',
      'failing', 'crash(es)?', 'throws?', 'never (true|fires|matches)', 'unreachable',
    ]),
  },
  {
    label: 'normative',
    re: buildWordRe([
      'must', 'should (be|use|not|instead|also|only)', 'needs? to', 'has to',
      'instead of', 'rather than', 'not (weeks|months|days|years)',
    ]),
  },
  {
    label: 'restore/re-add',
    re: buildWordRe([
      're-?adds?', 're-?added', 'add back', 'restore', 'reinstate', 'revert', 'put back',
    ]),
  },
];

/**
 * Cosmetic / hedged vocabulary. Matching here with NO defect signal means the
 * item is advisory: recorded and reported, never worth a refinement iteration.
 */
const COSMETIC_SIGNALS: Signal[] = [
  {
    label: 'cosmetic subject',
    re: buildWordRe([
      'nit', 'nitpick', 'cosmetic', 'stylistic', 'style', 'formatting', 'indentation',
      'whitespace', 'readability', 'naming', 'rename[ds]?', 'typo', 'comments?', 'jsdoc',
      'docstring', 'documentation', 'docs', 'lint(ing)?', 'prettier', 'eslint',
      'log (message|statement)',
    ]),
  },
  {
    label: 'hedged suggestion',
    re: buildPrefixRe([
      'consider', 'optionally', 'you (may|might|could)', 'it (may|might) be worth',
      'perhaps', 'maybe', 'nice to have', 'as a follow-?up', 'future work',
    ]),
  },
];

/** Imperative edit verbs — an instruction to change code, not an observation. */
const EDIT_VERB = buildPrefixRe([
  're-?add', 'add', 'restore', 'remove', 'delete', 'drop', 'replace', 'swap', 'fix', 'correct',
  'key', 'change', 'update', 'use', 'move', 'guard', 'include', 'exclude', 'handle', 'split',
  'merge', 'set', 'align', 'switch',
]);

const QUOTED_PATTERNS: RegExp[] = [
  /`([^`\n]{2,80})`/g,
  /'([^'\n]{2,80})'/g,
  /"([^"\n]{2,80})"/g,
];
const PATH_PATTERN = /\b[\w./-]*\w\.(?:js|jsx|ts|tsx|json|xml|xlsx|properties)\b/g;
/** camelCase / snake_case / dotted identifiers — requires an internal capital or
 *  underscore so ordinary prose words do not register as code anchors. */
const IDENT_PATTERN = /\b[A-Za-z_$][A-Za-z0-9_$]*(?:[A-Z][A-Za-z0-9_$]*|_[A-Za-z0-9_$]+)\b/g;
const IDENT_STOPLIST = new Set([
  'CHT', 'CHP', 'CHW', 'CHV', 'PNC', 'ANC', 'LMP', 'MOH', 'JSON', 'XML', 'JS', 'TS',
  'TODO', 'FIXME', 'API', 'UI', 'QA', 'PR', 'LLM', 'XLSForm', 'XForm',
]);

function addAnchor(into: Set<string>, value: string | undefined): void {
  const trimmed = (value ?? '').trim();
  if (trimmed.length >= 3) {
    into.add(trimmed);
  }
}

/**
 * Pull the code anchors out of a recommendation: backticked/quoted spans, file
 * paths, and camelCase/snake_case identifiers. Anchors do two jobs — they map a
 * recommendation to the file(s) a refinement pass should rework, and they are
 * the evidence that an imperative sentence is about code rather than prose.
 */
export function extractAnchors(text: string): string[] {
  const found = new Set<string>();
  for (const re of QUOTED_PATTERNS) {
    for (const m of text.matchAll(re)) {
      addAnchor(found, m[1]);
    }
  }
  for (const m of text.matchAll(PATH_PATTERN)) {
    addAnchor(found, m[0]);
  }
  for (const m of text.matchAll(IDENT_PATTERN)) {
    if (!IDENT_STOPLIST.has(m[0])) {
      addAnchor(found, m[0]);
    }
  }
  return [...found];
}

/** Read a recommendation's text whether the validator emitted a string or an object. */
export function recommendationText(raw: RawRecommendation): string {
  return typeof raw === 'string' ? raw : raw.text;
}

function declaredSeverity(raw: RawRecommendation): RecommendationSeverity | undefined {
  return typeof raw === 'string' ? undefined : raw.severity;
}

function declaredFile(raw: RawRecommendation): string | undefined {
  return typeof raw === 'string' ? undefined : raw.filePath;
}

export interface Classification {
  severity: RecommendationSeverity;
  signal: string;
}

/**
 * Decide severity. Order matters and is the whole design:
 *  1. defect vocabulary wins outright (a hedge cannot hide a defect);
 *  2. an explicit "blocking" from the validator is honoured next;
 *  3. cosmetic subject / hedged phrasing files it as advisory;
 *  4. an imperative edit verb that names a code anchor is blocking (this is the
 *     m4 shape: "add opv0 to the birth entry of totalVaccinesDueByAge");
 *  5. otherwise advisory — recorded, but it does not buy an iteration.
 */
export function classifyRecommendation(
  raw: RawRecommendation,
  anchors: ReadonlyArray<string>,
): Classification {
  const text = recommendationText(raw);
  const defect = DEFECT_SIGNALS.find(s => s.re.test(text));
  if (defect) {
    return { severity: 'blocking', signal: `defect vocabulary: ${defect.label}` };
  }
  if (declaredSeverity(raw) === 'blocking') {
    return { severity: 'blocking', signal: 'validator declared it blocking' };
  }
  const cosmetic = COSMETIC_SIGNALS.find(s => s.re.test(text));
  if (cosmetic) {
    return { severity: 'advisory', signal: `cosmetic: ${cosmetic.label}` };
  }
  if (EDIT_VERB.test(text) && anchors.length > 0) {
    return { severity: 'blocking', signal: `imperative edit naming ${anchors[0]}` };
  }
  return { severity: 'advisory', signal: 'no defect vocabulary and no code anchor' };
}

/**
 * Files a recommendation-driven regeneration may target. Excludes the
 * orchestration-internal descriptor (the deterministic apply owns that),
 * generated specs, and the locale files the deterministic propagator owns.
 */
export function regenerableFiles(files: ReadonlyArray<GeneratedFile>): GeneratedFile[] {
  return files.filter(f =>
    !f.relativePath.startsWith('.cht-agent/') &&
    !/\.spec\.[jt]sx?$/.test(f.relativePath) &&
    !/messages-[a-z]{2}\.properties$/.test(f.relativePath));
}

/**
 * Cap for the "small change set" fallback. A recommendation whose anchors match
 * nothing ("key measles off months not weeks" names no identifier) still has a
 * well-defined target when the whole change is a handful of files. Above the cap
 * we refuse to guess and defer with NO_TARGET_FILE instead of regenerating the world.
 */
export const FALLBACK_MAX_FILES = 5;

export function mapAnchorsToFiles(
  anchors: ReadonlyArray<string>,
  files: ReadonlyArray<GeneratedFile>,
): string[] {
  const candidates = regenerableFiles(files);
  const hits = candidates.filter(f =>
    anchors.some(a => f.relativePath.includes(a) || f.content.includes(a)));
  if (hits.length > 0) {
    return hits.map(f => f.relativePath);
  }
  if (candidates.length > 0 && candidates.length <= FALLBACK_MAX_FILES) {
    return candidates.map(f => f.relativePath);
  }
  return [];
}

function triageOne(
  raw: RawRecommendation,
  files: ReadonlyArray<GeneratedFile>,
  iteration: number,
): TriagedRecommendation {
  const text = recommendationText(raw).trim();
  const anchors = extractAnchors(text);
  const { severity, signal } = classifyRecommendation(raw, anchors);
  const mapped = mapAnchorsToFiles(anchors, files);
  const declared = declaredFile(raw);
  const declaredIsReal = declared !== undefined &&
    regenerableFiles(files).some(f => f.relativePath === declared);
  const targets = declaredIsReal && !mapped.includes(declared as string)
    ? [declared as string, ...mapped]
    : mapped;
  const blocking = severity === 'blocking';
  return {
    text,
    severity,
    signal,
    anchors,
    targetFiles: blocking ? targets : [],
    disposition: 'deferred',
    deferralReason: blocking ? DEFERRAL_REASONS.QUEUED : DEFERRAL_REASONS.ADVISORY,
    firstRaisedOnIteration: iteration,
    lastRaisedOnIteration: iteration,
  };
}

/** Triage one validation pass's recommendations. Empty texts are dropped. */
export function triageRecommendations(args: {
  recommendations: ReadonlyArray<RawRecommendation>;
  files: ReadonlyArray<GeneratedFile>;
  iteration: number;
}): TriagedRecommendation[] {
  return args.recommendations
    .map(raw => triageOne(raw, args.files, args.iteration))
    .filter(entry => entry.text !== '');
}

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function contentTokens(text: string): Set<string> {
  return new Set(normalizeText(text).split(' ').filter(t => t.length > 2));
}

/**
 * Same-recommendation test across iterations: exact after normalization, or high
 * token overlap so a reworded restatement still matches the earlier entry. A
 * restatement must NOT read as "applied".
 */
export function similarText(a: string, b: string): boolean {
  if (normalizeText(a) === normalizeText(b)) {
    return true;
  }
  const ta = contentTokens(a);
  const tb = contentTokens(b);
  if (ta.size === 0 || tb.size === 0) {
    return false;
  }
  let shared = 0;
  for (const token of ta) {
    if (tb.has(token)) {
      shared += 1;
    }
  }
  return shared / Math.min(ta.size, tb.size) >= 0.7;
}

function wasEscalated(text: string, escalatedTexts: ReadonlyArray<string>): boolean {
  return escalatedTexts.some(t => similarText(t, text));
}

function reasonForStillRaised(
  severity: RecommendationSeverity,
  prior: TriagedRecommendation,
  escalatedTexts: ReadonlyArray<string>,
): string {
  if (severity === 'advisory') {
    return DEFERRAL_REASONS.ADVISORY;
  }
  if (wasEscalated(prior.text, escalatedTexts)) {
    return DEFERRAL_REASONS.STILL_RAISED;
  }
  return prior.deferralReason ?? DEFERRAL_REASONS.QUEUED;
}

function stillRaised(
  prior: TriagedRecommendation,
  match: TriagedRecommendation,
  iteration: number,
  escalatedTexts: ReadonlyArray<string>,
): TriagedRecommendation {
  const blocking = prior.severity === 'blocking' || match.severity === 'blocking';
  const severity: RecommendationSeverity = blocking ? 'blocking' : 'advisory';
  return {
    ...prior,
    severity,
    signal: prior.severity === 'blocking' ? prior.signal : match.signal,
    targetFiles: match.targetFiles.length > 0 ? match.targetFiles : prior.targetFiles,
    disposition: 'deferred',
    deferralReason: reasonForStillRaised(severity, prior, escalatedTexts),
    evidence: undefined,
    lastRaisedOnIteration: iteration,
  };
}

function noLongerRaised(
  prior: TriagedRecommendation,
  escalatedTexts: ReadonlyArray<string>,
): TriagedRecommendation {
  if (prior.disposition === 'applied') {
    return prior;
  }
  if (wasEscalated(prior.text, escalatedTexts)) {
    return {
      ...prior,
      disposition: 'applied',
      deferralReason: undefined,
      evidence:
        `fed back to code generation on iteration ${prior.lastRaisedOnIteration} and not re-raised ` +
        'by the following validation pass',
    };
  }
  // Disappeared without any refinement pass targeting it — that is validator
  // noise, not evidence of a fix. Say so rather than claiming it was applied.
  return { ...prior, disposition: 'deferred', deferralReason: DEFERRAL_REASONS.UNVERIFIED };
}

/**
 * Fold this pass's triage into the running ledger. An entry that stops being
 * raised counts as APPLIED only if it was actually fed back to code generation;
 * otherwise it stays deferred as UNVERIFIED.
 */
export function mergeRecommendationLedger(args: {
  previous: ReadonlyArray<TriagedRecommendation>;
  current: ReadonlyArray<TriagedRecommendation>;
  iteration: number;
  /** Texts fed back to code generation on the escalation pass. */
  escalatedTexts: ReadonlyArray<string>;
}): TriagedRecommendation[] {
  const carried = args.previous.map((prior) => {
    const match = args.current.find(c => similarText(c.text, prior.text));
    if (match) {
      return stillRaised(prior, match, args.iteration, args.escalatedTexts);
    }
    return noLongerRaised(prior, args.escalatedTexts);
  });
  const fresh = args.current.filter(c => !args.previous.some(p => similarText(p.text, c.text)));
  return [...carried, ...fresh];
}

export interface EscalationPlan {
  escalate: boolean;
  /** Blocking texts to feed back (capped by MAX_ESCALATED). */
  recommendations: string[];
  /** Files to mark failing so selective regeneration has real work to do. */
  files: string[];
  /** When escalate is false: the reason to stamp on every open blocking entry. */
  blockedReason?: string;
}

/** Prompt hygiene: one pass carries at most this many recommendation texts. */
export const MAX_ESCALATED = 10;

function firstBlocker(
  args: { iteration: number; maxIterations: number; alreadyEscalated: boolean; blockedReason?: string },
  open: ReadonlyArray<TriagedRecommendation>,
): string | undefined {
  if (args.blockedReason) {
    return args.blockedReason;
  }
  if (args.alreadyEscalated) {
    return DEFERRAL_REASONS.ONE_PASS_SPENT;
  }
  if (args.iteration >= args.maxIterations) {
    return DEFERRAL_REASONS.BUDGET_SPENT;
  }
  if (open.every(r => r.targetFiles.length === 0)) {
    return DEFERRAL_REASONS.NO_TARGET_FILE;
  }
  return undefined;
}

/**
 * Decide whether the open blocking items buy one more refinement pass. Pure, so
 * the loop-safety argument is unit-testable: it refuses when the single pass is
 * already spent, when the iteration budget is spent, when the path's verdict
 * belongs to someone else (XLSForm apply / execute-no-op), or when no file could
 * be mapped — and every refusal carries the reason the ledger will record.
 */
export function planRecommendationEscalation(args: {
  ledger: ReadonlyArray<TriagedRecommendation>;
  iteration: number;
  maxIterations: number;
  alreadyEscalated: boolean;
  /** A reason escalation is impossible on this path, if the caller knows one. */
  blockedReason?: string;
}): EscalationPlan {
  const open = args.ledger.filter(r => r.severity === 'blocking' && r.disposition === 'deferred');
  if (open.length === 0) {
    return { escalate: false, recommendations: [], files: [] };
  }
  const blocked = firstBlocker(args, open);
  if (blocked) {
    return { escalate: false, recommendations: [], files: [], blockedReason: blocked };
  }
  return {
    escalate: true,
    recommendations: open.slice(0, MAX_ESCALATED).map(r => r.text),
    files: [...new Set(open.flatMap(r => r.targetFiles))],
  };
}

/**
 * Stamp the escalation decision on every open blocking entry, so the ledger
 * always states WHY an item is still deferred. STILL_RAISED is never overwritten
 * — "we tried and it persists" outranks "we ran out of passes".
 */
export function applyEscalationToLedger(
  ledger: ReadonlyArray<TriagedRecommendation>,
  plan: EscalationPlan,
): TriagedRecommendation[] {
  return ledger.map((entry) => {
    if (entry.disposition !== 'deferred' || entry.severity !== 'blocking') {
      return entry;
    }
    if (entry.deferralReason === DEFERRAL_REASONS.STILL_RAISED) {
      return entry;
    }
    if (plan.escalate) {
      return { ...entry, deferralReason: DEFERRAL_REASONS.QUEUED };
    }
    return {
      ...entry,
      deferralReason: plan.blockedReason ?? entry.deferralReason ?? DEFERRAL_REASONS.QUEUED,
    };
  });
}

/**
 * Build the perFileFeedback the escalation pass needs.
 *
 * MUST cover EVERY generated file. The claude-code-cli module rolls the
 * workspace back after each pass, so only files listed as PASSING are carried
 * forward (buildSelectiveRegenInput → mergeSelectiveRegen); a feedback array
 * that omits a file would silently drop it from the next iteration's result set.
 * Marking the target files failing is also what makes the extra pass non-vacuous
 * — an all-passing set makes selective regeneration regenerate nothing.
 */
export function buildEscalationPerFileFeedback(args: {
  files: ReadonlyArray<GeneratedFile>;
  existing?: ReadonlyArray<FileValidationFeedback>;
  failingPaths: ReadonlyArray<string>;
  issues: ReadonlyArray<string>;
}): FileValidationFeedback[] {
  const byPath = new Map<string, FileValidationFeedback>();
  for (const file of args.files) {
    byPath.set(file.relativePath, { filePath: file.relativePath, passed: true, issues: [] });
  }
  for (const entry of args.existing ?? []) {
    byPath.set(entry.filePath, { ...entry, issues: [...entry.issues] });
  }
  for (const filePath of args.failingPaths) {
    const current = byPath.get(filePath) ?? { filePath, passed: true, issues: [] };
    byPath.set(filePath, {
      filePath,
      passed: false,
      issues: [...current.issues, ...args.issues],
    });
  }
  return [...byPath.values()];
}

/**
 * Fold the blocking recommendations into the retry feedback. Above the score
 * threshold deriveValidationFeedback returns undefined, which is precisely why
 * m4's six recommendations never reached code generation.
 */
export function withBlockingRecommendations(
  base: string | undefined,
  recommendations: ReadonlyArray<string>,
): string {
  const section = [
    'BLOCKING validation recommendations — each names a correctness defect and MUST be addressed:',
    ...recommendations.map((r, i) => `${i + 1}. ${r}`),
    '',
    'Change the code so the validator stops raising these. Do not restate them as comments or TODOs.',
  ].join('\n');
  if (base && base.trim() !== '') {
    return `${base}\n\n${section}`;
  }
  return section;
}

export interface LedgerCounts {
  total: number;
  applied: number;
  deferredBlocking: number;
  deferredAdvisory: number;
}

/** Counts for the log line, the HC2 banner header, and the PR-body summary. */
export function summarizeLedger(ledger: ReadonlyArray<TriagedRecommendation>): LedgerCounts {
  const deferred = ledger.filter(r => r.disposition === 'deferred');
  return {
    total: ledger.length,
    applied: ledger.filter(r => r.disposition === 'applied').length,
    deferredBlocking: deferred.filter(r => r.severity === 'blocking').length,
    deferredAdvisory: deferred.filter(r => r.severity === 'advisory').length,
  };
}
