/**
 * Code Generation Agent
 *
 * Generates implementation code following CHT patterns based on:
 * - Orchestration plan from research phase
 * - Research findings and documentation references
 * - Context analysis and reusable patterns
 * - Existing code in cht-core codebase
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

interface CodeGenerationAgentOptions {
  llmProvider?: LLMProvider;
  useMock?: boolean;
}

export class CodeGenerationAgent {
  private llm: LLMProvider;
  private useMock: boolean;

  constructor(options: CodeGenerationAgentOptions = {}) {
    this.llm = options.llmProvider || createLLMProviderFromEnv();
    this.useMock = options.useMock ?? false;
  }

  /**
   * Main entry point for code generation
   */
  async generate(input: CodeGenerationInput): Promise<CodeGenerationResult> {
    console.log('\n[Code Generation Agent] Starting code generation...');
    console.log(`[Code Generation Agent] Issue: ${input.issue.issue.title}`);
    console.log(`[Code Generation Agent] CHT Core Path: ${input.chtCorePath}`);
    console.log(`[Code Generation Agent] Using LLM: ${this.llm.modelName}`);

    if (input.additionalContext) {
      console.log(`[Code Generation Agent] Additional context from feedback provided`);
    }

    if (this.useMock) {
      return this.generateMockResult(input);
    }

    // Gather context from cht-core
    const codeContext = await this.gatherCodeContext(input);

    // Generate code using LLM
    const generatedFiles = await this.generateWithLLM(input, codeContext);

    // Validate generated files
    const validatedFiles = this.validateGeneratedFiles(generatedFiles);

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
      confidence: this.calculateConfidence(validatedFiles, input),
    };

    console.log(`[Code Generation Agent] Generated ${result.files.length} files`);
    console.log(`[Code Generation Agent] Confidence: ${(result.confidence * 100).toFixed(0)}%`);

    return result;
  }

  /**
   * Gather relevant code context from cht-core using indices
   */
  private async gatherCodeContext(
    input: CodeGenerationInput
  ): Promise<{ existingFiles: Map<string, string>; relatedPatterns: string[] }> {
    const existingFiles = new Map<string, string>();
    const relatedPatterns: string[] = [];

    const { orchestrationPlan, contextAnalysis, chtCorePath, issue } = input;
    const domain = issue.issue.technical_context.domain;

    // Load domain-to-components index for relevant directories
    const domainToComponents = loadIndex('domain-to-components');
    let relevantDirs: string[] = [];

    if (domainToComponents && domain && domainToComponents[domain]) {
      relevantDirs = domainToComponents[domain].paths || [];
      console.log(`[Code Generation Agent] Found ${relevantDirs.length} relevant paths from index`);
    }

    // Get files from suggested components in the orchestration plan
    for (const phase of orchestrationPlan.phases) {
      for (const component of phase.suggestedComponents) {
        // Try to read existing files for context
        const content = await readFromChtCore(component, chtCorePath);
        if (content) {
          existingFiles.set(component, content);
        }
      }
    }

    // Try to list files from relevant directories
    for (const dir of relevantDirs.slice(0, 5)) { // Limit to 5 directories
      try {
        const files = await listChtCoreDirectory(dir, chtCorePath);
        if (files.length > 0) {
          console.log(`[Code Generation Agent] Found ${files.length} files in ${dir}`);
          // Read first few files for context
          for (const file of files.slice(0, 3)) {
            if (!file.endsWith('/')) { // Skip directories
              const content = await readFromChtCore(file, chtCorePath);
              if (content && !existingFiles.has(file)) {
                existingFiles.set(file, content);
              }
            }
          }
        }
      } catch {
        // Directory might not exist
      }
    }

    // Get patterns from context analysis
    if (contextAnalysis.reusablePatterns) {
      for (const pattern of contextAnalysis.reusablePatterns) {
        relatedPatterns.push(`${pattern.pattern}: ${pattern.description}`);
      }
    }

    return { existingFiles, relatedPatterns };
  }

  /**
   * Generate code using LLM
   */
  private async generateWithLLM(
    input: CodeGenerationInput,
    context: { existingFiles: Map<string, string>; relatedPatterns: string[] }
  ): Promise<GeneratedFile[]> {
    const { issue, orchestrationPlan, researchFindings, additionalContext } =
      input;

    // Build context string from existing files (limit size)
    let existingCodeContext = '';
    let charCount = 0;
    const maxChars = 8000;

    for (const [path, content] of context.existingFiles) {
      const snippet = `\n--- ${path} ---\n${content.substring(0, 1500)}...\n`;
      if (charCount + snippet.length > maxChars) break;
      existingCodeContext += snippet;
      charCount += snippet.length;
    }

    const prompt = `You are a CHT (Community Health Toolkit) developer generating implementation code.

## Issue Details
Title: ${issue.issue.title}
Type: ${issue.issue.type}
Domain: ${issue.issue.technical_context.domain}

Description:
${issue.issue.description}

Requirements:
${issue.issue.requirements.map((r, i) => `${i + 1}. ${r}`).join('\n')}

## Orchestration Plan
Approach: ${orchestrationPlan.proposedApproach}

Phases:
${orchestrationPlan.phases.map((p, i) => `${i + 1}. ${p.name}: ${p.description}`).join('\n')}

## Documentation References
${researchFindings.suggestedApproaches.map((a) => `- ${a}`).join('\n')}

## Reusable Patterns
${context.relatedPatterns.map((p) => `- ${p}`).join('\n') || 'No patterns available'}

## Existing Code Context
${existingCodeContext || 'No existing code context available'}

${additionalContext ? `## Additional Context from Human Feedback\n${additionalContext}` : ''}

## Task
Generate the implementation code for this issue. For each file:
1. Follow CHT coding patterns and conventions
2. Use TypeScript where appropriate
3. Include proper error handling
4. Add inline documentation

Respond with a JSON object in this exact format:
{
  "files": [
    {
      "relativePath": "path/to/file.ts",
      "content": "file content here",
      "language": "typescript",
      "type": "source",
      "description": "Brief description of what this file does",
      "action": "create"
    }
  ],
  "summary": "Overall summary of changes",
  "notes": ["Note 1", "Note 2"]
}`;

    try {
      interface GeneratedOutput {
        files: GeneratedFile[];
        summary?: string;
        notes?: string[];
      }

      const result = await this.llm.invokeForJSON<GeneratedOutput>(prompt, {
        temperature: 0.3,
      });

      return result.files || [];
    } catch (error) {
      console.error('[Code Generation Agent] Error generating code:', error);
      return [];
    }
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
  private calculateConfidence(files: GeneratedFile[], input: CodeGenerationInput): number {
    let score = 0.5; // Base score

    // More files = higher confidence (up to a point)
    score += Math.min(files.length * 0.05, 0.2);

    // Has tests = higher confidence
    if (files.some((f) => f.type === 'test')) {
      score += 0.1;
    }

    // Research confidence affects code confidence
    score += input.researchFindings.confidence * 0.1;

    // Context patterns increase confidence
    if (input.contextAnalysis.reusablePatterns.length > 0) {
      score += 0.1;
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
}
