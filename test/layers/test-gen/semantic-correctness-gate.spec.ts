import { expect } from 'chai';
import sinon from 'sinon';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ClaudeApiTestGenModule } from '../../../src/layers/test-gen/modules/claude-api';
import { TestGenModuleInput } from '../../../src/layers/test-gen/interface';
import { GeneratedFile } from '../../../src/types';
import { LLMProvider, LLMResponse, LLMMessage, InvokeOptions } from '../../../src/llm';

/**
 * HARNESS section 8.3 semantic-correctness gate.
 *
 * Drives the real ClaudeApiTestGenModule.generate() with a stubbed LLM, takes
 * the emitted test file, and spawn-executes it (repo mocha + ts-node) against a
 * buggy and a fixed source. The emitted test must FAIL on buggy and PASS on
 * fixed. This proves the layer's generated tests catch bugs, not just pass CI.
 *
 * Fixtures: test/fixtures/test-gen/semantic-gate/ (see its README).
 */

const REPO = path.resolve(__dirname, '../../..');
const FIXTURES = path.resolve(__dirname, '../../fixtures/test-gen/semantic-gate');

// The canned test the stubbed LLM "emits" on the per-file call. It genuinely
// probes 1-indexed numbering: passes on source.fixed.ts, fails on source.buggy.ts.
// It imports the source under test from the per-run temp dir's ./source.
const CANNED_TEST = `import { expect } from 'chai';
import { formatListForPrompt } from './source';

describe('formatListForPrompt numbering', () => {
  it('numbers items starting at 1', () => {
    const out = formatListForPrompt(['apple', 'banana']);
    expect(out).to.include('1. apple');
    expect(out).to.include('2. banana');
    expect(out).to.not.include('0. apple');
  });
});
`;

const makeResponse = (content: string, stopReason?: string): LLMResponse => ({
  content,
  model: 'test-model',
  usage: { inputTokens: 100, outputTokens: 100 },
  stopReason,
});

// Plan call (onCall 0): one valid TEST_PLAN_ITEM_RE line, filePath ends .spec.ts,
// description >= 10 chars. Parses to a single-item plan -> no empty-plan bailout.
const PLAN_RESPONSE = makeResponse(
  `=== TEST PLAN ===
1. unit gen.spec.ts -> source.ts - Unit tests for formatListForPrompt numbering
=== END TEST PLAN ===`,
);

// Checklist call (onCall 2): valid JSON for RequirementsChecklistSchema (empty list ok).
const CHECKLIST_RESPONSE = makeResponse('{"checklist": []}');

const makeInput = (): TestGenModuleInput => {
  const generatedCode: GeneratedFile[] = [
    {
      relativePath: 'source.ts',
      content: 'export const formatListForPrompt = (): string => "";',
      language: 'typescript',
      type: 'source',
      description: 'formatListForPrompt under test',
      action: 'create',
    },
  ];
  return {
    ticket: {
      issue: {
        title: 'List numbering',
        type: 'feature',
        priority: 'medium',
        description: 'Format a list for prompts with 1-indexed numbering.',
        technical_context: { domain: 'contacts', components: [] },
        requirements: ['Number items starting at 1'],
        acceptance_criteria: ['First item is prefixed "1."'],
        constraints: [],
      },
    },
    researchFindings: {
      documentationReferences: [],
      relevantExamples: [],
      suggestedApproaches: [],
      relatedDomains: [],
      confidence: 0.5,
      source: 'local-docs',
    },
    orchestrationPlan: {
      summary: '',
      keyFindings: [],
      recommendedApproach: '',
      estimatedComplexity: 'medium',
      phases: [],
      riskFactors: [],
      estimatedEffort: '',
    },
    generatedCode,
    contextFiles: [],
    testTypes: ['unit'],
    targetDirectory: '/tmp/cht-core',
  };
};

/**
 * Write the emitted test plus the chosen source variant into a fresh temp dir
 * with a node_modules symlink, spawn the repo mocha against it, return the exit
 * code. Exit-code only (no stdout parsing); ENOENT/timeout/signal throw so they
 * can never masquerade as a passing exit 0.
 */
const runEmittedTest = (emittedContent: string, variant: 'buggy' | 'fixed'): number => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-semgate-'));
  try {
    fs.symlinkSync(path.join(REPO, 'node_modules'), path.join(tmp, 'node_modules'), 'dir');
    fs.copyFileSync(path.join(FIXTURES, 'tsconfig.json'), path.join(tmp, 'tsconfig.json'));
    fs.copyFileSync(path.join(FIXTURES, `source.${variant}.ts`), path.join(tmp, 'source.ts'));
    fs.writeFileSync(path.join(tmp, 'gen.spec.ts'), emittedContent, 'utf-8');

    const res = spawnSync(
      path.join(REPO, 'node_modules/.bin/mocha'),
      ['--no-config', '--require', 'ts-node/register', '--extension', 'ts', path.join(tmp, 'gen.spec.ts')],
      {
        cwd: tmp,
        env: { ...process.env, TS_NODE_PROJECT: path.join(tmp, 'tsconfig.json') },
        encoding: 'utf-8',
        stdio: 'pipe',
        timeout: 30000,
      },
    );

    if (res.error) {
      throw res.error;
    }
    if (res.signal) {
      throw new Error(`inner mocha killed by signal ${res.signal} (variant=${variant})`);
    }
    return res.status ?? 1;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
};

describe('test-gen semantic-correctness gate (HARNESS 8.3)', () => {
  let invokeStub: sinon.SinonStub;
  let mockProvider: LLMProvider;

  beforeEach(() => {
    invokeStub = sinon.stub();
    invokeStub.onCall(0).resolves(PLAN_RESPONSE);
    invokeStub.onCall(1).resolves(makeResponse(CANNED_TEST, 'end_turn'));
    invokeStub.onCall(2).resolves(CHECKLIST_RESPONSE);
    mockProvider = {
      providerType: 'anthropic',
      modelName: 'test-model',
      honorsCustomTools: true,
      invoke: invokeStub,
      async invokeWithMessages(_messages: LLMMessage[], _options?: InvokeOptions): Promise<LLMResponse> {
        return { content: '', model: 'test-model' };
      },
      async invokeForJSON<T>(): Promise<T> {
        return {} as T;
      },
    };
  });

  afterEach(() => {
    sinon.restore();
  });

  it('emits a test that fails on buggy source and passes on fixed source', async () => {
    const module = new ClaudeApiTestGenModule(mockProvider);
    const out = await module.generate(makeInput());

    // Pins the no-retry / no-continuation / no-tools path: plan, per-file, checklist.
    expect(invokeStub.callCount).to.equal(3);
    expect(out.files).to.have.length(1);
    expect(out.files[0].path).to.equal('gen.spec.ts');

    const emitted = out.files[0].content;
    // The emitted test must depend on the buggy behavior, not be a happy-path scaffold.
    expect(emitted).to.include('1. apple');

    const buggyExit = runEmittedTest(emitted, 'buggy');
    const fixedExit = runEmittedTest(emitted, 'fixed');

    // mocha exit code equals the failure count (clamped to 255): any nonzero is a fail.
    expect(buggyExit, 'emitted test must FAIL on buggy source').to.not.equal(0);
    expect(fixedExit, 'emitted test must PASS on fixed source').to.equal(0);
  }).timeout(60000);
});
