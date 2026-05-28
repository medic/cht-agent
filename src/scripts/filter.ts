/**
 * Filter stage for the memory distillation pipeline.
 *
 * Applies deterministic rules first (skip/distill), then falls back to LLM
 * triage for gray-area PRs. Appends audit entries to _skipped.ndjson for
 * skip and flag-for-human decisions.
 *
 * Known limitation: the Feature distill rule treats "substantive" as
 * "has a linked issue" — deeper judgment is deferred to the distiller.
 */

import * as fs from 'node:fs';
import { ChatAnthropic } from '@langchain/anthropic';
import { ChatOpenAI } from '@langchain/openai';
import { z } from 'zod';
import type { ScrapedPR, FilterResult, FilterOptions, SkipLogEntry, FilterDecision } from '../types/pipeline';
import { DEFAULT_PIPELINE_LOG_PATH } from '../constants';

// CHT service directory prefixes — a PR touching ≥2 of these is "multi-service"
const SERVICE_PREFIXES = ['api/', 'webapp/', 'sentinel/', 'admin/', 'shared-libs/'];

// Files matching these patterns are lockfiles
const LOCKFILE_PATTERN = /(?:^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|.*\.lock)$/;

// Files matching these patterns are translation files
const TRANSLATION_PATTERN = /(?:^|\/)translations\/.*|\.properties$|\.po$|\.pot$/;

// Body length limit sent to LLM (prevent prompt bloat)
const LLM_BODY_LIMIT = 2000;

const DEFAULT_TRIAGE_MODEL = 'anthropic/claude-haiku-4-5';

/**
 * Returns true if fileList touches ≥2 distinct CHT service prefixes.
 *
 * @example
 * ```typescript
 * touchesMultipleServices(['api/foo.ts', 'webapp/bar.ts']); // true
 * touchesMultipleServices(['api/foo.ts', 'api/bar.ts']); // false
 * ```
 */
function touchesMultipleServices(fileList: string[]): boolean {
  const touched = new Set(
    fileList
      .map(f => SERVICE_PREFIXES.find(prefix => f.startsWith(prefix)))
      .filter((prefix): prefix is string => prefix !== undefined)
  );
  return touched.size >= 2;
}

/**
 * Append a skip/flag entry to the audit log.
 *
 * @example
 * ```typescript
 * writeSkipLog({ prNumber: 1, decision: 'skip', reason: 'Bot PR', timestamp: new Date().toISOString() }, '/tmp/test.ndjson');
 * ```
 */
function writeSkipLog(entry: SkipLogEntry, logPath: string): void {
  fs.appendFileSync(logPath, JSON.stringify(entry) + '\n', 'utf8');
}

/**
 * Stage 1: deterministic SKIP rules.
 * Returns a reason string if the PR should be skipped, null otherwise.
 *
 * @example
 * ```typescript
 * checkSkipRules({ author: 'dependabot[bot]', prTitle: 'bump deps', fileList: [], labels: [] } as any); // 'Bot PR: dependabot[bot]'
 * ```
 */
