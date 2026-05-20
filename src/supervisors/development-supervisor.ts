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
  FileValidationFeedback,
  FailingFileRef,
} from '../types';
import { CodeGenerationAgent } from '../agents/code-generation-agent';
import { TestEnvironmentAgent } from '../agents/test-environment-agent';
import { CodeGenModuleRegistry } from '../layers/code-gen/registry';
import { LLMProvider, createLLMProviderFromEnv } from '../llm';
import {
  createStagingDirectory,
  writeToStaging,
  writeToChtCore,
  clearStaging,
} from '../utils/staging';
import { TodoTracker, createSupervisorTodoTracker } from '../utils/todo-tracker';
import { isShutdownRequested } from '../utils/shutdown';
import { createTwoFilesPatch, structuredPatch } from 'diff';

const MAX_ITERATIONS = 3;
const REFINEMENT_THRESHOLD = 75;

/**
 * Render a "Heading:\n- bullet\n- bullet" section if `items` is non-empty.
 * Returns `undefined` so the caller can skip empty sections without an `if`.
 */
function renderBulletSection<T>(heading: string, items: T[], format: (item: T) => string): string | undefined {
  if (items.length === 0) return undefined;
  const bulletList = items.map(item => `- ${format(item)}`).join('\n');
  return `${heading}:\n${bulletList}`;
}

/**
 * Shape the validateImpl resolver reads. Narrow on purpose so unit tests can
 * exercise the decision logic without instantiating a full langgraph state.
 */
export interface ValidateImplEdgeState {
  validationResult?: { overallScore?: number };
  iterationCount?: number;
  codeGeneration?: { crossFileIssues?: { issueType?: string }[] };
}

/**
 * Decide what edge the validateImpl node should take next. Pure function so
 * it can be unit-tested without spinning up the workflow.
 *
 *  - Shutdown requested → '__end__'
 *  - execute-no-op present → '__end__' (R17 v7: looping cannot help)
 *  - Score below threshold OR any cross-file issue → 'generateCode' (refine) if iterations left
 *  - Otherwise → '__end__'
 */
export function resolveValidateImplEdge(state: ValidateImplEdgeState): 'generateCode' | '__end__' {
  if (isShutdownRequested()) {
    console.log('[Development Supervisor] Shutdown requested; ending workflow');
    return '__end__';
  }
  const score = state.validationResult?.overallScore ?? 0;
  const iterations = state.iterationCount ?? 0;
  const issues = state.codeGeneration?.crossFileIssues ?? [];
  // R17 (v7): when the CLI abstained even after the relaxed retry, looping
  // cannot help — it would just repeat the same abstain pattern with the
  // same plan. End cleanly so the user sees the HC2 banner.
  if (issues.some(i => i.issueType === 'execute-no-op')) {
    console.log('[Development Supervisor] execute-no-op detected; ending workflow (refinement loop cannot help)');
    return '__end__';
  }
  const belowBar = score < REFINEMENT_THRESHOLD || issues.length > 0;
  if (belowBar && iterations < MAX_ITERATIONS) {
    logRefinementLoop(score, issues, iterations);
    return 'generateCode';
  }
  if (belowBar) {
    console.log(`[Development Supervisor] Below quality bar but max iterations (${MAX_ITERATIONS}) reached — proceeding to END`);
  }

  return '__end__';
}

function checkRequirements(issue: IssueTemplate, codeGen: CodeGenerationResult) {
  return issue.issue.requirements.map(req => {
    const isImplemented = codeGen.implementedRequirements.includes(req);
    return {
      requirement: req,
      met: isImplemented,
      notes: isImplemented ? 'Appears to be implemented' : 'Not found in generated code',
    };
  });
}

function checkAcceptanceCriteria(issue: IssueTemplate, codeGen: CodeGenerationResult) {
  const allCode = codeGen.files.map(f => f.content).join('\n').toLowerCase();
  return issue.issue.acceptance_criteria.map(criteria => {
    const keywords = criteria.toLowerCase().split(' ').filter(w => w.length > 4);
    const hasMatches = keywords.some(kw => allCode.includes(kw));
    return {
      criteria,
      passed: hasMatches,
      notes: hasMatches ? 'Keywords found in implementation' : 'May need manual verification',
    };
  });
}

function logRefinementLoop(score: number, issues: { issueType?: string }[], iterations: number): void {
  const reason = score < REFINEMENT_THRESHOLD
    ? `Score ${score}% < ${REFINEMENT_THRESHOLD}% threshold`
    : `${issues.length} cross-file issue(s)`;
  console.log(`[Development Supervisor] ${reason}, iteration ${iterations + 1}/${MAX_ITERATIONS} — looping back to code generation`);
}

