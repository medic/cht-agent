import {
  TestGenModule,
  TestGenModuleInput,
  TestGenModuleOutput,
  TestScenario,
  TestType,
} from '../../interface';
import { GeneratedFile } from '../../../code-gen/interface';
import {
  LLMProvider,
  LLMToolDefinition,
  ToolHandler,
  createLLMProviderFromEnv,
} from '../../../../llm';
import { readEnv } from '../../../../utils/env';
import { isShutdownRequested } from '../../../../utils/shutdown';
import {
  TestPlanSchema,
  TestContentAssertions,
  RequirementsChecklistSchema,
} from '../../schemas';
import {
  parseSingleFileContent as libParseSingleFileContent,
  looksLikeCodeContent as libLooksLikeCodeContent,
} from '../../../code-gen/lib/output-parsing';
import { sanitizePath } from '../../../code-gen/lib/plan';
import {
  TestGenBudget,
  applyTestPlanBudget,
  assertSpecBudget,
  auditSpecBudget,
  budgetForExtension,
  churnRelevantFiles,
  computeFileChurn,
  computeTestGenBudget,
  newLineCount,
  renderBudgetPromptSection,
  renderSingleFileBudgetSection,
} from '../../lib/budget';
import {
  EMPTY_SPEC_CONTEXT,
  ExistingSpec,
  SpecContext,
  auditPinCoverage,
  canonicalizeChtConfSpecPaths,
  dedupeSpecPlan,
  findExtensionTarget,
  gatherSpecContext,
  renderExtensionSection,
  renderPinnedSpecSection,
  renderSpecInventorySection,
} from '../../lib/spec-inventory';

export const TEST_PLAN_START = '=== TEST PLAN ===';
export const TEST_PLAN_END = '=== END TEST PLAN ===';
const TEST_PLAN_ITEM_RE = /^\d+\.\s*(unit|integration|e2e)\s+(\S+)\s+(?:->|→)\s+(\S+)\s*[-–—]\s*(.+)/i;

export interface TestPlanItem {
  filePath: string;
  testType: TestType;
  targetSourceFile: string;
  description: string;
}

/** Where specs live in a cht-conf project (and what `qaSpecs` frontmatter points at). */
const CONFIG_TEST_ROOT = 'test';

/** cht-core keeps configs under `config/<name>/`; a cht-conf project IS that root. */
const CHT_CORE_CONFIG_PREFIX_RE = /^config\/[^/]+\//;

/**
 * Force cht-conf spec paths under the config project's `test/` root.
 *
 * A cht-conf project is itself a config root, so cht-core-shaped paths like
 * `config/default/test/tasks/x.spec.js` land one tree too deep — the specs are
 * then invisible to the existing `test/tasks/` convention and to the ticket's
 * `qaSpecs` frontmatter, so tier-2 never runs them. Observed live: one run wrote
 * `test/tasks/...` correctly and the next wrote `config/default/test/tasks/...`,
 * so the plan prompt alone does not hold this. No-op for cht-core, where
 * `config/<name>/` is a real location.
 */
export const pinTestPathsToConfigRoot = (
  plan: TestPlanItem[],
  layer: string | undefined,
): TestPlanItem[] => {
  if (layer !== 'cht-conf') return plan;
  return plan.map(item => {
    const stripped = item.filePath.replace(CHT_CORE_CONFIG_PREFIX_RE, '');
    const pinned = stripped.startsWith(`${CONFIG_TEST_ROOT}/`)
      ? stripped
      : `${CONFIG_TEST_ROOT}/${stripped.replace(/^\.?\//, '')}`;
    if (pinned !== item.filePath) {
      console.log(`[Test Gen Module] Pinned spec path to the config root: ${item.filePath} -> ${pinned}`);
    }
    return { ...item, filePath: pinned };
  });
};

const READ_FILE_TOOL: LLMToolDefinition = {
  name: 'read_file',
  description:
    'Read the contents of a source file under test or a test pattern file ' +
    'from the CHT-Core workspace. Use this to inspect implementations, ' +
    'interfaces, or existing test fixtures before generating a test file.',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Relative path within the CHT-Core workspace (e.g. "api/src/controllers/contacts.js")',
      },
    },
    required: ['path'],
  },
};

const LIST_DIRECTORY_TOOL: LLMToolDefinition = {
  name: 'list_directory',
  description:
    'List files and subdirectories within the CHT-Core workspace. ' +
    'Use this to discover existing test files, fixtures, or source files ' +
    'related to the code under test.',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Relative path to a directory (e.g. "api/tests/mocha/")',
      },
    },
    required: ['path'],
  },
};

function buildToolHandler(input: TestGenModuleInput): ToolHandler {
  return async (toolName, toolInput) => {
    const filePath = toolInput.path as string;
    if (toolName === 'read_file') return handleReadFileTool(input, filePath);
    if (toolName === 'list_directory') return handleListDirectoryTool(input, filePath);
    return `Error: Unknown tool: ${toolName}`;
  };
}

async function handleReadFileTool(input: TestGenModuleInput, filePath: string): Promise<string> {
  if (!input.readFile) return 'Error: read_file is not available';
  const content = await input.readFile(filePath);
  return content ?? `Error: File not found: ${filePath}`;
}

async function handleListDirectoryTool(input: TestGenModuleInput, filePath: string): Promise<string> {
  if (!input.listDirectory) return 'Error: list_directory is not available';
  const entries = await input.listDirectory(filePath);
  return entries.length > 0 ? entries.join('\n') : `(empty directory: ${filePath})`;
}

function logContinuationOverBudget(filePath: string, maxContinuations: number): void {
  console.warn(
    `[Test Gen Module]   ! File "${filePath}" still truncated after ${maxContinuations} continuation(s). ` +
    `Consider raising TEST_GEN_MAX_CONTINUATIONS or splitting the file.`
  );
}

type RetryAttemptResult =
  | { outcome: 'success'; file: GeneratedFile; tokensUsed: number }
  | { outcome: 'retry'; failures: string[]; tokensUsed: number }
  | { outcome: 'over-budget'; tokensUsed: number };

