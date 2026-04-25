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
import { TodoTracker, createAgentTodoTracker } from '../utils/todo-tracker';

interface TestEnvironmentAgentOptions {
  llmProvider?: LLMProvider;
  useMock?: boolean;
}

export class TestEnvironmentAgent {
  private llm: LLMProvider;
  private useMock: boolean;
  private todos: TodoTracker;

  constructor(options: TestEnvironmentAgentOptions = {}) {
    this.llm = options.llmProvider || createLLMProviderFromEnv();
    this.useMock = options.useMock ?? false;
    this.todos = createAgentTodoTracker('Test Env');
  }

  /**
   * Main entry point for test environment setup
   */
  async setup(input: TestEnvironmentInput): Promise<TestEnvironmentResult> {
    console.log('\n[Test Environment Agent] Starting test environment setup...');
    console.log(`[Test Environment Agent] Issue: ${input.issue.issue.title}`);
    console.log(`[Test Environment Agent] Generated files: ${input.codeGeneration.files.length}`);
    console.log(`[Test Environment Agent] Using LLM: ${this.llm.modelName}`);

    // Clear any previous todos
    this.todos.clear();

    if (input.additionalContext) {
      console.log(`[Test Environment Agent] Additional context from feedback provided`);
    }

    if (this.useMock) {
      return this.generateMockResult(input);
    }

    // Analyze generated code to determine test requirements
    const testRequirements = await this.todos.run(
      'Analyze test requirements',
      'Analyzing test requirements',
      async () => this.analyzeTestRequirements(input)
    );

    // Gather existing test patterns from cht-core
    const testPatterns = await this.todos.run(
      'Gather test patterns from cht-core',
      'Gathering test patterns from cht-core',
      async () => this.gatherTestPatterns(input)
    );

    // Generate test configurations
    const configs = await this.todos.run(
      'Generate test configurations',
      'Generating test configurations',
      async () => this.generateTestConfigs(input, testRequirements)
    );

    // Generate test files
    const testFiles = await this.todos.run(
      'Generate test files',
      'Generating test files',
      async () => this.generateTestFiles(input, testPatterns, configs)
    );

    // Generate test data/fixtures
    const testDataFiles = await this.todos.run(
      'Generate test fixtures',
      'Generating test fixtures',
      async () => this.generateTestDataFiles(input, testPatterns)
    );

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

    this.todos.printSummary();

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
   * Generate test files using LLM - uses batched approach (plan then generate each file)
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

    const baseContext = `## Issue Details
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

${additionalContext ? `## Additional Context from Human Feedback\n${additionalContext}` : ''}`;

    // Step 1: Plan which test files to generate (small JSON)
    console.log('[Test Environment Agent] Step 1: Planning test files to generate...');
    const filePlan = await this.planTestFiles(baseContext);

    if (filePlan.length === 0) {
      console.log('[Test Environment Agent] No test files planned for generation');
      return [];
    }

    console.log(`[Test Environment Agent] Planned ${filePlan.length} test files to generate`);

    // Step 2: Generate each test file individually (no JSON, just code)
    const generatedFiles: GeneratedFile[] = [];

    for (const plan of filePlan) {
      const fileId = this.todos.add(`Generate ${plan.relativePath}`, `Generating ${plan.relativePath}`);
      this.todos.start(fileId);

      const content = await this.generateSingleTestFile(baseContext, plan);

      if (content) {
        this.todos.complete(fileId);
        generatedFiles.push({
          relativePath: plan.relativePath,
          content,
          language: plan.language,
          type: 'test',
          description: plan.description,
          action: 'create',
        });
        console.log(`[Test Environment Agent] ✓ Generated ${plan.relativePath}`);
      } else {
        this.todos.fail(fileId, 'Empty or invalid content');
        console.log(`[Test Environment Agent] ✗ Failed to generate ${plan.relativePath}`);
      }
    }

    return generatedFiles;
  }

