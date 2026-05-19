/**
 * Code Generation Agent
 *
 * Generates implementation code following CHT patterns based on:
 * - Orchestration plan from research phase
 * - Research findings and documentation references
 * - Context analysis and reusable patterns
 * - Existing code in cht-core codebase
 *
 * Delegates LLM-powered code generation to a CodeGenModule via the registry.
 * The agent handles orchestration: context gathering, validation, requirements analysis.
 */

import {
  CodeGenerationInput,
  CodeGenerationResult,
  GeneratedFile,
  FileLanguage,
  FileType,
} from '../types';
import { LLMProvider, createLLMProviderFromEnv } from '../llm';
import { readFromChtCore, listChtCoreDirectory } from '../utils/staging';
import { loadIndex } from '../utils/context-loader';
import { TodoTracker, createAgentTodoTracker } from '../utils/todo-tracker';
import { BeadsCodeGenSession } from '../utils/beads-client';
import { readEnv } from '../utils/env';
import { installShutdownHandlers } from '../utils/shutdown';
import { crossFileValidate } from './cross-file-validator';
import { astValidate } from './ast-validator';
import { propagateNewLocaleKeys } from './locale-propagator';
import * as fs from 'fs';
import * as path from 'path';
import {
  ContextFile,
  CodeGenModuleInput,
  GeneratedFile as LayerGeneratedFile,
} from '../layers/code-gen/interface';
import { CodeGenModuleRegistry, createDefaultCodeGenRegistry } from '../layers/code-gen/registry';

/** Shape of the loaded `agent-memory/indices/domain-to-components.json`. */
type DomainIndex = { domains?: Record<string, Record<string, unknown>> };

interface CodeGenerationAgentOptions {
  llmProvider?: LLMProvider;
  codeGenRegistry?: CodeGenModuleRegistry;
}

export class CodeGenerationAgent {
  private llm: LLMProvider;
  private todos: TodoTracker;
  private registry: CodeGenModuleRegistry;

  constructor(options: CodeGenerationAgentOptions = {}) {
    this.llm = options.llmProvider || createLLMProviderFromEnv();
    this.todos = createAgentTodoTracker('Code Gen');
    this.registry = options.codeGenRegistry || createDefaultCodeGenRegistry();
    installShutdownHandlers();
  }

  /** Read-only accessor for the active LLM provider. Primarily for tests. */
  getLLMProvider(): LLMProvider {
    return this.llm;
  }

