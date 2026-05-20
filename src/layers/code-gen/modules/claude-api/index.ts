import {
  CodeGenModule,
  CodeGenModuleInput,
  CodeGenModuleOutput,
  ContextFile,
  GeneratedFile,
} from '../../interface';
import { LLMProvider, LLMToolDefinition, ToolHandler, createAnthropicProvider, getAPIConfigFromEnv } from '../../../../llm';
import { readEnv } from '../../../../utils/env';
import { isShutdownRequested } from '../../../../utils/shutdown';
import {
  PlanSchema,
  FileContentAssertions,
} from '../../schemas';
import {
  PlanItem,
  parsePlan as libParsePlan,
} from '../../lib/plan';
import {
  FileManifest,
  buildFileManifest as libBuildFileManifest,
  buildOriginalContentMap as libBuildOriginalContentMap,
  fetchMissingModifyFiles as libFetchMissingModifyFiles,
  validateAgainstManifest as libValidateAgainstManifest,
} from '../../lib/file-manifest';
import {
  parseSingleFileContent as libParseSingleFileContent,
  looksLikeCodeContent as libLooksLikeCodeContent,
  looksLikePythonScript as libLooksLikePythonScript,
  extractPythonScript as libExtractPythonScript,
  parseSearchReplaceBlocks as libParseSearchReplaceBlocks,
  applySearchReplace as libApplySearchReplace,
} from '../../lib/output-parsing';
import {
  checkPythonAvailable as libCheckPythonAvailable,
  executePythonTransform as libExecutePythonTransform,
} from '../../lib/python-transform';
import {
  isLargeFile as libIsLargeFile,
} from '../../lib/large-file';
import {
  buildPlanPrompt as libBuildPlanPrompt,
  buildSingleFilePrompt as libBuildSingleFilePrompt,
  buildContinuationPrompt as libBuildContinuationPrompt,
  buildJsonStructureSummary as libBuildJsonStructureSummary,
} from '../../lib/prompts';

export type { PlanItem } from '../../lib/plan';
export type { FileManifest } from '../../lib/file-manifest';

/**
 * Topological plan ordering: producers (types, actions, reducers, selectors)
 * before consumers (services, effects, components, templates). Within the same
 * stage, alphabetical for stable output.
 *
 * The earlier file is in `previouslyGenerated` context for later files, which
 * lets the LLM reference identifiers from upstream files accurately.
 */
