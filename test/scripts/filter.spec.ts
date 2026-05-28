import { expect } from 'chai';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'node:fs';
import * as sinon from 'sinon';
import type { ScrapedPR, FilterResult } from '../../src/types/pipeline';

const proxyquire = require('proxyquire').noCallThru();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal valid ScrapedPR for testing */
function makePR(overrides: Partial<ScrapedPR> = {}): ScrapedPR {
  return {
    prNumber: 1,
    prTitle: 'feat: add thing',
    prBody: 'Does stuff',
    author: 'alice',
    labels: [],
    mergeSha: 'abc',
    mergedAt: '2024-01-01T00:00:00Z',
    fileList: ['api/src/foo.ts'],
    diff: '',
    linkedIssues: [],
    reviewComments: [],
    ...overrides,
  };
}

/** A stub LinkedIssue for distill rule tests */
const LINKED_ISSUE = { number: 10, body: 'Issue body', comments: [] };

/**
 * Load the filter module via proxyquire with a fake ChatAnthropic.
 * fakeInvoke controls what withStructuredOutput().invoke() returns or throws.
 */
function loadFilter(fakeInvoke?: () => Promise<unknown>) {
  const fakeChatAnthropic = fakeInvoke
    ? class FakeChatAnthropic {
      constructor(_opts: unknown) {}
      withStructuredOutput(_schema: unknown) {
        return { invoke: fakeInvoke };
      }
    }
    : class FakeChatAnthropic {
      constructor(_opts: unknown) {}
      withStructuredOutput(_schema: unknown) {
        return {
          invoke: async () => ({ decision: 'distill', reason: 'LLM says distill' }),
        };
      }
    };

  return proxyquire('../../src/scripts/filter', {
    '@langchain/anthropic': { ChatAnthropic: fakeChatAnthropic },
  });
}

