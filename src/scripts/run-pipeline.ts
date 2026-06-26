/**
 * run-pipeline.ts — CLI entry point for the memory distillation pipeline.
 *
 * Runs the full Scraper → Filter → Distiller chain for one or more PRs.
 *
 * Usage:
 *   ts-node src/scripts/run-pipeline.ts --pr 12345
 *   ts-node src/scripts/run-pipeline.ts --pr 12345,11987 --force  # bypass the filter, distill directly
 *   ts-node src/scripts/run-pipeline.ts --since 48                # PRs merged in the last 48h
 *   ts-node src/scripts/run-pipeline.ts --last 1000 --resume      # newest 1000 merged PRs, skip already-processed
 *   ts-node src/scripts/run-pipeline.ts --concurrency 4           # process 4 PRs at a time
 *   ts-node src/scripts/run-pipeline.ts                           # defaults to last 24h
 *
 * --force skips the filter stage (deterministic rules AND LLM triage) and sends
 * the PR straight to distillation. Only valid with an explicit --pr list, to
 * guard against force-distilling a whole batch.
 *
 * --concurrency N (default 1, or PIPELINE_CONCURRENCY; clamped to [1, 10])
 * processes N PRs at a time. Only the LLM legs overlap — gh scraping is
 * execFileSync and stays serial, which keeps GitHub's secondary rate limits
 * happy. 3-5 is the sweet spot; above that, raise the container memory limit
 * (each claude process is its own Node runtime).
 *
 * --resume skips PRs that already have a draft under agent-memory/_pending/ or
 * an entry in the audit log, so an interrupted batch can be re-run without
 * repeating LLM calls.
 *
 * Environment variables:
 *   LLM_PROVIDER         Set to claude-cli to run triage + distillation through
 *                        the Claude Code CLI (`claude -p`); no API key needed.
 *                        TRIAGE_MODEL / DISTILL_MODEL do not apply in this mode.
 *   PIPELINE_CONCURRENCY Default --concurrency when the flag is omitted.
 *   OPENROUTER_API_KEY   API-mode alternative for LLM triage and distillation
 *   ANTHROPIC_API_KEY    API-mode fallback when OPENROUTER_API_KEY is unset
 *   TRIAGE_MODEL         Optional OpenRouter model for filter stage
 *   DISTILL_MODEL        Optional OpenRouter model for distiller stage
 *   GH_TOKEN             GitHub token forwarded to gh CLI (read-only scrape)
 */

import * as dotenv from 'dotenv';
dotenv.config();

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { scrapePR } from './scraper';
import { filterPR } from './filter';
import { distillPR } from './distiller';
import { isAuthError, isBatchFatalError } from '../llm/rate-limit';
import { DEFAULT_PIPELINE_LOG_PATH, DEFAULT_PIPELINE_OUTPUT_DIR } from '../constants';

/** Exit code used when the batch stops early on a global LLM failure (rate limit / auth). */
export const RATE_LIMIT_EXIT_CODE = 2;

const DEFAULT_REPO = 'medic/cht-core';
const DEFAULT_LOOKBACK_HOURS = 24;
const MAX_CONCURRENCY = 10;

interface CliArgs {
  prNumbers?: number[];
  repo: string;
  lookbackHours: number;
  last?: number;
  resume: boolean;
  force: boolean;
  concurrency: number;
}

/**
 * Parses a CLI flag's raw value as a strictly positive integer.
 *
 * Uses a full-string match (`/^[1-9]\d*$/`) rather than `Number.parseInt`,
 * which would silently truncate `'123abc'` → 123 or `'1.5'` → 1 and let
 * partially-numeric input through. A safe-integer check additionally rejects
 * digit strings so large they overflow to a value that can't be represented
 * exactly.
 *
 * @param raw  - The raw argument value (may be undefined when the flag is last).
 * @param flag - The flag name, used in the error message.
 * @returns The parsed positive integer.
 * @throws {Error} When `raw` is not a bare, safe positive integer.
 *
 * @example
 * ```typescript
 * parsePositiveIntArg('48', '--since'); // 48
 * parsePositiveIntArg('1.5', '--since'); // throws Error
 * ```
 */