interface DevelopmentSupervisorOptions {
  llmProvider?: LLMProvider;
  skipTestEnvironment?: boolean;
  codeGenRegistry?: CodeGenModuleRegistry;
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
  /** Per-file validation results for selective regeneration */
  perFileFeedback: Annotation<FileValidationFeedback[] | undefined>({
    reducer: (_current, update) => update ?? _current,
    default: () => undefined,
  }),
});

export class DevelopmentSupervisor {
  private readonly graph: ReturnType<typeof this.buildGraph>;
  private readonly codeGenAgent: CodeGenerationAgent;
  private readonly testEnvAgent: TestEnvironmentAgent;
  private readonly llm: LLMProvider;
  private readonly skipTestEnvironment: boolean;
  private readonly todos: TodoTracker;

  constructor(options: DevelopmentSupervisorOptions = {}) {
    this.llm = options.llmProvider || createLLMProviderFromEnv();
    this.skipTestEnvironment = options.skipTestEnvironment ?? false;

    this.codeGenAgent = new CodeGenerationAgent({
      llmProvider: this.llm,
      codeGenRegistry: options.codeGenRegistry,
    });

    this.testEnvAgent = new TestEnvironmentAgent({
      llmProvider: this.llm,
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
      .addConditionalEdges('validateImpl', (state) => resolveValidateImplEdge(state));

    return workflow.compile();
  }

  /**
   * Node: Code Generation
   */
  private async codeGenerationNode(state: typeof DevelopmentStateAnnotation.State) {
    if (isShutdownRequested()) {
      console.log('[Development Supervisor] Shutdown requested; skipping code generation node');
      return { currentPhase: 'complete' as const };
    }

    const iteration = (state.iterationCount ?? 0) + 1;
    console.log(`\n=== CODE GENERATION NODE (iteration ${iteration}) ===`);

    const todoId = 'development-1';
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
      const selective = this.buildSelectiveRegenInput(state, iteration);
      const result = await this.codeGenAgent.generate({
        issue: state.issue,
        orchestrationPlan: state.orchestrationPlan,
        researchFindings: state.researchFindings,
        contextAnalysis: state.contextAnalysis,
        chtCorePath: state.options.chtCorePath,
        additionalContext: state.validationFeedback || undefined,
        passingFiles: selective.passingFiles,
        failingFiles: selective.failingFiles,
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
   * Selective regeneration helper: when we have per-file feedback from a
   * prior iteration, partition files into "carry forward (passing)" and
   * "regenerate (failing)". Returns empty when this is iter 1 or there is
   * no per-file feedback yet.
   */
  private buildSelectiveRegenInput(
    state: typeof DevelopmentStateAnnotation.State,
    iteration: number,
  ): { passingFiles?: GeneratedFile[]; failingFiles?: FailingFileRef[] } {
    if (!state.perFileFeedback || !state.codeGeneration || iteration <= 1) {
      return {};
    }
    const passing = state.perFileFeedback.filter(f => f.passed);
    const failing = state.perFileFeedback.filter(f => !f.passed);
    const passingFiles = state.codeGeneration.files.filter(
      f => passing.some(p => p.filePath === f.relativePath),
    );
    const failingFiles: FailingFileRef[] = failing.map(fb => {
      const genFile = state.codeGeneration!.files.find(f => f.relativePath === fb.filePath);
      return { path: fb.filePath, action: genFile?.action ?? 'modify' as const };
    });
    console.log(`[Development Supervisor] Selective regeneration: keeping ${passingFiles.length} passing file(s), regenerating ${failingFiles.length} failing file(s)`);
    return { passingFiles, failingFiles };
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

    const todoId = 'development-2';
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
    if (isShutdownRequested()) {
      console.log('[Development Supervisor] Shutdown requested; skipping validation node');
      return { currentPhase: 'complete' as const };
    }
    console.log('\n=== VALIDATION NODE ===');
    const todoId = 'development-3';
    this.todos.start(todoId);

    if (!state.issue || !state.codeGeneration) {
      this.todos.fail(todoId, 'Missing required data');
      return { errors: ['Missing required data for validation'], currentPhase: 'validation' as const };
    }
    const { issue, codeGeneration, testEnvironment } = state;
    if (codeGeneration.files.length === 0) {
      return this.skipValidationForEmptyFiles({ issue, codeGeneration, testEnvironment, todoId });
    }
    return await this.runValidationWithTodo({ issue, codeGeneration, testEnvironment, todoId });
  }

  private skipValidationForEmptyFiles(opts: {
    issue: IssueTemplate;
    codeGeneration: CodeGenerationResult;
    testEnvironment?: TestEnvironmentResult;
    todoId: string;
  }): { validationResult: ImplementationValidation; currentPhase: 'complete' } {
    console.log('[Development Supervisor] Skipping validation — no files generated');
    this.todos.complete(opts.todoId);
    this.todos.printSummary();
    return {
      validationResult: this.heuristicValidation(opts.issue, opts.codeGeneration, opts.testEnvironment),
      currentPhase: 'complete' as const,
    };
  }

  private async runValidationWithTodo(opts: {
    issue: IssueTemplate;
    codeGeneration: CodeGenerationResult;
    testEnvironment?: TestEnvironmentResult;
    todoId: string;
  }) {
    try {
      const validation = await this.validateImplementation(
        opts.issue,
        opts.codeGeneration,
        opts.testEnvironment
      );
      this.todos.complete(opts.todoId);
      this.todos.printSummary();
      return this.buildValidationStateUpdate(validation, opts.codeGeneration);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.todos.fail(opts.todoId, errorMessage);
      this.todos.printSummary();
      return {
        errors: [`Validation failed: ${errorMessage}`],
        currentPhase: 'validation' as const,
      };
    }
  }

  /**
   * Build the state-update object after a successful validation pass.
   * Combines the validation result with refinement feedback (if score is
   * below threshold), folded cross-file issues, and per-file feedback for
   * selective regeneration. Extracted from validationNode to keep that
   * method's branching shallow.
   */
  private buildValidationStateUpdate(
    validation: ImplementationValidation,
    codeGeneration: CodeGenerationResult,
  ): Record<string, unknown> {
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

    feedbackUpdate.validationFeedback = this.deriveValidationFeedback(validation, codeGeneration);

    if (validation.perFileFeedback) {
      feedbackUpdate.perFileFeedback = validation.perFileFeedback;
    }

    return feedbackUpdate;
  }

  /**
   * Decide what `validationFeedback` (if any) to attach to the state for the
   * next refinement iteration. Returns undefined when there's nothing to
   * feed back (high score and no cross-file issues).
   */
  private deriveValidationFeedback(
    validation: ImplementationValidation,
    codeGeneration: CodeGenerationResult,
  ): string | undefined {
    const base = this.baseFeedbackForRetry(validation);
    const crossFileText = this.formatCrossFileIssues(codeGeneration.crossFileIssues);
    if (!crossFileText) return base;
    return base
      ? `${base}\n\nCross-file consistency issues:\n${crossFileText}`
      : `Cross-file consistency issues found. The following identifiers do not have matching declarations:\n${crossFileText}\n\nFix each mismatch by either (a) using the correct identifier name from the declaring file, or (b) adding the missing declaration to the appropriate file.`;
  }

  private baseFeedbackForRetry(validation: ImplementationValidation): string | undefined {
    if (validation.feedbackForCodeGen) return validation.feedbackForCodeGen;
    if (validation.overallScore < REFINEMENT_THRESHOLD) return this.synthesizeFeedback(validation);
    return undefined;
  }

  private formatCrossFileIssues(crossFileIssues?: CodeGenerationResult['crossFileIssues']): string | undefined {
    if (!crossFileIssues || crossFileIssues.length === 0) return undefined;
    return crossFileIssues
      .map(i => `- ${i.filePath}: ${i.reason ?? i.description ?? '(no detail)'}`)
      .join('\n');
  }

  /**
   * Synthesize actionable feedback from validation result when feedbackForCodeGen is not provided
   */
  private synthesizeFeedback(validation: ImplementationValidation): string {
    const parts: string[] = [];

    const renderRequirement = (r: { requirement: string; notes?: string }): string => {
      const notes = r.notes ? ` (${r.notes})` : '';
      return `${r.requirement}${notes}`;
    };
    const unmet = renderBulletSection(
      'Unmet requirements',
      validation.requirementsMet.filter(r => !r.met),
      renderRequirement,
    );
    if (unmet) parts.push(unmet);

    const renderCriteria = (c: { criteria: string; notes?: string }): string => {
      const notes = c.notes ? ` (${c.notes})` : '';
      return `${c.criteria}${notes}`;
    };
    const failed = renderBulletSection(
      'Failed acceptance criteria',
      validation.acceptanceCriteriaPassed.filter(c => !c.passed),
      renderCriteria,
    );
    if (failed) parts.push(failed);

    const recs = renderBulletSection(
      'Recommendations',
      validation.recommendations,
      r => r,
    );
    if (recs) parts.push(recs);

    // Include per-file feedback so the code gen module knows which files need fixing
    const failedFiles = (validation.perFileFeedback ?? []).filter(f => !f.passed);
    const filesSection = renderBulletSection(
      'Files that need fixing',
      failedFiles,
      f => `${f.filePath}: ${f.issues.join('; ')}`,
    );
    if (filesSection) parts.push(filesSection);

    return parts.join('\n\n');
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

    // Build code section with actual file content (diff-based for MODIFY files)
    const codeSection = this.buildCodeSection(codeGen.files, 40000);
    const hasModifyFiles = codeGen.files.some(f => f.action === 'modify' && f.originalContent);

    // Test coverage section — omit entirely when test generation was skipped
    const testCoverageBody = testEnv
      ? `Estimated coverage: ${testEnv.estimatedCoverage}%\nTest files: ${testEnv.testFiles.length}`
      : 'No test information available';
    const testSection = this.skipTestEnvironment
      ? '' // Tests intentionally skipped — don't include in prompt at all
      : `\n## Test Coverage\n${testCoverageBody}\n`;

    const prompt = `You are a code reviewer validating a CHT implementation. You MUST examine the actual code content below, not just infer quality from file names or descriptions.

## Issue Requirements
${issue.issue.requirements.map((r, i) => `${i + 1}. ${r}`).join('\n')}

## Acceptance Criteria
${issue.issue.acceptance_criteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}

## Generated Files Summary
${codeGen.files.map((f) => `- ${f.relativePath} (${f.action}): ${f.description}`).join('\n')}

## Actual Code Content
${hasModifyFiles ? 'MODIFY files are shown as unified diffs (changed lines with ±3 lines of context). CREATE files are shown in full.\n' : ''}${codeSection}

## Implementation Summary
${codeGen.summary}
${testSection}
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
- For MODIFY files shown as diffs: evaluate whether the diff correctly implements the requirement. The surrounding context lines (prefixed with space) show unchanged code for orientation. Lines prefixed with - are removed, + are added.
- Do NOT comment on tests, files, or functionality that are not shown in the prompt.${this.skipTestEnvironment ? '\n- Test generation was intentionally skipped for this run. Do NOT penalize the score for missing tests or test coverage.' : ''}
- Every claim in your evaluation must be traceable to specific code content above.
- Do NOT penalize for file truncation — if content appears complete up to a truncation marker, evaluate what is present.

Also provide specific, actionable feedback that could be used to improve the code in a retry.
For each generated file, indicate whether it passed or failed validation, and list specific issues found.

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
  "feedbackForCodeGen": "Specific actionable feedback for code generation retry, addressing gaps in the implementation",
  "perFileFeedback": [
    { "filePath": "path/to/file.ts", "passed": true/false, "issues": ["specific issue found in this file"] }
  ]
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
   * Build a token-efficient code section for validation.
   *
   * Uses a diff-based strategy inspired by Aider / SWE-Agent:
   * - MODIFY files: send a unified diff (only changed lines + 3 lines context)
   *   instead of the full file. This eliminates truncation for large files and
   *   focuses the validator on what actually changed.
   * - CREATE files: send full content (new files must be seen entirely).
   *
   * Falls back to full content for MODIFY files whose originalContent is
   * unavailable (shouldn't happen, but keeps things robust).
   */
  private buildCodeSection(files: GeneratedFile[], budgetChars: number): string {
    if (files.length === 0) return 'No files generated.';
    const sections: string[] = [];
    let remaining = budgetChars;
    for (const file of files) {
      if (remaining < 100) break;
      const section = this.renderAndFitSection(file, remaining);
      sections.push(section);
      remaining -= section.length;
    }
    return sections.join('\n\n');
  }

  private renderAndFitSection(file: GeneratedFile, remaining: number): string {
    const section = this.renderFileSection(file, remaining);
    if (section.length <= remaining) return section;
    return section.substring(0, remaining - 20) + '\n... (truncated)\n```';
  }

  /**
   * Render a single file as a code-section block. MODIFY files become a
   * unified diff when the change ratio is small; CREATE files (and large
   * MODIFY changes) become full content.
   */
  private renderFileSection(file: GeneratedFile, remaining: number): string {
    if (file.action === 'modify' && file.originalContent) {
      return this.renderModifySection(file, remaining);
    }
    const label = file.action === 'create' ? 'NEW FILE' : 'FULL CONTENT';
    return this.formatFullContentSection(file.relativePath, file.content, remaining, label);
  }

  private renderModifySection(file: GeneratedFile, remaining: number): string {
    const { diff, changedLineCount } = this.generateContextDiff(
      file.originalContent!, file.content, file.relativePath,
    );
    const origLineCount = file.originalContent!.split('\n').length;
    const changeRatio = origLineCount > 0 ? changedLineCount / origLineCount : 1;
    if (changeRatio <= 0.6) {
      return `### ${file.relativePath} (MODIFY — diff only)\n\`\`\`diff\n${diff}\n\`\`\``;
    }
    return this.formatFullContentSection(file.relativePath, file.content, remaining, 'MODIFY — full content, extensive changes');
  }

  private formatFullContentSection(filePath: string, content: string, remaining: number, label: string): string {
    const header = `### ${filePath} (${label})\n`;
    const headerCost = header.length + 10;
    const availableForContent = remaining - headerCost;
    const truncated = content.length <= availableForContent
      ? content
      : content.substring(0, availableForContent) + '\n... (truncated)';
    return `${header}\`\`\`\n${truncated}\n\`\`\``;
  }

  /**
   * Generate a unified diff with context lines using the `diff` package (LCS-based).
   * Returns both the diff text and the number of changed lines (for noisy-diff detection).
   */
  private generateContextDiff(original: string, modified: string, filePath: string): { diff: string; changedLineCount: number } {
    const patch = structuredPatch(`a/${filePath}`, `b/${filePath}`, original, modified, '', '', { context: 3 });

    if (patch.hunks.length === 0) {
      return { diff: `(no changes detected in ${filePath})`, changedLineCount: 0 };
    }

    const changedLineCount = patch.hunks.reduce(
      (sum, hunk) => sum + hunk.lines.filter(l => l[0] === '+' || l[0] === '-').length, 0,
    );

    const diff = createTwoFilesPatch(`a/${filePath}`, `b/${filePath}`, original, modified, '', '', { context: 3 });

    return { diff, changedLineCount };
  }

  /**
   * Fallback heuristic validation
   */
  private heuristicValidation(
    issue: IssueTemplate,
    codeGen: CodeGenerationResult,
    testEnv?: TestEnvironmentResult
  ): ImplementationValidation {
    const requirementsMet = checkRequirements(issue, codeGen);
    const acceptanceCriteriaPassed = checkAcceptanceCriteria(issue, codeGen);
    const metCount = requirementsMet.filter(r => r.met).length;
    const passedCount = acceptanceCriteriaPassed.filter(c => c.passed).length;
    const overallScore = this.computeOverallScore({
      metCount,
      passedCount,
      totalRequirements: requirementsMet.length,
      totalCriteria: acceptanceCriteriaPassed.length,
      testEnv,
    });
    const recommendations = this.buildHeuristicRecommendations(metCount, requirementsMet.length, testEnv, overallScore);
    return { requirementsMet, acceptanceCriteriaPassed, overallScore, recommendations };
  }

  private computeOverallScore(opts: {
    metCount: number;
    passedCount: number;
    totalRequirements: number;
    totalCriteria: number;
    testEnv?: TestEnvironmentResult;
  }): number {
    const { metCount, passedCount, totalRequirements, totalCriteria, testEnv } = opts;
    const totalChecks = totalRequirements + totalCriteria;
    const passedChecks = metCount + passedCount;
    let score = totalChecks > 0 ? Math.round((passedChecks / totalChecks) * 100) : 50;
    if (!this.skipTestEnvironment && testEnv && testEnv.testFiles.length > 0) {
      score = Math.min(score + 10, 100);
    }
    return score;
  }

  private buildHeuristicRecommendations(
    metCount: number,
    totalRequirements: number,
    testEnv: TestEnvironmentResult | undefined,
    overallScore: number,
  ): string[] {
    const recommendations: string[] = [];
    if (metCount < totalRequirements) {
      recommendations.push('Some requirements may not be fully implemented - manual review needed');
    }
    if (!this.skipTestEnvironment && (!testEnv || testEnv.testFiles.length === 0)) {
      recommendations.push('Consider adding more test coverage');
    }
    if (overallScore < 70) {
      recommendations.push('Implementation confidence is low - additional review recommended');
    }
    return recommendations;
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
      perFileFeedback: undefined,
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
      allFiles.push(
        ...state.testEnvironment.testFiles,
        ...state.testEnvironment.testDataFiles,
      );
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
      allFiles.push(
        ...state.testEnvironment.testFiles,
        ...state.testEnvironment.testDataFiles,
      );
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
      allFiles.push(
        ...state.testEnvironment.testFiles,
        ...state.testEnvironment.testDataFiles,
      );
    }

    return allFiles;
  }
}
