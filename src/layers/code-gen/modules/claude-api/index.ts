import {
  CodeGenModule,
  CodeGenModuleInput,
  CodeGenModuleOutput,
  ContextFile,
  GeneratedFile,
} from '../../interface';
import { LLMProvider, createLLMProviderFromEnv, LLMToolDefinition, ToolHandler } from '../../../../llm';
import { readEnv } from '../../../../utils/env';
import {
  PlanSchema,
  FileContentAssertions,
} from '../../schemas';
import { BeadsCodeGenSession } from '../../../../utils/beads-client';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFile } from 'child_process';

const FILE_DELIMITER_START = /^=== FILE: (.+?) ===/;
const PURPOSE_PREFIX = /^PURPOSE: (.+)/;
const CONTENT_START = '--- CONTENT START ---';
const CONTENT_END = '--- CONTENT END ---';
const PLAN_START = '=== PLAN ===';
const PLAN_END = '=== END PLAN ===';
const PLAN_ITEM_RE = /^\d+\.\s*(MODIFY|CREATE)\s+(\S+)\s*[-–—]\s*(.+)/;

/** Patterns that indicate the start of actual source code (vs LLM reasoning text) */
const CODE_START_PATTERNS = [
  /^(import |export |const |let |var |function |class |interface |type |async |return |module\.exports)/,
  /^(require\(|'use strict'|"use strict")/,
  /^(\/\*\*|\/\/\s|\/\*|#!\/)/,
  /^(describe\(|it\(|test\(|beforeEach\(|afterEach\()/,
  /^(package |@Component|@Injectable|@NgModule)/,
  /^\s*[{[<]/,
];

const PROSE_PATTERN = /^[A-Z][a-z].*\s+\w/;
const CODE_KEYWORD_PATTERN = /^(import|export|const|let|var|function|class|interface|type|async|return|module|require|describe|it|test|before|after|package|@)/;

/**
 * Threshold for switching MODIFY files to search-replace / Python transform mode.
 * Code/content files up to 1000 lines get full-file output (fits in 65K output tokens).
 * JSON files up to 2000 lines get full-file output; beyond that, Python transform.
 */
const LARGE_FILE_LINE_THRESHOLD = 1000;
const LARGE_JSON_LINE_THRESHOLD = 2000;

export interface PlanItem {
  action: 'MODIFY' | 'CREATE';
  filePath: string;
  rationale: string;
}

/**
 * Strip backticks and surrounding whitespace from file paths.
 * LLMs frequently wrap paths in markdown backticks (e.g. `config/file.json`).
 */
function sanitizePath(rawPath: string): string {
  return rawPath.replace(/`/g, '').trim();
}

export interface FileManifest {
  existingFiles: string[];
  allowedDirectories: string[];
}

export class ClaudeApiCodeGenModule implements CodeGenModule {
  name = 'claude-api';

  version = '0.6.0';

  private provider?: LLMProvider;

  /** Beads session for the current generate() call — set/cleared per invocation */
  private beadsSession: BeadsCodeGenSession | null = null;

  constructor(provider?: LLMProvider) {
    this.provider = provider;
  }

  private getProvider(): LLMProvider {
    if (!this.provider) {
      this.provider = createLLMProviderFromEnv();
    }
    return this.provider;
  }

  private initBeadsSession(): void {
    const beadsDir = path.join(process.cwd(), '.beads');
    const envFlag = readEnv('BEADS_CODEGEN_ENABLED');
    if (envFlag === 'false') return;
    if (!fs.existsSync(beadsDir)) return;
    this.beadsSession = new BeadsCodeGenSession();
  }

  /** Fire-and-forget Beads tracking — never blocks the generation pipeline */
  private fireBeads(label: string, fn: (session: BeadsCodeGenSession) => Promise<unknown>): void {
    const session = this.beadsSession;
    if (!session) return;
    fn(session).catch(err => {
      console.log(`[Code Gen Module] Beads ${label} failed (non-fatal): ${err}`);
    });
  }

  async generate(input: CodeGenModuleInput): Promise<CodeGenModuleOutput> {
    const llm = this.getProvider();

    console.log(`[Code Gen Module] Generating code for "${input.ticket.issue.title}"...`);
    console.log(`[Code Gen Module] Context: ${input.contextFiles.length} file(s), ${input.orchestrationPlan.phases.length} phase(s)`);

    // Initialize Beads session — await init since subsequent calls depend on it
    this.initBeadsSession();
    if (this.beadsSession) {
      try {
        await this.beadsSession.initSession(input.ticket.issue.title, input.ticket.issue.technical_context.domain);
      } catch (err) {
        console.log(`[Code Gen Module] Beads init failed (non-fatal): ${err}`);
        this.beadsSession = null;
      }
    }

    // Phase 1: Build deterministic file manifest
    const manifest = this.buildFileManifest(input.contextFiles);
    console.log(`[Code Gen Module] Manifest: ${manifest.existingFiles.length} existing file(s), ${manifest.allowedDirectories.length} allowed dir(s)`);

    // Phase 2: Generate plan (separate focused LLM call)
    // On selective regeneration, skip plan generation and reuse failing file paths
    let plan: PlanItem[];
    let planTokens = 0;
    if (input.failingFiles && input.failingFiles.length > 0) {
      console.log(`[Code Gen Module] Selective regeneration: reusing plan for ${input.failingFiles.length} failing file(s)`);
      plan = input.failingFiles.map(f => ({
        action: (f.action === 'create' ? 'CREATE' : 'MODIFY') as 'CREATE' | 'MODIFY',
        filePath: f.path,
        rationale: 'Regenerate — previous version failed validation',
      }));
    } else {
      try {
        const planResult = await this.generatePlan(input, manifest);
        plan = planResult.plan;
        planTokens = planResult.tokensUsed;
      } catch (error) {
        console.error('[Code Gen Module] Plan generation failed:', error);
        return {
          files: [],
          explanation: `Code generation failed for "${input.ticket.issue.title}".`,
          tokensUsed: 0,
          modelUsed: llm.modelName,
        };
      }
    }

    if (plan.length === 0) {
      console.log('[Code Gen Module] Empty plan generated — no files to produce');
      return {
        files: [],
        explanation: `No implementation plan generated for "${input.ticket.issue.title}".`,
        tokensUsed: planTokens,
        modelUsed: llm.modelName,
      };
    }

    console.log(`[Code Gen Module] Plan (${plan.length} item(s)):`);
    for (const item of plan) {
      console.log(`[Code Gen Module]   ${item.action} ${item.filePath} — ${item.rationale}`);
    }

    // Record plan in Beads
    this.fireBeads('recordPlan', s => s.recordPlan(plan));

    // Phase 2b: Fetch any MODIFY files missing from pre-gathered context
    const originalContentMap = this.buildOriginalContentMap(input.contextFiles);
    await this.fetchMissingModifyFiles(plan, input, originalContentMap, manifest);

    // Phase 3: Generate files sequentially (one LLM call per file)
    const genResult = await this.generateFilesSequentially(plan, input, manifest, originalContentMap);

    const totalTokens = planTokens + genResult.tokensUsed;
    const files = genResult.files;

    // Phase 4: Post-call validation
    const warnings = this.validateAgainstManifest(files, plan, manifest);
    if (warnings.length > 0) {
      console.log(`[Code Gen Module] Validation warnings:`);
      for (const warning of warnings) {
        console.log(`[Code Gen Module]   ! ${warning}`);
      }
    }

    // Log each file with create/modify indicator
    const existingPaths = new Set(manifest.existingFiles);
    console.log(`[Code Gen Module] Generated ${files.length} file(s):`);
    for (const file of files) {
      const action = existingPaths.has(file.path) ? '~' : '+';
      console.log(`[Code Gen Module]   ${action} ${file.path}`);
    }

    // Close Beads session with summary
    const successCount = files.length;
    const failCount = plan.length - successCount;
    this.fireBeads('close', s => s.closeSession(plan.length, successCount, failCount));

    const beadsSessionId = this.beadsSession?.getSessionId() ?? undefined;
    this.beadsSession = null; // Clean up per-invocation state

    return {
      files,
      explanation:
        `Generated ${files.length} file(s) for "${input.ticket.issue.title}" ` +
        `targeting the ${input.ticket.issue.technical_context.domain} domain.`,
      tokensUsed: totalTokens,
      modelUsed: llm.modelName,
      beadsSessionId,
    };
  }

  async validate(): Promise<boolean> {
    if (readEnv('LLM_PROVIDER') === 'claude-cli') return true;
    return Boolean(readEnv('ANTHROPIC_API_KEY'));
  }

  /**
   * Build a deterministic file manifest from context files.
   * Existing workspace files are candidates for MODIFY.
   * Their parent directories (+ target directory) are valid for CREATE.
   */
  buildFileManifest(contextFiles: ContextFile[]): FileManifest {
    const existingFiles: string[] = [];
    const dirSet = new Set<string>();

    for (const file of contextFiles) {
      if (file.source === 'workspace') {
        existingFiles.push(file.path);
        // Extract parent directory
        const lastSlash = file.path.lastIndexOf('/');
        if (lastSlash > 0) {
          dirSet.add(file.path.substring(0, lastSlash + 1));
        }
      }
    }

    return {
      existingFiles,
      allowedDirectories: Array.from(dirSet).sort(),
    };
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

    const response = await llm.invoke(prompt, { temperature: 0.3, maxTokens: 8192, disableTools: true });
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
      const aIsJson = a.filePath.endsWith('.json');
      const bIsJson = b.filePath.endsWith('.json');
      if (aIsJson && !bIsJson) return 1;
      if (!aIsJson && bIsJson) return -1;
      return 0;
    });

    for (let i = 0; i < sortedPlan.length; i++) {
      const planItem = sortedPlan[i];
      console.log(`[Code Gen Module] Generating file ${i + 1}/${plan.length}: ${planItem.filePath}`);

      this.fireBeads('markInProgress', s => s.markFileInProgress(planItem.filePath));

      const result = await this.generateSingleFileWithRetry(
        planItem, plan, input, originalContentMap, generatedFiles, codeGenTools,
      );

      totalTokens += result.tokensUsed;
      if (result.file) {
        // Attach original content for MODIFY files so upstream can generate diffs
        const origContent = originalContentMap.get(planItem.filePath);
        if (planItem.action === 'MODIFY' && origContent) {
          result.file.originalContent = origContent;
        }
        generatedFiles.push(result.file);
        console.log(`[Code Gen Module]   OK ${planItem.filePath} (${result.file.content.length} chars)`);
        this.fireBeads('recordCompleted', s =>
          s.recordFileCompleted(result.file!.path, result.file!.content, result.file!.purpose),
        );
      } else {
        console.log(`[Code Gen Module]   FAILED ${planItem.filePath} (no usable content after retries)`);
        this.fireBeads('recordFailed', s =>
          s.recordFileFailed(planItem.filePath, ['No usable content after retries']),
        );
      }
    }

    return { files: generatedFiles, tokensUsed: totalTokens };
  }

  /**
   * Generate a single file with assertion-based retry (max 3 attempts).
   * Handles truncation via continuation calls within each attempt.
   */
  private async generateSingleFileWithRetry(
    planItem: PlanItem,
    fullPlan: PlanItem[],
    input: CodeGenModuleInput,
    originalContentMap: Map<string, string>,
    previouslyGenerated: GeneratedFile[],
    codeGenTools?: { tools: LLMToolDefinition[]; toolHandler: ToolHandler },
    maxAttempts: number = 3,
  ): Promise<{ file: GeneratedFile | null; tokensUsed: number }> {
    let lastFailures: string[] = [];
    let totalTokens = 0;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (attempt > 1) {
        console.log(`[Code Gen Module]   Retry ${attempt}/${maxAttempts} for ${planItem.filePath}`);
      }

      const result = await this.generateSingleFile(
        planItem, fullPlan, input, originalContentMap, previouslyGenerated,
        codeGenTools, lastFailures.length > 0 ? lastFailures : undefined,
      );

      totalTokens += result.tokensUsed;
      if (!result.file) {
        lastFailures = ['LLM call returned no usable content'];
        this.fireBeads('recordAttemptFailure', s =>
          s.recordAttemptFailure(planItem.filePath, attempt, lastFailures),
        );
        continue;
      }

      // Handle truncation — continue generating from where it left off
      let file = result.file;
      if (result.truncated) {
        console.log(`[Code Gen Module]   Output truncated for ${planItem.filePath}, continuing...`);
        const contResult = await this.continueTruncatedGeneration(
          file.content, planItem, input,
        );
        totalTokens += contResult.tokensUsed;
        file = { ...file, content: file.content + contResult.continuation };
      }

      // Run assertions
      const failures = this.assertFileContent(file, [planItem], originalContentMap);
      if (failures.length === 0) {
        return { file, tokensUsed: totalTokens };
      }

      console.log(`[Code Gen Module]   Assertion failures: ${failures.join('; ')}`);
      lastFailures = failures;
      this.fireBeads('recordAttemptFailure', s =>
        s.recordAttemptFailure(planItem.filePath, attempt, failures),
      );
    }

    return { file: null, tokensUsed: totalTokens };
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
  private async generateSingleFile(
    planItem: PlanItem,
    fullPlan: PlanItem[],
    input: CodeGenModuleInput,
    originalContentMap: Map<string, string>,
    previouslyGenerated: GeneratedFile[],
    codeGenTools?: { tools: LLMToolDefinition[]; toolHandler: ToolHandler },
    previousFailures?: string[],
  ): Promise<{ file: GeneratedFile | null; tokensUsed: number; truncated: boolean }> {
    const llm = this.getProvider();
    const prompt = this.buildSingleFilePrompt(
      planItem, fullPlan, input, originalContentMap, previouslyGenerated, previousFailures,
    );

    let response;
    try {
      response = await llm.invoke(prompt, {
        temperature: 0.3,
        maxTokens: 65536,
        // When code gen tools are available (API provider), use them for filesystem access.
        // When they're not (CLI provider), disable CLI's built-in tools to force text-only output.
        ...(codeGenTools
          ? { tools: codeGenTools.tools, toolHandler: codeGenTools.toolHandler }
          : { disableTools: true }),
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
    let content = rawContent;
    if (this.isLargeFile(planItem, originalContentMap)) {
      const original = originalContentMap.get(planItem.filePath)!;
      const isJson = planItem.filePath.endsWith('.json');

      if (isJson) {
        if (this.looksLikePythonScript(rawContent)) {
          // Large JSON: execute Python transform script
          const cleanedScript = this.extractPythonScript(rawContent);
          const transformed = await this.executePythonTransform(cleanedScript, original, planItem.filePath);
          if (transformed !== null) {
            content = transformed;
            console.log(`[Code Gen Module]   Applied Python transform to ${planItem.filePath}`);
          } else {
            console.log(`[Code Gen Module]   Python transform failed for ${planItem.filePath}, skipping (will retry)`);
            return { file: null, tokensUsed, truncated: false };
          }
        } else {
          // JSON file but output isn't Python — unexpected, skip for retry
          console.log(`[Code Gen Module]   Expected Python script for large JSON ${planItem.filePath}, got other output — skipping`);
          return { file: null, tokensUsed, truncated: false };
        }
      } else {
        // Large non-JSON: apply search-replace blocks
        const blocks = this.parseSearchReplaceBlocks(rawContent);
        if (blocks.length > 0) {
          const applied = this.applySearchReplace(original, blocks);
          if (applied !== null) {
            content = applied;
            console.log(`[Code Gen Module]   Applied ${blocks.length} search-replace edit(s) to ${planItem.filePath}`);
          } else {
            console.log(`[Code Gen Module]   Search-replace matching failed for ${planItem.filePath}, skipping (will retry)`);
            return { file: null, tokensUsed, truncated: false };
          }
        }
        // No search-replace blocks = LLM output the full file (acceptable, passes looksLikeCodeContent above)
      }
    }

    return {
      file: { path: planItem.filePath, content, purpose: planItem.rationale },
      tokensUsed,
      truncated,
    };
  }

  /**
   * Handle truncated generation by making continuation calls.
   * Sends the last 50 lines as context and asks the LLM to continue.
   * Repeats up to 5 times until the output completes naturally.
   */
  private async continueTruncatedGeneration(
    partialContent: string,
    planItem: PlanItem,
    input: CodeGenModuleInput,
    maxContinuations: number = 5,
  ): Promise<{ continuation: string; tokensUsed: number }> {
    const llm = this.getProvider();
    let accumulated = '';
    let totalTokens = 0;

    for (let i = 0; i < maxContinuations; i++) {
      const fullSoFar = partialContent + accumulated;
      const lastLines = fullSoFar.split('\n').slice(-50).join('\n');

      const prompt = this.buildContinuationPrompt(lastLines, planItem, input);

      let response;
      try {
        response = await llm.invoke(prompt, { temperature: 0.3, maxTokens: 65536, disableTools: true });
      } catch (error) {
        console.error(`[Code Gen Module]   Continuation call ${i + 1} failed:`, error);
        break;
      }

      totalTokens += (response.usage?.inputTokens ?? 0) + (response.usage?.outputTokens ?? 0);
      const continuation = this.parseSingleFileContent(response.content);
      accumulated += '\n' + continuation;

      if (response.stopReason !== 'max_tokens') {
        console.log(`[Code Gen Module]   Continuation complete after ${i + 1} call(s)`);
        break;
      }

      console.log(`[Code Gen Module]   Continuation ${i + 1} still truncated, continuing...`);
    }

    return { continuation: accumulated, tokensUsed: totalTokens };
  }

  // ============================================================================
  // Prompt Builders
  // ============================================================================

  /** Extract validation feedback from external context files (used in both plan and file prompts) */
  private extractValidationFeedback(contextFiles: ContextFile[]): string {
    return contextFiles
      .filter(f => f.source === 'external')
      .map(f => f.content)
      .join('\n');
  }

  private buildPlanPrompt(input: CodeGenModuleInput, manifest: FileManifest): string {
    const { ticket, orchestrationPlan, researchFindings, contextFiles } = input;

    // Build existing code context — include full content for files under 300 lines,
    // first 200 lines for larger files (preserves imports, class structure, public API)
    let existingCodeContext = '';
    const feedbackContext = this.extractValidationFeedback(contextFiles);
    for (const file of contextFiles) {
      if (file.source !== 'workspace') continue;
      const lines = file.content.split('\n');
      const content = lines.length > 300
        ? lines.slice(0, 200).join('\n') + `\n... (${lines.length - 200} more lines)`
        : file.content;
      existingCodeContext += `\n--- ${file.path} ---\n${content}\n`;
    }

    const manifestSection = this.buildManifestSection(manifest);

    // Build repo map section if directory listing available
    let repoMapSection = '';
    if (input.directoryListing) {
      repoMapSection = `## Repository File Listing
These files exist in the relevant cht-core directories. Use this to identify files to MODIFY or directories for CREATE.

${input.directoryListing}
`;
    }

    return `You are a CHT (Community Health Toolkit) developer. Create an implementation plan for the feature below.

## Issue Details
Title: ${ticket.issue.title}
Type: ${ticket.issue.type}
Domain: ${ticket.issue.technical_context.domain}

Description:
${ticket.issue.description}

Requirements:
${ticket.issue.requirements.map((r, i) => `${i + 1}. ${r}`).join('\n')}

Acceptance Criteria:
${ticket.issue.acceptance_criteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}

## Orchestration Plan
Recommended Approach: ${orchestrationPlan.recommendedApproach}

Phases:
${orchestrationPlan.phases.map((p, i) => `${i + 1}. ${p.name}: ${p.description}`).join('\n')}

## Documentation References
${researchFindings.suggestedApproaches.map((a) => `- ${a}`).join('\n')}

${manifestSection}

${repoMapSection}
## Existing Code Context
${existingCodeContext || 'No existing code context available'}
${feedbackContext ? `
## Validation Feedback from Previous Iteration
The previous code generation attempt was validated and found lacking. Address ALL issues below in your revised plan:
${feedbackContext}
` : ''}
## Instructions
List every file you will modify or create as a numbered TODO list.
Use MODIFY for existing files and CREATE for new files.
You are NOT limited to the files listed above — if the feature requires changes to other files (e.g. permission configs, shared settings, app_settings), include them.
Keep the plan focused — only include source files essential for this feature. Do NOT include test files (*.spec.ts, *.spec.js, *.test.ts, *.test.js) in the plan — test generation is handled by a separate agent.
Each item MUST have a clear rationale explaining what changes are needed.

Use this EXACT format (do NOT wrap file paths in backticks):

=== PLAN ===
1. MODIFY path/to/existing/file.ts - What changes are needed and why
2. CREATE path/to/new/file.ts - What this new file does
=== END PLAN ===

Output ONLY the plan section. Do not generate any file content.`;
  }

  /**
   * Build the prompt for generating a single file.
   * Includes the full plan for context, original content for MODIFY,
   * and summaries of previously generated files for coherence.
   */
  buildSingleFilePrompt(
    planItem: PlanItem,
    fullPlan: PlanItem[],
    input: CodeGenModuleInput,
    originalContentMap: Map<string, string>,
    previouslyGenerated: GeneratedFile[],
    previousFailures?: string[],
  ): string {
    const { ticket, researchFindings } = input;

    // For large JSON files, use a minimal prompt — just the task + structure + Python instructions.
    // This avoids overloading the CLI with unnecessary context for a simple JSON modification.
    const isLargeFile = this.isLargeFile(planItem, originalContentMap);
    const isJson = planItem.filePath.endsWith('.json');
    if (isJson) {
      const hasContent = originalContentMap.has(planItem.filePath);
      const lineCount = hasContent ? originalContentMap.get(planItem.filePath)!.split('\n').length : 0;
      console.log(`[Code Gen Module]   JSON prompt check: path=${planItem.filePath} hasContent=${hasContent} lines=${lineCount} isLarge=${isLargeFile} action=${planItem.action}`);
    }
    if (isLargeFile && isJson && planItem.action === 'MODIFY') {
      return this.buildLargeJsonPrompt(planItem, originalContentMap, previousFailures);
    }

    const planSummary = fullPlan
      .map((p, i) => `${i + 1}. ${p.action} ${p.filePath} — ${p.rationale}`)
      .join('\n');

    let prompt = `You are a CHT (Community Health Toolkit) developer. Generate the complete code for ONE file.

## Implementation Plan (full context — you are generating one file from this plan)
${planSummary}

## Current Task
File: ${planItem.filePath}
Action: ${planItem.action}
Task: ${planItem.rationale}

## Issue Details
Title: ${ticket.issue.title}
Type: ${ticket.issue.type}
Domain: ${ticket.issue.technical_context.domain}

Description:
${ticket.issue.description}

Requirements:
${ticket.issue.requirements.map((r, i) => `${i + 1}. ${r}`).join('\n')}

Acceptance Criteria:
${ticket.issue.acceptance_criteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}

## Documentation References
${researchFindings.suggestedApproaches.map((a) => `- ${a}`).join('\n')}`;

    const feedback = this.extractValidationFeedback(input.contextFiles);
    if (feedback) {
      prompt += `

## Validation Feedback from Previous Iteration
The previous attempt at generating this code was validated and found lacking. Address ALL issues below:
${feedback}`;
    }

    // Include original file content for MODIFY
    if (planItem.action === 'MODIFY') {
      const original = originalContentMap.get(planItem.filePath);
      if (original) {
        if (isLargeFile) {
          // Large non-JSON: include full content so LLM can produce accurate search-replace blocks
          prompt += `

## Original File Content (${original.split('\n').length} lines — output ONLY search-replace blocks, NOT the full file)
\`\`\`
${original}
\`\`\``;
        } else {
          prompt += `

## Original File Content (you must output the COMPLETE modified version)
\`\`\`
${original}
\`\`\``;
        }
      }
    }

    // Include summaries of previously generated files for cross-file coherence
    if (previouslyGenerated.length > 0) {
      prompt += `

## Previously Generated Files (for cross-file coherence)`;
      for (const prev of previouslyGenerated) {
        const lines = prev.content.split('\n');
        const preview = lines.slice(0, 10).join('\n');
        prompt += `
### ${prev.path}${prev.purpose ? ` — ${prev.purpose}` : ''}
\`\`\`
${preview}
${lines.length > 10 ? `... (${lines.length} total lines)` : ''}
\`\`\``;
      }
    }

    // Failure feedback for retries
    if (previousFailures && previousFailures.length > 0) {
      prompt += `

## PREVIOUS ATTEMPT FAILED
Your previous output for this file failed these checks:
${previousFailures.map(f => `- ${f}`).join('\n')}
Fix these specific issues. Do not repeat the same mistakes.`;
    }

    if (isLargeFile) {
      prompt += `

## Instructions
This file is too large to output in full. Output ONLY the surgical edits using this EXACT format:

<<<<<<< SEARCH
exact lines from the original file to locate the edit point
(include enough surrounding context for unique matching)
=======
the replacement lines (what should replace the SEARCH block)
>>>>>>> REPLACE

Rules:
- Each SEARCH block must match EXACTLY in the original file (whitespace-sensitive).
- Include 2-3 unchanged context lines before/after the actual change for unique matching.
- You may output multiple SEARCH/REPLACE blocks for multiple changes.
- For insertions, the SEARCH block is the context lines where the new content goes; the REPLACE block includes those same lines PLUS the new content.
- Do NOT output the full file. Do NOT wrap in markdown code fences.
- Do NOT include any explanations, commentary, or thinking outside of the SEARCH/REPLACE blocks.
- NEVER say "I'm unable to", "Could you provide", or ask questions. You have the full file above — use it.
- Start your output DIRECTLY with <<<<<<< SEARCH — nothing before it.`;
    } else {
      prompt += `

## Instructions
Generate the COMPLETE content for ${planItem.filePath}.
${planItem.action === 'MODIFY' ? 'Output the COMPLETE modified file (not just the diff). Include ALL original code with your modifications applied.' : 'Output the full new file content.'}
Output ONLY the raw file content. Do NOT wrap in markdown code fences.
Do NOT include any explanations, comments outside the file, file path headers, or delimiters.
NEVER say "I'm unable to", "Could you provide", or ask questions. Just output the code.`;
    }

    return prompt;
  }

  /**
   * Build a minimal prompt for large JSON file modifications.
   * Only includes the task, JSON structure, and Python instructions.
   * Avoids bloating the CLI context with plan details, issue descriptions, etc.
   */
  private buildLargeJsonPrompt(
    planItem: PlanItem,
    originalContentMap: Map<string, string>,
    previousFailures?: string[],
  ): string {
    const original = originalContentMap.get(planItem.filePath)!;
    const structureSummary = this.buildJsonStructureSummary(original);

    let prompt = `Write a Python script to modify the JSON file: ${planItem.filePath}

## Task
${planItem.rationale}

## JSON Structure (${original.split('\n').length} lines)
${structureSummary}`;

    if (previousFailures && previousFailures.length > 0) {
      prompt += `

## PREVIOUS ATTEMPT FAILED
${previousFailures.map(f => `- ${f}`).join('\n')}
Fix these issues.`;
    }

    prompt += `

## Instructions
Write a Python script. It will be called as: python3 script.py <path-to-json-file>

The script must:
1. Read the JSON file from sys.argv[1]
2. Parse with json.load()
3. Make the modifications described above
4. Write back with json.dump(data, f, indent=2, ensure_ascii=False)
5. Use only standard library (json, sys)

Output ONLY valid Python. No markdown, no explanations. Start with import statements.`;

    return prompt;
  }

  /**
   * Build a structural summary of a JSON file for the LLM.
   * Shows top-level keys, their types, and nested key names — enough to
   * understand where to insert/modify without dumping the entire file.
   */
  buildJsonStructureSummary(content: string): string {
    try {
      const data = JSON.parse(content);
      const lines: string[] = ['```', 'JSON structure (top-level keys):'];

      const summarizeValue = (val: any, depth: number = 0): string => {
        const indent = '  '.repeat(depth);
        if (val === null) return 'null';
        if (typeof val !== 'object') return `${typeof val}: ${JSON.stringify(val).substring(0, 60)}`;
        if (Array.isArray(val)) {
          if (val.length === 0) return '[]';
          const first = typeof val[0] === 'object' ? '{...}' : JSON.stringify(val[0]).substring(0, 40);
          return `[ ${val.length} items, first: ${first} ]`;
        }
        const keys = Object.keys(val);
        if (keys.length === 0) return '{}';
        if (depth >= 2) return `{ ${keys.length} keys: ${keys.slice(0, 5).join(', ')}${keys.length > 5 ? ', ...' : ''} }`;
        const entries = keys.slice(0, 15).map(k => {
          return `${indent}  "${k}": ${summarizeValue(val[k], depth + 1)}`;
        });
        const more = keys.length > 15 ? `\n${indent}  ... (${keys.length - 15} more keys)` : '';
        return `{\n${entries.join('\n')}${more}\n${indent}}`;
      };

      lines.push(summarizeValue(data, 0));
      lines.push('```');
      return lines.join('\n');
    } catch {
      // Fallback: show first 100 lines if JSON parsing fails
      const fileLines = content.split('\n');
      return `\`\`\`\n${fileLines.slice(0, 100).join('\n')}\n... (${fileLines.length - 100} more lines)\n\`\`\``;
    }
  }

  /**
   * Check if LLM output looks like a Python script.
   */
  looksLikePythonScript(content: string): boolean {
    const trimmed = content.trim();
    return (
      trimmed.includes('import json') ||
      trimmed.includes('import sys') ||
      ((trimmed.startsWith('import ') || trimmed.startsWith('#!/')) && trimmed.includes('json.'))
    );
  }

  /**
   * Extract Python script from LLM output that may contain preamble text or markdown fences.
   * The LLM often prefixes the script with "Based on..." or "Here's the script:" etc.
   * This strips everything before the first import/shebang line and removes markdown fences.
   */
  extractPythonScript(content: string): string {
    let cleaned = content.trim();

    // Strip markdown code fences if present (```python ... ``` or ``` ... ```)
    const fenceMatch = cleaned.match(/```(?:python)?\s*\n([\s\S]*?)```/);
    if (fenceMatch) {
      cleaned = fenceMatch[1].trim();
    }

    // Find the first line that starts with import/from/#!/ and strip everything before it
    const lines = cleaned.split('\n');
    const startIdx = lines.findIndex(line => {
      const trimmedLine = line.trimStart();
      return (
        trimmedLine.startsWith('import ') ||
        trimmedLine.startsWith('from ') ||
        trimmedLine.startsWith('#!/')
      );
    });

    if (startIdx > 0) {
      console.log(`[Code Gen Module]   Stripped ${startIdx} preamble line(s) from Python script`);
      cleaned = lines.slice(startIdx).join('\n');
    }

    return cleaned;
  }

  /**
   * Check if content appears to be actual code rather than LLM reasoning/thinking.
   * Returns true if the content looks like code, false if it looks like conversation.
   */
  looksLikeCodeContent(content: string, filePath: string): boolean {
    const trimmed = content.trim();

    // LLM reasoning patterns — strong indicators of non-code output
    const reasoningPatterns = [
      /^I'm (unable|not able|sorry|afraid)/i,
      /^I (cannot|can't|don't have|would need|need to)/i,
      /^(Unfortunately|Could you|Please provide|Let me explain)/i,
      /^(Based on|Looking at|From the|Without being able)/i,
      /I'm unable to/i,
      /I cannot (read|access|view|see|generate)/i,
      /Could you (please )?provide/i,
      /I don't have (access|the ability|file reading)/i,
      /I (only )?have (documentation search|the first \d+ lines)/i,
    ];

    for (const pattern of reasoningPatterns) {
      if (pattern.test(trimmed)) return false;
    }

    // For search-replace output: the blocks themselves are valid
    if (/<<<<<<< SEARCH/.test(trimmed) && />>>>>>> REPLACE/.test(trimmed)) {
      return true;
    }

    // For Python scripts destined for JSON transform
    if (this.looksLikePythonScript(trimmed)) {
      return true;
    }

    // File-type-specific code indicators
    const ext = path.extname(filePath).toLowerCase();

    if (ext === '.json') {
      return trimmed.startsWith('{') || trimmed.startsWith('[');
    }

    if (['.ts', '.js', '.tsx', '.jsx'].includes(ext)) {
      const codeMarkers = ['import ', 'export ', 'function ', 'class ', 'const ', 'let ', 'var ', 'interface ', 'type ', 'async ', 'return ', 'module.exports', 'require('];
      return codeMarkers.some(marker => trimmed.includes(marker));
    }

    if (ext === '.py') {
      const codeMarkers = ['import ', 'def ', 'class ', 'from ', 'if ', 'for ', 'while '];
      return codeMarkers.some(marker => trimmed.includes(marker));
    }

    // Generic: has at least some code-like syntax
    return /[{}\[\]();=]/.test(trimmed) || /^(import|export|function|class|def |const |let |var |#include)\b/m.test(trimmed);
  }

  /**
   * Execute a Python script to transform a JSON file.
   * Writes the original content to a temp file, runs the script, reads the result.
   */
  async executePythonTransform(
    script: string,
    originalContent: string,
    filePath: string
  ): Promise<string | null> {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cht-json-transform-'));
    const tmpJsonPath = path.join(tmpDir, path.basename(filePath));
    const tmpScriptPath = path.join(tmpDir, 'transform.py');

    try {
      // Write original content and script to temp files
      fs.writeFileSync(tmpJsonPath, originalContent, 'utf-8');
      fs.writeFileSync(tmpScriptPath, script, 'utf-8');

      // Execute the Python script
      const result = await new Promise<string | null>((resolve) => {
        execFile('python3', [tmpScriptPath, tmpJsonPath], { timeout: 30000 }, (error, _stdout, stderr) => {
          if (error) {
            console.error(`[Code Gen Module]   Python script error: ${error.message}`);
            if (stderr) console.error(`[Code Gen Module]   stderr: ${stderr}`);
            resolve(null);
            return;
          }
          // Read the modified file
          try {
            const modified = fs.readFileSync(tmpJsonPath, 'utf-8');
            // Validate it's still valid JSON
            JSON.parse(modified);
            resolve(modified);
          } catch (readErr) {
            console.error(`[Code Gen Module]   Failed to read/validate modified JSON: ${readErr}`);
            resolve(null);
          }
        });
      });

      return result;
    } catch (error) {
      console.error(`[Code Gen Module]   Python transform setup failed: ${error}`);
      return null;
    } finally {
      // Cleanup temp files
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // Best effort cleanup
      }
    }
  }

  /**
   * Check if a MODIFY file is large enough to warrant search-replace mode.
   */
  isLargeFile(planItem: PlanItem, originalContentMap: Map<string, string>): boolean {
    if (planItem.action !== 'MODIFY') return false;
    const original = originalContentMap.get(planItem.filePath);
    if (!original) return false;
    const lineCount = original.split('\n').length;
    const charCount = original.length;
    const isJson = planItem.filePath.endsWith('.json');
    const lineThreshold = isJson ? LARGE_JSON_LINE_THRESHOLD : LARGE_FILE_LINE_THRESHOLD;
    // JSON files can have very long lines (compact/minified) — also check char count.
    // 50K chars is roughly equivalent to a 2000-line JSON with indent=2.
    const charThreshold = isJson ? 50000 : Infinity;
    return lineCount > lineThreshold || charCount > charThreshold;
  }

  /**
   * Build a continuation prompt for when a file's generation was truncated.
   */
  private buildContinuationPrompt(
    lastLines: string,
    planItem: PlanItem,
    input: CodeGenModuleInput,
  ): string {
    return `You were generating the file ${planItem.filePath} for the CHT project but your output was truncated.

Issue: ${input.ticket.issue.title}

Here are the last 50 lines of what you generated so far:
\`\`\`
${lastLines}
\`\`\`

Continue generating from EXACTLY where you left off.
Do NOT repeat any of the lines shown above.
Output ONLY the remaining file content — no markdown fences, no delimiters, no explanations.`;
  }

  /**
   * Parse search-replace blocks from LLM output.
   * Format: <<<<<<< SEARCH\n...\n=======\n...\n>>>>>>> REPLACE
   */
  parseSearchReplaceBlocks(output: string): Array<{ search: string; replace: string }> {
    const blocks: Array<{ search: string; replace: string }> = [];
    const regex = /<<<<<<< SEARCH\n([\s\S]*?)\n=======\n([\s\S]*?)\n>>>>>>> REPLACE/g;

    let match;
    while ((match = regex.exec(output)) !== null) {
      blocks.push({
        search: match[1],
        replace: match[2],
      });
    }

    return blocks;
  }

  /**
   * Apply search-replace blocks to the original file content.
   * Returns the modified content, or null if any search block failed to match.
   */
  applySearchReplace(
    original: string,
    blocks: Array<{ search: string; replace: string }>
  ): string | null {
    let result = original;

    for (const block of blocks) {
      const idx = result.indexOf(block.search);
      if (idx === -1) {
        // Try with normalized whitespace (trim trailing spaces per line)
        const normalizedResult = result.split('\n').map(l => l.trimEnd()).join('\n');
        const normalizedSearch = block.search.split('\n').map(l => l.trimEnd()).join('\n');
        const normalizedIdx = normalizedResult.indexOf(normalizedSearch);

        if (normalizedIdx === -1) {
          console.log(`[Code Gen Module]   Search block not found (${block.search.substring(0, 80).replace(/\n/g, '\\n')}...)`);
          return null;
        }

        // Find the corresponding position in the original (non-normalized) string
        // Count the line where the match starts in normalized
        const linesBeforeMatch = normalizedResult.substring(0, normalizedIdx).split('\n').length - 1;
        const searchLineCount = block.search.split('\n').length;
        const originalLines = result.split('\n');
        const before = originalLines.slice(0, linesBeforeMatch).join('\n');
        const after = originalLines.slice(linesBeforeMatch + searchLineCount).join('\n');
        result = before + (before ? '\n' : '') + block.replace + (after ? '\n' : '') + after;
      } else {
        result = result.substring(0, idx) + block.replace + result.substring(idx + block.search.length);
      }
    }

    return result;
  }

  /**
   * Parse raw LLM output for a single file.
   * Strips markdown code fences and delimiter format if the LLM added them.
   */
  parseSingleFileContent(rawOutput: string): string {
    let content = rawOutput.trim();

    // Strip markdown code fences if the entire output is wrapped
    const codeBlockMatch = content.match(/^```(?:\w+)?\n([\s\S]*?)\n```$/);
    if (codeBlockMatch) {
      content = codeBlockMatch[1];
    }

    // Strip delimiter format if the LLM used it anyway
    const fileMatch = content.match(
      /^=== FILE:.*===\n(?:PURPOSE:.*\n)?--- CONTENT START ---\n([\s\S]*?)\n--- CONTENT END ---/
    );
    if (fileMatch) {
      content = fileMatch[1];
    }

    // Strip LLM reasoning preamble that precedes actual code.
    // The LLM sometimes outputs "I have enough context...\nHere is the file:\n" before
    // the actual code. Find the first line that looks like code and strip everything before it.
    content = this.stripReasoningPreamble(content);

    return content.trim();
  }

  /**
   * Strip LLM reasoning/thinking text that appears before actual code.
   * Only activates when the first non-empty line looks like natural language prose,
   * then finds the first code-like line and drops everything before it.
   */
  private stripReasoningPreamble(content: string): string {
    const lines = content.split('\n');

    // Find first non-empty line
    const firstNonEmpty = lines.findIndex(l => l.trim().length > 0);
    if (firstNonEmpty < 0) return content;

    const firstLine = lines[firstNonEmpty].trimStart();

    const looksLikeProse = PROSE_PATTERN.test(firstLine) && !CODE_KEYWORD_PATTERN.test(firstLine);
    if (!looksLikeProse) return content;

    const codeStartIdx = lines.findIndex((line, idx) => {
      if (idx <= firstNonEmpty) return false;
      const trimmedLine = line.trimStart();
      if (trimmedLine.length === 0) return false;
      return CODE_START_PATTERNS.some(p => p.test(trimmedLine));
    });

    if (codeStartIdx > 0) {
      const stripped = lines.slice(codeStartIdx).join('\n');
      console.log(`[Code Gen Module]   Stripped ${codeStartIdx} line(s) of LLM reasoning preamble`);
      return stripped;
    }

    return content;
  }

  private buildManifestSection(manifest: FileManifest): string {
    if (manifest.existingFiles.length === 0 && manifest.allowedDirectories.length === 0) {
      return `## File Manifest (your working scope)
No existing files or directories identified. You may create files in appropriate CHT project directories.`;
    }

    let section = '## File Manifest (known files and directories)\nThese are the files and directories already identified as relevant. You may reference files outside this list if the feature requires it.\n';

    if (manifest.existingFiles.length > 0) {
      section += '\nKnown existing files:\n';
      for (const file of manifest.existingFiles) {
        section += `- ${file}\n`;
      }
    }

    if (manifest.allowedDirectories.length > 0) {
      section += '\nKnown directories:\n';
      for (const dir of manifest.allowedDirectories) {
        section += `- ${dir}\n`;
      }
    }

    return section;
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
    failures.push(...FileContentAssertions.isNotPlaintext(file.content, file.path));
    failures.push(...FileContentAssertions.hasSyntaxMarkers(file.content, file.path));

    const planItem = plan.find(p => p.filePath === file.path);
    if (planItem?.action === 'MODIFY') {
      const original = originalContentMap.get(file.path);
      if (original) {
        failures.push(...FileContentAssertions.hasStructuralChanges(file.content, original));
      }
    }

    return failures;
  }

  /**
   * Fetch MODIFY files that the plan references but weren't in the agent's
   * pre-gathered context.  Mutates input.contextFiles, originalContentMap,
   * and manifest.existingFiles in place.
   */
  private async fetchMissingModifyFiles(
    plan: PlanItem[],
    input: CodeGenModuleInput,
    originalContentMap: Map<string, string>,
    manifest: FileManifest
  ): Promise<void> {
    if (!input.readFile) return;

    const missingModifyItems = plan.filter(
      item => item.action === 'MODIFY' && !originalContentMap.has(item.filePath)
    );

    for (const item of missingModifyItems) {
      console.log(`[Code Gen Module] Fetching missing MODIFY file: ${item.filePath}`);
      const content = await input.readFile(item.filePath);
      if (content != null) {
        input.contextFiles.push({ path: item.filePath, content, source: 'workspace' });
        originalContentMap.set(item.filePath, content);
        manifest.existingFiles.push(item.filePath);
        console.log(`[Code Gen Module]   Fetched ${item.filePath} (${content.length} chars)`);
      } else {
        console.log(`[Code Gen Module]   Could not read ${item.filePath} (null)`);
      }
    }

    // Expand allowed directories for CREATE items outside current scope
    const dirSet = new Set(manifest.allowedDirectories);
    for (const item of plan) {
      if (item.action === 'CREATE') {
        const lastSlash = item.filePath.lastIndexOf('/');
        if (lastSlash > 0) {
          const dir = item.filePath.substring(0, lastSlash + 1);
          if (!dirSet.has(dir)) {
            dirSet.add(dir);
            manifest.allowedDirectories.push(dir);
            console.log(`[Code Gen Module]   Expanded scope: ${dir}`);
          }
        }
      }
    }
  }

  private buildOriginalContentMap(contextFiles: ContextFile[]): Map<string, string> {
    const map = new Map<string, string>();
    for (const file of contextFiles) {
      if (file.source === 'workspace') {
        map.set(file.path, file.content);
      }
    }
    return map;
  }

  // ============================================================================
  // Parsers
  // ============================================================================

  /**
   * Parse the PLAN section from LLM output.
   */
  parsePlan(output: string): PlanItem[] {
    const items: PlanItem[] = [];
    const lines = output.split('\n');

    let inPlan = false;

    for (const line of lines) {
      const trimmed = line.trim();

      if (trimmed === PLAN_START) {
        inPlan = true;
        continue;
      }
      if (trimmed === PLAN_END) {
        break;
      }

      if (inPlan) {
        const match = trimmed.match(PLAN_ITEM_RE);
        if (match) {
          items.push({
            action: match[1] as 'MODIFY' | 'CREATE',
            filePath: sanitizePath(match[2]),
            rationale: match[3].trim(),
          });
        }
      }
    }

    return items;
  }

  parseGeneratedFiles(output: string): GeneratedFile[] {
    const files: GeneratedFile[] = [];
    const lines = output.split('\n');

    let currentPath: string | null = null;
    let currentPurpose: string | null = null;
    let contentLines: string[] = [];
    let inContent = false;

    for (const line of lines) {
      if (inContent) {
        if (line.trim() === CONTENT_END) {
          // End of file content
          inContent = false;
          const content = contentLines.join('\n').trim();
          const cleaned = this.stripCodeBlock(content);

          if (currentPath && cleaned.length >= 10) {
            files.push({
              path: currentPath,
              content: cleaned,
              purpose: currentPurpose || undefined,
            });
          }

          currentPath = null;
          currentPurpose = null;
          contentLines = [];
        } else {
          contentLines.push(line);
        }
        continue;
      }

      const fileMatch = line.match(FILE_DELIMITER_START);
      if (fileMatch) {
        currentPath = sanitizePath(fileMatch[1]);
        continue;
      }

      const purposeMatch = line.match(PURPOSE_PREFIX);
      if (purposeMatch && currentPath) {
        currentPurpose = purposeMatch[1].trim();
        continue;
      }

      if (line.trim() === CONTENT_START && currentPath) {
        inContent = true;
        contentLines = [];
      }
    }

    return files;
  }

  /**
   * Post-call validation: check files against manifest and plan.
   * Returns a list of warning strings (empty = all good).
   */
  validateAgainstManifest(
    files: GeneratedFile[],
    plan: PlanItem[],
    manifest: FileManifest
  ): string[] {
    const warnings: string[] = [];

    const existingSet = new Set(manifest.existingFiles);
    const allowedDirs = manifest.allowedDirectories;

    // Check each generated file's path is within scope
    if (allowedDirs.length > 0) {
      for (const file of files) {
        const inExisting = existingSet.has(file.path);
        const inAllowedDir = allowedDirs.some(dir => file.path.startsWith(dir));
        if (!inExisting && !inAllowedDir) {
          warnings.push(`Out-of-scope file: ${file.path} (not in manifest)`);
        }
      }
    }

    // Cross-check plan vs generated files
    if (plan.length > 0) {
      const generatedPaths = new Set(files.map(f => f.path));
      const plannedPaths = new Set(plan.map(p => p.filePath));

      // Planned but not generated
      for (const item of plan) {
        if (!generatedPaths.has(item.filePath)) {
          warnings.push(`Planned but not generated: ${item.filePath}`);
        }
      }

      // Generated but not planned
      for (const file of files) {
        if (!plannedPaths.has(file.path)) {
          warnings.push(`Generated but not planned: ${file.path}`);
        }
      }
    }

    return warnings;
  }

  private stripCodeBlock(content: string): string {
    const match = content.match(/^```(?:\w+)?\n([\s\S]*?)\n```$/);
    return match ? match[1] : content;
  }
}

export function createClaudeApiCodeGenModule(provider?: LLMProvider): ClaudeApiCodeGenModule {
  return new ClaudeApiCodeGenModule(provider);
}

export const claudeApiCodeGenModule = new ClaudeApiCodeGenModule();
