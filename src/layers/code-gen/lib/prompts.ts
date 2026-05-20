import { CodeGenModuleInput, ContextFile, GeneratedFile } from '../interface';
import { PlanItem } from './plan';
import { FileManifest, buildManifestSection } from './file-manifest';
import { isLargeFile } from './large-file';
import { extractPublicSurface } from './public-surface';
import { getArchPatternsSection } from './arch-patterns';

/** Extract validation feedback from external context files (used by plan and per-file prompts). */
export function extractValidationFeedback(contextFiles: ReadonlyArray<ContextFile>): string {
  return contextFiles
    .filter(f => f.source === 'external')
    .map(f => f.content)
    .join('\n');
}

function formatNumberedList(items: ReadonlyArray<string>): string {
  return items.map((item, i) => `${i + 1}. ${item}`).join('\n');
}

/**
 * Build a structural summary of a JSON file for the LLM.
 * Shows top-level keys, their types, and nested key names — enough to
 * understand where to insert/modify without dumping the entire file.
 */
export function buildJsonStructureSummary(content: string): string {
  try {
    const data = JSON.parse(content);
    const lines: string[] = ['```', 'JSON structure (top-level keys):'];

    const summarizeValue = (val: unknown, depth: number = 0): string => {
      const indent = '  '.repeat(depth);
      if (val === null) return 'null';
      if (typeof val !== 'object') return `${typeof val}: ${JSON.stringify(val).substring(0, 60)}`;
      if (Array.isArray(val)) {
        if (val.length === 0) return '[]';
        const first = typeof val[0] === 'object' ? '{...}' : JSON.stringify(val[0]).substring(0, 40);
        return `[ ${val.length} items, first: ${first} ]`;
      }
      const obj = val as Record<string, unknown>;
      const keys = Object.keys(obj);
      if (keys.length === 0) return '{}';
      if (depth >= 2) return `{ ${keys.length} keys: ${keys.slice(0, 5).join(', ')}${keys.length > 5 ? ', ...' : ''} }`;
      const entries = keys.slice(0, 15).map(k => {
        return `${indent}  "${k}": ${summarizeValue(obj[k], depth + 1)}`;
      });
      const more = keys.length > 15 ? `\n${indent}  ... (${keys.length - 15} more keys)` : '';
      return `{\n${entries.join('\n')}${more}\n${indent}}`;
    };

    lines.push(summarizeValue(data, 0), '```');
    return lines.join('\n');
  } catch {
    const fileLines = content.split('\n');
    return `\`\`\`\n${fileLines.slice(0, 100).join('\n')}\n... (${fileLines.length - 100} more lines)\n\`\`\``;
  }
}

/**
 * Build the LLM prompt that produces the implementation plan (file-list-only output).
 */
