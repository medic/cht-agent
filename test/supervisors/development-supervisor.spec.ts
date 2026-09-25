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
import { CodeGenHaltError } from '../../src/layers/code-gen/interface';
import { WorkspaceSafetyError } from '../../src/layers/code-gen/modules/claude-code-cli/workspace';

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
  honorsCustomTools: false,
  modelName: 'test-model',
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
};

/**
 * Build a supervisor instance with the CodeGenerationAgent class substituted at
 * the module level. The agent's generate method is a sinon stub the test can
 * program per scenario.
 */
const buildSupervisorWithStubAgents = (
  generateImpl: sinon.SinonStub,
) => {
  class FakeCodeGenAgent {
    generate = generateImpl;
  }
  const mod = proxyquire('../../src/supervisors/development-supervisor', {
    '../agents/code-generation-agent': { CodeGenerationAgent: FakeCodeGenAgent },
  });
  const supervisor = new mod.DevelopmentSupervisor({
    llmProvider: mkMockLLM(),
  });
  return supervisor as unknown as SupervisorPrivateAccess & {
    writeToStaging: (state: DevelopmentState) => Promise<{ stagingPath: string; writtenFiles: string[] }>;
    writeToChtCore: (state: DevelopmentState, chtCorePath: string) => Promise<string[]>;
    clearStaging: (stagingPath: string) => Promise<void>;
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

  it('stops the whole run on a halt error instead of retrying code generation', async () => {
    const halt = new CodeGenHaltError('cht-core rollback failed; the stash is kept');
    const generate = sinon.stub().rejects(halt);
    const supervisor = buildSupervisorWithStubAgents(generate) as unknown as {
      develop: (input: DevelopmentInput) => Promise<DevelopmentState>;
    };

    let thrown: unknown;
    try {
      await supervisor.develop(baseValidInputFragment as DevelopmentInput);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).to.equal(halt);
    expect(generate.callCount).to.equal(1);
  });

  it('keeps a rollback warning from an earlier iteration when a later one has none', async () => {
    const warning = 'Rollback could not remove these session files: "nr/"';
    const generate = sinon.stub().resolves(mkCodeGenResult([mkFile('src/a.ts')]));
    const supervisor = buildSupervisorWithStubAgents(generate);
    const earlier = { ...mkCodeGenResult([mkFile('src/a.ts')]), warnings: [warning] };

    const out = await supervisor.codeGenerationNode(mkDevState({
      ...baseValidInputFragment,
      codeGeneration: earlier,
      iterationCount: 1,
    }));

    expect((out.codeGeneration as CodeGenerationResult).warnings).to.deep.equal([warning]);
  });

  it('prints the warnings of an earlier iteration when a later iteration halts', async () => {
    const warning = 'Rollback could not remove these session files. Remove them before the next run: "nr/"';
    const halt = new CodeGenHaltError('rollback failed; the stash is kept');
    const generate = sinon.stub();
    generate.onFirstCall().resolves({ ...mkCodeGenResult([]), warnings: [warning] });
    generate.onSecondCall().rejects(halt);
    const supervisor = buildSupervisorWithStubAgents(generate) as unknown as {
      develop: (input: DevelopmentInput) => Promise<DevelopmentState>;
    };
    const warnSpy = sinon.stub(console, 'warn');

    let thrown: unknown;
    try {
      await supervisor.develop(baseValidInputFragment as DevelopmentInput);
    } catch (err) {
      thrown = err;
    } finally {
      warnSpy.restore();
    }
    expect(thrown).to.equal(halt);
    expect(generate.callCount).to.equal(2);
    const printed = warnSpy.getCalls().map(c => String(c.args[0]));
    expect(printed.filter(l => l.includes(warning))).to.deep.equal([`[Development Supervisor] ${warning}`]);
  });

  it('stops the run on a workspace safety error, which is a halt error', async () => {
    const stop = new WorkspaceSafetyError('reset', 'rollback failed; the stash is kept');
    const generate = sinon.stub().rejects(stop);
    const supervisor = buildSupervisorWithStubAgents(generate) as unknown as {
      develop: (input: DevelopmentInput) => Promise<DevelopmentState>;
      todos: { getAll: () => Array<{ id: string; status: string }> };
    };

    let thrown: unknown;
    try {
      await supervisor.develop(baseValidInputFragment as DevelopmentInput);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).to.equal(stop);
    expect(generate.callCount).to.equal(1);
    // The todo is failed before the halt leaves the node.
    expect(supervisor.todos.getAll().find(t => t.id === 'development-1')?.status).to.equal('failed');
  });

  it('keeps one copy of a warning that two iterations both report', async () => {
    const warning = 'Rollback could not remove these session files: "nr/"';
    const generate = sinon.stub().resolves({ ...mkCodeGenResult([mkFile('src/a.ts')]), warnings: [warning] });
    const supervisor = buildSupervisorWithStubAgents(generate);

    const out = await supervisor.codeGenerationNode(mkDevState({
      ...baseValidInputFragment,
      codeGeneration: { ...mkCodeGenResult([mkFile('src/a.ts')]), warnings: [warning] },
      iterationCount: 1,
    }));

    expect((out.codeGeneration as CodeGenerationResult).warnings).to.deep.equal([warning]);
  });

  it("keeps both iterations' warnings when they differ", async () => {
    const generate = sinon.stub().resolves({ ...mkCodeGenResult([mkFile('src/a.ts')]), warnings: ['second'] });
    const supervisor = buildSupervisorWithStubAgents(generate);

    const out = await supervisor.codeGenerationNode(mkDevState({
      ...baseValidInputFragment,
      codeGeneration: { ...mkCodeGenResult([mkFile('src/a.ts')]), warnings: ['first'] },
      iterationCount: 1,
    }));

    expect((out.codeGeneration as CodeGenerationResult).warnings).to.deep.equal(['first', 'second']);
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
    expect(out.validationResult).to.not.be.undefined;
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
});
