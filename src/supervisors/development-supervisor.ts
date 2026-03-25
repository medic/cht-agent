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
 *
 * Includes a refinement loop: if validation score < 70%, the workflow
 * loops back to code generation with feedback (up to MAX_ITERATIONS).
 */

import { StateGraph, START, Annotation } from '@langchain/langgraph';
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
import { TodoTracker, createSupervisorTodoTracker } from '../utils/todo-tracker';

const MAX_ITERATIONS = 3;
const REFINEMENT_THRESHOLD = 80;

interface DevelopmentSupervisorOptions {
  llmProvider?: LLMProvider;
  useMock?: boolean;
  skipTestEnvironment?: boolean;
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
  // Refinement loop state
  iterationCount: Annotation<number>({
    reducer: (_current, update) => update,
    default: () => 0,
  }),
  validationFeedback: Annotation<string | undefined>({
    reducer: (_current, update) => update ?? _current,
    default: () => undefined,
  }),
});

export class DevelopmentSupervisor {
  private graph: ReturnType<typeof this.buildGraph>;
  private codeGenAgent: CodeGenerationAgent;
  private testEnvAgent: TestEnvironmentAgent;
  private llm: LLMProvider;
  private useMock: boolean;
  private skipTestEnvironment: boolean;
  private todos: TodoTracker;

  constructor(options: DevelopmentSupervisorOptions = {}) {
    this.llm = options.llmProvider || createLLMProviderFromEnv();
    this.useMock = options.useMock ?? false;
    this.skipTestEnvironment = options.skipTestEnvironment ?? false;

    this.codeGenAgent = new CodeGenerationAgent({
      llmProvider: this.llm,
      useMock: this.useMock,
    });

    this.testEnvAgent = new TestEnvironmentAgent({
      llmProvider: this.llm,
      useMock: this.useMock,
    });

    this.todos = createSupervisorTodoTracker('Development');

    this.graph = this.buildGraph();
  }

  /**
   * Build the LangGraph workflow with conditional refinement loop
   */
  private buildGraph() {
    const workflow = new StateGraph(DevelopmentStateAnnotation)
      // Define nodes
      .addNode('generateCode', this.codeGenerationNode.bind(this))
      .addNode('setupTests', this.testEnvironmentNode.bind(this))
      .addNode('validateImpl', this.validationNode.bind(this))

      // Define edges with conditional routing from validation
      .addEdge(START, 'generateCode')
      .addEdge('generateCode', 'setupTests')
      .addEdge('setupTests', 'validateImpl')
      .addConditionalEdges('validateImpl', (state) => {
        const score = state.validationResult?.overallScore ?? 0;
        const iterations = state.iterationCount ?? 0;

        if (score < REFINEMENT_THRESHOLD && iterations < MAX_ITERATIONS) {
          console.log(`[Development Supervisor] Score ${score}% < ${REFINEMENT_THRESHOLD}% threshold, iteration ${iterations + 1}/${MAX_ITERATIONS} — looping back to code generation`);
          return 'generateCode';
        }

        if (score < REFINEMENT_THRESHOLD) {
          console.log(`[Development Supervisor] Score ${score}% < ${REFINEMENT_THRESHOLD}% but max iterations (${MAX_ITERATIONS}) reached — proceeding to END`);
        }

        return '__end__';
      });

    return workflow.compile();
  }

