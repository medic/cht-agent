import fs from 'fs';

import { DEFAULT_PIPELINE_LOG_PATH } from '../src/constants';

/**
 * Root hooks guarding the pipeline skip-log against test pollution.
 *
 * `filterPR`, `openReviewPr` and `distill` all default their skip-audit writes to
 * DEFAULT_PIPELINE_LOG_PATH. Any spec that reaches a skip-audit write without
 * passing an explicit `logPath` appends real-looking entries to it (#146).
 *
 * The file is no longer tracked, so a stray entry can no longer be committed. What
 * it can still do is change a real run: `getProcessedPRs` reads this log, so a
 * leftover `prNumber: 1` from a test makes a `--resume` run skip PR 1 silently.
 *
 * The spec convention is to pass `logPath: tmpLogPath()` on every call, but a single
 * forgotten override is silent — the decision that writes the log is not always the
 * decision the test is asserting on. Snapshot the file around the whole run so the
 * next omission fails loudly instead, and put it back so the failure costs nothing
 * beyond the run that reported it.
 */
let snapshot: string | null = null;

function readLog(): string | null {
  try {
    return fs.readFileSync(DEFAULT_PIPELINE_LOG_PATH, 'utf8');
  } catch {
    return null;
  }
}

function describeLog(contents: string | null): string {
  if (contents === null) {
    return 'absent';
  }
  const lines = contents === '' ? 0 : contents.replace(/\n$/, '').split('\n').length;
  return `${lines} line(s)`;
}

/**
 * Put the log back the way `beforeAll` found it. A null snapshot means the file
 * was unreadable then, which in practice means it did not exist, so the matching
 * restore is to remove whatever the run created.
 */
function restoreLog(): void {
  if (snapshot === null) {
    fs.rmSync(DEFAULT_PIPELINE_LOG_PATH, { force: true });
    return;
  }
  fs.writeFileSync(DEFAULT_PIPELINE_LOG_PATH, snapshot);
}

export const mochaHooks = {
  beforeAll(): void {
    snapshot = readLog();
  },

  afterAll(): void {
    const after = readLog();
    if (after === snapshot) {
      return;
    }
    restoreLog();
    throw new Error(
      `Test run modified the pipeline log at ${DEFAULT_PIPELINE_LOG_PATH} ` +
      `(before: ${describeLog(snapshot)}, after: ${describeLog(after)}).\n` +
      'A spec reached a skip-audit write without an explicit `logPath`. Pass one — ' +
      'see `tmpLogPath()` in test/scripts/filter.spec.ts. The log itself has already ' +
      'been restored, so only the missing override needs fixing.'
    );
  },
};
