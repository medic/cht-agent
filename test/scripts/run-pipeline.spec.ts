import { expect } from 'chai';
import proxyquire from 'proxyquire';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

type ExecHandler = (file: string, args: string[]) => string;

interface PipelineMocks {
  exec?: ExecHandler;
  scrapePR?: (prNum: number, repo: string) => unknown;
  filterPR?: (pr: unknown) => Promise<{ decision: string; reason: string }>;
  distillPR?: (pr: unknown) => Promise<{ status: string; reason: string; outputPath?: string }>;
}

/**
 * Load run-pipeline.ts with its gh CLI and stage dependencies stubbed.
 * The IIFE is guarded by `require.main === module`, so importing is side-effect free.
 */
function loadPipeline(mocks: PipelineMocks = {}) {
  const fakePr = { prTitle: 'T', labels: [], fileList: [] };
  return proxyquire('../../src/scripts/run-pipeline', {
    dotenv: { config: () => ({}), '@noCallThru': true },
    'node:child_process': {
      execFileSync: ((file: string, args: string[]) =>
        mocks.exec ? mocks.exec(file, args) : '[]') as unknown,
      '@noCallThru': true,
    },
    './scraper': {
      scrapePR: mocks.scrapePR ?? (() => fakePr),
      '@noCallThru': true,
    },
    './filter': {
      filterPR: mocks.filterPR ?? (async () => ({ decision: 'skip', reason: 'not relevant' })),
      '@noCallThru': true,
    },
    './distiller': {
      distillPR:
        mocks.distillPR ?? (async () => ({ status: 'written', reason: 'ok', outputPath: '/tmp/x.md' })),
      '@noCallThru': true,
    },
  });
}

describe('run-pipeline parseArgs', () => {
  let originalArgv: string[];

  beforeEach(() => {
    originalArgv = process.argv;
  });

  afterEach(() => {
    process.argv = originalArgv;
  });

  function withArgv(extra: string[]): void {
    process.argv = ['node', 'run-pipeline.ts', ...extra];
  }

  it('applies defaults when no flags are given', () => {
    withArgv([]);
    const { parseArgs } = loadPipeline();
    const args = parseArgs();
    expect(args.prNumbers).to.be.undefined;
    expect(args.repo).to.equal('medic/cht-core');
    expect(args.lookbackHours).to.equal(24);
    expect(args.concurrency).to.equal(1);
    expect(args.resume).to.equal(false);
    expect(args.force).to.equal(false);
  });

  it('parses --pr, --repo, and --since', () => {
    withArgv(['--pr', '123', '--repo', 'medic/cht-core', '--since', '48']);
    const { parseArgs } = loadPipeline();
    const args = parseArgs();
    expect(args.prNumbers).to.deep.equal([123]);
    expect(args.repo).to.equal('medic/cht-core');
    expect(args.lookbackHours).to.equal(48);
  });

  it('parses a comma-separated --pr list', () => {
    withArgv(['--pr', '123,456,789']);
    const { parseArgs } = loadPipeline();
    expect(parseArgs().prNumbers).to.deep.equal([123, 456, 789]);
  });

  it('parses --last, --resume, and --force', () => {
    withArgv(['--last', '1000', '--resume', '--force', '--pr', '5']);
    const { parseArgs } = loadPipeline();
    const args = parseArgs();
    expect(args.last).to.equal(1000);
    expect(args.resume).to.equal(true);
    expect(args.force).to.equal(true);
  });

  it('clamps --concurrency to [1, 10]', () => {
    withArgv(['--concurrency', '4']);
    expect(loadPipeline().parseArgs().concurrency).to.equal(4);
    withArgv(['--concurrency', '99']);
    expect(loadPipeline().parseArgs().concurrency).to.equal(10);
  });

  it('throws on a non-numeric --pr in a list', () => {
    withArgv(['--pr', '123,oops']);
    const { parseArgs } = loadPipeline();
    expect(() => parseArgs()).to.throw(/Invalid --pr value/);
  });

  it('throws on a non-numeric --since instead of silently doing nothing', () => {
    withArgv(['--since', 'abc']);
    const { parseArgs } = loadPipeline();
    expect(() => parseArgs()).to.throw(/Invalid --since value/);
  });

  it('throws on a non-positive --since', () => {
    withArgv(['--since', '0']);
    const { parseArgs } = loadPipeline();
    expect(() => parseArgs()).to.throw(/Invalid --since value/);
  });

  it('throws when --since has no value', () => {
    withArgv(['--since']);
    const { parseArgs } = loadPipeline();
    expect(() => parseArgs()).to.throw(/Invalid --since value/);
  });

  it('throws on a non-numeric --pr', () => {
    withArgv(['--pr', 'oops']);
    const { parseArgs } = loadPipeline();
    expect(() => parseArgs()).to.throw(/Invalid --pr value/);
  });

  it('rejects a partially-numeric --since (no parseInt truncation)', () => {
    withArgv(['--since', '12abc']);
    const { parseArgs } = loadPipeline();
    expect(() => parseArgs()).to.throw(/Invalid --since value/);
  });

  it('rejects a decimal --since', () => {
    withArgv(['--since', '1.5']);
    const { parseArgs } = loadPipeline();
    expect(() => parseArgs()).to.throw(/Invalid --since value/);
  });

  it('rejects a partially-numeric --pr', () => {
    withArgv(['--pr', '123abc']);
    const { parseArgs } = loadPipeline();
    expect(() => parseArgs()).to.throw(/Invalid --pr value/);
  });

  it('rejects a --since value too large to be a safe integer', () => {
    withArgv(['--since', '9'.repeat(400)]);
    const { parseArgs } = loadPipeline();
    expect(() => parseArgs()).to.throw(/Invalid --since value/);
  });
});

