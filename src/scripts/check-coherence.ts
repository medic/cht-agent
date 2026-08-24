/**
 * check-coherence.ts — Layer 3 of draft verification: does a draft contradict
 * ITSELF?
 *
 * Layers 1 and 2 both compare a draft to something outside it — the schema and
 * the corpus (verify-drafts), then the cht-core tree (ground-claims). Neither can
 * see the defect class that dominated the third review round: a draft whose
 * every individual sentence grounds, but whose sections disagree with each other.
 *
 * It arises mechanically. A grounding pass corrects the sections that assert
 * mechanism against code (title, summary, Root Cause, Solution, Code Patterns,
 * Testing) and leaves the interpretive ones (Problem, Design Choices, Domain
 * Rationale, Related Issues) asserting the story it just disproved. Both halves
 * then ground independently — `resources` exists, the scaffolding exists — while
 * the document as a whole tells two incompatible stories. The 10198 draft ended
 * up stating that template safety comes from `ng-if` attributes "not from
 * scaffolded keys" in its Solution, and that the controller "scaffolds the
 * minimum keys the template requires" in its Design Choices.
 *
 * That is worse than untidy: the interpretive sections are where the transferable
 * lesson lives, so the stale version is the one a consuming agent reuses.
 *
 * An LLM is the right tool for finding it and the wrong tool for being trusted
 * about it, so the same split as ground-claims applies: the model may only
 * IDENTIFY candidate pairs and must quote both sides verbatim; this script then
 * verifies mechanically that each quote really occurs in the draft and drops any
 * pair that does not.
 *
 * Be precise about what that gate does and does not buy. It kills a FABRICATED
 * QUOTE — the model cannot invent a sentence and attribute it to the file. It
 * does NOT establish that the two real quotes actually contradict each other;
 * that judgement is still the model's, and a reader has to confirm it. Nor does
 * it establish which side is wrong, which needs the source tree.
 *
 * Two limits worth knowing before trusting a green run:
 *
 * - IT SAMPLES, IT DOES NOT EXHAUST. Three passes over the same 22 drafts
 *   returned 2, 3 and 2 pairs with different membership each time. A robust
 *   contradiction recurs; a subtle one may surface in one pass of three. Run it
 *   repeatedly and treat one clean pass as weak evidence, not proof.
 * - IT ONLY SEES ONE DRAFT. Two drafts contradicting each other, or a draft
 *   contradicting the corpus, are invisible here.
 *
 * Usage:
 *   LLM_PROVIDER=claude-cli npm run check-coherence -- --dir agent-memory
 *   ... -- --changed-only --base origin/main
 *   ... -- --limit 3
 *
 * Exit: 1 when any verified contradiction is found, 0 when clean.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';
import { REPO_ROOT } from './schema-utils';
import { createStructuredCliChain, isUsingCLIProvider } from '../llm/structured-cli';
import { DraftInput, loadDrafts } from './ground-claims';

/** One pair of statements in a single draft that cannot both be true. */
export interface Contradiction {
  /** Verbatim span from the draft. */
  quoteA: string;
  /** Verbatim span from the draft that the first cannot coexist with. */
  quoteB: string;
  /** Why they are incompatible, in one sentence. */
  why: string;
  /** 1-indexed lines, filled in by the verification step. */
  lineA?: number;
  lineB?: number;
}

export interface CoherenceReport {
  file: string;
  contradictions: Contradiction[];
  /** The model answered but its quotes did not occur in the draft. */
  discarded: number;
  error?: string;
}

/**
 * `why` is optional here on purpose. It is required of the MODEL by SHAPE below,
 * but zod is validating a response, not enforcing a contract: when the model
 * omitted `why` on one pair of one draft, a `.min(1)` threw and the whole
 * draft's coherence check was lost — a silent hole in a pass that still
 * reported itself complete. An absent rationale cannot withdraw a pair
 * (`whyWithdrawsPair('')` is false), so the pair survives as a finding and a
 * human sees it, which is the safe direction for a checker whose job is to
 * surface things.
 */
