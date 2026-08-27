/**
 * HC5 — the scope-widening human gate (m4).
 *
 * Observed on live ticket m4: the fix replaced a length-inequality test with a set
 * difference, which made `totalVaccinesDueByAge` the arbiter of the defaulter flag.
 * That function has three holes (no `opv0` in the birth entry, no `yellow_fever`
 * rule at all, measles keyed off weeks where the forms guard on months), so the fix
 * traded false POSITIVES for clinical false NEGATIVES. The validator named all
 * three. The score was 80% — above REFINEMENT_THRESHOLD — so the loop ended and the
 * recommendations were only RECORDED (see utils/recommendation-triage).
 *
 * The ticket had already forbidden exactly those edits: "Surgical: predicate
 * replacement only; do not change vaccine schedules, `countTotalVaccinesByAge`, or
 * form logic." The run was therefore unresolvable by construction — the only
 * correct fix needed a change the ticket forbade — and nothing in the pipeline
 * could say so out loud.
 *
 * This module is the deterministic half of the gate that says so. It is PURE:
 *  - NO LLM call anywhere. A gate that needs a model to decide whether the model's
 *    own advice contradicts the ticket is not a gate.
 *  - No I/O: the caller owns printing and prompting.
 * Every verdict is reproducible from the ledger, the ticket and the QA result, and
 * unit-testable without a graph.
 */

import { IssueTemplate, QaResult, TriagedRecommendation } from '../types';
import { newTier2Failures, tier2BaselineLine, tier2TailExcerpt } from './cht-conf-tier2';
import { similarText } from './recommendation-triage';

const RULE = '─'.repeat(70);

/** Cap on entries per panel section — the gate must fit one screen. */
const MAX_PANEL_ITEMS = 10;

/** Lines of tier-2 output the panel echoes (cause-preferring, see tier2TailExcerpt). */
const TIER2_PANEL_LINES = 8;

/** Prompt hygiene: at most this many recommendations become requirements. */
export const MAX_PROMOTED = 6;

/**
 * Coverage a recommendation must reach over a protected surface's words to count
 * as a conflict.
 *
 * Calibrated on m4, whose constraint protects `countTotalVaccinesByAge`
 * ({count,total,vaccine,age}):
 *  - "add opv0 to the birth entry of totalVaccinesDueByAge" shares
 *    {total,vaccine,age} = 0.75 → CONFLICT (correct: it edits the schedule table);
 *  - "replace the length inequality with vaccinesNotReceivedByAge(...)" — the
 *    change the ticket REQUIRES — shares {vaccine,age} = 0.50 → no conflict.
 * Anything between those two numbers would either miss the real conflict or veto
 * the required fix, so the threshold sits between them.
 */
export const PROTECTED_COVERAGE_THRESHOLD = 2 / 3;

const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'by', 'at', 'from', 'as',
  'is', 'are', 'be', 'was', 'were', 'do', 'does', 'not', 'no', 'only', 'any', 'all', 'it', 'its',
  'this', 'that', 'these', 'those', 'you', 'your', 'must', 'should', 'can', 'may', 'if', 'when',
  'then', 'than', 'so', 'but', 'also', 'into', 'onto', 'via', 'per', 'use', 'used', 'using',
  'make', 'made', 'get', 'got', 'set', 'sets', 'still', 'same', 'other', 'more', 'less', 'one',
  'two', 'both', 'each', 'every', 'how', 'unchanged', 'intact', 'untouched', 'alone', 'existing',
  'current',
]);

/** Words too generic to carry a conflict on their own. */
const GENERIC_WORDS = new Set([
  'code', 'logic', 'file', 'config', 'configuration', 'test', 'data', 'value', 'field', 'change',
  'rule', 'check', 'entry', 'path', 'line', 'case',
]);

