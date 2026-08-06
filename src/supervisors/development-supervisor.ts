/**
 * Development Supervisor
 *
 * Orchestrates the development phase:
 * 1. Code Generation Agent - generates implementation code
 * 2. Validation - validates implementation against requirements
 *
 * Supports two modes:
 * - Preview Mode: Writes to staging area, generates diffs, allows review
 * - Direct Mode: Writes directly to cht-core codebase
 *
 * Includes a refinement loop: if validation score < 70%, the workflow
 * loops back to code generation with feedback (up to MAX_ITERATIONS).
 */

import { StateGraph, START, END, Annotation } from '@langchain/langgraph';
import {
  IssueTemplate,
  DevelopmentState,
  DevelopmentInput,
  DevelopmentOptions,
  OrchestrationPlan,
  ResearchFindings,
  ContextAnalysisResult,
  CodeContextFindings,
  CodeGenerationResult,
  PlanSummaryItem,
  TestGenerationResult,
  ImplementationValidation,
  GeneratedFile,
  FileValidationFeedback,
  FailingFileRef,
  CrossFileIssue,
  XlsformApplyResult,
  XlsformApplyExhausted,
  TriagedRecommendation,
  BlockingEscalation,
} from '../types';
import { CodeGenerationAgent } from '../agents/code-generation-agent';
import { TestGenerationAgent, TestGenerationInput } from '../agents/test-generation-agent';
import { CodeGenModuleRegistry } from '../layers/code-gen/registry';
import { LLMProvider, createLLMProviderFromEnv } from '../llm';
import {
  createStagingDirectory,
  writeToStaging,
  writeToChtCore,
  clearStaging,
  stageArtifact,
} from '../utils/staging';
import { TodoTracker, createSupervisorTodoTracker } from '../utils/todo-tracker';
import { isShutdownRequested } from '../utils/shutdown';
import { applyXlsformFixToProject } from '../utils/xlsform-apply';
import { parseXlsformFixDescriptor, XLSFORM_FIX_DESCRIPTOR_PATH } from '../utils/xlsform-fix';
import { generateHarnessSpec, generateContactFormSpec } from '../utils/cht-conf-test-spec';
import { createTwoFilesPatch, structuredPatch } from 'diff';
import { readEnv } from '../utils/env';
import { REFINEMENT_THRESHOLD, formatValidationScore } from '../utils/score-display';
import {
  applyEscalationToLedger,
  mergeRecommendationLedger,
  planRecommendationEscalation,
  recommendationText,
  summarizeLedger,
  triageRecommendations,
} from '../utils/recommendation-triage';

/**
 * The refinement-loop iteration budget. Default 3; overridable via
 * `DEV_MAX_ITERATIONS` (parsed as an int, clamped to 1–10). Resolved ONCE at
 * module load so the whole graph (both edge resolvers and the exhaustion check)
 * reads a single consistent value. A non-default value is logged so a live run's
 * transcript records the override. Garbage or out-of-range values fall back to
 * the clamped default rather than throwing.
 */
export function resolveMaxIterations(): number {
  const DEFAULT = 3;
  const MIN = 1;
  const MAX = 10;
  const raw = readEnv('DEV_MAX_ITERATIONS');
  if (raw === undefined || raw.trim() === '') return DEFAULT;
  const parsed = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(parsed)) {
    console.log(
      `[Development Supervisor] DEV_MAX_ITERATIONS="${raw}" is not an integer; using default ${DEFAULT}`,
    );
    return DEFAULT;
  }
  const clamped = Math.min(MAX, Math.max(MIN, parsed));
  if (clamped !== DEFAULT) {
    const note = clamped !== parsed ? ` (clamped from ${parsed} into ${MIN}–${MAX})` : '';
    console.log(`[Development Supervisor] MAX_ITERATIONS overridden to ${clamped} via DEV_MAX_ITERATIONS${note}`);
  }
  return clamped;
}

const MAX_ITERATIONS = resolveMaxIterations();

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
  codeGeneration?: {
    crossFileIssues?: { issueType?: string }[];
    files?: { relativePath?: string }[];
  };
  /** Drives selective regeneration; an all-passing set means a retry is a no-op. */
  perFileFeedback?: { passed?: boolean }[];
}

/**
 * True when this run's generation produced the XLSForm-fix descriptor — i.e. a
 * cht-conf form ticket that reached the deterministic apply. Used by the
 * validateImpl resolver to hand the routing decision to applyXlsformFix instead
 * of looping on the (contract-blind) LLM score. Returns false for every
 * cht-core ticket and every no-descriptor run, so their routing is unchanged.
 */
function hasXlsformDescriptor(state: ValidateImplEdgeState): boolean {
  return (state.codeGeneration?.files ?? []).some(
    (f) => f.relativePath === XLSFORM_FIX_DESCRIPTOR_PATH,
  );
}

