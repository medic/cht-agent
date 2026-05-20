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
  ContextAnalysisResult,
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
import * as fs from 'node:fs';
import * as path from 'node:path';
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

/**
 * Read a file from cht-core into the existing-files map, skipping when it's
 * already loaded or when the read returns null (missing / unreadable).
 */
async function readIntoMap(
  relativePath: string,
  chtCorePath: string,
  existingFiles: Map<string, string>,
): Promise<void> {
  if (existingFiles.has(relativePath)) return;
  const content = await readFromChtCore(relativePath, chtCorePath);
  if (content) existingFiles.set(relativePath, content);
}

/** Push every string entry from each named section of `domainData` into `out`. */
function collectFromSections(
  domainData: Record<string, unknown>,
  sections: string[],
  out: string[],
): void {
  for (const section of sections) {
    const sectionData = domainData[section];
    if (!sectionData || typeof sectionData !== 'object') continue;
    pushStringEntriesFromSubtree(sectionData as Record<string, unknown>, out);
  }
}

function pushStringEntriesFromSubtree(subtree: Record<string, unknown>, out: string[]): void {
  for (const entries of Object.values(subtree)) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (typeof entry === 'string') out.push(entry);
    }
  }
}

function collectSharedLibPaths(domainData: Record<string, unknown>, out: string[]): void {
  const sharedLibs = domainData.shared_libs;
  if (!Array.isArray(sharedLibs)) return;
  for (const lib of sharedLibs) {
    if (lib?.path) out.push(lib.path);
  }
}

/**
 * NgRx infrastructure (actions, reducers, effects, selectors) for the domain.
 * Surfacing these to the LLM during planning lets it emit a coherent
 * state-management chain (action + reducer + selector + effect).
 */
function collectNgrxPaths(domainData: Record<string, unknown>, out: string[]): void {
  const ngrxData = domainData.ngrx;
  if (!ngrxData || typeof ngrxData !== 'object') return;
  pushStringEntriesFromSubtree(ngrxData as Record<string, unknown>, out);
}

function extractPatternsForPrompt(
  reusablePatterns: ContextAnalysisResult['reusablePatterns'] | undefined,
): string[] {
  if (!reusablePatterns) return [];
  return reusablePatterns.map(p => `${p.pattern}: ${p.description}`);
}

/** Produce the variant paths to match a component string against the index. */
function stripSlashes(value: string): string {
  let out = value;
  if (out.startsWith('/')) out = out.slice(1);
  if (out.endsWith('/')) out = out.slice(0, -1);
  return out;
}

function buildComponentVariants(component: string): string[] {
  // Normalize: strip leading/trailing slashes, normalize webapp/ -> webapp/src/ts/
  const normalized = stripSlashes(component);
  return [
    normalized,
    normalized.replace(/^webapp\/(?!src\/)/, 'webapp/src/ts/'),
    normalized.replace(/^webapp\/modules\//, 'webapp/src/ts/modules/'),
    normalized.replace(/^webapp\/services\//, 'webapp/src/ts/services/'),
  ];
}

/**
 * For one domain's data, push every string entry from the api / webapp /
 * sentinel sections that matches any of the supplied component variants.
 */
function collectComponentMatchesFromDomain(
  domainData: Record<string, unknown>,
  variants: string[],
  matches: string[],
): void {
  for (const section of ['api', 'webapp', 'sentinel']) {
    const sectionData = domainData[section];
    if (!sectionData || typeof sectionData !== 'object') continue;
    collectComponentMatchesFromSection(sectionData as Record<string, unknown>, variants, matches);
  }
}

function collectComponentMatchesFromSection(
  sectionData: Record<string, unknown>,
  variants: string[],
  matches: string[],
): void {
  for (const entries of Object.values(sectionData)) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (typeof entry === 'string' && matchesAnyVariant(entry, variants)) {
        matches.push(entry);
      }
    }
  }
}

function matchesAnyVariant(entry: string, variants: string[]): boolean {
  return variants.some(v => entry.startsWith(v) || entry.includes(v));
}

const CROSS_DOMAIN_KEYWORDS: Record<string, string[]> = {
  authentication: ['permission', 'auth', 'role', 'login', 'session', 'credential'],
  configuration: ['app_settings', 'settings', 'config', 'branding'],
  'data-sync': ['replication', 'sync', 'purge', 'offline'],
  'forms-and-reports': ['form', 'xform', 'xml-form', 'report', 'xform_id', 'form_id'],
};

