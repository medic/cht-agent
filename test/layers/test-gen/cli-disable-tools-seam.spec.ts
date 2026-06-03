import { expect } from 'chai';
import sinon from 'sinon';
import { ClaudeApiTestGenModule } from '../../../src/layers/test-gen/modules/claude-api';
import { TestGenModuleInput } from '../../../src/layers/test-gen/interface';
import { GeneratedFile } from '../../../src/types';
import { LLMProvider, LLMResponse, LLMMessage, InvokeOptions } from '../../../src/llm';

/**
 * Iteration-7 module/provider seam test (manual-run finding A2/A4).
 *
 * The whole suite stubs at or above the provider boundary, so nothing else
 * exercises how the test-gen module's InvokeOptions behave per provider. This
 * drives ClaudeApiTestGenModule.generate() end to end with a fake LLMProvider
 * whose invoke records its InvokeOptions, gating on isUsingCLIProvider()
 * (process.env.LLM_PROVIDER === 'claude-cli').
 *
 * The input binds readFile/listDirectory, so buildTestGenTools returns a
 * non-undefined {tools, toolHandler}. Pre-fix the Phase-2 call would carry
 * those tools on every provider; post-fix it must carry disableTools instead
 * on the CLI path (the keystone fix). The API path must keep the tools (A8).
 */

const makeResponse = (content: string, stopReason?: string): LLMResponse => ({
  content,
  model: 'test-model',
  usage: { inputTokens: 100, outputTokens: 100 },
  stopReason,
});

// Plan (onCall 0): one valid TEST_PLAN_ITEM_RE line -> single-item plan.
const PLAN_RESPONSE = makeResponse(
  `=== TEST PLAN ===
1. unit gen.spec.ts -> source.ts - Unit tests for formatListForPrompt numbering
=== END TEST PLAN ===`,
);

// Per-file (onCall 1): minimal content that passes the content assertions
// (import + describe + it + expect) so it is accepted on the first attempt and
// the run does not retry, pinning callCount to plan + per-file + checklist.
const PHASE2_RESPONSE = makeResponse(
  `import { expect } from 'chai';
describe('seam', () => {
  it('passes', () => {
    expect(1).to.equal(1);
  });
});
`,
  'end_turn',
);

// Checklist (onCall 2): valid JSON for RequirementsChecklistSchema.
const CHECKLIST_RESPONSE = makeResponse('{"checklist": []}');

// Input with readFile/listDirectory bound, so buildTestGenTools is non-undefined.
const makeToolBoundInput = (): TestGenModuleInput => {
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
    readFile: async () => null,
    listDirectory: async () => [],
  };
};

describe('test-gen CLI disableTools seam (iter7 A2/A4)', () => {
  let invokeStub: sinon.SinonStub;
  let mockProvider: LLMProvider;
  let savedProvider: string | undefined;

  beforeEach(() => {
    savedProvider = process.env.LLM_PROVIDER;
    invokeStub = sinon.stub();
    invokeStub.onCall(0).resolves(PLAN_RESPONSE);
    invokeStub.onCall(1).resolves(PHASE2_RESPONSE);
    invokeStub.onCall(2).resolves(CHECKLIST_RESPONSE);
    mockProvider = {
      providerType: 'anthropic',
      modelName: 'test-model',
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
    if (savedProvider === undefined) {
      delete process.env.LLM_PROVIDER;
    } else {
      process.env.LLM_PROVIDER = savedProvider;
    }
    sinon.restore();
  });

  it('forces disableTools and no tools on every invoke on the CLI provider', async () => {
    process.env.LLM_PROVIDER = 'claude-cli';
    const module = new ClaudeApiTestGenModule(mockProvider);
    const out = await module.generate(makeToolBoundInput());

    // No retry / no continuation: plan, per-file, checklist.
    expect(invokeStub.callCount).to.equal(3);
    expect(out.files).to.have.length(1);

    for (let i = 0; i < invokeStub.callCount; i++) {
      const opts = invokeStub.getCall(i).args[1] as InvokeOptions;
      expect(opts.disableTools, `invoke #${i} must set disableTools`).to.equal(true);
      expect(opts.tools, `invoke #${i} must not carry tools`).to.equal(undefined);
      expect(opts.toolHandler, `invoke #${i} must not carry a toolHandler`).to.equal(undefined);
    }
  });

  it('keeps tools on the Phase-2 call on the API provider (no A8 regression)', async () => {
    delete process.env.LLM_PROVIDER; // not the CLI provider -> API path
    const module = new ClaudeApiTestGenModule(mockProvider);
    await module.generate(makeToolBoundInput());

    expect(invokeStub.callCount).to.equal(3);
    const phase2 = invokeStub.getCall(1).args[1] as InvokeOptions;
    expect(phase2.tools, 'Phase-2 must carry tools on the API path').to.be.an('array').that.is.not.empty;
    expect(phase2.toolHandler, 'Phase-2 must carry a toolHandler on the API path').to.be.a('function');
    expect(phase2.disableTools, 'Phase-2 must not disable tools on the API path').to.not.equal(true);
  });
});

describe('test-gen skips Phase-3 checklist when 0 files generated (iter7 C2/C3)', () => {
  // The checklist invoke is the only call that uses temperature 0.2 (plan and
  // per-file use 0.3), so its presence/absence is detectable without coupling to
  // the retry count.
  const CHECKLIST_TEMPERATURE = 0.2;

  afterEach(() => {
    sinon.restore();
  });

  it('makes no checklist invoke when generation yields 0 files', async () => {
    const invokeStub = sinon.stub();
    invokeStub.onCall(0).resolves(PLAN_RESPONSE);
    // Every per-file attempt returns prose that fails the content assertions
    // (no import/describe/it), so all retries fail and 0 files are produced.
    invokeStub.resolves(makeResponse('Unable to produce a test file for this source.'));
    const provider: LLMProvider = {
      providerType: 'anthropic',
      modelName: 'test-model',
      invoke: invokeStub,
      async invokeWithMessages(_messages: LLMMessage[], _options?: InvokeOptions): Promise<LLMResponse> {
        return { content: '', model: 'test-model' };
      },
      async invokeForJSON<T>(): Promise<T> {
        return {} as T;
      },
    };

    const module = new ClaudeApiTestGenModule(provider);
    const out = await module.generate(makeToolBoundInput());

    expect(out.files).to.have.length(0);
    const checklistCalls = invokeStub
      .getCalls()
      .filter(c => (c.args[1] as InvokeOptions | undefined)?.temperature === CHECKLIST_TEMPERATURE);
    expect(checklistCalls, 'no Phase-3 checklist invoke when 0 files').to.have.length(0);
    expect(out.requirementsChecklist).to.deep.equal([]);
  });
});
