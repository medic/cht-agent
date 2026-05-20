import { expect } from 'chai';
import sinon from 'sinon';
import { EventEmitter } from 'events';
import { CodeGenerationAgent } from '../../src/agents/code-generation-agent';
import {
  CodeGenerationInput,
  IssueTemplate,
  OrchestrationPlan,
  ResearchFindings,
  ContextAnalysisResult,
} from '../../src/types';
import {
  CodeGenModule,
  CodeGenModuleInput,
  CodeGenModuleOutput,
} from '../../src/layers/code-gen/interface';
import { CodeGenModuleRegistry } from '../../src/layers/code-gen/registry';
import { LLMProvider, LLMResponse, LLMMessage, InvokeOptions } from '../../src/llm';
import * as staging from '../../src/utils/staging';

describe('CodeGenerationAgent', () => {
  let generateStub: sinon.SinonStub;
  let mockModule: CodeGenModule;
  let mockRegistry: CodeGenModuleRegistry;
  let mockProvider: LLMProvider;

  const createTestIssue = (): IssueTemplate => ({
    issue: {
      title: 'Add contact search filters',
      type: 'feature',
      priority: 'medium',
      description: 'Allow filtering contacts by status.',
      technical_context: {
        domain: 'contacts',
        components: ['api/controllers/contacts'],
      },
      requirements: ['Add UI filters', 'Support API filtering'],
      acceptance_criteria: ['Users can filter by status'],
      constraints: [],
    },
  });

  const createOrchestrationPlan = (): OrchestrationPlan => ({
    summary: 'Add filters.',
    keyFindings: [],
    recommendedApproach: 'Extend contacts service.',
    estimatedComplexity: 'medium',
    phases: [{
      name: 'API',
      description: 'Add filters.',
      estimatedComplexity: 'medium',
      suggestedComponents: [],
      dependencies: [],
    }],
    riskFactors: [],
    estimatedEffort: '1 day',
  });

  const createResearchFindings = (): ResearchFindings => ({
    documentationReferences: [],
    relevantExamples: [],
    suggestedApproaches: ['Extend query builder'],
    relatedDomains: ['contacts'],
    confidence: 0.8,
    source: 'local-docs',
  });

  const createContextAnalysis = (): ContextAnalysisResult => ({
    similarContexts: [],
    reusablePatterns: [],
    relevantDesignDecisions: [],
    recommendations: [],
    historicalSuccessRate: null,
    relatedDomains: [],
    codeContext: null,
  });

  const createInput = (overrides: Partial<CodeGenerationInput> = {}): CodeGenerationInput => ({
    issue: createTestIssue(),
    orchestrationPlan: createOrchestrationPlan(),
    researchFindings: createResearchFindings(),
    contextAnalysis: createContextAnalysis(),
    chtCorePath: '/tmp/cht-core',
    ...overrides,
  });

  beforeEach(() => {
    generateStub = sinon.stub();
    // v6 G.1 made claude-code-cli the registry default; name the mock module
    // to match so getActiveModule() (no arg) resolves to it.
    mockModule = {
      name: 'claude-code-cli',
      version: '1.0.0',
      generate: generateStub,
    };

    mockRegistry = new CodeGenModuleRegistry();
    mockRegistry.register(mockModule);

    mockProvider = {
      providerType: 'anthropic',
      modelName: 'test-model',
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
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('delegation to module', () => {
    it('should call module with correctly shaped CodeGenModuleInput', async () => {
      const moduleOutput: CodeGenModuleOutput = {
        files: [{
          path: 'api/controllers/contacts.js',
          content: 'module.exports = {};',
          purpose: 'Controller',
        }],
        explanation: 'Generated 1 file',
        modelUsed: 'test-model',
      };
      generateStub.resolves(moduleOutput);

      const agent = new CodeGenerationAgent({
        llmProvider: mockProvider,
        codeGenRegistry: mockRegistry,
      });

      await agent.generate(createInput());

      expect(generateStub.calledOnce).to.be.true;

      const moduleInput: CodeGenModuleInput = generateStub.firstCall.args[0];
      expect(moduleInput).to.have.property('ticket');
      expect(moduleInput.ticket.issue.title).to.equal('Add contact search filters');
      expect(moduleInput).to.have.property('researchFindings');
      expect(moduleInput).to.have.property('contextFiles').that.is.an('array');
      expect(moduleInput).to.have.property('orchestrationPlan');
      expect(moduleInput).to.have.property('targetDirectory', '/tmp/cht-core');
    });

    it('should map layer GeneratedFile to agent GeneratedFile with inferred metadata', async () => {
      const moduleOutput: CodeGenModuleOutput = {
        files: [
          { path: 'webapp/src/ts/services/filter.service.ts', content: 'export class FilterService {}', purpose: 'Filter service' },
          { path: 'api/src/controllers/contacts.js', content: 'module.exports = {};', purpose: 'API controller' },
          { path: 'test/unit/filter.spec.ts', content: 'describe("filter", () => {});', purpose: 'Filter tests' },
        ],
        explanation: 'Generated 3 files',
      };
      generateStub.resolves(moduleOutput);

      const agent = new CodeGenerationAgent({
        llmProvider: mockProvider,
        codeGenRegistry: mockRegistry,
      });

      const result = await agent.generate(createInput());

      expect(result.files).to.have.length(3);

      // TypeScript file (new file → create)
      const tsFile = result.files.find(f => f.relativePath.endsWith('.ts') && !f.relativePath.includes('spec'));
      expect(tsFile).to.exist;
      expect(tsFile!.language).to.equal('typescript');
      expect(tsFile!.type).to.equal('source');
      expect(tsFile!.description).to.equal('Filter service');
      expect(tsFile!.action).to.equal('create');

      // JavaScript file
      const jsFile = result.files.find(f => f.relativePath.endsWith('.js'));
      expect(jsFile).to.exist;
      expect(jsFile!.language).to.equal('javascript');

      // Test file
      const testFile = result.files.find(f => f.relativePath.includes('spec'));
      expect(testFile).to.exist;
      expect(testFile!.type).to.equal('test');
    });

    it('should handle empty purpose by mapping to empty description', async () => {
      const moduleOutput: CodeGenModuleOutput = {
        files: [{ path: 'src/service.ts', content: 'export class Service {}' }],
        explanation: 'Generated',
      };
      generateStub.resolves(moduleOutput);

      const agent = new CodeGenerationAgent({
        llmProvider: mockProvider,
        codeGenRegistry: mockRegistry,
      });

      const result = await agent.generate(createInput());

      expect(result.files[0].description).to.equal('');
    });

    it('should include additional context as a context file in module input', async () => {
      generateStub.resolves({
        files: [],
        explanation: 'No files',
      });

      const agent = new CodeGenerationAgent({
        llmProvider: mockProvider,
        codeGenRegistry: mockRegistry,
      });

      await agent.generate(createInput({ additionalContext: 'Focus on performance' }));

      const moduleInput: CodeGenModuleInput = generateStub.firstCall.args[0];
      const feedbackFile = moduleInput.contextFiles.find(
        f => f.path === 'feedback/additional-context.md'
      );
      expect(feedbackFile).to.exist;
      expect(feedbackFile!.content).to.equal('Focus on performance');
      expect(feedbackFile!.source).to.equal('external');
    });

    it('should include related patterns as a context file in module input', async () => {
      generateStub.resolves({
        files: [],
        explanation: 'No files',
      });

      const agent = new CodeGenerationAgent({
        llmProvider: mockProvider,
        codeGenRegistry: mockRegistry,
      });

      await agent.generate(createInput({
        contextAnalysis: {
          ...createContextAnalysis(),
          reusablePatterns: [
            { pattern: 'Repository', description: 'Data access pattern', example: '', domain: 'contacts', frequency: 5 },
          ],
        },
      }));

      const moduleInput: CodeGenModuleInput = generateStub.firstCall.args[0];
      const patternsFile = moduleInput.contextFiles.find(
        f => f.path === 'agent-memory/patterns.md'
      );
      expect(patternsFile).to.exist;
      expect(patternsFile!.content).to.include('Repository');
      expect(patternsFile!.source).to.equal('agent-memory');
    });

    it('should provide readFile callback in module input', async () => {
      generateStub.resolves({ files: [], explanation: 'No files' });

      const agent = new CodeGenerationAgent({
        llmProvider: mockProvider,
        codeGenRegistry: mockRegistry,
      });

      await agent.generate(createInput());

      const moduleInput: CodeGenModuleInput = generateStub.firstCall.args[0];
      expect(moduleInput.readFile).to.be.a('function');
    });

    it('should delegate readFile to readFromChtCore', async () => {
      const readStub = sinon.stub(staging, 'readFromChtCore');
      readStub.resolves('file content');
      generateStub.resolves({ files: [], explanation: 'No files' });

      const agent = new CodeGenerationAgent({
        llmProvider: mockProvider,
        codeGenRegistry: mockRegistry,
      });

      await agent.generate(createInput({ chtCorePath: '/my/cht-core' }));

      const moduleInput: CodeGenModuleInput = generateStub.firstCall.args[0];
      const result = await moduleInput.readFile!('some/file.ts');

      expect(readStub.calledWith('some/file.ts', '/my/cht-core')).to.be.true;
      expect(result).to.equal('file content');
    });

    it('should set action to modify when file exists in workspace context', async () => {
      // Stub readFromChtCore so the agent finds the existing file
      const readStub = sinon.stub(staging, 'readFromChtCore');
      readStub.withArgs('api/src/controllers/contacts.js', sinon.match.any)
        .resolves('module.exports = { get() {} };');
      readStub.callThrough(); // other calls pass through

      const moduleOutput: CodeGenModuleOutput = {
        files: [
          { path: 'api/src/controllers/contacts.js', content: 'module.exports = { updated: true };', purpose: 'Updated controller' },
          { path: 'webapp/src/ts/services/new-filter.ts', content: 'export class NewFilter {}', purpose: 'New filter' },
        ],
        explanation: 'Generated 2 files',
      };
      generateStub.resolves(moduleOutput);

      const agent = new CodeGenerationAgent({
        llmProvider: mockProvider,
        codeGenRegistry: mockRegistry,
      });

      // The orchestration plan references the existing file
      const input = createInput({
        orchestrationPlan: {
          ...createOrchestrationPlan(),
          phases: [{
            name: 'API',
            description: 'Update controller',
            estimatedComplexity: 'medium',
            suggestedComponents: ['api/src/controllers/contacts.js'],
            dependencies: [],
          }],
        },
      });

      const result = await agent.generate(input);

      // The existing file should be 'modify', the new one 'create'
      const existingFile = result.files.find(f => f.relativePath === 'api/src/controllers/contacts.js');
      const newFile = result.files.find(f => f.relativePath === 'webapp/src/ts/services/new-filter.ts');
      expect(existingFile).to.exist;
      expect(existingFile!.action).to.equal('modify');
      expect(newFile).to.exist;
      expect(newFile!.action).to.equal('create');
    });
  });

  describe('validateGeneratedFiles', () => {
    it('should filter out files without relativePath or content', async () => {
      const moduleOutput: CodeGenModuleOutput = {
        files: [
          { path: '', content: 'some content' },
          { path: 'valid.ts', content: '' },
          { path: 'good.ts', content: 'export const x = 1;' },
        ],
        explanation: 'Generated',
      };
      generateStub.resolves(moduleOutput);

      const agent = new CodeGenerationAgent({
        llmProvider: mockProvider,
        codeGenRegistry: mockRegistry,
      });

      const result = await agent.generate(createInput());

      expect(result.files).to.have.length(1);
      expect(result.files[0].relativePath).to.equal('good.ts');
    });
  });

  describe('analyzeRequirements', () => {
    it('should mark requirements as implemented when keywords match file content', async () => {
      const moduleOutput: CodeGenModuleOutput = {
        files: [{
          path: 'src/filters.ts',
          content: 'export function addFilters() { /* supports API filtering */ }',
          purpose: 'Filter implementation',
        }],
        explanation: 'Generated',
      };
      generateStub.resolves(moduleOutput);

      const agent = new CodeGenerationAgent({
        llmProvider: mockProvider,
        codeGenRegistry: mockRegistry,
      });

      const result = await agent.generate(createInput({
        issue: {
          issue: {
            ...createTestIssue().issue,
            requirements: ['Support API filtering', 'Add database migration'],
          },
        },
      }));

      expect(result.implementedRequirements).to.include('Support API filtering');
      expect(result.pendingRequirements).to.include('Add database migration');
    });
  });

  describe('calculateConfidence', () => {
    it('should return base score for zero files', async () => {
      generateStub.resolves({ files: [], explanation: 'No files' });

      const agent = new CodeGenerationAgent({
        llmProvider: mockProvider,
        codeGenRegistry: mockRegistry,
      });

      const result = await agent.generate(createInput());

      // Base 0.5 + research confidence 0.8 * 0.1 = 0.58
      expect(result.confidence).to.be.closeTo(0.58, 0.01);
    });

    it('should increase confidence for files with tests', async () => {
      const moduleOutput: CodeGenModuleOutput = {
        files: [
          { path: 'src/service.ts', content: 'export class Service {}', purpose: 'Service' },
          { path: 'test/service.spec.ts', content: 'describe("Service", () => {});', purpose: 'Tests' },
        ],
        explanation: 'Generated',
      };
      generateStub.resolves(moduleOutput);

      const agent = new CodeGenerationAgent({
        llmProvider: mockProvider,
        codeGenRegistry: mockRegistry,
      });

      const result = await agent.generate(createInput());

      // Base 0.5 + 2 files * 0.03 = 0.06 + test bonus 0.1 + research 0.08 + reqs ~0.1 = ~0.84
      expect(result.confidence).to.be.greaterThan(0.7);
    });

    it('should increase confidence for reusable patterns', async () => {
      generateStub.resolves({
        files: [{ path: 'src/service.ts', content: 'export class Service {}', purpose: 'Service' }],
        explanation: 'Generated',
      });

      const agent = new CodeGenerationAgent({
        llmProvider: mockProvider,
        codeGenRegistry: mockRegistry,
      });

      const result = await agent.generate(createInput({
        contextAnalysis: {
          ...createContextAnalysis(),
          reusablePatterns: [
            { pattern: 'Repository', description: 'Data access', example: '', domain: 'contacts', frequency: 3 },
          ],
        },
      }));

      // Base 0.5 + 1 file 0.03 + research 0.08 + patterns 0.05 + reqs ~0.1 = ~0.76
      expect(result.confidence).to.be.greaterThan(0.6);
    });

    it('should increase confidence when more requirements are implemented', async () => {
      // Generate files with content that matches ALL requirement keywords
      const moduleOutput: CodeGenModuleOutput = {
        files: [{
          path: 'src/filters.ts',
          content: 'export function addFilters() { /* supports filtering and database migration */ }',
          purpose: 'Filters',
        }],
        explanation: 'Generated',
      };
      generateStub.resolves(moduleOutput);

      const agent = new CodeGenerationAgent({
        llmProvider: mockProvider,
        codeGenRegistry: mockRegistry,
      });

      const allImplResult = await agent.generate(createInput({
        issue: {
          issue: {
            ...createTestIssue().issue,
            requirements: ['Support filtering', 'Add database migration'],
          },
        },
      }));

      // Now generate with content that matches only ONE requirement
      generateStub.resolves({
        files: [{
          path: 'src/filters.ts',
          content: 'export function addFilters() { /* supports filtering */ }',
          purpose: 'Filters',
        }],
        explanation: 'Generated',
      });

      const partialResult = await agent.generate(createInput({
        issue: {
          issue: {
            ...createTestIssue().issue,
            requirements: ['Support filtering', 'Add database migration'],
          },
        },
      }));

      expect(allImplResult.confidence).to.be.greaterThan(partialResult.confidence);
    });
  });

  describe('generateSummary and generateNotes', () => {
    it('should generate a summary with file counts', async () => {
      const moduleOutput: CodeGenModuleOutput = {
        files: [
          { path: 'src/service.ts', content: 'export class Service {}', purpose: 'Service' },
          { path: 'test/service.spec.ts', content: 'describe("test", () => {});', purpose: 'Tests' },
        ],
        explanation: 'Generated',
      };
      generateStub.resolves(moduleOutput);

      const agent = new CodeGenerationAgent({
        llmProvider: mockProvider,
        codeGenRegistry: mockRegistry,
      });

      const result = await agent.generate(createInput());

      expect(result.summary).to.include('2 files');
      expect(result.summary).to.include('Add contact search filters');
    });

    it('should note risk factors in notes', async () => {
      generateStub.resolves({
        files: [{ path: 'src/a.ts', content: 'export const a = 1;', purpose: 'File' }],
        explanation: 'Generated',
      });

      const agent = new CodeGenerationAgent({
        llmProvider: mockProvider,
        codeGenRegistry: mockRegistry,
      });

      const result = await agent.generate(createInput({
        orchestrationPlan: {
          ...createOrchestrationPlan(),
          riskFactors: ['Performance risk'],
        },
      }));

      expect(result.notes).to.include('Consider risk factors: Performance risk');
    });

    it('should note when no test files are generated', async () => {
      generateStub.resolves({
        files: [{ path: 'src/a.ts', content: 'export const a = 1;', purpose: 'File' }],
        explanation: 'Generated',
      });

      const agent = new CodeGenerationAgent({
        llmProvider: mockProvider,
        codeGenRegistry: mockRegistry,
      });

      const result = await agent.generate(createInput());

      expect(result.notes).to.include('No test files generated. Consider adding tests manually.');
    });
  });

  describe('uses default registry when none provided', () => {
    it('should construct without error using default registry', () => {
      const agent = new CodeGenerationAgent({
        llmProvider: mockProvider,
      });

      expect(agent).to.be.instanceOf(CodeGenerationAgent);
    });
  });

  describe('uses injected registry over default', () => {
    it('should use injected module name from custom registry', async () => {
      const customStub = sinon.stub().resolves({ files: [], explanation: 'noop' });

      const customModule: CodeGenModule = {
        name: 'custom-gen',
        version: '2.0.0',
        generate: customStub,
      };
      const customRegistry = new CodeGenModuleRegistry();
      customRegistry.register(customModule);

      const originalEnv = process.env.CODE_GEN_MODULE;
      try {
        process.env.CODE_GEN_MODULE = 'custom-gen';

        const agent = new CodeGenerationAgent({
          llmProvider: mockProvider,
          codeGenRegistry: customRegistry,
        });

        await agent.generate(createInput());

        expect(customStub.calledOnce).to.be.true;
      } finally {
        if (originalEnv === undefined) {
          delete process.env.CODE_GEN_MODULE;
        } else {
          process.env.CODE_GEN_MODULE = originalEnv;
        }
      }
    });
  });

  describe('CLI provider transport (F15)', () => {
    let envBackup: NodeJS.ProcessEnv;

    beforeEach(() => {
      envBackup = { ...process.env };
      process.env.LLM_PROVIDER = 'claude-cli';
      process.env.CLAUDE_CLI_PATH = '/bin/true';
    });

    afterEach(() => {
      process.env = envBackup;
    });

    it('should select the CLI-backed LLMProvider when LLM_PROVIDER=claude-cli', () => {
      // Construct the agent WITHOUT passing an LLM provider so the env-driven path runs.
      const agent = new CodeGenerationAgent({});
      // The CLI provider declares providerType: 'anthropic' (compat lie) but modelName: 'claude-cli'.
      const llm = agent.getLLMProvider();
      expect(llm.providerType).to.equal('anthropic');
      expect(llm.modelName).to.equal('claude-cli');
    });

    const buildFakeProc = (resultJson: string) => {
      const fakeStdout = new EventEmitter();
      const fakeStderr = new EventEmitter();
      const fakeProc = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
        stdin: { end: () => void };
        kill: () => void;
      };
      fakeProc.stdout = fakeStdout;
      fakeProc.stderr = fakeStderr;
      fakeProc.stdin = { end: () => undefined };
      fakeProc.kill = () => undefined;
      setImmediate(() => {
        fakeStdout.emit('data', resultJson);
        fakeProc.emit('close', 0);
      });
      return fakeProc;
    };

    const standardResult = JSON.stringify({
      type: 'result',
      subtype: 'success',
      result: 'ok',
      session_id: 'x',
      total_cost_usd: 0,
      duration_ms: 1,
      num_turns: 1,
      is_error: false,
    });

    it('should pass -p, --max-turns and --dangerously-skip-permissions by default', async () => {
      // proxyquire is used because child_process.spawn is non-configurable on Node 20+
      // and cannot be stubbed via sinon.stub directly.
      const proxyquire = require('proxyquire').noCallThru();
      const spawnStub = sinon.stub().callsFake(() => buildFakeProc(standardResult));
      const cliProvider = proxyquire('../../src/llm/providers/claude-cli', {
        'node:child_process': { spawn: spawnStub },
      });

      const provider = cliProvider.createClaudeCLIProvider({
        executablePath: '/bin/true',
      });
      await provider.invoke('test prompt');

      expect(spawnStub.calledOnce).to.be.true;
      const callArgs = spawnStub.firstCall.args[1] as string[];
      expect(callArgs).to.include('-p');
      expect(callArgs).to.include('--max-turns');
      expect(callArgs).to.include('--dangerously-skip-permissions');
    });

    it('should omit --dangerously-skip-permissions when skipPermissions=false', async () => {
      const proxyquire = require('proxyquire').noCallThru();
      const spawnStub = sinon.stub().callsFake(() => buildFakeProc(standardResult));
      const cliProvider = proxyquire('../../src/llm/providers/claude-cli', {
        'node:child_process': { spawn: spawnStub },
      });

      const provider = cliProvider.createClaudeCLIProvider({
        executablePath: '/bin/true',
        skipPermissions: false,
      });
      await provider.invoke('test prompt');

      const callArgs = spawnStub.firstCall.args[1] as string[];
      expect(callArgs).to.not.include('--dangerously-skip-permissions');
    });

    it('should use the disallowed tools list when disableTools is true', async () => {
      const proxyquire = require('proxyquire').noCallThru();
      const spawnStub = sinon.stub().callsFake(() => buildFakeProc(standardResult));
      const cliProvider = proxyquire('../../src/llm/providers/claude-cli', {
        'node:child_process': { spawn: spawnStub },
      });

      const provider = cliProvider.createClaudeCLIProvider({
        executablePath: '/bin/true',
      });
      await provider.invoke('test prompt', { disableTools: true });

      const callArgs = spawnStub.firstCall.args[1] as string[];
      const idx = callArgs.indexOf('--disallowedTools');
      expect(idx).to.be.greaterThan(-1);
      const disallowed = callArgs[idx + 1];
      expect(disallowed).to.include('Bash');
      expect(disallowed).to.include('Read');
      expect(disallowed).to.include('Write');
      expect(disallowed).to.include('Edit');
    });

    it('should refuse to drive claude-api via the CLI provider (v6 back-door fix)', async () => {
      // v6 A.1+A.2: the registry no longer passes the agent's LLM into claude-api,
      // and claude-api's generate() throws at entry when LLM_PROVIDER=claude-cli
      // and no provider was injected. The "back door" path that ran claude-api
      // under the CLI transport is now explicitly closed.
      //
      // After v6 G.1, claude-code-cli is the default. We must explicitly set
      // CODE_GEN_MODULE=claude-api to force the back-door scenario the test
      // exercises (user explicitly opted into claude-api under LLM_PROVIDER=claude-cli).
      const proxyquire = require('proxyquire').noCallThru();
      const spawnStub = sinon.stub().callsFake(() => buildFakeProc(standardResult));

      const proxiedCli = proxyquire('../../src/llm/providers/claude-cli', {
        'node:child_process': { spawn: spawnStub },
      });
      const proxiedFactory = proxyquire('../../src/llm/factory', {
        './providers/claude-cli': proxiedCli,
      });
      const proxiedLlmIndex = proxyquire('../../src/llm', {
        './factory': proxiedFactory,
      });
      const { CodeGenerationAgent: ProxiedAgent } = proxyquire('../../src/agents/code-generation-agent', {
        '../llm': proxiedLlmIndex,
      });

      const originalModule = process.env.CODE_GEN_MODULE;
      process.env.CODE_GEN_MODULE = 'claude-api';
      try {
        const agent = new ProxiedAgent({});
        let threw = false;
        try {
          await agent.generate(createInput());
        } catch (err) {
          threw = true;
          expect((err as Error).message).to.match(/claude-api module requires LLM_PROVIDER=anthropic/);
        }
        expect(threw).to.equal(true);
      } finally {
        if (originalModule === undefined) delete process.env.CODE_GEN_MODULE;
        else process.env.CODE_GEN_MODULE = originalModule;
      }
    });
  });
});