export function buildPlanPrompt(input: CodeGenModuleInput, manifest: FileManifest): string {
  const { ticket, orchestrationPlan, researchFindings, contextFiles } = input;

  const MAX_CONTEXT_BYTES = 64 * 1024;
  let existingCodeContext = '';
  let usedBytes = 0;
  let truncatedFileCount = 0;
  const feedbackContext = extractValidationFeedback(contextFiles);
  for (const file of contextFiles) {
    if (file.source !== 'workspace') continue;
    const lines = file.content.split('\n');
    const content = lines.length > 300
      ? lines.slice(0, 200).join('\n') + `\n... (${lines.length - 200} more lines)`
      : file.content;
    const section = `\n--- ${file.path} ---\n${content}\n`;
    if (usedBytes + section.length > MAX_CONTEXT_BYTES) {
      truncatedFileCount++;
      continue;
    }
    existingCodeContext += section;
    usedBytes += section.length;
  }
  if (truncatedFileCount > 0) {
    existingCodeContext +=
      `\n[NOTE: ${truncatedFileCount} file(s) omitted to fit a ` +
      `${Math.floor(MAX_CONTEXT_BYTES / 1024)} KiB context budget. ` +
      `Files are ranked by relevance; omitted entries are the least relevant.]\n`;
  }

  const manifestSection = buildManifestSection(manifest);

  let repoMapSection = '';
  if (input.directoryListing) {
    repoMapSection = `## Repository File Listing
These files exist in the relevant cht-core directories. Use this to identify files to MODIFY or directories for CREATE.

${input.directoryListing}
`;
  }

  return `You are a CHT (Community Health Toolkit) developer. Create an implementation plan for the feature below.

## Issue Details
Title: ${ticket.issue.title}
Type: ${ticket.issue.type}
Domain: ${ticket.issue.technical_context.domain}

Description:
${ticket.issue.description}

Requirements:
${ticket.issue.requirements.map((r, i) => `${i + 1}. ${r}`).join('\n')}

Acceptance Criteria:
${ticket.issue.acceptance_criteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}

## Orchestration Plan
Recommended Approach: ${orchestrationPlan.recommendedApproach}

Phases:
${orchestrationPlan.phases.map((p, i) => `${i + 1}. ${p.name}: ${p.description}`).join('\n')}

## Documentation References
${researchFindings.suggestedApproaches.map((a) => `- ${a}`).join('\n')}

${getArchPatternsSection(ticket.issue.technical_context.domain)}
${manifestSection}

${repoMapSection}
## Existing Code Context
${existingCodeContext || 'No existing code context available'}
${feedbackContext ? `
## Validation Feedback from Previous Iteration
The previous code generation attempt was validated and found lacking. Address ALL issues below in your revised plan:
${feedbackContext}
` : ''}
## Instructions
List every file you will modify or create as a numbered TODO list.
Use MODIFY for existing files and CREATE for new files.
You are NOT limited to the files listed above — if the feature requires changes to other files (e.g. permission configs, shared settings, app_settings), include them.
Keep the plan focused — only include source files essential for this feature. Do NOT include test files (*.spec.ts, *.spec.js, *.test.ts, *.test.js) in the plan — test generation is handled by a separate agent.
Each item MUST have a clear rationale explaining what changes are needed.

## Plan Completeness Self-Check
After listing your files, verify the plan is complete:
- If you add a Selector that reads \`state.X\`, you MUST also include the Reducer that writes X and the Action method that triggers it.
- If you call \`this.someActions.foo(...)\` in an Effect or Component, you MUST include the Action file that declares foo.
- If you bind a field in a Template, you MUST include the Component class that declares it.
- If you add a permission to app_settings.json, you MUST add its description key to api/resources/translations/messages-en.properties.
- If any check fails, ADD the missing file to your plan before emitting it.

## Caller coverage
If your plan modifies a function or method signature (new parameters, even optional; changed return type; renamed method), you MUST include EVERY caller in the plan.
- Use the "Repository File Listing" above to identify likely callers.
- For TypeScript methods on a service class, search for \`someService.methodName(\` patterns in the context.
- Add each caller as a MODIFY plan item with the rationale "update call site to pass new <param>".
- A new optional parameter that gates a code path is functionally required; omitting callers means the feature is disabled.

Use this EXACT format (do NOT wrap file paths in backticks):

=== PLAN ===
1. MODIFY path/to/existing/file.ts - What changes are needed and why
2. CREATE path/to/new/file.ts - What this new file does
=== END PLAN ===

Output ONLY the plan section. Do not generate any file content.`;
}

/**
 * Build a minimal prompt for large JSON file modifications.
 * Only includes the task, JSON structure, and Python instructions.
 */
export function buildLargeJsonPrompt(
  planItem: PlanItem,
  originalContentMap: Map<string, string>,
  previousFailures?: string[],
): string {
  const original = originalContentMap.get(planItem.filePath)!;
  const structureSummary = buildJsonStructureSummary(original);

  let prompt = `Write a Python script to modify the JSON file: ${planItem.filePath}

## Task
${planItem.rationale}

## JSON Structure (${original.split('\n').length} lines)
${structureSummary}`;

  if (previousFailures && previousFailures.length > 0) {
    prompt += `

## PREVIOUS ATTEMPT FAILED
${previousFailures.map(f => `- ${f}`).join('\n')}
Fix these issues.`;
  }

  prompt += `

## Instructions
Write a Python script. It will be called as: python3 script.py <path-to-json-file>

The script must:
1. Read the JSON file from sys.argv[1]
2. Parse with json.load()
3. Make the modifications described above
4. Write back with json.dump(data, f, indent=2, ensure_ascii=False)
5. Use only standard library (json, sys)

Output ONLY valid Python. No markdown, no explanations. Start with import statements.`;

  return prompt;
}

export interface BuildSingleFilePromptOpts {
  planItem: PlanItem;
  fullPlan: PlanItem[];
  input: CodeGenModuleInput;
  originalContentMap: Map<string, string>;
  previouslyGenerated: GeneratedFile[];
  previousFailures?: string[];
}

/**
 * Build the prompt for generating a single file.
 * Includes the full plan for context, original content for MODIFY,
 * and summaries of previously generated files for coherence.
 */