const schema = z.object({
  contradictions: z.array(z.object({
    quoteA: z.string().min(1),
    quoteB: z.string().min(1),
    why: z.string().optional(),
  })),
});

const SHAPE = `{"contradictions": [
  {"quoteA": "<verbatim sentence from the draft>", "quoteB": "<verbatim sentence it contradicts>", "why": "<one sentence>"}
]}`;

/**
 * Prompt for CONTRADICTION FINDING only. It never asks which side is correct —
 * that needs the source tree, which ground-claims owns. Asking for a fix here
 * would invite the model to invent one.
 */
export function coherencePrompt(draft: DraftInput): string {
  return `You are auditing one distilled engineering memory about the medic/cht-core repository for INTERNAL CONTRADICTIONS.

These documents are produced in passes. A later pass often corrects the technical sections (title, summary, Root Cause, Solution, Code Patterns, Testing) against the real source code, but forgets the interpretive sections (Problem, Design Choices, Domain Rationale, Related Issues), leaving them asserting the very thing that was just corrected. Your job is to find those leftovers.

Check the \`summary:\` field against EVERY section before anything else. It is one sentence written early, it is the most-read line in the document, and it is routinely left behind when a later pass corrects the body — two of the three contradictions found in the last audit had one side in \`summary:\`. Treat it as a section like any other, not as a preamble that cannot be wrong.

Report a pair ONLY when both sides make a factual assertion and they cannot both be true of the same pull request. Real examples of what to report:
- Solution says template safety comes from "ng-if" attributes "not from scaffolded keys", while Design Choices says the controller "scaffolds the minimum keys the template requires".
- Root Cause says the endpoint "was not untested" and lists its existing coverage, while Problem opens with "the endpoint had no test coverage".
- Testing says "neither fix is covered by existing tests", while Design Choices says "existing unit tests already covered the functionality".
- Root Cause says the bug is in outbound response parsing and that nothing inbound is involved, while Domain Rationale says the bug is in the inbound request-parsing code.
- The summary says failing tasks "sat in scheduled indefinitely", while Problem says such a task "was promoted to pending".
- The summary calls a set of typo fixes "typos in code comments", while Problem says one of them was in a log message and not a comment.

Do NOT report:
- Differences of emphasis, detail, abstraction or wording where both statements can be true at once.
- A summary being shorter or vaguer than the section it summarises.
- Anything you would need to read the cht-core source to adjudicate. You are only comparing the document against itself.
- Speculation about whether a statement is correct. Only whether two statements conflict.

For each pair, quote BOTH sides EXACTLY as they appear in the document, character for character, so a human can locate them. Do not paraphrase, do not fix typos, do not add ellipses. Quote a complete sentence or clause, not a whole section. If the document is self-consistent, return an empty array — that is the expected answer for most drafts.

DRAFT: ${draft.file}

${draft.raw}`;
}

/** Normalise whitespace so a quote spanning a wrapped line still matches. */
const flatten = (s: string): string => s.replace(/\s+/g, ' ').trim();

/**
 * The model sometimes files a pair and then uses `why` to say it is not one
 * ("These do not conflict."). Left in, such a pair is counted as a finding and
 * a human is sent to adjudicate two statements the model already cleared —
 * noise that looks exactly like a real, non-recurring contradiction.
 */
const SELF_NEGATING =
  /\b(?:do(?:es)?\s+not|don't|doesn't|no|not\s+a|aren't|are\s+not|is\s+not|isn't)\s+(?:\w+\s+){0,3}?(?:conflict|contradict|contradiction|contradictory|inconsistent|incompatible)/i;

/**
 * The other ways the model withdraws a pair. It rarely says "these do not
 * conflict" twice the same way, and each variant that slips through costs a
 * human an adjudication of something already cleared:
 *
 *   downgraded  "a minor framing difference rather than a factual conflict"
 *   compatible  "a difference of issue-vs-PR attribution, not necessarily
 *                exclusive" — the two statements are simply both true
 *
 * Both observed on contacts, one round apart, after SELF_NEGATING was already
 * in place. Keyed on the withdrawal phrase itself, not on the noun, because the
 * noun is exactly what these variants avoid naming.
 */
