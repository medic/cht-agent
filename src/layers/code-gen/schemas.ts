import { z } from 'zod';

// ============================================================================
// Zod Schemas for Structured Output Parsing
// ============================================================================

export const PlanItemSchema = z.object({
  action: z.enum(['MODIFY', 'CREATE']),
  filePath: z.string().min(3).regex(/\.\w+$/, 'File path must have an extension'),
  rationale: z.string().min(10, 'Rationale must be at least 10 characters'),
});

export const PlanSchema = z.object({
  items: z.array(PlanItemSchema).min(1, 'Plan must have at least one item'),
});

export const GeneratedFileSchema = z.object({
  path: z.string().min(3),
  content: z.string().min(20, 'File content must be at least 20 characters'),
  purpose: z.string().optional(),
});

export type ValidatedPlanItem = z.infer<typeof PlanItemSchema>;
export type ValidatedPlan = z.infer<typeof PlanSchema>;
export type ValidatedGeneratedFile = z.infer<typeof GeneratedFileSchema>;

// ============================================================================
// Deterministic Content Assertions
// Returns failure reasons (empty array = pass)
// ============================================================================

// Common patterns that indicate plaintext descriptions instead of code
const PLAINTEXT_INDICATORS = [
  /^this file (should|will|would|contains|implements|provides)/im,
  /^the (code|implementation|file|module) (should|will|would)/im,
  /^here('s| is) (a |the )?(description|summary|overview)/im,
  /^i (would|will|shall|can|should) /im,
  /^to implement this/im,
];

// Language-specific syntax markers
const SYNTAX_MARKERS: Record<string, RegExp[]> = {
  ts: [/(?:import|export|interface|type|const|let|function|class|async|=>)/],
  js: [/(?:require|module\.exports|const|let|var|function|class|async|=>)/],
  json: [/^\s*[{[]/],
  xml: [/^\s*<[?!]?\w/],
  yaml: [/^\w[\w-]*\s*:/m],
  yml: [/^\w[\w-]*\s*:/m],
  html: [/^\s*<!DOCTYPE|<html|<div|<template/i],
  css: [/[.#@]\w+\s*\{|:\s*\w+\s*;/],
  sh: [/^#!/, /\b(?:if|then|fi|do|done|echo|export)\b/],
};

function getExtension(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase();
  return ext || '';
}

export const FileContentAssertions = {
  /**
   * Detect plaintext descriptions masquerading as code.
   * Checks for natural-language patterns that indicate the LLM
   * described what it would do instead of actually writing code.
   */
  isNotPlaintext(content: string, filePath: string): string[] {
    const failures: string[] = [];
    const ext = getExtension(filePath);

    // JSON files have different rules
    if (ext === 'json') return failures;

    const lines = content.split('\n').filter(l => l.trim().length > 0);
    if (lines.length === 0) {
      failures.push('File content is empty');
      return failures;
    }

    // Check for plaintext indicators in the first few non-comment lines
    const nonCommentLines = lines.filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('#'));
    const firstFew = nonCommentLines.slice(0, 5).join('\n');

    for (const pattern of PLAINTEXT_INDICATORS) {
      if (pattern.test(firstFew)) {
        failures.push(`Content appears to be a plaintext description rather than code (matched: ${pattern.source})`);
        break;
      }
    }

    return failures;
  },

  /**
   * For MODIFY actions: verify the content has meaningful differences from the original.
   * A modified file that is identical to the original means the LLM didn't actually change anything.
   */
  hasStructuralChanges(content: string, original: string): string[] {
    const failures: string[] = [];

    // Normalize whitespace for comparison
    const normalizedContent = content.replace(/\s+/g, ' ').trim();
    const normalizedOriginal = original.replace(/\s+/g, ' ').trim();

    if (normalizedContent === normalizedOriginal) {
      failures.push('Modified file is identical to the original — no actual changes were made');
      return failures;
    }

    // Check if the diff is too small (less than 1% change by character count)
    const shorter = Math.min(normalizedContent.length, normalizedOriginal.length);
    const longer = Math.max(normalizedContent.length, normalizedOriginal.length);
    if (shorter > 0 && longer > 100) {
      // Simple character-level diff heuristic: count matching chars
      let matchCount = 0;
      const limit = Math.min(normalizedContent.length, normalizedOriginal.length);
      for (let i = 0; i < limit; i++) {
        if (normalizedContent[i] === normalizedOriginal[i]) matchCount++;
      }
      const similarity = matchCount / longer;
      if (similarity > 0.99) {
        failures.push('Modified file has less than 1% difference from the original — changes may be trivial');
      }
    }

    return failures;
  },

  /**
   * Check for language-appropriate syntax markers.
   * Ensures the content actually looks like code in the expected language.
   */
  hasSyntaxMarkers(content: string, filePath: string): string[] {
    const failures: string[] = [];
    const ext = getExtension(filePath);
    const markers = SYNTAX_MARKERS[ext];

    if (!markers) return failures; // Unknown extension, skip check

    const hasAnyMarker = markers.some(pattern => pattern.test(content));
    if (!hasAnyMarker) {
      failures.push(`Content lacks expected syntax markers for .${ext} file`);
    }

    return failures;
  },
};