function buildTicketSearchText(issue: CodeGenerationInput['issue']): string {
  return [
    issue.issue.title,
    issue.issue.description,
    ...issue.issue.requirements,
    ...issue.issue.technical_context.components,
  ].join(' ').toLowerCase();
}

/** Pull the api/webapp service-file lists out of one domain into `out`. */
function collectServiceFilesFromDomain(
  domainData: Record<string, unknown>,
  out: string[],
): void {
  for (const section of ['api', 'webapp']) {
    const sectionData = domainData[section];
    if (!sectionData || typeof sectionData !== 'object') continue;
    const services = (sectionData as Record<string, unknown>).services;
    if (!Array.isArray(services)) continue;
    for (const entry of services) {
      if (typeof entry === 'string') out.push(entry);
    }
  }
}

const VALID_LANGUAGES: ReadonlySet<FileLanguage> = new Set<FileLanguage>([
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
]);

const VALID_FILE_TYPES: ReadonlySet<FileType> = new Set<FileType>([
  'source',
  'test',
  'config',
  'documentation',
  'fixture',
]);

function collectParentDirectories(relevantFiles: string[]): Set<string> {
  const dirs = new Set<string>();
  for (const filePath of relevantFiles) {
    const lastSlash = filePath.lastIndexOf('/');
    if (lastSlash > 0) dirs.add(filePath.substring(0, lastSlash + 1));
  }
  return dirs;
}

export class CodeGenerationAgent {
  private readonly llm: LLMProvider;
  private readonly todos: TodoTracker;
  private readonly registry: CodeGenModuleRegistry;

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
    this.logGenerateStart(input);
    this.todos.clear();
    this.logSelectiveRegen(input);

    const codeContext = await this.todos.run(
      'Gather code context from cht-core',
      'Gathering code context from cht-core',
      async () => this.gatherCodeContext(input)
    );
    const llmResult = await this.todos.run(
      'Generate code with LLM',
      'Generating code with LLM',
      async () => this.generateWithLLM(input, codeContext)
    );
    const validatedFiles = await this.todos.run(
      'Validate generated files',
      'Validating generated files',
      async () => this.validateGeneratedFiles(llmResult.files)
    );

    const allFilesBeforeLocale = this.mergeSelectiveRegen(input, validatedFiles);
    const crossFileIssues = this.collectCrossFileIssues(allFilesBeforeLocale, llmResult);
    this.logCrossFileIssues(crossFileIssues, llmResult);

    // Locale auto-propagation: when messages-en.properties has new keys, append
    // English-value placeholders to the 9 other locale files. Deterministic, no LLM.
    const allFiles = await propagateNewLocaleKeys(allFilesBeforeLocale, input.chtCorePath);
    const { implemented, pending } = this.analyzeRequirements(input.issue.issue.requirements, allFiles);

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

  private logGenerateStart(input: CodeGenerationInput): void {
    console.log('\n[Code Generation Agent] Starting code generation...');
    console.log(`[Code Generation Agent] Issue: ${input.issue.issue.title}`);
    console.log(`[Code Generation Agent] CHT Core Path: ${input.chtCorePath}`);
    console.log(`[Code Generation Agent] Using LLM: ${this.llm.modelName}`);
    if (input.additionalContext) {
      console.log(`[Code Generation Agent] Additional context from feedback provided`);
    }
  }

  private logSelectiveRegen(input: CodeGenerationInput): void {
    if (!input.passingFiles || input.passingFiles.length === 0) return;
    console.log(`[Code Generation Agent] Selective regeneration: carrying forward ${input.passingFiles.length} passing file(s)`);
    if (input.failingFiles) {
      console.log(`[Code Generation Agent] Files to regenerate: ${input.failingFiles.map(f => f.path).join(', ')}`);
    }
  }

  /**
   * On selective regeneration, merge the previously-passing files (carried
   * forward from earlier iterations) with the newly regenerated files. Newly
   * generated paths take precedence.
   */
  private mergeSelectiveRegen(
    input: CodeGenerationInput,
    validatedFiles: GeneratedFile[],
  ): GeneratedFile[] {
    const passing = input.passingFiles;
    if (!passing || passing.length === 0) return validatedFiles;
    const newlyGeneratedPaths = new Set(validatedFiles.map(f => f.relativePath));
    const keptFiles = passing.filter(f => !newlyGeneratedPaths.has(f.relativePath));
    const merged = [...keptFiles, ...validatedFiles];
    console.log(`[Code Generation Agent] Merged: ${keptFiles.length} kept + ${validatedFiles.length} regenerated = ${merged.length} total`);
    return merged;
  }