/** Unique tmpfile path for each test that needs real fs */
function tmpLogPath(): string {
  return path.join(os.tmpdir(), `filter-test-${Date.now()}-${Math.random().toString(36).slice(2)}.ndjson`);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('filterPR', () => {
  // --- SKIP rules ---

  describe('SKIP: bot author', () => {
    it('should return skip when author ends with [bot]', async () => {
      const { filterPR } = loadFilter();
      const logPath = tmpLogPath();
      const result: FilterResult = await filterPR(makePR({ author: 'dependabot[bot]' }), { logPath });
      expect(result.decision).to.equal('skip');
      expect(result.reason).to.include('Bot PR');
    });
  });

  describe('SKIP: revert PR', () => {
    it('should return skip for title starting with "Revert"', async () => {
      const { filterPR } = loadFilter();
      const logPath = tmpLogPath();
      const result: FilterResult = await filterPR(makePR({ prTitle: 'Revert "feat: something"' }), { logPath });
      expect(result.decision).to.equal('skip');
      expect(result.reason).to.equal('Revert PR');
    });
  });

  describe('SKIP: chore conventional commit', () => {
    it('should return skip for "chore: ..." title', async () => {
      const { filterPR } = loadFilter();
      const logPath = tmpLogPath();
      const result: FilterResult = await filterPR(makePR({ prTitle: 'chore: update deps' }), { logPath });
      expect(result.decision).to.equal('skip');
      expect(result.reason).to.include('chore');
    });
  });

  describe('SKIP: docs conventional commit', () => {
    it('should return skip for "docs(readme): ..." title', async () => {
      const { filterPR } = loadFilter();
      const logPath = tmpLogPath();
      const result: FilterResult = await filterPR(makePR({ prTitle: 'docs(readme): fix typo' }), { logPath });
      expect(result.decision).to.equal('skip');
      expect(result.reason).to.include('docs');
    });
  });

  describe('SKIP: ci conventional commit', () => {
    it('should return skip for "ci: ..." title', async () => {
      const { filterPR } = loadFilter();
      const logPath = tmpLogPath();
      const result: FilterResult = await filterPR(makePR({ prTitle: 'ci: add workflow' }), { logPath });
      expect(result.decision).to.equal('skip');
      expect(result.reason).to.include('ci');
    });
  });

  describe('SKIP: build conventional commit', () => {
    it('should return skip for "build(deps): ..." title', async () => {
      const { filterPR } = loadFilter();
      const logPath = tmpLogPath();
      const result: FilterResult = await filterPR(makePR({ prTitle: 'build(deps): bump version' }), { logPath });
      expect(result.decision).to.equal('skip');
      expect(result.reason).to.include('build');
    });
  });

  describe('SKIP: lockfile-only changes', () => {
    it('should return skip when only file is package-lock.json', async () => {
      const { filterPR } = loadFilter();
      const logPath = tmpLogPath();
      const result: FilterResult = await filterPR(makePR({ fileList: ['package-lock.json'] }), { logPath });
      expect(result.decision).to.equal('skip');
      expect(result.reason).to.equal('Lockfile-only changes');
    });
  });

  describe('SKIP: translation-only changes', () => {
    it('should return skip when only file is a .properties translation', async () => {
      const { filterPR } = loadFilter();
      const logPath = tmpLogPath();
      const result: FilterResult = await filterPR(
        makePR({ fileList: ['translations/en.properties'] }),
        { logPath }
      );
      expect(result.decision).to.equal('skip');
      expect(result.reason).to.equal('Translation-only changes');
    });
  });

  // --- DISTILL rules ---

  describe('DISTILL: bug + linked issue + multi-service', () => {
    it('should return distill for bug label with linked issue across multiple services', async () => {
      const { filterPR } = loadFilter();
      const result: FilterResult = await filterPR(makePR({
        labels: ['Type: Bug'],
        linkedIssues: [LINKED_ISSUE],
        fileList: ['api/a.ts', 'webapp/b.ts'],
      }));
      expect(result.decision).to.equal('distill');
      expect(result.reason).to.include('Bug');
    });
  });

  describe('DISTILL: feature + linked issue', () => {
    it('should return distill for feature label with linked issue', async () => {
      const { filterPR } = loadFilter();
      const result: FilterResult = await filterPR(makePR({
        labels: ['Type: Feature'],
        linkedIssues: [LINKED_ISSUE],
        fileList: ['api/a.ts'],
      }));
      expect(result.decision).to.equal('distill');
      expect(result.reason).to.include('Feature');
    });
  });

  describe('DISTILL: shared-libs + multi-service', () => {
    it('should return distill when shared-libs touches multiple services', async () => {
      const { filterPR } = loadFilter();
      const result: FilterResult = await filterPR(makePR({
        fileList: ['shared-libs/foo/index.ts', 'api/bar.ts', 'webapp/baz.ts'],
      }));
      expect(result.decision).to.equal('distill');
      expect(result.reason).to.include('Shared library');
    });
  });

  // --- touchesMultipleServices logic ---

  describe('touchesMultipleServices: single service does not trigger distill rule', () => {
    it('shared-libs bug with only api files should not match multi-service distill', async () => {
      const { filterPR } = loadFilter();
      // No labels, no linked issues — only shared-libs + api (2 services, but no bug label)
      // shared-libs + api IS 2 services, so the shared-libs rule WOULD fire
      // Use a non-shared-libs scenario: just api files only (1 service)
      const result: FilterResult = await filterPR(makePR({
        labels: ['Type: Bug'],
        linkedIssues: [LINKED_ISSUE],
        fileList: ['api/a.ts', 'api/b.ts'],
      }), { skipLlm: true });
      // Only 1 service (api/) — bug rule should NOT fire → falls through to skipLlm → flag-for-human
      expect(result.decision).to.equal('flag-for-human');
    });
  });

  describe('touchesMultipleServices: two services triggers distill rule', () => {
    it('should return distill when bug label + linked issue + api + webapp', async () => {
      const { filterPR } = loadFilter();
      const result: FilterResult = await filterPR(makePR({
        labels: ['Type: Bug'],
        linkedIssues: [LINKED_ISSUE],
        fileList: ['api/a.ts', 'webapp/b.ts'],
      }));
      expect(result.decision).to.equal('distill');
    });
  });

  // --- LLM triage via triageFn injection ---

  describe('LLM triage: triageFn returns distill', () => {
    it('should return distill and NOT write to log', async () => {
      const { filterPR } = loadFilter();
      const logPath = tmpLogPath();
      const triageFn = async (_pr: ScrapedPR): Promise<FilterResult> =>
        ({ decision: 'distill', reason: 'LLM decided distill' });
      const result: FilterResult = await filterPR(makePR(), { logPath, triageFn });
      expect(result.decision).to.equal('distill');
      // No log file written for distill
      expect(fs.existsSync(logPath)).to.equal(false);
    });
  });

  describe('LLM triage: triageFn returns skip', () => {
    it('should return skip and write a log entry', async () => {
      const { filterPR } = loadFilter();
      const logPath = tmpLogPath();
      const triageFn = async (_pr: ScrapedPR): Promise<FilterResult> =>
        ({ decision: 'skip', reason: 'LLM decided skip' });
      const result: FilterResult = await filterPR(makePR(), { logPath, triageFn });
      expect(result.decision).to.equal('skip');
      const line = fs.readFileSync(logPath, 'utf8').trim();
      const parsed = JSON.parse(line);
      expect(parsed.decision).to.equal('skip');
      expect(parsed.prNumber).to.equal(1);
      expect(parsed.reason).to.equal('LLM decided skip');
      expect(parsed.timestamp).to.be.a('string');
    });
  });

  describe('LLM triage: triageFn throws', () => {
    it('should return flag-for-human and write log when triageFn rejects', async () => {
      const { filterPR } = loadFilter();
      const logPath = tmpLogPath();
      const triageFn = async (_pr: ScrapedPR): Promise<FilterResult> => {
        throw new Error('triageFn exploded');
      };
      const result: FilterResult = await filterPR(makePR(), { logPath, triageFn });
      expect(result.decision).to.equal('flag-for-human');
      expect(result.reason).to.include('triageFn exploded');
      const line = fs.readFileSync(logPath, 'utf8').trim();
      const parsed = JSON.parse(line);
      expect(parsed.decision).to.equal('flag-for-human');
    });
  });

  // --- skipLlm ---

  describe('skipLlm: true', () => {
    it('should return flag-for-human and write log, without calling triageFn', async () => {
      const { filterPR } = loadFilter();
      const logPath = tmpLogPath();
      const triageSpy = sinon.spy(async (_pr: ScrapedPR): Promise<FilterResult> =>
        ({ decision: 'distill', reason: 'should not be called' })
      );
      const result: FilterResult = await filterPR(makePR(), { logPath, skipLlm: true, triageFn: triageSpy });
      expect(result.decision).to.equal('flag-for-human');
      expect(result.reason).to.equal('LLM triage skipped');
      expect(triageSpy.callCount).to.equal(0);
      const line = fs.readFileSync(logPath, 'utf8').trim();
      const parsed = JSON.parse(line);
      expect(parsed.decision).to.equal('flag-for-human');
    });
  });

  // --- _skipped.ndjson audit log assertions ---

  describe('_skipped.ndjson written for skip decisions', () => {
    it('should write a valid JSON line with prNumber, decision, reason, timestamp on skip', async () => {
      const { filterPR } = loadFilter();
      const logPath = tmpLogPath();
      await filterPR(makePR({ author: 'renovate[bot]' }), { logPath });
      const line = fs.readFileSync(logPath, 'utf8').trim();
      const parsed = JSON.parse(line);
      expect(parsed.prNumber).to.equal(1);
      expect(parsed.decision).to.equal('skip');
      expect(parsed.reason).to.be.a('string').and.not.empty;
      expect(parsed.timestamp).to.match(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  describe('_skipped.ndjson NOT written for distill decisions', () => {
    it('should not create the log file when result is distill', async () => {
      const { filterPR } = loadFilter();
      const logPath = tmpLogPath();
      await filterPR(makePR({
        labels: ['Type: Feature'],
        linkedIssues: [LINKED_ISSUE],
      }), { logPath });
      expect(fs.existsSync(logPath)).to.equal(false);
    });
  });

  // --- edge cases ---

  describe('empty prBody', () => {
    it('should not crash when triageFn receives a PR with empty body', async () => {
      const { filterPR } = loadFilter();
      const logPath = tmpLogPath();
      let receivedPR: ScrapedPR | undefined;
      const triageFn = async (pr: ScrapedPR): Promise<FilterResult> => {
        receivedPR = pr;
        return { decision: 'distill', reason: 'ok' };
      };
      await filterPR(makePR({ prBody: '' }), { logPath, triageFn });
      expect(receivedPR).to.not.be.undefined;
      expect(receivedPR!.prBody).to.equal('');
    });
  });

  // --- LLM triage via proxyquired ChatAnthropic (covers llmTriage branches) ---

  describe('llmTriage: missing ANTHROPIC_API_KEY returns flag-for-human', () => {
    let savedKey: string | undefined;

    beforeEach(() => {
      savedKey = process.env.ANTHROPIC_API_KEY;
      delete process.env.ANTHROPIC_API_KEY;
    });

    afterEach(() => {
      if (savedKey !== undefined) {
        process.env.ANTHROPIC_API_KEY = savedKey;
      } else {
        delete process.env.ANTHROPIC_API_KEY;
      }
    });

    it('should return flag-for-human and write log when API key is absent', async () => {
      const { filterPR } = loadFilter();
      const logPath = tmpLogPath();
      // No triageFn — exercises the real llmTriage path which checks for key
      const result: FilterResult = await filterPR(makePR(), { logPath });
      expect(result.decision).to.equal('flag-for-human');
      expect(result.reason).to.include('ANTHROPIC_API_KEY');
      const line = fs.readFileSync(logPath, 'utf8').trim();
      const parsed = JSON.parse(line);
      expect(parsed.decision).to.equal('flag-for-human');
    });
  });

  describe('llmTriage: ChatAnthropic invoke succeeds (via proxyquire)', () => {
    it('should return distill when LLM responds with distill decision', async () => {
      const savedKey = process.env.ANTHROPIC_API_KEY;
      process.env.ANTHROPIC_API_KEY = 'test-key-fake';

      try {
        const { filterPR } = loadFilter(async () => ({
          decision: 'distill',
          reason: 'Substantive change',
        }));
        const logPath = tmpLogPath();
        const result: FilterResult = await filterPR(makePR(), { logPath });
        expect(result.decision).to.equal('distill');
        expect(result.reason).to.equal('Substantive change');
        // distill → no log written
        expect(fs.existsSync(logPath)).to.equal(false);
      } finally {
        if (savedKey !== undefined) {
          process.env.ANTHROPIC_API_KEY = savedKey;
        } else {
          delete process.env.ANTHROPIC_API_KEY;
        }
      }
    });
  });

  describe('llmTriage: ChatAnthropic invoke throws (via proxyquire)', () => {
    it('should return flag-for-human and write log when LLM call throws', async () => {
      const savedKey = process.env.ANTHROPIC_API_KEY;
      process.env.ANTHROPIC_API_KEY = 'test-key-fake';

      try {
        const { filterPR } = loadFilter(async () => {
          throw new Error('Network error from LLM');
        });
        const logPath = tmpLogPath();
        const result: FilterResult = await filterPR(makePR(), { logPath });
        expect(result.decision).to.equal('flag-for-human');
        expect(result.reason).to.include('Network error from LLM');
        const line = fs.readFileSync(logPath, 'utf8').trim();
        const parsed = JSON.parse(line);
        expect(parsed.decision).to.equal('flag-for-human');
      } finally {
        if (savedKey !== undefined) {
          process.env.ANTHROPIC_API_KEY = savedKey;
        } else {
          delete process.env.ANTHROPIC_API_KEY;
        }
      }
    });
  });

  describe('llmTriage: ChatAnthropic invoke returns skip (via proxyquire)', () => {
    it('should return skip and write log when LLM responds with skip decision', async () => {
      const savedKey = process.env.ANTHROPIC_API_KEY;
      process.env.ANTHROPIC_API_KEY = 'test-key-fake';

      try {
        const { filterPR } = loadFilter(async () => ({
          decision: 'skip',
          reason: 'Trivial change',
        }));
        const logPath = tmpLogPath();
        const result: FilterResult = await filterPR(makePR(), { logPath });
        expect(result.decision).to.equal('skip');
        expect(result.reason).to.equal('Trivial change');
        const line = fs.readFileSync(logPath, 'utf8').trim();
        const parsed = JSON.parse(line);
        expect(parsed.decision).to.equal('skip');
      } finally {
        if (savedKey !== undefined) {
          process.env.ANTHROPIC_API_KEY = savedKey;
        } else {
          delete process.env.ANTHROPIC_API_KEY;
        }
      }
    });
  });

  // --- flag-for-human from LLM written to log ---

  describe('llmTriage: flag-for-human result written to log', () => {
    it('should write log when triageFn returns flag-for-human', async () => {
      const { filterPR } = loadFilter();
      const logPath = tmpLogPath();
      const triageFn = async (_pr: ScrapedPR): Promise<FilterResult> =>
        ({ decision: 'flag-for-human', reason: 'Ambiguous change' });
      const result: FilterResult = await filterPR(makePR(), { logPath, triageFn });
      expect(result.decision).to.equal('flag-for-human');
      const line = fs.readFileSync(logPath, 'utf8').trim();
      const parsed = JSON.parse(line);
      expect(parsed.decision).to.equal('flag-for-human');
      expect(parsed.reason).to.equal('Ambiguous change');
    });
  });
});