describe('run-pipeline errorMessage', () => {
  it('returns the message of an Error', () => {
    const { errorMessage } = loadPipeline();
    expect(errorMessage(new Error('boom'))).to.equal('boom');
  });

  it('stringifies a non-Error value', () => {
    const { errorMessage } = loadPipeline();
    expect(errorMessage('raw')).to.equal('raw');
  });
});

describe('run-pipeline getRecentlyMergedPRs', () => {
  it('returns only PRs merged within the lookback window', () => {
    const recent = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1h ago
    const old = new Date(Date.now() - 100 * 60 * 60 * 1000).toISOString(); // 100h ago
    const { getRecentlyMergedPRs } = loadPipeline({
      exec: (_file, args) => {
        expect(args[0]).to.equal('pr');
        expect(args).to.include('--state');
        return JSON.stringify([
          { number: 1, mergedAt: recent },
          { number: 2, mergedAt: old },
        ]);
      },
    });
    expect(getRecentlyMergedPRs('medic/cht-core', 24)).to.deep.equal([1]);
  });
});

describe('run-pipeline processSinglePR', () => {
  let logs: string[];
  let originalLog: typeof console.log;

  beforeEach(() => {
    logs = [];
    originalLog = console.log;
    console.log = (...a: unknown[]) => { logs.push(a.join(' ')); };
  });

  afterEach(() => {
    console.log = originalLog;
  });

  it('stops after filter when the decision is not distill', async () => {
    let distilled = false;
    const { processSinglePR } = loadPipeline({
      filterPR: async () => ({ decision: 'skip', reason: 'noise' }),
      distillPR: async () => { distilled = true; return { status: 'written', reason: 'ok' }; },
    });
    await processSinglePR(7, 'medic/cht-core');
    expect(distilled).to.equal(false);
    expect(logs.join('\n')).to.include('filter: skip');
  });

  it('distills and logs the output path when the decision is distill', async () => {
    const { processSinglePR } = loadPipeline({
      filterPR: async () => ({ decision: 'distill', reason: 'relevant' }),
      distillPR: async () => ({ status: 'written', reason: 'done', outputPath: '/tmp/out.md' }),
    });
    await processSinglePR(8, 'medic/cht-core');
    expect(logs.join('\n')).to.include('output: /tmp/out.md');
  });

  it('bypasses the filter under --force and distills directly', async () => {
    let filtered = false;
    let distilled = false;
    const { processSinglePR } = loadPipeline({
      filterPR: async () => { filtered = true; return { decision: 'skip', reason: 'would-skip' }; },
      distillPR: async () => { distilled = true; return { status: 'written', reason: 'ok', outputPath: '/tmp/f.md' }; },
    });
    await processSinglePR(9, 'medic/cht-core', true);
    expect(filtered).to.equal(false);
    expect(distilled).to.equal(true);
    expect(logs.join('\n')).to.include('BYPASSED (--force)');
  });
});