/**
 * Decide what edge the validateImpl node should take next. Pure function so
 * it can be unit-tested without spinning up the workflow.
 *
 *  - Shutdown requested → '__end__'
 *  - execute-no-op present → '__end__' (R17 v7: looping cannot help)
 *  - XLSForm-fix descriptor present (F8 economics) → '__end__' so the graph
 *    proceeds to applyXlsformFix: the DETERMINISTIC apply verdict, not the
 *    LLM score, decides whether to loop. A passing apply must never be sent
 *    back for a low LLM score; a failing apply loops from applyXlsformFix
 *    with the apply feedback. (This branch keeps cross-file issues honoured:
 *    a compile/adherence issue still loops before we reach the apply — those
 *    signal a broken descriptor write, not a low-quality-but-valid fix.)
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
  // F8 (iteration economics): a cht-conf form ticket that produced a descriptor
  // must let the deterministic applyXlsformFix decide the verdict. Route past
  // the LLM-score gate (which does not understand the descriptor contract)
  // UNLESS a module-level cross-file issue says the descriptor write itself is
  // broken — in that case the normal refine loop still applies.
  if (hasXlsformDescriptor(state) && issues.length === 0) {
    console.log(
      '[Development Supervisor] XLSForm-fix descriptor present; deferring the verdict to applyXlsformFix ' +
        `(LLM score ${score}% is advisory only for this path)`,
    );
    return '__end__';
  }
  const belowBar = score < REFINEMENT_THRESHOLD || issues.length > 0;
  // From iteration 2 on, code generation only reworks the files the per-file
  // feedback marked failing (buildSelectiveRegenInput). When that set is empty
  // the next pass regenerates nothing and just replays an identical
  // plan+execute cycle, so whatever issue is holding the score down survives
  // every retry — the same dead end as execute-no-op above, just reached by a
  // different route. Observed burning three ~4-minute iterations on a single
  // unsatisfiable plan item.
  const feedback = state.perFileFeedback ?? [];
  if (belowBar && iterations >= 1 && feedback.length > 0 && feedback.every(f => f.passed)) {
    console.log(
      '[Development Supervisor] No failing files to regenerate; the refinement loop cannot ' +
        'change the outcome — ending workflow',
    );
    return '__end__';
  }
  if (belowBar && iterations < MAX_ITERATIONS) {
    logRefinementLoop(score, issues, iterations);
    return 'generateCode';
  }
  if (belowBar) {
    console.log(`[Development Supervisor] Below quality bar but max iterations (${MAX_ITERATIONS}) reached — proceeding to END`);
  }

  return '__end__';
}

/**
 * Shape the applyXlsformFix resolver reads. Narrow so the decision is unit-
 * testable without a full langgraph state.
 */
export interface ApplyXlsformFixEdgeState {
  xlsformApply?: unknown;
  xlsformApplyExhausted?: unknown;
  iterationCount?: number;
  codeGeneration?: { crossFileIssues?: { issueType?: string }[] };
}

/**
 * Route out of the applyXlsformFix node (mission 05, F4):
 *  - applied & verified (xlsformApply set) OR nothing to do (passthrough) →
 *    'generateTests' (proceed)
 *  - an xlsform-apply-failed issue with iterations remaining → 'generateCode'
 *    (regenerate the descriptor via the existing refinement loop)
 *  - failed AND out of iterations (exhausted), or shutdown after a failed
 *    apply → '__end__'. This is a LOUD STOP: the descriptor never converted, so
 *    there is no fix to test — generating unit tests here would just produce
 *    junk tests FOR THE DESCRIPTOR JSON (the live-run defect). The node has set
 *    the `xlsformApplyExhausted` marker; the workflow/CLI turn it into a
 *    non-zero-exit failure with a "NO FIX PRODUCED" banner.
 * Pure + exported for unit tests.
 */
export function resolveApplyXlsformFixEdge(
  state: ApplyXlsformFixEdgeState,
): 'generateCode' | 'generateTests' | '__end__' {
  // The node stamps the exhaustion marker on the last failing iteration; once it
  // is set there is nothing left to try — end even if a shutdown races in.
  if (state.xlsformApplyExhausted) {
    return '__end__';
  }
  if (isShutdownRequested()) {
    // A shutdown mid-loop with a failed apply and no marker (edge case): stop
    // rather than segue into test generation over a descriptor that never
    // converted.
    return applyFailed(state) ? '__end__' : 'generateTests';
  }
  if (state.xlsformApply) {
    return 'generateTests';
  }
  const iterations = state.iterationCount ?? 0;
  if (applyFailed(state) && iterations < MAX_ITERATIONS) {
    console.log('[Development Supervisor] xlsform apply failed; looping to regenerate the descriptor');
    return 'generateCode';
  }
  if (applyFailed(state)) {
    // Out of iterations with a still-failing apply — exhausted. (In practice the
    // node has already set the marker, handled above; this keeps the pure
    // resolver correct on its own for direct unit tests.)
    return '__end__';
  }
  return 'generateTests';
}

/** Reason recorded when recommendation-driven refinement is not wired. */
const RECORD_ONLY_DEFERRAL =
  'blocking — recorded for human review; automatic recommendation-driven refinement is off';

/**
 * m4: paths where a recommendation-driven refinement pass is pointless, with the
 * reason to record on the deferral. execute-no-op means generation abstained
 * (another pass replays the same abstain); a descriptor run's verdict belongs to
 * the deterministic applyXlsformFix (F8 economics), not the LLM's advice.
 */
function escalationBlockedReason(codeGeneration: CodeGenerationResult): string | undefined {
  const issues = codeGeneration.crossFileIssues ?? [];
  if (issues.some(i => i.issueType === 'execute-no-op')) {
    return 'blocking — code generation abstained (execute-no-op); another pass cannot help';
  }
  if (hasXlsformDescriptor({ codeGeneration })) {
    return 'blocking — the deterministic XLSForm apply owns the verdict on this path';
  }
  return undefined;
}

