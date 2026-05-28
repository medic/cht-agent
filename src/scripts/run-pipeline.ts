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

import { execFileSync } from 'child_process';
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
 *
 * @example
 * ```typescript
 * process.argv = ['node', 'run-pipeline.ts', '--pr', '123'];
 * parseArgs(); // { prNumber: 123, repo: 'medic/cht-core', lookbackHours: 24 }
 * ```
 */
function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let prNumber: number | undefined;
  let repo = DEFAULT_REPO;
  let lookbackHours = DEFAULT_LOOKBACK_HOURS;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--pr' && args[i + 1]) {
      prNumber = parseInt(args[++i], 10);
    } else if (args[i] === '--repo' && args[i + 1]) {
      repo = args[++i];
    } else if (args[i] === '--since' && args[i + 1]) {
      lookbackHours = parseInt(args[++i], 10);
    }
  }

  return { prNumber, repo, lookbackHours };
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
function getRecentlyMergedPRs(repo: string, hours: number): number[] {
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
 * Runs the full pipeline for each PR number in order.
 * Exits with code 1 if any PR fails processing.
 *
 * @param prNumbers - List of PR numbers to process.
 * @param repo      - Repository in `owner/repo` format.
 */
async function runPipeline(prNumbers: number[], repo: string): Promise<void> {
  let failures = 0;

  for (const prNum of prNumbers) {
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`PR #${prNum} (${repo})`);

    try {
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
    } catch (err) {
      console.error(`  ERROR: ${err instanceof Error ? err.message : String(err)}`);
      failures++;
    }
  }

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Done. Processed ${prNumbers.length} PR(s), ${failures} failure(s).`);

  if (failures > 0) process.exit(1);
}

(async () => {
  const { prNumber, repo, lookbackHours } = parseArgs();

  let prNumbers: number[];

  if (prNumber !== undefined) {
    prNumbers = [prNumber];
  } else {
    console.log(`Fetching PRs merged into ${repo} in the last ${lookbackHours}h...`);
    prNumbers = getRecentlyMergedPRs(repo, lookbackHours);
    console.log(`Found ${prNumbers.length} PR(s)${prNumbers.length ? ': ' + prNumbers.join(', ') : '.'}`);
  }

  if (prNumbers.length === 0) {
    console.log('Nothing to process.');
    process.exit(0);
  }

  await runPipeline(prNumbers, repo);
})();
