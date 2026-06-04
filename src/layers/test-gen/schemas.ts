import { z } from 'zod';
import * as ts from 'typescript';

function scriptKindFromPath(filePath: string): ts.ScriptKind {
  if (/\.tsx$/i.test(filePath)) return ts.ScriptKind.TSX;
  if (/\.jsx$/i.test(filePath)) return ts.ScriptKind.JSX;
  if (/\.js$/i.test(filePath)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

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

  /**
   * Reject content that does not parse as JS/TS. The structure/import/assertion
   * checks above only look for the PRESENCE of substrings (describe/it/require),
   * so a file with a leaked LLM reasoning preamble ("...Here is the test file:")
   * ahead of otherwise-valid code passes them while failing `node --check`. A
   * syntactic parse (language-correct for .ts/.tsx/.js/.jsx via the script kind)
   * catches that class, and the failure feeds the regenerate loop.
   */
  parsesAsCode(content: string, filePath: string): string[] {
    const sourceFile = ts.createSourceFile(
      filePath || 'test.ts',
      content,
      ts.ScriptTarget.Latest,
      false,
      scriptKindFromPath(filePath),
    );
    const diagnostics =
      (sourceFile as unknown as { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics ?? [];
    if (diagnostics.length === 0) return [];
    const message = ts.flattenDiagnosticMessageText(diagnostics[0].messageText, ' ');
    return [`Test file ${filePath} does not parse as code (likely leaked prose/preamble): ${message}`];
  },

  validateTestFile(content: string, filePath: string): string[] {
    return [
      ...this.parsesAsCode(content, filePath),
      ...this.isNotPlaintext(content),
      ...this.hasProperImports(content, filePath),
      ...this.hasTestStructure(content),
      ...this.hasAssertions(content),
    ];
  },
};
