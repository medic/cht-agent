/* eslint-disable @typescript-eslint/no-var-requires */
import { expect } from 'chai';
import sinon from 'sinon';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  resolveValidateImplEdge,
  ValidateImplEdgeState,
} from '../../src/supervisors/development-supervisor';
import {
  CodeGenerationResult,
  DevelopmentInput,
  DevelopmentState,
  FileLanguage,
  FileType,
  GeneratedFile,
} from '../../src/types';
import { LLMProvider } from '../../src/llm';

const proxyquire = require('proxyquire').noCallThru();

const mkFile = (
  relativePath: string,
  content: string = '// ' + relativePath + '\n',
  type: FileType = 'source',
  language: FileLanguage = 'typescript',
): GeneratedFile => ({
  relativePath,
  content,
  language,
  type,
  description: '',
  action: 'create',
});

const mkCodeGenResult = (files: GeneratedFile[] = []): CodeGenerationResult => ({
  files,
  summary: 'mock summary',
  implementedRequirements: [],
  pendingRequirements: [],
  notes: [],
  confidence: 0.9,
});

const mkMockLLM = (): LLMProvider => ({
  providerType: 'anthropic',
  modelName: 'test-model',
  honorsCustomTools: true,
  invoke: async () => ({ content: '', model: 'test-model' }),
  invokeWithMessages: async () => ({ content: '', model: 'test-model' }),
  invokeForJSON: async <T>() => ({} as T),
});

describe('resolveValidateImplEdge (R17.4)', () => {
  const baseState: ValidateImplEdgeState = {
    validationResult: { overallScore: 90 },
    iterationCount: 0,
    codeGeneration: { crossFileIssues: [] },
  };

  it('returns __end__ when execute-no-op is present, even with iterations available', () => {
    const state: ValidateImplEdgeState = {
      ...baseState,
      validationResult: { overallScore: 30 }, // would normally trigger a loop
      iterationCount: 0,
      codeGeneration: {
        crossFileIssues: [
          { issueType: 'execute-no-op' },
          { issueType: 'plan-adherence-missing' }, // co-occurs naturally
        ],
      },
    };
    expect(resolveValidateImplEdge(state)).to.equal('__end__');
  });

  it('loops back to generateCode when score is below threshold and no execute-no-op', () => {
    const state: ValidateImplEdgeState = {
      ...baseState,
      validationResult: { overallScore: 50 },
      iterationCount: 0,
      codeGeneration: { crossFileIssues: [] },
    };
    expect(resolveValidateImplEdge(state)).to.equal('generateCode');
  });

  it('loops back to generateCode when other cross-file issues are present (e.g., compile-error)', () => {
    const state: ValidateImplEdgeState = {
      ...baseState,
      validationResult: { overallScore: 95 },
      iterationCount: 0,
      codeGeneration: {
        crossFileIssues: [{ issueType: 'compile-error' }],
      },
    };
    expect(resolveValidateImplEdge(state)).to.equal('generateCode');
  });

  it('returns __end__ on a clean high-score run with no issues', () => {
    expect(resolveValidateImplEdge(baseState)).to.equal('__end__');
  });

  it('returns __end__ when below threshold but iterations exhausted', () => {
    const state: ValidateImplEdgeState = {
      ...baseState,
      validationResult: { overallScore: 50 },
      iterationCount: 3, // MAX_ITERATIONS
      codeGeneration: { crossFileIssues: [] },
    };
    expect(resolveValidateImplEdge(state)).to.equal('__end__');
  });
});

/**
 * Bracket-access type for invoking private node handlers from tests.
 * Mirrors the LangGraph node return shape but uses unknown to stay decoupled
 * from the internal Annotation type (which would force us to import LangGraph
 * just to satisfy TS in tests).
 */
type SupervisorPrivateAccess = {
  codeGenerationNode: (state: unknown) => Promise<Record<string, unknown>>;
  validationNode: (state: unknown) => Promise<Record<string, unknown>>;
  testGenerationNode: (state: unknown) => Promise<Record<string, unknown>>;
};

/**
 * Build a supervisor instance with the CodeGenerationAgent class substituted at
 * the module level. The agent's generate method is a sinon stub the test can
 * program per scenario.
 */
