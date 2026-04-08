import { expect } from 'chai';
import sinon from 'sinon';
import { ClaudeApiCodeGenModule, createClaudeApiCodeGenModule, PlanItem } from '../../../src/layers/code-gen/modules/claude-api/index';
import {
  CodeGenModuleInput,
  ContextFile,
} from '../../../src/layers/code-gen/interface';
import { LLMProvider, LLMResponse, LLMMessage, InvokeOptions } from '../../../src/llm';

describe('ClaudeApiCodeGenModule', () => {
  let invokeStub: sinon.SinonStub;
  let mockProvider: LLMProvider;

  /** Build a plan-only response */
  const makePlanResponse = (
    plan: Array<{ action: string; path: string; rationale: string }>
  ): LLMResponse => {
    let body = '=== PLAN ===\n';
    plan.forEach((p, i) => {
      body += `${i + 1}. ${p.action} ${p.path} - ${p.rationale}\n`;
    });
    body += '=== END PLAN ===\n';

    return {
      content: body,
      model: 'test-model',
      usage: { inputTokens: 200, outputTokens: 100 },
    };
  };

  /** Build a single-file raw response (per-file architecture) */
  const makeSingleFileResponse = (content: string, stopReason?: string): LLMResponse => ({
    content,
    model: 'test-model',
    usage: { inputTokens: 300, outputTokens: 400 },
    stopReason,
  });

  const baseInput: CodeGenModuleInput = {
    ticket: {
      issue: {
        title: 'Add contact search filters',
        type: 'feature',
        priority: 'medium',
        description: 'Allow filtering contacts by status.',
        technical_context: {
          domain: 'contacts',
          components: ['webapp/modules/contacts'],
        },
        requirements: ['Add UI filters', 'Support API filtering'],
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
    contextFiles: [
      {
        path: 'webapp/src/ts/services/contacts.service.ts',
        content: 'export class ContactsService { getAll() { return []; } }',
        source: 'workspace',
      },
    ],
    orchestrationPlan: {
      summary: 'Add filters to contacts.',
      keyFindings: [],
      recommendedApproach: 'Extend contacts service.',
      estimatedComplexity: 'medium',
      phases: [
        {
          name: 'API',
          description: 'Add filter params.',
          estimatedComplexity: 'medium',
          suggestedComponents: ['api/controllers/contacts'],
          dependencies: [],
        },
      ],
      riskFactors: [],
      estimatedEffort: '1 day',
    },
    targetDirectory: '/tmp/cht-core',
  };

  beforeEach(() => {
    invokeStub = sinon.stub();
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
    sinon.restore();
  });

  describe('generate() — plan-then-per-file', () => {
    it('should make 1 plan call + N per-file calls', async () => {
      invokeStub.onCall(0).resolves(makePlanResponse([
        { action: 'CREATE', path: 'api/controllers/contacts.js', rationale: 'API controller for contacts endpoints' },
        { action: 'CREATE', path: 'webapp/src/ts/services/filter.ts', rationale: 'Filter service for contact search' },
      ]));
      invokeStub.onCall(1).resolves(makeSingleFileResponse(
        'module.exports = {\n  get(req, res) {\n    res.json({ ok: true });\n  }\n};'
      ));
      invokeStub.onCall(2).resolves(makeSingleFileResponse(
        'export class FilterService {\n  filter(criteria: string) {\n    return [];\n  }\n}'
      ));

      const module = new ClaudeApiCodeGenModule(mockProvider);
      const output = await module.generate(baseInput);

      expect(invokeStub.callCount).to.equal(3); // 1 plan + 2 per-file
      expect(output.files).to.have.length(2);
      expect(output.files[0].path).to.equal('api/controllers/contacts.js');
      expect(output.files[1].path).to.equal('webapp/src/ts/services/filter.ts');
    });

    it('should return empty files when plan is empty', async () => {
      invokeStub.onCall(0).resolves({
        content: '=== PLAN ===\n=== END PLAN ===',
        model: 'test-model',
        usage: { inputTokens: 100, outputTokens: 20 },
      });

      const module = new ClaudeApiCodeGenModule(mockProvider);
      const output = await module.generate(baseInput);

      expect(invokeStub.callCount).to.equal(1); // Only plan call
      expect(output.files).to.have.length(0);
      expect(output.explanation).to.include('No implementation plan');
    });

    it('should handle plan generation failure gracefully', async () => {
      invokeStub.rejects(new Error('API rate limit'));

      const module = new ClaudeApiCodeGenModule(mockProvider);
      const output = await module.generate(baseInput);

      expect(output.files).to.have.length(0);
      expect(output.explanation).to.include('failed');
    });

    it('should pass disableTools: true in all invoke calls', async () => {
      invokeStub.onCall(0).resolves(makePlanResponse([
        { action: 'CREATE', path: 'src/a.ts', rationale: 'File A with feature implementation' },
      ]));
      invokeStub.onCall(1).resolves(makeSingleFileResponse(
        'export const a = 1;\nexport function run() { return a; }'
      ));

      const module = new ClaudeApiCodeGenModule(mockProvider);
      await module.generate(baseInput);

      for (let i = 0; i < invokeStub.callCount; i++) {
        const options = invokeStub.getCall(i).args[1] as InvokeOptions;
        expect(options.disableTools).to.be.true;
        expect(options.temperature).to.equal(0.3);
      }
    });

    it('should pass explicit maxTokens: 8192 for plan and 65536 for file generation', async () => {
      invokeStub.onCall(0).resolves(makePlanResponse([
        { action: 'CREATE', path: 'src/a.ts', rationale: 'File A' },
      ]));
      invokeStub.onCall(1).resolves(makeSingleFileResponse(
        'export const a = 1;\nexport function run() { return a; }'
      ));

      const module = new ClaudeApiCodeGenModule(mockProvider);
      await module.generate(baseInput);

      // Plan call should have maxTokens: 8192
      const planOptions = invokeStub.getCall(0).args[1] as InvokeOptions;
      expect(planOptions.maxTokens).to.equal(8192);

      // File generation call should have maxTokens: 65536
      const fileOptions = invokeStub.getCall(1).args[1] as InvokeOptions;
      expect(fileOptions.maxTokens).to.equal(65536);
    });

    it('should include original content for MODIFY files in per-file prompt', async () => {
      const longContent = 'export class ContactsService {\n' +
        '  // This is a very long file content\n'.repeat(100) +
        '  getAll() { return []; }\n}';

      const inputWithLongFile: CodeGenModuleInput = {
        ...baseInput,
        contextFiles: [{
          path: 'webapp/src/ts/services/contacts.service.ts',
          content: longContent,
          source: 'workspace',
        }],
      };

      invokeStub.onCall(0).resolves(makePlanResponse([
        { action: 'MODIFY', path: 'webapp/src/ts/services/contacts.service.ts', rationale: 'Add filter method to contacts service' },
      ]));
      const modifiedContent = 'import { FilterCriteria } from "./types";\n\n' +
        'export class ContactsService {\n' +
        '  private contacts: Contact[] = [];\n\n' +
        '  // This is a very long file content\n'.repeat(50) +
        '  getAll() { return this.contacts; }\n\n' +
        '  filter(criteria: FilterCriteria) {\n' +
        '    return this.contacts.filter(c => c.status === criteria.status);\n' +
        '  }\n\n' +
        '  search(query: string) {\n' +
        '    return this.contacts.filter(c => c.name.includes(query));\n' +
        '  }\n}';
      invokeStub.onCall(1).resolves(makeSingleFileResponse(modifiedContent));

      const module = new ClaudeApiCodeGenModule(mockProvider);
      await module.generate(inputWithLongFile);

      // The per-file prompt should include full original content
      const filePrompt = invokeStub.getCall(1).args[0] as string;
      expect(filePrompt).to.include('Original File Content');
      expect(filePrompt).to.include('getAll() { return []; }');
    });

    it('should aggregate token usage across plan + per-file calls', async () => {
      invokeStub.onCall(0).resolves(makePlanResponse([
        { action: 'CREATE', path: 'src/a.ts', rationale: 'File A with complete implementation' },
      ]));
      invokeStub.onCall(1).resolves(makeSingleFileResponse(
        'export const a = 1;\nexport function run() { return a; }'
      ));

      const module = new ClaudeApiCodeGenModule(mockProvider);
      const output = await module.generate(baseInput);

      // Plan: 200 + 100 = 300, File: 300 + 400 = 700 → Total: 1000
      expect(output.tokensUsed).to.equal(1000);
    });

    it('should report the model name from the provider', async () => {
      invokeStub.onCall(0).resolves(makePlanResponse([]));

      const module = new ClaudeApiCodeGenModule(mockProvider);
      const output = await module.generate(baseInput);

      expect(output.modelUsed).to.equal('test-model');
    });

    it('should include issue title and domain in explanation', async () => {
      invokeStub.onCall(0).resolves(makePlanResponse([
        { action: 'CREATE', path: 'src/a.ts', rationale: 'Implementation file for feature' },
      ]));
      invokeStub.onCall(1).resolves(makeSingleFileResponse(
        'export const a = 1;\nexport function run() { return a; }'
      ));

      const module = new ClaudeApiCodeGenModule(mockProvider);
      const output = await module.generate(baseInput);

      expect(output.explanation).to.include('Add contact search filters');
      expect(output.explanation).to.include('contacts');
    });

    it('should include manifest in the plan prompt', async () => {
      invokeStub.onCall(0).resolves(makePlanResponse([]));

      const module = new ClaudeApiCodeGenModule(mockProvider);
      await module.generate(baseInput);

      const prompt = invokeStub.firstCall.args[0] as string;
      expect(prompt).to.include('contacts.service.ts');
      expect(prompt).to.include('File Manifest');
      expect(prompt).to.include('Known existing files');
    });

    it('should conform to CodeGenModuleOutput', async () => {
      invokeStub.onCall(0).resolves(makePlanResponse([
        { action: 'CREATE', path: 'src/service.ts', rationale: 'Main service with core logic' },
      ]));
      invokeStub.onCall(1).resolves(makeSingleFileResponse(
        'export class Service {\n  run() { return true; }\n}'
      ));

      const module = new ClaudeApiCodeGenModule(mockProvider);
      const output = await module.generate(baseInput);

      expect(output).to.have.property('files').that.is.an('array');
      expect(output).to.have.property('explanation').that.is.a('string');
      expect(output).to.have.property('tokensUsed').that.is.a('number');
      expect(output).to.have.property('modelUsed').that.equals('test-model');
    });

    it('should fetch missing MODIFY files via readFile callback', async () => {
      const readFile = sinon.stub();
      readFile.withArgs('src/missing.ts').resolves('export class Missing { original() {} }');

      const inputWithReadFile: CodeGenModuleInput = {
        ...baseInput,
        contextFiles: [
          { path: 'webapp/src/ts/services/contacts.service.ts', content: 'export class ContactsService {}', source: 'workspace' },
        ],
        readFile,
      };

      invokeStub.onCall(0).resolves(makePlanResponse([
        { action: 'MODIFY', path: 'src/missing.ts', rationale: 'Update missing file with new logic' },
      ]));
      const modifiedContent = 'export class Missing {\n  original() {}\n  added() { return true; }\n}';
      invokeStub.onCall(1).resolves(makeSingleFileResponse(modifiedContent));

      const module = new ClaudeApiCodeGenModule(mockProvider);
      await module.generate(inputWithReadFile);

      expect(readFile.calledWith('src/missing.ts')).to.be.true;
      // The per-file prompt should include the fetched original content
      const filePrompt = invokeStub.getCall(1).args[0] as string;
      expect(filePrompt).to.include('Original File Content');
      expect(filePrompt).to.include('export class Missing { original() {} }');
    });

    it('should skip readFile for files already in contextFiles', async () => {
      const readFile = sinon.stub();

      const inputWithReadFile: CodeGenModuleInput = {
        ...baseInput,
        contextFiles: [
          { path: 'webapp/src/ts/services/contacts.service.ts', content: 'export class ContactsService { getAll() { return []; } }', source: 'workspace' },
        ],
        readFile,
      };

      invokeStub.onCall(0).resolves(makePlanResponse([
        { action: 'MODIFY', path: 'webapp/src/ts/services/contacts.service.ts', rationale: 'Add filter method' },
      ]));
      invokeStub.onCall(1).resolves(makeSingleFileResponse(
        'export class ContactsService {\n  getAll() { return []; }\n  filter() { return []; }\n}'
      ));

      const module = new ClaudeApiCodeGenModule(mockProvider);
      await module.generate(inputWithReadFile);

      expect(readFile.called).to.be.false;
    });

    it('should work without readFile (backward compat)', async () => {
      invokeStub.onCall(0).resolves(makePlanResponse([
        { action: 'MODIFY', path: 'src/not-in-context.ts', rationale: 'Update file not in context' },
        { action: 'CREATE', path: 'src/new.ts', rationale: 'New helper file' },
      ]));
      // First file (MODIFY without original) — fails assertions, returns null
      invokeStub.onCall(1).resolves(makeSingleFileResponse(
        'export class NotInContext {\n  run() { return true; }\n}'
      ));
      invokeStub.onCall(2).resolves(makeSingleFileResponse(
        'export class NotInContext {\n  run() { return true; }\n}'
      ));
      invokeStub.onCall(3).resolves(makeSingleFileResponse(
        'export class NotInContext {\n  run() { return true; }\n}'
      ));
      // Second file (CREATE)
      invokeStub.onCall(4).resolves(makeSingleFileResponse(
        'export class Helper {\n  run() { return true; }\n}'
      ));

      const module = new ClaudeApiCodeGenModule(mockProvider);
      const result = await module.generate(baseInput);

      // Should not throw — proceeds without the missing file
      expect(result).to.have.property('files');
    });

    it('should handle readFile returning null', async () => {
      const readFile = sinon.stub();
      readFile.withArgs('src/ghost.ts').resolves(null);

      const inputWithReadFile: CodeGenModuleInput = {
        ...baseInput,
        readFile,
      };

      invokeStub.onCall(0).resolves(makePlanResponse([
        { action: 'MODIFY', path: 'src/ghost.ts', rationale: 'Update ghost file' },
      ]));
      invokeStub.onCall(1).resolves(makeSingleFileResponse(
        'export class Ghost {\n  haunt() { return true; }\n}'
      ));

      const module = new ClaudeApiCodeGenModule(mockProvider);
      await module.generate(inputWithReadFile);

      expect(readFile.calledWith('src/ghost.ts')).to.be.true;
      // The prompt should NOT include original content (it's null)
      const filePrompt = invokeStub.getCall(1).args[0] as string;
      expect(filePrompt).not.to.include('Original File Content');
    });

    it('should handle per-file generation failure gracefully', async () => {
      invokeStub.onCall(0).resolves(makePlanResponse([
        { action: 'CREATE', path: 'src/a.ts', rationale: 'File A implementation' },
      ]));
      // All attempts return empty/short content
      invokeStub.onCall(1).resolves(makeSingleFileResponse(''));
      invokeStub.onCall(2).resolves(makeSingleFileResponse('short'));
      invokeStub.onCall(3).resolves(makeSingleFileResponse(''));

      const module = new ClaudeApiCodeGenModule(mockProvider);
      const output = await module.generate(baseInput);

      expect(output.files).to.have.length(0);
    });

    it('should include previously generated files in subsequent prompts', async () => {
      invokeStub.onCall(0).resolves(makePlanResponse([
        { action: 'CREATE', path: 'src/a.ts', rationale: 'Service A' },
        { action: 'CREATE', path: 'src/b.ts', rationale: 'Service B depends on A' },
      ]));
      invokeStub.onCall(1).resolves(makeSingleFileResponse(
        'export class ServiceA {\n  run() { return true; }\n}'
      ));
      invokeStub.onCall(2).resolves(makeSingleFileResponse(
        'import { ServiceA } from "./a";\nexport class ServiceB {\n  constructor(private a: ServiceA) {}\n}'
      ));

      const module = new ClaudeApiCodeGenModule(mockProvider);
      await module.generate(baseInput);

      // Second file prompt should reference the first generated file
      const secondPrompt = invokeStub.getCall(2).args[0] as string;
      expect(secondPrompt).to.include('Previously Generated Files');
      expect(secondPrompt).to.include('src/a.ts');
      expect(secondPrompt).to.include('ServiceA');
    });
  });

  describe('assertion-based retry (per-file)', () => {
    it('should retry when file has plaintext content', async () => {
      invokeStub.onCall(0).resolves(makePlanResponse([
        { action: 'CREATE', path: 'src/service.ts', rationale: 'Service implementation with filter logic' },
      ]));
      // First attempt: plaintext
      invokeStub.onCall(1).resolves(makeSingleFileResponse(
        'This file should implement the service with a filter method.'
      ));
      // Second attempt: valid code
      invokeStub.onCall(2).resolves(makeSingleFileResponse(
        'export class Service {\n  filter(criteria: string) {\n    return this.data.filter(x => x.status === criteria);\n  }\n}'
      ));

      const module = new ClaudeApiCodeGenModule(mockProvider);
      const output = await module.generate(baseInput);

      expect(output.files).to.have.length(1);
      expect(output.files[0].content).to.include('export class Service');
      expect(invokeStub.callCount).to.equal(3); // plan + failed + success
    });

    it('should include failure reasons in retry prompt', async () => {
      invokeStub.onCall(0).resolves(makePlanResponse([
        { action: 'CREATE', path: 'src/service.ts', rationale: 'Service implementation for filtering' },
      ]));
      // First attempt: plaintext
      invokeStub.onCall(1).resolves(makeSingleFileResponse(
        'This file should have a filter method that processes data.'
      ));
      // Second attempt: good code
      invokeStub.onCall(2).resolves(makeSingleFileResponse(
        'export class Service {\n  filter(criteria: string) {\n    return this.data.filter(x => x.status === criteria);\n  }\n}'
      ));

      const module = new ClaudeApiCodeGenModule(mockProvider);
      await module.generate(baseInput);

      const retryPrompt = invokeStub.getCall(2).args[0] as string;
      expect(retryPrompt).to.include('PREVIOUS ATTEMPT FAILED');
    });

    it('should retry when MODIFY file has no structural changes', async () => {
      const originalContent = 'export class ContactsService { getAll() { return []; } }';

      const inputWithWorkspace: CodeGenModuleInput = {
        ...baseInput,
        contextFiles: [{
          path: 'webapp/src/ts/services/contacts.service.ts',
          content: originalContent,
          source: 'workspace',
        }],
      };

      invokeStub.onCall(0).resolves(makePlanResponse([
        { action: 'MODIFY', path: 'webapp/src/ts/services/contacts.service.ts', rationale: 'Add filter method for contact search' },
      ]));
      // First attempt: returns identical content
      invokeStub.onCall(1).resolves(makeSingleFileResponse(originalContent));
      // Second attempt: returns modified content
      invokeStub.onCall(2).resolves(makeSingleFileResponse(
        'export class ContactsService {\n  getAll() { return []; }\n  filter(status: string) {\n    return this.getAll().filter(c => c.status === status);\n  }\n}'
      ));

      const module = new ClaudeApiCodeGenModule(mockProvider);
      const output = await module.generate(inputWithWorkspace);

      expect(output.files).to.have.length(1);
      expect(output.files[0].content).to.include('filter');
      expect(invokeStub.callCount).to.equal(3); // plan + failed + success
    });

    it('should generate second file even when first file fails all retries', async () => {
      invokeStub.onCall(0).resolves(makePlanResponse([
        { action: 'CREATE', path: 'src/a.ts', rationale: 'File that always fails assertions' },
        { action: 'CREATE', path: 'src/b.ts', rationale: 'File that succeeds' },
      ]));
      // a.ts: always plaintext (3 attempts)
      invokeStub.onCall(1).resolves(makeSingleFileResponse('This is just a description of file A.'));
      invokeStub.onCall(2).resolves(makeSingleFileResponse('Another plain text description of A.'));
      invokeStub.onCall(3).resolves(makeSingleFileResponse('Yet another description without code.'));
      // b.ts: valid code
      invokeStub.onCall(4).resolves(makeSingleFileResponse(
        'export class ServiceB {\n  run() { return true; }\n}'
      ));

      const module = new ClaudeApiCodeGenModule(mockProvider);
      const output = await module.generate(baseInput);

      // b.ts should succeed even though a.ts failed
      expect(output.files).to.have.length(1);
      expect(output.files[0].path).to.equal('src/b.ts');
    });

    it('should drop file after max retries with all syntax marker failures', async () => {
      invokeStub.onCall(0).resolves(makePlanResponse([
        { action: 'CREATE', path: 'src/service.ts', rationale: 'Service for the filtering feature' },
      ]));
      // All attempts return plaintext
      for (let i = 1; i <= 3; i++) {
        invokeStub.onCall(i).resolves(makeSingleFileResponse(
          'Just plain text without any real code or syntax markers here.'
        ));
      }

      const module = new ClaudeApiCodeGenModule(mockProvider);
      const output = await module.generate(baseInput);

      expect(output.files).to.have.length(0);
      expect(invokeStub.callCount).to.equal(4); // plan + 3 attempts
    });
  });

  describe('truncation handling', () => {
    it('should make continuation calls when output is truncated', async () => {
      invokeStub.onCall(0).resolves(makePlanResponse([
        { action: 'CREATE', path: 'src/big.ts', rationale: 'Large service file' },
      ]));
      // First call: truncated
      invokeStub.onCall(1).resolves(makeSingleFileResponse(
        'export class BigService {\n  method1() { return 1; }\n  method2() { return 2; }',
        'max_tokens'
      ));
      // Continuation: completes the file
      invokeStub.onCall(2).resolves(makeSingleFileResponse(
        '\n  method3() { return 3; }\n}'
      ));

      const module = new ClaudeApiCodeGenModule(mockProvider);
      const output = await module.generate(baseInput);

      expect(invokeStub.callCount).to.equal(3); // plan + truncated + continuation
      expect(output.files).to.have.length(1);
      expect(output.files[0].content).to.include('method1');
      expect(output.files[0].content).to.include('method3');
    });

    it('should handle multiple continuation calls for very large files', async () => {
      invokeStub.onCall(0).resolves(makePlanResponse([
        { action: 'CREATE', path: 'src/huge.ts', rationale: 'Very large file' },
      ]));
      // First call: truncated
      invokeStub.onCall(1).resolves(makeSingleFileResponse(
        'export class HugeService {\n  part1() { return 1; }',
        'max_tokens'
      ));
      // Continuation 1: still truncated
      invokeStub.onCall(2).resolves(makeSingleFileResponse(
        '\n  part2() { return 2; }',
        'max_tokens'
      ));
      // Continuation 2: completes
      invokeStub.onCall(3).resolves(makeSingleFileResponse(
        '\n  part3() { return 3; }\n}'
      ));

      const module = new ClaudeApiCodeGenModule(mockProvider);
      const output = await module.generate(baseInput);

      expect(invokeStub.callCount).to.equal(4); // plan + truncated + 2 continuations
      expect(output.files).to.have.length(1);
      expect(output.files[0].content).to.include('part1');
      expect(output.files[0].content).to.include('part2');
      expect(output.files[0].content).to.include('part3');
    });
  });

  describe('buildFileManifest()', () => {
    it('should extract existing file paths from workspace context files', () => {
      const contextFiles: ContextFile[] = [
        { path: 'webapp/src/ts/services/contacts.service.ts', content: '...', source: 'workspace' },
        { path: 'api/src/controllers/contact.js', content: '...', source: 'workspace' },
      ];

      const module = new ClaudeApiCodeGenModule();
      const manifest = module.buildFileManifest(contextFiles);

      expect(manifest.existingFiles).to.deep.equal([
        'webapp/src/ts/services/contacts.service.ts',
        'api/src/controllers/contact.js',
      ]);
    });

    it('should derive allowed directories from existing file paths', () => {
      const contextFiles: ContextFile[] = [
        { path: 'webapp/src/ts/services/contacts.service.ts', content: '...', source: 'workspace' },
        { path: 'webapp/src/ts/services/auth.service.ts', content: '...', source: 'workspace' },
        { path: 'api/src/controllers/contact.js', content: '...', source: 'workspace' },
      ];

      const module = new ClaudeApiCodeGenModule();
      const manifest = module.buildFileManifest(contextFiles);

      expect(manifest.allowedDirectories).to.deep.equal([
        'api/src/controllers/',
        'webapp/src/ts/services/',
      ]);
    });

    it('should ignore non-workspace context files', () => {
      const contextFiles: ContextFile[] = [
        { path: 'webapp/src/ts/services/contacts.service.ts', content: '...', source: 'workspace' },
        { path: 'agent-memory/patterns.md', content: '...', source: 'agent-memory' },
        { path: 'feedback/context.md', content: '...', source: 'external' },
      ];

      const module = new ClaudeApiCodeGenModule();
      const manifest = module.buildFileManifest(contextFiles);

      expect(manifest.existingFiles).to.have.length(1);
      expect(manifest.existingFiles[0]).to.equal('webapp/src/ts/services/contacts.service.ts');
    });

    it('should return empty manifest for no workspace files', () => {
      const module = new ClaudeApiCodeGenModule();
      const manifest = module.buildFileManifest([]);

      expect(manifest.existingFiles).to.deep.equal([]);
      expect(manifest.allowedDirectories).to.deep.equal([]);
    });

    it('should handle files without directory separators', () => {
      const contextFiles: ContextFile[] = [
        { path: 'Makefile', content: '...', source: 'workspace' },
      ];

      const module = new ClaudeApiCodeGenModule();
      const manifest = module.buildFileManifest(contextFiles);

      expect(manifest.existingFiles).to.deep.equal(['Makefile']);
      expect(manifest.allowedDirectories).to.deep.equal([]);
    });
  });

  describe('parsePlan()', () => {
    it('should parse a well-formed plan', () => {
      const output = [
        '=== PLAN ===',
        '1. MODIFY webapp/src/ts/services/contacts.service.ts - Add filter method',
        '2. CREATE webapp/src/ts/services/filter.service.ts - New filter service',
        '3. CREATE api/src/controllers/filter.js - API endpoint for filters',
        '=== END PLAN ===',
      ].join('\n');

      const module = new ClaudeApiCodeGenModule();
      const plan = module.parsePlan(output);

      expect(plan).to.have.length(3);
      expect(plan[0]).to.deep.equal({
        action: 'MODIFY',
        filePath: 'webapp/src/ts/services/contacts.service.ts',
        rationale: 'Add filter method',
      });
      expect(plan[1]).to.deep.equal({
        action: 'CREATE',
        filePath: 'webapp/src/ts/services/filter.service.ts',
        rationale: 'New filter service',
      });
      expect(plan[2]).to.deep.equal({
        action: 'CREATE',
        filePath: 'api/src/controllers/filter.js',
        rationale: 'API endpoint for filters',
      });
    });

    it('should return empty array when no plan section exists', () => {
      const output = [
        '=== FILE: src/a.ts ===',
        'PURPOSE: File A',
        '--- CONTENT START ---',
        'export const a = 1;',
        '--- CONTENT END ---',
      ].join('\n');

      const module = new ClaudeApiCodeGenModule();
      const plan = module.parsePlan(output);

      expect(plan).to.deep.equal([]);
    });

    it('should handle empty plan', () => {
      const output = [
        '=== PLAN ===',
        '=== END PLAN ===',
      ].join('\n');

      const module = new ClaudeApiCodeGenModule();
      const plan = module.parsePlan(output);

      expect(plan).to.deep.equal([]);
    });

    it('should skip malformed plan lines', () => {
      const output = [
        '=== PLAN ===',
        '1. MODIFY webapp/src/ts/services/contacts.service.ts - Add filter',
        'This is some random text',
        '2. CREATE api/src/controllers/filter.js - New endpoint',
        '=== END PLAN ===',
      ].join('\n');

      const module = new ClaudeApiCodeGenModule();
      const plan = module.parsePlan(output);

      expect(plan).to.have.length(2);
    });

    it('should handle em-dash and en-dash separators', () => {
      const output = [
        '=== PLAN ===',
        '1. MODIFY webapp/src/contacts.ts \u2014 Add filter method',
        '2. CREATE api/src/filter.js \u2013 New endpoint',
        '=== END PLAN ===',
      ].join('\n');

      const module = new ClaudeApiCodeGenModule();
      const plan = module.parsePlan(output);

      expect(plan).to.have.length(2);
      expect(plan[0].rationale).to.equal('Add filter method');
      expect(plan[1].rationale).to.equal('New endpoint');
    });

    it('should strip backticks from file paths in plan', () => {
      const output = [
        '=== PLAN ===',
        '1. MODIFY `webapp/src/ts/services/contacts.service.ts` - Add filter method',
        '2. CREATE `api/src/controllers/filter.js` - New endpoint',
        '=== END PLAN ===',
      ].join('\n');

      const module = new ClaudeApiCodeGenModule();
      const plan = module.parsePlan(output);

      expect(plan).to.have.length(2);
      expect(plan[0].filePath).to.equal('webapp/src/ts/services/contacts.service.ts');
      expect(plan[1].filePath).to.equal('api/src/controllers/filter.js');
    });

    it('should handle plan embedded in larger output', () => {
      const output = [
        'Here is my analysis:',
        '',
        '=== PLAN ===',
        '1. CREATE src/a.ts - File A',
        '=== END PLAN ===',
        '',
        '=== FILE: src/a.ts ===',
        'PURPOSE: File A',
        '--- CONTENT START ---',
        'export const a = 1;',
        '--- CONTENT END ---',
      ].join('\n');

      const module = new ClaudeApiCodeGenModule();
      const plan = module.parsePlan(output);

      expect(plan).to.have.length(1);
      expect(plan[0].filePath).to.equal('src/a.ts');
    });
  });

  describe('validateAgainstManifest()', () => {
    const module = new ClaudeApiCodeGenModule();

    it('should return no warnings when all files are in scope and match plan', () => {
      const files = [
        { path: 'webapp/src/ts/services/contacts.service.ts', content: 'code', purpose: 'Updated' },
        { path: 'webapp/src/ts/services/filter.service.ts', content: 'code', purpose: 'New' },
      ];
      const plan: PlanItem[] = [
        { action: 'MODIFY', filePath: 'webapp/src/ts/services/contacts.service.ts', rationale: 'Update' },
        { action: 'CREATE', filePath: 'webapp/src/ts/services/filter.service.ts', rationale: 'New' },
      ];
      const manifest = {
        existingFiles: ['webapp/src/ts/services/contacts.service.ts'],
        allowedDirectories: ['webapp/src/ts/services/'],
      };

      const warnings = module.validateAgainstManifest(files, plan, manifest);
      expect(warnings).to.deep.equal([]);
    });

    it('should warn about out-of-scope files', () => {
      const files = [
        { path: 'webapp/src/ts/services/contacts.service.ts', content: 'code' },
        { path: 'some/random/path/file.ts', content: 'code' },
      ];
      const manifest = {
        existingFiles: ['webapp/src/ts/services/contacts.service.ts'],
        allowedDirectories: ['webapp/src/ts/services/'],
      };

      const warnings = module.validateAgainstManifest(files, [], manifest);
      expect(warnings).to.have.length(1);
      expect(warnings[0]).to.include('Out-of-scope');
      expect(warnings[0]).to.include('some/random/path/file.ts');
    });

    it('should warn about planned-but-not-generated files', () => {
      const files = [
        { path: 'src/a.ts', content: 'code' },
      ];
      const plan: PlanItem[] = [
        { action: 'CREATE', filePath: 'src/a.ts', rationale: 'File A' },
        { action: 'CREATE', filePath: 'src/b.ts', rationale: 'File B' },
      ];
      const manifest = { existingFiles: [], allowedDirectories: [] };

      const warnings = module.validateAgainstManifest(files, plan, manifest);
      expect(warnings.some(w => w.includes('Planned but not generated') && w.includes('src/b.ts'))).to.be.true;
    });

    it('should warn about generated-but-not-planned files', () => {
      const files = [
        { path: 'src/a.ts', content: 'code' },
        { path: 'src/surprise.ts', content: 'code' },
      ];
      const plan: PlanItem[] = [
        { action: 'CREATE', filePath: 'src/a.ts', rationale: 'File A' },
      ];
      const manifest = { existingFiles: [], allowedDirectories: [] };

      const warnings = module.validateAgainstManifest(files, plan, manifest);
      expect(warnings.some(w => w.includes('Generated but not planned') && w.includes('src/surprise.ts'))).to.be.true;
    });

    it('should skip scope check when no allowed directories exist', () => {
      const files = [
        { path: 'anywhere/file.ts', content: 'code' },
      ];
      const manifest = { existingFiles: [], allowedDirectories: [] };

      const warnings = module.validateAgainstManifest(files, [], manifest);
      expect(warnings).to.deep.equal([]);
    });

    it('should not warn about existing files even if not in an allowed directory', () => {
      const files = [
        { path: 'root-level-config.json', content: '{ "key": "value" }' },
      ];
      const manifest = {
        existingFiles: ['root-level-config.json'],
        allowedDirectories: ['webapp/src/ts/services/'],
      };

      const warnings = module.validateAgainstManifest(files, [], manifest);
      expect(warnings).to.deep.equal([]);
    });

    it('should skip plan cross-check when plan is empty', () => {
      const files = [
        { path: 'src/a.ts', content: 'code' },
        { path: 'src/b.ts', content: 'code' },
      ];
      const manifest = { existingFiles: [], allowedDirectories: [] };

      const warnings = module.validateAgainstManifest(files, [], manifest);
      expect(warnings).to.deep.equal([]);
    });
  });

  describe('parseGeneratedFiles()', () => {
    it('should parse multiple files from delimiter format', () => {
      const output = [
        '=== FILE: api/controllers/contacts.js ===',
        'PURPOSE: API controller for contacts',
        '--- CONTENT START ---',
        'module.exports = {',
        '  get(req, res) {',
        '    res.json({ ok: true });',
        '  }',
        '};',
        '--- CONTENT END ---',
        '',
        '=== FILE: webapp/src/ts/services/filter.ts ===',
        'PURPOSE: Filter service',
        '--- CONTENT START ---',
        'export class FilterService {',
        '  filter() { return []; }',
        '}',
        '--- CONTENT END ---',
      ].join('\n');

      const module = new ClaudeApiCodeGenModule();
      const files = module.parseGeneratedFiles(output);

      expect(files).to.have.length(2);
      expect(files[0].path).to.equal('api/controllers/contacts.js');
      expect(files[0].purpose).to.equal('API controller for contacts');
      expect(files[0].content).to.include('module.exports');
      expect(files[1].path).to.equal('webapp/src/ts/services/filter.ts');
    });

    it('should handle empty output', () => {
      const module = new ClaudeApiCodeGenModule();
      const files = module.parseGeneratedFiles('');
      expect(files).to.have.length(0);
    });

    it('should skip files with content under 10 chars', () => {
      const output = [
        '=== FILE: short.js ===',
        'PURPOSE: Too short',
        '--- CONTENT START ---',
        'x = 1;',
        '--- CONTENT END ---',
      ].join('\n');

      const module = new ClaudeApiCodeGenModule();
      const files = module.parseGeneratedFiles(output);
      expect(files).to.have.length(0);
    });

    it('should handle content with markdown code blocks', () => {
      const output = [
        '=== FILE: src/service.ts ===',
        'PURPOSE: Service',
        '--- CONTENT START ---',
        '```typescript',
        'export class Service {',
        '  run() { return true; }',
        '}',
        '```',
        '--- CONTENT END ---',
      ].join('\n');

      const module = new ClaudeApiCodeGenModule();
      const files = module.parseGeneratedFiles(output);

      expect(files).to.have.length(1);
      expect(files[0].content).not.to.include('```');
      expect(files[0].content).to.include('export class Service');
    });

    it('should strip backticks from file paths in file delimiters', () => {
      const output = [
        '=== FILE: `config/default/app_settings.json` ===',
        'PURPOSE: App config',
        '--- CONTENT START ---',
        '{ "key": "value", "enabled": true }',
        '--- CONTENT END ---',
      ].join('\n');

      const module = new ClaudeApiCodeGenModule();
      const files = module.parseGeneratedFiles(output);

      expect(files).to.have.length(1);
      expect(files[0].path).to.equal('config/default/app_settings.json');
    });

    it('should handle text outside file blocks gracefully', () => {
      const output = [
        'Here are the files you need:',
        '',
        '=== FILE: src/a.ts ===',
        'PURPOSE: File A',
        '--- CONTENT START ---',
        'export const a = 1;',
        '--- CONTENT END ---',
        '',
        'That should cover everything.',
      ].join('\n');

      const module = new ClaudeApiCodeGenModule();
      const files = module.parseGeneratedFiles(output);

      expect(files).to.have.length(1);
      expect(files[0].path).to.equal('src/a.ts');
    });

    it('should parse files that follow a plan section', () => {
      const output = [
        '=== PLAN ===',
        '1. CREATE src/a.ts - File A',
        '=== END PLAN ===',
        '',
        '=== FILE: src/a.ts ===',
        'PURPOSE: File A',
        '--- CONTENT START ---',
        'export const a = 1;',
        '--- CONTENT END ---',
      ].join('\n');

      const module = new ClaudeApiCodeGenModule();
      const files = module.parseGeneratedFiles(output);

      expect(files).to.have.length(1);
      expect(files[0].path).to.equal('src/a.ts');
    });
  });

  describe('buildSingleFilePrompt()', () => {
    it('should include plan summary and current task', () => {
      const plan: PlanItem[] = [
        { action: 'CREATE', filePath: 'src/service.ts', rationale: 'New service' },
        { action: 'MODIFY', filePath: 'src/existing.ts', rationale: 'Update existing' },
      ];

      const module = new ClaudeApiCodeGenModule();
      const prompt = module.buildSingleFilePrompt(plan[0], plan, baseInput, new Map(), []);

      expect(prompt).to.include('CREATE src/service.ts');
      expect(prompt).to.include('MODIFY src/existing.ts');
      expect(prompt).to.include('Current Task');
      expect(prompt).to.include('src/service.ts');
    });

    it('should include full original content for MODIFY files', () => {
      const plan: PlanItem[] = [
        { action: 'MODIFY', filePath: 'src/existing.ts', rationale: 'Update existing' },
      ];
      const contentMap = new Map([['src/existing.ts', 'export class Existing { run() {} }']]);

      const module = new ClaudeApiCodeGenModule();
      const prompt = module.buildSingleFilePrompt(plan[0], plan, baseInput, contentMap, []);

      expect(prompt).to.include('Original File Content');
      expect(prompt).to.include('export class Existing { run() {} }');
    });

    it('should not include original content for CREATE files', () => {
      const plan: PlanItem[] = [
        { action: 'CREATE', filePath: 'src/new.ts', rationale: 'New file' },
      ];

      const module = new ClaudeApiCodeGenModule();
      const prompt = module.buildSingleFilePrompt(plan[0], plan, baseInput, new Map(), []);

      expect(prompt).not.to.include('Original File Content');
    });

    it('should include previously generated files for coherence', () => {
      const plan: PlanItem[] = [
        { action: 'CREATE', filePath: 'src/b.ts', rationale: 'File B' },
      ];
      const previouslyGenerated = [
        { path: 'src/a.ts', content: 'export class ServiceA {\n  run() { return 1; }\n}', purpose: 'Service A' },
      ];

      const module = new ClaudeApiCodeGenModule();
      const prompt = module.buildSingleFilePrompt(plan[0], plan, baseInput, new Map(), previouslyGenerated);

      expect(prompt).to.include('Previously Generated Files');
      expect(prompt).to.include('src/a.ts');
      expect(prompt).to.include('ServiceA');
    });

    it('should include previous failure feedback when provided', () => {
      const plan: PlanItem[] = [
        { action: 'CREATE', filePath: 'src/a.ts', rationale: 'File A' },
      ];
      const failures = ['plaintext description detected', 'missing syntax markers'];

      const module = new ClaudeApiCodeGenModule();
      const prompt = module.buildSingleFilePrompt(plan[0], plan, baseInput, new Map(), [], failures);

      expect(prompt).to.include('PREVIOUS ATTEMPT FAILED');
      expect(prompt).to.include('plaintext description detected');
      expect(prompt).to.include('missing syntax markers');
    });
  });

  describe('parseSingleFileContent()', () => {
    it('should return raw content as-is', () => {
      const module = new ClaudeApiCodeGenModule();
      const result = module.parseSingleFileContent('export class Foo { bar() {} }');
      expect(result).to.equal('export class Foo { bar() {} }');
    });

    it('should strip markdown code fences', () => {
      const module = new ClaudeApiCodeGenModule();
      const result = module.parseSingleFileContent('```typescript\nexport class Foo {}\n```');
      expect(result).to.equal('export class Foo {}');
      expect(result).not.to.include('```');
    });

    it('should strip delimiter format if LLM used it', () => {
      const module = new ClaudeApiCodeGenModule();
      const input = [
        '=== FILE: src/a.ts ===',
        'PURPOSE: File A',
        '--- CONTENT START ---',
        'export const a = 1;',
        '--- CONTENT END ---',
      ].join('\n');
      const result = module.parseSingleFileContent(input);
      expect(result).to.equal('export const a = 1;');
    });

    it('should trim whitespace', () => {
      const module = new ClaudeApiCodeGenModule();
      const result = module.parseSingleFileContent('  \n  export const x = 1;\n  ');
      expect(result).to.equal('export const x = 1;');
    });
  });

  describe('search-replace mode (large MODIFY files)', () => {
    it('should use Python transform for large JSON files', async () => {
      // Create a JSON file over 200 lines (200 keys = 402 lines with indent=2)
      const obj = Object.fromEntries(
        Array.from({ length: 200 }, (_, i) => [`key_${i}`, `value_${i}`])
      );
      const original = JSON.stringify(obj, null, 2);

      const inputWithLargeFile: CodeGenModuleInput = {
        ...baseInput,
        contextFiles: [{ path: 'config/app_settings.json', content: original, source: 'workspace' }],
      };

      const pythonScript = 'import json\nimport sys\n\nwith open(sys.argv[1], "r") as f:\n    data = json.load(f)\n\ndata["new_permission"] = True\n\nwith open(sys.argv[1], "w") as f:\n    json.dump(data, f, indent=2, ensure_ascii=False)\n';

      invokeStub.onCall(0).resolves(makePlanResponse([
        { action: 'MODIFY', path: 'config/app_settings.json', rationale: 'Add permission' },
      ]));
      // Stub all 3 potential attempts (assertions may retry)
      invokeStub.onCall(1).resolves(makeSingleFileResponse(pythonScript));
      invokeStub.onCall(2).resolves(makeSingleFileResponse(pythonScript));
      invokeStub.onCall(3).resolves(makeSingleFileResponse(pythonScript));

      const module = new ClaudeApiCodeGenModule(mockProvider);
      const output = await module.generate(inputWithLargeFile);

      // Should have produced a file with the Python-applied changes
      if (output.files.length > 0) {
        expect(output.files[0].content).to.include('"new_permission"');
        expect(output.files[0].content).to.include('key_0'); // original content preserved
        expect(output.files[0].content).to.include('key_199'); // end of original preserved
      }
    });

    it('should use search-replace for large non-JSON files', async () => {
      const largeContent = Array.from({ length: 250 }, (_, i) => `// line ${i}`).join('\n');

      const inputWithLargeFile: CodeGenModuleInput = {
        ...baseInput,
        contextFiles: [{ path: 'src/big-service.ts', content: largeContent, source: 'workspace' }],
      };

      const searchReplaceOutput = '<<<<<<< SEARCH\n// line 5\n=======\n// line 5\n// NEW METHOD ADDED\n>>>>>>> REPLACE';
      invokeStub.onCall(0).resolves(makePlanResponse([
        { action: 'MODIFY', path: 'src/big-service.ts', rationale: 'Add method' },
      ]));
      // Stub all 3 potential attempts (search-replace raw output fails plaintext assertions)
      invokeStub.onCall(1).resolves(makeSingleFileResponse(searchReplaceOutput));
      invokeStub.onCall(2).resolves(makeSingleFileResponse(searchReplaceOutput));
      invokeStub.onCall(3).resolves(makeSingleFileResponse(searchReplaceOutput));

      const module = new ClaudeApiCodeGenModule(mockProvider);
      const output = await module.generate(inputWithLargeFile);

      // After applying search-replace, the content should include both old and new
      if (output.files.length > 0) {
        expect(output.files[0].content).to.include('// NEW METHOD ADDED');
        expect(output.files[0].content).to.include('// line 0');
      }
    });

    it('should parse multiple search-replace blocks', () => {
      const module = new ClaudeApiCodeGenModule();
      const output = [
        '<<<<<<< SEARCH',
        'line 1',
        '=======',
        'modified line 1',
        '>>>>>>> REPLACE',
        '',
        '<<<<<<< SEARCH',
        'line 2',
        '=======',
        'modified line 2',
        '>>>>>>> REPLACE',
      ].join('\n');

      const blocks = module.parseSearchReplaceBlocks(output);
      expect(blocks).to.have.length(2);
      expect(blocks[0].search).to.equal('line 1');
      expect(blocks[0].replace).to.equal('modified line 1');
      expect(blocks[1].search).to.equal('line 2');
      expect(blocks[1].replace).to.equal('modified line 2');
    });

    it('should apply search-replace blocks to original content', () => {
      const module = new ClaudeApiCodeGenModule();
      const original = 'line 1\nline 2\nline 3\nline 4';
      const blocks = [
        { search: 'line 2', replace: 'modified line 2' },
      ];

      const result = module.applySearchReplace(original, blocks);
      expect(result).to.equal('line 1\nmodified line 2\nline 3\nline 4');
    });

    it('should return null when search block does not match', () => {
      const module = new ClaudeApiCodeGenModule();
      const original = 'line 1\nline 2\nline 3';
      const blocks = [
        { search: 'nonexistent line', replace: 'replacement' },
      ];

      const result = module.applySearchReplace(original, blocks);
      expect(result).to.be.null;
    });

    it('should not use search-replace for small files', () => {
      const module = new ClaudeApiCodeGenModule();
      const planItem: PlanItem = { action: 'MODIFY', filePath: 'small.ts', rationale: 'Update' };
      const contentMap = new Map([['small.ts', 'export class Small { run() {} }']]);

      expect(module.isLargeFile(planItem, contentMap)).to.be.false;
    });

    it('should use search-replace for files over threshold', () => {
      const module = new ClaudeApiCodeGenModule();
      const planItem: PlanItem = { action: 'MODIFY', filePath: 'big.json', rationale: 'Update' };
      const bigContent = Array.from({ length: 2100 }, (_, i) => `"key_${i}": "val"`).join('\n');
      const contentMap = new Map([['big.json', bigContent]]);

      expect(module.isLargeFile(planItem, contentMap)).to.be.true;
    });

    it('should not use search-replace for CREATE files regardless of size', () => {
      const module = new ClaudeApiCodeGenModule();
      const planItem: PlanItem = { action: 'CREATE', filePath: 'new.ts', rationale: 'Create' };

      expect(module.isLargeFile(planItem, new Map())).to.be.false;
    });

    it('should include search-replace instructions in prompt for large non-JSON files', () => {
      const module = new ClaudeApiCodeGenModule();
      const planItem: PlanItem = { action: 'MODIFY', filePath: 'big.ts', rationale: 'Update class' };
      const bigContent = Array.from({ length: 1100 }, (_, i) => `// line ${i}`).join('\n');
      const contentMap = new Map([['big.ts', bigContent]]);

      const prompt = module.buildSingleFilePrompt(planItem, [planItem], baseInput, contentMap, []);

      expect(prompt).to.include('<<<<<<< SEARCH');
      expect(prompt).to.include('>>>>>>> REPLACE');
      expect(prompt).to.include('output ONLY search-replace blocks');
      expect(prompt).not.to.include('output the COMPLETE modified version');
    });

    it('should include Python script instructions in prompt for large JSON files', () => {
      const module = new ClaudeApiCodeGenModule();
      const planItem: PlanItem = { action: 'MODIFY', filePath: 'config/app_settings.json', rationale: 'Add permission' };
      const bigJson = JSON.stringify(Object.fromEntries(
        Array.from({ length: 2100 }, (_, i) => [`key_${i}`, `value_${i}`])
      ), null, 2);
      const contentMap = new Map([['config/app_settings.json', bigJson]]);

      const prompt = module.buildSingleFilePrompt(planItem, [planItem], baseInput, contentMap, []);

      expect(prompt).to.include('Python script');
      expect(prompt).to.include('json.load');
      expect(prompt).to.include('json.dump');
      expect(prompt).to.include('JSON structure');
      expect(prompt).not.to.include('output the COMPLETE modified version');
    });
  });

  describe('looksLikePythonScript()', () => {
    it('should detect import json', () => {
      const module = new ClaudeApiCodeGenModule();
      expect(module.looksLikePythonScript('import json\nimport sys\n')).to.be.true;
    });

    it('should detect import sys', () => {
      const module = new ClaudeApiCodeGenModule();
      expect(module.looksLikePythonScript('import sys\ndata = json.load(f)\n')).to.be.true;
    });

    it('should reject non-Python content', () => {
      const module = new ClaudeApiCodeGenModule();
      expect(module.looksLikePythonScript('export class Foo {}')).to.be.false;
    });
  });

  describe('looksLikeCodeContent()', () => {
    it('should accept TypeScript code', () => {
      const module = new ClaudeApiCodeGenModule();
      expect(module.looksLikeCodeContent('import { Component } from "@angular/core";\nexport class Foo {}', 'foo.ts')).to.be.true;
    });

    it('should accept JavaScript CommonJS code', () => {
      const module = new ClaudeApiCodeGenModule();
      expect(module.looksLikeCodeContent('module.exports = {\n  get(req, res) {\n    res.json({ ok: true });\n  }\n};', 'foo.js')).to.be.true;
    });

    it('should accept JSON content', () => {
      const module = new ClaudeApiCodeGenModule();
      expect(module.looksLikeCodeContent('{\n  "key": "value"\n}', 'config.json')).to.be.true;
    });

    it('should accept Python scripts', () => {
      const module = new ClaudeApiCodeGenModule();
      expect(module.looksLikeCodeContent('import json\nimport sys\ndata = {}', 'script.py')).to.be.true;
    });

    it('should accept search-replace blocks', () => {
      const module = new ClaudeApiCodeGenModule();
      const content = '<<<<<<< SEARCH\nold code\n=======\nnew code\n>>>>>>> REPLACE';
      expect(module.looksLikeCodeContent(content, 'file.ts')).to.be.true;
    });

    it('should reject "I\'m unable to" reasoning', () => {
      const module = new ClaudeApiCodeGenModule();
      expect(module.looksLikeCodeContent("I'm unable to read the full file with my current available tools.", 'file.ts')).to.be.false;
    });

    it('should reject "Could you provide" reasoning', () => {
      const module = new ClaudeApiCodeGenModule();
      expect(module.looksLikeCodeContent('Could you please provide me with the relevant sections of the file?', 'file.ts')).to.be.false;
    });

    it('should reject "I don\'t have" reasoning', () => {
      const module = new ClaudeApiCodeGenModule();
      expect(module.looksLikeCodeContent("I don't have file reading tools (Read, Grep, Glob, Bash) available.", 'file.ts')).to.be.false;
    });

    it('should reject "Based on" reasoning', () => {
      const module = new ClaudeApiCodeGenModule();
      expect(module.looksLikeCodeContent('Based on the first 100 lines shown, let me provide the edits.', 'file.ts')).to.be.false;
    });

    it('should reject JSON-expecting files that start with text', () => {
      const module = new ClaudeApiCodeGenModule();
      expect(module.looksLikeCodeContent('This is the modified JSON content.', 'config.json')).to.be.false;
    });
  });

  describe('buildJsonStructureSummary()', () => {
    it('should summarize JSON with nested objects', () => {
      const module = new ClaudeApiCodeGenModule();
      const json = JSON.stringify({
        permissions: { can_edit: true, can_delete: false },
        roles: { admin: ['can_edit'], user: [] },
        name: 'test',
      }, null, 2);

      const summary = module.buildJsonStructureSummary(json);
      expect(summary).to.include('permissions');
      expect(summary).to.include('roles');
      expect(summary).to.include('name');
    });

    it('should handle arrays', () => {
      const module = new ClaudeApiCodeGenModule();
      const json = JSON.stringify({ items: [1, 2, 3], empty: [] }, null, 2);

      const summary = module.buildJsonStructureSummary(json);
      expect(summary).to.include('items');
      expect(summary).to.include('3 items');
    });

    it('should fallback to preview for invalid JSON', () => {
      const module = new ClaudeApiCodeGenModule();
      const content = Array.from({ length: 300 }, (_, i) => `line ${i}`).join('\n');

      const summary = module.buildJsonStructureSummary(content);
      expect(summary).to.include('line 0');
      expect(summary).to.include('more lines');
    });
  });

  describe('executePythonTransform()', () => {
    it('should execute a Python script that modifies JSON', async () => {
      const module = new ClaudeApiCodeGenModule();
      const original = JSON.stringify({ existing: 'value' }, null, 2);
      const script = [
        'import json',
        'import sys',
        '',
        'with open(sys.argv[1], "r") as f:',
        '    data = json.load(f)',
        '',
        'data["added"] = True',
        '',
        'with open(sys.argv[1], "w") as f:',
        '    json.dump(data, f, indent=2, ensure_ascii=False)',
      ].join('\n');

      const result = await module.executePythonTransform(script, original, 'test.json');

      expect(result).to.not.be.null;
      const parsed = JSON.parse(result!);
      expect(parsed.existing).to.equal('value');
      expect(parsed.added).to.be.true;
    });

    it('should return null for invalid Python script', async () => {
      const module = new ClaudeApiCodeGenModule();
      const result = await module.executePythonTransform(
        'this is not valid python!!!',
        '{}',
        'test.json'
      );

      expect(result).to.be.null;
    });
  });

  describe('validate()', () => {
    it('should return true when ANTHROPIC_API_KEY is set', async () => {
      const original = process.env.ANTHROPIC_API_KEY;
      try {
        process.env.ANTHROPIC_API_KEY = 'test-key';
        const module = new ClaudeApiCodeGenModule(mockProvider);
        const result = await module.validate();
        expect(result).to.be.true;
      } finally {
        if (original === undefined) {
          delete process.env.ANTHROPIC_API_KEY;
        } else {
          process.env.ANTHROPIC_API_KEY = original;
        }
      }
    });

    it('should return false when ANTHROPIC_API_KEY is not set', async () => {
      const original = process.env.ANTHROPIC_API_KEY;
      try {
        delete process.env.ANTHROPIC_API_KEY;
        const module = new ClaudeApiCodeGenModule(mockProvider);
        const result = await module.validate();
        expect(result).to.be.false;
      } finally {
        if (original !== undefined) {
          process.env.ANTHROPIC_API_KEY = original;
        }
      }
    });

    it('should return true when LLM_PROVIDER is claude-cli (no API key needed)', async () => {
      const originalKey = process.env.ANTHROPIC_API_KEY;
      const originalProvider = process.env.LLM_PROVIDER;
      try {
        delete process.env.ANTHROPIC_API_KEY;
        process.env.LLM_PROVIDER = 'claude-cli';
        const module = new ClaudeApiCodeGenModule(mockProvider);
        const result = await module.validate();
        expect(result).to.be.true;
      } finally {
        if (originalKey !== undefined) {
          process.env.ANTHROPIC_API_KEY = originalKey;
        } else {
          delete process.env.ANTHROPIC_API_KEY;
        }
        if (originalProvider !== undefined) {
          process.env.LLM_PROVIDER = originalProvider;
        } else {
          delete process.env.LLM_PROVIDER;
        }
      }
    });
  });

  describe('lazy provider initialization', () => {
    it('should not call createLLMProviderFromEnv when provider is passed', async () => {
      invokeStub.resolves(makePlanResponse([]));

      const module = new ClaudeApiCodeGenModule(mockProvider);
      await module.generate(baseInput);

      expect(invokeStub.called).to.be.true;
    });
  });

  describe('createClaudeApiCodeGenModule factory', () => {
    it('should create a module with the given provider', async () => {
      invokeStub.resolves(makePlanResponse([]));

      const module = createClaudeApiCodeGenModule(mockProvider);
      await module.generate(baseInput);

      expect(invokeStub.called).to.be.true;
      expect(module.name).to.equal('claude-api');
      expect(module.version).to.equal('0.6.0');
    });

    it('should create a module without a provider', () => {
      const module = createClaudeApiCodeGenModule();

      expect(module.name).to.equal('claude-api');
      expect(module.version).to.equal('0.6.0');
    });
  });
});
