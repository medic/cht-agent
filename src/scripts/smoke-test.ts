import * as dotenv from 'dotenv';
dotenv.config();

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { scrapePR } from './scraper';
import { filterPR } from './filter';
import { distillPR } from './distiller';

// Mix: feat+linked issue (deterministic distill), fix no labels (LLM triage), test commit (LLM)
const TEST_PRS = [11057, 11022, 11077];

// Per-run temp dir with a random, unpredictable name (0700 perms) created atomically
// by mkdtempSync — avoids the predictable-path hotspot of writing straight into os.tmpdir().
const SMOKE_TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cht-smoke-'));

/**
 * Filter and optionally distill a scraped PR, logging each stage.
 *
 * @example
 * ```typescript
 * await filterAndDistill(pr);
 * ```
 */
async function filterAndDistill(pr: ReturnType<typeof scrapePR>): Promise<void> {
  console.log('  filtering...');
  const filterResult = await filterPR(pr, { logPath: path.join(SMOKE_TMP_DIR, '_skipped_smoke.ndjson') });
  console.log(`  filter:   ${filterResult.decision} — ${filterResult.reason}`);
  if (filterResult.decision !== 'distill') return;

  console.log('  distilling...');
  const distillResult = await distillPR(pr, { outputDir: path.join(SMOKE_TMP_DIR, 'smoke-pending') });
  console.log(`  distill:  ${distillResult.status} — ${distillResult.reason}`);
  if (distillResult.outputPath) console.log(`  output:   ${distillResult.outputPath}`);
}

/**
 * Runs the full scrape → filter → distill pipeline for a single PR number.
 *
 * @param prNum - The GitHub PR number to process.
 *
 * @example
 * ```typescript
 * await processPR(11057);
 * ```
 */
async function processPR(prNum: number): Promise<void> {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`PR #${prNum}`);
  try {
    console.log('  scraping...');
    const pr = scrapePR(prNum);
    console.log(`  title:   ${pr.prTitle}`);
    console.log(`  author:  ${pr.author}`);
    console.log(`  labels:  ${pr.labels.join(', ') || '(none)'}`);
    console.log(`  files:   ${pr.fileList.length}`);
    console.log(`  issues:  ${pr.linkedIssues.length}`);
    await filterAndDistill(pr);
  } catch (err) {
    console.error(`  ERROR: ${err instanceof Error ? err.message : String(err)}`);
  }
}

(async () => {
  for (const prNum of TEST_PRS) {
    await processPR(prNum);
  }
  console.log(`\n${'─'.repeat(60)}`);
  console.log('done');
})();
