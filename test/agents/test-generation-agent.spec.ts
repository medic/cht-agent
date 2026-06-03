import { expect } from 'chai';
import sinon from 'sinon';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  buildTestGenModuleInput,
  TestGenerationAgent,
  TestGenerationInput,
} from '../../src/agents/test-generation-agent';
import { CodeGenerationResult, GeneratedFile } from '../../src/types';
import { TestGenModuleRegistry } from '../../src/layers/test-gen/registry';
import { TestGenModule, TestGenModuleOutput } from '../../src/layers/test-gen/interface';
import { LLMProvider, LLMResponse, LLMMessage, InvokeOptions } from '../../src/llm';

const mkFile = (relativePath: string): GeneratedFile => ({
  relativePath,
  content: `// ${relativePath}\n`,
  language: 'typescript',
  type: 'source',
  description: 'x',
  action: 'create',
});

const mkCodeGen = (files: GeneratedFile[]): CodeGenerationResult => ({
  files,
  summary: '',
  implementedRequirements: [],
  pendingRequirements: [],
  notes: [],
  confidence: 0.9,
});

const baseInput = (overrides: Partial<TestGenerationInput> = {}): TestGenerationInput => ({
  issue: {
    issue: {
      title: 'List numbering',
      type: 'feature',
      priority: 'medium',
      description: 'd',
      technical_context: { domain: 'contacts', components: [] },
      requirements: ['r1'],
      acceptance_criteria: ['a1'],
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
  codeGeneration: mkCodeGen([mkFile('src/a.ts')]),
  chtCorePath: '/tmp/cht-core',
  ...overrides,
});

describe('buildTestGenModuleInput', () => {
  it('maps every field to the TestGenModuleInput shape', () => {
    const input = baseInput();
    const out = buildTestGenModuleInput(input);

    expect(out.ticket).to.equal(input.issue);
    expect(out.researchFindings).to.equal(input.researchFindings);
    expect(out.orchestrationPlan).to.equal(input.orchestrationPlan);
    expect(out.targetDirectory).to.equal('/tmp/cht-core');
  });

  it('passes generatedCode through unchanged (no conversion on the way in)', () => {
    const files = [mkFile('src/a.ts'), mkFile('src/b.ts')];
    const out = buildTestGenModuleInput(baseInput({ codeGeneration: mkCodeGen(files) }));

    expect(out.generatedCode).to.equal(files);
  });

  it("defaults testTypes to ['unit'] when absent", () => {
    expect(buildTestGenModuleInput(baseInput()).testTypes).to.deep.equal(['unit']);
  });

  it('respects an explicit testTypes value', () => {
    const out = buildTestGenModuleInput(baseInput({ testTypes: ['integration', 'e2e'] }));
    expect(out.testTypes).to.deep.equal(['integration', 'e2e']);
  });

  it('builds an external feedback contextFile only when additionalContext is set', () => {
    expect(buildTestGenModuleInput(baseInput()).contextFiles).to.deep.equal([]);

    const out = buildTestGenModuleInput(baseInput({ additionalContext: 'fix the off-by-one' }));
    expect(out.contextFiles).to.have.length(1);
    expect(out.contextFiles[0]).to.deep.equal({
      path: 'feedback/additional-context.md',
      content: 'fix the off-by-one',
      source: 'external',
    });
  });

  it('binds readFile/listDirectory as closures over chtCorePath', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-adapter-'));
    try {
      fs.writeFileSync(path.join(dir, 'hello.ts'), 'export const x = 1;\n', 'utf-8');
      const out = buildTestGenModuleInput(baseInput({ chtCorePath: dir }));

      expect(out.readFile).to.be.a('function');
      expect(out.listDirectory).to.be.a('function');
      expect(await out.readFile?.('hello.ts')).to.equal('export const x = 1;\n');
      expect(await out.readFile?.('nope.ts')).to.equal(null);
      expect(await out.listDirectory?.('.')).to.include('hello.ts');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

const cannedOutput: TestGenModuleOutput = {
  files: [
    { path: 'tests/unit/a.spec.ts', content: '// spec\n', purpose: 'unit tests for a' },
    { path: 'tests/fixtures/data.json', content: '{}\n' },
  ],
  explanation: 'generated 2 test files',
  tokensUsed: 321,
  modelUsed: 'fake-model',
  requirementsChecklist: [
    { requirement: 'r1', scenarios: [{ name: 'covers r1', type: 'happy-path', description: 'd' }] },
  ],
  warnings: ['heads up'],
};

describe('TestGenerationAgent', () => {
  let registry: TestGenModuleRegistry;
  let generateStub: sinon.SinonStub;
  let agent: TestGenerationAgent;

  const mockProvider: LLMProvider = {
    providerType: 'anthropic',
    modelName: 'test-model',
    honorsCustomTools: true,
    async invoke(): Promise<LLMResponse> {
      return { content: '', model: 'test-model' };
    },
    async invokeWithMessages(_messages: LLMMessage[], _options?: InvokeOptions): Promise<LLMResponse> {
      return { content: '', model: 'test-model' };
    },
    async invokeForJSON<T>(): Promise<T> {
      return {} as T;
    },
  };

  beforeEach(() => {
    registry = new TestGenModuleRegistry();
    generateStub = sinon.stub().resolves(cannedOutput);
    const fakeModule: TestGenModule = {
      name: 'claude-api',
      version: '0.0.0-test',
      generate: generateStub,
    };
    sinon.stub(registry, 'getActiveModule').returns(fakeModule);
    agent = new TestGenerationAgent({ llmProvider: mockProvider, testGenRegistry: registry });
  });

  afterEach(() => {
    sinon.restore();
  });

  it('converts module files to types-local GeneratedFile (type=test, action=create)', async () => {
    const result = await agent.generate(baseInput());

    expect(result.files).to.have.length(2);
    expect(result.files[0]).to.deep.equal({
      relativePath: 'tests/unit/a.spec.ts',
      content: '// spec\n',
      language: 'typescript',
      type: 'test',
      description: 'unit tests for a',
      action: 'create',
    });
  });

  it('defaults description to "" and infers language from the path extension', async () => {
    const result = await agent.generate(baseInput());

    expect(result.files[1]).to.deep.equal({
      relativePath: 'tests/fixtures/data.json',
      content: '{}\n',
      language: 'json',
      type: 'test',
      description: '',
      action: 'create',
    });
  });

  it('passes the requirementsChecklist through unchanged', async () => {
    const result = await agent.generate(baseInput());
    expect(result.requirementsChecklist).to.deep.equal(cannedOutput.requirementsChecklist);
  });

  it('maps explanation, warnings, tokensUsed and modelUsed from the module output', async () => {
    const result = await agent.generate(baseInput());

    expect(result.explanation).to.equal('generated 2 test files');
    expect(result.warnings).to.deep.equal(['heads up']);
    expect(result.tokensUsed).to.equal(321);
    expect(result.modelUsed).to.equal('fake-model');
  });

  it('builds the module input via buildTestGenModuleInput', async () => {
    const input = baseInput();
    await agent.generate(input);

    expect(generateStub.calledOnce).to.equal(true);
    const moduleInput = generateStub.firstCall.args[0];
    expect(moduleInput.ticket).to.equal(input.issue);
    expect(moduleInput.generatedCode).to.equal(input.codeGeneration.files);
    expect(moduleInput.testTypes).to.deep.equal(['unit']);
    expect(moduleInput.targetDirectory).to.equal('/tmp/cht-core');
  });
});

const cliProvider = (): LLMProvider => ({
  providerType: 'anthropic',
  modelName: 'cli',
  honorsCustomTools: false,
  async invoke(): Promise<LLMResponse> {
    return { content: '', model: 'cli' };
  },
  async invokeWithMessages(): Promise<LLMResponse> {
    return { content: '', model: 'cli' };
  },
  async invokeForJSON<T>(): Promise<T> {
    return {} as T;
  },
});

const registryReturning = (module: TestGenModule): TestGenModuleRegistry => {
  const registry = new TestGenModuleRegistry();
  sinon.stub(registry, 'getActiveModule').returns(module);
  return registry;
};

describe('TestGenerationAgent containment (iter8 Fix 2a)', () => {
  let repo: string;
  const git = (args: string[]): void => {
    execFileSync('git', args, { cwd: repo, stdio: 'pipe' });
  };

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-contain-'));
    git(['init', '-q']);
    git(['config', 'user.email', 'test@example.com']);
    git(['config', 'user.name', 'Test']);
    fs.writeFileSync(path.join(repo, 'README.md'), '# repo\n', 'utf-8');
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'init']);
  });

  afterEach(() => {
    sinon.restore();
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it('rolls back an out-of-band write while preserving the in-memory result', async () => {
    const strayModule: TestGenModule = {
      name: 'claude-api',
      version: '0.0.0-test',
      generate: async (moduleInput) => {
        // Simulate an uncontained subprocess write into the cht-core tree.
        fs.writeFileSync(path.join(moduleInput.targetDirectory, 'stray.spec.js'), '// leaked\n', 'utf-8');
        return {
          files: [{ path: 'tests/unit/legit.spec.ts', content: '// legit\n', purpose: 'legit' }],
          explanation: 'ok',
          requirementsChecklist: [],
        };
      },
    };
    const agent = new TestGenerationAgent({
      llmProvider: cliProvider(),
      testGenRegistry: registryReturning(strayModule),
    });

    const result = await agent.generate(baseInput({ chtCorePath: repo }));

    // The out-of-band write is reverted: working tree clean, stray file gone.
    const status = execFileSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf-8' });
    expect(status.trim(), 'working tree must be clean after rollback').to.equal('');
    expect(fs.existsSync(path.join(repo, 'stray.spec.js')), 'stray file must be removed').to.equal(false);

    // The legitimate in-memory output is preserved (captured before rollback).
    expect(result.files).to.have.length(1);
    expect(result.files[0].relativePath).to.equal('tests/unit/legit.spec.ts');
    expect(result.files[0].type).to.equal('test');
  });

  it('proceeds without containment when chtCorePath is not a git repo', async () => {
    const nonGit = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-nongit-'));
    try {
      const module: TestGenModule = {
        name: 'claude-api',
        version: '0.0.0-test',
        generate: async () => ({
          files: [{ path: 'tests/unit/legit.spec.ts', content: '// legit\n' }],
          explanation: 'ok',
          requirementsChecklist: [],
        }),
      };
      const agent = new TestGenerationAgent({
        llmProvider: cliProvider(),
        testGenRegistry: registryReturning(module),
      });

      // Snapshot fails on a non-git path; generation still returns its output.
      const result = await agent.generate(baseInput({ chtCorePath: nonGit }));
      expect(result.files).to.have.length(1);
    } finally {
      fs.rmSync(nonGit, { recursive: true, force: true });
    }
  });
});