describe('run-pipeline filterResumable', () => {
  const baseArgs = { repo: 'medic/cht-core', lookbackHours: 24, concurrency: 1 };

  it('returns the list unchanged when --resume is absent', () => {
    const { filterResumable } = loadPipeline();
    const out = filterResumable([1, 2, 3], { ...baseArgs, resume: false, force: false }, new Set([2]));
    expect(out).to.deep.equal([1, 2, 3]);
  });

  it('drops already-processed PRs under --resume', () => {
    const { filterResumable } = loadPipeline();
    const out = filterResumable([1, 2, 3], { ...baseArgs, resume: true, force: false }, new Set([2]));
    expect(out).to.deep.equal([1, 3]);
  });

  it('exempts explicitly named --pr from the resume skip when --force is set', () => {
    const { filterResumable } = loadPipeline();
    const out = filterResumable(
      [1, 2],
      { ...baseArgs, resume: true, force: true, prNumbers: [1, 2] },
      new Set([1, 2])
    );
    expect(out).to.deep.equal([1, 2]);
  });
});

describe('run-pipeline runPipeline', () => {
  let originalLog: typeof console.log;
  let originalError: typeof console.error;
  let originalExit: typeof process.exit;
  let exitCode: number | undefined;

  beforeEach(() => {
    originalLog = console.log;
    originalError = console.error;
    originalExit = process.exit;
    exitCode = undefined;
    console.log = () => {};
    console.error = () => {};
    process.exit = ((code?: number) => { exitCode = code; }) as typeof process.exit;
  });

  afterEach(() => {
    console.log = originalLog;
    console.error = originalError;
    process.exit = originalExit;
  });

  it('processes every PR and does not exit when all succeed', async () => {
    const seen: number[] = [];
    const { runPipeline } = loadPipeline({
      scrapePR: (prNum: number) => { seen.push(prNum); return { prTitle: 'T', labels: [], fileList: [] }; },
      filterPR: async () => ({ decision: 'skip', reason: 'x' }),
    });
    await runPipeline([10, 11], 'medic/cht-core');
    expect(seen).to.deep.equal([10, 11]);
    expect(exitCode).to.be.undefined;
  });

  it('prints a reconciliation summary line at the end of the run', async () => {
    const logs: string[] = [];
    console.log = (...a: unknown[]) => { logs.push(a.join(' ')); };
    const { runPipeline } = loadPipeline({
      scrapePR: (prNum: number) => ({ prTitle: `T${prNum}`, labels: [], fileList: [] }),
      filterPR: async () => ({ decision: 'skip', reason: 'x' }),
    });
    await runPipeline([12, 13], 'medic/cht-core');
    expect(logs.join('\n')).to.include('Reconciliation:');
  });

  it('counts a distilled draft with unverified file refs in the end-of-run summary', async () => {
    const logs: string[] = [];
    console.log = (...a: unknown[]) => { logs.push(a.join(' ')); };
    const { runPipeline } = loadPipeline({
      scrapePR: (prNum: number) => ({ prTitle: `T${prNum}`, labels: [], fileList: [] }),
      filterPR: async () => ({ decision: 'distill', reason: 'x' }),
      distillPR: async () => ({ status: 'written', reason: 'ok', outputPath: '/tmp/x.md', hallucinationRate: 1 }),
    });
    await runPipeline([14], 'medic/cht-core');
    expect(logs.join('\n')).to.include('1 draft(s) with unverified file ref(s)');
  });

  it('records a failure and exits 1 when a PR throws', async () => {
    const { runPipeline } = loadPipeline({
      scrapePR: () => { throw new Error('scrape failed'); },
    });
    await runPipeline([99], 'medic/cht-core');
    expect(exitCode).to.equal(1);
  });

  it('stops the batch and exits with the rate-limit code on a rate-limit error', async () => {
    const seen: number[] = [];
    const { runPipeline, RATE_LIMIT_EXIT_CODE } = loadPipeline({
      scrapePR: (prNum: number) => {
        seen.push(prNum);
        throw new Error('HTTP 429: rate limit exceeded');
      },
    });
    await runPipeline([10, 11, 12], 'medic/cht-core');
    expect(seen).to.deep.equal([10]); // stopped after the first, did not process 11/12
    expect(exitCode).to.equal(RATE_LIMIT_EXIT_CODE);
  });

  it('stops the batch on an authentication (401) error', async () => {
    const seen: number[] = [];
    const { runPipeline, RATE_LIMIT_EXIT_CODE } = loadPipeline({
      scrapePR: (prNum: number) => {
        seen.push(prNum);
        throw new Error('Claude CLI error: Failed to authenticate. API Error: 401 Invalid authentication credentials');
      },
    });
    await runPipeline([20, 21, 22], 'medic/cht-core');
    expect(seen).to.deep.equal([20]);
    expect(exitCode).to.equal(RATE_LIMIT_EXIT_CODE);
  });

  it('processes every PR under concurrency > 1', async () => {
    const seen: number[] = [];
    const { runPipeline } = loadPipeline({
      scrapePR: (prNum: number) => { seen.push(prNum); return { prTitle: 'T', labels: [], fileList: [] }; },
      filterPR: async () => ({ decision: 'skip', reason: 'x' }),
    });
    await runPipeline([1, 2, 3, 4], 'medic/cht-core', false, 2);
    expect(seen.sort((a, b) => a - b)).to.deep.equal([1, 2, 3, 4]);
    expect(exitCode).to.be.undefined;
  });
});