function decideRetryNext(
  attempt: RetryAttemptResult,
): { kind: 'terminate'; file: GeneratedFile | null } | { kind: 'retry'; failures: string[] } {
  if (attempt.outcome === 'success') return { kind: 'terminate', file: attempt.file };
  if (attempt.outcome === 'over-budget') return { kind: 'terminate', file: null };
  return { kind: 'retry', failures: attempt.failures };
}

export class ClaudeApiTestGenModule implements TestGenModule {
  name = 'claude-api';

  version = '0.1.0';

  private provider?: LLMProvider;

  /** Per-invocation cache for the TEST_GEN_MAX_CONTINUATIONS env read. Reset at the top of generate(). */
  private maxContinuationsCache: number | null = null;

  constructor(provider?: LLMProvider) {
    this.provider = provider;
  }

  private getProvider(): LLMProvider {
    this.provider ??= createLLMProviderFromEnv();
    return this.provider;
  }

  async generate(input: TestGenModuleInput): Promise<TestGenModuleOutput> {
    const llm = this.getProvider();
    this.resetPerInvocationCaches();

    this.logGenerateStart(input);

    // Scale to the diff before anything else: the budget shapes the plan prompt,
    // truncates the plan, gates each file's size and caps per-file maxTokens.
    const budget = computeTestGenBudget(input.generatedCode);
    this.logBudget(budget);
    const specContext = await gatherSpecContext(input);
    this.logSpecContext(specContext);

    const planResult = await this.resolvePlan(input, llm.modelName, budget, specContext);
    if (planResult.bailout) return planResult.bailout;
    const { plan, planTokens } = planResult;

    this.surfacePlan(plan);

    const genResult = await this.generateTestFilesSequentially(plan, input, budget, specContext);
    const checklistPhase = await this.runChecklistPhase(input, genResult.files);
    const totalTokens = planTokens + genResult.tokensUsed + checklistPhase.tokensUsed;
    const checklist = checklistPhase.checklist;

    const warnings = [
      ...this.validateAgainstManifest(genResult.files, plan),
      ...auditSpecBudget(genResult.files, budget),
      ...auditPinCoverage(genResult.files, specContext),
    ];
    this.logPostCallValidation(warnings);
    this.logGeneratedFiles(genResult.files);

    const combinedWarnings = [...warnings, ...genResult.warnings];

    return {
      files: genResult.files,
      explanation:
        `Generated ${genResult.files.length} test file(s) for "${input.ticket.issue.title}" ` +
        `targeting the ${input.ticket.issue.technical_context.domain} domain.`,
      tokensUsed: totalTokens,
      modelUsed: llm.modelName,
      requirementsChecklist: checklist,
      warnings: combinedWarnings.length > 0 ? combinedWarnings : undefined,
    };
  }

  /**
   * Phase 3: generate the requirements checklist, skipped when no files were
   * produced (no source to checklist, and it avoids a wasted provider call).
   * Non-fatal: a checklist error returns an empty checklist rather than failing
   * the whole generation.
   */
  private async runChecklistPhase(
    input: TestGenModuleInput,
    files: GeneratedFile[],
  ): Promise<{ checklist: TestScenario[]; tokensUsed: number }> {
    if (files.length === 0) {
      console.log('[Test Gen Module] Skipping requirements checklist (0 test files generated)');
      return { checklist: [], tokensUsed: 0 };
    }
    try {
      const checklistResult = await this.generateRequirementsChecklist(input, files);
      return { checklist: checklistResult.checklist, tokensUsed: checklistResult.tokensUsed };
    } catch (error) {
      console.error('[Test Gen Module] Requirements checklist generation failed:', error);
      return { checklist: [], tokensUsed: 0 };
    }
  }

  async validate(): Promise<boolean> {
    if (readEnv('LLM_PROVIDER') === 'claude-cli') return true;
    return Boolean(readEnv('ANTHROPIC_API_KEY'));
  }

  private resetPerInvocationCaches(): void {
    this.maxContinuationsCache = null;
  }

  private logGenerateStart(input: TestGenModuleInput): void {
    console.log(`[Test Gen Module] Generating tests for "${input.ticket.issue.title}"...`);
    console.log(
      `[Test Gen Module] Source files: ${input.generatedCode.length}, test types: ${input.testTypes.join(', ')}`
    );
  }

  private logBudget(budget: TestGenBudget): void {
    console.log(
      `[Test Gen Module] Budget: ${budget.churnedLines} changed source line(s) -> ${budget.tier} tier ` +
      `(<=${budget.maxTestFiles} file(s), <=${budget.maxLinesPerFile} lines/file, ` +
      `<=${budget.maxCasesPerFile} it()/file, <=${budget.maxTotalLines} new lines total)`
    );
  }

  private logSpecContext(ctx: SpecContext): void {
    console.log(
      `[Test Gen Module] Existing specs on disk: ${ctx.existing.length}` +
      (ctx.truncated ? ' (inventory truncated)' : '') +
      `; ticket pins ${ctx.requestedPins.length}` +
      (ctx.missingPins.length > 0 ? `; MISSING pins: ${ctx.missingPins.join(', ')}` : '')
    );
  }

  /**
   * Resolve the plan from one of three sources:
   *  (a) Selective regeneration (failing test files, iteration-3 wiring).
   *  (b) Plan call (generate via the LLM).
   *  (c) Empty plan (early-return a bailout result).
   */
  private async resolvePlan(
    input: TestGenModuleInput,
    modelName: string,
    budget: TestGenBudget,
    specContext: SpecContext,
  ): Promise<{ plan: TestPlanItem[]; planTokens: number; bailout?: never }
    | { bailout: TestGenModuleOutput; plan: TestPlanItem[]; planTokens: number }> {
    const failingTestFiles = readFailingTestFiles(input);
    if (failingTestFiles && failingTestFiles.length > 0) {
      console.log(
        `[Test Gen Module] Selective regeneration: reusing plan for ${failingTestFiles.length} failing file(s)`
      );
      return { plan: [...failingTestFiles], planTokens: 0 };
    }

    try {
      const planResult = await this.generateTestPlan(input, budget, specContext);
      if (planResult.plan.length === 0) {
        console.log('[Test Gen Module] Empty plan generated — no test files to produce');
        return {
          plan: [],
          planTokens: planResult.tokensUsed,
          bailout: {
            files: [],
            explanation: `No test plan generated for "${input.ticket.issue.title}".`,
            tokensUsed: planResult.tokensUsed,
            modelUsed: modelName,
            requirementsChecklist: [],
          },
        };
      }
      return { plan: planResult.plan, planTokens: planResult.tokensUsed };
    } catch (error) {
      console.error('[Test Gen Module] Plan generation failed:', error);
      return {
        plan: [],
        planTokens: 0,
        bailout: {
          files: [],
          explanation: `Test generation failed for "${input.ticket.issue.title}".`,
          tokensUsed: 0,
          modelUsed: modelName,
          requirementsChecklist: [],
        },
      };
    }
  }