function parsePositiveIntArg(raw: string | undefined, flag: string): number {
  const value = raw !== undefined && /^[1-9]\d*$/.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isSafeInteger(value)) {
    throw new TypeError(`Invalid ${flag} value: ${JSON.stringify(raw)} (expected a positive integer)`);
  }
  return value;
}

/**
 * Resolves the default concurrency from the PIPELINE_CONCURRENCY env var,
 * falling back to 1. The --concurrency flag overrides this.
 */
function envConcurrency(): number {
  const raw = process.env.PIPELINE_CONCURRENCY;
  if (raw === undefined || !/^[1-9]\d*$/.test(raw)) return 1;
  return Math.min(Number(raw), MAX_CONCURRENCY);
}

/**
 * Parses CLI arguments into a typed options object.
 *
 * @returns Parsed CLI args with defaults applied.
 * @throws {Error} When `--since`, `--pr`, `--last`, or `--concurrency` is given a
 *   non-positive or non-numeric value.
 *
 * @example
 * ```typescript
 * process.argv = ['node', 'run-pipeline.ts', '--pr', '123'];
 * parseArgs(); // { prNumbers: [123], repo: 'medic/cht-core', lookbackHours: 24, ... }
 * ```
 */
/**
 * Validates a `--repo` value as `owner/repo`. Rejects anything else (e.g. a
 * leading `-` that gh would parse as a flag), mirroring the strictness applied
 * to the numeric flags.
 */
function parseRepoArg(raw: string | undefined): string {
  if (raw === undefined || !/^[\w.-]+\/[\w.-]+$/.test(raw)) {
    throw new TypeError(`Invalid --repo value: ${JSON.stringify(raw)} (expected owner/repo)`);
  }
  return raw;
}

/** Read an integer flag (validated positive) or return the fallback. */
function intFlag(args: string[], flag: string, fallback: number): number {
  const idx = args.indexOf(flag);
  return idx >= 0 ? parsePositiveIntArg(args[idx + 1], flag) : fallback;
}

/** Parse --pr: a single number or comma-separated list, or undefined if absent. */
function parsePrList(args: string[]): number[] | undefined {
  const idx = args.indexOf('--pr');
  if (idx < 0) return undefined;
  return (args[idx + 1] ?? '').split(',').map(s => parsePositiveIntArg(s.trim() || undefined, '--pr'));
}

export function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const repoIdx = args.indexOf('--repo');
  const lastIdx = args.indexOf('--last');
  const concurrency = Math.max(1, Math.min(intFlag(args, '--concurrency', envConcurrency()), MAX_CONCURRENCY));

  return {
    prNumbers: parsePrList(args),
    repo: repoIdx >= 0 ? parseRepoArg(args[repoIdx + 1]) : DEFAULT_REPO,
    lookbackHours: intFlag(args, '--since', DEFAULT_LOOKBACK_HOURS),
    last: lastIdx >= 0 ? parsePositiveIntArg(args[lastIdx + 1], '--last') : undefined,
    resume: args.includes('--resume'),
    force: args.includes('--force'),
    concurrency,
  };
}

/**
 * Fetches PR numbers merged into the default branch within the last `hours`.
 *
 * @param repo  - Repository in `owner/repo` format.
 * @param hours - Lookback window in hours.
 * @returns Array of PR numbers sorted newest-first.
 *
 * @example
 * ```typescript
 * getRecentlyMergedPRs('medic/cht-core', 24);
 * ```
 */
