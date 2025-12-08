/**
 * Test Environment Agent
 *
 * Generates test configurations and test files for CHT implementations:
 * - Unit tests for individual components
 * - Integration tests for service interactions
 * - E2E tests for workflow validation
 * - Test fixtures and mock data
 */

import {
  TestEnvironmentInput,
  TestEnvironmentResult,
  TestEnvironmentConfig,
  GeneratedFile,
  FileLanguage,
} from '../types';
import { LLMProvider, createLLMProviderFromEnv } from '../llm';
import { readFromChtCore, listChtCoreDirectory } from '../utils/staging';
import { loadIndex } from '../utils/context-loader';

interface TestEnvironmentAgentOptions {
  llmProvider?: LLMProvider;
  useMock?: boolean;
}

export class TestEnvironmentAgent {
  private llm: LLMProvider;
  private useMock: boolean;

  constructor(options: TestEnvironmentAgentOptions = {}) {
    this.llm = options.llmProvider || createLLMProviderFromEnv();
    this.useMock = options.useMock ?? false;
  }

  /**
   * Main entry point for test environment setup
   */
  async setup(input: TestEnvironmentInput): Promise<TestEnvironmentResult> {
    console.log('\n[Test Environment Agent] Starting test environment setup...');
    console.log(`[Test Environment Agent] Issue: ${input.issue.issue.title}`);
    console.log(`[Test Environment Agent] Generated files: ${input.codeGeneration.files.length}`);
    console.log(`[Test Environment Agent] Using LLM: ${this.llm.modelName}`);

    if (input.additionalContext) {
      console.log(`[Test Environment Agent] Additional context from feedback provided`);
    }

    if (this.useMock) {
      return this.generateMockResult(input);
    }

    // Analyze generated code to determine test requirements
    const testRequirements = this.analyzeTestRequirements(input);

    // Gather existing test patterns from cht-core
    const testPatterns = await this.gatherTestPatterns(input);

    // Generate test configurations
    const configs = await this.generateTestConfigs(input, testRequirements);

    // Generate test files
    const testFiles = await this.generateTestFiles(input, testPatterns, configs);

    // Generate test data/fixtures
    const testDataFiles = await this.generateTestDataFiles(input, testPatterns);

    // Generate setup instructions
    const setupInstructions = this.generateSetupInstructions(configs, input);

    // Estimate coverage
    const estimatedCoverage = this.estimateCoverage(input, testFiles);

    const result: TestEnvironmentResult = {
      configs,
      testFiles,
      testDataFiles,
      setupInstructions,
      estimatedCoverage,
    };

    console.log(`[Test Environment Agent] Generated ${testFiles.length} test files`);
    console.log(`[Test Environment Agent] Generated ${testDataFiles.length} fixture files`);
    console.log(`[Test Environment Agent] Estimated coverage: ${estimatedCoverage}%`);

    return result;
  }

  /**
   * Analyze code generation results to determine test requirements
   */
  private analyzeTestRequirements(input: TestEnvironmentInput): {
    needsUnitTests: boolean;
    needsIntegrationTests: boolean;
    needsE2ETests: boolean;
    components: string[];
  } {
    const { codeGeneration, issue } = input;
    const components: string[] = [];

    // Analyze generated files for component types
    for (const file of codeGeneration.files) {
      if (file.type === 'source') {
        // Extract component names from paths
        const match = file.relativePath.match(/([^/]+)\.(ts|js)$/);
        if (match) {
          components.push(match[1]);
        }
      }
    }

    // Determine test types needed based on issue type
    const issueType = issue.issue.type;
    const needsUnitTests = true; // Always need unit tests
    const needsIntegrationTests = ['feature', 'enhancement'].includes(issueType);
    const needsE2ETests = issueType === 'feature' && codeGeneration.files.some(
      (f) => f.relativePath.includes('webapp/') || f.relativePath.includes('component')
    );

    return {
      needsUnitTests,
      needsIntegrationTests,
      needsE2ETests,
      components,
    };
  }