describe('run-pipeline getLastMergedPRs', () => {
  it('returns the newest merged PR numbers', () => {
    const { getLastMergedPRs } = loadPipeline({ exec: () => JSON.stringify([{ number: 5 }, { number: 6 }]) });
    expect(getLastMergedPRs('medic/cht-core', 2)).to.deep.equal([5, 6]);
  });
});

describe('run-pipeline prNumbersFromLog', () => {
  it('parses valid prNumbers, skipping blank/malformed/prNumber-less lines', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-log-'));
    const logPath = path.join(dir, 'skipped.ndjson');
    fs.writeFileSync(logPath, [
      JSON.stringify({ prNumber: 10, decision: 'skip' }),
      '',
      'not json',
      JSON.stringify({ decision: 'skip' }),
      JSON.stringify({ prNumber: 11 }),
    ].join('\n'));
    const { prNumbersFromLog } = loadPipeline();
    expect(prNumbersFromLog(logPath)).to.deep.equal([10, 11]);
  });

  it('returns [] when the log file is absent', () => {
    const { prNumbersFromLog } = loadPipeline();
    expect(prNumbersFromLog('/no/such/file.ndjson')).to.deep.equal([]);
  });
});

describe('run-pipeline skipEntriesForRun', () => {
  it('returns only entries whose prNumber is in the requested list', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-recon-'));
    const logPath = path.join(dir, 'skipped.ndjson');
    fs.writeFileSync(logPath, [
      JSON.stringify({ prNumber: 10, decision: 'skip', reason: 'a', timestamp: 't' }),
      JSON.stringify({ prNumber: 999, decision: 'skip', reason: 'not in this run', timestamp: 't' }),
      '',
      'not json',
      JSON.stringify({ prNumber: 11, decision: 'flag-for-human', reason: 'b', timestamp: 't' }),
    ].join('\n'));
    const { skipEntriesForRun } = loadPipeline();
    const entries: Array<{ prNumber: number }> = skipEntriesForRun([10, 11], logPath);
    expect(entries.map((e: { prNumber: number }) => e.prNumber)).to.deep.equal([10, 11]);
  });

  it('returns [] when the log file is absent', () => {
    const { skipEntriesForRun } = loadPipeline();
    expect(skipEntriesForRun([1], '/no/such/file.ndjson')).to.deep.equal([]);
  });

  it('excludes entries written before this run even for the same PR', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-recon-'));
    const logPath = path.join(dir, 'skipped.ndjson');
    const historical = JSON.stringify({ prNumber: 10, decision: 'skip', reason: 'old', timestamp: 't' }) + '\n';
    fs.writeFileSync(logPath, historical);
    fs.appendFileSync(logPath, JSON.stringify({ prNumber: 10, decision: 'flag-for-human', reason: 'new', timestamp: 't' }) + '\n');
    const { skipEntriesForRun } = loadPipeline();
    expect(skipEntriesForRun([10], logPath, Buffer.byteLength(historical)).map((entry: { reason: string }) => entry.reason))
      .to.deep.equal(['new']);
  });

  it('uses byte offsets when historical entries contain Unicode', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-recon-'));
    const logPath = path.join(dir, 'skipped.ndjson');
    const historical = JSON.stringify({ prNumber: 10, decision: 'skip', reason: 'old ✓', timestamp: 't' }) + '\n';
    fs.writeFileSync(logPath, historical);
    fs.appendFileSync(logPath, JSON.stringify({ prNumber: 10, decision: 'skip', reason: 'new', timestamp: 't' }) + '\n');
    const { skipEntriesForRun } = loadPipeline();
    expect(skipEntriesForRun([10], logPath, Buffer.byteLength(historical)).map((entry: { reason: string }) => entry.reason))
      .to.deep.equal(['new']);
  });
});