export function getRecentlyMergedPRs(repo: string, hours: number): number[] {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);
  const raw = execFileSync(
    'gh',
    ['pr', 'list', '--repo', repo, '--state', 'merged', '--limit', '100', '--json', 'number,mergedAt'],
    { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }
  );
  const prs = JSON.parse(raw) as Array<{ number: number; mergedAt: string }>;
  return prs
    .filter(pr => new Date(pr.mergedAt) >= since)
    .map(pr => pr.number);
}

/**
 * Fetches the newest `count` merged PR numbers, regardless of age.
 * gh paginates internally, so counts well above the per-page limit work.
 *
 * @example
 * ```typescript
 * getLastMergedPRs('medic/cht-core', 1000); // newest 1000 merged PR numbers
 * ```
 */
export function getLastMergedPRs(repo: string, count: number): number[] {
  const raw = execFileSync(
    'gh',
    ['pr', 'list', '--repo', repo, '--state', 'merged', '--limit', String(count), '--json', 'number'],
    { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 }
  );
  const prs = JSON.parse(raw) as Array<{ number: number }>;
  return prs.map(pr => pr.number);
}

/**
 * Collects PR numbers that already have a pipeline outcome: an entry in the
 * audit log (skip / flag-for-human) or a draft file under _pending/<domain>/.
 * Used by --resume to make interrupted batch runs re-runnable.
 *
 * @example
 * ```typescript
 * const done = getProcessedPRs();
 * [101, 102].filter(n => !done.has(n));
 * ```
 */
/** Parse a PR number from one audit-log line, or null if absent/malformed. */
function prFromLogLine(line: string): number | null {
  if (!line.trim()) return null;
  try {
    const entry = JSON.parse(line) as { prNumber?: number };
    return typeof entry.prNumber === 'number' ? entry.prNumber : null;
  } catch {
    return null;
  }
}

/** PR numbers recorded in the audit log (skip / flag-for-human entries). */
export function prNumbersFromLog(logPath: string): number[] {
  let log: string;
  try {
    log = fs.readFileSync(logPath, 'utf8');
  } catch {
    return [];
  }
  return log.split('\n').map(prFromLogLine).filter((n): n is number => n !== null);
}

