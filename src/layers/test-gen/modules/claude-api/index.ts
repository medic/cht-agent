import {
  TestGenModule,
  TestGenModuleInput,
  TestGenModuleOutput,
  TestScenario,
  TestType,
} from '../../interface';
import { GeneratedFile } from '../../../code-gen/interface';
import { LLMProvider, createLLMProviderFromEnv } from '../../../../llm';
import { readEnv } from '../../../../utils/env';
import {
  TestPlanSchema,
  TestContentAssertions,
  RequirementsChecklistSchema,
} from '../../schemas';

export interface TestPlanItem {
  filePath: string;
  testType: TestType;
  targetSourceFile: string;
  description: string;
}

export class ClaudeApiTestGenModule implements TestGenModule {
  name = 'claude-api';

  version = '0.1.0';

  private provider?: LLMProvider;

  constructor(provider?: LLMProvider) {
    this.provider = provider;
  }

  private getProvider(): LLMProvider {
    if (!this.provider) {
      this.provider = createLLMProviderFromEnv();
    }
    return this.provider;
  }

  async generate(input: TestGenModuleInput): Promise<TestGenModuleOutput> {
    const llm = this.getProvider();

    console.log(`[Test Gen Module] Generating tests for "${input.ticket.issue.title}"...`);
    console.log(`[Test Gen Module] Source files: ${input.generatedCode.length}, test types: ${input.testTypes.join(', ')}`);

    // Phase 1: Generate test plan
    let plan: TestPlanItem[];
    let planTokens = 0;
    try {
      const planResult = await this.generateTestPlan(input);
      plan = planResult.plan;
      planTokens = planResult.tokensUsed;
    } catch (error) {
      console.error('[Test Gen Module] Test plan generation failed:', error);
      return {
        files: [],
        explanation: `Test generation failed for "${input.ticket.issue.title}".`,
        tokensUsed: 0,
        modelUsed: llm.modelName,
        requirementsChecklist: [],
      };
    }

    if (plan.length === 0) {
      console.log('[Test Gen Module] Empty plan — no test files to generate');
      return {
        files: [],
        explanation: `No test plan generated for "${input.ticket.issue.title}".`,
        tokensUsed: planTokens,
        modelUsed: llm.modelName,
        requirementsChecklist: [],
      };
    }

    console.log(`[Test Gen Module] Plan (${plan.length} file(s)):`);
    for (const item of plan) {
      console.log(`[Test Gen Module]   ${item.testType} ${item.filePath} → ${item.targetSourceFile}`);
    }

    // Phase 2: Generate each test file sequentially
    const genResult = await this.generateTestFilesSequentially(plan, input);
    const totalTokens = planTokens + genResult.tokensUsed;

    // Phase 3: Generate requirements checklist
    let checklist: TestScenario[] = [];
    let checklistTokens = 0;
    try {
      const checklistResult = await this.generateRequirementsChecklist(input, genResult.files);
      checklist = checklistResult.checklist;
      checklistTokens = checklistResult.tokensUsed;
    } catch (error) {
      console.error('[Test Gen Module] Requirements checklist generation failed:', error);
    }

    console.log(`[Test Gen Module] Generated ${genResult.files.length} test file(s)`);
    console.log(`[Test Gen Module] Requirements checklist: ${checklist.length} requirement(s) mapped`);

    return {
      files: genResult.files,
      explanation:
        `Generated ${genResult.files.length} test file(s) for "${input.ticket.issue.title}" ` +
        `targeting the ${input.ticket.issue.technical_context.domain} domain.`,
      tokensUsed: totalTokens + checklistTokens,
      modelUsed: llm.modelName,
      requirementsChecklist: checklist,
      warnings: genResult.warnings.length > 0 ? genResult.warnings : undefined,
    };
  }

  async validate(): Promise<boolean> {
    if (readEnv('LLM_PROVIDER') === 'claude-cli') return true;
    return Boolean(readEnv('ANTHROPIC_API_KEY'));
  }

  // ============================================================================
  // Phase 1: Test Plan Generation
  // ============================================================================

  private async generateTestPlan(
    input: TestGenModuleInput
  ): Promise<{ plan: TestPlanItem[]; tokensUsed: number }> {
    const llm = this.getProvider();
    const prompt = this.buildTestPlanPrompt(input);

    const response = await llm.invoke(prompt, { temperature: 0.3, maxTokens: 8192, disableTools: true });
    const tokensUsed = (response.usage?.inputTokens ?? 0) + (response.usage?.outputTokens ?? 0);

    const plan = this.parseTestPlan(response.content);

    const validation = TestPlanSchema.safeParse({ items: plan });
    if (!validation.success) {
      console.log(`[Test Gen Module] Plan validation warnings: ${validation.error.issues.map(i => i.message).join(', ')}`);
    }

    return { plan, tokensUsed };
  }