/** Markers that introduce a PROHIBITION — the clause after one names a protected surface. */
const PROHIBITION_RE =
  /\b(?:do not|don't|must not|never|without (?:changing|touching|modifying|editing)|no changes to|avoid (?:changing|touching|modifying)|leave|preserve|keep)\b/i;

/** Markers that declare a LIMITED SCOPE. Any blocking deferral widens such a ticket. */
const SCOPE_LIMIT_RE =
  /\b(?:surgical|minimal|smallest|only|no other changes|do not refactor|scoped? (?:to|:)|in[- ]scope|out of scope)\b/i;

/** Edit verbs stripped off the front of a prohibition clause ("change X" → "X"). */
const LEAD_VERB_RE =
  /^\s*(?:change|changing|modify|modifying|touch|touching|edit|editing|alter|altering|rename|renaming|refactor|refactoring|remove|removing|add|adding|introduce|introducing|rewrite|rewriting|break|breaking)\b/i;

const PATH_RE = /\b[\w./-]*\w\.(?:js|jsx|ts|tsx|json|xml|xlsx|properties)\b/g;
/** Directory prefixes of at least two segments, so a bare `test/` is not "protected". */
const DIR_RE = /\b(?:[\w.-]+\/){2,}/g;

/** Split an identifier into lowercase words: countTotalVaccinesByAge → count total vaccines by age. */
function splitIdentifier(token: string): string[] {
  return token
    .replace(/[^A-Za-z0-9_$]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

/** Crude singularization — enough to make `vaccines`/`vaccine` and `schedules`/`schedule` match. */
function singular(word: string): string {
  if (word.length > 3 && word.endsWith('ies')) {
    return `${word.slice(0, -3)}y`;
  }
  if (word.length > 3 && word.endsWith('ses')) {
    return word.slice(0, -2);
  }
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) {
    return word.slice(0, -1);
  }
  return word;
}

/** The comparable word set of a phrase: identifiers split, singularized, stopwords dropped. */
export function significantWords(text: string): Set<string> {
  const words = new Set<string>();
  for (const raw of text.split(/[^A-Za-z0-9_$]+/)) {
    if (raw === '') {
      continue;
    }
    for (const part of splitIdentifier(raw)) {
      const word = singular(part);
      if (word.length >= 3 && !STOPWORDS.has(word)) {
        words.add(word);
      }
    }
  }
  return words;
}

/** A surface a constraint forbids touching, plus the words that identify it. */
export interface ProtectedSurface {
  label: string;
  words: Set<string>;
}

/** Everything the gate deterministically knows about one ticket constraint. */
export interface ConstraintFacts {
  /** 1-based, as displayed to the human. */
  index: number;
  text: string;
  prohibitive: boolean;
  scopeLimiting: boolean;
  protectedSurfaces: ProtectedSurface[];
  protectedPaths: string[];
}

function protectedSurfaces(constraint: string): ProtectedSurface[] {
  const marker = PROHIBITION_RE.exec(constraint);
  if (!marker) {
    return [];
  }
  const clause = constraint
    .slice(marker.index + marker[0].length)
    .split(/[;.](?:\s|$)/)[0]
    .replace(LEAD_VERB_RE, '');
  return clause
    .split(/,| or | and /i)
    .map(part => part.replace(/[`'"]/g, '').trim())
    .filter(part => part.length > 2)
    .map(label => ({ label, words: significantWords(label) }))
    .filter(surface => surface.words.size > 0);
}

function protectedPaths(constraint: string): string[] {
  const files = constraint.match(PATH_RE) ?? [];
  const dirs = (constraint.match(DIR_RE) ?? []).filter(
    dir => !files.some(file => file.startsWith(dir)),
  );
  return [...new Set([...files, ...dirs])];
}

/** Parse one constraint. Pure and cheap; safe to call on every render. */
export function readConstraint(text: string, index: number): ConstraintFacts {
  return {
    index,
    text,
    prohibitive: PROHIBITION_RE.test(text),
    scopeLimiting: SCOPE_LIMIT_RE.test(text),
    protectedSurfaces: protectedSurfaces(text),
    protectedPaths: protectedPaths(text),
  };
}

export function readConstraints(ticket: IssueTemplate): ConstraintFacts[] {
  return (ticket.issue.constraints ?? []).map((text, i) => readConstraint(text, i + 1));
}

export type ConflictKind = 'protected-symbol' | 'protected-file';

/** One deterministic collision between a recommendation and a ticket constraint. */
export interface ConstraintConflict {
  recommendation: string;
  constraintIndex: number;
  constraint: string;
  kind: ConflictKind;
  /** The protected surface (identifier, phrase or path) the recommendation collides with. */
  surface: string;
  /** The evidence, printed verbatim at the gate so the human can overrule it. */
  evidence: string;
}

function symbolConflict(
  rec: TriagedRecommendation,
  constraint: ConstraintFacts,
  surface: ProtectedSurface,
): ConstraintConflict | undefined {
  const recWords = significantWords(rec.text);
  const shared = [...surface.words].filter(word => recWords.has(word));
  const coverage = shared.length / surface.words.size;
  if (coverage < PROTECTED_COVERAGE_THRESHOLD || !shared.some(word => !GENERIC_WORDS.has(word))) {
    return undefined;
  }
  return {
    recommendation: rec.text,
    constraintIndex: constraint.index,
    constraint: constraint.text,
    kind: 'protected-symbol',
    surface: surface.label,
    evidence:
      `names ${shared.join('/')} — ${shared.length} of ${surface.words.size} word(s) of the ` +
      `protected surface "${surface.label}" (${Math.round(coverage * 100)}%)`,
  };
}

function mentionsPath(rec: TriagedRecommendation, candidate: string): boolean {
  if (rec.text.includes(candidate)) {
    return true;
  }
  return [...rec.anchors, ...rec.targetFiles].some(
    value => value.includes(candidate) || candidate.includes(value),
  );
}

/**
 * Every collision between the open blocking recommendations and the ticket's
 * constraints. Deterministic and LLM-free; over-reporting is preferred to
 * under-reporting because the output feeds a HUMAN who can overrule it, and each
 * line carries the evidence that produced it.
 */
export function detectConflicts(args: {
  recommendations: ReadonlyArray<TriagedRecommendation>;
  constraints: ReadonlyArray<ConstraintFacts>;
}): ConstraintConflict[] {
  const conflicts: ConstraintConflict[] = [];
  for (const rec of args.recommendations) {
    for (const constraint of args.constraints) {
      for (const surface of constraint.protectedSurfaces) {
        const hit = symbolConflict(rec, constraint, surface);
        if (hit) {
          conflicts.push(hit);
        }
      }
      for (const candidate of constraint.protectedPaths) {
        if (mentionsPath(rec, candidate)) {
          conflicts.push({
            recommendation: rec.text,
            constraintIndex: constraint.index,
            constraint: constraint.text,
            kind: 'protected-file',
            surface: candidate,
            evidence: `the constraint declares ${candidate} a protected regression surface`,
          });
        }
      }
    }
  }
  return conflicts;
}

/** Tier-2's verdict, ATTRIBUTED against the pre-fix baseline — never a raw count. */
export interface Tier2Attribution {
  /** tier-2 ran and a spec assertion failed. */
  failed: boolean;
  /** Failures new in this change; undefined when the baseline could not attribute. */
  newFailures?: number;
  /** Failed, but attribution was impossible — treated as POSSIBLY new, never as none. */
  unattributed: boolean;
  /** The attribution sentence (tier2BaselineLine); '' when tier-2 did not fail. */
  line: string;
  /** A bounded, cause-preferring excerpt of the failing output; '' when not applicable. */
  excerpt: string;
}

export function attributeTier2(qa: QaResult | undefined): Tier2Attribution {
  const tier2 = qa?.tier2;
  if (!tier2?.ran || tier2.passed !== false) {
    return { failed: false, unattributed: false, line: '', excerpt: '' };
  }
  const fresh = newTier2Failures(tier2);
  return {
    failed: true,
    ...(fresh !== undefined ? { newFailures: fresh } : {}),
    unattributed: fresh === undefined,
    line: tier2BaselineLine(tier2),
    excerpt: tier2TailExcerpt(tier2.outputTail, TIER2_PANEL_LINES),
  };
}

/** Everything the gate shows and decides from. */
export interface ScopeGateFindings {
  /** Open blocking deferrals — the items the fix does NOT do. */
  open: TriagedRecommendation[];
  constraints: ConstraintFacts[];
  conflicts: ConstraintConflict[];
  /** Constraints declaring a limited scope, when there is something that widens it. */
  scopeLimited: ConstraintFacts[];
  tier2: Tier2Attribution;
  /** True when the gate has something to ask. */
  opens: boolean;
  /** The one-line "why this gate opened". */
  reason: string;
}

export function assessScope(args: {
  ticket: IssueTemplate;
  ledger: ReadonlyArray<TriagedRecommendation>;
  qa?: QaResult;
}): ScopeGateFindings {
  const open = args.ledger.filter(r => r.severity === 'blocking' && r.disposition === 'deferred');
  const constraints = readConstraints(args.ticket);
  const conflicts = detectConflicts({ recommendations: open, constraints });
  const scopeLimited = open.length > 0 ? constraints.filter(c => c.scopeLimiting) : [];
  const tier2 = attributeTier2(args.qa);
  const reasons: string[] = [];
  if (open.length > 0) {
    reasons.push(`${open.length} correctness recommendation(s) recorded and NOT applied`);
  }
  if ((tier2.newFailures ?? 0) > 0) {
    reasons.push(`tier-2 reports ${tier2.newFailures} NEW failure(s) against the pre-fix baseline`);
  }
  if (tier2.unattributed) {
    reasons.push('tier-2 failed and no baseline could attribute it (treated as possibly new)');
  }
  return {
    open,
    constraints,
    conflicts,
    scopeLimited,
    tier2,
    opens: reasons.length > 0,
    reason: reasons.join('; '),
  };
}

/**
 * Deferral reasons that mean "recorded from the mid-loop LLM reviewer, not
 * acted on" — i.e. the item was written BEFORE the deterministic apply, QA and
 * test verification produced their verdicts. Such items routinely claim the
 * fix "was not implemented" because the reviewer only ever saw the raw
 * code-gen output (on the XLSForm path: the JSON descriptor). Observed on m5,
 * m8, m7 and m4 — every run's most confusing HC5 lines were these.
 */
const PRE_VERDICT_DEFERRAL_RE =
  /deterministic XLSForm apply owns the verdict|recommendation-driven refinement is off|recorded for human review/i;

function appendDeferred(lines: string[], findings: ScopeGateFindings): void {
  if (findings.open.length === 0) {
    return;
  }
  lines.push('❗ DEFERRED ITEMS — reviewer claims recorded during development, NOT acted on', RULE);
  findings.open.slice(0, MAX_PANEL_ITEMS).forEach((rec, i) => {
    lines.push(` ${i + 1}. ${rec.text}`);
    lines.push(`      why deferred: ${rec.deferralReason ?? '(no reason recorded)'}`);
    if (PRE_VERDICT_DEFERRAL_RE.test(rec.deferralReason ?? '')) {
      lines.push(
        '      ⓘ written by the PRE-VERDICT reviewer (it never saw the apply/QA results above) —',
        '        judge it against the machine evidence; "the fix was not implemented" claims are',
        '        superseded by a verified apply.',
      );
    }
    if (rec.targetFiles.length > 0) {
      lines.push(`      files: ${rec.targetFiles.join(', ')}`);
    }
    for (const conflict of findings.conflicts.filter(c => c.recommendation === rec.text)) {
      lines.push(
        `      ⚠ CONFLICTS WITH CONSTRAINT ${conflict.constraintIndex} (${conflict.kind}): ${conflict.surface}`,
      );
      lines.push(`         constraint: ${conflict.constraint}`);
      lines.push(`         evidence:   ${conflict.evidence}`);
    }
  });
  if (findings.open.length > MAX_PANEL_ITEMS) {
    lines.push(`  ... and ${findings.open.length - MAX_PANEL_ITEMS} more`);
  }
  lines.push('');
}

function appendScopeLimited(lines: string[], findings: ScopeGateFindings): void {
  if (findings.scopeLimited.length === 0) {
    return;
  }
  lines.push('🔒 THE TICKET DECLARES A LIMITED SCOPE', RULE);
  for (const constraint of findings.scopeLimited) {
    lines.push(`  Constraint ${constraint.index}: ${constraint.text}`);
  }
  lines.push(
    `  All ${findings.open.length} item(s) above widen it. A widened pass will refuse the edit`,
    '  unless the constraint is relaxed for that pass.',
    '',
  );
}

function appendTier2(lines: string[], findings: ScopeGateFindings): void {
  if (!findings.tier2.failed) {
    return;
  }
  lines.push('🔬 TIER-2 FAILURES (attributed against the pre-fix baseline)', RULE);
  lines.push(`  ${findings.tier2.line}`);
  lines.push(findings.tier2.excerpt, '');
}

/**
 * The whole gate as one screen. Printing is the caller's job.
 *
 * `machineEvidence` — deterministic verdicts produced AFTER the reviewer wrote
 * its recommendations (apply verified, QA red→green, tier-2, spec
 * verification). Rendered first because it OUTRANKS reviewer prose: the m5–m4
 * runs each opened this gate with items claiming the fix "was not
 * implemented" minutes after QA proved it deployed, and the operator had no
 * way to see that the claims predated the proof.
 */
export function renderScopeGatePanel(
  findings: ScopeGateFindings,
  machineEvidence?: ReadonlyArray<string>,
): string {
  const lines: string[] = [
    '',
    '╔════════════════════════════════════════════════════════════════╗',
    '║        HUMAN VALIDATION CHECKPOINT #5 — SCOPE OF THE FIX       ║',
    '╚════════════════════════════════════════════════════════════════╝',
    '',
    `Why this gate opened: ${findings.reason}`,
    '',
  ];
  if (machineEvidence && machineEvidence.length > 0) {
    lines.push(
      '⚙️  MACHINE EVIDENCE (deterministic verdicts — these outrank reviewer prose)',
      RULE,
      ...machineEvidence.map((line) => `  ✓ ${line}`),
      '',
      '  The items below were written by the mid-loop LLM reviewer BEFORE these verdicts',
      '  existed — it reviews the raw code-gen output and never sees the apply, QA or test',
      '  runs. Judge each item against the evidence above: some are already answered by it,',
      '  some are real follow-ups. You are the classifier.',
      '',
    );
  }
  appendDeferred(lines, findings);
  appendScopeLimited(lines, findings);
  appendTier2(lines, findings);
  lines.push(
    'WHAT THIS MEANS',
    RULE,
    '  These are recorded reviewer claims, not verdicts. Some may already be answered by',
    '  the machine evidence (the reviewer cannot see later phases); others are genuine',
    '  gaps or follow-ups. `accept` ships them into the PR body as a checklist for human',
    '  review — it does NOT discard them, and annotating them there is the normal',
    '  workflow. `abandon` writes no PR bundle.',
    '',
  );
  return lines.join('\n');
}

export const SCOPE_GATE_CHOICES = ['accept', 'widen', 'widen-relax', 'abandon'] as const;
export type ScopeGateChoice = typeof SCOPE_GATE_CHOICES[number];

export const SCOPE_GATE_OPTIONS: Record<ScopeGateChoice, string> = {
  accept: 'accept — ship as-is; every deferred item above rides into the PR body as a recorded gap',
  widen: 'widen — re-run development with the items above promoted to REQUIREMENTS, constraints intact',
  'widen-relax': 'widen-relax — same, and relax the conflicting constraint(s) for that pass only',
  abandon: 'abandon — stop here; write no PR bundle',
};

/**
 * The options to offer. `widen`/`widen-relax` appear only when they mean something:
 * widening needs a recommendation to promote, and relaxing needs a conflict.
 */
export function scopeGateOptions(findings: ScopeGateFindings): string[] {
  // DEMO SAFETY CUT — restore the widen branches after the demo run.
  //
  // `widen`/`widen-relax` each fire a second full executeDevelopmentWorkflow: a
  // fresh LLM plan + execute, a second HC2 approval prompt, and a second QA pass
  // against the LIVE instance, on iteration-budget arithmetic that has never
  // executed once. executeFullWorkflow is covered by no test in the suite, so
  // that path would first run in front of an audience. The panel, the conflict
  // findings and the recorded decision — the parts that would have caught m4 —
  // all work without it.
  //
  // To restore: delete this early return. `findings` then drives the branches
  // below exactly as designed, and scope-gate.spec.ts's widen cases cover them.
  void findings;
  return [SCOPE_GATE_OPTIONS.accept, SCOPE_GATE_OPTIONS.abandon];
}

/** Map an askWithOptions answer back to a choice; unknown answers fail SAFE (accept). */
export function parseScopeGateChoice(answer: string): ScopeGateChoice {
  const head = answer.trim().split(/\s/)[0];
  return (SCOPE_GATE_CHOICES as ReadonlyArray<string>).includes(head)
    ? (head as ScopeGateChoice)
    : 'accept';
}

/** The recorded outcome of the gate. Rides on FullWorkflowResult and into the PR body. */
export interface ScopeGateDecision {
  choice: ScopeGateChoice;
  /** Recommendation texts promoted to requirements (empty unless widening). */
  promoted: string[];
  /** Constraint texts relaxed for the widened pass (empty unless 'widen-relax'). */
  relaxedConstraints: string[];
  conflicts: ConstraintConflict[];
  newTier2Failures?: number;
  tier2Unattributed: boolean;
  /** Set when the gate did NOT prompt, naming why (auto-approve, no TTY). */
  autoResolved?: string;
  timestamp: string;
}

export function promotableRecommendations(findings: ScopeGateFindings): string[] {
  return findings.open.slice(0, MAX_PROMOTED).map(rec => rec.text);
}

export function conflictingConstraints(findings: ScopeGateFindings): string[] {
  return [...new Set(findings.conflicts.map(conflict => conflict.constraint))];
}

export function buildScopeGateDecision(args: {
  findings: ScopeGateFindings;
  choice: ScopeGateChoice;
  autoResolved?: string;
}): ScopeGateDecision {
  const { findings, choice } = args;
  const widening = choice === 'widen' || choice === 'widen-relax';
  return {
    choice,
    promoted: widening ? promotableRecommendations(findings) : [],
    relaxedConstraints: choice === 'widen-relax' ? conflictingConstraints(findings) : [],
    conflicts: findings.conflicts,
    ...(findings.tier2.newFailures !== undefined
      ? { newTier2Failures: findings.tier2.newFailures }
      : {}),
    tier2Unattributed: findings.tier2.unattributed,
    ...(args.autoResolved ? { autoResolved: args.autoResolved } : {}),
    timestamp: new Date().toISOString(),
  };
}

function relaxConstraint(text: string): string {
  return (
    `${text} [RELAXED AT HUMAN REVIEW (HC5): you MAY change what this protects, but ONLY as far ` +
    'as a promoted requirement demands, and nothing else it protects.]'
  );
}

/**
 * The ticket the widened pass runs against: promoted recommendations appended to
 * `requirements` (so the planner, the executor, the per-file prompts AND the
 * validator all see them), and the relaxed constraints rewritten in place.
 *
 * A derived copy, never a mutation: the ORIGINAL ticket still drives QA, whose
 * qaSpecs and reproduce/verify assertions belong to the issue as filed.
 */
export function buildWidenedTicket(
  ticket: IssueTemplate,
  decision: ScopeGateDecision,
): IssueTemplate {
  const relaxed = new Set(decision.relaxedConstraints);
  return {
    ...ticket,
    issue: {
      ...ticket.issue,
      requirements: [
        ...ticket.issue.requirements,
        ...decision.promoted.map(
          text => `${text} [PROMOTED AT HUMAN REVIEW (HC5) from a deferred validation recommendation]`,
        ),
      ],
      constraints: (ticket.issue.constraints ?? []).map(
        text => (relaxed.has(text) ? relaxConstraint(text) : text),
      ),
    },
  };
}

/**
 * The widened pass's `additionalContext`. It becomes `validationFeedback`, which
 * the plan prompt renders as "Validation Feedback from Previous Iteration" and the
 * execute prompt as the FEEDBACK block — the two places code generation actually
 * reads on a retry.
 */
export function buildWidenBrief(decision: ScopeGateDecision): string {
  const parts: string[] = [
    'A human reviewed the previous pass at HC5 (the scope gate) and WIDENED this ticket.',
    '',
    'These were raised by validation, were NOT implemented, and are now REQUIREMENTS (they also',
    "appear in this ticket's Requirements list):",
    ...decision.promoted.map((text, i) => `${i + 1}. ${text}`),
    '',
  ];
  if (decision.relaxedConstraints.length > 0) {
    parts.push('The reviewer RELAXED these constraints FOR THIS PASS ONLY:');
    decision.relaxedConstraints.forEach((text, i) => {
      parts.push(`${i + 1}. ${text}`);
      parts.push(
        '   → You MAY now change what it protects, but ONLY as far as a promoted requirement above',
        '     demands. Everything else it protects stays untouched.',
      );
    });
  } else {
    parts.push(
      'NO constraint was relaxed. The reviewer wants the promoted requirements satisfied WITHOUT',
      'crossing any constraint. If that is impossible, report it per the last rule below rather',
      'than crossing one.',
    );
  }
  parts.push(
    '',
    'Rules for this pass:',
    '- This is an EXTENSION of the previous fix, not a rewrite. Everything the previous pass got',
    '  right stays exactly as it is; keep the same files and the same approach.',
    '- Implement each promoted requirement at the location it names. Do NOT restate it as a comment,',
    '  a TODO, or a defensive no-op.',
    '- Every constraint NOT marked RELAXED is still binding.',
    '- If a promoted requirement still cannot be implemented without violating a binding constraint,',
    '  implement NOTHING for it and say so in your summary as',
    '  "NOT DONE (constraint N): <what you could not change, and what stays broken because of it>".',
    '  A silent partial implementation is worse than an honest refusal.',
  );
  return parts.join('\n');
}

export const HC5_ACCEPTED_NOTE =
  'ACCEPTED BY A HUMAN AT HC5 (scope gate): shipped as a known, recorded gap in this change';
export const HC5_PROMOTED_NOTE =
  'PROMOTED TO A REQUIREMENT BY A HUMAN AT HC5 and STILL RAISED after the widened pass';

/**
 * Record the human's decision on the ledger the PR body renders, by APPENDING to
 * `deferralReason` (the machine reason stays — "a human accepted this" is extra
 * provenance, not a replacement for why the loop deferred it).
 */
export function stampHumanDecision(
  ledger: ReadonlyArray<TriagedRecommendation>,
  decision: ScopeGateDecision | undefined,
): TriagedRecommendation[] {
  if (!decision || decision.choice === 'abandon') {
    return [...ledger];
  }
  const note = decision.choice === 'accept' ? HC5_ACCEPTED_NOTE : HC5_PROMOTED_NOTE;
  return ledger.map((entry) => {
    if (entry.disposition !== 'deferred' || entry.severity !== 'blocking') {
      return entry;
    }
    if (decision.choice !== 'accept' && !decision.promoted.some(p => similarText(p, entry.text))) {
      return entry;
    }
    const base = entry.deferralReason ?? '';
    return { ...entry, deferralReason: base === '' ? note : `${base} — ${note}` };
  });
}

/**
 * The abandon banner. HC2 already wrote the fix into the config mount, so telling
 * the operator exactly how to revert it is part of abandoning honestly — otherwise
 * the next ticket inherits a change nobody accepted.
 */
export function renderScopeAbandonBanner(
  filesWritten: ReadonlyArray<string>,
  configRoot?: string,
): string {
  const lines: string[] = [
    '',
    '🛑 ABANDONED AT HC5 — no PR bundle written',
    RULE,
    'A human judged this change unfit to raise: the deferred correctness items and/or the new',
    'tier-2 failures above are not acceptable, and widening the scope was declined.',
    '',
    'These files were already written to the config mount at HC2. Revert them, or the next run',
    'inherits them:',
    ...filesWritten.map(file => `  - ${file}`),
  ];
  if (configRoot && filesWritten.length > 0) {
    lines.push('', `  cd ${configRoot} && git checkout -- ${filesWritten.join(' ')}`);
  }
  lines.push(RULE, '');
  return lines.join('\n');
}