const buildSupervisorWithStubAgents = (
  generateImpl: sinon.SinonStub,
  opts: { testGenImpl?: sinon.SinonStub; shutdownRequested?: boolean } = {},
) => {
  class FakeCodeGenAgent {
    generate = generateImpl;
  }
  const testGenerate = opts.testGenImpl ?? sinon.stub().resolves({
    files: [],
    explanation: '',
    requirementsChecklist: [],
  });
  class FakeTestGenAgent {
    generate = testGenerate;
  }
  const stubs: Record<string, unknown> = {
    '../agents/code-generation-agent': { CodeGenerationAgent: FakeCodeGenAgent },
    '../agents/test-generation-agent': { TestGenerationAgent: FakeTestGenAgent },
  };
  if (opts.shutdownRequested) {
    stubs['../utils/shutdown'] = { isShutdownRequested: () => true };
  }
  const mod = proxyquire('../../src/supervisors/development-supervisor', stubs);
  const supervisor = new mod.DevelopmentSupervisor({
    llmProvider: mkMockLLM(),
  });
  return supervisor as unknown as SupervisorPrivateAccess & {
    develop: (input: unknown) => Promise<DevelopmentState>;
    writeToStaging: (state: DevelopmentState) => Promise<{ stagingPath: string; writtenFiles: string[] }>;
    writeToChtCore: (state: DevelopmentState, chtCorePath: string) => Promise<string[]>;
    clearStaging: (stagingPath: string) => Promise<void>;
    getAllGeneratedFiles: (state: DevelopmentState) => GeneratedFile[];
  };
};

const mkDevState = (overrides: Partial<DevelopmentState> = {}): DevelopmentState => ({
  messages: [],
  currentPhase: 'init',
  errors: [],
  iterationCount: 0,
  ...overrides,
} as DevelopmentState);

const baseValidInputFragment = {
  issue: {
    issue: {
      title: 'Add filters',
      type: 'feature',
      priority: 'medium',
      description: 'd',
      technical_context: { domain: 'contacts', components: [] },
      requirements: ['r1'],
      acceptance_criteria: ['a1'],
      constraints: [],
    },
  },
  orchestrationPlan: {
    summary: '',
    keyFindings: [],
    recommendedApproach: '',
    estimatedComplexity: 'medium' as const,
    phases: [],
    riskFactors: [],
    estimatedEffort: '',
  },
  researchFindings: {
    documentationReferences: [],
    relevantExamples: [],
    suggestedApproaches: [],
    relatedDomains: [],
    confidence: 0.5,
    source: 'local-docs' as const,
  },
  contextAnalysis: {
    similarContexts: [],
    reusablePatterns: [],
    relevantDesignDecisions: [],
    recommendations: [],
    historicalSuccessRate: null,
    relatedDomains: [],
    codeContext: null,
  },
  options: { chtCorePath: '/tmp/cht-core', previewMode: true },
} as Partial<DevelopmentInput> & Pick<DevelopmentState, 'issue' | 'orchestrationPlan' | 'researchFindings' | 'contextAnalysis' | 'options'>;

describe('DevelopmentSupervisor codeGenerationNode (v9b.1)', () => {
  it('returns an error currentPhase when required state is missing', async () => {
    const generate = sinon.stub();
    const supervisor = buildSupervisorWithStubAgents(generate);

    const out = await supervisor.codeGenerationNode({ /* nothing */ });

    expect(out.errors).to.be.an('array').that.includes('Missing required data for code generation');
    expect(out.currentPhase).to.equal('init');
    expect(generate.called).to.equal(false);
  });

  it('delegates to CodeGenerationAgent.generate and exposes the result', async () => {
    const result = mkCodeGenResult([mkFile('src/a.ts')]);
    const generate = sinon.stub().resolves(result);
    const supervisor = buildSupervisorWithStubAgents(generate);

    const out = await supervisor.codeGenerationNode(mkDevState(baseValidInputFragment));

    expect(generate.calledOnce).to.equal(true);
    expect(out.codeGeneration).to.equal(result);
    expect(out.currentPhase).to.equal('validation');
    expect(out.iterationCount).to.equal(1);
  });

  it('captures errors from the agent and returns a code-generation error phase', async () => {
    const generate = sinon.stub().rejects(new Error('LLM down'));
    const supervisor = buildSupervisorWithStubAgents(generate);

    const out = await supervisor.codeGenerationNode(mkDevState(baseValidInputFragment));

    expect(out.errors).to.be.an('array');
    expect((out.errors as string[])[0]).to.match(/Code generation failed: LLM down/);
    expect(out.currentPhase).to.equal('code-generation');
  });

  it('passes validationFeedback as additionalContext on a retry iteration', async () => {
    const generate = sinon.stub().resolves(mkCodeGenResult());
    const supervisor = buildSupervisorWithStubAgents(generate);

    await supervisor.codeGenerationNode(mkDevState({
      ...baseValidInputFragment,
      validationFeedback: 'fix this',
      iterationCount: 1,
    }));

    expect(generate.firstCall.args[0].additionalContext).to.equal('fix this');
  });

  it('routes selective regeneration when perFileFeedback is present and iteration > 1', async () => {
    const generate = sinon.stub().resolves(mkCodeGenResult());
    const supervisor = buildSupervisorWithStubAgents(generate);
    const priorCodeGen = mkCodeGenResult([
      mkFile('keep.ts'),
      Object.assign(mkFile('bad.ts'), { action: 'modify' as const }),
    ]);

    await supervisor.codeGenerationNode(mkDevState({
      ...baseValidInputFragment,
      codeGeneration: priorCodeGen,
      iterationCount: 1,
      perFileFeedback: [
        { filePath: 'keep.ts', passed: true, issues: [] },
        { filePath: 'bad.ts', passed: false, issues: ['type error'] },
      ],
    }));

    const callArgs = generate.firstCall.args[0];
    expect(callArgs.passingFiles).to.have.length(1);
    expect(callArgs.passingFiles[0].relativePath).to.equal('keep.ts');
    expect(callArgs.failingFiles).to.deep.equal([{ path: 'bad.ts', action: 'modify' }]);
  });
});