  parseTestPlan(rawContent: string): TestPlanItem[] {
    const items: TestPlanItem[] = [];

    const planMatch = rawContent.match(/=== TEST PLAN ===([\s\S]*?)=== END TEST PLAN ===/);
    const content = planMatch ? planMatch[1] : rawContent;

    const lineRegex = /^\d+\.\s*(unit|integration|e2e)\s+(\S+)\s+→\s+(\S+)\s*[-–—]\s*(.+)/gim;
    let match;
    while ((match = lineRegex.exec(content)) !== null) {
      items.push({
        testType: match[1].toLowerCase() as TestType,
        filePath: match[2].replace(/`/g, '').trim(),
        targetSourceFile: match[3].replace(/`/g, '').trim(),
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
    input: TestGenModuleInput
  ): Promise<{ files: GeneratedFile[]; tokensUsed: number; warnings: string[] }> {
    const generatedFiles: GeneratedFile[] = [];
    let totalTokens = 0;
    const warnings: string[] = [];

    for (let i = 0; i < plan.length; i++) {
      const planItem = plan[i];
      console.log(`[Test Gen Module] Generating file ${i + 1}/${plan.length}: ${planItem.filePath}`);

      const result = await this.generateSingleTestFileWithRetry(
        planItem, plan, input, generatedFiles
      );

      totalTokens += result.tokensUsed;
      if (result.file) {
        generatedFiles.push(result.file);
        console.log(`[Test Gen Module]   OK ${planItem.filePath} (${result.file.content.length} chars)`);
      } else {
        console.log(`[Test Gen Module]   FAILED ${planItem.filePath}`);
        warnings.push(`Failed to generate ${planItem.filePath} after retries`);
      }
    }

    return { files: generatedFiles, tokensUsed: totalTokens, warnings };
  }

  private async generateSingleTestFileWithRetry(
    planItem: TestPlanItem,
    fullPlan: TestPlanItem[],
    input: TestGenModuleInput,
    previouslyGenerated: GeneratedFile[],
    maxAttempts: number = 3
  ): Promise<{ file: GeneratedFile | null; tokensUsed: number }> {
    let lastFailures: string[] = [];
    let totalTokens = 0;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (attempt > 1) {
        console.log(`[Test Gen Module]   Retry ${attempt}/${maxAttempts} for ${planItem.filePath}`);
      }

      const result = await this.generateSingleTestFile(
        planItem, fullPlan, input, previouslyGenerated,
        lastFailures.length > 0 ? lastFailures : undefined
      );

      totalTokens += result.tokensUsed;
      if (!result.file) {
        lastFailures = ['LLM returned no usable content'];
        continue;
      }

      const failures = TestContentAssertions.validateTestFile(result.file.content, result.file.path);
      if (failures.length === 0) {
        return { file: result.file, tokensUsed: totalTokens };
      }

      console.log(`[Test Gen Module]   Assertion failures: ${failures.join('; ')}`);
      lastFailures = failures;
    }

    return { file: null, tokensUsed: totalTokens };
  }

  private async generateSingleTestFile(
    planItem: TestPlanItem,
    fullPlan: TestPlanItem[],
    input: TestGenModuleInput,
    previouslyGenerated: GeneratedFile[],
    previousFailures?: string[]
  ): Promise<{ file: GeneratedFile | null; tokensUsed: number }> {
    const llm = this.getProvider();
    const prompt = this.buildSingleTestFilePrompt(
      planItem, fullPlan, input, previouslyGenerated, previousFailures
    );

    let response;
    try {
      response = await llm.invoke(prompt, {
        temperature: 0.3,
        maxTokens: 65536,
        disableTools: true,
      });
    } catch (error) {
      console.error(`[Test Gen Module]   Failed to generate ${planItem.filePath}:`, error);
      return { file: null, tokensUsed: 0 };
    }

    const tokensUsed = (response.usage?.inputTokens ?? 0) + (response.usage?.outputTokens ?? 0);
    const content = this.extractCodeContent(response.content);

    if (!content || content.length < 20) {
      return { file: null, tokensUsed };
    }

    return {
      file: { path: planItem.filePath, content, purpose: planItem.description },
      tokensUsed,
    };
  }

  // ============================================================================
  // Phase 3: Requirements Checklist
  // ============================================================================

  private async generateRequirementsChecklist(
    input: TestGenModuleInput,
    generatedTestFiles: GeneratedFile[]
  ): Promise<{ checklist: TestScenario[]; tokensUsed: number }> {
    const llm = this.getProvider();
    const prompt = this.buildRequirementsChecklistPrompt(input, generatedTestFiles);

    const response = await llm.invoke(prompt, { temperature: 0.2, maxTokens: 8192, disableTools: true });
    const tokensUsed = (response.usage?.inputTokens ?? 0) + (response.usage?.outputTokens ?? 0);

    const checklist = this.parseRequirementsChecklist(response.content);

    return { checklist, tokensUsed };
  }

  parseRequirementsChecklist(rawContent: string): TestScenario[] {
    const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
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

=== TEST PLAN ===
1. unit tests/unit/controllers/contacts.spec.js → api/src/controllers/contacts.js - Unit tests for contact search endpoint
2. integration tests/integration/contacts-search.spec.js → api/src/controllers/contacts.js - Integration test with CouchDB for search
=== END TEST PLAN ===

Output ONLY the plan section. Do not generate any test code.`;
  }

  buildSingleTestFilePrompt(
    planItem: TestPlanItem,
    fullPlan: TestPlanItem[],
    input: TestGenModuleInput,
    previouslyGenerated: GeneratedFile[],
    previousFailures?: string[]
  ): string {
    const { ticket, generatedCode, existingTestExamples } = input;

    const planSummary = fullPlan
      .map((p, i) => `${i + 1}. ${p.testType} ${p.filePath} → ${p.targetSourceFile}`)
      .join('\n');

    const targetFile = generatedCode.find(
      f => f.relativePath === planItem.targetSourceFile ||
        f.relativePath.endsWith(planItem.targetSourceFile)
    );

    let sourceContext = '';
    if (targetFile) {
      sourceContext = `\n## Source Code Under Test (${planItem.targetSourceFile})\n\`\`\`\n${targetFile.content}\n\`\`\``;
    }

    let patternContext = '';
    if (existingTestExamples && existingTestExamples.length > 0) {
      const relevant = existingTestExamples.find(
        e => e.path.includes(planItem.testType) ||
          (planItem.testType === 'unit' && !e.path.includes('integration') && !e.path.includes('e2e'))
      ) || existingTestExamples[0];

      if (relevant) {
        const truncated = relevant.content.split('\n').slice(0, 50).join('\n');
        patternContext = `\n## Example Test Pattern (follow this style)\n--- ${relevant.path} ---\n\`\`\`\n${truncated}\n\`\`\``;
      }
    }

    let previousContext = '';
    if (previouslyGenerated.length > 0) {
      previousContext = '\n## Previously Generated Test Files (for consistency)';
      for (const prev of previouslyGenerated) {
        const lines = prev.content.split('\n');
        const preview = lines.slice(0, 10).join('\n');
        previousContext += `\n### ${prev.path}\n\`\`\`\n${preview}\n${lines.length > 10 ? `... (${lines.length} lines)` : ''}\n\`\`\``;
      }
    }

    let failureContext = '';
    if (previousFailures && previousFailures.length > 0) {
      failureContext = `\n## PREVIOUS ATTEMPT FAILED\nYour previous output for this file failed these checks:\n${previousFailures.map(f => `- ${f}`).join('\n')}\nFix these specific issues. Do not repeat the same mistakes.`;
    }

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
${ticket.issue.requirements.map((r, i) => `${i + 1}. ${r}`).join('\n')}
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

  private buildRequirementsChecklistPrompt(
    input: TestGenModuleInput,
    generatedTestFiles: GeneratedFile[]
  ): string {
    const { ticket } = input;

    const testFileSummary = generatedTestFiles
      .map(f => {
        const itBlocks = f.content.match(/it\(['"`](.*?)['"`]/g) || [];
        const testNames = itBlocks.map(b => b.replace(/it\(['"`]/, '').replace(/['"`]$/, ''));
        return `File: ${f.path}\nTests:\n${testNames.map(t => `  - ${t}`).join('\n')}`;
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
  // Helpers
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

  extractCodeContent(rawContent: string): string {
    let content = rawContent.trim();

    const codeBlockMatch = content.match(/^```(?:\w+)?\n([\s\S]*?)\n```$/);
    if (codeBlockMatch) {
      content = codeBlockMatch[1];
    }

    // Strip leading prose before code starts
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
}

export function createClaudeApiTestGenModule(provider?: LLMProvider): ClaudeApiTestGenModule {
  return new ClaudeApiTestGenModule(provider);
}
