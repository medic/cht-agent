/**
 * Development Supervisor
 *
 * Orchestrates the development phase:
 * 1. Code Generation Agent - generates implementation code
 * 2. Test Environment Agent - sets up tests and fixtures
 * 3. Validation - validates implementation against requirements
 *
 * Supports two modes:
 * - Preview Mode: Writes to staging area, generates diffs, allows review
 * - Direct Mode: Writes directly to cht-core codebase
 */

import { StateGraph, END, START, Annotation } from '@langchain/langgraph';
import {
  IssueTemplate,
  DevelopmentState,
  DevelopmentInput,
  DevelopmentOptions,
  OrchestrationPlan,
  ResearchFindings,
  ContextAnalysisResult,
  CodeGenerationResult,
  TestEnvironmentResult,
  ImplementationValidation,
  GeneratedFile,
} from '../types';
import { CodeGenerationAgent } from '../agents/code-generation-agent';
import { TestEnvironmentAgent } from '../agents/test-environment-agent';
import { LLMProvider, createLLMProviderFromEnv } from '../llm';
import {
  createStagingDirectory,
  writeToStaging,
  writeToChtCore,
  clearStaging,
} from '../utils/staging';

interface DevelopmentSupervisorOptions {
  llmProvider?: LLMProvider;
  useMock?: boolean;
}

// Define the state annotation for type safety
const DevelopmentStateAnnotation = Annotation.Root({
  messages: Annotation<DevelopmentState['messages']>({
    reducer: (_current, update) => [..._current, ...update],
    default: () => [],
  }),
  issue: Annotation<IssueTemplate | undefined>({
    reducer: (_current, update) => update ?? _current,
    default: () => undefined,
  }),
  orchestrationPlan: Annotation<OrchestrationPlan | undefined>({
    reducer: (_current, update) => update ?? _current,
    default: () => undefined,
  }),
  researchFindings: Annotation<ResearchFindings | undefined>({
    reducer: (_current, update) => update ?? _current,
    default: () => undefined,
  }),
  contextAnalysis: Annotation<ContextAnalysisResult | undefined>({
    reducer: (_current, update) => update ?? _current,
    default: () => undefined,
  }),
  options: Annotation<DevelopmentOptions | undefined>({
    reducer: (_current, update) => update ?? _current,
    default: () => undefined,
  }),
  codeGeneration: Annotation<CodeGenerationResult | undefined>({
    reducer: (_current, update) => update ?? _current,
    default: () => undefined,
  }),
  testEnvironment: Annotation<TestEnvironmentResult | undefined>({
    reducer: (_current, update) => update ?? _current,
    default: () => undefined,
  }),
  validationResult: Annotation<ImplementationValidation | undefined>({
    reducer: (_current, update) => update ?? _current,
    default: () => undefined,
  }),
  currentPhase: Annotation<DevelopmentState['currentPhase']>({
    reducer: (_current, update) => update,
    default: () => 'init' as const,
  }),
  errors: Annotation<string[]>({
    reducer: (_current, update) => [..._current, ...update],
    default: () => [],
  }),
});

export class DevelopmentSupervisor {
  private graph: ReturnType<typeof this.buildGraph>;
  private codeGenAgent: CodeGenerationAgent;
  private testEnvAgent: TestEnvironmentAgent;
  private llm: LLMProvider;
  private useMock: boolean;

  constructor(options: DevelopmentSupervisorOptions = {}) {
    this.llm = options.llmProvider || createLLMProviderFromEnv();
    this.useMock = options.useMock ?? false;

    this.codeGenAgent = new CodeGenerationAgent({
      llmProvider: this.llm,
      useMock: this.useMock,
    });

    this.testEnvAgent = new TestEnvironmentAgent({
      llmProvider: this.llm,
      useMock: this.useMock,
    });

    this.graph = this.buildGraph();
  }