  /**
   * Step 1: Plan which test files to generate (returns small JSON)
   */
  private async planTestFiles(baseContext: string): Promise<Array<{
    relativePath: string;
    language: FileLanguage;
    testType: 'unit' | 'integration' | 'e2e';
    description: string;
  }>> {
    const planPrompt = `You are a CHT (Community Health Toolkit) test engineer planning test files.

${baseContext}

## Task
List the test files that need to be created to properly test this implementation.
Do NOT include the actual test code - just list the files with metadata.

Respond with a JSON object in this exact format:
{
  "files": [
    {
      "relativePath": "tests/unit/example.spec.ts",
      "language": "typescript",
      "testType": "unit",
      "description": "Unit tests for example service"
    }
  ]
}

Keep the list focused - include unit tests for each source file, and integration tests if needed.
Valid testTypes: unit, integration, e2e
Valid languages: typescript, javascript`;

    try {
      interface TestFilePlanOutput {
        files: Array<{
          relativePath: string;
          language: FileLanguage;
          testType: 'unit' | 'integration' | 'e2e';
          description: string;
        }>;
      }

      const result = await this.llm.invokeForJSON<TestFilePlanOutput>(planPrompt, {
        temperature: 0.2,
      });

      return result.files || [];
    } catch (error) {
      console.error('[Test Environment Agent] Error planning test files:', error);
      return [];
    }
  }

  /**
   * Step 2: Generate a single test file (returns plain code, no JSON)
   */
  private async generateSingleTestFile(
    baseContext: string,
    filePlan: {
      relativePath: string;
      language: FileLanguage;
      testType: 'unit' | 'integration' | 'e2e';
      description: string;
    }
  ): Promise<string | null> {
    const generatePrompt = `You are a CHT (Community Health Toolkit) test engineer generating test files.

${baseContext}

## Test File to Generate
Path: ${filePlan.relativePath}
Language: ${filePlan.language}
Test Type: ${filePlan.testType}
Description: ${filePlan.description}

## Instructions
Generate the complete test file content for ${filePlan.relativePath}.
- Follow CHT testing patterns and conventions
- Use appropriate assertion libraries (chai for mocha)
- Include setup/teardown hooks where needed
- Add meaningful test descriptions
- Cover happy path and edge cases
- Include proper imports

IMPORTANT: Output ONLY the code. Do not wrap in markdown code blocks. Do not include any explanation before or after the code.`;

    try {
      const response = await this.llm.invoke(generatePrompt, {
        temperature: 0.3,
      });

      let content = response.content.trim();

      // Remove markdown code blocks if the LLM added them anyway
      const codeBlockMatch = content.match(/^```(?:\w+)?\n([\s\S]*?)\n```$/);
      if (codeBlockMatch) {
        content = codeBlockMatch[1];
      }

      // Basic validation - ensure we got some content
      if (content.length < 20) {
        console.error(`[Test Environment Agent] Generated content too short for ${filePlan.relativePath}`);
        return null;
      }

      return content;
    } catch (error) {
      console.error(`[Test Environment Agent] Error generating ${filePlan.relativePath}:`, error);
      return null;
    }
  }

