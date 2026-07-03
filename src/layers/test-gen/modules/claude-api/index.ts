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

export const TEST_PLAN_START = '=== TEST PLAN ===';
export const TEST_PLAN_END = '=== END TEST PLAN ===';
const TEST_PLAN_ITEM_RE = /^\d+\.\s*(unit|integration|e2e)\s+(\S+)\s+(?:->|→)\s+(\S+)\s*[-–—]\s*(.+)/i;

export interface TestPlanItem {
  filePath: string;
  testType: TestType;
  targetSourceFile: string;
  description: string;
}

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

    const planResult = await this.resolvePlan(input, llm.modelName);
    if (planResult.bailout) return planResult.bailout;
    const { plan, planTokens } = planResult;

    this.surfacePlan(plan);

    const genResult = await this.generateTestFilesSequentially(plan, input);
    const checklistPhase = await this.runChecklistPhase(input, genResult.files);
    const totalTokens = planTokens + genResult.tokensUsed + checklistPhase.tokensUsed;
    const checklist = checklistPhase.checklist;

    const warnings = this.validateAgainstManifest(genResult.files, plan);
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

  /**
   * Resolve the plan from one of three sources:
   *  (a) Selective regeneration (failing test files, iteration-3 wiring).
   *  (b) Plan call (generate via the LLM).
   *  (c) Empty plan (early-return a bailout result).
   */
  private async resolvePlan(
    input: TestGenModuleInput,
    modelName: string,
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
      const planResult = await this.generateTestPlan(input);
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
  ): Promise<{ plan: TestPlanItem[]; tokensUsed: number }> {
    const llm = this.getProvider();
    const prompt = this.buildTestPlanPrompt(input);

    const response = await llm.invoke(prompt, { temperature: 0.3, maxTokens: 8192, disableTools: true });
    const tokensUsed = (response.usage?.inputTokens ?? 0) + (response.usage?.outputTokens ?? 0);

    const plan = this.parseTestPlan(response.content);

    const validation = TestPlanSchema.safeParse({ items: plan });
    if (!validation.success) {
      console.log(
        `[Test Gen Module] Plan validation warnings: ${validation.error.issues.map(i => i.message).join(', ')}`
      );
    }

    return { plan, tokensUsed };
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
  ): Promise<{ files: GeneratedFile[]; tokensUsed: number; warnings: string[] }> {
    const generatedFiles: GeneratedFile[] = [];
    let totalTokens = 0;
    const warnings: string[] = [];
    const testGenTools = this.buildTestGenTools(input);

    for (let i = 0; i < plan.length; i++) {
      if (isShutdownRequested()) {
        console.log(`[Test Gen Module] Shutdown requested; stopping after ${i} of ${plan.length} files`);
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
      });

      totalTokens += result.tokensUsed;
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
  }): Promise<RetryAttemptResult> {
    const result = await this.generateSingleTestFile({
      planItem: args.planItem,
      fullPlan: args.fullPlan,
      input: args.input,
      previouslyGenerated: args.previouslyGenerated,
      testGenTools: args.testGenTools,
      previousFailures: args.previousFailures,
    });
    let tokensUsed = result.tokensUsed;

    if (!result.file) {
      return { outcome: 'retry', failures: ['LLM call returned no usable content'], tokensUsed };
    }

    let file = result.file;
    if (result.truncated) {
      const continuation = await this.completeTruncatedFile(file, args.planItem, args.input);
      tokensUsed += continuation.tokensUsed;
      if (continuation.overBudget) return { outcome: 'over-budget', tokensUsed };
      file = continuation.file;
    }

    const failures = this.assertFileContent(file);
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
  ): Promise<
    | { overBudget: true; tokensUsed: number }
    | { overBudget: false; file: GeneratedFile; tokensUsed: number }
  > {
    console.log(`[Test Gen Module]   Output truncated for ${planItem.filePath}, continuing...`);
    const contResult = await this.continueTruncatedGeneration(file.content, planItem, input);
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
  }): Promise<{ file: GeneratedFile | null; tokensUsed: number; truncated: boolean }> {
    const { planItem, fullPlan, input, previouslyGenerated, testGenTools, previousFailures } = opts;
    const prompt = this.buildSingleTestFilePrompt({
      planItem,
      fullPlan,
      input,
      previouslyGenerated,
      previousFailures,
    });
    const response = await this.invokeLLM(prompt, testGenTools, planItem.filePath);
    if (!response) return { file: null, tokensUsed: 0, truncated: false };
    const tokensUsed = (response.usage?.inputTokens ?? 0) + (response.usage?.outputTokens ?? 0);
    const truncated = response.stopReason === 'max_tokens';
    const rawContent = this.parseSingleFileContent(response.content);

    if (!this.isUsableContent(rawContent, planItem.filePath, response.content.length)) {
      return { file: null, tokensUsed, truncated: false };
    }
    return {
      file: { path: planItem.filePath, content: rawContent, purpose: planItem.description },
      tokensUsed,
      truncated,
    };
  }

  private async invokeLLM(
    prompt: string,
    testGenTools: { tools: LLMToolDefinition[]; toolHandler: ToolHandler } | undefined,
    filePath: string,
  ): Promise<Awaited<ReturnType<LLMProvider['invoke']>> | null> {
    try {
      return await this.getProvider().invoke(prompt, {
        temperature: 0.3,
        maxTokens: 65536,
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
    maxContinuations: number = this.getMaxContinuations(),
  ): Promise<{ continuation: string; tokensUsed: number; stillTruncated: boolean }> {
    const acc = { content: '', tokens: 0, stopReason: undefined as string | undefined };
    await this.runContinuationLoop({ partialContent, planItem, input, maxContinuations, acc });
    const stillTruncated = acc.stopReason === 'max_tokens';
    if (stillTruncated) logContinuationOverBudget(planItem.filePath, maxContinuations);
    return { continuation: acc.content, tokensUsed: acc.tokens, stillTruncated };
  }

  private async runContinuationLoop(args: {
    partialContent: string;
    planItem: TestPlanItem;
    input: TestGenModuleInput;
    maxContinuations: number;
    acc: { content: string; tokens: number; stopReason: string | undefined };
  }): Promise<void> {
    const { partialContent, planItem, input, maxContinuations, acc } = args;
    for (let i = 0; i < maxContinuations; i++) {
      const ok = await this.runOneContinuation({ partialContent, planItem, input, acc, iteration: i });
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
    acc: { content: string; tokens: number; stopReason: string | undefined };
    iteration: number;
  }): Promise<boolean> {
    const { partialContent, planItem, input, acc, iteration } = args;
    const lastLines = (partialContent + acc.content).split('\n').slice(-50).join('\n');
    const prompt = this.buildContinuationPrompt(lastLines, planItem, input);
    let response;
    try {
      response = await this.getProvider().invoke(prompt, {
        temperature: 0.3,
        maxTokens: 65536,
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

  buildTestPlanPrompt(input: TestGenModuleInput): string {
    const { ticket, orchestrationPlan, generatedCode, testTypes, existingTestExamples } = input;

    const sourceFileSummary = generatedCode
      .map(f => `- ${f.relativePath} (${f.type}): ${f.description}`)
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
List every test file you will create. Each must target a specific source file.
Only create ${testTypes.join(' and ')} tests as requested.

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
  }): string {
    const { planItem, fullPlan, input, previouslyGenerated, previousFailures } = opts;
    const { ticket } = input;

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
${sourceContext}
${patternContext}
${previousContext}
${failureContext}

## CHT Test Conventions for ${planItem.testType} tests
${this.getTestConventions(planItem.testType)}

## Instructions
Generate the COMPLETE test file for ${planItem.filePath}.
- Include all imports, setup/teardown hooks, and test cases
- Cover happy path, error cases, and edge cases
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
- When the test file is complete, simply stop.`;
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
