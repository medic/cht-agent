import fs from 'fs';

import { DEFAULT_PIPELINE_LOG_PATH } from '../src/constants';

/**
 * Root hooks guarding the tracked pipeline skip-log against test pollution.
 *
 * `filterPR`, `openReviewPr` and `distill` all default their skip-audit writes to
 * DEFAULT_PIPELINE_LOG_PATH, which is a tracked file. Any spec that reaches a
 * skip-audit write without passing an explicit `logPath` appends real-looking
 * entries to it, leaving the working tree permanently dirty and accumulating junk
 * in real pipeline data (#146).
 *
 * The spec convention is to pass `logPath: tmpLogPath()` on every call, but a single
 * forgotten override is silent — the decision that writes the log is not always the
 * decision the test is asserting on. Snapshot the file around the whole run so the
 * next omission fails loudly instead.
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

export const mochaHooks = {
  beforeAll(): void {
    snapshot = readLog();
  },

  afterAll(): void {
    const after = readLog();
    if (after === snapshot) {
      return;
    }
    throw new Error(
      `Test run modified the tracked pipeline log at ${DEFAULT_PIPELINE_LOG_PATH} ` +
      `(before: ${describeLog(snapshot)}, after: ${describeLog(after)}).\n` +
      'A spec reached a skip-audit write without an explicit `logPath`. Pass one — ' +
      'see `tmpLogPath()` in test/scripts/filter.spec.ts — rather than restoring the ' +
      'file by hand.'
    );
  },
};