const DOWNGRADED =
  /\brather\s+than\s+(?:an?\s+)?(?:\w+\s+){0,3}?(?:conflict|contradiction|inconsistency|incompatibility)/i;

const NOT_EXCLUSIVE = /\bnot\s+(?:necessarily\s+|strictly\s+|mutually\s+)*exclusive\b/i;

/** True when the model's own rationale withdraws the pair it just filed. */
export const whyWithdrawsPair = (why: string): boolean =>
  SELF_NEGATING.test(why) || DOWNGRADED.test(why) || NOT_EXCLUSIVE.test(why)
  || /\b(?:both\s+can\s+be|can\s+both\s+be)\s+true\b/i.test(why)
  || /\b(?:these|they)\s+are\s+consistent\b/i.test(why)
  // "These are compatible, not contradictory — withdraw." Observed on
  // forms-and-reports after the three patterns above were already in place. The
  // model states the withdrawal as a bare imperative, so nothing in the sentence
  // negates a noun for SELF_NEGATING to catch, and "compatible" is asserted
  // rather than contrasted, which DOWNGRADED needs. Match the verdict itself.
  || /\bwithdraw\b/i.test(why)
  || /\b(?:are|is)\s+compatible\b/i.test(why);

/**
 * Keep only contradictions whose BOTH quotes really occur in the draft, and
 * locate them. This is the guard that makes an LLM finding safe to act on: a
 * fabricated quote is dropped rather than filed as a defect.
 */
export function verifyContradictions(
  draft: DraftInput, found: Array<Omit<Contradiction, 'lineA' | 'lineB'>>
): { kept: Contradiction[]; discarded: number } {
  const lines = draft.raw.split('\n');
  const flatLines = lines.map(flatten);
  const haystack = flatten(draft.raw);
  const locate = (quote: string): number | undefined => {
    const needle = flatten(quote);
    const exact = flatLines.findIndex(l => l.includes(needle));
    if (exact >= 0) return exact + 1;
    // The quote may wrap across lines; fall back to the first line that starts it.
    const head = needle.slice(0, 40);
    const partial = flatLines.findIndex(l => l.includes(head));
    return partial >= 0 ? partial + 1 : undefined;
  };

  const kept: Contradiction[] = [];
  let discarded = 0;
  for (const c of found) {
    const a = flatten(c.quoteA);
    const b = flatten(c.quoteB);
    if (!haystack.includes(a) || !haystack.includes(b)) {
      discarded++;
      continue;
    }
    if (a === b) {          // a "contradiction" with itself is a model artefact
      discarded++;
      continue;
    }
    if (whyWithdrawsPair(c.why)) {  // filed, then withdrawn in the same breath
      discarded++;
      continue;
    }
    kept.push({ ...c, lineA: locate(c.quoteA), lineB: locate(c.quoteB) });
  }
  return { kept, discarded };
}

export type FindFn = (draft: DraftInput) => Promise<Array<Omit<Contradiction, 'lineA' | 'lineB'>>>;

function cliFinder(): FindFn {
  const chain = createStructuredCliChain(schema, SHAPE);
  return async draft => (await chain.invoke(coherencePrompt(draft))).contradictions
    // `why` is optional in the response schema (see above) but required on
    // Contradiction, so an omitted rationale becomes '' here rather than
    // throwing away the draft's whole check.
    .map(c => ({ ...c, why: c.why ?? '' }));
}

export interface CoherenceOptions {
  dir?: string;
  base?: string;
  limit?: number;
  outDir?: string;
  label?: string;
  findFn?: FindFn;
  concurrency?: number;
}

async function checkOne(draft: DraftInput, find: FindFn): Promise<CoherenceReport> {
  try {
    const found = await find(draft);
    const { kept, discarded } = verifyContradictions(draft, found);
    return { file: draft.file, contradictions: kept, discarded };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { file: draft.file, contradictions: [], discarded: 0, error: `coherence check failed: ${message}` };
  }
}

/** Bounded-concurrency map preserving input order. */
async function pooled<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return out;
}

