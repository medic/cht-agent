import { expect } from 'chai';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'node:fs';
import Ajv from 'ajv';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const matter = require('gray-matter') as typeof import('gray-matter');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const addFormats = require('ajv-formats') as (ajv: Ajv) => void;
import type { ScrapedPR, DistillDraft, DistillResult, DistillOptions } from '../../src/types/pipeline';

const proxyquire = require('proxyquire').noCallThru();

// ---------------------------------------------------------------------------
// Schema validator (mirrors validate-schema.ts logic)
// ---------------------------------------------------------------------------

const SCHEMA_PATH = path.join(__dirname, '..', '..', 'agent-memory', 'schema.json');

function buildValidator() {
  const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  const ajv = new Ajv({ strict: false, allErrors: true });
  addFormats(ajv);
  return ajv.compile({
    ...schema.definitions.frontmatter,
    definitions: schema.definitions,
  });
}

function normalizeFrontmatter(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    out[k] = v instanceof Date ? v.toISOString().slice(0, 10) : v;
  }
  if ('lastUpdated' in out && !('last_updated' in out)) {
    out.last_updated = out.lastUpdated;
    delete out.lastUpdated;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal valid ScrapedPR */
function makePR(overrides: Partial<ScrapedPR> = {}): ScrapedPR {
  return {
    prNumber: 42,
    prTitle: 'fix: prevent duplicate contact creation on slow networks',
    prBody: 'Fixes a race condition where slow networks caused duplicate contacts.',
    author: 'alice',
    labels: ['Type: Bug'],
    mergeSha: 'abc123',
    mergedAt: '2025-01-15T10:00:00Z',
    fileList: ['webapp/src/services/contacts.js', 'api/src/controllers/people.js'],
    diff: '',
    linkedIssues: [{ number: 99, body: 'Duplicate contacts appear when network is slow', comments: [] }],
    reviewComments: [],
    ...overrides,
  };
}

/** Valid DistillDraft for injection */
function makeDraft(overrides: Partial<DistillDraft> = {}): DistillDraft {
  return {
    domain: 'contacts',
    title: 'Prevent duplicate contact creation on slow networks',
    category: 'bug',
    summary: 'Race condition in contact creation caused duplicates on slow networks.',
    tags: ['contacts', 'race-condition'],
    entities: ['webapp/src/services/contacts.js', 'api/src/controllers/people.js'],
    concepts: ['optimistic-locking', 'idempotency'],
    problem: 'On slow networks, rapid successive POSTs created duplicate contact records.',
    rootCause: 'The contact creation endpoint lacked idempotency checks before inserting.',
    solution: 'Added a deduplication guard using a client-generated correlation ID.',
    codePatterns: 'Correlation ID passed in header; server checks for existing record before insert.',
    designChoices: 'Client-side ID chosen over server-side locking to avoid DB contention.',
    relatedFiles: ['webapp/src/services/contacts.js', 'api/src/controllers/people.js'],
    ...overrides,
  };
}

/** Unique tmp directory for isolation */
function tmpOutputDir(): string {
  return path.join(os.tmpdir(), `distiller-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

/** Unique tmp log path */
function tmpLogPath(): string {
  return path.join(os.tmpdir(), `distiller-skip-${Date.now()}-${Math.random().toString(36).slice(2)}.ndjson`);
}

/**
 * Load distiller module via proxyquire, replacing both LangChain providers with no-ops.
 * The distillFn option is used in tests instead of the real LLM.
 */
function loadDistiller(fakeInvoke?: (prompt: string) => Promise<unknown>) {
  const fakeLLMClass = fakeInvoke
    ? class FakeLLM {
      constructor(_opts: unknown) {}
      withStructuredOutput(_schema: unknown) { return { invoke: fakeInvoke }; }
    }
    : class FakeLLM {
      constructor(_opts: unknown) {}
      withStructuredOutput(_schema: unknown) {
        return { invoke: async () => makeDraft() };
      }
    };

  return proxyquire('../../src/scripts/distiller', {
    '@langchain/anthropic': { ChatAnthropic: fakeLLMClass },
    '@langchain/openai': { ChatOpenAI: fakeLLMClass },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('distillPR', () => {

  // --- Happy path ---

  describe('valid draft via distillFn', () => {
    it('should write draft file and return written status', async () => {
      const { distillPR } = loadDistiller();
      const outputDir = tmpOutputDir();
      const result: DistillResult = await distillPR(makePR(), {
        outputDir,
        logPath: tmpLogPath(),
        distillFn: async () => makeDraft(),
      });

      expect(result.status).to.equal('written');
      expect(result.outputPath).to.be.a('string');
      expect(fs.existsSync(result.outputPath!)).to.equal(true);
    });

    it('should place the file under _pending/<domain>/', async () => {
      const { distillPR } = loadDistiller();
      const outputDir = tmpOutputDir();
      const result: DistillResult = await distillPR(makePR(), {
        outputDir,
        logPath: tmpLogPath(),
        distillFn: async () => makeDraft({ domain: 'contacts' }),
      });

      expect(result.outputPath).to.include(path.join('contacts'));
    });

    it('should use prNumber in the filename', async () => {
      const { distillPR } = loadDistiller();
      const outputDir = tmpOutputDir();
      const result: DistillResult = await distillPR(makePR({ prNumber: 42 }), {
        outputDir,
        logPath: tmpLogPath(),
        distillFn: async () => makeDraft(),
      });

      expect(path.basename(result.outputPath!)).to.match(/^42-/);
    });

    it('should create output directory if it does not exist', async () => {
      const { distillPR } = loadDistiller();
      const outputDir = tmpOutputDir(); // does not exist yet
      await distillPR(makePR(), {
        outputDir,
        logPath: tmpLogPath(),
        distillFn: async () => makeDraft(),
      });

      expect(fs.existsSync(path.join(outputDir, 'contacts'))).to.equal(true);
    });

    it('should overwrite an existing draft file (idempotent re-distillation)', async () => {
      const { distillPR } = loadDistiller();
      const outputDir = tmpOutputDir();
      const logPath = tmpLogPath();
      const opts: DistillOptions = { outputDir, logPath, distillFn: async () => makeDraft() };

      // First run
      const r1 = await distillPR(makePR(), opts);
      fs.writeFileSync(r1.outputPath!, '# stale content');

      // Second run — should overwrite
      const r2 = await distillPR(makePR(), { ...opts, distillFn: async () => makeDraft({ title: 'Updated title' }) });
      const content = fs.readFileSync(r2.outputPath!, 'utf8');
      expect(content).to.not.include('# stale content');
      expect(content).to.include('Updated title');
    });
  });

  // --- Schema validity ---

  describe('generated markdown', () => {
    it('should produce frontmatter that passes AJV schema validation', async () => {
      const { distillPR } = loadDistiller();
      const validate = buildValidator();
      const outputDir = tmpOutputDir();

      const result: DistillResult = await distillPR(makePR(), {
        outputDir,
        logPath: tmpLogPath(),
        distillFn: async () => makeDraft(),
      });

      const content = fs.readFileSync(result.outputPath!, 'utf8');
      const parsed = matter(content);
      const data = normalizeFrontmatter(parsed.data as Record<string, unknown>);
      const valid = validate(data);
      expect(valid, JSON.stringify(validate.errors)).to.equal(true);
    });

    it('should include all required markdown sections', async () => {
      const { distillPR } = loadDistiller();
      const outputDir = tmpOutputDir();

      const result: DistillResult = await distillPR(makePR(), {
        outputDir,
        logPath: tmpLogPath(),
        distillFn: async () => makeDraft(),
      });

      const content = fs.readFileSync(result.outputPath!, 'utf8');
      for (const section of ['## Problem', '## Root Cause', '## Solution', '## Code Patterns', '## Design Choices', '## Related Files']) {
        expect(content).to.include(section);
      }
    });

    it('should populate provenance frontmatter fields', async () => {
      const { distillPR } = loadDistiller();
      const outputDir = tmpOutputDir();

      const result: DistillResult = await distillPR(makePR({ prNumber: 42, mergeSha: 'deadbeef' }), {
        outputDir,
        logPath: tmpLogPath(),
        distillFn: async () => makeDraft(),
      });

      const content = fs.readFileSync(result.outputPath!, 'utf8');
      const fm = matter(content).data as Record<string, unknown>;
      expect(fm.source_pr).to.equal('medic/cht-core#42');
      expect(fm.source_sha).to.equal('deadbeef');
      expect(fm.distilled_at).to.match(/^\d{4}-\d{2}-\d{2}$/);
      expect(fm.reviewed_by).to.equal(null);
      expect(fm.reviewed_at).to.equal(null);
      expect(fm.confidence).to.equal('medium');
      expect(fm.stale).to.equal(false);
    });
  });

  // --- Error handling ---

  describe('distillFn throws', () => {
    it('should return flag-for-human when distillFn throws', async () => {
      const { distillPR } = loadDistiller();
      const logPath = tmpLogPath();

      const result: DistillResult = await distillPR(makePR(), {
        outputDir: tmpOutputDir(),
        logPath,
        distillFn: async () => { throw new Error('LLM timeout'); },
      });

      expect(result.status).to.equal('flag-for-human');
      expect(result.reason).to.include('LLM timeout');
    });

    it('should write a skip log entry when distillFn throws', async () => {
      const { distillPR } = loadDistiller();
      const logPath = tmpLogPath();

      await distillPR(makePR({ prNumber: 99 }), {
        outputDir: tmpOutputDir(),
        logPath,
        distillFn: async () => { throw new Error('network error'); },
      });

      expect(fs.existsSync(logPath)).to.equal(true);
      const entry = JSON.parse(fs.readFileSync(logPath, 'utf8').trim());
      expect(entry.prNumber).to.equal(99);
      expect(entry.decision).to.equal('flag-for-human');
    });

    it('should not throw from distillPR even on LLM failure', async () => {
      const { distillPR } = loadDistiller();
      let threw = false;
      try {
        await distillPR(makePR(), {
          outputDir: tmpOutputDir(),
          logPath: tmpLogPath(),
          distillFn: async () => { throw new Error('boom'); },
        });
      } catch {
        threw = true;
      }
      expect(threw).to.equal(false);
    });

    it('should not write a draft file when distillFn throws', async () => {
      const { distillPR } = loadDistiller();
      const outputDir = tmpOutputDir();

      const result: DistillResult = await distillPR(makePR(), {
        outputDir,
        logPath: tmpLogPath(),
        distillFn: async () => { throw new Error('fail'); },
      });

      expect(result.outputPath).to.be.undefined;
    });
  });

  // --- No API key ---

  describe('no API key configured', () => {
    it('should return flag-for-human when no LLM key is available', async () => {
      const origOpenRouter = process.env.OPENROUTER_API_KEY;
      const origAnthropic = process.env.ANTHROPIC_API_KEY;
      delete process.env.OPENROUTER_API_KEY;
      delete process.env.ANTHROPIC_API_KEY;

      // Use proxyquire without distillFn to exercise the real LLM path (no-key branch)
      const { distillPR } = loadDistiller();
      const result: DistillResult = await distillPR(makePR(), {
        outputDir: tmpOutputDir(),
        logPath: tmpLogPath(),
        // no distillFn — falls through to real LLM chain which is null when no key
      });

      if (origOpenRouter !== undefined) process.env.OPENROUTER_API_KEY = origOpenRouter;
      if (origAnthropic !== undefined) process.env.ANTHROPIC_API_KEY = origAnthropic;

      expect(result.status).to.equal('flag-for-human');
      expect(result.reason).to.include('API key');
    });
  });

  // --- distillFn injection bypasses real chain ---

  describe('distillFn injection', () => {
    it('should call distillFn with the PR', async () => {
      const { distillPR } = loadDistiller();
      const calls: ScrapedPR[] = [];

      await distillPR(makePR({ prNumber: 7 }), {
        outputDir: tmpOutputDir(),
        logPath: tmpLogPath(),
        distillFn: async (pr: ScrapedPR) => { calls.push(pr); return makeDraft(); },
      });

      expect(calls).to.have.length(1);
      expect(calls[0].prNumber).to.equal(7);
    });
  });

});

// ---------------------------------------------------------------------------
// LLM chain path (through real llmDistill, mocked via proxyquire)
// ---------------------------------------------------------------------------

describe('LLM chain via OpenRouter (no distillFn)', () => {
  afterEach(() => {
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
  });

  it('should call OpenRouter chain and write draft when OPENROUTER_API_KEY is set', async () => {
    process.env.OPENROUTER_API_KEY = 'test-or-key';
    delete process.env.ANTHROPIC_API_KEY;

    const { distillPR } = loadDistiller(async () => makeDraft());

    const result: DistillResult = await distillPR(makePR(), {
      outputDir: tmpOutputDir(),
      logPath: tmpLogPath(),
    });

    expect(result.status).to.equal('written');
  });

  it('should call Anthropic chain when only ANTHROPIC_API_KEY is set', async () => {
    delete process.env.OPENROUTER_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'test-anthr-key';

    const { distillPR } = loadDistiller(async () => makeDraft());

    const result: DistillResult = await distillPR(makePR(), {
      outputDir: tmpOutputDir(),
      logPath: tmpLogPath(),
    });

    expect(result.status).to.equal('written');
  });

  it('should return flag-for-human when LLM invoke throws', async () => {
    process.env.OPENROUTER_API_KEY = 'test-or-key';

    const { distillPR } = loadDistiller(async () => { throw new Error('rate limit'); });

    const result: DistillResult = await distillPR(makePR(), {
      outputDir: tmpOutputDir(),
      logPath: tmpLogPath(),
    });

    expect(result.status).to.equal('flag-for-human');
    expect(result.reason).to.include('rate limit');
  });

  it('should handle non-Error thrown by LLM (covers err instanceof Error false branch)', async () => {
    process.env.OPENROUTER_API_KEY = 'test-or-key';

    const { distillPR } = loadDistiller(async () => { throw 'non-error failure'; });

    const result: DistillResult = await distillPR(makePR(), {
      outputDir: tmpOutputDir(),
      logPath: tmpLogPath(),
    });

    expect(result.status).to.equal('flag-for-human');
    expect(result.reason).to.include('non-error failure');
  });

  it('should build prompt without issue context when linkedIssues is empty (covers issueContext false branch)', async () => {
    process.env.OPENROUTER_API_KEY = 'test-or-key';

    const capturedPrompts: string[] = [];
    const { distillPR } = loadDistiller(async (prompt: string) => {
      capturedPrompts.push(prompt);
      return makeDraft();
    });

    await distillPR(
      makePR({ linkedIssues: [] }),
      { outputDir: tmpOutputDir(), logPath: tmpLogPath() }
    );

    expect(capturedPrompts[0]).to.not.include('Linked issues:');
  });

  it('should build prompt with undefined prBody (covers prBody null-coalescing branch)', async () => {
    process.env.OPENROUTER_API_KEY = 'test-or-key';

    const capturedPrompts: string[] = [];
    const { distillPR } = loadDistiller(async (prompt: string) => {
      capturedPrompts.push(prompt);
      return makeDraft();
    });

    await distillPR(
      makePR({ prBody: undefined }),
      { outputDir: tmpOutputDir(), logPath: tmpLogPath() }
    );

    expect(capturedPrompts[0]).to.include(`PR #42`);
  });

  it('should include issue bodies in prompt context (covers issueContext branch)', async () => {
    process.env.OPENROUTER_API_KEY = 'test-or-key';

    const capturedPrompts: string[] = [];
    const { distillPR } = loadDistiller(async (prompt: string) => {
      capturedPrompts.push(prompt);
      return makeDraft();
    });

    await distillPR(
      makePR({ linkedIssues: [{ number: 10, body: 'Issue about duplicates', comments: [] }] }),
      { outputDir: tmpOutputDir(), logPath: tmpLogPath() }
    );

    expect(capturedPrompts[0]).to.include('Issue #10');
  });

  it('should include review comments in prompt context (covers reviewContext branch)', async () => {
    process.env.OPENROUTER_API_KEY = 'test-or-key';

    const capturedPrompts: string[] = [];
    const { distillPR } = loadDistiller(async (prompt: string) => {
      capturedPrompts.push(prompt);
      return makeDraft();
    });

    await distillPR(
      makePR({ reviewComments: [{ author: 'bob', isOrgMember: true, body: 'LGTM, good fix' }] }),
      { outputDir: tmpOutputDir(), logPath: tmpLogPath() }
    );

    expect(capturedPrompts[0]).to.include('Review by bob');
  });

  it('should truncate file list to 50 in prompt (covers fileList slice branch)', async () => {
    process.env.OPENROUTER_API_KEY = 'test-or-key';

    const capturedPrompts: string[] = [];
    const { distillPR } = loadDistiller(async (prompt: string) => {
      capturedPrompts.push(prompt);
      return makeDraft();
    });

    const manyFiles = Array.from({ length: 60 }, (_, i) => `api/src/file${i}.ts`);

    await distillPR(
      makePR({ fileList: manyFiles }),
      { outputDir: tmpOutputDir(), logPath: tmpLogPath() }
    );

    expect(capturedPrompts[0]).to.include('60 total');
  });


});

