import { CodeGenModuleInput } from '../../interface';
import { PlanItem } from '../../lib/plan';
import { getArchPatternsSection } from '../../lib/arch-patterns';

/**
 * Execute-phase prompt for the claude-code-cli module's tool-using agent.
 *
 * Intentionally short. The CLI plans internally using its tools; the prompt sets
 * the goal, lists the approved plan, restates the architectural patterns, and
 * defines the output format. No per-file delimiters — the CLI does Read/Edit/Write
 * tool calls directly against the workspace.
 */
export function buildExecutePrompt(input: CodeGenModuleInput, plan: PlanItem[]): string {
  const { ticket } = input;
  const archPatterns = getArchPatternsSection(ticket.issue.technical_context.domain);
  const targetDirectory = input.targetDirectory ?? '<cht-core>';

  return `You are inside the cht-core workspace at \`${targetDirectory}\`. You have full Read, Write, Edit, Grep, and Glob tool access. Bash is disabled.

## Task
${ticket.issue.title}

${ticket.issue.description}

## Requirements
${ticket.issue.requirements.map((r, i) => `${i + 1}. ${r}`).join('\n')}

## Acceptance Criteria
${ticket.issue.acceptance_criteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}

## Approved Plan
${plan.map((p, i) => `${i + 1}. ${p.action} ${p.filePath} — ${p.rationale}`).join('\n')}

${archPatterns}

## Plan Adherence (STRICT)
You MUST implement EXACTLY the files listed in the Approved Plan above:
- For each MODIFY plan item, you MUST use \`Edit\` on that file.
- For each CREATE plan item, you MUST use \`Write\` to that path.
- Do NOT add files OUTSIDE the plan.
- Do NOT skip plan items.
- If a plan item turns out unnecessary or wrong, note it in the final JSON summary's \`summary\` field; do NOT touch the file.
- If you discover a required file that is missing from the plan, note it in the final summary's \`summary\` field; do NOT add it. The user will re-plan.

## Implementation Instructions
- Use \`Read\` to examine existing files before modifying them. Always read sibling files (services, components, templates) that interact with your changes.
- Use \`Grep\` to find callers of any function you modify. Update every caller when changing a public method's signature.
- Use \`Edit\` for surgical changes; reserve \`Write\` for new files only.
- Match the existing code style of each file (indentation, quotes, imports).
- End every file with a single trailing newline (POSIX text-file convention).
- If a permission name, type, or constant must match across files, prefer a single source of truth (constants module) and reference it everywhere. Do NOT invent string literals that diverge across files.

## Output
After completing all edits, output a brief JSON summary on the final line:
\`\`\`json
{
  "files_modified": ["path/to/file1", "path/to/file2"],
  "files_created": ["path/to/new1"],
  "summary": "One-paragraph description of what you did and why."
}
\`\`\`

Do not commit. Do not run shell commands. Only Read/Write/Edit/Grep/Glob.`;
}

/**
 * R17/v7: relaxed retry prompt for the abstain case. Invoked when the STRICT
 * execute pass produced zero file edits on a non-empty plan. Lowers the bar
 * for "I am uncertain" so the LLM ships a best-effort draft the human can
 * judge at HC2 instead of nothing.
 *
 * Keeps the scope contract: still no files outside the plan. The HC2 banner
 * surfaces uncertainty to the user.
 */
export function buildRelaxedExecutePrompt(input: CodeGenModuleInput, plan: PlanItem[]): string {
  const { ticket } = input;
  const archPatterns = getArchPatternsSection(ticket.issue.technical_context.domain);
  const targetDirectory = input.targetDirectory ?? '<cht-core>';

  return `You are inside the cht-core workspace at \`${targetDirectory}\`. You have full Read, Write, Edit, Grep, and Glob tool access. Bash is disabled.

## Task
${ticket.issue.title}

${ticket.issue.description}

## Requirements
${ticket.issue.requirements.map((r, i) => `${i + 1}. ${r}`).join('\n')}

## Acceptance Criteria
${ticket.issue.acceptance_criteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}

## Approved Plan
${plan.map((p, i) => `${i + 1}. ${p.action} ${p.filePath} — ${p.rationale}`).join('\n')}

${archPatterns}

## Plan Adherence (GUIDANCE)
Your earlier attempt at this ticket read the relevant files but did not write any edits.
You are getting a second chance with relaxed rules:

- Make best-effort changes for each plan item. Stay within the listed files.
- If you are uncertain about an exact edit, write your best guess and explain the
  uncertainty in the JSON summary's \`summary\` field.
- The human reviewer will judge the quality at HC2. Producing nothing is worse than
  producing an imperfect first draft they can refine.
- Still: do NOT add files outside the plan. Do NOT skip files in the plan unless you
  document the reason in the summary.

## Implementation Instructions
- Use \`Read\` to examine existing files before modifying them.
- Use \`Grep\` to find callers of any function you modify.
- Use \`Edit\` for surgical changes; reserve \`Write\` for new files only.
- Match the existing code style of each file.
- End every file with a single trailing newline.

## Output
After completing edits, output a brief JSON summary on the final line:
\`\`\`json
{
  "files_modified": ["path/to/file1"],
  "files_created": ["path/to/new1"],
  "summary": "One paragraph: what you did, why, and any uncertainty the human should know about."
}
\`\`\`

Do not commit. Do not run shell commands. Only Read/Write/Edit/Grep/Glob.`;
}