/** PR numbers with a draft `<prNumber>-<slug>.md` in one _pending/<domain>/ dir. */
function prNumbersFromDraftDir(dir: string): number[] {
  let files: string[];
  try {
    files = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return files
    .map(f => /^(\d+)-.*\.md$/.exec(f))
    .filter((m): m is RegExpExecArray => m !== null)
    .map(m => Number.parseInt(m[1], 10));
}

/** PR numbers with a draft under any _pending/<domain>/ dir. */
export function prNumbersFromDrafts(outputDir: string): number[] {
  let domains: string[];
  try {
    domains = fs.readdirSync(outputDir);
  } catch {
    return [];
  }
  return domains.flatMap(d => prNumbersFromDraftDir(path.join(outputDir, d)));
}

export function getProcessedPRs(): Set<number> {
  return new Set([
    ...prNumbersFromLog(DEFAULT_PIPELINE_LOG_PATH),
    ...prNumbersFromDrafts(DEFAULT_PIPELINE_OUTPUT_DIR),
  ]);
}

/**
 * Returns a human-readable error message from an unknown thrown value.
 *
 * @param err - The caught error value.
 * @returns The error message string.
 *
 * @example
 * ```typescript
 * errorMessage(new Error('boom')); // 'boom'
 * errorMessage('raw string');      // 'raw string'
 * ```
 */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Runs scrape → filter → distill for a single PR number.
 *
 * @param prNum - The GitHub PR number to process.
 * @param repo  - Repository in `owner/repo` format.
 * @param force - Bypass the filter stage entirely.
 * @param tag   - Log-line prefix (a per-PR tag under concurrency).
 *
 * @example
 * ```typescript
 * await processSinglePR(12345, 'medic/cht-core');
 * ```
 */
/** Run the filter stage (or bypass it under --force), logging the decision. */
async function runFilter(
  pr: ReturnType<typeof scrapePR>,
  force: boolean,
  tag: string
): Promise<{ decision: string; reason: string }> {
  if (force) {
    console.log(`${tag} filter: BYPASSED (--force) — distilling directly`);
    return { decision: 'distill', reason: 'forced via --force' };
  }
  console.log(`${tag} filtering...`);
  const result = await filterPR(pr);
  console.log(`${tag} filter: ${result.decision} — ${result.reason}`);
  return result;
}

export async function processSinglePR(prNum: number, repo: string, force = false, tag = ' '): Promise<void> {
  console.log(`${tag} scraping...`);
  const pr = scrapePR(prNum, repo);
  console.log(`${tag} title:  ${pr.prTitle}`);
  console.log(`${tag} labels: ${pr.labels.join(', ') || '(none)'}`);
  console.log(`${tag} files:  ${pr.fileList.length}`);

  const filterResult = await runFilter(pr, force, tag);
  if (filterResult.decision !== 'distill') return;

  console.log(`${tag} distilling...`);
  const distillResult = await distillPR(pr);
  console.log(`${tag} distill: ${distillResult.status} — ${distillResult.reason}`);
  if (distillResult.outputPath) {
    console.log(`${tag} output: ${distillResult.outputPath}`);
  }
}

/**
 * Runs the full pipeline for each PR number, `concurrency` at a time.
 * Exits with code 1 if any PR fails processing.
 *
 * Only the async legs (LLM triage/distill subprocesses) overlap — the
 * scraper's execFileSync calls block the event loop, keeping gh traffic
 * effectively serial and below GitHub's secondary rate limits.
 *
 * @param prNumbers   - List of PR numbers to process.
 * @param repo        - Repository in `owner/repo` format.
 * @param force       - Bypass the filter stage entirely.
 * @param concurrency - Number of PRs in flight at once (1 = serial).
 */
interface BatchState {
  failures: number;
  nextIndex: number;
  abortKind: 'rate' | 'auth' | null;
}

/** Immutable run config + mutable state shared across the concurrent workers. */
interface BatchCtx {
  prNumbers: number[];
  repo: string;
  force: boolean;
  parallel: boolean;
  state: BatchState;
}

/** Log the start line for a PR (a per-PR tag under concurrency). */
function logPrStart(ctx: BatchCtx, index: number, tag: string): void {
  if (ctx.parallel) {
    console.log(`${tag} start (${index + 1}/${ctx.prNumbers.length}, ${ctx.repo})`);
    return;
  }
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`PR #${ctx.prNumbers[index]} (${ctx.repo})`);
}

/** Record a per-PR error; returns true if it's a global failure that stops the batch. */
function recordWorkerError(err: unknown, tag: string, state: BatchState): boolean {
  if (isBatchFatalError(err)) {
    state.abortKind = isAuthError(err) ? 'auth' : 'rate';
    const label = state.abortKind === 'auth' ? 'AUTH ERROR' : 'RATE LIMIT';
    console.error(`${tag} ${label} — stopping the batch: ${errorMessage(err)}`);
    return true;
  }
  console.error(`${tag} ERROR: ${errorMessage(err)}`);
  state.failures++;
  return false;
}

/** Process one PR; returns false if the batch should stop. */
async function processBatchItem(ctx: BatchCtx, index: number): Promise<boolean> {
  const prNum = ctx.prNumbers[index];
  const tag = ctx.parallel ? ` [#${prNum}]` : ' ';
  logPrStart(ctx, index, tag);
  try {
    await processSinglePR(prNum, ctx.repo, ctx.force, tag);
    return true;
  } catch (err) {
    return !recordWorkerError(err, tag, ctx.state);
  }
}

/** Pull-and-process loop: stops pulling new work once a global failure is hit. */
async function runWorker(ctx: BatchCtx): Promise<void> {
  while (!ctx.state.abortKind && ctx.state.nextIndex < ctx.prNumbers.length) {
    const keepGoing = await processBatchItem(ctx, ctx.state.nextIndex++);
    if (!keepGoing) break;
  }
}