function checkSkipRules(pr: ScrapedPR): string | null {
  if (pr.author.endsWith('[bot]')) return `Bot PR: ${pr.author}`;
  if (/^revert[\s(:]/i.test(pr.prTitle)) return 'Revert PR';
  if (/^(chore|docs|ci|build)(\(.+\))?(!)?\s*:/i.test(pr.prTitle)) {
    const type = /^(\w+)/.exec(pr.prTitle)?.[1] ?? 'chore';
    return `Conventional commit type: ${type}`;
  }
  const nonEmpty = pr.fileList.length > 0;
  const isLockfileOnly = nonEmpty && pr.fileList.every(f => LOCKFILE_PATTERN.test(f));
  const isTranslationOnly = nonEmpty && pr.fileList.every(f => TRANSLATION_PATTERN.test(f));
  if (isLockfileOnly) return 'Lockfile-only changes';
  if (isTranslationOnly) return 'Translation-only changes';
  return null;
}

/**
 * Stage 2: deterministic DISTILL rules.
 * Returns a reason string if the PR should be distilled, null otherwise.
 *
 * @example
 * ```typescript
 * checkDistillRules({ labels: ['type: bug'], linkedIssues: [{}], fileList: ['api/a.ts', 'webapp/b.ts'] } as any);
 * // 'Bug with linked issue affecting multiple services'
 * ```
 */
function isBugWithLinkedIssueAndMultiService(pr: ScrapedPR): boolean {
  const labels = new Set(pr.labels.map(l => l.toLowerCase()));
  return labels.has('type: bug') && pr.linkedIssues.length > 0 && touchesMultipleServices(pr.fileList);
}

function isFeatureWithLinkedIssue(pr: ScrapedPR): boolean {
  const labels = new Set(pr.labels.map(l => l.toLowerCase()));
  return labels.has('type: feature') && pr.linkedIssues.length > 0;
}

function isSharedLibsWithMultiService(pr: ScrapedPR): boolean {
  return pr.fileList.some(f => f.startsWith('shared-libs/')) && touchesMultipleServices(pr.fileList);
}

function checkDistillRules(pr: ScrapedPR): string | null {
  if (isBugWithLinkedIssueAndMultiService(pr)) return 'Bug with linked issue affecting multiple services';
  if (isFeatureWithLinkedIssue(pr)) return 'Feature with linked issue';
  if (isSharedLibsWithMultiService(pr)) return 'Shared library change affecting multiple consumers';
  return null;
}

interface TriageOutput {
  decision: string;
  reason: string;
}

const triageSchema: z.ZodType<TriageOutput> = z.object({
  decision: z.enum(['distill', 'skip', 'flag-for-human']),
  reason: z.string().min(1),
});

// Cached on first call — avoids recreating the LLM client for each PR in a batch
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _triageChain: any;

function getTriageChain() {
  if (_triageChain !== undefined) return _triageChain;

  const openrouterKey = process.env.OPENROUTER_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  if (openrouterKey) {
    const llm = new ChatOpenAI({
      modelName: process.env.TRIAGE_MODEL ?? DEFAULT_TRIAGE_MODEL,
      maxTokens: 200,
      configuration: { apiKey: openrouterKey, baseURL: 'https://openrouter.ai/api/v1' },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _triageChain = (llm as any).withStructuredOutput(triageSchema);
  } else if (anthropicKey) {
    const llm = new ChatAnthropic({
      model: 'claude-haiku-4-5-20251001',
      apiKey: anthropicKey,
      maxTokens: 200,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _triageChain = (llm as any).withStructuredOutput(triageSchema);
  } else {
    _triageChain = null;
  }

  return _triageChain;
}

/**
 * Call the LLM to triage a PR that didn't match deterministic rules.
 * Returns flag-for-human if no API key is set or the call fails.
 *
 * @example
 * ```typescript
 * // Not called directly in tests — injected via opts.triageFn or exercised via filterPR
 * ```
 */
async function llmTriage(pr: ScrapedPR): Promise<FilterResult> {
  const chain = getTriageChain();

  if (!chain) {
    return { decision: 'flag-for-human', reason: 'LLM triage unavailable: no API key set (OPENROUTER_API_KEY or ANTHROPIC_API_KEY)' };
  }

  const body = (pr.prBody ?? '').slice(0, LLM_BODY_LIMIT);
  const prompt = `You are a code change classifier for a health worker software project (CHT).

Classify this pull request as one of:
- "distill" — substantive change worth capturing in the knowledge base
- "skip" — trivial, administrative, or low-value (tests-only, minor refactor, etc.)
- "flag-for-human" — ambiguous; needs human review

PR title: ${pr.prTitle}
Labels: ${pr.labels.join(', ') || 'none'}
Files changed: ${pr.fileList.slice(0, 20).join(', ')}${pr.fileList.length > 20 ? '...' : ''}
Linked issues: ${pr.linkedIssues.length}
PR body (truncated):
${body}

Respond with JSON: { "decision": "distill"|"skip"|"flag-for-human", "reason": "<one sentence>" }`;

  try {
    const result = await chain.invoke(prompt) as TriageOutput;
    return { decision: result.decision as FilterDecision, reason: result.reason };
  } catch (err) {
    return {
      decision: 'flag-for-human',
      reason: `LLM triage unavailable: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Calls the triage function with error handling, returning a flag-for-human result on failure.
 *
 * @param pr       - The PR to triage.
 * @param triageFn - The triage function to invoke.
 * @returns The triage FilterResult, or a flag-for-human result on error.
 *
 * @example
 * ```typescript
 * const result = await runLlmTriage(pr, llmTriage);
 * // { decision: 'distill' | 'skip' | 'flag-for-human', reason: '...' }
 * ```
 */
async function runLlmTriage(
  pr: ScrapedPR,
  triageFn: (pr: ScrapedPR) => Promise<FilterResult>
): Promise<FilterResult> {
  try {
    return await triageFn(pr);
  } catch (err) {
    return {
      decision: 'flag-for-human',
      reason: `LLM triage unavailable: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Filter a scraped PR through deterministic rules, then LLM triage.
 * Writes to _skipped.ndjson for skip and flag-for-human decisions.
 *
 * @example
 * ```typescript
 * const result = await filterPR(scrapedPR, { skipLlm: true });
 * // { decision: 'flag-for-human', reason: 'LLM triage skipped' }
 * ```
 */
export async function filterPR(
  pr: ScrapedPR,
  opts: FilterOptions = {}
): Promise<FilterResult> {
  const logPath = opts.logPath ?? DEFAULT_PIPELINE_LOG_PATH;

  // Stage 1: deterministic skip
  const skipReason = checkSkipRules(pr);
  if (skipReason !== null) {
    const entry: SkipLogEntry = {
      prNumber: pr.prNumber,
      decision: 'skip',
      reason: skipReason,
      timestamp: new Date().toISOString(),
    };
    writeSkipLog(entry, logPath);
    return { decision: 'skip', reason: skipReason };
  }

  // Stage 2: deterministic distill
  const distillReason = checkDistillRules(pr);
  if (distillReason !== null) {
    return { decision: 'distill', reason: distillReason };
  }

  // Stage 3: LLM triage
  if (opts.skipLlm) {
    const entry: SkipLogEntry = {
      prNumber: pr.prNumber,
      decision: 'flag-for-human',
      reason: 'LLM triage skipped',
      timestamp: new Date().toISOString(),
    };
    writeSkipLog(entry, logPath);
    return { decision: 'flag-for-human', reason: 'LLM triage skipped' };
  }

  const result = await runLlmTriage(pr, opts.triageFn ?? llmTriage);

  if (result.decision !== 'distill') {
    const entry: SkipLogEntry = {
      prNumber: pr.prNumber,
      decision: result.decision,
      reason: result.reason,
      timestamp: new Date().toISOString(),
    };
    writeSkipLog(entry, logPath);
  }

  return result;
}
