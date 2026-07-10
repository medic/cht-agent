import * as path from 'node:path';

/** Patterns that indicate the start of actual source code (vs LLM reasoning text) */
export const CODE_START_PATTERNS = [
  /^(import |export |const |let |var |function |class |interface |type |async |return |module\.exports)/,
  /^(require\(|'use strict'|"use strict")/,
  /^(\/\*\*|\/\/\s|\/\*|#!\/)/,
  /^(describe\(|it\(|test\(|beforeEach\(|afterEach\()/,
  /^(package |@Component|@Injectable|@NgModule)/,
  /^\s*[{[<]/,
];

// `\s` (single), not `\s+`: `\s+` overlaps the `.*` before it and backtracks
// quadratically on long whitespace runs (S8786). `.*\s\w` matches the same
// strings because `.*` absorbs any leading whitespace.
export const PROSE_PATTERN = /^[A-Z][a-z].*\s\w/;
export const CODE_KEYWORD_PATTERN = /^(import|export|const|let|var|function|class|interface|type|async|return|module|require|describe|it|test|before|after|package|@)/;

export interface SearchReplaceBlock {
  search: string;
  replace: string;
}

export function looksLikePythonScript(content: string): boolean {
  const trimmed = content.trim();
  return (
    trimmed.includes('import json') ||
    trimmed.includes('import sys') ||
    ((trimmed.startsWith('import ') || trimmed.startsWith('#!/')) && trimmed.includes('json.'))
  );
}

/**
 * Extract Python script from LLM output that may contain preamble text or markdown fences.
 * The LLM often prefixes the script with "Based on..." or "Here's the script:" etc.
 * Strips everything before the first import/shebang line and removes markdown fences.
 */
export function extractPythonScript(content: string): string {
  let cleaned = content.trim();

  const fenceMatch = /```(?:python)?\s*\n([\s\S]*?)```/.exec(cleaned);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }

  const lines = cleaned.split('\n');
  const startIdx = lines.findIndex(line => {
    const trimmedLine = line.trimStart();
    return (
      trimmedLine.startsWith('import ') ||
      trimmedLine.startsWith('from ') ||
      trimmedLine.startsWith('#!/')
    );
  });

  if (startIdx > 0) {
    console.log(`[Code Gen Lib]   Stripped ${startIdx} preamble line(s) from Python script`);
    cleaned = lines.slice(startIdx).join('\n');
  }

  return cleaned;
}

/**
 * Check if content appears to be actual code rather than LLM reasoning/thinking.
 */
const REASONING_PATTERNS: RegExp[] = [
  /^I'm (unable|not able|sorry|afraid)/i,
  /^I (cannot|can't|don't have|would need|need to)/i,
  /^(Unfortunately|Could you|Please provide|Let me explain)/i,
  /^(Based on|Looking at|From the|Without being able)/i,
  /I'm unable to/i,
  /I cannot (read|access|view|see|generate)/i,
  /Could you (please )?provide/i,
  /I don't have (access|the ability|file reading)/i,
  /I (only )?have (documentation search|the first \d+ lines)/i,
];

function looksLikeCodeByExtension(trimmed: string, ext: string): boolean {
  if (ext === '.json') return trimmed.startsWith('{') || trimmed.startsWith('[');
  if (['.ts', '.js', '.tsx', '.jsx'].includes(ext)) {
    const markers = ['import ', 'export ', 'function ', 'class ', 'const ', 'let ', 'var ', 'interface ', 'type ', 'async ', 'return ', 'module.exports', 'require('];
    return markers.some(marker => trimmed.includes(marker));
  }
  if (ext === '.py') {
    const markers = ['import ', 'def ', 'class ', 'from ', 'if ', 'for ', 'while '];
    return markers.some(marker => trimmed.includes(marker));
  }
  return /[{}[\]();=]/.test(trimmed) || /^(import|export|function|class|def |const |let |var |#include)\b/m.test(trimmed);
}

export function looksLikeCodeContent(content: string, filePath: string): boolean {
  const trimmed = content.trim();
  if (REASONING_PATTERNS.some(p => p.test(trimmed))) return false;
  if (/<<<<<<< SEARCH/.test(trimmed) && />>>>>>> REPLACE/.test(trimmed)) return true;
  if (looksLikePythonScript(trimmed)) return true;
  return looksLikeCodeByExtension(trimmed, path.extname(filePath).toLowerCase());
}

/**
 * Parse search-replace blocks from LLM output.
 * Format: <<<<<<< SEARCH\n...\n=======\n...\n>>>>>>> REPLACE
 */
export function parseSearchReplaceBlocks(output: string): SearchReplaceBlock[] {
  const blocks: SearchReplaceBlock[] = [];
  const regex = /<<<<<<< SEARCH\n([\s\S]*?)\n=======\n([\s\S]*?)\n>>>>>>> REPLACE/g;

  let match;
  while ((match = regex.exec(output)) !== null) {
    blocks.push({
      search: match[1],
      replace: match[2],
    });
  }

  return blocks;
}

/**
 * Apply search-replace blocks to the original file content.
 * Returns the modified content, or null if any search block failed to match.
 */
export function applySearchReplace(original: string, blocks: SearchReplaceBlock[]): string | null {
  let result = original;
  for (const block of blocks) {
    const next = applyOneBlock(result, block);
    if (next === null) return null;
    result = next;
  }
  return result;
}

function applyOneBlock(result: string, block: SearchReplaceBlock): string | null {
  const idx = result.indexOf(block.search);
  if (idx !== -1) {
    return result.substring(0, idx) + block.replace + result.substring(idx + block.search.length);
  }
  return applyNormalizedBlock(result, block);
}

function applyNormalizedBlock(result: string, block: SearchReplaceBlock): string | null {
  const normalizedResult = result.split('\n').map(l => l.trimEnd()).join('\n');
  const normalizedSearch = block.search.split('\n').map(l => l.trimEnd()).join('\n');
  const normalizedIdx = normalizedResult.indexOf(normalizedSearch);
  if (normalizedIdx === -1) {
    const preview = block.search.substring(0, 80).replaceAll('\n', String.raw`\n`);
    console.log(`[Code Gen Lib]   Search block not found (${preview}...)`);
    return null;
  }
  // The whole-line slice below is only correct when the normalized match spans
  // whole lines. A mid-line match would drop the line prefix before the match
  // (and the suffix after it), so reject it as not-found rather than corrupt the file.
  const matchEnd = normalizedIdx + normalizedSearch.length;
  const startAligned = normalizedIdx === 0 || normalizedResult[normalizedIdx - 1] === '\n';
  const endAligned = matchEnd === normalizedResult.length || normalizedResult[matchEnd] === '\n';
  if (!startAligned || !endAligned) {
    const preview = block.search.substring(0, 80).replaceAll('\n', String.raw`\n`);
    console.log(`[Code Gen Lib]   Search block matched mid-line, rejecting (${preview}...)`);
    return null;
  }
  const linesBeforeMatch = normalizedResult.substring(0, normalizedIdx).split('\n').length - 1;
  const searchLineCount = block.search.split('\n').length;
  const originalLines = result.split('\n');
  const before = originalLines.slice(0, linesBeforeMatch).join('\n');
  const after = originalLines.slice(linesBeforeMatch + searchLineCount).join('\n');
  return before + (before ? '\n' : '') + block.replace + (after ? '\n' : '') + after;
}

/**
 * Strip LLM reasoning/thinking text that appears before actual code.
 * Only activates when the first non-empty line looks like natural language prose,
 * then finds the first code-like line and drops everything before it.
 */
export function stripReasoningPreamble(content: string): string {
  const lines = content.split('\n');

  const firstNonEmpty = lines.findIndex(l => l.trim().length > 0);
  if (firstNonEmpty < 0) return content;

  const firstLine = lines[firstNonEmpty].trimStart();

  const looksLikeProse = PROSE_PATTERN.test(firstLine) && !CODE_KEYWORD_PATTERN.test(firstLine);
  if (!looksLikeProse) return content;

  const codeStartIdx = lines.findIndex((line, idx) => {
    if (idx <= firstNonEmpty) return false;
    const trimmedLine = line.trimStart();
    if (trimmedLine.length === 0) return false;
    return CODE_START_PATTERNS.some(p => p.test(trimmedLine));
  });

  if (codeStartIdx > 0) {
    const stripped = lines.slice(codeStartIdx).join('\n');
    console.log(`[Code Gen Lib]   Stripped ${codeStartIdx} line(s) of LLM reasoning preamble`);
    return stripped;
  }

  return content;
}

/**
 * Parse raw LLM output for a single file.
 * Strips markdown code fences and delimiter format if the LLM added them,
 * then drops any reasoning preamble.
 */
export function parseSingleFileContent(rawOutput: string): string {
  let content = rawOutput.trim();

  const codeBlockMatch = /^```(?:\w+)?\n([\s\S]*?)\n```$/.exec(content);
  if (codeBlockMatch) {
    content = codeBlockMatch[1];
  }

  const fileMatch = /^=== FILE:.*===\n(?:PURPOSE:.*\n)?--- CONTENT START ---\n([\s\S]*?)\n--- CONTENT END ---/
    .exec(content);
  if (fileMatch) {
    content = fileMatch[1];
  }

  content = stripReasoningPreamble(content);

  const trimmed = content.trim();
  // Re-append a single trailing newline (POSIX text-file convention) when content is non-empty.
  // The .trim() calls above strip any newline the LLM emitted; this restores it so the
  // resulting file passes eol-last lint and behaves correctly under `git diff`.
  return trimmed.length > 0 ? trimmed + '\n' : trimmed;
}

/**
 * Strip a leading opening-fence line (```lang) and a trailing lone ``` line,
 * anchored to the FIRST/LAST line only — never global-strips backticks, which
 * would corrupt an interior template literal. Line-anchored (promoted from the
 * test-gen continuation assembler); safe for the first-gen parser.
 */
export function stripDanglingFences(content: string): string {
  const lines = content.split('\n');
  if (lines.length > 0 && /^```[\w-]*\s*$/.test(lines[0])) lines.shift();
  if (lines.length > 0 && /^```\s*$/.test(lines[lines.length - 1])) lines.pop();
  return lines.join('\n');
}

/** Index of the first line after `from` whose trimmed form matches `re`, or -1. Linear. */
function firstMatchAfter(lines: string[], from: number, re: RegExp): number {
  for (let i = from + 1; i < lines.length; i++) {
    if (re.test(lines[i].trim())) return i;
  }
  return -1;
}

/**
 * Extract the first fenced code block even when wrapped in preamble/prose, via a
 * LINEAR line scan (NOT a lazy `[\s\S]*?` regex — that is the Sonar S8786
 * quadratic hazard on a never-closing/truncated fence). Returns the inner content,
 * or null when there is no wrapping fence. A missing closing fence (truncated CLI
 * output) yields everything after the opening fence. Interior fences (real code
 * before the fence) are left alone.
 */
function extractFencedBlock(content: string): string | null {
  const lines = content.split('\n');
  const openIdx = lines.findIndex(l => /^```[\w-]*$/.test(l.trim()));
  // No fence, or only a trailing dangling fence (let stripDanglingFences handle it).
  if (openIdx < 0 || openIdx === lines.length - 1) return null;
  // A fence preceded by real code is an interior fence (e.g. a markdown string in
  // the test body), not a wrapper — do not slice it out.
  const codeBeforeFence = lines.slice(0, openIdx).some(l => {
    const t = l.trimStart();
    return t.length > 0 && CODE_START_PATTERNS.some(p => p.test(t));
  });
  if (codeBeforeFence) return null;
  // The wrapper close is the FIRST bare ``` after the open (MG-2) — not the last,
  // so a trailing fenced note or a second block is not swallowed. If there is no
  // bare close, fall back to the first LANGUAGE-TAGGED close (NEW-1: ```js); this
  // stays dormant whenever a bare close exists, so it never mis-slices a nested
  // tagged opener in the body. If neither exists (truncated output), take
  // everything after the open (unchanged).
  let closeIdx = firstMatchAfter(lines, openIdx, /^```\s*$/);
  if (closeIdx < 0) closeIdx = firstMatchAfter(lines, openIdx, /^```[\w-]+\s*$/);
  const inner = closeIdx > openIdx ? lines.slice(openIdx + 1, closeIdx) : lines.slice(openIdx + 1);
  return inner.join('\n');
}

// Leading-preamble shapes the CLI adds that the narrow PROSE_PATTERN misses.
const FIRST_GEN_PREAMBLE_PATTERNS: RegExp[] = [
  PROSE_PATTERN,                                            // "Here is...", "The following..."
  /^#{1,6}\s/,                                              // markdown heading
  /^[-*+]\s/,                                               // bullet list
  /^\d+[.)]\s/,                                             // numbered list
  /^I\b/,                                                   // "I'll"/"I've"/"I will" (apostrophe defeats PROSE_PATTERN)
  /^(here|let|sure|okay|ok|now|below|following|looking|based)\b/i, // lowercase conversational openers
];

/**
 * First-gen preamble strip: like stripReasoningPreamble but with broader leading-
 * prose detection. Still guarded by CODE_KEYWORD_PATTERN (a real code line is never
 * treated as prose) and still requires a subsequent code-start line to strip, so it
 * only ever removes leading natural-language lines.
 */
function stripFirstGenPreamble(content: string): string {
  const lines = content.split('\n');
  const firstNonEmpty = lines.findIndex(l => l.trim().length > 0);
  if (firstNonEmpty < 0) return content;
  const firstLine = lines[firstNonEmpty].trimStart();
  const looksLikePreamble =
    FIRST_GEN_PREAMBLE_PATTERNS.some(p => p.test(firstLine)) && !CODE_KEYWORD_PATTERN.test(firstLine);
  if (!looksLikePreamble) return content;
  const codeStartIdx = lines.findIndex((line, idx) => {
    if (idx <= firstNonEmpty) return false;
    const trimmedLine = line.trimStart();
    if (trimmedLine.length === 0) return false;
    return CODE_START_PATTERNS.some(p => p.test(trimmedLine));
  });
  if (codeStartIdx > 0) {
    console.log(`[Code Gen Lib]   Stripped ${codeStartIdx} line(s) of LLM preamble (first-gen)`);
    return lines.slice(codeStartIdx).join('\n');
  }
  return content;
}

/**
 * Hardened FIRST-GENERATION single-file parser for CLI output that can carry a
 * leading preamble, a markdown fence, and/or trailing prose (which the anchored
 * parseSingleFileContent misses). MUST NOT be used on continuation chunks: the
 * broadened preamble strip would eat a mid-construct resumed line (M3a). Those keep
 * parseSingleFileContent (code-gen continuation) / parseContinuationChunk (test-gen).
 */
export function parseFirstGenFileContent(rawOutput: string): string {
  let content = rawOutput.trim();

  const fenced = extractFencedBlock(content);
  if (fenced !== null) content = fenced;

  const fileMatch = /^=== FILE:.*===\n(?:PURPOSE:.*\n)?--- CONTENT START ---\n([\s\S]*?)\n--- CONTENT END ---/
    .exec(content);
  if (fileMatch) content = fileMatch[1];

  content = stripFirstGenPreamble(content);
  content = stripDanglingFences(content);

  const trimmed = content.trim();
  return trimmed.length > 0 ? trimmed + '\n' : trimmed;
}