  /**
   * Node: Code Generation
   */
  private async codeGenerationNode(state: typeof DevelopmentStateAnnotation.State) {
    const iteration = (state.iterationCount ?? 0) + 1;
    console.log(`\n=== CODE GENERATION NODE (iteration ${iteration}) ===`);

    const todoId = 'development-1'; // First todo
    this.todos.start(todoId);

    if (!state.issue || !state.orchestrationPlan || !state.researchFindings ||
        !state.contextAnalysis || !state.options) {
      this.todos.fail(todoId, 'Missing required data');
      return {
        errors: ['Missing required data for code generation'],
        currentPhase: 'init' as const,
      };
    }

    try {
      // On retry: pass validation feedback as additionalContext
      const additionalContext = state.validationFeedback || undefined;

      const result = await this.codeGenAgent.generate({
        issue: state.issue,
        orchestrationPlan: state.orchestrationPlan,
        researchFindings: state.researchFindings,
        contextAnalysis: state.contextAnalysis,
        chtCorePath: state.options.chtCorePath,
        additionalContext,
      });

      this.todos.complete(todoId);

      return {
        codeGeneration: result,
        currentPhase: 'test-setup' as const,
        iterationCount: iteration,
        messages: [
          {
            role: 'assistant' as const,
            content: `Code generation (iteration ${iteration}) completed. Generated ${result.files.length} files with ${(result.confidence * 100).toFixed(0)}% confidence.`,
            timestamp: new Date().toISOString(),
          },
        ],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.todos.fail(todoId, errorMessage);
      return {
        errors: [`Code generation failed: ${errorMessage}`],
        currentPhase: 'code-generation' as const,
        iterationCount: iteration,
      };
    }
  }

  /**
   * Node: Test Environment Setup
   */
  private async testEnvironmentNode(state: typeof DevelopmentStateAnnotation.State) {
    if (this.skipTestEnvironment) {
      console.log('\n=== TEST ENVIRONMENT NODE (SKIPPED) ===');
      return { currentPhase: 'validation' as const };
    }

    console.log('\n=== TEST ENVIRONMENT NODE ===');

    const todoId = 'development-2'; // Second todo
    this.todos.start(todoId);

    if (!state.issue || !state.orchestrationPlan || !state.codeGeneration || !state.options) {
      this.todos.fail(todoId, 'Missing required data');
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

      this.todos.complete(todoId);

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
      this.todos.fail(todoId, errorMessage);
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

    const todoId = 'development-3'; // Third todo
    this.todos.start(todoId);

    if (!state.issue || !state.codeGeneration) {
      this.todos.fail(todoId, 'Missing required data');
      return {
        errors: ['Missing required data for validation'],
        currentPhase: 'validation' as const,
      };
    }

    // Skip validation if no files were generated — nothing to judge
    if (state.codeGeneration.files.length === 0) {
      console.log('[Development Supervisor] Skipping validation — no files generated');
      this.todos.complete(todoId);
      this.todos.printSummary();
      return {
        validationResult: this.heuristicValidation(state.issue, state.codeGeneration, state.testEnvironment),
        currentPhase: 'complete' as const,
      };
    }

    try {
      const validation = await this.validateImplementation(
        state.issue,
        state.codeGeneration,
        state.testEnvironment
      );

      this.todos.complete(todoId);
      this.todos.printSummary();

      // Extract feedback for potential retry
      const feedbackUpdate: Record<string, unknown> = {
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

      // Store feedback for refinement loop
      if (validation.feedbackForCodeGen) {
        feedbackUpdate.validationFeedback = validation.feedbackForCodeGen;
      } else if (validation.overallScore < REFINEMENT_THRESHOLD) {
        // Synthesize feedback from recommendations if none was explicitly provided
        feedbackUpdate.validationFeedback = this.synthesizeFeedback(validation);
      }

      return feedbackUpdate;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.todos.fail(todoId, errorMessage);
      this.todos.printSummary();
      return {
        errors: [`Validation failed: ${errorMessage}`],
        currentPhase: 'validation' as const,
      };
    }
  }

  /**
   * Synthesize actionable feedback from validation result when feedbackForCodeGen is not provided
   */
  private synthesizeFeedback(validation: ImplementationValidation): string {
    const parts: string[] = [];

    const failedRequirements = validation.requirementsMet
      .filter(r => !r.met)
      .map(r => r.requirement);
    if (failedRequirements.length > 0) {
      parts.push(`Unmet requirements: ${failedRequirements.join('; ')}`);
    }

    const failedCriteria = validation.acceptanceCriteriaPassed
      .filter(c => !c.passed)
      .map(c => c.criteria);
    if (failedCriteria.length > 0) {
      parts.push(`Failed acceptance criteria: ${failedCriteria.join('; ')}`);
    }

    if (validation.recommendations.length > 0) {
      parts.push(`Recommendations: ${validation.recommendations.join('; ')}`);
    }

    return parts.join('\n');
  }

  /**
   * Validate the implementation against requirements (code-aware)
   */
  private async validateImplementation(
    issue: IssueTemplate,
    codeGen: CodeGenerationResult,
    testEnv?: TestEnvironmentResult
  ): Promise<ImplementationValidation> {
    console.log('[Development Supervisor] Validating implementation...');

    // Build code section with actual file content
    const codeSection = this.buildCodeSection(codeGen.files, 40000);

    const prompt = `You are a code reviewer validating a CHT implementation. You MUST examine the actual code content below, not just infer quality from file names or descriptions.

## Issue Requirements
${issue.issue.requirements.map((r, i) => `${i + 1}. ${r}`).join('\n')}

## Acceptance Criteria
${issue.issue.acceptance_criteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}

## Generated Files Summary
${codeGen.files.map((f) => `- ${f.relativePath}: ${f.description}`).join('\n')}

## Actual Code Content
${codeSection}

## Implementation Summary
${codeGen.summary}

## Test Coverage
${testEnv ? `Estimated coverage: ${testEnv.estimatedCoverage}%` : 'No test information available'}
${testEnv ? `Test files: ${testEnv.testFiles.length}` : ''}

## Task
Evaluate the implementation by examining the ACTUAL CODE above, not just file names.
For each requirement and acceptance criterion, check if the code actually implements it.
Look for:
- Real logic and functionality (not just stubs or TODO comments)
- Proper handling of the described feature
- Code that would actually work in a CHT environment

## Scoring Rules
- overallScore must be consistent with your itemized evaluation: (requirements met / total requirements * 50) + (criteria passed / total criteria * 50) ± 10 for code quality.
- Do not give a low overallScore if most requirements and criteria pass, and vice versa.

## Grounding Rules
- Only evaluate code that is actually present in the "Actual Code Content" section above.
- Do NOT comment on tests, files, or functionality that are not shown in the prompt.
- Every claim in your evaluation must be traceable to specific code content above.

Also provide specific, actionable feedback that could be used to improve the code in a retry.

Respond with a JSON object:
{
  "requirementsMet": [
    { "requirement": "...", "met": true/false, "notes": "..." }
  ],
  "acceptanceCriteriaPassed": [
    { "criteria": "...", "passed": true/false, "notes": "..." }
  ],
  "overallScore": 0-100,
  "recommendations": ["..."],
  "feedbackForCodeGen": "Specific actionable feedback for code generation retry, addressing gaps in the implementation"
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
   * Build a section containing actual file content, respecting a character budget
   */
  private buildCodeSection(files: GeneratedFile[], budgetChars: number): string {
    if (files.length === 0) return 'No files generated.';

    const sections: string[] = [];
    let remaining = budgetChars;

    for (const file of files) {
      const header = `### ${file.relativePath}\n`;
      const headerCost = header.length + 10; // account for code fences

      if (remaining < headerCost + 50) break; // Not enough budget for meaningful content

      const availableForContent = remaining - headerCost;
      const content = file.content.length <= availableForContent
        ? file.content
        : file.content.substring(0, availableForContent) + '\n... (truncated)';

      const section = `${header}\`\`\`\n${content}\n\`\`\``;
      sections.push(section);
      remaining -= section.length;
    }

    return sections.join('\n\n');
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
      console.log('\nAdditional Context from Human Feedback:');
      console.log(`   ${input.additionalContext}`);
    }

    console.log('========================================\n');

    // Initialize todos for the development workflow
    this.todos.clear();
    this.todos.addMany([
      { content: 'Generate code', activeForm: 'Generating code' },
      { content: 'Setup test environment', activeForm: 'Setting up test environment' },
      { content: 'Validate implementation', activeForm: 'Validating implementation' },
    ]);

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
      iterationCount: 0,
      validationFeedback: input.additionalContext,
    };

    const result = await this.graph.invoke(initialState);

    console.log('\n========================================');
    console.log('DEVELOPMENT SUPERVISOR - Development Phase Complete');
    console.log('========================================');
    console.log(`Final Phase: ${result.currentPhase}`);
    console.log(`Iterations: ${result.iterationCount ?? 1}`);
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