// ---------------------------------------------------------------------------
// assembleDraft edge cases
// ---------------------------------------------------------------------------

describe('assembleDraft edge cases', () => {
  it('should emit _none_ for empty relatedFiles', async () => {
    const { distillPR } = loadDistiller();
    const outputDir = tmpOutputDir();

    const result: DistillResult = await distillPR(makePR(), {
      outputDir,
      logPath: tmpLogPath(),
      distillFn: async () => makeDraft({ relatedFiles: [] }),
    });

    const content = fs.readFileSync(result.outputPath!, 'utf8');
    expect(content).to.include('_none_');
  });
});

// ---------------------------------------------------------------------------
// slugify helper
// ---------------------------------------------------------------------------

describe('slugify', () => {
  it('should convert title to kebab-case slug', () => {
    const { slugify } = loadDistiller();
    expect(slugify('Fix: Prevent Duplicate Contact Creation')).to.equal('fix-prevent-duplicate-contact-creation');
  });

  it('should strip special characters', () => {
    const { slugify } = loadDistiller();
    expect(slugify('feat(contacts)!: add bulk create')).to.equal('featcontacts-add-bulk-create');
  });

  it('should truncate to 60 chars', () => {
    const { slugify } = loadDistiller();
    const long = 'a'.repeat(80);
    expect(slugify(long)).to.have.length(60);
  });

  it('should collapse consecutive hyphens', () => {
    const { slugify } = loadDistiller();
    expect(slugify('fix -- double hyphen')).to.equal('fix-double-hyphen');
  });
});
