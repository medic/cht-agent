import { expect } from 'chai';
import proxyquire from 'proxyquire';

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
    expect(args.prNumbers).to.equal(undefined);
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
    expect(exitCode).to.equal(undefined);
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
});
