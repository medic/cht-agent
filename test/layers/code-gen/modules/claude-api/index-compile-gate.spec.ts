/* eslint-disable @typescript-eslint/no-var-requires */
import { expect } from 'chai';
import * as sinon from 'sinon';
import {
  CodeGenModuleInput,
  CodeGenModuleOutput,
} from '../../../../../src/layers/code-gen/interface';
import { LLMProvider, LLMResponse, LLMMessage, InvokeOptions } from '../../../../../src/llm';

const proxyquire = require('proxyquire').noCallThru();
const MODULE_PATH = '../../../../../src/layers/code-gen/modules/claude-api/index';

// Drive the real generate() with a mock LLM but a STUBBED compile gate, so these
// tests exercise only the folding of the gate's result into the module output.
describe('ClaudeApiCodeGenModule generate() — compile gate folding', () => {
  let invokeStub: sinon.SinonStub;
  let gateStub: sinon.SinonStub;
  let mockProvider: LLMProvider;

  const makePlanResponse = (
    plan: Array<{ action: string; path: string; rationale: string }>,
  ): LLMResponse => {
    let body = '=== PLAN ===\n';
    plan.forEach((p, i) => {
      body += `${i + 1}. ${p.action} ${p.path} - ${p.rationale}\n`;
    });
    body += '=== END PLAN ===\n';
    return { content: body, model: 'test-model', usage: { inputTokens: 200, outputTokens: 100 } };
  };

  const makeFileResponse = (content: string): LLMResponse => ({
    content,
    model: 'test-model',
    usage: { inputTokens: 300, outputTokens: 400 },
  });

  const baseInput: CodeGenModuleInput = {
    ticket: {
      issue: {
        title: 'Add contact search filters',
        type: 'feature',
        priority: 'medium',
        description: 'Allow filtering contacts by status.',
        technical_context: { domain: 'contacts', components: ['webapp/modules/contacts'] },
        requirements: ['Add UI filters'],
        acceptance_criteria: ['Users can filter by status'],
        constraints: [],
      },
    },
    researchFindings: {
      documentationReferences: [],
      relevantExamples: [],
      suggestedApproaches: ['Extend query builder'],
      relatedDomains: ['contacts'],
      confidence: 0.8,
      source: 'local-docs',
    },
    contextFiles: [],
    orchestrationPlan: {
      summary: 'Add filters to contacts.',
      keyFindings: [],
      recommendedApproach: 'Extend contacts service.',
      estimatedComplexity: 'medium',
      phases: [],
      riskFactors: [],
      estimatedEffort: '1 day',
    },
    targetDirectory: '/tmp/cht-core',
  };

  const loadModule = (opts: { shutdown?: boolean } = {}) => {
    const stubs: Record<string, unknown> = { './compile-gate': { runApiCompileGate: gateStub } };
    if (opts.shutdown) {
      stubs['../../../../utils/shutdown'] = { isShutdownRequested: () => true };
    }
    const { ClaudeApiCodeGenModule } = proxyquire(MODULE_PATH, stubs);
    return new ClaudeApiCodeGenModule(mockProvider) as { generate: (i: CodeGenModuleInput) => Promise<CodeGenModuleOutput> };
  };

  beforeEach(() => {
    invokeStub = sinon.stub();
    invokeStub.onCall(0).resolves(makePlanResponse([
      { action: 'CREATE', path: 'webapp/x.ts', rationale: 'the file' },
    ]));
    invokeStub.resolves(makeFileResponse('export const x = 1;\n'));
    gateStub = sinon.stub().resolves({ passed: true, issues: [] });
    mockProvider = {
      providerType: 'anthropic',
      honorsCustomTools: false,
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

  afterEach(() => sinon.restore());

  it('calls the gate with (targetDirectory, files)', async () => {
    const mod = loadModule();
    const out = await mod.generate(baseInput);
    expect(gateStub.calledOnce).to.equal(true);
    expect(gateStub.firstCall.args[0]).to.equal('/tmp/cht-core');
    expect(gateStub.firstCall.args[1]).to.deep.equal(out.files);
  });

  it('folds compile failures into crossFileIssues', async () => {
    const issue = { filePath: 'webapp/x.ts', issueType: 'compile-error', description: 'TS2322 at line 1: nope' };
    gateStub.resolves({ passed: false, issues: [issue] });
    const out = await loadModule().generate(baseInput);
    expect(out.crossFileIssues).to.deep.equal([issue]);
    expect(out.compileGateSkipped).to.not.equal(true);
  });

  it('sets compileGateSkipped/reason on a gate skip and leaves crossFileIssues undefined', async () => {
    gateStub.resolves({ passed: true, issues: [], skipped: true, skipReason: 'cht-core is not a git repo' });
    const out = await loadModule().generate(baseInput);
    expect(out.compileGateSkipped).to.equal(true);
    expect(out.compileGateSkipReason).to.equal('cht-core is not a git repo');
    expect(out.crossFileIssues).to.be.undefined;
  });

  it('leaves crossFileIssues undefined and skip falsy on a clean pass', async () => {
    gateStub.resolves({ passed: true, issues: [] });
    const out = await loadModule().generate(baseInput);
    expect(out.crossFileIssues).to.be.undefined;
    expect(out.compileGateSkipped).to.not.equal(true);
  });

  it('does not call the gate when shutdown is requested', async () => {
    const mod = loadModule({ shutdown: true });
    await mod.generate(baseInput);
    expect(gateStub.called).to.equal(false);
  });
});