  /**
   * Gather existing test patterns from cht-core
   */
  private async gatherTestPatterns(input: TestEnvironmentInput): Promise<{
    unitTestExamples: Map<string, string>;
    integrationTestExamples: Map<string, string>;
    testUtilities: string[];
  }> {
    const unitTestExamples = new Map<string, string>();
    const integrationTestExamples = new Map<string, string>();
    const testUtilities: string[] = [];

    const { chtCorePath, issue } = input;
    const domain = issue.issue.technical_context.domain;

    // Load component-to-tests index for relevant test files
    const componentToTests = loadIndex('component-to-tests');

    // Find test directories for the domain
    let testDirs: string[] = [];
    if (componentToTests && domain) {
      // Look for test paths related to domain components
      for (const [component, testInfo] of Object.entries(componentToTests)) {
        if (component.toLowerCase().includes(domain.toLowerCase())) {
          const info = testInfo as { tests?: string[] };
          if (info.tests) {
            testDirs.push(...info.tests);
          }
        }
      }
    }

    // Fallback to common test directories
    if (testDirs.length === 0) {
      testDirs = [
        'api/tests/mocha',
        'webapp/tests',
        'shared-libs/*/test',
      ];
    }

    // Read sample test files
    for (const dir of testDirs.slice(0, 3)) {
      try {
        const files = await listChtCoreDirectory(dir, chtCorePath);
        for (const file of files.slice(0, 2)) {
          if (file.endsWith('.spec.ts') || file.endsWith('.spec.js') || file.endsWith('.test.js')) {
            const content = await readFromChtCore(file, chtCorePath);
            if (content) {
              if (file.includes('integration') || file.includes('e2e')) {
                integrationTestExamples.set(file, content);
              } else {
                unitTestExamples.set(file, content);
              }
            }
          }
        }
      } catch {
        // Directory might not exist
      }
    }

    return { unitTestExamples, integrationTestExamples, testUtilities };
  }

  /**
   * Generate test configurations
   */
  private async generateTestConfigs(
    _input: TestEnvironmentInput,
    requirements: {
      needsUnitTests: boolean;
      needsIntegrationTests: boolean;
      needsE2ETests: boolean;
      components: string[];
    }
  ): Promise<TestEnvironmentConfig[]> {
    const configs: TestEnvironmentConfig[] = [];

    // Unit test config
    if (requirements.needsUnitTests) {
      configs.push({
        type: 'unit',
        framework: 'mocha',
        setupCommands: ['npm install --save-dev mocha chai sinon'],
        teardownCommands: [],
        dependencies: ['mocha', 'chai', 'sinon', '@types/mocha', '@types/chai', '@types/sinon'],
      });
    }

    // Integration test config
    if (requirements.needsIntegrationTests) {
      configs.push({
        type: 'integration',
        framework: 'mocha',
        setupCommands: [
          'npm install --save-dev mocha chai',
          'docker-compose up -d couchdb',
        ],
        teardownCommands: ['docker-compose down'],
        dependencies: ['mocha', 'chai', 'supertest'],
      });
    }

    // E2E test config
    if (requirements.needsE2ETests) {
      configs.push({
        type: 'e2e',
        framework: 'webdriver.io',
        setupCommands: [
          'npm install --save-dev webdriverio @wdio/cli',
          'docker-compose up -d',
        ],
        teardownCommands: ['docker-compose down'],
        dependencies: ['webdriverio', '@wdio/cli', '@wdio/local-runner', '@wdio/mocha-framework'],
      });
    }

    return configs;
  }