  /**
   * Main entry point for code generation
   */
  async generate(input: CodeGenerationInput): Promise<CodeGenerationResult> {
    console.log('\n[Code Generation Agent] Starting code generation...');
    console.log(`[Code Generation Agent] Issue: ${input.issue.issue.title}`);
    console.log(`[Code Generation Agent] CHT Core Path: ${input.chtCorePath}`);
    console.log(`[Code Generation Agent] Using LLM: ${this.llm.modelName}`);

    // Clear any previous todos
    this.todos.clear();

    if (input.additionalContext) {
      console.log(`[Code Generation Agent] Additional context from feedback provided`);
    }

    // Selective regeneration: if passing files provided, carry them forward
    const hasSelectiveRegen = input.passingFiles && input.passingFiles.length > 0;
    if (hasSelectiveRegen) {
      console.log(`[Code Generation Agent] Selective regeneration: carrying forward ${input.passingFiles!.length} passing file(s)`);
      if (input.failingFiles) {
        console.log(`[Code Generation Agent] Files to regenerate: ${input.failingFiles.map(f => f.path).join(', ')}`);
      }
    }

    // Gather context from cht-core
    const codeContext = await this.todos.run(
      'Gather code context from cht-core',
      'Gathering code context from cht-core',
      async () => this.gatherCodeContext(input)
    );

    // Generate code via module
    const llmResult = await this.todos.run(
      'Generate code with LLM',
      'Generating code with LLM',
      async () => this.generateWithLLM(input, codeContext)
    );

    // Validate generated files
    const validatedFiles = await this.todos.run(
      'Validate generated files',
      'Validating generated files',
      async () => this.validateGeneratedFiles(llmResult.files)
    );

    // Merge: carry forward passing files + newly regenerated files
    let allFiles = validatedFiles;
    if (hasSelectiveRegen) {
      const newlyGeneratedPaths = new Set(validatedFiles.map(f => f.relativePath));
      const keptFiles = input.passingFiles!.filter(f => !newlyGeneratedPaths.has(f.relativePath));
      allFiles = [...keptFiles, ...validatedFiles];
      console.log(`[Code Generation Agent] Merged: ${keptFiles.length} kept + ${validatedFiles.length} regenerated = ${allFiles.length} total`);
    }

    // Cross-file validation: identifier consistency across the MERGED batch.
    // Per D1: must run on `allFiles` (not `validatedFiles`) so iteration 2+ of
    // selective regen sees both the kept and regenerated files together.
    const regexIssues = crossFileValidate(allFiles);
    // AST-driven semantic checks (signature drift, permission literals). v5 Batch C.
    const astIssues = astValidate(allFiles);
    // Module-level signals (plan adherence, etc.) come up alongside the static
    // checks. Order is purely cosmetic; the supervisor treats them uniformly.
    const moduleIssues = llmResult.moduleCrossFileIssues ?? [];
    const crossFileIssues = [...regexIssues, ...astIssues, ...moduleIssues];

    // v6 A.9: surface module-level partial-completion as a cross-file issue so
    // the supervisor's refinement loop triggers consistently with static checks.
    if (llmResult.partialGeneration) {
      const reason = llmResult.partialGenerationReason ?? 'execute phase did not complete cleanly';
      crossFileIssues.push({
        filePath: '(generation)',
        issueType: 'partial-completion',
        description: reason,
        reason,
      });
    }

    if (crossFileIssues.length > 0) {
      console.warn(
        `[Code Generation Agent] Found ${crossFileIssues.length} cross-file issue(s) ` +
        `(${regexIssues.length} regex + ${astIssues.length} AST + ${moduleIssues.length} module):`
      );
      for (const issue of crossFileIssues) {
        const detail = issue.reason ?? issue.description ?? '(no detail)';
        console.warn(`[Code Generation Agent]   ${issue.filePath}: ${detail}`);
      }
    }

    // Locale auto-propagation: when messages-en.properties has new keys, append
    // English-value placeholders to the 9 other locale files. Deterministic, no LLM.
    allFiles = await propagateNewLocaleKeys(allFiles, input.chtCorePath);

    // Determine which requirements were implemented
    const { implemented, pending } = this.analyzeRequirements(
      input.issue.issue.requirements,
      allFiles
    );

    const result: CodeGenerationResult = {
      files: allFiles,
      summary: this.generateSummary(validatedFiles, input),
      implementedRequirements: implemented,
      pendingRequirements: pending,
      notes: this.generateNotes(validatedFiles, input),
      confidence: this.calculateConfidence(validatedFiles, input, implemented, pending),
      beadsSessionId: llmResult.beadsSessionId,
      crossFileIssues: crossFileIssues.length > 0 ? crossFileIssues : undefined,
      compileGateSkipped: llmResult.compileGateSkipped,
      compileGateSkipReason: llmResult.compileGateSkipReason,
    };

    console.log(`[Code Generation Agent] Generated ${result.files.length} files`);
    console.log(`[Code Generation Agent] Confidence: ${(result.confidence * 100).toFixed(0)}%`);

    this.todos.printSummary();

    return result;
  }

