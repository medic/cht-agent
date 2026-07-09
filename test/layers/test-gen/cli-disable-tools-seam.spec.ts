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
 * whose invoke records its InvokeOptions. The Phase-2 tool decision is gated on
 * the provider's honorsCustomTools capability (iter8): false for the CLI.
 *
 * The input binds readFile/listDirectory, so buildTestGenTools returns a
 * non-undefined {tools, toolHandler}. On a provider that does not honor custom
 * tools, the Phase-2 call must carry disableTools instead (the keystone fix);
 * a provider that honors them must keep the tools (A8).
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
=== END TEST PLAN ===`
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
  'end_turn'
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

const makeMockProvider = (
  invoke: LLMProvider['invoke'],
  honorsCustomTools: boolean
): LLMProvider => ({
  providerType: 'anthropic',
  modelName: 'test-model',
  honorsCustomTools,
  invoke,
  async invokeWithMessages(
    _messages: LLMMessage[],
    _options?: InvokeOptions
  ): Promise<LLMResponse> {
    return { content: '', model: 'test-model' };
  },
  async invokeForJSON<T>(): Promise<T> {
    return {} as T;
  },
});

describe('test-gen tool-use gate keys on honorsCustomTools (iter8 A2/A4)', () => {
  let invokeStub: sinon.SinonStub;

  beforeEach(() => {
    invokeStub = sinon.stub();
    invokeStub.onCall(0).resolves(PLAN_RESPONSE);
    invokeStub.onCall(1).resolves(PHASE2_RESPONSE);
    invokeStub.onCall(2).resolves(CHECKLIST_RESPONSE);
  });

  afterEach(() => {
    sinon.restore();
  });

  it('forces disableTools and no tools on every invoke when the provider does not honor custom tools', async () => {
    const module = new ClaudeApiTestGenModule(makeMockProvider(invokeStub, false));
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

  it('keeps tools on the Phase-2 call when the provider honors custom tools (no A8 regression)', async () => {
    const module = new ClaudeApiTestGenModule(makeMockProvider(invokeStub, true));
    await module.generate(makeToolBoundInput());

    expect(invokeStub.callCount).to.equal(3);
    const phase2 = invokeStub.getCall(1).args[1] as InvokeOptions;
    expect(phase2.tools, 'Phase-2 must carry tools when the provider honors them').to.be.an('array')
      .that.is.not.empty;
    expect(
      phase2.toolHandler,
      'Phase-2 must carry a toolHandler when the provider honors tools'
    ).to.be.a('function');
    expect(
      phase2.disableTools,
      'Phase-2 must not disable tools when the provider honors them'
    ).to.not.equal(true);
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
    const provider = makeMockProvider(invokeStub, true);

    const module = new ClaudeApiTestGenModule(provider);
    const out = await module.generate(makeToolBoundInput());

    expect(out.files).to.have.length(0);
    const checklistCalls = invokeStub
      .getCalls()
      .filter(
        (c) => (c.args[1] as InvokeOptions | undefined)?.temperature === CHECKLIST_TEMPERATURE
      );
    expect(checklistCalls, 'no Phase-3 checklist invoke when 0 files').to.have.length(0);
    expect(out.requirementsChecklist).to.deep.equal([]);
  });
});

describe('test-gen tool handler rejects unsafe paths (H3, C1)', () => {
  afterEach(() => sinon.restore());

  // Drive generate() on a honors-tools provider and capture the toolHandler wired
  // onto the Phase-2 invoke, with readFile/listDirectory as spies.
  const captureToolHandler = async (
    readFile: sinon.SinonStub,
    listDirectory: sinon.SinonStub,
  ): Promise<NonNullable<InvokeOptions['toolHandler']>> => {
    const invokeStub = sinon.stub();
    invokeStub.onCall(0).resolves(PLAN_RESPONSE);
    invokeStub.onCall(1).resolves(PHASE2_RESPONSE);
    invokeStub.onCall(2).resolves(CHECKLIST_RESPONSE);
    const module = new ClaudeApiTestGenModule(makeMockProvider(invokeStub, true));
    const input: TestGenModuleInput = { ...makeToolBoundInput(), readFile, listDirectory };
    await module.generate(input);
    const phase2 = invokeStub.getCall(1).args[1] as InvokeOptions;
    // resolveTargetPaths (F-A) legitimately calls readFile during generate() for
    // its existence check; reset the spies so the assertions below isolate what
    // the TOOL HANDLER does, not that earlier phase.
    readFile.resetHistory();
    listDirectory.resetHistory();
    return phase2.toolHandler!;
  };

  it('rejects a non-string path without calling readFile', async () => {
    const readFile = sinon.stub().resolves('secret');
    const listDirectory = sinon.stub().resolves([]);
    const handler = await captureToolHandler(readFile, listDirectory);
    const out = await handler('read_file', { path: 42 });
    expect(out).to.match(/must be a string/);
    expect(readFile.called).to.be.false;
  });

  it('rejects an absolute path (arbitrary read) without calling readFile', async () => {
    const readFile = sinon.stub().resolves('root:x:0:0:...');
    const listDirectory = sinon.stub().resolves([]);
    const handler = await captureToolHandler(readFile, listDirectory);
    const out = await handler('read_file', { path: '/etc/passwd' });
    expect(out).to.match(/absolute paths are not allowed/);
    expect(readFile.called).to.be.false;
  });

  it('rejects a traversal path without calling listDirectory', async () => {
    const readFile = sinon.stub().resolves(null);
    const listDirectory = sinon.stub().resolves(['secret-entry']);
    const handler = await captureToolHandler(readFile, listDirectory);
    const out = await handler('list_directory', { path: '../../etc' });
    expect(out).to.match(/escapes the workspace/);
    expect(listDirectory.called).to.be.false;
  });

  it('allows a valid relative path through to readFile', async () => {
    const readFile = sinon.stub().resolves('file contents');
    const listDirectory = sinon.stub().resolves([]);
    const handler = await captureToolHandler(readFile, listDirectory);
    const out = await handler('read_file', { path: 'api/src/controllers/contacts.js' });
    expect(readFile.calledOnceWithExactly('api/src/controllers/contacts.js')).to.be.true;
    expect(out).to.equal('file contents');
  });
});

describe('test-gen plan schema is authoritative (M1, C4)', () => {
  afterEach(() => sinon.restore());

  const makePlan = (items: string) =>
    makeResponse(`=== TEST PLAN ===\n${items}\n=== END TEST PLAN ===`, 'end_turn');

  it('drops an invalid plan item and surfaces a warning, keeping valid items', async () => {
    const invokeStub = sinon.stub();
    // Item 1 is valid (.spec path, 10+ char description); item 2 has a non-.spec
    // path so TestPlanItemSchema rejects it — it must be dropped with a warning,
    // not silently kept (the old validate-and-ignore behavior).
    invokeStub.onCall(0).resolves(makePlan(
      '1. unit tests/a.spec.ts -> src/a.ts - Cover the happy path thoroughly\n' +
      '2. unit tests/b.ts -> src/b.ts - Cover the error path thoroughly'
    ));
    invokeStub.onCall(1).resolves(PHASE2_RESPONSE);
    invokeStub.onCall(2).resolves(CHECKLIST_RESPONSE);
    const module = new ClaudeApiTestGenModule(makeMockProvider(invokeStub, false));

    const out = await module.generate(makeToolBoundInput());

    expect(out.files).to.have.length(1);
    expect(out.warnings ?? []).to.satisfy(
      (w: string[]) => w.some(s => /Dropped invalid test-plan item.*b\.ts/.test(s)),
      'a dropped plan item must surface a warning',
    );
  });
});

describe('test-gen never overwrites an existing spec (F-A, C1)', () => {
  afterEach(() => sinon.restore());

  // PLAN_RESPONSE plans exactly one file: gen.spec.ts.
  const wire = (readFile: (p: string) => Promise<string | null>) => {
    const invokeStub = sinon.stub();
    invokeStub.onCall(0).resolves(PLAN_RESPONSE);
    invokeStub.onCall(1).resolves(PHASE2_RESPONSE);
    invokeStub.onCall(2).resolves(CHECKLIST_RESPONSE);
    const module = new ClaudeApiTestGenModule(makeMockProvider(invokeStub, false));
    const input: TestGenModuleInput = { ...makeToolBoundInput(), readFile };
    return module.generate(input);
  };

  it('redirects to an .additional sibling when the canonical spec already exists', async () => {
    const out = await wire(async (p) => (p === 'gen.spec.ts' ? 'existing 744-line spec' : null));
    expect(out.files).to.have.length(1);
    expect(out.files[0].path).to.equal('gen.additional.spec.ts');
  });

  it('bumps a counter when the .additional sibling also already exists', async () => {
    const existing = new Set(['gen.spec.ts', 'gen.additional.spec.ts']);
    const out = await wire(async (p) => (existing.has(p) ? 'exists' : null));
    expect(out.files[0].path).to.equal('gen.additional.2.spec.ts');
  });

  it('keeps the canonical path when no spec exists at the target', async () => {
    const out = await wire(async () => null);
    expect(out.files[0].path).to.equal('gen.spec.ts');
  });
});

describe('test-gen first-gen parse hardening (F-B, C1)', () => {
  afterEach(() => sinon.restore());

  it('parses a CLI-style preamble+fence+trailing-prose response cleanly on the FIRST attempt', async () => {
    const messy = makeResponse(
      "Here's the test file you asked for:\n" +
      "```typescript\n" +
      "import { expect } from 'chai';\n" +
      "describe('seam', () => {\n  it('works', () => {\n    expect(1).to.equal(1);\n  });\n});\n" +
      "```\n" +
      "Hope this helps! Let me know if you need changes.",
      'end_turn',
    );
    const invokeStub = sinon.stub();
    invokeStub.onCall(0).resolves(PLAN_RESPONSE);
    invokeStub.onCall(1).resolves(messy);
    invokeStub.onCall(2).resolves(CHECKLIST_RESPONSE);
    const module = new ClaudeApiTestGenModule(makeMockProvider(invokeStub, false));

    const out = await module.generate(makeToolBoundInput());

    // plan + per-file + checklist = 3: the messy response parsed on the first
    // attempt (no retry burned), which is the F-B win.
    expect(invokeStub.callCount).to.equal(3);
    expect(out.files).to.have.length(1);
    const content = out.files[0].content;
    expect(content).to.include("import { expect } from 'chai'");
    expect(content).to.not.include('```');           // wrapping fence stripped
    expect(content).to.not.include('Hope this helps'); // trailing prose stripped
    expect(content.startsWith("Here's")).to.be.false;  // leading preamble stripped
  });
});

describe('test-gen routes the real parse-failure reason into the retry prompt (F-B, C2)', () => {
  afterEach(() => sinon.restore());

  it('feeds the specific parse reason (not a generic message) to the retry', async () => {
    const prose = makeResponse(
      'This is a description of what the test should verify, but it is only prose with no actual code at all.',
      'end_turn',
    );
    const invokeStub = sinon.stub();
    invokeStub.onCall(0).resolves(PLAN_RESPONSE);
    invokeStub.onCall(1).resolves(prose);            // fails looksLikeCodeContent -> unusable
    invokeStub.onCall(2).resolves(PHASE2_RESPONSE);  // retry recovers
    invokeStub.onCall(3).resolves(CHECKLIST_RESPONSE);
    const module = new ClaudeApiTestGenModule(makeMockProvider(invokeStub, false));

    const out = await module.generate(makeToolBoundInput());

    expect(out.files).to.have.length(1); // recovered on the retry
    const retryPrompt = invokeStub.getCall(2).args[0] as string;
    expect(retryPrompt).to.match(/did not parse as code/i); // the specific reason reached the prompt
    expect(retryPrompt).to.not.include('LLM call returned no usable content'); // not the old generic message
  });
});
