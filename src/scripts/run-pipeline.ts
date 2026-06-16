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

import { execFileSync } from 'node:child_process';
import { scrapePR } from './scraper';
import { filterPR } from './filter';
import { distillPR } from './distiller';

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
export function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const prIdx = args.indexOf('--pr');
  const repoIdx = args.indexOf('--repo');
  const sinceIdx = args.indexOf('--since');

  let prNumber: number | undefined;
  if (prIdx >= 0) {
    prNumber = Number.parseInt(args[prIdx + 1], 10);
    if (!Number.isInteger(prNumber) || prNumber <= 0) {
      throw new Error(`Invalid --pr value: ${JSON.stringify(args[prIdx + 1])} (expected a positive integer)`);
    }
  }

  let lookbackHours = DEFAULT_LOOKBACK_HOURS;
  if (sinceIdx >= 0) {
    lookbackHours = Number.parseInt(args[sinceIdx + 1], 10);
    if (!Number.isInteger(lookbackHours) || lookbackHours <= 0) {
      throw new Error(`Invalid --since value: ${JSON.stringify(args[sinceIdx + 1])} (expected a positive integer number of hours)`);
    }
  }

  return {
    prNumber,
    repo: repoIdx >= 0 ? args[repoIdx + 1] : DEFAULT_REPO,
    lookbackHours,
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
 *
 * @param prNum - The GitHub PR number to process.
 * @param repo  - Repository in `owner/repo` format.
 *
 * @example
 * ```typescript
 * await processSinglePR(12345, 'medic/cht-core');
 * ```
 */
export async function processSinglePR(prNum: number, repo: string): Promise<void> {
  console.log('  scraping...');
  const pr = scrapePR(prNum, repo);
  console.log(`  title:  ${pr.prTitle}`);
  console.log(`  labels: ${pr.labels.join(', ') || '(none)'}`);
  console.log(`  files:  ${pr.fileList.length}`);

  console.log('  filtering...');
  const filterResult = await filterPR(pr);
  console.log(`  filter: ${filterResult.decision} — ${filterResult.reason}`);

  if (filterResult.decision === 'distill') {
    console.log('  distilling...');
    const distillResult = await distillPR(pr);
    console.log(`  distill: ${distillResult.status} — ${distillResult.reason}`);
    if (distillResult.outputPath) {
      console.log(`  output: ${distillResult.outputPath}`);
    }
  }
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

  for (const prNum of prNumbers) {
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`PR #${prNum} (${repo})`);
    try {
      await processSinglePR(prNum, repo);
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