  private surfacePlan(plan: TestPlanItem[]): void {
    console.log(`[Test Gen Module] Plan (${plan.length} file(s)):`);
    for (const item of plan) {
      console.log(`[Test Gen Module]   ${item.testType} ${item.filePath} -> ${item.targetSourceFile}`);
    }
  }

  private logPostCallValidation(warnings: string[]): void {
    if (warnings.length === 0) return;
    console.log(`[Test Gen Module] Validation warnings:`);
    for (const warning of warnings) {
      console.log(`[Test Gen Module]   ! ${warning}`);
    }
  }

  private logGeneratedFiles(files: GeneratedFile[]): void {
    console.log(`[Test Gen Module] Generated ${files.length} test file(s):`);
    for (const file of files) {
      console.log(`[Test Gen Module]   + ${file.path}`);
    }
  }

  // ============================================================================
  // Phase 1: Test Plan Generation
  // ============================================================================

  private async generateTestPlan(
    input: TestGenModuleInput,
    budget: TestGenBudget,
    specContext: SpecContext,
  ): Promise<{ plan: TestPlanItem[]; tokensUsed: number }> {
    const llm = this.getProvider();
    const prompt = this.buildTestPlanPrompt(input, budget, specContext);

    const response = await llm.invoke(prompt, { temperature: 0.3, maxTokens: 8192, disableTools: true });
    const tokensUsed = (response.usage?.inputTokens ?? 0) + (response.usage?.outputTokens ?? 0);

    const plan = this.shapePlan(this.parseTestPlan(response.content), input, budget, specContext);

    const validation = TestPlanSchema.safeParse({ items: plan });
    if (!validation.success) {
      console.log(
        `[Test Gen Module] Plan validation warnings: ${validation.error.issues.map(i => i.message).join(', ')}`
      );
    }

    return { plan, tokensUsed };
  }

  /**
   * Deterministic shaping of the raw LLM plan, in order:
   *   pin to the config root -> canonicalize onto the repo's own convention ->
   *   fold near-duplicate names -> truncate to the diff-derived file budget.
   *
   * Enforced in code, not left to the prompt. The pin helper's own comment
   * already records that "the plan prompt alone does not hold this"; the m3/m4
   * bundles show the same for file count (6 specs for a 2-line change, 22 for a
   * ~56-line change) and for near-duplicate names.
   */
  private shapePlan(
    parsed: TestPlanItem[],
    input: TestGenModuleInput,
    budget: TestGenBudget,
    specContext: SpecContext,
  ): TestPlanItem[] {
    const context = input.ticket.issue.technical_context;
    const pinned = pinTestPathsToConfigRoot(parsed, context.layer);
    const canonical = canonicalizeChtConfSpecPaths(pinned, {
      layer: context.layer,
      configArtifact: context.configArtifact,
      artifactName: context.artifactName,
      ctx: specContext,
    });
    const deduped = dedupeSpecPlan(canonical.plan, specContext);
    const capped = applyTestPlanBudget(deduped.plan, budget);
    for (const note of [...canonical.notes, ...deduped.notes]) {
      console.log(`[Test Gen Module] ${note}`);
    }
    for (const dropped of capped.dropped) {
      console.log(
        `[Test Gen Module] Over budget (${budget.tier} tier allows ${budget.maxTestFiles} file(s)); ` +
        `dropped planned spec ${dropped.filePath}`
      );
    }
    return capped.plan;
  }

  parseTestPlan(rawContent: string): TestPlanItem[] {
    const items: TestPlanItem[] = [];

    const planMatch = new RegExp(String.raw`${TEST_PLAN_START}([\s\S]*?)${TEST_PLAN_END}`).exec(rawContent);
    const content = planMatch ? planMatch[1] : rawContent;

    const lineRegex = new RegExp(TEST_PLAN_ITEM_RE.source, 'gim');
    let match;
    while ((match = lineRegex.exec(content)) !== null) {
      items.push({
        testType: match[1].toLowerCase() as TestType,
        filePath: sanitizePath(match[2]),
        targetSourceFile: sanitizePath(match[3]),
        description: match[4].trim(),
      });
    }

    return items;
  }

  // ============================================================================
  // Phase 2: Sequential Test File Generation
  // ============================================================================

  private async generateTestFilesSequentially(
    plan: TestPlanItem[],
    input: TestGenModuleInput,
    budget: TestGenBudget,
    specContext: SpecContext,
  ): Promise<{ files: GeneratedFile[]; tokensUsed: number; warnings: string[] }> {
    const generatedFiles: GeneratedFile[] = [];
    let totalTokens = 0;
    let newLines = 0;
    const warnings: string[] = [];
    const testGenTools = this.buildTestGenTools(input);

    for (let i = 0; i < plan.length; i++) {
      if (isShutdownRequested()) {
        console.log(`[Test Gen Module] Shutdown requested; stopping after ${i} of ${plan.length} files`);
        break;
      }
      if (newLines >= budget.maxTotalLines) {
        const message =
          `total spec-line budget reached (${newLines}/${budget.maxTotalLines} new lines for a ` +
          `${budget.churnedLines}-line source change); skipped ${plan.length - i} planned file(s)`;
        console.log(`[Test Gen Module] ${message}`);
        warnings.push(message);
        break;
      }
      const planItem = plan[i];
      console.log(`[Test Gen Module] Generating file ${i + 1}/${plan.length}: ${planItem.filePath}`);

      const result = await this.generateSingleTestFileWithRetry({
        planItem,
        fullPlan: plan,
        input,
        previouslyGenerated: generatedFiles,
        testGenTools,
        budget,
        specContext,
      });

      totalTokens += result.tokensUsed;
      if (result.file) newLines += newLineCount(result.file);
      this.collectGeneratedFile(result, planItem, generatedFiles, warnings);
    }

    return { files: generatedFiles, tokensUsed: totalTokens, warnings };
  }