  /**
   * Cross-file validation: identifier consistency across the MERGED batch.
   * Per D1: must run on `allFiles` (not `validatedFiles`) so iteration 2+ of
   * selective regen sees both the kept and regenerated files together.
   *
   * Combines static-validator issues (regex + AST) with runtime-signal issues
   * (module crossFileIssues + partial-completion sentinel).
   */
  private collectCrossFileIssues(
    allFiles: GeneratedFile[],
    llmResult: { moduleCrossFileIssues?: import('../types').CrossFileIssue[]; partialGeneration?: boolean; partialGenerationReason?: string },
  ): import('../types').CrossFileIssue[] {
    const regexIssues = crossFileValidate(allFiles);
    const astIssues = astValidate(allFiles);
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
    return crossFileIssues;
  }

  private logCrossFileIssues(
    crossFileIssues: import('../types').CrossFileIssue[],
    llmResult: { moduleCrossFileIssues?: import('../types').CrossFileIssue[] },
  ): void {
    if (crossFileIssues.length === 0) return;
    const moduleCount = (llmResult.moduleCrossFileIssues ?? []).length;
    const partialCount = crossFileIssues.length - moduleCount;
    console.warn(
      `[Code Generation Agent] Found ${crossFileIssues.length} cross-file issue(s) ` +
      `(${partialCount} static + ${moduleCount} module):`
    );
    for (const issue of crossFileIssues) {
      const detail = issue.reason ?? issue.description ?? '(no detail)';
      console.warn(`[Code Generation Agent]   ${issue.filePath}: ${detail}`);
    }
  }

  /**
   * Gather relevant code context from cht-core using indices
   */
  private async gatherCodeContext(
    input: CodeGenerationInput
  ): Promise<{ existingFiles: Map<string, string>; relatedPatterns: string[]; directoryListing: string }> {
    const existingFiles = new Map<string, string>();
    const { orchestrationPlan, contextAnalysis, chtCorePath, issue } = input;
    const domainToComponents = loadIndex('domain-to-components') as DomainIndex | null;

    const relevantFiles = this.collectRelevantFilesFromDomainIndex(domainToComponents, issue.issue.technical_context.domain);
    await this.gatherFilesFromPhases(orchestrationPlan, domainToComponents, chtCorePath, existingFiles);
    this.appendCrossDomainFiles(issue, domainToComponents, relevantFiles);
    await this.readAllRelevantFiles(relevantFiles, chtCorePath, existingFiles);

    const relatedPatterns = extractPatternsForPrompt(contextAnalysis.reusablePatterns);
    const directoryListing = await this.buildDirectoryListing(relevantFiles, chtCorePath);
    return { existingFiles, relatedPatterns, directoryListing };
  }

  /**
   * Pull the domain's known files out of the domain-to-components index.
   * Splits the section / shared_libs / ngrx subtrees into separate helpers
   * so each remains under the complexity threshold.
   */
  private collectRelevantFilesFromDomainIndex(
    domainToComponents: DomainIndex | null,
    domain: string,
  ): string[] {
    const relevantFiles: string[] = [];
    const domainData = domainToComponents?.domains?.[domain];
    if (!domainData) return relevantFiles;
    collectFromSections(domainData, ['api', 'webapp', 'sentinel'], relevantFiles);
    collectSharedLibPaths(domainData, relevantFiles);
    collectNgrxPaths(domainData, relevantFiles);
    console.log(`[Code Generation Agent] Found ${relevantFiles.length} relevant files from index`);
    return relevantFiles;
  }

  /**
   * Resolve directory-style components from orchestration plan to actual files.
   */
  private async gatherFilesFromPhases(
    orchestrationPlan: CodeGenerationInput['orchestrationPlan'],
    domainToComponents: DomainIndex | null,
    chtCorePath: string,
    existingFiles: Map<string, string>,
  ): Promise<void> {
    for (const phase of orchestrationPlan.phases) {
      for (const component of phase.suggestedComponents) {
        await this.gatherFilesForComponent(component, domainToComponents, chtCorePath, existingFiles);
      }
    }
  }

  private async gatherFilesForComponent(
    component: string,
    domainToComponents: DomainIndex | null,
    chtCorePath: string,
    existingFiles: Map<string, string>,
  ): Promise<void> {
    const resolvedPaths = this.resolveComponentToFiles(component, domainToComponents);
    if (resolvedPaths.length > 0) {
      for (const filePath of resolvedPaths) {
        await readIntoMap(filePath, chtCorePath, existingFiles);
      }
      return;
    }
    if (this.looksLikeFilePath(component)) {
      await readIntoMap(component, chtCorePath, existingFiles);
    }
  }