  /**
   * Build the LangGraph workflow
   */
  private buildGraph() {
    const workflow = new StateGraph(DevelopmentStateAnnotation)
      // Define nodes
      .addNode('codeGeneration', this.codeGenerationNode.bind(this))
      .addNode('testEnvironment', this.testEnvironmentNode.bind(this))
      .addNode('validation', this.validationNode.bind(this))

      // Define edges
      .addEdge(START, 'codeGeneration')
      .addEdge('codeGeneration', 'testEnvironment')
      .addEdge('testEnvironment', 'validation')
      .addEdge('validation', END);

    return workflow.compile();
  }

  /**
   * Node: Code Generation
   */
  private async codeGenerationNode(state: typeof DevelopmentStateAnnotation.State) {
    console.log('\n=== CODE GENERATION NODE ===');

    if (!state.issue || !state.orchestrationPlan || !state.researchFindings ||
        !state.contextAnalysis || !state.options) {
      return {
        errors: ['Missing required data for code generation'],
        currentPhase: 'init' as const,
      };
    }

    try {
      const result = await this.codeGenAgent.generate({
        issue: state.issue,
        orchestrationPlan: state.orchestrationPlan,
        researchFindings: state.researchFindings,
        contextAnalysis: state.contextAnalysis,
        chtCorePath: state.options.chtCorePath,
      });

      return {
        codeGeneration: result,
        currentPhase: 'test-setup' as const,
        messages: [
          {
            role: 'assistant' as const,
            content: `Code generation completed. Generated ${result.files.length} files with ${(result.confidence * 100).toFixed(0)}% confidence.`,
            timestamp: new Date().toISOString(),
          },
        ],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        errors: [`Code generation failed: ${errorMessage}`],
        currentPhase: 'code-generation' as const,
      };
    }
  }

  /**
   * Node: Test Environment Setup
   */
  private async testEnvironmentNode(state: typeof DevelopmentStateAnnotation.State) {
    console.log('\n=== TEST ENVIRONMENT NODE ===');

    if (!state.issue || !state.orchestrationPlan || !state.codeGeneration || !state.options) {
      return {
        errors: ['Missing required data for test environment setup'],
        currentPhase: 'test-setup' as const,
      };
    }

    try {
      const result = await this.testEnvAgent.setup({
        issue: state.issue,
        orchestrationPlan: state.orchestrationPlan,
        codeGeneration: state.codeGeneration,
        chtCorePath: state.options.chtCorePath,
      });

      return {
        testEnvironment: result,
        currentPhase: 'validation' as const,
        messages: [
          {
            role: 'assistant' as const,
            content: `Test environment setup completed. Generated ${result.testFiles.length} test files with estimated ${result.estimatedCoverage}% coverage.`,
            timestamp: new Date().toISOString(),
          },
        ],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        errors: [`Test environment setup failed: ${errorMessage}`],
        currentPhase: 'test-setup' as const,
      };
    }
  }

  /**
   * Node: Validation
   */
  private async validationNode(state: typeof DevelopmentStateAnnotation.State) {
    console.log('\n=== VALIDATION NODE ===');

    if (!state.issue || !state.codeGeneration) {
      return {
        errors: ['Missing required data for validation'],
        currentPhase: 'validation' as const,
      };
    }

    try {
      const validation = await this.validateImplementation(
        state.issue,
        state.codeGeneration,
        state.testEnvironment
      );

      return {
        validationResult: validation,
        currentPhase: 'complete' as const,
        messages: [
          {
            role: 'assistant' as const,
            content: `Validation completed. Overall score: ${validation.overallScore}%`,
            timestamp: new Date().toISOString(),
          },
        ],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        errors: [`Validation failed: ${errorMessage}`],
        currentPhase: 'validation' as const,
      };
    }
  }

