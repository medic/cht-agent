import { expect } from 'chai';
import sinon from 'sinon';
import { ClaudeApiTestGenModule } from '../../../src/layers/test-gen/modules/claude-api';
import { TestGenModuleInput } from '../../../src/layers/test-gen/interface';
import { GeneratedFile } from '../../../src/types';
import { LLMProvider, LLMResponse, LLMMessage, InvokeOptions } from '../../../src/llm';

/**
 * M3 (C6): the truncation/continuation path. The rest of the suite pins the
 * no-continuation path; this drives generate() with a provider whose first
 * per-file response reports stopReason 'max_tokens', exercising the seam that
 * was entirely untested. Provider is honorsCustomTools=false and the input binds
 * no readFile/listDirectory, so the only invokes are plan, per-file, continuation(s),
 * checklist — a deterministic call sequence.
 */

const makeResp = (
  content: string,
  stopReason?: string,
  usage: { inputTokens: number; outputTokens: number } = { inputTokens: 100, outputTokens: 100 },
): LLMResponse => ({ content, model: 'test-model', usage, stopReason });

const makeProvider = (invoke: LLMProvider['invoke']): LLMProvider => ({
  providerType: 'anthropic',
  modelName: 'test-model',
  honorsCustomTools: false,
  invoke,
  async invokeWithMessages(_m: LLMMessage[], _o?: InvokeOptions): Promise<LLMResponse> {
    return { content: '', model: 'test-model' };
  },
  async invokeForJSON<T>(): Promise<T> {
    return {} as T;
  },
});

const PLAN = makeResp(
  `=== TEST PLAN ===
1. unit gen.spec.ts -> source.ts - Unit tests for the formatter under continuation
=== END TEST PLAN ===`,
);
const CHECKLIST = makeResp('{"checklist": []}');