  /**
   * Gather relevant code context from cht-core using indices
   */
  private async gatherCodeContext(
    input: CodeGenerationInput
  ): Promise<{ existingFiles: Map<string, string>; relatedPatterns: string[]; directoryListing: string }> {
    const existingFiles = new Map<string, string>();
    const relatedPatterns: string[] = [];

    const { orchestrationPlan, contextAnalysis, chtCorePath, issue } = input;
    const domain = issue.issue.technical_context.domain;

    // Load domain-to-components index for relevant directories
    const domainToComponents = loadIndex('domain-to-components') as DomainIndex | null;
    const relevantFiles: string[] = [];

    if (domainToComponents?.domains?.[domain]) {
      const domainData = domainToComponents.domains[domain];
      // Flatten nested structure (api.controllers, webapp.modules, etc.) into file paths
      for (const section of ['api', 'webapp', 'sentinel']) {
        const sectionData = domainData[section];
        if (sectionData && typeof sectionData === 'object') {
          for (const [, entries] of Object.entries(sectionData)) {
            if (Array.isArray(entries)) {
              for (const entry of entries) {
                if (typeof entry === 'string') {
                  relevantFiles.push(entry);
                }
              }
            }
          }
        }
      }
      // Also extract shared_libs paths
      if (Array.isArray(domainData.shared_libs)) {
        for (const lib of domainData.shared_libs) {
          if (lib?.path) {
            relevantFiles.push(lib.path);
          }
        }
      }
      // NgRx infrastructure (actions, reducers, effects, selectors) for the domain.
      // Pulling these surfaces the full NgRx flow to the LLM during planning so it
      // emits coherent state-management changes (action + reducer + selector + effect).
      const ngrxData = domainData.ngrx as Record<string, unknown> | undefined;
      if (ngrxData && typeof ngrxData === 'object') {
        for (const section of ['actions', 'reducers', 'effects', 'selectors']) {
          const ngrxSection = ngrxData[section];
          if (Array.isArray(ngrxSection)) {
            for (const entry of ngrxSection) {
              if (typeof entry === 'string') {
                relevantFiles.push(entry);
              }
            }
          }
        }
      }
      console.log(`[Code Generation Agent] Found ${relevantFiles.length} relevant files from index`);
    }

    // Resolve directory-style components from orchestration plan to actual files
    for (const phase of orchestrationPlan.phases) {
      for (const component of phase.suggestedComponents) {
        const resolvedPaths = this.resolveComponentToFiles(component, domainToComponents);
        if (resolvedPaths.length > 0) {
          for (const filePath of resolvedPaths) {
            if (!existingFiles.has(filePath)) {
              const content = await readFromChtCore(filePath, chtCorePath);
              if (content) existingFiles.set(filePath, content);
            }
          }
        } else if (this.looksLikeFilePath(component)) {
          const content = await readFromChtCore(component, chtCorePath);
          if (content) existingFiles.set(component, content);
        }
      }
    }

    // Gather cross-domain files (e.g., auth/permission files for contacts ticket)
    const crossDomainFiles = this.getCrossDomainFiles(issue, domainToComponents);
    if (crossDomainFiles.length > 0) {
      console.log(`[Code Generation Agent] Found ${crossDomainFiles.length} cross-domain files`);
      relevantFiles.push(...crossDomainFiles);
    }

    // Read ALL relevant files from the index (no artificial limit)
    for (const filePath of relevantFiles) {
      if (existingFiles.has(filePath)) continue;
      if (filePath.endsWith('/')) {
        try {
          const files = await listChtCoreDirectory(filePath, chtCorePath);
          for (const file of files) {
            if (!file.endsWith('/') && !existingFiles.has(file)) {
              const content = await readFromChtCore(file, chtCorePath);
              if (content) existingFiles.set(file, content);
            }
          }
        } catch {
          // Directory might not exist
        }
      } else {
        const content = await readFromChtCore(filePath, chtCorePath);
        if (content) existingFiles.set(filePath, content);
      }
    }

    // Get patterns from context analysis
    if (contextAnalysis.reusablePatterns) {
      for (const pattern of contextAnalysis.reusablePatterns) {
        relatedPatterns.push(`${pattern.pattern}: ${pattern.description}`);
      }
    }

    // Build directory listing (repo map) for LLM awareness
    const directoryListing = await this.buildDirectoryListing(relevantFiles, chtCorePath);

    return { existingFiles, relatedPatterns, directoryListing };
  }