  /**
   * Validate the implementation against requirements
   */
  private async validateImplementation(
    issue: IssueTemplate,
    codeGen: CodeGenerationResult,
    testEnv?: TestEnvironmentResult
  ): Promise<ImplementationValidation> {
    console.log('[Development Supervisor] Validating implementation...');

    const prompt = `You are a code reviewer validating a CHT implementation.

## Issue Requirements
${issue.issue.requirements.map((r, i) => `${i + 1}. ${r}`).join('\n')}

## Acceptance Criteria
${issue.issue.acceptance_criteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}

## Generated Files
${codeGen.files.map((f) => `- ${f.relativePath}: ${f.description}`).join('\n')}

## Implementation Summary
${codeGen.summary}

## Test Coverage
${testEnv ? `Estimated coverage: ${testEnv.estimatedCoverage}%` : 'No test information available'}
${testEnv ? `Test files: ${testEnv.testFiles.length}` : ''}

## Task
Evaluate the implementation against requirements and acceptance criteria.
Respond with a JSON object:
{
  "requirementsMet": [
    { "requirement": "...", "met": true/false, "notes": "..." }
  ],
  "acceptanceCriteriaPassed": [
    { "criteria": "...", "passed": true/false, "notes": "..." }
  ],
  "overallScore": 0-100,
  "recommendations": ["..."]
}`;

    try {
      const result = await this.llm.invokeForJSON<ImplementationValidation>(prompt, {
        temperature: 0.2,
      });
      return result;
    } catch {
      // Fallback validation based on heuristics
      return this.heuristicValidation(issue, codeGen, testEnv);
    }
  }

  /**
   * Fallback heuristic validation
   */
  private heuristicValidation(
    issue: IssueTemplate,
    codeGen: CodeGenerationResult,
    testEnv?: TestEnvironmentResult
  ): ImplementationValidation {
    const requirementsMet = issue.issue.requirements.map((req) => {
      const isImplemented = codeGen.implementedRequirements.includes(req);
      return {
        requirement: req,
        met: isImplemented,
        notes: isImplemented ? 'Appears to be implemented' : 'Not found in generated code',
      };
    });

    const acceptanceCriteriaPassed = issue.issue.acceptance_criteria.map((criteria) => {
      // Simple heuristic: check if related keywords exist in code
      const keywords = criteria.toLowerCase().split(' ').filter((w) => w.length > 4);
      const allCode = codeGen.files.map((f) => f.content).join('\n').toLowerCase();
      const hasMatches = keywords.some((kw) => allCode.includes(kw));

      return {
        criteria,
        passed: hasMatches,
        notes: hasMatches ? 'Keywords found in implementation' : 'May need manual verification',
      };
    });

    const metCount = requirementsMet.filter((r) => r.met).length;
    const passedCount = acceptanceCriteriaPassed.filter((c) => c.passed).length;
    const totalChecks = requirementsMet.length + acceptanceCriteriaPassed.length;
    const passedChecks = metCount + passedCount;

    let overallScore = totalChecks > 0 ? Math.round((passedChecks / totalChecks) * 100) : 50;

    // Bonus for having tests
    if (testEnv && testEnv.testFiles.length > 0) {
      overallScore = Math.min(overallScore + 10, 100);
    }

    const recommendations: string[] = [];
    if (metCount < requirementsMet.length) {
      recommendations.push('Some requirements may not be fully implemented - manual review needed');
    }
    if (!testEnv || testEnv.testFiles.length === 0) {
      recommendations.push('Consider adding more test coverage');
    }
    if (overallScore < 70) {
      recommendations.push('Implementation confidence is low - additional review recommended');
    }

    return {
      requirementsMet,
      acceptanceCriteriaPassed,
      overallScore,
      recommendations,
    };
  }