const makeInput = (): TestGenModuleInput => {
  const generatedCode: GeneratedFile[] = [
    {
      relativePath: 'source.ts',
      content: 'export const f = (): string => "";',
      language: 'typescript',
      type: 'source',
      description: 'f under test',
      action: 'create',
    },
  ];
  return {
    ticket: {
      issue: {
        title: 'Continuation',
        type: 'feature',
        priority: 'medium',
        description: 'Exercise the continuation seam.',
        technical_context: { domain: 'contacts', components: [] },
        requirements: ['works'],
        acceptance_criteria: ['works'],
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

describe('test-gen continuation seam (M3, C6)', () => {
  afterEach(() => sinon.restore());

  it('assembles a truncated file across one continuation (happy path)', async () => {
    const first = makeResp(
      "import { expect } from 'chai';\ndescribe('x', () => {\n  it('works', () => {\n    expect(1).to",
      'max_tokens',
    );
    const cont = makeResp('.equal(1);\n  });\n});', 'end_turn');
    const invoke = sinon.stub();
    invoke.onCall(0).resolves(PLAN);
    invoke.onCall(1).resolves(first);
    invoke.onCall(2).resolves(cont);
    invoke.resolves(CHECKLIST);

    const out = await new ClaudeApiTestGenModule(makeProvider(invoke)).generate(makeInput());

    expect(out.files).to.have.length(1);
    expect(out.files[0].content).to.include('expect(1)');
    expect(out.files[0].content).to.include('.equal(1)');
  });

  it('does NOT preamble-strip a prose-looking continuation line (M3a)', async () => {
    // The continuation resumes a template literal; its first line reads like prose
    // ("Note continues here`;") and is followed by a column-0 code line, exactly
    // what stripReasoningPreamble would drop — which would leave the template
    // literal unterminated. The continuation-only parser must keep it verbatim.
    const first = makeResp(
      "import { expect } from 'chai';\ndescribe('x', () => {\n  it('keeps the line', () => {\n    const note = `Start of note",
      'max_tokens',
    );
    const cont = makeResp("Note continues here`;\nconst done = true;\nexpect(note).to.contain('note');\n  });\n});", 'end_turn');
    const invoke = sinon.stub();
    invoke.onCall(0).resolves(PLAN);
    invoke.onCall(1).resolves(first);
    invoke.onCall(2).resolves(cont);
    invoke.resolves(CHECKLIST);

    const out = await new ClaudeApiTestGenModule(makeProvider(invoke)).generate(makeInput());

    expect(out.files, 'the assembled file should parse and be accepted').to.have.length(1);
    expect(out.files[0].content).to.include('Note continues here');
  });

  it('treats a failed continuation call as a dropped file, not a truncated success (M3b)', async () => {
    const first = makeResp(
      "import { expect } from 'chai';\ndescribe('x', () => {\n  it('works', () => {\n    expect(1).to",
      'max_tokens',
    );
    const invoke = sinon.stub();
    invoke.onCall(0).resolves(PLAN);
    invoke.onCall(1).resolves(first);
    invoke.onCall(2).rejects(new Error('network blip'));
    invoke.resolves(CHECKLIST);

    const out = await new ClaudeApiTestGenModule(makeProvider(invoke)).generate(makeInput());

    // The original truncated content must NOT be accepted as a completed file.
    expect(out.files).to.have.length(0);
  });

  it('strips a dangling opening/closing fence around the assembled file (M3c)', async () => {
    // First response opens ```typescript without a balanced close (truncated), so
    // parseSingleFileContent cannot strip it; the continuation closes it with a
    // trailing ```. The assembled file must contain neither fence line.
    const first = makeResp(
      "```typescript\nimport { expect } from 'chai';\ndescribe('x', () => {\n  it('works', () => {\n    expect(1)",
      'max_tokens',
    );
    const cont = makeResp('.to.equal(1);\n  });\n});\n```', 'end_turn');
    const invoke = sinon.stub();
    invoke.onCall(0).resolves(PLAN);
    invoke.onCall(1).resolves(first);
    invoke.onCall(2).resolves(cont);
    invoke.resolves(CHECKLIST);

    const out = await new ClaudeApiTestGenModule(makeProvider(invoke)).generate(makeInput());

    expect(out.files).to.have.length(1);
    expect(out.files[0].content, 'no fence lines should survive').to.not.include('```');
    expect(out.files[0].content).to.include("import { expect } from 'chai'");
  });

  it('drops the file when the continuation budget is exhausted (over-budget cap)', async () => {
    const original = process.env.TEST_GEN_MAX_CONTINUATIONS;
    process.env.TEST_GEN_MAX_CONTINUATIONS = '2';
    try {
      const first = makeResp('import { expect } from "chai";\ndescribe("x", () => {', 'max_tokens');
      const stillTruncated = makeResp('// more, still truncated', 'max_tokens');
      const invoke = sinon.stub();
      invoke.onCall(0).resolves(PLAN);
      invoke.onCall(1).resolves(first);
      invoke.onCall(2).resolves(stillTruncated);
      invoke.onCall(3).resolves(stillTruncated);
      invoke.resolves(CHECKLIST);

      const out = await new ClaudeApiTestGenModule(makeProvider(invoke)).generate(makeInput());

      expect(out.files).to.have.length(0);
    } finally {
      if (original === undefined) delete process.env.TEST_GEN_MAX_CONTINUATIONS;
      else process.env.TEST_GEN_MAX_CONTINUATIONS = original;
    }
  });

  it('sums token usage across plan, first response, and continuation', async () => {
    const first = makeResp(
      "import { expect } from 'chai';\ndescribe('x', () => {\n  it('works', () => {\n    expect(1).to",
      'max_tokens',
      { inputTokens: 5, outputTokens: 5 },
    );
    const cont = makeResp('.equal(1);\n  });\n});', 'end_turn', { inputTokens: 7, outputTokens: 3 });
    const plan = makeResp(PLAN.content, undefined, { inputTokens: 10, outputTokens: 20 });
    const checklist = makeResp('{"checklist": []}', undefined, { inputTokens: 2, outputTokens: 8 });
    const invoke = sinon.stub();
    invoke.onCall(0).resolves(plan);
    invoke.onCall(1).resolves(first);
    invoke.onCall(2).resolves(cont);
    invoke.onCall(3).resolves(checklist);

    const out = await new ClaudeApiTestGenModule(makeProvider(invoke)).generate(makeInput());

    // 30 (plan) + 10 (first) + 10 (continuation) + 10 (checklist)
    expect(out.tokensUsed).to.equal(60);
  });
});