  /**
   * Resolve a component string (which may be a directory path like "webapp/modules/contacts")
   * to actual file paths from the domain index.
   */
  private resolveComponentToFiles(
    component: string,
    domainIndex: DomainIndex | null,
  ): string[] {
    if (!domainIndex?.domains) return [];

    // Normalize: strip leading/trailing slashes, normalize webapp/ -> webapp/src/ts/
    const normalized = component.replace(/^\/|\/$/g, '');
    const variants = [
      normalized,
      normalized.replace(/^webapp\/(?!src\/)/, 'webapp/src/ts/'),
      normalized.replace(/^webapp\/modules\//, 'webapp/src/ts/modules/'),
      normalized.replace(/^webapp\/services\//, 'webapp/src/ts/services/'),
    ];

    const matches: string[] = [];

    // Search across all domains (primarily the current domain, but check all)
    for (const [, domainData] of Object.entries(domainIndex.domains) as [string, Record<string, unknown>][]) {
      for (const section of ['api', 'webapp', 'sentinel']) {
        const sectionData = domainData[section];
        if (!sectionData || typeof sectionData !== 'object') continue;
        for (const [, entries] of Object.entries(sectionData)) {
          if (!Array.isArray(entries)) continue;
          for (const entry of entries) {
            if (typeof entry !== 'string') continue;
            for (const variant of variants) {
              if (entry.startsWith(variant) || entry.includes(variant)) {
                matches.push(entry);
              }
            }
          }
        }
      }
    }

    return [...new Set(matches)];
  }

  /**
   * Gather files from related domains based on ticket keywords.
   * E.g., a contacts ticket mentioning "permission" should pull auth domain files.
   */
  private getCrossDomainFiles(issue: CodeGenerationInput['issue'], domainIndex: DomainIndex | null): string[] {
    if (!domainIndex?.domains) return [];

    const crossDomainKeywords: Record<string, string[]> = {
      authentication: ['permission', 'auth', 'role', 'login', 'session', 'credential'],
      configuration: ['app_settings', 'settings', 'config', 'branding'],
      'data-sync': ['replication', 'sync', 'purge', 'offline'],
      'forms-and-reports': ['form', 'xform', 'xml-form', 'report', 'xform_id', 'form_id'],
    };

    const ticketText = [
      issue.issue.title,
      issue.issue.description,
      ...issue.issue.requirements,
      ...issue.issue.technical_context.components,
    ].join(' ').toLowerCase();

    const files: string[] = [];
    const currentDomain = issue.issue.technical_context.domain;

    for (const [domain, keywords] of Object.entries(crossDomainKeywords)) {
      if (domain === currentDomain) continue;
      const hasMatch = keywords.some(kw => ticketText.includes(kw));
      if (!hasMatch) continue;

      const domainData = domainIndex.domains[domain];
      if (!domainData) continue;

      // Pull service files from cross-domain (most likely to be needed)
      for (const section of ['api', 'webapp']) {
        const sectionData = domainData[section] as Record<string, unknown> | undefined;
        if (!sectionData || typeof sectionData !== 'object') continue;
        const services = sectionData.services;
        if (Array.isArray(services)) {
          for (const entry of services) {
            if (typeof entry === 'string') files.push(entry);
          }
        }
      }
    }

    return files;
  }

  /**
   * Build a directory listing (repo map) from relevant file paths.
   * Gives the LLM awareness of what files exist in relevant cht-core directories.
   */
  private async buildDirectoryListing(relevantFiles: string[], chtCorePath: string): Promise<string> {
    // Extract unique parent directories from relevant files
    const dirs = new Set<string>();
    for (const filePath of relevantFiles) {
      const lastSlash = filePath.lastIndexOf('/');
      if (lastSlash > 0) {
        dirs.add(filePath.substring(0, lastSlash + 1));
      }
    }

    const lines: string[] = [];
    for (const dir of Array.from(dirs).sort()) {
      try {
        const entries = await listChtCoreDirectory(dir, chtCorePath);
        lines.push(`${dir}`);
        for (const entry of entries) {
          lines.push(`  ${entry}`);
        }
      } catch {
        // Directory might not exist in cht-core
      }
    }

    return lines.length > 0 ? lines.join('\n') : '';
  }

  /**
   * Initialise an optional Beads tracking session for this code-gen invocation.
   * Returns null when Beads is disabled (env flag) or unavailable (no .beads directory),
   * or when initSession itself fails — caller falls back gracefully in either case.
   */
  private async initBeadsSession(
    input: CodeGenerationInput,
  ): Promise<BeadsCodeGenSession | null> {
    if (readEnv('BEADS_CODEGEN_ENABLED') === 'false') return null;
    const beadsDir = path.join(process.cwd(), '.beads');
    if (!fs.existsSync(beadsDir)) return null;

    const session = new BeadsCodeGenSession();
    try {
      await session.initSession(
        input.issue.issue.title,
        input.issue.issue.technical_context.domain,
      );
    } catch (err) {
      console.log(`[Code Generation Agent] Beads init failed (non-fatal): ${err}`);
      return null;
    }

    // Install a one-shot signal handler so an interrupted run still records
    // a session close. Fire-and-forget: BeadsClient.update spawns `bd` via
    // execFile, which is async; we cannot use process.on('exit') (synchronous).
    const beadsShutdownHandler = () => {
      session.closeSession(0, 0, 0).catch(() => undefined);
    };
    process.once('SIGINT', beadsShutdownHandler);
    process.once('SIGTERM', beadsShutdownHandler);

    return session;
  }

  /**
   * Generate code by delegating to the active CodeGenModule.
   * Wraps the call in an optional Beads tracking session and forwards lifecycle
   * callbacks (plan recorded, file in progress / completed / failed) to it.
   */
  private async generateWithLLM(
    input: CodeGenerationInput,
    context: { existingFiles: Map<string, string>; relatedPatterns: string[]; directoryListing: string }
  ): Promise<{
    files: GeneratedFile[];
    beadsSessionId?: string;
    partialGeneration?: boolean;
    partialGenerationReason?: string;
    moduleCrossFileIssues?: import('../types').CrossFileIssue[];
    compileGateSkipped?: boolean;
    compileGateSkipReason?: string;
  }> {
    const moduleInput = this.buildModuleInput(input, context);
    const session = await this.initBeadsSession(input);

    let plannedCount = 0;
    let successCount = 0;
    let failCount = 0;

    if (session) {
      moduleInput.onPlan = async (plan) => {
        plannedCount = plan.length;
        await session.recordPlan(plan as { action: string; filePath: string; rationale: string }[])
          .catch(() => undefined);
      };
      moduleInput.onFileInProgress = (filePath) =>
        session.markFileInProgress(filePath).catch(() => undefined);
      moduleInput.onFileCompleted = (file) => {
        successCount += 1;
        return session.recordFileCompleted(file.path, file.content, file.purpose)
          .catch(() => undefined);
      };
      moduleInput.onFileFailed = (filePath, reasons) => {
        failCount += 1;
        return session.recordFileFailed(filePath, [...reasons]).catch(() => undefined);
      };
      moduleInput.onAttemptFailure = (filePath, attempt, reasons) =>
        session.recordAttemptFailure(filePath, attempt, [...reasons]).catch(() => undefined);
    }

    const moduleOutput = await this.registry.getActiveModule().generate(moduleInput);

    let beadsSessionId: string | undefined;
    if (session) {
      // Some callers may have skipped onPlan if generation aborted early; fall back to
      // counting from the module's output so the summary is still coherent.
      if (plannedCount === 0) plannedCount = moduleOutput.files.length;
      try {
        await session.closeSession(plannedCount, successCount, failCount);
      } catch (err) {
        console.log(`[Code Generation Agent] Beads close failed (non-fatal): ${err}`);
      }
      beadsSessionId = session.getSessionId() ?? undefined;
    }

    return {
      files: this.convertModuleFiles(moduleOutput.files, context.existingFiles),
      beadsSessionId,
      partialGeneration: moduleOutput.partialGeneration,
      partialGenerationReason: moduleOutput.partialGenerationReason,
      moduleCrossFileIssues: moduleOutput.crossFileIssues,
      compileGateSkipped: moduleOutput.compileGateSkipped,
      compileGateSkipReason: moduleOutput.compileGateSkipReason,
    };
  }

  /**
   * Convert agent input + gathered context into CodeGenModuleInput
   */
  private buildModuleInput(
    input: CodeGenerationInput,
    context: { existingFiles: Map<string, string>; relatedPatterns: string[]; directoryListing: string }
  ): CodeGenModuleInput {
    const contextFiles: ContextFile[] = [];

    for (const [path, content] of context.existingFiles) {
      contextFiles.push({ path, content, source: 'workspace' });
    }

    if (context.relatedPatterns.length > 0) {
      contextFiles.push({
        path: 'agent-memory/patterns.md',
        content: context.relatedPatterns.map(p => `- ${p}`).join('\n'),
        source: 'agent-memory',
      });
    }

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
      contextFiles,
      orchestrationPlan: input.orchestrationPlan,
      targetDirectory: input.chtCorePath,
      readFile: (filePath: string) => readFromChtCore(filePath, input.chtCorePath),
      listDirectory: (dirPath: string) => listChtCoreDirectory(dirPath, input.chtCorePath),
      directoryListing: context.directoryListing,
      failingFiles: input.failingFiles,
    };
  }

  /**
   * Convert layer GeneratedFile[] to agent GeneratedFile[] with inferred metadata
   */
  private convertModuleFiles(
    moduleFiles: LayerGeneratedFile[],
    existingFiles: Map<string, string>
  ): GeneratedFile[] {
    return moduleFiles.map(file => {
      const isModify = existingFiles.has(file.path) || !!file.originalContent;
      return {
        relativePath: file.path,
        content: file.content,
        language: this.inferLanguage(file.path),
        type: this.inferFileType(file.path),
        description: file.purpose || '',
        action: isModify ? 'modify' as const : 'create' as const,
        originalContent: file.originalContent ?? existingFiles.get(file.path),
      };
    });
  }

  /**
   * Validate generated files
   */
  private validateGeneratedFiles(files: GeneratedFile[]): GeneratedFile[] {
    return files.filter((file) => {
      // Ensure required fields exist
      if (!file.relativePath || !file.content) {
        return false;
      }

      // Validate language
      const validLanguages: FileLanguage[] = [
        'typescript',
        'javascript',
        'json',
        'xml',
        'yaml',
        'properties',
        'markdown',
        'html',
        'css',
        'shell',
      ];
      if (!validLanguages.includes(file.language)) {
        file.language = this.inferLanguage(file.relativePath);
      }

      // Validate type
      const validTypes: FileType[] = ['source', 'test', 'config', 'documentation', 'fixture'];
      if (!validTypes.includes(file.type)) {
        file.type = this.inferFileType(file.relativePath);
      }

      // Ensure action is set
      if (!file.action) {
        file.action = 'create';
      }

      return true;
    });
  }

  /**
   * Infer language from file extension
   */
  private inferLanguage(filePath: string): FileLanguage {
    const ext = filePath.split('.').pop()?.toLowerCase();
    const languageMap: Record<string, FileLanguage> = {
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
    return languageMap[ext || ''] || 'typescript';
  }

  /**
   * Infer file type from path
   */
  private inferFileType(filePath: string): FileType {
    if (filePath.includes('test') || filePath.includes('spec')) {
      return 'test';
    }
    if (filePath.includes('fixture') || filePath.includes('mock')) {
      return 'fixture';
    }
    if (filePath.endsWith('.json') || filePath.includes('config')) {
      return 'config';
    }
    if (filePath.endsWith('.md')) {
      return 'documentation';
    }
    return 'source';
  }

  /**
   * Analyze which requirements were implemented
   */
  private analyzeRequirements(
    requirements: string[],
    files: GeneratedFile[]
  ): { implemented: string[]; pending: string[] } {
    const implemented: string[] = [];
    const pending: string[] = [];

    const allContent = files.map((f) => f.content).join('\n').toLowerCase();

    for (const req of requirements) {
      const keywords = req.toLowerCase().split(' ').filter((w) => w.length > 4);
      const hasMatch = keywords.some((kw) => allContent.includes(kw));

      if (hasMatch && files.length > 0) {
        implemented.push(req);
      } else {
        pending.push(req);
      }
    }

    return { implemented, pending };
  }

  /**
   * Generate summary of changes
   */
  private generateSummary(files: GeneratedFile[], input: CodeGenerationInput): string {
    const sourceCount = files.filter((f) => f.type === 'source').length;
    const testCount = files.filter((f) => f.type === 'test').length;
    const configCount = files.filter((f) => f.type === 'config').length;

    return `Generated ${files.length} files for "${input.issue.issue.title}": ` +
      `${sourceCount} source, ${testCount} test, ${configCount} config files.`;
  }

  /**
   * Generate notes about the implementation
   */
  private generateNotes(files: GeneratedFile[], input: CodeGenerationInput): string[] {
    const notes: string[] = [];

    if (files.length === 0) {
      notes.push('No files were generated. Please review the requirements and try again.');
    }

    if (input.orchestrationPlan.riskFactors.length > 0) {
      notes.push(`Consider risk factors: ${input.orchestrationPlan.riskFactors.join(', ')}`);
    }

    const hasTests = files.some((f) => f.type === 'test');
    if (!hasTests) {
      notes.push('No test files generated. Consider adding tests manually.');
    }

    return notes;
  }

  /**
   * Calculate confidence score
   */
  private calculateConfidence(
    files: GeneratedFile[],
    input: CodeGenerationInput,
    implemented: string[] = [],
    pending: string[] = []
  ): number {
    let score = 0.5; // Base score

    // More files = higher confidence (up to a point)
    score += Math.min(files.length * 0.03, 0.1);

    // Has tests = higher confidence
    if (files.some((f) => f.type === 'test')) {
      score += 0.1;
    }

    // Research confidence affects code confidence
    score += input.researchFindings.confidence * 0.1;

    // Context patterns increase confidence
    if (input.contextAnalysis.reusablePatterns.length > 0) {
      score += 0.05;
    }

    // Requirement completion rate (up to 0.2)
    const totalRequirements = implemented.length + pending.length;
    if (totalRequirements > 0) {
      score += (implemented.length / totalRequirements) * 0.2;
    }

    return Math.min(score, 1.0);
  }


  /**
   * Check if a string looks like a file path (has extension)
   */
  private looksLikeFilePath(str: string): boolean {
    // Must contain a slash (path separator) and have a file extension
    const hasPathSeparator = str.includes('/') || str.includes('\\');
    const hasExtension = /\.[a-zA-Z0-9]+$/.test(str);
    // Also check it doesn't have spaces (human-readable descriptions have spaces)
    const hasNoSpaces = !str.includes(' ');

    return hasPathSeparator && hasExtension && hasNoSpaces;
  }
}