function applyFailed(state: ApplyXlsformFixEdgeState): boolean {
  return (state.codeGeneration?.crossFileIssues ?? []).some(
    (i) => i.issueType === 'xlsform-apply-failed',
  );
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
  // Bridge (#63): DeepWiki / canonical-config findings forwarded from research,
  // threaded into the CodeGenerationInput the codeGenerationNode builds.
  codeContextFindings: Annotation<CodeContextFindings | undefined>({
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
  validationResult: Annotation<ImplementationValidation | undefined>({
    reducer: (_current, update) => update ?? _current,
    default: () => undefined,
  }),
  testGeneration: Annotation<TestGenerationResult | undefined>({
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
  /**
   * m4: every validation recommendation with its disposition ('applied', or
   * 'deferred' WITH a reason). Rewritten in full by each validation pass.
   */
  recommendationLedger: Annotation<TriagedRecommendation[]>({
    reducer: (_current, update) => update ?? _current,
    default: () => [],
  }),
  /**
   * m4: the ONE recommendation-driven refinement pass this run is allowed.
   * STICKY on purpose (`update ?? current`) — once set, the validation node will
   * not request a second one, and that is what makes the extra pass
   * non-repeating rather than an infinite loop.
   */
  blockingEscalation: Annotation<BlockingEscalation | undefined>({
    reducer: (_current, update) => update ?? _current,
    default: () => undefined,
  }),
  /**
   * Plan carried in from a previous development run (a QA-driven retry), used
   * on iteration 1 when there is no in-graph codeGeneration to read it from.
   */
  carriedPlan: Annotation<PlanSummaryItem[] | undefined>({
    reducer: (_current, update) => update ?? _current,
    default: () => undefined,
  }),
  /** Mission 05: the applied+verified XLSForm fix artifacts (undefined until PASS). */
  xlsformApply: Annotation<XlsformApplyResult | undefined>({
    reducer: (_current, update) => update ?? _current,
    default: () => undefined,
  }),
  /**
   * Mission 05 (F4): terminal marker set when the XLSForm-fix loop is exhausted
   * (applied + failed every iteration). Its presence routes the graph straight
   * to END and turns the run into a loud CLI failure — never test generation.
   */
  xlsformApplyExhausted: Annotation<XlsformApplyExhausted | undefined>({
    reducer: (_current, update) => update ?? _current,
    default: () => undefined,
  }),
});

export class DevelopmentSupervisor {
  private readonly graph: ReturnType<typeof this.buildGraph>;
  private readonly codeGenAgent: CodeGenerationAgent;
  private readonly testGenAgent: TestGenerationAgent;
  private readonly llm: LLMProvider;
  private readonly todos: TodoTracker;

  constructor(options: DevelopmentSupervisorOptions = {}) {
    this.llm = options.llmProvider || createLLMProviderFromEnv();

    this.codeGenAgent = new CodeGenerationAgent({
      llmProvider: this.llm,
      codeGenRegistry: options.codeGenRegistry,
    });

    this.testGenAgent = new TestGenerationAgent({ llmProvider: this.llm });

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
      .addNode('validateImpl', this.validationNode.bind(this))
      // Mission 05: deterministic XLSForm-fix node between a passing validateImpl
      // and generateTests. Passthrough (no descriptor) for cht-core tickets.
      .addNode('applyXlsformFix', this.applyXlsformFixNode.bind(this))
      // Node name is 'generateTests' (not 'testGeneration'): LangGraph forbids a
      // node name that collides with a state channel, and 'testGeneration' is the
      // channel this node writes.
      .addNode('generateTests', this.testGenerationNode.bind(this))

      // Define edges with conditional routing from validation. The resolver
      // stays pure (returns 'generateCode' | END); the path map remaps its
      // terminal branch through applyXlsformFix (then generateTests) before END,
      // while the refinement self-loop back to generateCode is unchanged.
      .addEdge(START, 'generateCode')
      .addEdge('generateCode', 'validateImpl')
      .addConditionalEdges(
        'validateImpl',
        (state) => resolveValidateImplEdge(state),
        {
          generateCode: 'generateCode',
          [END]: 'applyXlsformFix',
        },
      )
      // Mission 05: applyXlsformFix either proceeds, loops back to regenerate
      // the descriptor (bounded by the shared iterationCount budget), or — when
      // the loop is exhausted (F4) — routes straight to END (the loud stop; NO
      // test generation over a descriptor that never converted).
      .addConditionalEdges(
        'applyXlsformFix',
        (state) => resolveApplyXlsformFixEdge(state),
        {
          generateCode: 'generateCode',
          generateTests: 'generateTests',
          [END]: END,
        },
      )
      .addEdge('generateTests', END);

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
        codeContextFindings: state.codeContextFindings,
        chtCorePath: state.options.chtCorePath,
        additionalContext: state.validationFeedback || undefined,
        passingFiles: selective.passingFiles,
        failingFiles: selective.failingFiles,
        // On entry this still holds the PREVIOUS iteration's result, so its plan
        // is the one to carry forward. On iteration 1 it is empty, and
        // `carriedPlan` supplies the plan from a prior QA-driven run (undefined
        // on a first pass, which is correct — nothing to stay consistent with).
        previousPlan: state.codeGeneration?.plan ?? state.carriedPlan,
      });

      this.todos.complete(todoId);

      return {
        codeGeneration: result,
        currentPhase: 'validation' as const,
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
   * Node: Validation
   */
  private async validationNode(state: typeof DevelopmentStateAnnotation.State) {
    if (isShutdownRequested()) {
      console.log('[Development Supervisor] Shutdown requested; skipping validation node');
      return { currentPhase: 'complete' as const };
    }
    console.log('\n=== VALIDATION NODE ===');
    const todoId = 'development-2';
    this.todos.start(todoId);

    if (!state.issue || !state.codeGeneration) {
      this.todos.fail(todoId, 'Missing required data');
      return { errors: ['Missing required data for validation'], currentPhase: 'validation' as const };
    }
    const { issue, codeGeneration } = state;
    if (codeGeneration.files.length === 0) {
      return this.skipValidationForEmptyFiles({ issue, codeGeneration, todoId });
    }
    return await this.runValidationWithTodo({ issue, codeGeneration, todoId, state });
  }

  private skipValidationForEmptyFiles(opts: {
    issue: IssueTemplate;
    codeGeneration: CodeGenerationResult;
    todoId: string;
  }): { validationResult: ImplementationValidation; currentPhase: 'complete' } {
    console.log('[Development Supervisor] Skipping validation — no files generated');
    this.todos.complete(opts.todoId);
    return {
      validationResult: this.heuristicValidation(opts.issue, opts.codeGeneration),
      currentPhase: 'complete' as const,
    };
  }

  private async runValidationWithTodo(opts: {
    issue: IssueTemplate;
    codeGeneration: CodeGenerationResult;
    todoId: string;
    state: typeof DevelopmentStateAnnotation.State;
  }) {
    try {
      const validation = await this.validateImplementation(
        opts.issue,
        opts.codeGeneration
      );
      this.todos.complete(opts.todoId);
      return this.buildValidationStateUpdate(validation, opts.codeGeneration, opts.state);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.todos.fail(opts.todoId, errorMessage);
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
    state: typeof DevelopmentStateAnnotation.State,
  ): Record<string, unknown> {
    const feedbackUpdate: Record<string, unknown> = {
      validationResult: validation,
      // Validation is done; the terminal testGeneration node owns 'complete'.
      // The resolver routes on score/issues, not on currentPhase, so this is
      // routing-inert. A refinement-loop iteration overwrites it on re-entry.
      currentPhase: 'test-generation' as const,
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

    this.applyRecommendationTriage({ validation, codeGeneration, state, update: feedbackUpdate });

    return feedbackUpdate;
  }

  /**
   * m4: triage this pass's recommendations and, if one of them names a
   * correctness defect, spend the run's single extra refinement pass on it.
   *
   * Deterministic and LLM-free (see utils/recommendation-triage). Mutates the
   * state update in place:
   *  - `recommendationLedger` always — every recommendation gets a disposition,
   *    so nothing is silently dropped even when we do not escalate;
   *  - on escalation only: `blockingEscalation` (the sticky, once-per-run
   *    marker the edge resolver reads), a `perFileFeedback` set that marks the
   *    target files failing while keeping every other generated file passing (so
   *    selective regeneration has real work AND carry-forward is preserved), and
   *    `validationFeedback` with the blocking texts folded in — above the score
   *    threshold deriveValidationFeedback returns undefined, which is why m4's
   *    recommendations never reached code generation.
   */
  private applyRecommendationTriage(args: {
    validation: ImplementationValidation;
    codeGeneration: CodeGenerationResult;
    state: typeof DevelopmentStateAnnotation.State;
    update: Record<string, unknown>;
  }): void {
    const { validation, codeGeneration, state, update } = args;
    const iteration = state.iterationCount ?? 0;
    const ledger = mergeRecommendationLedger({
      previous: state.recommendationLedger ?? [],
      current: triageRecommendations({
        recommendations: validation.recommendations ?? [],
        files: codeGeneration.files,
        iteration,
      }),
      iteration,
      escalatedTexts: state.blockingEscalation?.recommendations ?? [],
    });
    const plan = planRecommendationEscalation({
      ledger,
      iteration,
      maxIterations: MAX_ITERATIONS,
      // Record-only: escalation is not wired (validator-triage edits 6-8 cut), so
      // every open blocking item defers with a reason instead of buying a pass.
      alreadyEscalated: true,
      blockedReason: escalationBlockedReason(codeGeneration) ?? RECORD_ONLY_DEFERRAL,
    });
    const stamped = applyEscalationToLedger(ledger, plan);
    update.recommendationLedger = stamped;
    const counts = summarizeLedger(stamped);
    console.log(
      `[Development Supervisor] Recommendation triage: ${counts.applied} applied, ` +
        `${counts.deferredBlocking} deferred (correctness), ${counts.deferredAdvisory} deferred (advisory)`,
    );
    if (counts.deferredBlocking > 0) {
      console.log(
        `[Development Supervisor] ${counts.deferredBlocking} blocking recommendation(s) DEFERRED — ` +
          `${plan.blockedReason ?? RECORD_ONLY_DEFERRAL}`,
      );
    }
  }


  /**
   * Node: apply XLSForm fix (mission 05).
   *
   * Deterministic, sandbox-side. For a cht-conf form ticket the code-gen CLI
   * wrote only `.cht-agent/xlsform-fix.json`; this node applies it to a temp
   * copy of the config project, converts offline, and asserts the compiled bind
   * against the descriptor's `expect` block. On PASS it stashes the corrected
   * .xlsx/.xml via the xlsformApply channel; on FAIL it emits a CrossFileIssue +
   * perFileFeedback keyed to the descriptor so the refinement loop regenerates
   * it. Passthrough (returns {}) when no descriptor is present — cht-core
   * tickets and non-form runs are unaffected.
   */
  private async applyXlsformFixNode(state: typeof DevelopmentStateAnnotation.State) {
    if (isShutdownRequested()) {
      return {};
    }
    const descriptorFile = (state.codeGeneration?.files ?? []).find(
      (f) => f.relativePath === XLSFORM_FIX_DESCRIPTOR_PATH
    );
    if (!descriptorFile) {
      return {}; // passthrough: cht-core tickets and non-form config runs
    }

    const parsed = parseXlsformFixDescriptor(descriptorFile.content);
    if (!parsed.valid || !parsed.descriptor) {
      return this.xlsformFail(state, `descriptor is invalid: ${parsed.errors.join('; ')}`);
    }

    const configPath = state.options?.chtCorePath;
    if (!configPath) {
      return this.xlsformFail(state, 'no config-project path (options.chtCorePath) to convert against');
    }

    const configArtifact =
      state.issue?.issue.technical_context.configArtifact === 'contact-form'
        ? 'contact-form'
        : 'form';
    const outcome = await applyXlsformFixToProject(parsed.descriptor, configPath, { configArtifact });
    if (!outcome.ok) {
      return this.xlsformFail(state, outcome.error);
    }

    const { bindDiff } = outcome.result;
    console.log(
      `[Development Supervisor] XLSForm fix verified: ${bindDiff.nodeset} relevant ` +
        `${JSON.stringify(bindDiff.before)} -> ${JSON.stringify(bindDiff.after)} ` +
        `(${bindDiff.siblingsUnchanged} sibling bind(s) unchanged)`
    );
    return { xlsformApply: outcome.result };
  }

  /**
   * Build the FAIL state update for applyXlsformFix: append a CrossFileIssue and
   * set perFileFeedback keyed to the descriptor path (an LLM-generated file, so
   * selective regeneration targets it). Does not set xlsformApply.
   *
   * F4: when this is the last iteration (the refinement budget is spent), stamp
   * the `xlsformApplyExhausted` marker so the graph ends loudly instead of
   * generating junk tests, and the CLI reports a failure with `message` as the
   * banner reason. On earlier iterations the marker is left unset so the loop
   * can still regenerate the descriptor.
   */
  private xlsformFail(state: typeof DevelopmentStateAnnotation.State, message: string) {
    console.log(`[Development Supervisor] XLSForm fix FAILED: ${message}`);
    const issue: CrossFileIssue = {
      filePath: XLSFORM_FIX_DESCRIPTOR_PATH,
      issueType: 'xlsform-apply-failed',
      description: message,
    };
    const perFileFeedback: FileValidationFeedback[] = [
      { filePath: XLSFORM_FIX_DESCRIPTOR_PATH, passed: false, issues: [message] },
    ];
    const update: Record<string, unknown> = {
      perFileFeedback,
      validationFeedback: `The XLSForm fix descriptor could not be applied/verified: ${message}`,
    };
    if (state.codeGeneration) {
      update.codeGeneration = {
        ...state.codeGeneration,
        crossFileIssues: [...(state.codeGeneration.crossFileIssues ?? []), issue],
      };
    }
    const iterations = state.iterationCount ?? 0;
    if (iterations >= MAX_ITERATIONS) {
      const exhausted: XlsformApplyExhausted = { iterations, reason: message };
      update.xlsformApplyExhausted = exhausted;
      console.log(
        `[Development Supervisor] XLSForm fix exhausted after ${iterations} iteration(s); ` +
          'ending without test generation (NO FIX PRODUCED).',
      );
    }
    return update;
  }

  /**
   * Node: Test Generation.
   *
   * Terminal node, reachable after the validation branch and outside the
   * refinement loop, so it owns the final progress-tracker bookkeeping and printSummary.
   * It builds input via buildTestGenModuleInput and runs the test-gen agent.
   *
   * Failure is non-fatal: it logs a warning and returns an empty result. It
   * never writes errors/validationFeedback/perFileFeedback, so test generation
   * cannot feed the validation score or trip the refinement loop. It no-ops on
   * shutdown and when there is no generated code to test.
   */
  private async testGenerationNode(
    state: typeof DevelopmentStateAnnotation.State,
  ): Promise<{ testGeneration: TestGenerationResult; currentPhase: 'complete' }> {
    const todoId = 'development-3';
    const emptyResult: TestGenerationResult = { files: [], explanation: '', requirementsChecklist: [] };

    if (isShutdownRequested()) {
      console.log('[Development Supervisor] Shutdown requested; skipping test generation node');
      return this.finishTestGeneration(todoId, emptyResult);
    }

    console.log('\n=== TEST GENERATION NODE ===');

    if (!state.issue || !state.options || !state.researchFindings || !state.orchestrationPlan) {
      console.log('[Development Supervisor] Skipping test generation — missing required data');
      return this.finishTestGeneration(todoId, emptyResult);
    }
    if (!state.codeGeneration || state.codeGeneration.files.length === 0) {
      console.log('[Development Supervisor] Skipping test generation — no generated code to test');
      return this.finishTestGeneration(todoId, emptyResult);
    }

    // P5: contact-form test generation. cht-conf-test-harness 3.0.15 has no
    // loadContactForm, so the contact-form spec is a plain mocha+chai file whose
    // oracle is a DIRECT read of the compiled forms/contact/<form>.xml (no
    // harness). It is generated deterministically from the descriptor + verified
    // bindDiff (the FULL attrs map, incl. absence). Gated on a verified apply;
    // a contact-form ticket without one is a loud skip (no converted form to
    // assert) rather than a fall-through to the LLM agent (which would emit junk).
    if (state.issue?.issue.technical_context.configArtifact === 'contact-form') {
      return this.finishTestGeneration(todoId, this.tryGenerateContactFormSpec(state));
    }

    // F7: layer-aware test generation. For a cht-conf form ticket whose XLSForm
    // fix converted (xlsformApply set), emit ONE deterministic
    // cht-conf-test-harness spec at <configRoot>/test/forms/<form>.spec.js (or
    // the .agent.spec.js sibling when a partner spec exists) and DROP the generic
    // tests/unit descriptor-JS output entirely. Every other ticket falls through
    // to the LLM test-gen agent unchanged.
    const harnessResult = this.tryGenerateHarnessSpec(state);
    if (harnessResult) {
      return this.finishTestGeneration(todoId, harnessResult);
    }

    const input: TestGenerationInput = {
      issue: state.issue,
      researchFindings: state.researchFindings,
      orchestrationPlan: state.orchestrationPlan,
      codeGeneration: state.codeGeneration,
      chtCorePath: state.options.chtCorePath,
      // Test generation was the one consumer of the refinement loop that never
      // saw why the last attempt failed: the field existed but nothing filled
      // it, so specs were regenerated blind against QA and validation feedback
      // that code generation had already acted on.
      ...(state.validationFeedback ? { additionalContext: state.validationFeedback } : {}),
    };
    return this.runTestGenWithFallback(input, todoId, emptyResult);
  }

  /**
   * F7: deterministic cht-conf harness-spec generation. Returns a
   * TestGenerationResult carrying the single generated spec when this run is a
   * cht-conf form fix that converted (an xlsformApply result with a bindDiff and
   * the descriptor still in the code-gen output); returns undefined for every
   * other run so the caller falls through to the LLM test-gen agent unchanged.
   *
   * Scenario is derived from the descriptor + the verified bindDiff (gate bind +
   * corrected relevant), never from LLM imagination; the destination never
   * overwrites a partner spec.
   */
  private tryGenerateHarnessSpec(
    state: typeof DevelopmentStateAnnotation.State,
  ): TestGenerationResult | undefined {
    const apply = state.xlsformApply;
    if (!apply) {
      return undefined;
    }
    const descriptorFile = (state.codeGeneration?.files ?? []).find(
      (f) => f.relativePath === XLSFORM_FIX_DESCRIPTOR_PATH,
    );
    if (!descriptorFile) {
      return undefined;
    }
    const parsed = parseXlsformFixDescriptor(descriptorFile.content);
    if (!parsed.valid || !parsed.descriptor) {
      // A converted apply implies a valid descriptor; guard defensively anyway
      // and fall through to the LLM agent rather than crash the terminal node.
      return undefined;
    }
    const configRoot = state.options?.chtCorePath;
    if (!configRoot) {
      return undefined;
    }
    // P2: the deterministic harness spec is relevant-centric (its oracle asserts
    // the target bind's `relevant`). It only proves a regression when the fix
    // actually CHANGED the relevant — so skip both the attrs-only case (after is
    // undefined) and the unchanged-relevant case (e.g. a removed `calculate` on
    // a bind that keeps its relevant: after === before, and a spec asserting it
    // would pass on the buggy config too — a false-green regression spec). The
    // fix is still fully verified by the dev-phase attrs assert and the QA attrs
    // oracle; a generalized attrs-aware template is a later phase.
    if (apply.bindDiff.after === undefined || apply.bindDiff.after === apply.bindDiff.before) {
      console.log(
        '[Development Supervisor] P2: XLSForm fix has no `relevant` change (attrs-only or unchanged ' +
          'relevant) — SKIPPING deterministic harness spec generation (the relevant-centric template ' +
          'would not distinguish buggy from fixed).',
      );
      return { files: [], explanation: '', requirementsChecklist: [] };
    }
    const spec = generateHarnessSpec(parsed.descriptor, apply.bindDiff, configRoot);
    const file: GeneratedFile = {
      relativePath: spec.relPath,
      content: spec.content,
      language: 'javascript',
      type: 'test',
      description: `cht-conf-test-harness spec for the ${apply.form} XLSForm fix`,
      action: 'create',
    };
    const warnings: string[] = [];
    if (spec.overwriteAvoided) {
      warnings.push(`a partner spec already exists at test/forms/${apply.form}.spec.js; wrote ${spec.relPath} beside it`);
    }
    if (spec.housePatternFromDefault) {
      warnings.push('no existing test/forms spec to detect the house pattern; used the canonical cht-conf-test-harness idiom');
    }
    console.log(
      `[Development Supervisor] F7: emitted deterministic harness spec ${spec.relPath} ` +
        `(dropped tests/unit descriptor-JS output for this cht-conf form ticket)`,
    );
    return {
      files: [file],
      explanation:
        `Deterministic cht-conf-test-harness spec for the ${apply.form} form fix: asserts the ` +
        `compiled forms/app/${apply.form}.xml gates ${apply.bindDiff.nodeset} on the corrected relevant.`,
      requirementsChecklist: [],
      ...(warnings.length > 0 ? { warnings } : {}),
    };
  }

  /**
   * P5: deterministic contact-form spec generation. Returns a
   * TestGenerationResult carrying the single generated plain-mocha spec (a direct
   * forms/contact/<form>.xml bind-attr oracle, no harness) when this run is a
   * contact-form fix that converted; returns an EMPTY result (a loud skip) when
   * there is no verified apply / descriptor / config root — never a fall-through
   * to the LLM agent (whose contact-form output would be junk).
   *
   * Unlike the app-form harness template, this asserts the FULL attrs map from
   * the bindDiff (value attrs by equality, null attrs by absence), so an
   * attrs-only fix (M8's removed calculate) is provable — there is no
   * unchanged-relevant skip.
   */
  private tryGenerateContactFormSpec(
    state: typeof DevelopmentStateAnnotation.State,
  ): TestGenerationResult {
    const emptyResult: TestGenerationResult = { files: [], explanation: '', requirementsChecklist: [] };
    const apply = state.xlsformApply;
    if (!apply) {
      console.log(
        '[Development Supervisor] P5: contact-form ticket without a verified XLSForm apply — ' +
          'SKIPPING test generation (no converted contact form to assert).',
      );
      return emptyResult;
    }
    const descriptorFile = (state.codeGeneration?.files ?? []).find(
      (f) => f.relativePath === XLSFORM_FIX_DESCRIPTOR_PATH,
    );
    if (!descriptorFile) {
      return emptyResult;
    }
    const parsed = parseXlsformFixDescriptor(descriptorFile.content);
    if (!parsed.valid || !parsed.descriptor) {
      return emptyResult;
    }
    const configRoot = state.options?.chtCorePath;
    if (!configRoot) {
      return emptyResult;
    }
    const spec = generateContactFormSpec(parsed.descriptor, apply.bindDiff, configRoot);
    const file: GeneratedFile = {
      relativePath: spec.relPath,
      content: spec.content,
      language: 'javascript',
      type: 'test',
      description: `deterministic contact-form spec for the ${apply.form} XLSForm fix`,
      action: 'create',
    };
    const warnings: string[] = [];
    if (spec.overwriteAvoided) {
      warnings.push(`a partner spec already exists at test/forms/${apply.form}.spec.js; wrote ${spec.relPath} beside it`);
    }
    console.log(
      `[Development Supervisor] P5: emitted deterministic contact-form spec ${spec.relPath} ` +
        `(direct forms/contact/${apply.form}.xml bind-attr oracle; no harness)`,
    );
    return {
      files: [file],
      explanation:
        `Deterministic contact-form spec for the ${apply.form} fix: asserts the compiled ` +
        `forms/contact/${apply.form}.xml bind ${apply.bindDiff.nodeset} carries the fixed attrs ` +
        `(value + absence), read directly from XML (no cht-conf-test-harness).`,
      requirementsChecklist: [],
      ...(warnings.length > 0 ? { warnings } : {}),
    };
  }

  /**
   * Run the test-gen agent and finish the node, with the non-fatal fallback: a
   * generation failure logs a warning and returns an empty result so the run
   * completes. Extracted from testGenerationNode to keep that method flat.
   */
  private async runTestGenWithFallback(
    input: TestGenerationInput,
    todoId: string,
    emptyResult: TestGenerationResult,
  ): Promise<{ testGeneration: TestGenerationResult; currentPhase: 'complete' }> {
    this.todos.start(todoId);
    try {
      const result = await this.testGenAgent.generate(input);
      console.log(`[Development Supervisor] Generated ${result.files.length} test file(s)`);
      return this.finishTestGeneration(todoId, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.warn(`[Development Supervisor] Test generation failed (non-fatal): ${message}`);
      return this.finishTestGeneration(todoId, emptyResult);
    }
  }

  /**
   * Complete the test-generation tracker entry, print the terminal run summary, and
   * return the terminal state update. Shared by every testGenerationNode path
   * so the summary fires exactly once and reads 3/3 at the end of a run.
   */
  private finishTestGeneration(
    todoId: string,
    result: TestGenerationResult,
  ): { testGeneration: TestGenerationResult; currentPhase: 'complete' } {
    this.todos.complete(todoId);
    this.todos.printSummary();
    return { testGeneration: result, currentPhase: 'complete' as const };
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
      recommendationText,
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
  ): Promise<ImplementationValidation> {
    console.log('[Development Supervisor] Validating implementation...');

    // Build code section with actual file content (diff-based for MODIFY files)
    const codeSection = this.buildCodeSection(codeGen.files, 40000);
    const hasModifyFiles = codeGen.files.some(f => f.action === 'modify' && f.originalContent);

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
- Do NOT comment on tests, files, or functionality that are not shown in the prompt.
- Every claim in your evaluation must be traceable to specific code content above.
- Do NOT penalize for file truncation — if content appears complete up to a truncation marker, evaluate what is present.

Also provide specific, actionable feedback that could be used to improve the code in a retry.
For each generated file, indicate whether it passed or failed validation, and list specific issues found.

## Recommendation Rules
- Every recommendation MUST carry a severity. Use "blocking" when NOT doing it leaves a correctness
  defect: a wrong or missing rule, a wrong unit/threshold, a dropped case, a false positive or false
  negative. Use "advisory" ONLY for style, naming, comments, or documentation.
- A recommendation you would phrase with "should" or "must" is blocking, even when the overall score
  is high. Do not soften severity because most requirements passed.
- Set "filePath" to the generated file the recommendation applies to whenever you can.

Respond with a JSON object:
{
  "requirementsMet": [
    { "requirement": "...", "met": true/false, "notes": "..." }
  ],
  "acceptanceCriteriaPassed": [
    { "criteria": "...", "passed": true/false, "notes": "..." }
  ],
  "overallScore": 0-100,
  "recommendations": [
    { "text": "...", "severity": "blocking" | "advisory", "filePath": "path/to/file.ts" }
  ],
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
      return this.heuristicValidation(issue, codeGen);
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
    });
    const recommendations = this.buildHeuristicRecommendations(metCount, requirementsMet.length, overallScore);
    return { requirementsMet, acceptanceCriteriaPassed, overallScore, recommendations };
  }

  private computeOverallScore(opts: {
    metCount: number;
    passedCount: number;
    totalRequirements: number;
    totalCriteria: number;
  }): number {
    const { metCount, passedCount, totalRequirements, totalCriteria } = opts;
    const totalChecks = totalRequirements + totalCriteria;
    const passedChecks = metCount + passedCount;
    return totalChecks > 0 ? Math.round((passedChecks / totalChecks) * 100) : 50;
  }

  private buildHeuristicRecommendations(
    metCount: number,
    totalRequirements: number,
    overallScore: number,
  ): string[] {
    const recommendations: string[] = [];
    if (metCount < totalRequirements) {
      recommendations.push('Some requirements may not be fully implemented - manual review needed');
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
      { content: 'Validate implementation', activeForm: 'Validating implementation' },
      { content: 'Generate tests', activeForm: 'Generating tests' },
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
      codeContextFindings: input.codeContextFindings,
      options: input.options,
      codeGeneration: undefined,
      testGeneration: undefined,
      validationResult: undefined,
      currentPhase: 'init',
      errors: [],
      // A QA retry continues the count rather than restarting, so the log reads
      // "iteration 2" and the MAX_ITERATIONS budget spans the whole ticket.
      iterationCount: input.priorIterations ?? 0,
      validationFeedback: input.additionalContext,
      // m4: a QA retry continues the ledger so the first pass's deferrals still
      // reach HC2 and the PR body. blockingEscalation is deliberately NOT
      // carried — a retry is a new run and may spend its own single pass.
      recommendationLedger: input.priorRecommendationLedger ?? [],
      blockingEscalation: undefined,
      // Seeds the plan carry-forward for a QA retry; the in-graph path
      // (state.codeGeneration.plan) takes over from the second iteration on.
      carriedPlan: input.previousPlan,
      perFileFeedback: undefined,
      xlsformApply: undefined,
      xlsformApplyExhausted: undefined,
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
    if (result.validationResult) {
      // F9: annotate when the deterministic apply verdict overrode a
      // below-threshold LLM score (F8 economics) so a low number is not read as
      // a failed run.
      console.log(
        `Validation Score: ${formatValidationScore({
          overallScore: result.validationResult.overallScore,
          hasVerifiedApply: result.xlsformApply !== undefined,
        })}`,
      );
    }
    // m4: make the disposition of every recommendation visible in the run log,
    // so a deferral is on the record even when nobody reads the PR bundle.
    const ledgerCounts = summarizeLedger(result.recommendationLedger ?? []);
    if (ledgerCounts.total > 0) {
      console.log(
        `Recommendations: ${ledgerCounts.applied} applied, ` +
          `${ledgerCounts.deferredBlocking} deferred (correctness), ` +
          `${ledgerCounts.deferredAdvisory} deferred (advisory)`,
      );
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
    if (state.testGeneration) {
      allFiles.push(...state.testGeneration.files);
    }

    const writtenFiles = await writeToStaging(allFiles, stagingPath);

    // Mission 05: byte-copy the corrected workbook + regenerated XForm into
    // staging (the descriptor stays too, for the HC2 diff; it is cleaned from
    // staging before copyToTarget so .cht-agent never lands in the mount).
    if (state.xlsformApply) {
      writtenFiles.push(...(await this.stageXlsformArtifacts(state.xlsformApply, stagingPath)));
    }

    console.log(`[Development Supervisor] Written ${writtenFiles.length} files to staging: ${stagingPath}`);

    return { stagingPath, writtenFiles };
  }

  /**
   * Byte-copy the mission-05 corrected .xlsx + regenerated .xml into a staging
   * or target tree (binary-safe, bypassing the utf-8 GeneratedFile path).
   * Returns the repo-relative paths written.
   */
  private async stageXlsformArtifacts(apply: XlsformApplyResult, destDir: string): Promise<string[]> {
    await stageArtifact(apply.xlsxPath, apply.xlsxRelPath, destDir);
    await stageArtifact(apply.xmlPath, apply.xmlRelPath, destDir);
    return [apply.xlsxRelPath, apply.xmlRelPath];
  }

  /**
   * Write generated files directly to cht-core
   */
  async writeToChtCore(state: DevelopmentState, chtCorePath: string): Promise<string[]> {
    const allFiles: GeneratedFile[] = [];

    if (state.codeGeneration) {
      allFiles.push(...state.codeGeneration.files);
    }
    if (state.testGeneration) {
      allFiles.push(...state.testGeneration.files);
    }

    // Mission 05: anything under .cht-agent/ is orchestration-internal and must
    // NEVER land in the partner repo — drop it UNCONDITIONALLY on the direct-
    // write path (even when the apply failed and xlsformApply is unset, so the
    // descriptor is still in codeGeneration.files). Mirrors the preview path's
    // removeFromStaging('.cht-agent') before copyToTarget. The corrected binary
    // artifacts are byte-copied separately below only on success.
    const targetFiles = allFiles.filter((f) => !f.relativePath.startsWith('.cht-agent/'));

    const writtenFiles = await writeToChtCore(targetFiles, chtCorePath);

    if (state.xlsformApply) {
      writtenFiles.push(...(await this.stageXlsformArtifacts(state.xlsformApply, chtCorePath)));
    }

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
    if (state.testGeneration) {
      allFiles.push(...state.testGeneration.files);
    }

    return allFiles;
  }
}
