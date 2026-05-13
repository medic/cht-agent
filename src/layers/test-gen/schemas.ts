import { z } from 'zod';

export const TestPlanItemSchema = z.object({
  filePath: z.string().min(3).regex(/\.spec\.\w+$|\.test\.\w+$/, 'Test file path must end with .spec.* or .test.*'),
  testType: z.enum(['unit', 'integration', 'e2e']),
  targetSourceFile: z.string().min(1),
  description: z.string().min(10, 'Description must be at least 10 characters'),
});

export const TestPlanSchema = z.object({
  items: z.array(TestPlanItemSchema).min(1, 'Test plan must have at least one item'),
});

export const TestScenarioSchema = z.object({
  requirement: z.string().min(1),
  scenarios: z.array(z.object({
    name: z.string().min(1),
    type: z.enum(['happy-path', 'error', 'edge-case', 'boundary']),
    description: z.string().min(1),
  })).min(1),
});

export const RequirementsChecklistSchema = z.object({
  checklist: z.array(TestScenarioSchema),
});

export type ValidatedTestPlanItem = z.infer<typeof TestPlanItemSchema>;
export type ValidatedTestPlan = z.infer<typeof TestPlanSchema>;

const TEST_STRUCTURE_PATTERNS = [
  /describe\s*\(/,
  /it\s*\(/,
  /test\s*\(/,
  /expect\s*\(/,
  /assert\s*[.(]/,
  /should\s*[.(]/,
];


export const TestContentAssertions = {
  hasTestStructure(content: string): string[] {
    const failures: string[] = [];

    const hasDescribe = /describe\s*\(/.test(content);
    const hasIt = /it\s*\(/.test(content) || /test\s*\(/.test(content);

    if (!hasDescribe) {
      failures.push('Test file missing describe() block');
    }
    if (!hasIt) {
      failures.push('Test file missing it() or test() blocks');
    }

    return failures;
  },

  hasAssertions(content: string): string[] {
    const failures: string[] = [];

    const hasAssertion = TEST_STRUCTURE_PATTERNS.some(p => p.test(content));
    if (!hasAssertion) {
      failures.push('Test file contains no assertions (expect/assert/should)');
    }

    return failures;
  },

  hasProperImports(content: string, filePath: string): string[] {
    const failures: string[] = [];

    const hasImport = /^(import |const .* = require\()/m.test(content);
    if (!hasImport) {
      failures.push(`Test file ${filePath} has no import/require statements`);
    }

    return failures;
  },

  isNotPlaintext(content: string): string[] {
    const failures: string[] = [];

    const lines = content.split('\n').filter(l => l.trim().length > 0);
    const nonCommentLines = lines.filter(
      l => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('#') && !l.trim().startsWith('/*')
    );

    if (nonCommentLines.length === 0) {
      failures.push('Test file content is empty or only comments');
      return failures;
    }

    const firstFew = nonCommentLines.slice(0, 5).join('\n');
    const plaintextIndicators = [
      /^this (test |file )/im,
      /^here('s| is) (a |the )?test/im,
      /^i (would|will|should) /im,
      /^to test this/im,
    ];

    for (const pattern of plaintextIndicators) {
      if (pattern.test(firstFew)) {
        failures.push('Content appears to be a plaintext description rather than test code');
        break;
      }
    }

    return failures;
  },

  validateTestFile(content: string, filePath: string): string[] {
    return [
      ...this.isNotPlaintext(content),
      ...this.hasProperImports(content, filePath),
      ...this.hasTestStructure(content),
      ...this.hasAssertions(content),
    ];
  },
};