describe('DevelopmentSupervisor validationNode (v9b.1)', () => {
  it('returns an error when required state is missing', async () => {
    const generate = sinon.stub();
    const supervisor = buildSupervisorWithStubAgents(generate);

    const out = await supervisor.validationNode({ /* nothing */ });

    expect(out.errors).to.be.an('array').that.includes('Missing required data for validation');
  });

  it('skips validation and returns a heuristic complete-phase when no files were generated', async () => {
    const generate = sinon.stub();
    const supervisor = buildSupervisorWithStubAgents(generate);

    const out = await supervisor.validationNode(mkDevState({
      ...baseValidInputFragment,
      codeGeneration: mkCodeGenResult([]), // empty files
    }));

    expect(out.currentPhase).to.equal('complete');
    expect(out.validationResult).to.not.equal(undefined);
  });
});

describe('DevelopmentSupervisor public file helpers (v9b.1)', () => {
  let scratch: string;

  beforeEach(async () => {
    scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'cht-agent-supervisor-test-'));
  });

  afterEach(async () => {
    await fs.rm(scratch, { recursive: true, force: true });
  });

  it('writeToStaging writes codeGeneration files to a fresh temp dir', async () => {
    const generate = sinon.stub();
    const supervisor = buildSupervisorWithStubAgents(generate);
    const state = mkDevState({
      ...baseValidInputFragment,
      codeGeneration: mkCodeGenResult([mkFile('src/a.ts', 'src-a\n')]),
    });

    const result = await supervisor.writeToStaging(state);
    try {
      expect(result.writtenFiles).to.have.length(1);
      expect(result.stagingPath.startsWith(os.tmpdir())).to.equal(true);
      const aContent = await fs.readFile(path.join(result.stagingPath, 'src/a.ts'), 'utf-8');
      expect(aContent).to.equal('src-a\n');
    } finally {
      await fs.rm(result.stagingPath, { recursive: true, force: true });
    }
  });

  it('writeToChtCore writes code files into the given path', async () => {
    const generate = sinon.stub();
    const supervisor = buildSupervisorWithStubAgents(generate);
    const state = mkDevState({
      ...baseValidInputFragment,
      codeGeneration: mkCodeGenResult([mkFile('src/a.ts', 'A\n')]),
    });

    const written = await supervisor.writeToChtCore(state, scratch);

    expect(written.sort()).to.deep.equal(['src/a.ts'].sort());
    expect(await fs.readFile(path.join(scratch, 'src/a.ts'), 'utf-8')).to.equal('A\n');
  });

  it('clearStaging removes the staging directory and tolerates missing dirs', async () => {
    const generate = sinon.stub();
    const supervisor = buildSupervisorWithStubAgents(generate);

    const stagePath = path.join(scratch, 'to-remove');
    await fs.mkdir(stagePath);
    await fs.writeFile(path.join(stagePath, 'f.txt'), 'x', 'utf-8');
    await supervisor.clearStaging(stagePath);

    let stillExists = true;
    try { await fs.stat(stagePath); } catch { stillExists = false; }
    expect(stillExists).to.equal(false);

    // Calling again on a now-missing path should not throw.
    let threw = false;
    try { await supervisor.clearStaging(stagePath); } catch { threw = true; }
    expect(threw).to.equal(false);
  });

  it('getAllGeneratedFiles returns codeGeneration files', async () => {
    const generate = sinon.stub();
    const supervisor = buildSupervisorWithStubAgents(generate);
    const state = mkDevState({
      ...baseValidInputFragment,
      codeGeneration: mkCodeGenResult([mkFile('src/a.ts')]),
    });
    const all = supervisor.getAllGeneratedFiles(state);
    expect(all.map(f => f.relativePath).sort()).to.deep.equal(['src/a.ts'].sort());
  });

  it('getAllGeneratedFiles returns an empty array when state has no codeGen', () => {
    const generate = sinon.stub();
    const supervisor = buildSupervisorWithStubAgents(generate);
    const all = supervisor.getAllGeneratedFiles(mkDevState());
    expect(all).to.deep.equal([]);
  });
});

