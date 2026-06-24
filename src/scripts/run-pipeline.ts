/**
 * run-pipeline.ts — CLI entry point for the memory distillation pipeline.
 *
 * Runs the full Scraper → Filter → Distiller chain for one or more PRs.
 *
 * Usage:
 *   ts-node src/scripts/run-pipeline.ts --pr 12345
 *   ts-node src/scripts/run-pipeline.ts --since 48   # PRs merged in the last 48h
 *   ts-node src/scripts/run-pipeline.ts              # defaults to last 24h
 *
 * Environment variables:
 *   OPENROUTER_API_KEY  Required for LLM triage and distillation
 *   TRIAGE_MODEL        Optional OpenRouter model for filter stage
 *   DISTILL_MODEL       Optional OpenRouter model for distiller stage
 *   GH_TOKEN            GitHub token forwarded to gh CLI
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { scrapePR } from './scraper';
import { filterPR } from './filter';
import { distillPR } from './distiller';
import { makeLangfuseHandler, createTrace, getLangfuse } from '../observability';

const DEFAULT_REPO = 'medic/cht-core';
const DEFAULT_LOOKBACK_HOURS = 24;

interface CliArgs {
  prNumber?: number;
  repo: string;
  lookbackHours: number;
}

/**
 * Parses CLI arguments into a typed options object.
 *
 * @returns Parsed CLI args with defaults applied.
 * @throws {Error} When `--since` is given a non-positive or non-numeric value,
 *   or when `--pr` is given a non-positive or non-numeric value.
 *
 * @example
 * ```typescript
 * process.argv = ['node', 'run-pipeline.ts', '--pr', '123'];
 * parseArgs(); // { prNumber: 123, repo: 'medic/cht-core', lookbackHours: 24 }
 * ```
 */
/**
 * Parses a CLI flag's raw value as a strictly positive integer.
 *
 * Uses a full-string match (`/^[1-9]\d*$/`) rather than `Number.parseInt`,
 * which would silently truncate `'123abc'` → 123 or `'1.5'` → 1 and let
 * partially-numeric input through. A safe-integer check additionally rejects
 * digit strings so large they overflow to a value that can't be represented
 * exactly (which would otherwise yield an invalid lookback date downstream).
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

export function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const prIdx = args.indexOf('--pr');
  const repoIdx = args.indexOf('--repo');
  const sinceIdx = args.indexOf('--since');

  return {
    prNumber: prIdx >= 0 ? parsePositiveIntArg(args[prIdx + 1], '--pr') : undefined,
    repo: repoIdx >= 0 ? args[repoIdx + 1] : DEFAULT_REPO,
    lookbackHours: sinceIdx >= 0 ? parsePositiveIntArg(args[sinceIdx + 1], '--since') : DEFAULT_LOOKBACK_HOURS,
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
 * // Returns PR numbers merged in the last 24h (mocked in tests)
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
 * Creates a Langfuse trace for the full run when observability is enabled.
 *
 * @param prNum     - The GitHub PR number to process.
 * @param repo      - Repository in `owner/repo` format.
 * @param sessionId - Pipeline session ID (groups all PR traces from one run).
 *
 * @example
 * ```typescript
 * await processSinglePR(12345, 'medic/cht-core', 'session-abc');
 * ```
 */
export async function processSinglePR(prNum: number, repo: string, sessionId?: string): Promise<void> {
  const traceId = `pipeline-pr-${repo.replace('/', '-')}-${prNum}`;
  const handler = makeLangfuseHandler(traceId, sessionId);
  const trace = createTrace(traceId, sessionId);

  const scrapeSpan = trace.span({ name: 'scrape', input: { prNum, repo } });
  console.log('  scraping...');
  const pr = scrapePR(prNum, repo);
  console.log(`  title:  ${pr.prTitle}`);
  console.log(`  labels: ${pr.labels.join(', ') || '(none)'}`);
  console.log(`  files:  ${pr.fileList.length}`);
  scrapeSpan.end({ output: { fileCount: pr.fileList.length } });

  console.log('  filtering...');
  const filterResult = await filterPR(pr, { langfuseHandler: handler });
  console.log(`  filter: ${filterResult.decision} — ${filterResult.reason}`);

  if (filterResult.decision === 'distill') {
    console.log('  distilling...');
    const distillResult = await distillPR(pr, { langfuseHandler: handler });
    console.log(`  distill: ${distillResult.status} — ${distillResult.reason}`);
    if (distillResult.outputPath) {
      console.log(`  output: ${distillResult.outputPath}`);
    }
    trace.score({ name: 'distill-outcome', value: distillResult.status === 'written' ? 1 : 0 });
  }

  await getLangfuse().flushAsync();
}

/**
 * Runs the full pipeline for each PR number in order.
 * Exits with code 1 if any PR fails processing.
 *
 * @param prNumbers - List of PR numbers to process.
 * @param repo      - Repository in `owner/repo` format.
 */
export async function runPipeline(prNumbers: number[], repo: string): Promise<void> {
  let failures = 0;
  const sessionId = randomUUID();

  for (const prNum of prNumbers) {
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`PR #${prNum} (${repo})`);
    try {
      await processSinglePR(prNum, repo, sessionId);
    } catch (err) {
      console.error(`  ERROR: ${errorMessage(err)}`);
      failures++;
    }
  }

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Done. Processed ${prNumbers.length} PR(s), ${failures} failure(s).`);

  if (failures > 0) process.exit(1);
}

/* istanbul ignore next */
async function main(): Promise<void> {
  const { prNumber, repo, lookbackHours } = parseArgs();

  let prNumbers: number[];

  if (prNumber === undefined) {
    console.log(`Fetching PRs merged into ${repo} in the last ${lookbackHours}h...`);
    prNumbers = getRecentlyMergedPRs(repo, lookbackHours);
    console.log(`Found ${prNumbers.length} PR(s)${prNumbers.length ? ': ' + prNumbers.join(', ') : '.'}`);
  } else {
    prNumbers = [prNumber];
  }

  if (prNumbers.length === 0) {
    console.log('Nothing to process.');
    process.exit(0);
  }

  await runPipeline(prNumbers, repo);
}

/* istanbul ignore next */
if (require.main === module) {
  main().catch((err) => {
    console.error(errorMessage(err));
    process.exit(1);
  });
}