  /**
   * Generate test files using LLM
   */
  private async generateTestFiles(
    input: TestEnvironmentInput,
    testPatterns: {
      unitTestExamples: Map<string, string>;
      integrationTestExamples: Map<string, string>;
      testUtilities: string[];
    },
    configs: TestEnvironmentConfig[]
  ): Promise<GeneratedFile[]> {
    const { issue, codeGeneration, additionalContext } = input;

    // Build context from existing test patterns
    let testPatternContext = '';
    let charCount = 0;
    const maxChars = 4000;

    for (const [path, content] of testPatterns.unitTestExamples) {
      const snippet = `\n--- ${path} ---\n${content.substring(0, 1000)}...\n`;
      if (charCount + snippet.length > maxChars) break;
      testPatternContext += snippet;
      charCount += snippet.length;
    }

    // Build generated code context
    const generatedCodeContext = codeGeneration.files
      .filter((f) => f.type === 'source')
      .map((f) => `--- ${f.relativePath} ---\n${f.content.substring(0, 800)}...`)
      .join('\n\n')
      .substring(0, 6000);

    const prompt = `You are a CHT (Community Health Toolkit) test engineer generating test files.

## Issue Details
Title: ${issue.issue.title}
Type: ${issue.issue.type}
Domain: ${issue.issue.technical_context.domain}

## Requirements to Test
${issue.issue.requirements.map((r, i) => `${i + 1}. ${r}`).join('\n')}

## Generated Code to Test
${generatedCodeContext}

## Test Types Needed
${configs.map((c) => `- ${c.type} tests using ${c.framework}`).join('\n')}

## Existing Test Patterns in CHT
${testPatternContext || 'No existing test patterns available'}

${additionalContext ? `## Additional Context from Human Feedback\n${additionalContext}` : ''}

## Task
Generate test files for the implementation. For each test file:
1. Follow CHT testing patterns and conventions
2. Use appropriate assertion libraries (chai for mocha)
3. Include setup/teardown hooks where needed
4. Add meaningful test descriptions
5. Cover happy path and edge cases

Respond with a JSON object in this exact format:
{
  "files": [
    {
      "relativePath": "path/to/file.spec.ts",
      "content": "test file content",
      "language": "typescript",
      "type": "test",
      "description": "Tests for component X"
    }
  ]
}`;

    try {
      interface GeneratedOutput {
        files: GeneratedFile[];
      }

      const result = await this.llm.invokeForJSON<GeneratedOutput>(prompt, {
        temperature: 0.3,
      });

      // Ensure all files are marked as test type
      return (result.files || []).map((file) => ({
        ...file,
        type: 'test' as const,
        action: 'create' as const,
        language: this.inferLanguage(file.relativePath),
      }));
    } catch (error) {
      console.error('[Test Environment Agent] Error generating test files:', error);
      return [];
    }
  }

  /**
   * Generate test data/fixture files
   */
  private async generateTestDataFiles(
    input: TestEnvironmentInput,
    _testPatterns: {
      unitTestExamples: Map<string, string>;
      integrationTestExamples: Map<string, string>;
      testUtilities: string[];
    }
  ): Promise<GeneratedFile[]> {
    const { issue, codeGeneration } = input;

    // Determine what fixtures are needed based on generated code
    const fixtureTypes: string[] = [];

    for (const file of codeGeneration.files) {
      if (file.content.includes('contact') || file.relativePath.includes('contact')) {
        fixtureTypes.push('contacts');
      }
      if (file.content.includes('report') || file.relativePath.includes('report')) {
        fixtureTypes.push('reports');
      }
      if (file.content.includes('user') || file.relativePath.includes('user')) {
        fixtureTypes.push('users');
      }
    }

    if (fixtureTypes.length === 0) {
      return [];
    }

    const prompt = `You are a CHT test engineer generating test fixture data.

## Issue
${issue.issue.title}

## Fixture Types Needed
${[...new Set(fixtureTypes)].join(', ')}

## Domain
${issue.issue.technical_context.domain}

## Task
Generate test fixture files with realistic sample data for CHT. Include:
1. Valid data for happy path tests
2. Edge case data
3. Invalid data for error testing

Respond with a JSON object:
{
  "files": [
    {
      "relativePath": "tests/fixtures/contacts.json",
      "content": "{ fixture data }",
      "language": "json",
      "type": "fixture",
      "description": "Sample contact data for testing"
    }
  ]
}`;

    try {
      interface GeneratedOutput {
        files: GeneratedFile[];
      }

      const result = await this.llm.invokeForJSON<GeneratedOutput>(prompt, {
        temperature: 0.4,
      });

      return (result.files || []).map((file) => ({
        ...file,
        type: 'fixture' as const,
        action: 'create' as const,
        language: this.inferLanguage(file.relativePath),
      }));
    } catch (error) {
      console.error('[Test Environment Agent] Error generating fixture files:', error);
      return [];
    }
  }

  /**
   * Generate setup instructions
   */
  private generateSetupInstructions(
    configs: TestEnvironmentConfig[],
    input: TestEnvironmentInput
  ): string[] {
    const instructions: string[] = [];

    instructions.push('# Test Environment Setup Instructions');
    instructions.push('');
    instructions.push(`cd ${input.chtCorePath}`);
    instructions.push('');

    for (const config of configs) {
      instructions.push(`## ${config.type.toUpperCase()} Tests (${config.framework})`);
      instructions.push('');
      instructions.push('### Setup');
      for (const cmd of config.setupCommands) {
        instructions.push(`  ${cmd}`);
      }
      instructions.push('');

      if (config.teardownCommands.length > 0) {
        instructions.push('### Teardown');
        for (const cmd of config.teardownCommands) {
          instructions.push(`  ${cmd}`);
        }
        instructions.push('');
      }
    }