  private appendCrossDomainFiles(
    issue: CodeGenerationInput['issue'],
    domainToComponents: DomainIndex | null,
    relevantFiles: string[],
  ): void {
    const crossDomainFiles = this.getCrossDomainFiles(issue, domainToComponents);
    if (crossDomainFiles.length === 0) return;
    console.log(`[Code Generation Agent] Found ${crossDomainFiles.length} cross-domain files`);
    relevantFiles.push(...crossDomainFiles);
  }

  /**
   * Read every file listed in `relevantFiles` into the existing-files map,
   * expanding directory entries (trailing slash) via listChtCoreDirectory.
   */
  private async readAllRelevantFiles(
    relevantFiles: string[],
    chtCorePath: string,
    existingFiles: Map<string, string>,
  ): Promise<void> {
    for (const filePath of relevantFiles) {
      if (existingFiles.has(filePath)) continue;
      if (filePath.endsWith('/')) {
        await this.readDirectoryIntoMap(filePath, chtCorePath, existingFiles);
      } else {
        await readIntoMap(filePath, chtCorePath, existingFiles);
      }
    }
  }

  private async readDirectoryIntoMap(
    dirPath: string,
    chtCorePath: string,
    existingFiles: Map<string, string>,
  ): Promise<void> {
    try {
      const files = await listChtCoreDirectory(dirPath, chtCorePath);
      for (const file of files) {
        if (file.endsWith('/') || existingFiles.has(file)) continue;
        await readIntoMap(file, chtCorePath, existingFiles);
      }
    } catch {
      // Directory might not exist; skip.
    }
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
    const variants = buildComponentVariants(component);
    const matches: string[] = [];
    for (const domainData of Object.values(domainIndex.domains) as Record<string, unknown>[]) {
      collectComponentMatchesFromDomain(domainData, variants, matches);
    }
    return [...new Set(matches)];
  }

  /**
   * Gather files from related domains based on ticket keywords.
   * E.g., a contacts ticket mentioning "permission" should pull auth domain files.
   */
  private getCrossDomainFiles(issue: CodeGenerationInput['issue'], domainIndex: DomainIndex | null): string[] {
    if (!domainIndex?.domains) return [];
    const ticketText = buildTicketSearchText(issue);
    const currentDomain = issue.issue.technical_context.domain;
    const files: string[] = [];
    for (const [domain, keywords] of Object.entries(CROSS_DOMAIN_KEYWORDS)) {
      if (domain === currentDomain) continue;
      if (!keywords.some(kw => ticketText.includes(kw))) continue;
      const domainData = domainIndex.domains[domain];
      if (!domainData) continue;
      collectServiceFilesFromDomain(domainData, files);
    }
    return files;
  }

  /**
   * Build a directory listing (repo map) from relevant file paths.
   * Gives the LLM awareness of what files exist in relevant cht-core directories.
   */
  private async buildDirectoryListing(relevantFiles: string[], chtCorePath: string): Promise<string> {
    const dirs = collectParentDirectories(relevantFiles);
    const lines: string[] = [];
    for (const dir of Array.from(dirs).sort((a, b) => a.localeCompare(b))) {
      await this.appendDirectoryListing(dir, chtCorePath, lines);
    }
    return lines.length > 0 ? lines.join('\n') : '';
  }

  private async appendDirectoryListing(
    dir: string,
    chtCorePath: string,
    lines: string[],
  ): Promise<void> {
    try {
      const entries = await listChtCoreDirectory(dir, chtCorePath);
      lines.push(dir);
      for (const entry of entries) lines.push(`  ${entry}`);
    } catch {
      // Directory might not exist in cht-core; skip.
    }
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
    return files.filter(file => this.normalizeGeneratedFile(file));
  }

  /**
   * Drop files missing required fields. Repair invalid language/type fields
   * by re-inferring from the path. Default action to 'create' when unset.
   * Mutates `file` in place; returns whether the file should be kept.
   */
  private normalizeGeneratedFile(file: GeneratedFile): boolean {
    if (!file.relativePath || !file.content) return false;
    if (!VALID_LANGUAGES.has(file.language)) file.language = this.inferLanguage(file.relativePath);
    if (!VALID_FILE_TYPES.has(file.type)) file.type = this.inferFileType(file.relativePath);
    if (!file.action) file.action = 'create';
    return true;
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

    return Math.min(score, 1);
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