export async function checkCoherence(opts: CoherenceOptions = {}): Promise<{
  reports: CoherenceReport[];
  outDir: string;
  total: number;
}> {
  const drafts = loadDrafts(opts.dir ?? 'agent-memory', { base: opts.base, limit: opts.limit });
  const find = opts.findFn ?? cliFinder();
  const reports = await pooled(drafts, opts.concurrency ?? 3, d => checkOne(d, find));
  const total = reports.reduce((n, r) => n + r.contradictions.length, 0);

  const outDir = path.resolve(
    REPO_ROOT, opts.outDir ?? path.join('outputs', 'verification', opts.label ?? 'local')
  );
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'coherence.json'), JSON.stringify({ reports }, null, 2) + '\n', 'utf8');
  fs.writeFileSync(path.join(outDir, 'COHERENCE.md'), renderCoherence(reports), 'utf8');
  return { reports, outDir, total };
}

export function renderCoherence(reports: CoherenceReport[]): string {
  const withFindings = reports.filter(r => r.contradictions.length > 0);
  const failed = reports.filter(r => r.error);
  const lines = [
    '# Internal coherence report',
    '',
    `- drafts checked: ${reports.length - failed.length} of ${reports.length}`,
    ...(failed.length
      ? [`- **NOT CHECKED: ${failed.length}** — see the bottom of this report; this pass is not a clean pass`]
      : []),
    `- self-contradicting: ${withFindings.length}`,
    `- discarded (quote not found in draft): ${reports.reduce((n, r) => n + r.discarded, 0)}`,
    '',
    'Each pair below is two statements from the SAME draft that cannot both be true.',
    'Both quotes were verified to occur in the file. Which side is correct is not',
    'decided here — check the anchor commit and fix the stale side.',
    '',
  ];
  if (!withFindings.length) lines.push('_No contradictions found._', '');
  for (const r of withFindings) {
    lines.push(`## \`${r.file}\``, '');
    for (const c of r.contradictions) {
      lines.push(`- **${c.why}**`);
      lines.push(`  - L${c.lineA ?? '?'}: "${c.quoteA.trim()}"`);
      lines.push(`  - L${c.lineB ?? '?'}: "${c.quoteB.trim()}"`);
    }
    lines.push('');
  }
  if (failed.length) {
    lines.push('## Not checked', '');
    for (const r of failed) lines.push(`- \`${r.file}\` — ${r.error}`);
    lines.push('');
  }
  return lines.join('\n');
}

/* istanbul ignore next */
function argValue(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}

/* istanbul ignore next */
async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (!isUsingCLIProvider() && !process.env.OPENROUTER_API_KEY && !process.env.ANTHROPIC_API_KEY) {
    console.error('No LLM available: set LLM_PROVIDER=claude-cli (uses the claude binary, no API key) ' +
      'or provide OPENROUTER_API_KEY / ANTHROPIC_API_KEY.');
    process.exit(1);
  }
  const limitArg = argValue(argv, '--limit');
  const concArg = argValue(argv, '--concurrency');
  const result = await checkCoherence({
    dir: argValue(argv, '--dir'),
    base: argv.includes('--changed-only') ? (argValue(argv, '--base') ?? 'origin/main') : undefined,
    outDir: argValue(argv, '--out'),
    label: argValue(argv, '--label'),
    limit: limitArg ? Number.parseInt(limitArg, 10) : undefined,
    concurrency: concArg ? Number.parseInt(concArg, 10) : undefined,
  });

  const discarded = result.reports.reduce((n, r) => n + r.discarded, 0);
  console.log(`\ncheck-coherence: ${result.reports.length} drafts, ${result.total} contradiction(s)` +
    `${discarded ? `, ${discarded} discarded (quote not in draft)` : ''}`);
  console.log(`report: ${path.relative(REPO_ROOT, result.outDir)}/COHERENCE.md`);
  for (const r of result.reports.filter(x => x.contradictions.length > 0)) {
    console.log(`  ✗ ${r.file} — ${r.contradictions.length}`);
  }
  if (result.total > 0) process.exit(1);
}

/* istanbul ignore next */
if (require.main === module) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