  private collectGeneratedFile(
    result: { file: GeneratedFile | null; tokensUsed: number },
    planItem: TestPlanItem,
    generatedFiles: GeneratedFile[],
    warnings: string[],
  ): void {
    if (result.file) {
      generatedFiles.push(result.file);
      console.log(`[Test Gen Module]   OK ${planItem.filePath} (${result.file.content.length} chars)`);
    } else {
      console.log(`[Test Gen Module]   FAILED ${planItem.filePath} (no usable content after retries)`);
      warnings.push(`Failed to generate ${planItem.filePath} after retries`);
    }
  }

  /**
   * Generate a single test file with assertion-based retry (max 3 attempts).
   * Handles truncation via continuation calls within each attempt.
   */
  private async generateSingleTestFileWithRetry(opts: {
    planItem: TestPlanItem;
    fullPlan: TestPlanItem[];
    input: TestGenModuleInput;
    previouslyGenerated: GeneratedFile[];
    testGenTools?: { tools: LLMToolDefinition[]; toolHandler: ToolHandler };
    budget: TestGenBudget;
    specContext: SpecContext;
    maxAttempts?: number;
  }): Promise<{ file: GeneratedFile | null; tokensUsed: number }> {
    const maxAttempts = opts.maxAttempts ?? 3;
    const state = { failures: [] as string[], totalTokens: 0 };
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const decision = await this.executeOneRetryAttempt(opts, attempt, maxAttempts, state);
      if (decision) return decision;
    }
    return { file: null, tokensUsed: state.totalTokens };
  }

  private async executeOneRetryAttempt(
    opts: {
      planItem: TestPlanItem;
      fullPlan: TestPlanItem[];
      input: TestGenModuleInput;
      previouslyGenerated: GeneratedFile[];
      testGenTools?: { tools: LLMToolDefinition[]; toolHandler: ToolHandler };
      budget: TestGenBudget;
      specContext: SpecContext;
    },
    attempt: number,
    maxAttempts: number,
    state: { failures: string[]; totalTokens: number },
  ): Promise<{ file: GeneratedFile | null; tokensUsed: number } | null> {
    if (isShutdownRequested()) {
      console.log(`[Test Gen Module]   Shutdown requested; aborting retry for ${opts.planItem.filePath}`);
      return { file: null, tokensUsed: state.totalTokens };
    }
    if (attempt > 1) {
      console.log(`[Test Gen Module]   Retry ${attempt}/${maxAttempts} for ${opts.planItem.filePath}`);
    }
    const attemptResult = await this.runSingleFileAttempt({
      ...opts,
      previousFailures: state.failures.length > 0 ? state.failures : undefined,
      // The size gate is a retry signal on every attempt but the last; on the
      // last it degrades to a warning so a slightly over-long file is kept
      // rather than thrown away after three paid generations.
      isFinalAttempt: attempt >= maxAttempts,
    });
    state.totalTokens += attemptResult.tokensUsed;
    const decision = decideRetryNext(attemptResult);
    if (decision.kind === 'terminate') return { file: decision.file, tokensUsed: state.totalTokens };
    state.failures = decision.failures;
    return null;
  }

  /**
   * Run one attempt at generating a single test file. The outcome is one of:
   *  - 'success'      : assertions passed; return the file to the retry loop.
   *  - 'retry'        : assertions failed (or LLM returned nothing); the caller
   *                     should iterate again with the failure reasons.
   *  - 'over-budget'  : continuation cap reached after truncation; further
   *                     retries cannot help so the loop must terminate.
   */
  private async runSingleFileAttempt(args: {
    planItem: TestPlanItem;
    fullPlan: TestPlanItem[];
    input: TestGenModuleInput;
    previouslyGenerated: GeneratedFile[];
    testGenTools?: { tools: LLMToolDefinition[]; toolHandler: ToolHandler };
    previousFailures?: string[];
    budget: TestGenBudget;
    specContext: SpecContext;
    isFinalAttempt?: boolean;
  }): Promise<RetryAttemptResult> {
    const result = await this.generateSingleTestFile({
      planItem: args.planItem,
      fullPlan: args.fullPlan,
      input: args.input,
      previouslyGenerated: args.previouslyGenerated,
      testGenTools: args.testGenTools,
      previousFailures: args.previousFailures,
      budget: args.budget,
      specContext: args.specContext,
    });
    let tokensUsed = result.tokensUsed;

    if (!result.file) {
      return { outcome: 'retry', failures: ['LLM call returned no usable content'], tokensUsed };
    }

    let file = result.file;
    if (result.truncated) {
      const continuation = await this.completeTruncatedFile(file, args.planItem, args.input, args.budget);
      tokensUsed += continuation.tokensUsed;
      if (continuation.overBudget) return { outcome: 'over-budget', tokensUsed };
      file = continuation.file;
    }

    const budgetFailures = assertSpecBudget(
      file.content,
      file.path,
      budgetForExtension(args.budget, file.originalContent),
    );
    if (budgetFailures.length > 0 && args.isFinalAttempt) {
      console.warn(
        `[Test Gen Module]   ! Keeping an over-budget file on the final attempt: ` +
        `${budgetFailures.join('; ')}`
      );
    }
    const failures = [
      ...this.assertFileContent(file),
      ...(args.isFinalAttempt ? [] : budgetFailures),
    ];
    if (failures.length === 0) return { outcome: 'success', file, tokensUsed };

    console.log(`[Test Gen Module]   Assertion failures: ${failures.join('; ')}`);
    return { outcome: 'retry', failures, tokensUsed };
  }

  /**
   * Continue a truncated file via continuation calls. Returns the assembled
   * file, plus a flag indicating whether the continuation cap was reached.
   */
  private async completeTruncatedFile(
    file: GeneratedFile,
    planItem: TestPlanItem,
    input: TestGenModuleInput,
    budget: TestGenBudget,
  ): Promise<
    | { overBudget: true; tokensUsed: number }
    | { overBudget: false; file: GeneratedFile; tokensUsed: number }
  > {
    console.log(`[Test Gen Module]   Output truncated for ${planItem.filePath}, continuing...`);
    const contResult = await this.continueTruncatedGeneration(file.content, planItem, input, budget);
    if (contResult.stillTruncated) {
      console.warn(
        `[Test Gen Module]   File "${planItem.filePath}" exceeds the continuation budget; not retrying.`
      );
      return { overBudget: true, tokensUsed: contResult.tokensUsed };
    }
    return {
      overBudget: false,
      file: { ...file, content: file.content + contResult.continuation },
      tokensUsed: contResult.tokensUsed,
    };
  }

  /**
   * Build LLM tool definitions and handler for filesystem access during generation.
   * Returns undefined when neither readFile nor listDirectory callbacks are available.
   */
  private buildTestGenTools(
    input: TestGenModuleInput,
  ): { tools: LLMToolDefinition[]; toolHandler: ToolHandler } | undefined {
    if (!input.readFile && !input.listDirectory) return undefined;
    const tools: LLMToolDefinition[] = [];
    if (input.readFile) tools.push(READ_FILE_TOOL);
    if (input.listDirectory) tools.push(LIST_DIRECTORY_TOOL);
    const toolHandler = buildToolHandler(input);
    return { tools, toolHandler };
  }

  /**
   * Single LLM call to generate one test file.
   * Returns the generated file, token usage, and whether output was truncated.
   */
  private async generateSingleTestFile(opts: {
    planItem: TestPlanItem;
    fullPlan: TestPlanItem[];
    input: TestGenModuleInput;
    previouslyGenerated: GeneratedFile[];
    testGenTools?: { tools: LLMToolDefinition[]; toolHandler: ToolHandler };
    previousFailures?: string[];
    budget: TestGenBudget;
    specContext: SpecContext;
  }): Promise<{ file: GeneratedFile | null; tokensUsed: number; truncated: boolean }> {
    const { planItem, fullPlan, input, previouslyGenerated, testGenTools, previousFailures } = opts;
    // Only ever an agent-owned spec from a previous run; a partner-authored file
    // is redirected to its `.agent.spec.js` sibling during plan shaping and can
    // never be an extension target.
    const extending = findExtensionTarget(opts.specContext, planItem.filePath);
    const prompt = this.buildSingleTestFilePrompt({
      planItem,
      fullPlan,
      input,
      previouslyGenerated,
      previousFailures,
      budget: opts.budget,
      extending,
    });
    const response = await this.invokeLLM(prompt, testGenTools, planItem.filePath, opts.budget);
    if (!response) return { file: null, tokensUsed: 0, truncated: false };
    const tokensUsed = (response.usage?.inputTokens ?? 0) + (response.usage?.outputTokens ?? 0);
    const truncated = response.stopReason === 'max_tokens';
    const rawContent = this.parseSingleFileContent(response.content);

    if (!this.isUsableContent(rawContent, planItem.filePath, response.content.length)) {
      return { file: null, tokensUsed, truncated: false };
    }
    return {
      file: {
        path: planItem.filePath,
        content: rawContent,
        purpose: planItem.description,
        // Marks the file as a MODIFY upstream, so HC2 shows the delta against our
        // previous spec instead of a 300-line "new file", and so the budget audit
        // charges only the new lines.
        ...(extending ? { originalContent: extending.content } : {}),
      },
      tokensUsed,
      truncated,
    };
  }

  private async invokeLLM(
    prompt: string,
    testGenTools: { tools: LLMToolDefinition[]; toolHandler: ToolHandler } | undefined,
    filePath: string,
    budget: TestGenBudget,
  ): Promise<Awaited<ReturnType<LLMProvider['invoke']>> | null> {
    try {
      return await this.getProvider().invoke(prompt, {
        temperature: 0.3,
        // Budget-derived, not 64k: 8,192 tokens is roughly 600 lines of JS, so it
        // only bites once the model is already past a 120-300 line cap. A run
        // that truncates here is a run that was violating the budget anyway.
        maxTokens: budget.maxOutputTokens,
        // A provider that does not honor custom tools (the claude-cli provider)
        // ignores them, appends no deny-list, and runs its own agentic loop with
        // native Write/Edit, writing into the target repo outside staging/HC2.
        // Force text-only (disableTools) there so the deny-list is applied and
        // the response is capturable. Keep tools on capable providers (API, A8).
        ...(testGenTools && this.getProvider().honorsCustomTools
          ? { tools: testGenTools.tools, toolHandler: testGenTools.toolHandler }
          : { disableTools: true }),
      });
    } catch (error) {
      console.error(`[Test Gen Module]   Failed to generate ${filePath}:`, error);
      return null;
    }
  }

  private isUsableContent(rawContent: string, filePath: string, rawCharCount: number): boolean {
    if (!rawContent || rawContent.length < 20) {
      console.log(`[Test Gen Module]   No usable content for ${filePath} (${rawCharCount} raw chars)`);
      return false;
    }
    if (!this.looksLikeCodeContent(rawContent, filePath)) {
      console.log(`[Test Gen Module]   Output for ${filePath} appears to be LLM reasoning, not code — skipping`);
      return false;
    }
    return true;
  }

  // ============================================================================
  // Truncation Handling
  // ============================================================================

  private getMaxContinuations(): number {
    if (this.maxContinuationsCache !== null) return this.maxContinuationsCache;
    const env = readEnv('TEST_GEN_MAX_CONTINUATIONS');
    if (!env) {
      this.maxContinuationsCache = 5;
      return 5;
    }
    const n = Number.parseInt(env, 10);
    const result = Number.isFinite(n) && n > 0 ? n : 5;
    this.maxContinuationsCache = result;
    return result;
  }

  private async continueTruncatedGeneration(
    partialContent: string,
    planItem: TestPlanItem,
    input: TestGenModuleInput,
    budget: TestGenBudget,
    maxContinuations: number = this.getMaxContinuations(),
  ): Promise<{ continuation: string; tokensUsed: number; stillTruncated: boolean }> {
    const acc = { content: '', tokens: 0, stopReason: undefined as string | undefined };
    await this.runContinuationLoop({ partialContent, planItem, input, budget, maxContinuations, acc });
    const stillTruncated = acc.stopReason === 'max_tokens';
    if (stillTruncated) logContinuationOverBudget(planItem.filePath, maxContinuations);
    return { continuation: acc.content, tokensUsed: acc.tokens, stillTruncated };
  }

  private async runContinuationLoop(args: {
    partialContent: string;
    planItem: TestPlanItem;
    input: TestGenModuleInput;
    budget: TestGenBudget;
    maxContinuations: number;
    acc: { content: string; tokens: number; stopReason: string | undefined };
  }): Promise<void> {
    const { partialContent, planItem, input, budget, maxContinuations, acc } = args;
    for (let i = 0; i < maxContinuations; i++) {
      const ok = await this.runOneContinuation({ partialContent, planItem, input, budget, acc, iteration: i });
      if (!ok) return;
      if (acc.stopReason !== 'max_tokens') {
        console.log(`[Test Gen Module]   Continuation complete after ${i + 1} call(s)`);
        return;
      }
      console.log(`[Test Gen Module]   Continuation ${i + 1} still truncated, continuing...`);
    }
  }

  private async runOneContinuation(args: {
    partialContent: string;
    planItem: TestPlanItem;
    input: TestGenModuleInput;
    budget: TestGenBudget;
    acc: { content: string; tokens: number; stopReason: string | undefined };
    iteration: number;
  }): Promise<boolean> {
    const { partialContent, planItem, input, budget, acc, iteration } = args;
    const lastLines = (partialContent + acc.content).split('\n').slice(-50).join('\n');
    const linesSoFar = (partialContent + acc.content).split('\n').length;
    const prompt = this.buildContinuationPrompt(lastLines, planItem, input, budget, linesSoFar);
    let response;
    try {
      response = await this.getProvider().invoke(prompt, {
        temperature: 0.3,
        maxTokens: budget.maxOutputTokens,
        disableTools: true,
      });
    } catch (error) {
      console.error(`[Test Gen Module]   Continuation call ${iteration + 1} failed:`, error);
      return false;
    }
    acc.tokens += (response.usage?.inputTokens ?? 0) + (response.usage?.outputTokens ?? 0);
    const continuation = this.parseSingleFileContent(response.content).replace(/\n$/, '');
    acc.content += '\n' + continuation;
    acc.stopReason = response.stopReason;
    return true;
  }

  // ============================================================================
  // Phase 3: Requirements Checklist
  // ============================================================================

  private async generateRequirementsChecklist(
    input: TestGenModuleInput,
    generatedTestFiles: GeneratedFile[],
  ): Promise<{ checklist: TestScenario[]; tokensUsed: number }> {
    const llm = this.getProvider();
    const prompt = this.buildRequirementsChecklistPrompt(input, generatedTestFiles);

    const response = await llm.invoke(prompt, { temperature: 0.2, maxTokens: 8192, disableTools: true });
    const tokensUsed = (response.usage?.inputTokens ?? 0) + (response.usage?.outputTokens ?? 0);

    const checklist = this.parseRequirementsChecklist(response.content);

    return { checklist, tokensUsed };
  }

  parseRequirementsChecklist(rawContent: string): TestScenario[] {
    const jsonMatch = /\{[\s\S]*\}/.exec(rawContent);
    if (!jsonMatch) return [];

    try {
      const parsed = JSON.parse(jsonMatch[0]);
      const validation = RequirementsChecklistSchema.safeParse(parsed);
      if (validation.success) {
        return validation.data.checklist;
      }
      if (parsed.checklist && Array.isArray(parsed.checklist)) {
        return parsed.checklist;
      }
    } catch {
      // Fall through
    }

    return [];
  }

  // ============================================================================
  // Prompt Builders
  // ============================================================================

  buildTestPlanPrompt(
    input: TestGenModuleInput,
    budget: TestGenBudget = computeTestGenBudget(input.generatedCode),
    specContext: SpecContext = EMPTY_SPEC_CONTEXT,
  ): string {
    const { ticket, orchestrationPlan, generatedCode, testTypes, existingTestExamples } = input;

    const summaryFiles = churnRelevantFiles(generatedCode);
    const sourceFileSummary = (summaryFiles.length > 0 ? summaryFiles : generatedCode)
      .map(f => `- ${f.relativePath} (${f.type}, ${computeFileChurn(f)} changed line(s)): ${f.description}`)
      .join('\n');

    let existingPatterns = '';
    if (existingTestExamples && existingTestExamples.length > 0) {
      existingPatterns = `\n## Existing Test Patterns in CHT\n`;
      for (const example of existingTestExamples.slice(0, 3)) {
        const truncated = example.content.split('\n').slice(0, 40).join('\n');
        existingPatterns += `\n--- ${example.path} ---\n${truncated}\n`;
      }
    }

    return `You are a CHT (Community Health Toolkit) test engineer. Create a test plan for the implementation below.

## Issue Details
Title: ${ticket.issue.title}
Type: ${ticket.issue.type}
Domain: ${ticket.issue.technical_context.domain}

Requirements:
${ticket.issue.requirements.map((r, i) => `${i + 1}. ${r}`).join('\n')}

Acceptance Criteria:
${ticket.issue.acceptance_criteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}

## Implementation Plan
${orchestrationPlan.phases.map((p, i) => `${i + 1}. ${p.name}: ${p.description}`).join('\n')}

## Source Files to Test
${sourceFileSummary}
${renderBudgetPromptSection(budget)}${renderSpecInventorySection(specContext)}${renderPinnedSpecSection(specContext)}
## Test Types Requested
${testTypes.join(', ')}

## CHT Test Conventions
- Unit tests: Mocha + Chai + Sinon, file naming: *.spec.js or *.spec.ts
- Always include sinon.restore() in afterEach
- Integration tests: Rosie factories, CHT contact hierarchy, saveDocs()/createUsers() utilities
- E2E tests: WebdriverIO + Page Object Model, test-id selectors
- Test files mirror source structure: api/tests/mocha/ for api, webapp/tests/ for webapp
${existingPatterns}
${input.additionalContext ? `\n## Feedback from Previous Iteration\n${input.additionalContext}\n` : ''}
## Instructions
List every test file you will create — AT MOST ${budget.maxTestFiles}, and fewer is better. Each must
target a specific source file. One spec that proves the fix beats three that circle it:
extra plan items are dropped by the pipeline before generation.
Only create ${testTypes.join(' and ')} tests as requested.
Reuse an existing spec's directory and naming (see the inventory above). Never invent a
directory, and never plan two names for the same subject.

Use this EXACT format:

${TEST_PLAN_START}
1. unit tests/unit/controllers/contacts.spec.js -> api/src/controllers/contacts.js - Unit tests for contact search endpoint
2. integration tests/integration/contacts-search.spec.js -> api/src/controllers/contacts.js - Integration test with CouchDB for search
${TEST_PLAN_END}

Output ONLY the plan section. Do not generate any test code.`;
  }

  buildSingleTestFilePrompt(opts: {
    planItem: TestPlanItem;
    fullPlan: TestPlanItem[];
    input: TestGenModuleInput;
    previouslyGenerated: GeneratedFile[];
    previousFailures?: string[];
    budget?: TestGenBudget;
    extending?: ExistingSpec;
  }): string {
    const { planItem, fullPlan, input, previouslyGenerated, previousFailures, extending } = opts;
    const { ticket } = input;
    const budget = opts.budget ?? computeTestGenBudget(input.generatedCode);
    const fileBudget = budgetForExtension(budget, extending?.content);

    const planSummary = fullPlan
      .map((p, i) => `${i + 1}. ${p.testType} ${p.filePath} -> ${p.targetSourceFile}`)
      .join('\n');
    const requirementsList = ticket.issue.requirements.map((r, i) => `${i + 1}. ${r}`).join('\n');

    const sourceContext = this.buildSourceContext(planItem, input);
    const patternContext = this.buildPatternContext(planItem, input);
    const previousContext = this.buildPreviousContext(previouslyGenerated);
    const failureContext = this.buildFailureContext(previousFailures);

    return `You are a CHT (Community Health Toolkit) test engineer. Generate a complete test file.

## Test Plan (full context — you are generating one file from this plan)
${planSummary}

## Current Task
Test File: ${planItem.filePath}
Test Type: ${planItem.testType}
Target: ${planItem.targetSourceFile}
Description: ${planItem.description}

## Issue Details
Title: ${ticket.issue.title}
Type: ${ticket.issue.type}
Domain: ${ticket.issue.technical_context.domain}

Requirements:
${requirementsList}
${renderSingleFileBudgetSection(fileBudget, budget.churnedLines)}${renderExtensionSection(extending)}${sourceContext}
${patternContext}
${previousContext}
${failureContext}

## CHT Test Conventions for ${planItem.testType} tests
${this.getTestConventions(planItem.testType)}

## Instructions
Generate the COMPLETE test file for ${planItem.filePath}.
- Include all imports, setup/teardown hooks, and test cases
- Assert the behavior the diff CHANGED, plus ONE regression case for the nearest behavior
  that must not change. Skip happy-path scaffolding that would pass on the unfixed code,
  and skip permutations that differ only in fixture values.
- Stay within ${fileBudget.maxLinesPerFile} lines and ${fileBudget.maxCasesPerFile} it() blocks — hard limit, an over-long file is
  rejected and regenerated
- Follow the CHT test conventions above
- Use descriptive test names that explain the expected behavior

Output ONLY the raw file content. Do NOT wrap in markdown code fences.
Do NOT include any explanations or commentary.
NEVER say "I'm unable to" or ask questions. Just output the test code.`;
  }

  private buildSourceContext(planItem: TestPlanItem, input: TestGenModuleInput): string {
    const targetFile = input.generatedCode.find(
      f => f.relativePath === planItem.targetSourceFile ||
        f.relativePath.endsWith(planItem.targetSourceFile)
    );
    if (!targetFile) return '';
    return `\n## Source Code Under Test (${planItem.targetSourceFile})\n\`\`\`\n${targetFile.content}\n\`\`\``;
  }

  private buildPatternContext(planItem: TestPlanItem, input: TestGenModuleInput): string {
    const examples = input.existingTestExamples;
    if (!examples || examples.length === 0) return '';
    const relevant = examples.find(
      e => e.path.includes(planItem.testType) ||
        (planItem.testType === 'unit' && !e.path.includes('integration') && !e.path.includes('e2e'))
    ) ?? examples[0];
    if (!relevant) return '';
    const truncated = relevant.content.split('\n').slice(0, 50).join('\n');
    return `\n## Example Test Pattern (follow this style)\n--- ${relevant.path} ---\n\`\`\`\n${truncated}\n\`\`\``;
  }

  private buildPreviousContext(previouslyGenerated: GeneratedFile[]): string {
    if (previouslyGenerated.length === 0) return '';
    let previousContext = '\n## Previously Generated Test Files (for consistency)';
    for (const prev of previouslyGenerated) {
      const lines = prev.content.split('\n');
      const preview = lines.slice(0, 10).join('\n');
      const moreLinesNote = lines.length > 10 ? `... (${lines.length} lines)` : '';
      previousContext += `\n### ${prev.path}\n\`\`\`\n${preview}\n${moreLinesNote}\n\`\`\``;
    }
    return previousContext;
  }

  private buildFailureContext(previousFailures?: string[]): string {
    if (!previousFailures || previousFailures.length === 0) return '';
    const failureList = previousFailures.map(f => `- ${f}`).join('\n');
    return `\n## PREVIOUS ATTEMPT FAILED\nYour previous output for this file failed these checks:\n${failureList}\nFix these specific issues. Do not repeat the same mistakes.`;
  }

  private buildContinuationPrompt(
    lastLines: string,
    planItem: TestPlanItem,
    input: TestGenModuleInput,
    budget?: TestGenBudget,
    linesSoFar?: number,
  ): string {
    const { ticket } = input;
    return `You were generating the test file "${planItem.filePath}" for the CHT issue "${ticket.issue.title}".
The previous response was truncated. Continue generating from EXACTLY where the output stopped.

## Last 50 lines of the partial output
\`\`\`
${lastLines}
\`\`\`

## Instructions
- Resume from the next character after the last shown line.
- Do NOT repeat content already shown.
- Do NOT restart from the top of the file.
- Do NOT add prose, explanations, or markdown code fences.
- Continue with the same indentation and style.
- When the test file is complete, simply stop.${budget
    ? `\n- HARD LIMIT: this file may not exceed ${budget.maxLinesPerFile} lines in total and it is already at\n  ${linesSoFar ?? 0}. Close the open describe/it blocks and stop — an over-long file is rejected.`
    : ''}`;
  }

  private buildRequirementsChecklistPrompt(
    input: TestGenModuleInput,
    generatedTestFiles: GeneratedFile[],
  ): string {
    const { ticket } = input;

    const testFileSummary = generatedTestFiles
      .map(f => {
        const itBlocks = f.content.match(/it\(['"`](.*?)['"`]/g) || [];
        const testNames = itBlocks.map(b => b.replace(/it\(['"`]/, '').replace(/['"`]$/, ''));
        const testList = testNames.map(t => `  - ${t}`).join('\n');
        return `File: ${f.path}\nTests:\n${testList}`;
      })
      .join('\n\n');

    return `You are a CHT test engineer. Map each requirement to the test scenarios that cover it.

## Requirements
${ticket.issue.requirements.map((r, i) => `${i + 1}. ${r}`).join('\n')}

## Acceptance Criteria
${ticket.issue.acceptance_criteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}

## Generated Test Files
${testFileSummary}

## Instructions
For each requirement/acceptance criterion, list the test scenarios that verify it.
Categorize each scenario as: happy-path, error, edge-case, or boundary.
Flag any requirements that have NO test coverage.

Respond with this exact JSON format:
{
  "checklist": [
    {
      "requirement": "The exact requirement text",
      "scenarios": [
        {
          "name": "test name from the generated tests",
          "type": "happy-path",
          "description": "How this test verifies the requirement"
        }
      ]
    }
  ]
}

Output ONLY the JSON. No explanations.`;
  }

  // ============================================================================
  // Output parsing
  // ============================================================================

  looksLikeCodeContent(content: string, filePath: string): boolean {
    return libLooksLikeCodeContent(content, filePath);
  }

  parseSingleFileContent(rawOutput: string): string {
    return libParseSingleFileContent(rawOutput);
  }

  /**
   * Public back-compat extractor for raw LLM output.
   * Preserves the existing test-gen behavior (markdown-fence strip + first
   * code-line search) so external callers and the spec at
   * test/layers/test-gen/claude-api-module.spec.ts continue to pass.
   * Internally the per-file generation path uses {@link parseSingleFileContent}
   * (lib helper) for reasoning-preamble protection.
   */
  extractCodeContent(rawContent: string): string {
    let content = rawContent.trim();

    const codeBlockMatch = /^```(?:\w+)?\n([\s\S]*?)\n```$/.exec(content);
    if (codeBlockMatch) {
      content = codeBlockMatch[1];
    }

    const lines = content.split('\n');
    let codeStartIdx = 0;
    for (let i = 0; i < Math.min(lines.length, 10); i++) {
      const line = lines[i].trim();
      if (
        line.startsWith('import ') || line.startsWith('const ') ||
        line.startsWith('require(') || line.startsWith("'use strict'") ||
        line.startsWith('"use strict"') || line.startsWith('/**') ||
        line.startsWith('//') || line.startsWith('describe(') ||
        line.startsWith('module.')
      ) {
        codeStartIdx = i;
        break;
      }
    }

    return lines.slice(codeStartIdx).join('\n').trim();
  }

  // ============================================================================
  // Validation
  // ============================================================================

  private assertFileContent(file: GeneratedFile): string[] {
    return TestContentAssertions.validateTestFile(file.content, file.path);
  }

  validateAgainstManifest(files: GeneratedFile[], plan: TestPlanItem[]): string[] {
    if (plan.length === 0) return [];
    const generatedPaths = new Set(files.map(f => f.path));
    const plannedPaths = new Set(plan.map(p => p.filePath));
    return [
      ...plan
        .filter(item => !generatedPaths.has(item.filePath))
        .map(item => `Planned but not generated: ${item.filePath}`),
      ...files
        .filter(file => !plannedPaths.has(file.path))
        .map(file => `Generated but not planned: ${file.path}`),
    ];
  }

  // ============================================================================
  // Conventions
  // ============================================================================

  private getTestConventions(testType: TestType): string {
    switch (testType) {
      case 'unit':
        return `- Framework: Mocha + Chai + Sinon
- File naming: *.spec.js or *.spec.ts
- Use expect() style assertions from chai
- Stub external dependencies with sinon.stub()
- Always call sinon.restore() in afterEach()
- Structure: describe('ModuleName', () => { describe('methodName', () => { it('should ...') }) })
- Mock CouchDB/PouchDB calls, never hit real databases
- Import pattern: const { expect } = require('chai'); const sinon = require('sinon');`;

      case 'integration':
        return `- Framework: Mocha + Chai + Supertest
- Use Rosie factories for test data (factory.build('contact'), factory.build('report'))
- Use CHT test utilities: saveDocs(), createUsers(), getDoc()
- Set up test database state in before() hooks
- Clean up in after() hooks
- Test real service interactions, not mocked ones
- Use actual CouchDB for data verification`;

      case 'e2e':
        return `- Framework: WebdriverIO + Mocha
- Use Page Object Model pattern
- Select elements with data-test-id attributes: $('[data-test-id="submit-btn"]')
- Use wdio helpers: browser.waitForAngular(), browser.url()
- Structure tests as user workflows, not individual assertions
- Include wait conditions for async operations
- Clean up test data after each test`;
    }
  }
}

/**
 * Read the optional `failingTestFiles` field off the input via a guarded cast.
 * The TestGenModuleInput interface does not surface this field today; the
 * supervisor wiring in a later iteration will plumb it through for selective
 * regeneration. Until then this returns undefined and the generate() flow
 * takes the LLM-plan branch.
 */
function readFailingTestFiles(
  input: TestGenModuleInput,
): ReadonlyArray<TestPlanItem> | undefined {
  const carrier = input as {
    failingTestFiles?: ReadonlyArray<TestPlanItem>;
  };
  return carrier.failingTestFiles;
}

export function createClaudeApiTestGenModule(provider?: LLMProvider): ClaudeApiTestGenModule {
  return new ClaudeApiTestGenModule(provider);
}