export function buildSingleFilePrompt(opts: BuildSingleFilePromptOpts): string {
  const { planItem, fullPlan, input, originalContentMap, previouslyGenerated, previousFailures } = opts;
  const { ticket, researchFindings } = input;

  const isLarge = isLargeFile(planItem, originalContentMap);
  const isJson = planItem.filePath.endsWith('.json');
  if (isJson) {
    const hasContent = originalContentMap.has(planItem.filePath);
    const lineCount = hasContent ? originalContentMap.get(planItem.filePath)!.split('\n').length : 0;
    console.log(`[Code Gen Lib]   JSON prompt check: path=${planItem.filePath} hasContent=${hasContent} lines=${lineCount} isLarge=${isLarge} action=${planItem.action}`);
  }
  if (isLarge && isJson && planItem.action === 'MODIFY') {
    return buildLargeJsonPrompt(planItem, originalContentMap, previousFailures);
  }

  const planSummary = fullPlan
    .map((p, i) => `${i + 1}. ${p.action} ${p.filePath} — ${p.rationale}`)
    .join('\n');

  let prompt = `You are a CHT (Community Health Toolkit) developer. Generate the complete code for ONE file.

## Implementation Plan (full context — you are generating one file from this plan)
${planSummary}

## Current Task
File: ${planItem.filePath}
Action: ${planItem.action}
Task: ${planItem.rationale}

## Issue Details
Title: ${ticket.issue.title}
Type: ${ticket.issue.type}
Domain: ${ticket.issue.technical_context.domain}

Description:
${ticket.issue.description}

Requirements:
${formatNumberedList(ticket.issue.requirements)}

Acceptance Criteria:
${formatNumberedList(ticket.issue.acceptance_criteria)}

## Documentation References
${researchFindings.suggestedApproaches.map((a) => `- ${a}`).join('\n')}`;

  const feedback = extractValidationFeedback(input.contextFiles);
  if (feedback) {
    prompt += `

## Validation Feedback from Previous Iteration
The previous attempt at generating this code was validated and found lacking. Address ALL issues below:
${feedback}`;
  }

  if (planItem.action === 'MODIFY') {
    const original = originalContentMap.get(planItem.filePath);
    if (original) {
      if (isLarge) {
        prompt += `

## Original File Content (${original.split('\n').length} lines — output ONLY search-replace blocks, NOT the full file)
\`\`\`
${original}
\`\`\``;
      } else {
        prompt += `

## Original File Content (you must output the COMPLETE modified version)
\`\`\`
${original}
\`\`\``;
      }
    }
  }

  if (previouslyGenerated.length > 0) {
    prompt += `

## Previously Generated Files (PUBLIC API SURFACE — these are the exact identifier names you MUST reference)`;
    for (const prev of previouslyGenerated) {
      const surface = extractPublicSurface(prev.path, prev.content);
      prompt += `
### ${prev.path}${prev.purpose ? ` — ${prev.purpose}` : ''}
\`\`\`
${surface}
\`\`\``;
    }
  }

  if (previousFailures && previousFailures.length > 0) {
    prompt += `

## PREVIOUS ATTEMPT FAILED
Your previous output for this file failed these checks:
${previousFailures.map(f => `- ${f}`).join('\n')}
Fix these specific issues. Do not repeat the same mistakes.`;
  }

  if (previouslyGenerated.length > 0) {
    prompt += `

## Cross-File Contract Verification
Before emitting your file, verify EVERY identifier you reference from a sibling plan item exists in that sibling's PUBLIC API SURFACE shown above. Specifically:

- For every \`Selectors.X\` you reference: \`X\` MUST appear in the surface of a selectors/*.ts file shown above, OR in the existing selectors/index.ts that is already loaded as workspace context.
- For every \`this.\${anything}Actions.X(...)\` call: the method \`X\` MUST appear in the surface of the corresponding actions/*.ts file shown above.
- For every component class field referenced from a *.component.html template: it MUST be a declared field/method in the *.component.ts shown above.
- For every imported symbol from an \`@mm-*\` path: it MUST appear in the surface of the corresponding file shown above (if that file is in this plan).

If you cannot find a sibling identifier you need, do NOT invent a name. Either:
1. Use an existing identifier that already does the job, OR
2. Choose a name that matches the surface you DO see, OR
3. Stop and add a single-line comment at the top of your file: \`// REVIEW: missing sibling identifier <name> in <expected-file>\`. The cross-file validator will catch this and trigger a retry with feedback.
`;
  }

  prompt += `

## Code Style (cht-core conventions)
- Indentation: 2 spaces, no tabs.
- Quotes: single quotes in TypeScript; double quotes in JSON and HTML attributes.
- Semicolons: required in TypeScript.
- File ends with a single trailing newline (LF).
- Imports: use the existing path aliases (@mm-actions, @mm-services, @mm-selectors, etc.); do not write relative paths to those directories. Group imports by source: Angular core, ngrx, rxjs, third-party, then @mm-* path aliases. Leave a blank line between groups.
- For Angular components/services: prefer constructor dependency injection over field initialization.
- For NgRx selectors: use \`createSelector\` from @ngrx/store; do not write raw memoized functions.

## Scope discipline
Make the SMALLEST change that satisfies the ticket. Specifically:
- Do NOT add [attr.test-id], data-testid, or other test scaffolding unless the ticket explicitly requests test coverage.
- Do NOT introduce helper methods, refactors, or "improvements" outside the ticket's stated requirements.
- Do NOT add extra debug attributes or logging.
- Do NOT add comments speculating about "future work" or alternative implementations.
The reviewer should be able to read your diff and explain every line in terms of a specific requirement or acceptance criterion. If you cannot, drop the line.
`;

  // File-specific hints, conditional on filePath patterns.
  if (planItem.filePath.endsWith('app_settings.json')) {
    prompt += `

## Permission roles hint
When adding a permission to the "permissions" object, you MUST provide a non-empty roles array. Look at similar existing permissions in the file (especially those starting with the same prefix, e.g., \`can_create_*\`) and mirror their role assignments. Common roles for "can_create_*" are: ["nurse", "chw_supervisor", "data_entry"] or whatever the closest existing permission uses. An empty array effectively disables the permission for everyone, which is a backward-incompatible default. Do NOT emit \`[]\`.

## Permission placement hint
The "permissions" object is alphabetically sorted by key. When adding entries:
- Identify the alphabetical position where each new key belongs.
- INSERT the new entry at that position, not at the end of the object.
- Example: a new permission \`can_create_people_on_muted_contacts\` goes between \`can_create_people\` and \`can_create_places\`, NOT after the last permission in the file.
- If you cannot determine the position from the visible file content, output the file with the new entry at the position you believe is correct; do NOT default to appending.
`;
  }

  if (planItem.filePath.endsWith('xml-forms.service.ts')) {
    prompt += `

## Lineage-aware muted hint
If you need to check whether a contact is muted, use \`ContactMutedService.getMuted(doc, lineage)\` (already imported elsewhere in this codebase). You MUST pass BOTH \`doc\` AND \`lineage\` — although \`lineage\` is type-optional, omitting it misses ancestor-muted contacts. NEVER check \`doc.muted\` directly. If you need to inject \`ContactMutedService\`, add it to the constructor with the @mm-services/contact-muted.service path alias and add a corresponding import statement.
`;
  }

  if (planItem.filePath.includes('/effects/')) {
    prompt += `

## Effect hints
- If the effect needs to check whether a contact is muted, inject \`ContactMutedService\` and call \`getMuted(doc, lineage)\`. Do NOT duplicate the muted check logic inside the effect.
- Action method calls must use the exact method name declared in the corresponding actions/*.ts file. The Cross-File Contract Verification section above lists the available names.
`;
  }

  if (isLarge) {
    prompt += `

## Instructions
This file is too large to output in full. Output ONLY the surgical edits using this EXACT format:

<<<<<<< SEARCH
exact lines from the original file to locate the edit point
(include enough surrounding context for unique matching)
=======
the replacement lines (what should replace the SEARCH block)
>>>>>>> REPLACE

Rules:
- Each SEARCH block must match EXACTLY in the original file (whitespace-sensitive).
- Include 2-3 unchanged context lines before/after the actual change for unique matching.
- You may output multiple SEARCH/REPLACE blocks for multiple changes.
- For insertions, the SEARCH block is the context lines where the new content goes; the REPLACE block includes those same lines PLUS the new content.
- Do NOT output the full file. Do NOT wrap in markdown code fences.
- Do NOT include any explanations, commentary, or thinking outside of the SEARCH/REPLACE blocks.
- NEVER say "I'm unable to", "Could you provide", or ask questions. You have the full file above — use it.
- Start your output DIRECTLY with <<<<<<< SEARCH — nothing before it.`;
  } else {
    prompt += `

## Instructions
Generate the COMPLETE content for ${planItem.filePath}.
${planItem.action === 'MODIFY' ? 'Output the COMPLETE modified file (not just the diff). Include ALL original code with your modifications applied.' : 'Output the full new file content.'}
End the file with a single trailing newline character (POSIX text-file convention).
If you add a constructor dependency, you MUST also add the matching \`import\` statement at the top of the file using the @mm-* path alias. Constructor injection without an import is a compile error.
Output ONLY the raw file content. Do NOT wrap in markdown code fences.
Do NOT include any explanations, comments outside the file, file path headers, or delimiters.
NEVER say "I'm unable to", "Could you provide", or ask questions. Just output the code.`;
  }

  return prompt;
}

/**
 * Build a continuation prompt for when a file's generation was truncated.
 */
export function buildContinuationPrompt(
  lastLines: string,
  planItem: PlanItem,
  input: CodeGenModuleInput,
): string {
  return `You were generating the file ${planItem.filePath} for the CHT project but your output was truncated.

Issue: ${input.ticket.issue.title}

Here are the last 50 lines of what you generated so far:
\`\`\`
${lastLines}
\`\`\`

Continue generating from EXACTLY where you left off.
Do NOT repeat any of the lines shown above.
Output ONLY the remaining file content — no markdown fences, no delimiters, no explanations.`;
}
