import * as dotenv from 'dotenv';
dotenv.config();

import { scrapePR } from './scraper';
import { filterPR } from './filter';

// Mix: feat+linked issue (deterministic), fix no labels (LLM), test commit (LLM)
const TEST_PRS = [11057, 11022, 11077];

(async () => {
  for (const prNum of TEST_PRS) {
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
      console.log('  filtering...');
      const result = await filterPR(pr, { logPath: '/tmp/_skipped_smoke.ndjson' });
      console.log(`  decision: ${result.decision}`);
      console.log(`  reason:   ${result.reason}`);
    } catch (err) {
      console.error(`  ERROR: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  console.log(`\n${'─'.repeat(60)}`);
  console.log('done');
})();