const FILE_STAGE_RULES: Array<{ test: RegExp; stage: number }> = [
  { test: /\.types\.ts$/, stage: 1 },
  { test: /\/actions\//, stage: 2 },
  { test: /\/reducers\//, stage: 3 },
  { test: /\/selectors\//, stage: 4 },
  { test: /\/services\//, stage: 5 },
  { test: /\/effects\//, stage: 6 },
  { test: /\.pipe\.ts$/, stage: 7 },
  { test: /\.directive\.ts$/, stage: 7 },
  { test: /\.component\.ts$/, stage: 8 },
  { test: /\.component\.html$/, stage: 9 },
  { test: /\.(scss|css)$/, stage: 10 },
  { test: /\.json$/, stage: 11 },
  { test: /\.properties$/, stage: 12 },
];

function fileStage(filePath: string): number {
  for (const rule of FILE_STAGE_RULES) {
    if (rule.test.test(filePath)) return rule.stage;
  }
  return 5;
}

export class ClaudeApiCodeGenModule implements CodeGenModule {
  name = 'claude-api';

  version = '0.6.0';

  private provider?: LLMProvider;

  /** Per-invocation cache for the python3 availability check. Reset at the top of generate(). */
  private pythonAvailable: boolean | null = null;

  /** Per-invocation cache for the CODE_GEN_MAX_CONTINUATIONS env read. Reset at the top of generate(). */
  private maxContinuationsCache: number | null = null;

  constructor(provider?: LLMProvider) {
    this.provider = provider;
  }

  private getProvider(): LLMProvider {
    // Hard-pin to the Anthropic API. getAPIConfigFromEnv throws in CLI mode,
    // which gives a clear error earlier than the first invoke.
    this.provider ??= createAnthropicProvider(getAPIConfigFromEnv());
    return this.provider;
  }

  /**
   * Invoke an optional callback. Callback failures are logged and swallowed so they
   * never break generation. Returns the callback's promise (or a resolved one if absent).
   */
  private async fireCallback<Args extends unknown[]>(
    label: string,
    callback: ((...args: Args) => void | Promise<void>) | undefined,
    ...args: Args
  ): Promise<void> {
    if (!callback) return;
    try {
      await callback(...args);
    } catch (err) {
      console.log(`[Code Gen Module] Callback ${label} failed (non-fatal): ${err}`);
    }
  }

  async generate(input: CodeGenModuleInput): Promise<CodeGenModuleOutput> {
    // claude-api is hard-pinned to the Anthropic API. If no provider was injected
    // AND env says use the CLI transport, fail fast so the user gets a clear migration
    // path instead of a confused mid-run failure. Check at generate() entry (not the
    // constructor) so registry construction never throws when other modules are also
    // registered alongside claude-api.
    if (!this.provider && process.env.LLM_PROVIDER === 'claude-cli') {
      throw new Error(
        'claude-api module requires LLM_PROVIDER=anthropic with ANTHROPIC_API_KEY set. ' +
        'You requested claude-api under LLM_PROVIDER=claude-cli, which cannot work. ' +
        'Either: (a) unset CODE_GEN_MODULE to use the default claude-code-cli, ' +
        'or (b) set LLM_PROVIDER=anthropic with a valid ANTHROPIC_API_KEY.'
      );
    }
    const llm = this.getProvider();
    this.resetPerInvocationCaches();

    // Local mutable working copy so we never mutate the caller's input.contextFiles.
    const workingContextFiles: ContextFile[] = [...input.contextFiles];

    this.logGenerateStart(input, workingContextFiles);
    const manifest = this.buildFileManifest(workingContextFiles);
    console.log(`[Code Gen Module] Manifest: ${manifest.existingFiles.length} existing file(s), ${manifest.allowedDirectories.length} allowed dir(s)`);

    const planResult = await this.resolvePlan(input, manifest, llm.modelName);
    if (planResult.bailout) return planResult.bailout;
    const { plan, planTokens } = planResult;

    // Phase 2b: Fetch any MODIFY files missing from pre-gathered context.
    // Mutates the working copy only; input.contextFiles stays untouched.
    // May downgrade missing-original MODIFY items to CREATE in place — that is
    // why the plan log and the onPlan callback fire AFTER this step, so all
    // consumers see post-downgrade actions.
    const originalContentMap = this.buildOriginalContentMap(workingContextFiles);
    await this.fetchMissingModifyFiles({
      plan,
      input,
      workingContextFiles,
      originalContentMap,
      manifest,
    });
    await this.surfacePlan(plan, input);

    // Phase 3: Generate files sequentially (one LLM call per file).
    // Downstream prompts need the post-fetch view, so pass a shallow-cloned input.
    const downstreamInput: CodeGenModuleInput = { ...input, contextFiles: workingContextFiles };
    const genResult = await this.generateFilesSequentially(plan, downstreamInput, manifest, originalContentMap);
    const totalTokens = planTokens + genResult.tokensUsed;
    const files = genResult.files;

    this.runPostCallValidation(files, plan, manifest);
    this.logGeneratedFiles(files, manifest);

    return {
      files,
      explanation:
        `Generated ${files.length} file(s) for "${input.ticket.issue.title}" ` +
        `targeting the ${input.ticket.issue.technical_context.domain} domain.`,
      tokensUsed: totalTokens,
      modelUsed: llm.modelName,
    };
  }

  private resetPerInvocationCaches(): void {
    this.pythonAvailable = null;
    this.maxContinuationsCache = null;
  }

  private logGenerateStart(input: CodeGenModuleInput, workingContextFiles: ContextFile[]): void {
    console.log(`[Code Gen Module] Generating code for "${input.ticket.issue.title}"...`);
    console.log(`[Code Gen Module] Context: ${workingContextFiles.length} file(s), ${input.orchestrationPlan.phases.length} phase(s)`);
  }

  /**
   * Resolve the plan from one of three sources:
   *  (a) Selective regeneration → reuse failing file paths verbatim.
   *  (b) Plan call → generate via the LLM.
   *  (c) Empty plan → early-return a bailout result.
   *
   * Returns either a plan + token count, or a bailout CodeGenModuleOutput to
   * short-circuit generate(). Either-or is encoded by the union return type.
   */
  private async resolvePlan(
    input: CodeGenModuleInput,
    manifest: FileManifest,
    modelName: string,
  ): Promise<{ plan: PlanItem[]; planTokens: number; bailout?: never }
    | { bailout: CodeGenModuleOutput; plan: PlanItem[]; planTokens: number }> {
    if (input.failingFiles && input.failingFiles.length > 0) {
      console.log(`[Code Gen Module] Selective regeneration: reusing plan for ${input.failingFiles.length} failing file(s)`);
      const plan: PlanItem[] = input.failingFiles.map(f => ({
        action: f.action === 'create' ? 'CREATE' : 'MODIFY',
        filePath: f.path,
        rationale: 'Regenerate — previous version failed validation',
      }));
      return { plan, planTokens: 0 };
    }

    try {
      const planResult = await this.generatePlan(input, manifest);
      if (planResult.plan.length === 0) {
        console.log('[Code Gen Module] Empty plan generated — no files to produce');
        return {
          plan: [],
          planTokens: planResult.tokensUsed,
          bailout: {
            files: [],
            explanation: `No implementation plan generated for "${input.ticket.issue.title}".`,
            tokensUsed: planResult.tokensUsed,
            modelUsed: modelName,
          },
        };
      }
      return { plan: planResult.plan, planTokens: planResult.tokensUsed };
    } catch (error) {
      console.error('[Code Gen Module] Plan generation failed:', error);
      return {
        plan: [],
        planTokens: 0,
        bailout: {
          files: [],
          explanation: `Code generation failed for "${input.ticket.issue.title}".`,
          tokensUsed: 0,
          modelUsed: modelName,
        },
      };
    }
  }

  private async surfacePlan(plan: PlanItem[], input: CodeGenModuleInput): Promise<void> {
    console.log(`[Code Gen Module] Plan (${plan.length} item(s)):`);
    for (const item of plan) {
      console.log(`[Code Gen Module]   ${item.action} ${item.filePath} — ${item.rationale}`);
    }
    await this.fireCallback('onPlan', input.onPlan, plan);
  }

  private runPostCallValidation(files: GeneratedFile[], plan: PlanItem[], manifest: FileManifest): void {
    const warnings = this.validateAgainstManifest(files, plan, manifest);
    if (warnings.length === 0) return;
    console.log(`[Code Gen Module] Validation warnings:`);
    for (const warning of warnings) {
      console.log(`[Code Gen Module]   ! ${warning}`);
    }
  }

  private logGeneratedFiles(files: GeneratedFile[], manifest: FileManifest): void {
    const existingPaths = new Set(manifest.existingFiles);
    console.log(`[Code Gen Module] Generated ${files.length} file(s):`);
    for (const file of files) {
      const action = existingPaths.has(file.path) ? '~' : '+';
      console.log(`[Code Gen Module]   ${action} ${file.path}`);
    }
  }

  async validate(): Promise<boolean> {
    // claude-api module is hard-pinned to the Anthropic API path; only ANTHROPIC_API_KEY matters.
    return Boolean(readEnv('ANTHROPIC_API_KEY'));
  }

  /**
   * Build a deterministic file manifest from context files.
   * Existing workspace files are candidates for MODIFY.
   * Their parent directories (+ target directory) are valid for CREATE.
   */
  buildFileManifest(contextFiles: ReadonlyArray<ContextFile>): FileManifest {
    return libBuildFileManifest(contextFiles);
  }

  // ============================================================================
  // Two-Step Generation: Plan → Generate All Files
  // ============================================================================

  /**
   * Step 1: Focused LLM call for plan only.
   * Uses truncated context (sufficient for planning decisions).
   */
  private async generatePlan(
    input: CodeGenModuleInput,
    manifest: FileManifest
  ): Promise<{ plan: PlanItem[]; tokensUsed: number }> {
    const llm = this.getProvider();
    const prompt = this.buildPlanPrompt(input, manifest);

    const response = await llm.invoke(prompt, { temperature: 0.3, maxTokens: 8192 });
    const tokensUsed = (response.usage?.inputTokens ?? 0) + (response.usage?.outputTokens ?? 0);

    const plan = this.parsePlan(response.content);

    // Validate plan with Zod
    const validation = PlanSchema.safeParse({ items: plan });
    if (!validation.success) {
      console.log(`[Code Gen Module] Plan validation warnings: ${validation.error.issues.map(i => i.message).join(', ')}`);
    }

    return { plan, tokensUsed };
  }

  /**
   * Step 2: Generate files sequentially — one focused LLM call per planned file.
   * Each call gets the full plan for awareness, the original file (for MODIFY),
   * and summaries of previously generated files for cross-file coherence.
   * If a single file exceeds the token limit, continuation calls handle the overflow.
   */
  private async generateFilesSequentially(
    plan: PlanItem[],
    input: CodeGenModuleInput,
    _manifest: FileManifest,
    originalContentMap: Map<string, string>,
  ): Promise<{ files: GeneratedFile[]; tokensUsed: number }> {
    const generatedFiles: GeneratedFile[] = [];
    let totalTokens = 0;
    const codeGenTools = this.buildCodeGenTools(input);

    // Reorder: generate code files first, large JSON files last.
    // JSON files (e.g., app_settings.json) use Python transform which is slower.
    // Generating code files first builds up context for cross-file coherence.
    const sortedPlan = [...plan].sort((a, b) => {
      const sa = fileStage(a.filePath);
      const sb = fileStage(b.filePath);
      if (sa !== sb) return sa - sb;
      return a.filePath.localeCompare(b.filePath);
    });

    for (let i = 0; i < sortedPlan.length; i++) {
      if (isShutdownRequested()) {
        console.log(`[Code Gen Module] Shutdown requested; stopping after ${i} of ${sortedPlan.length} files`);
        break;
      }
      const planItem = sortedPlan[i];
      console.log(`[Code Gen Module] Generating file ${i + 1}/${plan.length}: ${planItem.filePath}`);

      await this.fireCallback('onFileInProgress', input.onFileInProgress, planItem.filePath);

      const result = await this.generateSingleFileWithRetry({
        planItem,
        fullPlan: plan,
        input,
        originalContentMap,
        previouslyGenerated: generatedFiles,
        codeGenTools,
      });

      totalTokens += result.tokensUsed;
      if (result.file) {
        // Attach original content for MODIFY files so upstream can generate diffs
        const origContent = originalContentMap.get(planItem.filePath);
        if (planItem.action === 'MODIFY' && origContent) {
          result.file.originalContent = origContent;
        }
        generatedFiles.push(result.file);
        console.log(`[Code Gen Module]   OK ${planItem.filePath} (${result.file.content.length} chars)`);
        await this.fireCallback('onFileCompleted', input.onFileCompleted, result.file);
      } else {
        console.log(`[Code Gen Module]   FAILED ${planItem.filePath} (no usable content after retries)`);
        await this.fireCallback(
          'onFileFailed', input.onFileFailed, planItem.filePath, ['No usable content after retries'],
        );
      }
    }

    return { files: generatedFiles, tokensUsed: totalTokens };
  }

  /**
   * Generate a single file with assertion-based retry (max 3 attempts).
   * Handles truncation via continuation calls within each attempt.
   */
  private async generateSingleFileWithRetry(opts: {
    planItem: PlanItem;
    fullPlan: PlanItem[];
    input: CodeGenModuleInput;
    originalContentMap: Map<string, string>;
    previouslyGenerated: GeneratedFile[];
    codeGenTools?: { tools: LLMToolDefinition[]; toolHandler: ToolHandler };
    maxAttempts?: number;
  }): Promise<{ file: GeneratedFile | null; tokensUsed: number }> {
    const { planItem, fullPlan, input, originalContentMap, previouslyGenerated, codeGenTools } = opts;
    const maxAttempts = opts.maxAttempts ?? 3;
    let lastFailures: string[] = [];
    let totalTokens = 0;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (isShutdownRequested()) {
        console.log(`[Code Gen Module]   Shutdown requested; aborting retry for ${planItem.filePath}`);
        return { file: null, tokensUsed: totalTokens };
      }
      if (attempt > 1) {
        console.log(`[Code Gen Module]   Retry ${attempt}/${maxAttempts} for ${planItem.filePath}`);
      }

      const attemptResult = await this.runSingleFileAttempt({
        planItem,
        fullPlan,
        input,
        originalContentMap,
        previouslyGenerated,
        codeGenTools,
        previousFailures: lastFailures.length > 0 ? lastFailures : undefined,
        attempt,
      });
      totalTokens += attemptResult.tokensUsed;

      if (attemptResult.outcome === 'success') return { file: attemptResult.file, tokensUsed: totalTokens };
      if (attemptResult.outcome === 'over-budget') return { file: null, tokensUsed: totalTokens };
      // 'retry' — accumulate failure reasons and let the loop continue.
      lastFailures = attemptResult.failures;
    }

    return { file: null, tokensUsed: totalTokens };
  }

  /**
   * Run one attempt at generating a single file. The outcome is one of:
   *  - 'success'      : assertions passed; return the file to the retry loop.
   *  - 'retry'        : assertions failed (or LLM returned nothing); the caller
   *                     should iterate again with the failure reasons.
   *  - 'over-budget'  : continuation cap reached after truncation; further
   *                     retries cannot help (same prompt, same model, same
   *                     budget) so the loop must terminate.
   */
  private async runSingleFileAttempt(args: {
    planItem: PlanItem;
    fullPlan: PlanItem[];
    input: CodeGenModuleInput;
    originalContentMap: Map<string, string>;
    previouslyGenerated: GeneratedFile[];
    codeGenTools?: { tools: LLMToolDefinition[]; toolHandler: ToolHandler };
    previousFailures?: string[];
    attempt: number;
  }): Promise<
    | { outcome: 'success'; file: GeneratedFile; tokensUsed: number }
    | { outcome: 'retry'; failures: string[]; tokensUsed: number }
    | { outcome: 'over-budget'; tokensUsed: number }
  > {
    const result = await this.generateSingleFile({
      planItem: args.planItem,
      fullPlan: args.fullPlan,
      input: args.input,
      originalContentMap: args.originalContentMap,
      previouslyGenerated: args.previouslyGenerated,
      codeGenTools: args.codeGenTools,
      previousFailures: args.previousFailures,
    });
    let tokensUsed = result.tokensUsed;

    if (!result.file) {
      const failures = ['LLM call returned no usable content'];
      await this.fireCallback(
        'onAttemptFailure', args.input.onAttemptFailure, args.planItem.filePath, args.attempt, failures,
      );
      return { outcome: 'retry', failures, tokensUsed };
    }

    let file = result.file;
    if (result.truncated) {
      const continuation = await this.completeTruncatedFile(file, args.planItem, args.input);
      tokensUsed += continuation.tokensUsed;
      if (continuation.overBudget) return { outcome: 'over-budget', tokensUsed };
      file = continuation.file;
    }

    const failures = this.assertFileContent(file, [args.planItem], args.originalContentMap);
    if (failures.length === 0) return { outcome: 'success', file, tokensUsed };

    console.log(`[Code Gen Module]   Assertion failures: ${failures.join('; ')}`);
    await this.fireCallback(
      'onAttemptFailure', args.input.onAttemptFailure, args.planItem.filePath, args.attempt, failures,
    );
    return { outcome: 'retry', failures, tokensUsed };
  }

  /**
   * Continue a truncated file via continuation calls. Returns the assembled
   * file, plus a flag indicating whether the continuation cap was reached
   * (which the caller treats as a hard failure).
   */
  private async completeTruncatedFile(
    file: GeneratedFile,
    planItem: PlanItem,
    input: CodeGenModuleInput,
  ): Promise<
    | { overBudget: true; tokensUsed: number }
    | { overBudget: false; file: GeneratedFile; tokensUsed: number }
  > {
    console.log(`[Code Gen Module]   Output truncated for ${planItem.filePath}, continuing...`);
    const contResult = await this.continueTruncatedGeneration(file.content, planItem, input);
    if (contResult.stillTruncated) {
      const reasons = [
        `Output truncated after ${this.getMaxContinuations()} continuation(s); file likely too large.`,
        'Consider raising CODE_GEN_MAX_CONTINUATIONS or splitting the file across multiple plan items.',
      ];
      console.warn(
        `[Code Gen Module]   File "${planItem.filePath}" exceeds the continuation budget; not retrying.`
      );
      await this.fireCallback('onFileFailed', input.onFileFailed, planItem.filePath, reasons);
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
  private buildCodeGenTools(
    input: CodeGenModuleInput,
  ): { tools: LLMToolDefinition[]; toolHandler: ToolHandler } | undefined {
    if (!input.readFile && !input.listDirectory) return undefined;

    const tools: LLMToolDefinition[] = [];

    if (input.readFile) {
      tools.push({
        name: 'read_file',
        description:
          'Read the contents of a file from the CHT-Core workspace. ' +
          'Use this to examine type definitions, interfaces, existing implementations, ' +
          'or configuration files you need to understand before generating code.',
        inputSchema: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'Relative path within the CHT-Core workspace (e.g. "webapp/src/ts/services/auth.service.ts")',
            },
          },
          required: ['path'],
        },
      });
    }

    if (input.listDirectory) {
      tools.push({
        name: 'list_directory',
        description:
          'List files and subdirectories in a directory within the CHT-Core workspace. ' +
          'Use this to explore the project structure and find relevant files.',
        inputSchema: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'Relative path to a directory (e.g. "webapp/src/ts/services/")',
            },
          },
          required: ['path'],
        },
      });
    }

    const toolHandler: ToolHandler = async (toolName, toolInput) => {
      const filePath = toolInput.path as string;
      switch (toolName) {
        case 'read_file': {
          if (!input.readFile) return 'Error: read_file is not available';
          const content = await input.readFile(filePath);
          return content ?? `Error: File not found: ${filePath}`;
        }
        case 'list_directory': {
          if (!input.listDirectory) return 'Error: list_directory is not available';
          const entries = await input.listDirectory(filePath);
          return entries.length > 0 ? entries.join('\n') : `(empty directory: ${filePath})`;
        }
        default:
          return `Error: Unknown tool: ${toolName}`;
      }
    };

    return { tools, toolHandler };
  }

  /**
   * Single LLM call to generate one file.
   * Returns the generated file, token usage, and whether output was truncated.
   */
  private async generateSingleFile(opts: {
    planItem: PlanItem;
    fullPlan: PlanItem[];
    input: CodeGenModuleInput;
    originalContentMap: Map<string, string>;
    previouslyGenerated: GeneratedFile[];
    codeGenTools?: { tools: LLMToolDefinition[]; toolHandler: ToolHandler };
    previousFailures?: string[];
  }): Promise<{ file: GeneratedFile | null; tokensUsed: number; truncated: boolean }> {
    const { planItem, fullPlan, input, originalContentMap, previouslyGenerated, codeGenTools, previousFailures } = opts;
    const llm = this.getProvider();
    const prompt = this.buildSingleFilePrompt({
      planItem,
      fullPlan,
      input,
      originalContentMap,
      previouslyGenerated,
      previousFailures,
    });

    let response;
    try {
      response = await llm.invoke(prompt, {
        temperature: 0.3,
        maxTokens: 65536,
        // When code gen tools are available, the LLM uses them for filesystem access during generation.
        ...(codeGenTools
          ? { tools: codeGenTools.tools, toolHandler: codeGenTools.toolHandler }
          : {}),
      });
    } catch (error) {
      console.error(`[Code Gen Module]   Failed to generate ${planItem.filePath}:`, error);
      return { file: null, tokensUsed: 0, truncated: false };
    }

    const tokensUsed = (response.usage?.inputTokens ?? 0) + (response.usage?.outputTokens ?? 0);
    const truncated = response.stopReason === 'max_tokens';
    const rawContent = this.parseSingleFileContent(response.content);

    if (!rawContent || rawContent.length < 10) {
      console.log(`[Code Gen Module]   No usable content for ${planItem.filePath} (${response.content.length} raw chars)`);
      return { file: null, tokensUsed, truncated: false };
    }

    // Reject LLM reasoning/thinking text masquerading as code
    if (!this.looksLikeCodeContent(rawContent, planItem.filePath)) {
      console.log(`[Code Gen Module]   Output for ${planItem.filePath} appears to be LLM reasoning, not code — skipping`);
      return { file: null, tokensUsed, truncated: false };
    }

    // For large MODIFY files: apply surgical edits to the original
    const isLarge = this.isLargeFile(planItem, originalContentMap);
    console.log(`[Code Gen Module]   ${planItem.filePath}: ${isLarge ? 'large-file mode' : 'full-file mode'}`);
    let content = rawContent;
    if (isLarge) {
      const transformed = await this.applyLargeFileTransform(planItem, rawContent, originalContentMap);
      if (transformed === null) return { file: null, tokensUsed, truncated: false };
      content = transformed;
    }

    return {
      file: { path: planItem.filePath, content, purpose: planItem.rationale },
      tokensUsed,
      truncated,
    };
  }

  /**
   * Apply the large-file transform for a MODIFY item. Returns the rewritten
   * content, or `null` when a retry-worthy skip happens. Splits into JSON
   * (Python script transform) and non-JSON (search-replace blocks) paths.
   */
  private async applyLargeFileTransform(
    planItem: PlanItem,
    rawContent: string,
    originalContentMap: Map<string, string>,
  ): Promise<string | null> {
    const original = originalContentMap.get(planItem.filePath)!;
    if (planItem.filePath.endsWith('.json')) {
      return this.applyLargeJsonTransform(planItem, rawContent, original);
    }
    return this.applyLargeSearchReplaceTransform(planItem, rawContent, original);
  }

  private async applyLargeJsonTransform(
    planItem: PlanItem,
    rawContent: string,
    original: string,
  ): Promise<string | null> {
    if (!this.looksLikePythonScript(rawContent)) {
      console.log(`[Code Gen Module]   Expected Python script for large JSON ${planItem.filePath}, got other output — skipping`);
      return null;
    }
    if (!(await this.checkPythonAvailable())) {
      console.log(`[Code Gen Module]   Skipping JSON transform for ${planItem.filePath} — python3 unavailable`);
      return null;
    }
    const cleanedScript = this.extractPythonScript(rawContent);
    const transformed = await this.executePythonTransform(cleanedScript, original, planItem.filePath);
    if (transformed === null) {
      console.log(`[Code Gen Module]   Python transform failed for ${planItem.filePath}, skipping (will retry)`);
      return null;
    }
    console.log(`[Code Gen Module]   Applied Python transform to ${planItem.filePath}`);
    return transformed;
  }

  private applyLargeSearchReplaceTransform(
    planItem: PlanItem,
    rawContent: string,
    original: string,
  ): string | null {
    const blocks = this.parseSearchReplaceBlocks(rawContent);
    if (blocks.length === 0) {
      // LLM output the full file (acceptable; passes looksLikeCodeContent upstream)
      return rawContent;
    }
    const applied = this.applySearchReplace(original, blocks);
    if (applied === null) {
      console.log(`[Code Gen Module]   Search-replace matching failed for ${planItem.filePath}, skipping (will retry)`);
      return null;
    }
    console.log(`[Code Gen Module]   Applied ${blocks.length} search-replace edit(s) to ${planItem.filePath}`);
    return applied;
  }

  /**
   * Handle truncated generation by making continuation calls.
   * Sends the last 50 lines as context and asks the LLM to continue.
   * Repeats up to 5 times until the output completes naturally.
   */
  private getMaxContinuations(): number {
    if (this.maxContinuationsCache !== null) return this.maxContinuationsCache;
    const env = readEnv('CODE_GEN_MAX_CONTINUATIONS');
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
    planItem: PlanItem,
    input: CodeGenModuleInput,
    maxContinuations: number = this.getMaxContinuations(),
  ): Promise<{ continuation: string; tokensUsed: number; stillTruncated: boolean }> {
    const llm = this.getProvider();
    let accumulated = '';
    let totalTokens = 0;
    let lastStopReason: string | undefined;

    for (let i = 0; i < maxContinuations; i++) {
      const fullSoFar = partialContent + accumulated;
      const lastLines = fullSoFar.split('\n').slice(-50).join('\n');

      const prompt = this.buildContinuationPrompt(lastLines, planItem, input);

      let response;
      try {
        response = await llm.invoke(prompt, { temperature: 0.3, maxTokens: 65536 });
      } catch (error) {
        console.error(`[Code Gen Module]   Continuation call ${i + 1} failed:`, error);
        break;
      }

      totalTokens += (response.usage?.inputTokens ?? 0) + (response.usage?.outputTokens ?? 0);
      // Strip the trailing newline that parseSingleFileContent re-appends; otherwise
      // every continuation seam would double up after the C1 fix.
      const continuation = this.parseSingleFileContent(response.content).replace(/\n$/, '');
      accumulated += '\n' + continuation;
      lastStopReason = response.stopReason;

      if (response.stopReason !== 'max_tokens') {
        console.log(`[Code Gen Module]   Continuation complete after ${i + 1} call(s)`);
        break;
      }

      console.log(`[Code Gen Module]   Continuation ${i + 1} still truncated, continuing...`);
    }

    const stillTruncated = lastStopReason === 'max_tokens';
    if (stillTruncated) {
      console.warn(
        `[Code Gen Module]   ! File "${planItem.filePath}" still truncated after ${maxContinuations} continuation(s). ` +
        `Consider raising CODE_GEN_MAX_CONTINUATIONS or splitting the file.`
      );
    }
    return { continuation: accumulated, tokensUsed: totalTokens, stillTruncated };
  }

  // ============================================================================
  // Prompt Builders
  // ============================================================================

  private buildPlanPrompt(input: CodeGenModuleInput, manifest: FileManifest): string {
    return libBuildPlanPrompt(input, manifest);
  }

  /**
   * Build the prompt for generating a single file.
   * Includes the full plan for context, original content for MODIFY,
   * and summaries of previously generated files for coherence.
   */
  buildSingleFilePrompt(opts: {
    planItem: PlanItem;
    fullPlan: PlanItem[];
    input: CodeGenModuleInput;
    originalContentMap: Map<string, string>;
    previouslyGenerated: GeneratedFile[];
    previousFailures?: string[];
  }): string {
    return libBuildSingleFilePrompt(opts);
  }

  buildJsonStructureSummary(content: string): string {
    return libBuildJsonStructureSummary(content);
  }

  /**
   * Check if LLM output looks like a Python script.
   */
  looksLikePythonScript(content: string): boolean {
    return libLooksLikePythonScript(content);
  }

  extractPythonScript(content: string): string {
    return libExtractPythonScript(content);
  }

  looksLikeCodeContent(content: string, filePath: string): boolean {
    return libLooksLikeCodeContent(content, filePath);
  }

  async checkPythonAvailable(): Promise<boolean> {
    if (this.pythonAvailable !== null) return this.pythonAvailable;
    const result = await libCheckPythonAvailable();
    this.pythonAvailable = result;
    return result;
  }

  async executePythonTransform(
    script: string,
    originalContent: string,
    filePath: string,
  ): Promise<string | null> {
    const result = await libExecutePythonTransform(script, originalContent, filePath);
    if (result.pythonMissing) this.pythonAvailable = false;
    return result.content;
  }

  isLargeFile(planItem: PlanItem, originalContentMap: Map<string, string>): boolean {
    return libIsLargeFile(planItem, originalContentMap);
  }

  private buildContinuationPrompt(
    lastLines: string,
    planItem: PlanItem,
    input: CodeGenModuleInput,
  ): string {
    return libBuildContinuationPrompt(lastLines, planItem, input);
  }

  /**
   * Parse search-replace blocks from LLM output.
   * Format: <<<<<<< SEARCH\n...\n=======\n...\n>>>>>>> REPLACE
   */
  parseSearchReplaceBlocks(output: string): Array<{ search: string; replace: string }> {
    return libParseSearchReplaceBlocks(output);
  }

  applySearchReplace(
    original: string,
    blocks: Array<{ search: string; replace: string }>
  ): string | null {
    return libApplySearchReplace(original, blocks);
  }

  parseSingleFileContent(rawOutput: string): string {
    return libParseSingleFileContent(rawOutput);
  }

  // ============================================================================
  // Helpers
  // ============================================================================

  /**
   * Shared file content assertion: checks plaintext, syntax markers,
   * and structural changes (for MODIFY files).
   * Returns an array of failure reasons (empty = pass).
   */
  private assertFileContent(
    file: GeneratedFile,
    plan: PlanItem[],
    originalContentMap: Map<string, string>
  ): string[] {
    const failures: string[] = [];
    failures.push(
      ...FileContentAssertions.isNotPlaintext(file.content, file.path),
      ...FileContentAssertions.hasSyntaxMarkers(file.content, file.path),
    );

    const planItem = plan.find(p => p.filePath === file.path);
    if (planItem?.action === 'MODIFY') {
      const original = originalContentMap.get(file.path);
      if (original) {
        failures.push(...FileContentAssertions.hasStructuralChanges(file.content, original));
      }
    }

    return failures;
  }

  private fetchMissingModifyFiles(opts: {
    plan: PlanItem[];
    input: CodeGenModuleInput;
    workingContextFiles: ContextFile[];
    originalContentMap: Map<string, string>;
    manifest: FileManifest;
  }): Promise<void> {
    const { plan, input, workingContextFiles, originalContentMap, manifest } = opts;
    return libFetchMissingModifyFiles({
      plan,
      readFile: input.readFile,
      workingContextFiles,
      originalContentMap,
      manifest,
    });
  }

  private buildOriginalContentMap(contextFiles: ReadonlyArray<ContextFile>): Map<string, string> {
    return libBuildOriginalContentMap(contextFiles);
  }

  // ============================================================================
  // Parsers
  // ============================================================================

  /**
   * Parse the PLAN section from LLM output.
   */
  parsePlan(output: string): PlanItem[] {
    return libParsePlan(output);
  }

  validateAgainstManifest(
    files: GeneratedFile[],
    plan: PlanItem[],
    manifest: FileManifest
  ): string[] {
    return libValidateAgainstManifest(files, plan, manifest);
  }

}

export function createClaudeApiCodeGenModule(provider?: LLMProvider): ClaudeApiCodeGenModule {
  return new ClaudeApiCodeGenModule(provider);
}