describe('run-pipeline prNumbersFromDrafts', () => {
  it('extracts PR numbers from <pr>-<slug>.md draft filenames, ignoring others', () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-pending-'));
    fs.mkdirSync(path.join(base, 'contacts'));
    fs.writeFileSync(path.join(base, 'contacts', '42-foo.md'), 'x');
    fs.writeFileSync(path.join(base, 'contacts', 'README.txt'), 'x');
    const { prNumbersFromDrafts } = loadPipeline();
    expect(prNumbersFromDrafts(base)).to.deep.equal([42]);
  });

  it('returns [] when the output dir is absent', () => {
    const { prNumbersFromDrafts } = loadPipeline();
    expect(prNumbersFromDrafts('/no/such/dir')).to.deep.equal([]);
  });
});

describe('run-pipeline getProcessedPRs', () => {
  it('returns a Set (union of log + draft PR numbers)', () => {
    const { getProcessedPRs } = loadPipeline();
    expect(getProcessedPRs()).to.be.instanceOf(Set);
  });
});

describe('run-pipeline resolvePrNumbers', () => {
  const base = { prNumbers: undefined, repo: 'medic/cht-core', lookbackHours: 24, last: undefined, resume: false, force: false, concurrency: 1 };

  it('uses an explicit --pr list as-is', () => {
    const { resolvePrNumbers } = loadPipeline();
    expect(resolvePrNumbers({ ...base, prNumbers: [1, 2] })).to.deep.equal([1, 2]);
  });

  it('fetches the newest --last PRs', () => {
    const { resolvePrNumbers } = loadPipeline({ exec: () => JSON.stringify([{ number: 9 }]) });
    expect(resolvePrNumbers({ ...base, last: 1 })).to.deep.equal([9]);
  });

  it('falls back to the --since lookback window', () => {
    const recent = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { resolvePrNumbers } = loadPipeline({ exec: () => JSON.stringify([{ number: 7, mergedAt: recent }]) });
    expect(resolvePrNumbers({ ...base })).to.deep.equal([7]);
  });
});