/** Print the run summary and exit non-zero on abort or failures. */
function reportOutcome(total: number, state: BatchState): void {
  console.log(`\n${'─'.repeat(60)}`);
  if (state.abortKind === 'auth') {
    console.log('Stopped early: Claude authentication failed (401). Re-login in the container — `docker exec -it cht-seeder claude` then run /login — and re-run with --resume.');
    process.exit(RATE_LIMIT_EXIT_CODE);
  }
  if (state.abortKind === 'rate') {
    console.log('Stopped early: LLM rate/usage limit hit. Re-run with --resume once it resets to continue.');
    process.exit(RATE_LIMIT_EXIT_CODE);
  }
  console.log(`Done. Processed ${total} PR(s), ${state.failures} failure(s).`);
  if (state.failures > 0) process.exit(1);
}

export async function runPipeline(prNumbers: number[], repo: string, force = false, concurrency = 1): Promise<void> {
  const state: BatchState = { failures: 0, nextIndex: 0, abortKind: null };
  const ctx: BatchCtx = { prNumbers, repo, force, parallel: concurrency > 1, state };
  const count = Math.min(concurrency, prNumbers.length);
  const workers = Array.from({ length: count }, () => runWorker(ctx));
  await Promise.all(workers);
  reportOutcome(prNumbers.length, state);
}

/**
 * Resolves the PR list from the parsed args: an explicit --pr list, else the
 * newest --last N, else PRs merged in the --since window.
 */
/* istanbul ignore next */
export function resolvePrNumbers(args: CliArgs): number[] {
  const { prNumbers: requestedPRs, repo, lookbackHours, last } = args;
  if (requestedPRs !== undefined) return requestedPRs;
  if (last !== undefined) {
    console.log(`Fetching the newest ${last} merged PR(s) in ${repo}...`);
    const prs = getLastMergedPRs(repo, last);
    console.log(`Found ${prs.length} PR(s).`);
    return prs;
  }
  console.log(`Fetching PRs merged into ${repo} in the last ${lookbackHours}h...`);
  const prs = getRecentlyMergedPRs(repo, lookbackHours);
  console.log(`Found ${prs.length} PR(s)${prs.length ? ': ' + prs.join(', ') : '.'}`);
  return prs;
}

/**
 * Applies the --resume skip-list. Explicitly named `--pr` requests under
 * `--force` are exempt: forcing a named PR is an intentional re-distill, so the
 * resume filter must not silently drop it just because a prior draft exists.
 */
export function filterResumable(prNumbers: number[], args: CliArgs, processed: Set<number>): number[] {
  if (!args.resume) return prNumbers;
  if (args.force && args.prNumbers !== undefined) return prNumbers;
  return prNumbers.filter(n => !processed.has(n));
}

/* istanbul ignore next */
async function main(): Promise<void> {
  const args = parseArgs();
  const { prNumbers: requestedPRs, repo, resume, force, concurrency } = args;

  if (force && requestedPRs === undefined) {
    console.error('--force requires an explicit --pr list (refusing to force-distill a whole batch).');
    process.exit(1);
  }

  let prNumbers = resolvePrNumbers(args);

  if (resume) {
    const before = prNumbers.length;
    prNumbers = filterResumable(prNumbers, args, getProcessedPRs());
    console.log(`Resume: skipping ${before - prNumbers.length} already-processed PR(s), ${prNumbers.length} remaining.`);
  }

  if (prNumbers.length === 0) {
    console.log('Nothing to process.');
    process.exit(0);
  }

  if (concurrency > 1) {
    console.log(`Concurrency: ${concurrency} PR(s) in flight at a time.`);
  }
  await runPipeline(prNumbers, repo, force, concurrency);
}

/* istanbul ignore next */
if (require.main === module) {
  main().catch((err) => {
    console.error(errorMessage(err));
    process.exit(1);
  });
}
