import {
  IssueTemplate,
  OrchestrationPlan,
  ResearchFindings,
  CodeGenerationResult,
  GeneratedFile,
  FileLanguage,
  TestGenerationResult,
} from '../types';
import { TestGenModuleInput, TestType } from '../layers/test-gen/interface';
import {
  ContextFile,
  GeneratedFile as LayerGeneratedFile,
} from '../layers/code-gen/interface';
import { TestGenModuleRegistry, createDefaultTestGenRegistry } from '../layers/test-gen/registry';
import { LLMProvider, createLLMProviderFromEnv } from '../llm';
import { readFromChtCore, listChtCoreDirectory } from '../utils/staging';

/**
 * Focused agent-level input for building a TestGenModuleInput. Carries only what
 * the Development Supervisor has on hand once code generation has completed.
 */
export interface TestGenerationInput {
  issue: IssueTemplate;
  researchFindings: ResearchFindings;
  orchestrationPlan: OrchestrationPlan;
  /** Generated source files; their `.files` become the layer's `generatedCode`. */
  codeGeneration: CodeGenerationResult;
  chtCorePath: string;
  /** Test types to request. Defaults to `['unit']` when omitted. */
  testTypes?: TestType[];
  /** Feedback from a previous iteration, surfaced as an external context file. */
  additionalContext?: string;
}

/**
 * Convert the agent-level input into a TestGenModuleInput for the test-gen layer.
 *
 * Mirrors code-generation-agent's `buildModuleInput`. Pure aside from the
 * `readFile`/`listDirectory` closures it binds (they read from cht-core on
 * demand). `codeGeneration.files` is the types-local GeneratedFile[], which is
 * exactly what `TestGenModuleInput.generatedCode` expects, so it passes through
 * unchanged. The `TestGenerationAgent` below calls this to build the module input.
 */
export function buildTestGenModuleInput(input: TestGenerationInput): TestGenModuleInput {
  const contextFiles: ContextFile[] = [];
  if (input.additionalContext) {
    contextFiles.push({
      path: 'feedback/additional-context.md',
      content: input.additionalContext,
      source: 'external',
    });
  }

  return {
    ticket: input.issue,
    researchFindings: input.researchFindings,
    orchestrationPlan: input.orchestrationPlan,
    generatedCode: input.codeGeneration.files,
    contextFiles,
    testTypes: input.testTypes ?? ['unit'],
    targetDirectory: input.chtCorePath,
    readFile: (filePath: string) => readFromChtCore(filePath, input.chtCorePath),
    listDirectory: (dirPath: string) => listChtCoreDirectory(dirPath, input.chtCorePath),
  };
}

const LANGUAGE_BY_EXTENSION: Record<string, FileLanguage> = {
  ts: 'typescript',
  js: 'javascript',
  json: 'json',
  xml: 'xml',
  yml: 'yaml',
  yaml: 'yaml',
  properties: 'properties',
  md: 'markdown',
  html: 'html',
  css: 'css',
  sh: 'shell',
};

/**
 * Infer a FileLanguage from a path extension. Mirrors code-generation-agent's
 * `inferLanguage`; duplicated rather than shared to keep the agents decoupled.
 */
function inferLanguageFromPath(filePath: string): FileLanguage {
  const ext = filePath.split('.').pop()?.toLowerCase();
  return LANGUAGE_BY_EXTENSION[ext || ''] || 'typescript';
}

/**
 * Convert the layer's GeneratedFile[] (`path`/`content`/`purpose`) to the
 * types-local GeneratedFile[]. Test files are always new, so `type` is forced
 * to `'test'` and `action` to `'create'`; `language` is inferred from the path.
 */
function convertModuleFiles(files: LayerGeneratedFile[]): GeneratedFile[] {
  return files.map(file => ({
    relativePath: file.path,
    content: file.content,
    language: inferLanguageFromPath(file.path),
    type: 'test' as const,
    description: file.purpose ?? '',
    action: 'create' as const,
  }));
}

/** Options for constructing a {@link TestGenerationAgent}. */
export interface TestGenerationAgentOptions {
  llmProvider?: LLMProvider;
  testGenRegistry?: TestGenModuleRegistry;
}

/**
 * Agent wrapping the test-gen layer registry. Mirrors CodeGenerationAgent:
 * builds a TestGenModuleInput from the focused TestGenerationInput, runs the
 * active module, and converts its output to a types-local TestGenerationResult.
 */
export class TestGenerationAgent {
  private readonly llm: LLMProvider;
  private readonly registry: TestGenModuleRegistry;

  constructor(options: TestGenerationAgentOptions = {}) {
    this.llm = options.llmProvider || createLLMProviderFromEnv();
    this.registry = options.testGenRegistry || createDefaultTestGenRegistry(this.llm);
  }

  async generate(input: TestGenerationInput): Promise<TestGenerationResult> {
    const moduleInput = buildTestGenModuleInput(input);
    const out = await this.registry.getActiveModule().generate(moduleInput);
    return {
      files: convertModuleFiles(out.files),
      explanation: out.explanation,
      requirementsChecklist: out.requirementsChecklist,
      warnings: out.warnings,
      tokensUsed: out.tokensUsed,
      modelUsed: out.modelUsed,
    };
  }
}
