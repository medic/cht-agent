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
import {
  ContextFile,
  CodeGenModuleInput,
  GeneratedFile as LayerGeneratedFile,
} from '../layers/code-gen/interface';
import { CodeGenModuleRegistry, createDefaultCodeGenRegistry } from '../layers/code-gen/registry';

interface CodeGenerationAgentOptions {
  llmProvider?: LLMProvider;
  useMock?: boolean;
  codeGenRegistry?: CodeGenModuleRegistry;
}

export class CodeGenerationAgent {
  private llm: LLMProvider;
  private useMock: boolean;
  private todos: TodoTracker;
  private registry: CodeGenModuleRegistry;

  constructor(options: CodeGenerationAgentOptions = {}) {
    this.llm = options.llmProvider || createLLMProviderFromEnv();
    this.useMock = options.useMock ?? false;
    this.todos = createAgentTodoTracker('Code Gen');
    this.registry = options.codeGenRegistry || createDefaultCodeGenRegistry(this.llm);
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

    if (this.useMock) {
      return this.generateMockResult(input);
    }

    // Gather context from cht-core
    const codeContext = await this.todos.run(
      'Gather code context from cht-core',
      'Gathering code context from cht-core',
      async () => this.gatherCodeContext(input)
    );

    // Generate code via module
    const generatedFiles = await this.todos.run(
      'Generate code with LLM',
      'Generating code with LLM',
      async () => this.generateWithLLM(input, codeContext)
    );

    // Validate generated files
    const validatedFiles = await this.todos.run(
      'Validate generated files',
      'Validating generated files',
      async () => this.validateGeneratedFiles(generatedFiles)
    );

    // Determine which requirements were implemented
    const { implemented, pending } = this.analyzeRequirements(
      input.issue.issue.requirements,
      validatedFiles
    );

    const result: CodeGenerationResult = {
      files: validatedFiles,
      summary: this.generateSummary(validatedFiles, input),
      implementedRequirements: implemented,
      pendingRequirements: pending,
      notes: this.generateNotes(validatedFiles, input),
      confidence: this.calculateConfidence(validatedFiles, input, implemented, pending),
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
    const domainToComponents = loadIndex('domain-to-components');
    let relevantFiles: string[] = [];

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
    domainIndex: any,
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
    for (const [, domainData] of Object.entries(domainIndex.domains) as [string, any][]) {
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
  private getCrossDomainFiles(issue: CodeGenerationInput['issue'], domainIndex: any): string[] {
    if (!domainIndex?.domains) return [];

    const crossDomainKeywords: Record<string, string[]> = {
      authentication: ['permission', 'auth', 'role', 'login', 'session', 'credential'],
      configuration: ['app_settings', 'settings', 'config', 'branding'],
      'data-sync': ['replication', 'sync', 'purge', 'offline'],
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
        const sectionData = domainData[section];
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
   * Generate code by delegating to the active CodeGenModule
   */
  private async generateWithLLM(
    input: CodeGenerationInput,
    context: { existingFiles: Map<string, string>; relatedPatterns: string[]; directoryListing: string }
  ): Promise<GeneratedFile[]> {
    const moduleInput = this.buildModuleInput(input, context);
    const moduleOutput = await this.registry.getActiveModule().generate(moduleInput);
    return this.convertModuleFiles(moduleOutput.files, context.existingFiles);
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
    };
  }

  /**
   * Convert layer GeneratedFile[] to agent GeneratedFile[] with inferred metadata
   */
  private convertModuleFiles(
    moduleFiles: LayerGeneratedFile[],
    existingFiles: Map<string, string> = new Map()
  ): GeneratedFile[] {
    return moduleFiles.map(file => ({
      relativePath: file.path,
      content: file.content,
      language: this.inferLanguage(file.path),
      type: this.inferFileType(file.path),
      description: file.purpose || '',
      action: existingFiles.has(file.path) ? 'modify' as const : 'create' as const,
    }));
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
   * Generate mock result for testing/POC
   */
  private generateMockResult(input: CodeGenerationInput): CodeGenerationResult {
    console.log('[Code Generation Agent] Using MOCK code generation');

    const domain = input.issue.issue.technical_context.domain || 'configuration';
    const mockFiles = this.getMockFilesForDomain(domain, input.issue.issue.title);

    return {
      files: mockFiles,
      summary: `Mock implementation for "${input.issue.issue.title}" in ${domain} domain`,
      implementedRequirements: input.issue.issue.requirements.slice(
        0,
        Math.ceil(input.issue.issue.requirements.length * 0.7)
      ),
      pendingRequirements: input.issue.issue.requirements.slice(
        Math.ceil(input.issue.issue.requirements.length * 0.7)
      ),
      notes: [
        'This is a mock implementation for POC purposes',
        'Real implementation would generate actual code based on LLM analysis',
      ],
      confidence: 0.75,
    };
  }

  /**
   * Get mock files based on domain
   */
  private getMockFilesForDomain(domain: string, issueTitle: string): GeneratedFile[] {
    const sanitizedTitle = issueTitle.toLowerCase().replace(/[^a-z0-9]/g, '-');

    const mockFiles: Record<string, GeneratedFile[]> = {
      contacts: [
        {
          relativePath: `webapp/src/ts/modules/contacts/${sanitizedTitle}.component.ts`,
          content: `/**
 * ${issueTitle} Component
 * Auto-generated by CHT Agent
 */

import { Component, OnInit } from '@angular/core';

@Component({
  selector: 'app-${sanitizedTitle}',
  templateUrl: './${sanitizedTitle}.component.html'
})
export class ${this.toPascalCase(sanitizedTitle)}Component implements OnInit {
  constructor() {}

  ngOnInit(): void {
    // Implementation here
  }
}`,
          language: 'typescript',
          type: 'source',
          description: `Angular component for ${issueTitle}`,
          action: 'create',
        },
        {
          relativePath: `api/src/controllers/${sanitizedTitle}.js`,
          content: `/**
 * ${issueTitle} Controller
 * Auto-generated by CHT Agent
 */

const db = require('../db');

module.exports = {
  async get(req, res) {
    // Implementation here
    res.json({ status: 'ok' });
  }
};`,
          language: 'javascript',
          type: 'source',
          description: `API controller for ${issueTitle}`,
          action: 'create',
        },
      ],
      'forms-and-reports': [
        {
          relativePath: `webapp/src/ts/modules/reports/${sanitizedTitle}.service.ts`,
          content: `/**
 * ${issueTitle} Service
 * Auto-generated by CHT Agent
 */

import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class ${this.toPascalCase(sanitizedTitle)}Service {
  constructor() {}

  async process(): Promise<void> {
    // Implementation here
  }
}`,
          language: 'typescript',
          type: 'source',
          description: `Service for ${issueTitle}`,
          action: 'create',
        },
      ],
      default: [
        {
          relativePath: `api/src/services/${sanitizedTitle}.js`,
          content: `/**
 * ${issueTitle} Service
 * Auto-generated by CHT Agent
 */

module.exports = {
  async execute() {
    // Implementation here
    return { success: true };
  }
};`,
          language: 'javascript',
          type: 'source',
          description: `Service implementation for ${issueTitle}`,
          action: 'create',
        },
      ],
    };

    return mockFiles[domain] || mockFiles.default;
  }

  /**
   * Convert string to PascalCase
   */
  private toPascalCase(str: string): string {
    return str
      .split('-')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join('');
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