  /**
   * Main entry point to run the development workflow
   */
  async develop(input: DevelopmentInput): Promise<DevelopmentState> {
    console.log('\n========================================');
    console.log('DEVELOPMENT SUPERVISOR - Starting Development Phase');
    console.log('========================================');
    console.log(`Issue: ${input.issue.issue.title}`);
    console.log(`CHT Core Path: ${input.options.chtCorePath}`);
    console.log(`Preview Mode: ${input.options.previewMode}`);
    console.log(`Using LLM: ${this.llm.modelName}`);

    if (input.additionalContext) {
      console.log('\n📝 Additional Context from Human Feedback:');
      console.log(`   ${input.additionalContext}`);
    }

    console.log('========================================\n');

    const initialState: typeof DevelopmentStateAnnotation.State = {
      messages: [
        {
          role: 'user',
          content: `Develop implementation for: ${input.issue.issue.title}`,
          timestamp: new Date().toISOString(),
        },
      ],
      issue: input.issue,
      orchestrationPlan: input.orchestrationPlan,
      researchFindings: input.researchFindings,
      contextAnalysis: input.contextAnalysis,
      options: input.options,
      codeGeneration: undefined,
      testEnvironment: undefined,
      validationResult: undefined,
      currentPhase: 'init',
      errors: [],
    };

    const result = await this.graph.invoke(initialState);

    console.log('\n========================================');
    console.log('DEVELOPMENT SUPERVISOR - Development Phase Complete');
    console.log('========================================');
    console.log(`Final Phase: ${result.currentPhase}`);
    console.log(`Errors: ${result.errors.length}`);

    if (result.codeGeneration) {
      console.log(`Generated Files: ${result.codeGeneration.files.length}`);
    }
    if (result.testEnvironment) {
      console.log(`Test Files: ${result.testEnvironment.testFiles.length}`);
    }
    if (result.validationResult) {
      console.log(`Validation Score: ${result.validationResult.overallScore}%`);
    }

    console.log('========================================\n');

    // Cast to DevelopmentState - we know issue is defined because we passed it in
    return result as DevelopmentState;
  }

  /**
   * Write generated files to staging directory
   */
  async writeToStaging(state: DevelopmentState): Promise<{
    stagingPath: string;
    writtenFiles: string[];
  }> {
    const stagingPath = await createStagingDirectory();

    const allFiles: GeneratedFile[] = [];

    if (state.codeGeneration) {
      allFiles.push(...state.codeGeneration.files);
    }
    if (state.testEnvironment) {
      allFiles.push(...state.testEnvironment.testFiles);
      allFiles.push(...state.testEnvironment.testDataFiles);
    }

    const writtenFiles = await writeToStaging(allFiles, stagingPath);

    console.log(`[Development Supervisor] Written ${writtenFiles.length} files to staging: ${stagingPath}`);

    return { stagingPath, writtenFiles };
  }

  /**
   * Write generated files directly to cht-core
   */
  async writeToChtCore(state: DevelopmentState, chtCorePath: string): Promise<string[]> {
    const allFiles: GeneratedFile[] = [];

    if (state.codeGeneration) {
      allFiles.push(...state.codeGeneration.files);
    }
    if (state.testEnvironment) {
      allFiles.push(...state.testEnvironment.testFiles);
      allFiles.push(...state.testEnvironment.testDataFiles);
    }

    const writtenFiles = await writeToChtCore(allFiles, chtCorePath);

    console.log(`[Development Supervisor] Written ${writtenFiles.length} files to ${chtCorePath}`);

    return writtenFiles;
  }

  /**
   * Clear staging directory
   */
  async clearStaging(stagingPath: string): Promise<void> {
    await clearStaging(stagingPath);
    console.log(`[Development Supervisor] Cleared staging directory: ${stagingPath}`);
  }

  /**
   * Get all generated files from the development state
   */
  getAllGeneratedFiles(state: DevelopmentState): GeneratedFile[] {
    const allFiles: GeneratedFile[] = [];

    if (state.codeGeneration) {
      allFiles.push(...state.codeGeneration.files);
    }
    if (state.testEnvironment) {
      allFiles.push(...state.testEnvironment.testFiles);
      allFiles.push(...state.testEnvironment.testDataFiles);
    }

    return allFiles;
  }
}
