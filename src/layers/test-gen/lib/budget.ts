import { diffLines } from 'diff';
import { GeneratedFile } from '../../../types';
import { GeneratedFile as LayerGeneratedFile } from '../../code-gen/interface';

/**
 * Scale test generation to the size of the change.
 *
 * Measured from the two PR bundles this exists to stop (`git apply --stat`):
 *  - m3: `tasks.js` +1/-1 (one broken `resolvedIf`) produced SIX spec files
 *    totalling 2,717 lines (113:1 spec:source), two of them near-duplicates
 *    (`child-pnc-followup-source-id.spec.js` + `...-sourceid.spec.js`).
 *  - m4: ~56 changed source lines produced 22 spec files totalling 18,037
 *    lines (475:1), including a whole invented `test/unit/` mirror tree.
 *
 * The tiers are calibrated against what the partner config repo actually keeps:
 * 91 committed spec files, median 94 lines, mean 142, p90 263, max 877 — one
 * spec per artifact, about a hundred lines. So a generated spec is never
 * allowed to exceed the partner p90, and a sub-10-line fix is never allowed
 * more than one median-sized spec.
 */

/** Agent bookkeeping (`.cht-agent/xlsform-fix.json`) — not partner source, never churn. */
const AGENT_INTERNAL_PREFIX = '.cht-agent/';

/** The file types that represent the change under test. */
const CHURN_TYPES = new Set(['source', 'config']);

/**
 * Churn charged for a MODIFY that arrived without `originalContent`. Counting
 * the whole file would put a one-line fix to a 1,400-line `tasks.js` in the
 * largest tier — the exact failure this budget exists to stop — while counting
 * zero would starve a real refactor. 25 lands in the 'small' tier, which still
 * authorizes two specs.
 */
export const UNKNOWN_MODIFY_CHURN = 25;

export type TestGenBudgetTier = 'surgical' | 'small' | 'medium' | 'large';

export interface TestGenBudget {
  /** Added + removed source lines across the change-bearing generated files. */
  churnedLines: number;
  tier: TestGenBudgetTier;
  /** Hard cap on plan length. Extra plan items are dropped before generation. */
  maxTestFiles: number;
  /** Hard cap on the line count of ONE generated spec. */
  maxLinesPerFile: number;
  /** Hard cap on `it()` blocks in ONE generated spec. */
  maxCasesPerFile: number;
  /** Hard cap on NEW spec lines across the whole run. */
  maxTotalLines: number;
  /** Per-file generation `maxTokens`, derived from maxLinesPerFile. */
  maxOutputTokens: number;
}

interface TierLimits extends Omit<TestGenBudget, 'churnedLines'> {
  /** Inclusive upper bound on churned lines for this tier. */
  upTo: number;
}

const TIERS: ReadonlyArray<TierLimits> = [
  {
    upTo: 10, tier: 'surgical',
    maxTestFiles: 1, maxLinesPerFile: 120, maxCasesPerFile: 6, maxTotalLines: 120,
    maxOutputTokens: 8192,
  },
  {
    upTo: 60, tier: 'small',
    maxTestFiles: 2, maxLinesPerFile: 200, maxCasesPerFile: 10, maxTotalLines: 320,
    maxOutputTokens: 8192,
  },
  {
    upTo: 250, tier: 'medium',
    maxTestFiles: 3, maxLinesPerFile: 250, maxCasesPerFile: 12, maxTotalLines: 600,
    maxOutputTokens: 12288,
  },
  {
    upTo: Number.POSITIVE_INFINITY, tier: 'large',
    maxTestFiles: 5, maxLinesPerFile: 300, maxCasesPerFile: 15, maxTotalLines: 1200,
    maxOutputTokens: 16384,
  },
];

export const countLines = (text: string): number => {
  const body = text.replace(/\n+$/, '');
  return body.length === 0 ? 0 : body.split('\n').length;
};