describe('DevelopmentSupervisor testGeneration node (iter6, live)', () => {
  const emptyResult = { files: [], explanation: '', requirementsChecklist: [] };
  const cannedTestGen = {
    files: [mkFile('tests/unit/a.spec.ts', '// spec\n', 'test')],
    explanation: 'generated tests',
    requirementsChecklist: [],
  };
  const stateWithCode = () => mkDevState({
    ...baseValidInputFragment,
    codeGeneration: mkCodeGenResult([mkFile('src/a.ts')]),
  });

  it('runs the agent and returns its result on the happy path', async () => {
    const testGen = sinon.stub().resolves(cannedTestGen);
    const supervisor = buildSupervisorWithStubAgents(sinon.stub(), { testGenImpl: testGen });

    const out = await supervisor.testGenerationNode(stateWithCode());

    expect(testGen.calledOnce).to.equal(true);
    expect(out.currentPhase).to.equal('complete');
    expect(out.testGeneration).to.deep.equal(cannedTestGen);
  });

  it('no-ops on shutdown without calling the agent', async () => {
    const testGen = sinon.stub().resolves(cannedTestGen);
    const supervisor = buildSupervisorWithStubAgents(sinon.stub(), {
      testGenImpl: testGen,
      shutdownRequested: true,
    });

    const out = await supervisor.testGenerationNode(stateWithCode());

    expect(testGen.notCalled).to.equal(true);
    expect(out.currentPhase).to.equal('complete');
    expect(out.testGeneration).to.deep.equal(emptyResult);
  });

  it('no-ops on empty code-gen without calling the agent', async () => {
    const testGen = sinon.stub().resolves(cannedTestGen);
    const supervisor = buildSupervisorWithStubAgents(sinon.stub(), { testGenImpl: testGen });

    const state = mkDevState({
      ...baseValidInputFragment,
      codeGeneration: mkCodeGenResult([]),
    });
    const out = await supervisor.testGenerationNode(state);

    expect(testGen.notCalled).to.equal(true);
    expect(out.testGeneration).to.deep.equal(emptyResult);
  });

  it('is non-fatal when the agent throws: empty result, complete, no errors written', async () => {
    const testGen = sinon.stub().rejects(new Error('boom'));
    const supervisor = buildSupervisorWithStubAgents(sinon.stub(), { testGenImpl: testGen });

    const out = await supervisor.testGenerationNode(stateWithCode());

    expect(testGen.calledOnce).to.equal(true);
    expect(out.currentPhase).to.equal('complete');
    expect(out.testGeneration).to.deep.equal(emptyResult);
    expect(out.errors).to.equal(undefined);
    expect(out.validationFeedback).to.equal(undefined);
    expect(out.perFileFeedback).to.equal(undefined);
  });

  it('is reached once after the refinement loop exhausts and populates testGeneration', async () => {
    // mkMockLLM.invokeForJSON returns {}, so every validation scores 0 and the
    // resolver loops back to generateCode until iterations exhaust, then routes
    // the terminal branch through generateTests to END.
    const generate = sinon.stub().resolves(mkCodeGenResult([mkFile('src/a.ts')]));
    const testGen = sinon.stub().resolves(cannedTestGen);
    const supervisor = buildSupervisorWithStubAgents(generate, { testGenImpl: testGen });

    const finalState = await supervisor.develop(baseValidInputFragment);

    expect(generate.callCount).to.equal(3); // refinement loop re-entered generateCode each iteration
    expect(finalState.iterationCount).to.equal(3); // MAX_ITERATIONS — loop ran and exhausted
    expect(finalState.currentPhase).to.equal('complete'); // generateTests owns the terminal phase
    expect(testGen.calledOnce).to.equal(true);
    expect(finalState.testGeneration).to.deep.equal(cannedTestGen);
  });
});