    // Add run commands
    instructions.push('## Running Tests');
    instructions.push('');
    if (configs.some((c) => c.type === 'unit')) {
      instructions.push('  npm run test:unit');
    }
    if (configs.some((c) => c.type === 'integration')) {
      instructions.push('  npm run test:integration');
    }
    if (configs.some((c) => c.type === 'e2e')) {
      instructions.push('  npm run test:e2e');
    }

    return instructions;
  }

  /**
   * Estimate test coverage
   */
  private estimateCoverage(input: TestEnvironmentInput, testFiles: GeneratedFile[]): number {
    const { codeGeneration } = input;
    const sourceFiles = codeGeneration.files.filter((f) => f.type === 'source');

    if (sourceFiles.length === 0) return 0;
    if (testFiles.length === 0) return 0;

    // Simple heuristic: ratio of test files to source files
    const ratio = testFiles.length / sourceFiles.length;

    // Base coverage estimate
    let coverage = Math.min(ratio * 50, 80);

    // Bonus for test file content length (more tests = higher coverage)
    const avgTestLength = testFiles.reduce((sum, f) => sum + f.content.length, 0) / testFiles.length;
    if (avgTestLength > 1000) coverage += 10;
    if (avgTestLength > 2000) coverage += 5;

    // Bonus for fixture files
    if (input.codeGeneration.files.some((f) => f.type === 'fixture')) {
      coverage += 5;
    }

    return Math.min(Math.round(coverage), 95);
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
   * Generate mock result for testing/POC
   */
  private generateMockResult(input: TestEnvironmentInput): TestEnvironmentResult {
    console.log('[Test Environment Agent] Using MOCK test environment setup');

    const domain = input.issue.issue.technical_context.domain || 'configuration';
    const sanitizedTitle = input.issue.issue.title.toLowerCase().replace(/[^a-z0-9]/g, '-');

    return {
      configs: [
        {
          type: 'unit',
          framework: 'mocha',
          setupCommands: ['npm install --save-dev mocha chai sinon'],
          teardownCommands: [],
          dependencies: ['mocha', 'chai', 'sinon'],
        },
        {
          type: 'integration',
          framework: 'mocha',
          setupCommands: ['npm install --save-dev supertest', 'docker-compose up -d couchdb'],
          teardownCommands: ['docker-compose down'],
          dependencies: ['supertest'],
        },
      ],
      testFiles: [
        {
          relativePath: `tests/unit/${sanitizedTitle}.spec.ts`,
          content: `/**
 * Unit tests for ${input.issue.issue.title}
 * Auto-generated by CHT Agent
 */

import { expect } from 'chai';
import * as sinon from 'sinon';

describe('${this.toPascalCase(sanitizedTitle)}', () => {
  beforeEach(() => {
    // Setup
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('initialization', () => {
    it('should initialize correctly', () => {
      // Test implementation
      expect(true).to.be.true;
    });
  });

  describe('main functionality', () => {
    it('should handle valid input', () => {
      // Test implementation
      expect(true).to.be.true;
    });

    it('should handle edge cases', () => {
      // Test implementation
      expect(true).to.be.true;
    });
  });
});`,
          language: 'typescript',
          type: 'test',
          description: `Unit tests for ${input.issue.issue.title}`,
          action: 'create',
        },
      ],
      testDataFiles: [
        {
          relativePath: `tests/fixtures/${domain}-data.json`,
          content: JSON.stringify(
            {
              validData: {
                id: 'test-001',
                type: domain,
                name: 'Test Item',
              },
              invalidData: {
                id: '',
                type: null,
              },
            },
            null,
            2
          ),
          language: 'json',
          type: 'fixture',
          description: `Test fixtures for ${domain}`,
          action: 'create',
        },
      ],
      setupInstructions: [
        '# Test Environment Setup',
        '',
        '## Prerequisites',
        '- Node.js 20+',
        '- Docker (for integration tests)',
        '',
        '## Install Dependencies',
        'npm install --save-dev mocha chai sinon supertest',
        '',
        '## Run Tests',
        'npm run test:unit',
        'npm run test:integration',
      ],
      estimatedCoverage: 65,
    };
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