/** `it(...)` / `test(...)` blocks, including `.only` / `.skip`. */
export const countTestCases = (content: string): number =>
  (content.match(/(^|[^.\w])(it|test)(\.(only|skip))?\s*\(/g) ?? []).length;

export const churnRelevantFiles = (files: ReadonlyArray<GeneratedFile>): GeneratedFile[] =>
  files.filter(f => CHURN_TYPES.has(f.type) && !f.relativePath.startsWith(AGENT_INTERNAL_PREFIX));

export const computeFileChurn = (file: GeneratedFile): number => {
  if (file.action === 'create') return countLines(file.content);
  if (file.originalContent === undefined) return UNKNOWN_MODIFY_CHURN;
  return diffLines(file.originalContent, file.content)
    .filter(part => part.added || part.removed)
    .reduce((sum, part) => sum + (part.count ?? countLines(part.value)), 0);
};

export const computeSourceChurn = (files: ReadonlyArray<GeneratedFile>): number =>
  churnRelevantFiles(files).reduce((sum, f) => sum + computeFileChurn(f), 0);

export const computeTestGenBudget = (files: ReadonlyArray<GeneratedFile>): TestGenBudget => {
  const churnedLines = computeSourceChurn(files);
  const limits = TIERS.find(t => churnedLines <= t.upTo) ?? TIERS[TIERS.length - 1];
  return {
    churnedLines,
    tier: limits.tier,
    maxTestFiles: limits.maxTestFiles,
    maxLinesPerFile: limits.maxLinesPerFile,
    maxCasesPerFile: limits.maxCasesPerFile,
    maxTotalLines: limits.maxTotalLines,
    maxOutputTokens: limits.maxOutputTokens,
  };
};

export const applyTestPlanBudget = <T>(
  plan: ReadonlyArray<T>,
  budget: TestGenBudget,
): { plan: T[]; dropped: T[] } => ({
    plan: plan.slice(0, budget.maxTestFiles),
    dropped: plan.slice(budget.maxTestFiles),
  });

/**
 * When a run REWRITES one of our own earlier specs, the budget governs the NEW
 * material only: the file already on disk was produced under (and reviewed at)
 * its own budget, so charging it again would make every extension impossible.
 */
export const budgetForExtension = (
  budget: TestGenBudget,
  originalContent?: string,
): TestGenBudget => {
  if (!originalContent) return budget;
  return {
    ...budget,
    maxLinesPerFile: budget.maxLinesPerFile + countLines(originalContent),
    maxCasesPerFile: budget.maxCasesPerFile + countTestCases(originalContent),
  };
};

export const newLineCount = (file: { content: string; originalContent?: string }): number =>
  Math.max(0, countLines(file.content) - (file.originalContent ? countLines(file.originalContent) : 0));

export const assertSpecBudget = (
  content: string,
  filePath: string,
  budget: TestGenBudget,
): string[] => {
  const failures: string[] = [];
  const lines = countLines(content);
  if (lines > budget.maxLinesPerFile) {
    failures.push(
      `${filePath} is ${lines} lines; the limit for a ${budget.churnedLines}-line source change is ` +
      `${budget.maxLinesPerFile}. Keep only the cases that prove the changed behavior and its ` +
      `regression surface; delete the rest.`,
    );
  }
  const cases = countTestCases(content);
  if (cases > budget.maxCasesPerFile) {
    failures.push(
      `${filePath} has ${cases} it() blocks; the limit is ${budget.maxCasesPerFile}. Merge or drop ` +
      `cases that differ only in fixture values.`,
    );
  }
  return failures;
};

/** End-of-run audit: what the retry loop had to let through, as result warnings. */
export const auditSpecBudget = (
  files: ReadonlyArray<LayerGeneratedFile>,
  budget: TestGenBudget,
): string[] => {
  const perFile = files.flatMap(f =>
    assertSpecBudget(f.content, f.path, budgetForExtension(budget, f.originalContent))
      .map(message => `spec budget exceeded — ${message}`));
  const total = files.reduce((sum, f) => sum + newLineCount(f), 0);
  if (total <= budget.maxTotalLines) return perFile;
  return [
    ...perFile,
    `spec budget exceeded — ${total} new spec line(s) for a ${budget.churnedLines}-line source ` +
    `change (${budget.tier} tier allows ${budget.maxTotalLines})`,
  ];
};

/** Prompt block convention: '' or a block starting AND ending with a newline. */
export const renderBudgetPromptSection = (budget: TestGenBudget): string => `
## Test Budget — HARD LIMITS (derived from the diff, not negotiable)
This change touches ${budget.churnedLines} source line(s) — the "${budget.tier}" tier.
- Plan AT MOST ${budget.maxTestFiles} test file(s). Extra plan items are DISCARDED by the pipeline before
  generation, so an over-long plan only loses your best ideas.
- Each file: at most ${budget.maxLinesPerFile} lines and at most ${budget.maxCasesPerFile} it() blocks.
- All files together: at most ${budget.maxTotalLines} new lines.
- Scale to the CHANGE, not to the file you touched. Cover (a) the behavior the diff changed,
  (b) the nearest behavior that must NOT change. Nothing else.
- Do NOT write a general-purpose suite for the module, do NOT re-test the framework or the
  test harness, and do NOT add permutations that differ only in fixture values.
`;

export const renderSingleFileBudgetSection = (
  fileBudget: TestGenBudget,
  churnedLines: number,
): string => `
## Size Budget — HARD LIMIT for this file
At most ${fileBudget.maxLinesPerFile} lines and at most ${fileBudget.maxCasesPerFile} it() blocks, for a ${churnedLines}-line source change.
A file over the limit is rejected and regenerated — writing more does not merge more
coverage, it throws the file away. One case per changed behavior, one regression case for
the behavior that must not change, then stop.
`;
