import * as dotenv from 'dotenv';
dotenv.config();

import { scrapePR } from './scraper';
import { filterPR } from './filter';
import { distillPR } from './distiller';

// Mix: feat+linked issue (deterministic distill), fix no labels (LLM triage), test commit (LLM)
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
      const filterResult = await filterPR(pr, { logPath: '/tmp/_skipped_smoke.ndjson' });
      console.log(`  filter:   ${filterResult.decision} — ${filterResult.reason}`);

      if (filterResult.decision === 'distill') {
        console.log('  distilling...');
        const distillResult = await distillPR(pr, { outputDir: '/tmp/smoke-pending' });
        console.log(`  distill:  ${distillResult.status} — ${distillResult.reason}`);
        if (distillResult.outputPath) {
          console.log(`  output:   ${distillResult.outputPath}`);
        }
      }
    } catch (err) {
      console.error(`  ERROR: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  console.log(`\n${'─'.repeat(60)}`);
  console.log('done');
})();