  /**
   * Generate test data/fixture files - uses batched approach
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

    const uniqueFixtureTypes = [...new Set(fixtureTypes)];
    const baseContext = `## Issue
${issue.issue.title}

## Fixture Types Needed
${uniqueFixtureTypes.join(', ')}

## Domain
${issue.issue.technical_context.domain}`;

    // Step 1: Plan which fixture files to generate
    console.log('[Test Environment Agent] Step 1: Planning fixture files to generate...');
    const filePlan = await this.planFixtureFiles(baseContext, uniqueFixtureTypes);

    if (filePlan.length === 0) {
      console.log('[Test Environment Agent] No fixture files planned for generation');
      return [];
    }

    console.log(`[Test Environment Agent] Planned ${filePlan.length} fixture files to generate`);

    // Step 2: Generate each fixture file individually
    const generatedFiles: GeneratedFile[] = [];

    for (const plan of filePlan) {
      const fileId = this.todos.add(`Generate fixture ${plan.relativePath}`, `Generating fixture ${plan.relativePath}`);
      this.todos.start(fileId);

      const content = await this.generateSingleFixtureFile(baseContext, plan);

      if (content) {
        this.todos.complete(fileId);
        generatedFiles.push({
          relativePath: plan.relativePath,
          content,
          language: plan.language,
          type: 'fixture',
          description: plan.description,
          action: 'create',
        });
        console.log(`[Test Environment Agent] ✓ Generated ${plan.relativePath}`);
      } else {
        this.todos.fail(fileId, 'Empty or invalid content');
        console.log(`[Test Environment Agent] ✗ Failed to generate ${plan.relativePath}`);
      }
    }

    return generatedFiles;
  }

  /**
   * Plan which fixture files to generate (returns small JSON)
   */
  private async planFixtureFiles(baseContext: string, fixtureTypes: string[]): Promise<Array<{
    relativePath: string;
    language: FileLanguage;
    fixtureType: string;
    description: string;
  }>> {
    const planPrompt = `You are a CHT test engineer planning test fixture files.

${baseContext}

## Task
List the fixture files needed to support testing. Consider:
- Each fixture type (${fixtureTypes.join(', ')}) may need its own file
- Include valid data, edge cases, and invalid data files

Do NOT include the actual fixture data - just list the files with metadata.

Respond with a JSON object in this exact format:
{
  "files": [
    {
      "relativePath": "tests/fixtures/contacts.json",
      "language": "json",
      "fixtureType": "contacts",
      "description": "Sample contact data for testing"
    }
  ]
}

Valid languages: json, typescript, javascript`;

    try {
      interface FixturePlanOutput {
        files: Array<{
          relativePath: string;
          language: FileLanguage;
          fixtureType: string;
          description: string;
        }>;
      }

      const result = await this.llm.invokeForJSON<FixturePlanOutput>(planPrompt, {
        temperature: 0.2,
      });

      return result.files || [];
    } catch (error) {
      console.error('[Test Environment Agent] Error planning fixture files:', error);
      return [];
    }
  }

  /**
   * Generate a single fixture file (returns plain content, no JSON wrapper)
   */
  private async generateSingleFixtureFile(
    baseContext: string,
    filePlan: {
      relativePath: string;
      language: FileLanguage;
      fixtureType: string;
      description: string;
    }
  ): Promise<string | null> {
    const generatePrompt = `You are a CHT test engineer generating test fixture data.

${baseContext}

## Fixture File to Generate
Path: ${filePlan.relativePath}
Language: ${filePlan.language}
Fixture Type: ${filePlan.fixtureType}
Description: ${filePlan.description}

## Instructions
Generate realistic test fixture data for CHT. Include:
1. Valid data for happy path tests
2. Edge case data (empty strings, boundary values)
3. Invalid data for error testing

IMPORTANT: Output ONLY the file content. Do not wrap in markdown code blocks. Do not include any explanation before or after the content.
If generating JSON, output valid JSON only.`;

    try {
      const response = await this.llm.invoke(generatePrompt, {
        temperature: 0.4,
      });

      let content = response.content.trim();

      // Remove markdown code blocks if the LLM added them anyway
      const codeBlockMatch = content.match(/^```(?:\w+)?\n([\s\S]*?)\n```$/);
      if (codeBlockMatch) {
        content = codeBlockMatch[1];
      }

      // Basic validation
      if (content.length < 10) {
        console.error(`[Test Environment Agent] Generated content too short for ${filePlan.relativePath}`);
        return null;
      }

      // If it's supposed to be JSON, validate it
      if (filePlan.language === 'json') {
        try {
          JSON.parse(content);
        } catch {
          console.error(`[Test Environment Agent] Generated invalid JSON for ${filePlan.relativePath}`);
          return null;
        }
      }

      return content;
    } catch (error) {
      console.error(`[Test Environment Agent] Error generating ${filePlan.relativePath}:`, error);
      return null;
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
