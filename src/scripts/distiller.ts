/**
 * Distiller stage for the memory pipeline.
 *
 * Takes a ScrapedPR that passed the filter stage (decision === 'distill') and
 * produces a schema-valid knowledge draft in agent-memory/_pending/<domain>/.
 *
 * Uses a stronger model than filter (sonnet vs haiku) because it generates
 * content rather than classifying — quality matters more than latency here.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as yaml from 'js-yaml';
import { ChatAnthropic } from '@langchain/anthropic';
import { ChatOpenAI } from '@langchain/openai';
import { createStructuredCliChain, isUsingCLIProvider } from '../llm/structured-cli';
import { isBatchFatalError } from '../llm/rate-limit';
import { DOMAIN_EXAMPLES, DOMAIN_PITFALLS } from '../utils/domain-inference';
import { z } from 'zod';
import type {
  ScrapedPR,
  DistillDraft,
  DistillResult,
  DistillOptions,
  SkipLogEntry,
} from '../types/pipeline';
import { CHT_DOMAINS, CHT_SERVICES, CHT_WORKFLOWS, DEFAULT_PIPELINE_LOG_PATH, DEFAULT_PIPELINE_OUTPUT_DIR } from '../constants';
import { buildValidator } from './schema-utils';
import { hallucinationRate } from './reconcile';


// Compiled once — the same validator open-review-pr re-runs before promotion.
// Validating here means malformed drafts never reach committed _pending/.
const validateFrontmatter = buildValidator();

const DEFAULT_DISTILL_MODEL = 'anthropic/claude-sonnet-4-5';
const ANTHROPIC_DISTILL_MODEL = 'claude-sonnet-4-5-20251015';

/** Max chars of PR body to send (generous — distiller needs more context than triage) */
const BODY_LIMIT = 4000;
/** Max chars of each linked issue body */
const ISSUE_BODY_LIMIT = 500;
/**
 * Raised issue-body budget granted when the PR body is near-empty (e.g. a bare
 * "Fixes #N"), so a near-empty PR whose detail lives entirely in the issue
 * doesn't lose its root-cause mechanism to truncation (cht-core issue #10912 /
 * memory 10914).
 */
const ISSUE_BODY_LIMIT_EXPANDED = 2000;
/** A PR body at or below this length is treated as "near-empty" for the adaptive issue-body limit. */
const NEAR_EMPTY_BODY_THRESHOLD = 100;
/** Max linked issues to include */
const MAX_ISSUES = 3;
/** Max review comments to include */
const MAX_REVIEWS = 3;
const REVIEW_BODY_LIMIT = 300;

const draftSchema = z.object({
  domain: z.enum(CHT_DOMAINS),
  domainFit: z.enum(['strong', 'weak']),
  domainReasoning: z.string().min(1),
  title: z.string().min(1).max(200),
  category: z.enum(['bug', 'feature', 'improvement']),
  summary: z.string().min(1),
  services: z.array(z.enum(CHT_SERVICES)).min(1),
  techStack: z.array(z.string().min(1)).min(1),
  tags: z.array(z.string()),
  relatedWorkflows: z.array(z.enum(CHT_WORKFLOWS)),
  entities: z.array(z.string()),
  concepts: z.array(z.string()),
  problem: z.string().min(1),
  rootCause: z.string().min(1),
  solution: z.string().min(1),
  codePatterns: z.string(),
  designChoices: z.string(),
  relatedFiles: z.array(z.string()),
  testing: z.string(),
  relatedIssues: z.array(z.string()),
});

// Cached on first call — avoids recreating the client for each PR in a batch
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _distillChain: any;

// JSON shape appended to the prompt in CLI mode (no response_format channel).
// Mirrors draftSchema — keep the two in sync.
const DRAFT_SHAPE = `{
  "domain": ${CHT_DOMAINS.map(d => `"${d}"`).join(' | ')},
  "domainFit": "strong" | "weak",
  "domainReasoning": "<1-2 sentences: why this domain, and what made it weak if so>",
  "title": "<concise title ≤200 chars describing the change>",
  "category": "bug" | "feature" | "improvement",
  "summary": "<1-2 sentence summary of the problem and resolution>",
  "services": ["<one or more of: api, webapp, sentinel, admin>"],
  "techStack": ["<technologies touched, e.g. typescript, couchdb, angular>"],
  "tags": ["<tag>", ...],
  "relatedWorkflows": [<zero or more of: ${CHT_WORKFLOWS.join(', ')}>],
  "entities": ["<file or module path>", ...],
  "concepts": ["<architectural concept>", ...],
  "problem": "<what was wrong>",
  "rootCause": "<why it was wrong>",
  "solution": "<how it was fixed>",
  "codePatterns": "<reusable patterns, may be empty string>",
  "designChoices": "<design decisions, may be empty string>",
  "relatedFiles": ["<path>", ...],
  "testing": "<how the change was tested — tests added/modified, strategy; may be empty string>",
  "relatedIssues": ["#<issue>: <brief description>", ...]
}`;

// Build the API-mode chain: OpenRouter if its key is set, else Anthropic, else null.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createApiChain(): any {
  const openrouterKey = process.env.OPENROUTER_API_KEY;
  if (openrouterKey) {
    const llm = new ChatOpenAI({
      modelName: process.env.DISTILL_MODEL ?? DEFAULT_DISTILL_MODEL,
      maxTokens: 2000,
      configuration: { apiKey: openrouterKey, baseURL: 'https://openrouter.ai/api/v1' },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (llm as any).withStructuredOutput(draftSchema);
  }
  if (process.env.ANTHROPIC_API_KEY) {
    const llm = new ChatAnthropic({
      model: ANTHROPIC_DISTILL_MODEL,
      apiKey: process.env.ANTHROPIC_API_KEY,
      maxTokens: 2000,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (llm as any).withStructuredOutput(draftSchema);
  }
  return null;
}

// CLI mode runs on the operator's Claude subscription via `claude -p` (no API key,
// one model); it takes precedence over API keys when LLM_PROVIDER=claude-cli.
function getDistillChain() {
  if (_distillChain !== undefined) return _distillChain;
  _distillChain = isUsingCLIProvider()
    ? createStructuredCliChain(draftSchema, DRAFT_SHAPE)
    : createApiChain();
  return _distillChain;
}

/**
 * Build the distillation prompt from a ScrapedPR.
 * Truncates long fields to keep cost predictable.
 */
export function buildPrompt(pr: ScrapedPR): string {
  const body = (pr.prBody ?? '').slice(0, BODY_LIMIT);
  const fileList = pr.fileList.slice(0, 50).join('\n');

  // A near-empty PR body (often just "Fixes #N") puts all the real detail in
  // the linked issue — grant it a larger budget rather than truncating away
  // the root-cause mechanism.
  const issueBodyLimit = body.trim().length <= NEAR_EMPTY_BODY_THRESHOLD
    ? ISSUE_BODY_LIMIT_EXPANDED
    : ISSUE_BODY_LIMIT;

  const issueContext = pr.linkedIssues
    .slice(0, MAX_ISSUES)
    .map(i => `Issue #${i.number} (body excerpt):\n${i.body.slice(0, issueBodyLimit)}`)
    .join('\n\n');

  const reviewContext = pr.reviewComments
    .filter(r => r.body.trim().length > 0)
    .slice(0, MAX_REVIEWS)
    .map(r => `Review by ${r.author}:\n${r.body.slice(0, REVIEW_BODY_LIMIT)}`)
    .join('\n\n');

  return `You are a technical knowledge curator for the Community Health Toolkit (CHT) project.

Analyse this merged GitHub PR and produce a structured knowledge entry for the agent memory system.

The CHT has ${CHT_DOMAINS.length} functional domains — pick the most specific one that fits:
  ${CHT_DOMAINS.join(', ')}
${DOMAIN_EXAMPLES}
${DOMAIN_PITFALLS}
Set "domainFit" honestly: "strong" when the PR squarely belongs to the chosen
domain, "weak" when no domain is a principled match and you picked the least-bad
option. CI/build/deploy/upgrade-lifecycle work belongs to the "infrastructure"
domain (strong) — do not force such PRs into configuration. Explain the choice in
"domainReasoning" so a human reviewer can audit or re-bin the draft.

Set "relatedWorkflows" to the cross-domain workstreams this PR is part of —
choose zero or more from: ${CHT_WORKFLOWS.join(', ')}. Use it for work that
spans domains (e.g. UI extensions, Nouveau search, observability); [] if none.

PR #${pr.prNumber}: ${pr.prTitle}
Labels: ${pr.labels.join(', ') || 'none'}
Merge SHA: ${pr.mergeSha}

Files changed (${pr.fileList.length} total, showing up to 50):
${fileList}

PR body:
${body}
${issueContext ? `\nLinked issues:\n${issueContext}` : ''}
${reviewContext ? `\nReview comments:\n${reviewContext}` : ''}

Respond with a JSON object matching this structure exactly:
{
  "domain": "<one of the domains above>",
  "domainFit": "strong" | "weak",
  "domainReasoning": "<1 clean sentence naming the changed subsystem that makes this domain correct. Do NOT reference internal seeds/rules, other drafts, or hedging like 'a reviewer could re-bin'.>",
  "title": "<concise title ≤200 chars describing the change>",
  "category": "bug" | "feature" | "improvement",
  "summary": "<1-2 sentence summary of the problem and resolution>",
  "services": ["<one or more of: api, webapp, sentinel, admin>"],
  "techStack": ["<technologies touched, e.g. typescript, couchdb, angular>"],
  "tags": ["<tag1>", "<tag2>"],
  "relatedWorkflows": ["<0+ cross-domain workstreams this PR is part of, from the list above; [] if none>"],
  "entities": ["<file or module path, chosen only from the Files changed list above>"],
  "concepts": ["<architectural concept>"],
  "problem": "<what was wrong — symptoms, affected users, error messages>",
  "rootCause": "<the concrete mechanism — name the specific function, API misuse, or code path (e.g. 'Set.add(...keys) drops all but the first id because add() takes one argument'). If the mechanism is stated in the linked issue, reproduce it; do not paraphrase into vagueness.>",
  "solution": "<how it was fixed — approach and key changes>",
  "codePatterns": "<reusable patterns from this fix with file paths>",
  "designChoices": "<why this approach over alternatives, grounded only in the PR body, linked issues, or review comments above>",
  "relatedFiles": ["<path1 — chosen only from the Files changed list above>", "<path2>"],
  "testing": "<how the change was tested — tests added/modified, strategy; may be empty string>",
  "relatedIssues": ["#<issue>: <brief description>"]
}

CONSTRAINTS:
- "relatedFiles" and "entities" MUST be chosen only from the Files changed list above. Do not infer, guess, or invent paths. If a file is not in that list, do not include it.
- Do NOT mention communication channels (Slack, forum, etc.), reviewer usernames, approval status (LGTM/approved), number of review rounds, or one-off CI/environment/dependency issues unless they appear verbatim in the Review comments above. "testing" describes test strategy and coverage, not the review process.
- Classify by the changed subsystem (service/component/routing/i18n), not the user-facing surface. Route guards, modals, app-shell wiring, and translation-only changes are NOT forms-and-reports merely because they render through Enketo/forms UI — mark such PRs weak (or pick the more specific domain) and name the actual subsystem in "domainReasoning".`;
}

/**
 * Call the LLM to generate a DistillDraft from a ScrapedPR.
 * Returns a DistillDraft or throws — callers handle errors.
 *
 * @example
 * ```typescript
 * // Not called directly in tests — injected via opts.distillFn
 * ```
 */
async function llmDistill(pr: ScrapedPR): Promise<DistillDraft> {
  const chain = getDistillChain();

  if (!chain) {
    throw new Error('Distill LLM unavailable: no API key set (OPENROUTER_API_KEY or ANTHROPIC_API_KEY)');
  }

  const prompt = buildPrompt(pr);
  return await chain.invoke(prompt) as DistillDraft;
}

/**
 * Convert a string to a URL-safe kebab-case slug. Falls back to 'untitled'
 * when the input has no Latin alphanumerics (symbol-only or non-Latin titles),
 * so the caller never builds a danging filename like `42-.md`.
 *
 * @example
 * ```typescript
 * slugify('Fix: Prevent Duplicate Contact Creation'); // 'fix-prevent-duplicate-contact-creation'
 * slugify('日本語タイトル'); // 'untitled'
 * slugify('!!!'); // 'untitled'
 * ```
 */
export function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60);
  return slug || 'untitled';
}

/** Backport marker: a "(cherry picked from commit ...)" note or a trailing "(#NNNN)" title suffix. */
const BACKPORT_MARKER = /cherry[- ]?picked from commit|\(#\d+\)\s*$/i;

/**
 * Heuristic confidence gradient, replacing the previous hardcoded `'medium'`.
 * `'low'` when the draft's `relatedFiles` aren't all grounded in the PR's own
 * file list, or when the PR looks like a backport cherry-pick (which usually
 * duplicates an already-distilled fix); `'medium'` otherwise. `'high'` is
 * reserved for human-reviewed entries and is never set here.
 *
 * @example
 * ```typescript
 * computeConfidence({ relatedFiles: ['a.ts'] } as DistillDraft, { fileList: ['a.ts'], prBody: '', prTitle: '' } as ScrapedPR);
 * // 'medium'
 * computeConfidence({ relatedFiles: ['missing.ts'] } as DistillDraft, { fileList: ['a.ts'], prBody: '', prTitle: '' } as ScrapedPR);
 * // 'low'
 * ```
 */
export function computeConfidence(draft: DistillDraft, pr: ScrapedPR): 'medium' | 'low' {
  const grounded = draft.relatedFiles.every(f => pr.fileList.includes(f));
  if (!grounded) return 'low';
  if (BACKPORT_MARKER.test(pr.prBody) || BACKPORT_MARKER.test(pr.prTitle)) return 'low';
  return 'medium';
}

/**
 * Build the camelCase frontmatter object for a draft, matching agent-memory/schema.json.
 *
 * The pipeline is PR-driven but the schema is issue-centric, so issueNumber/issueUrl/id
 * are derived from the first (most authoritative) linked issue. PRs that close no
 * tracked issue are flagged for human triage in distillPR and never reach this
 * function, so a missing linked issue here is a programming error and throws.
 *
 * @example
 * ```typescript
 * const fm = buildFrontmatter(draft, pr);
 * // { id: 'cht-core-99', issueNumber: 99, lastUpdated: '2025-01-15', ... }
 * ```
 */
export function buildFrontmatter(draft: DistillDraft, pr: ScrapedPR): Record<string, unknown> {
  const today = new Date().toISOString().slice(0, 10);
  const issueNumber = pr.linkedIssues[0]?.number;
  if (issueNumber === undefined) {
    throw new Error(
      `buildFrontmatter requires a linked issue; PR #${pr.prNumber} has none ` +
        `(no-issue PRs are flagged upstream, not distilled)`
    );
  }

  return {
    id: `cht-core-${issueNumber}`,
    category: draft.category,
    domain: draft.domain,
    domainFit: draft.domainFit,
    issueNumber,
    issueUrl: `https://github.com/medic/cht-core/issues/${issueNumber}`,
    title: draft.title,
    lastUpdated: today,
    summary: draft.summary,
    services: draft.services,
    techStack: draft.techStack,
    tags: draft.tags,
    related_workflows: draft.relatedWorkflows,
    source_pr: `medic/cht-core#${pr.prNumber}`,
    source_sha: pr.mergeSha,
    distilled_at: today,
    reviewed_by: null,
    reviewed_at: null,
    confidence: computeConfidence(draft, pr),
    entities: draft.entities,
    concepts: draft.concepts,
    // Candidate agent-memory ids for the PR's other linked issues (beyond the
    // canonical one) — real, grounded cross-links from this PR's own linkage,
    // not yet verified to have a promoted memory entry. Distinct from the
    // GitHub issues listed in the draft body's ## Related Issues section.
    related_issues: pr.linkedIssues.slice(1).map(i => `cht-core-${i.number}`),
    stale: false,
  };
}

/**
 * Render a markdown draft from a frontmatter object and draft body.
 * Serializes frontmatter with js-yaml (correct quoting/escaping — no manual interpolation).
 */
function renderMarkdown(frontmatter: Record<string, unknown>, draft: DistillDraft): string {
  const yamlBlock = yaml.dump(frontmatter, { lineWidth: -1 }).trimEnd();

  const relatedFilesSection = draft.relatedFiles.length > 0
    ? draft.relatedFiles.map(f => `- ${f}`).join('\n')
    : '_none_';

  const testingSection = draft.testing.trim() || '_none_';

  const relatedIssuesSection = draft.relatedIssues.length > 0
    ? draft.relatedIssues.map(i => `- ${i}`).join('\n')
    : '_none_';

  return [
    '---',
    yamlBlock,
    '---',
    '',
    `## Problem`,
    '',
    draft.problem,
    '',
    `## Root Cause`,
    '',
    draft.rootCause,
    '',
    `## Solution`,
    '',
    draft.solution,
    '',
    `## Code Patterns`,
    '',
    draft.codePatterns,
    '',
    `## Design Choices`,
    '',
    draft.designChoices,
    '',
    `## Related Files`,
    '',
    relatedFilesSection,
    '',
    `## Testing`,
    '',
    testingSection,
    '',
    `## Related Issues`,
    '',
    relatedIssuesSection,
    '',
    `## Domain Rationale`,
    '',
    `**Fit:** ${draft.domainFit}`,
    '',
    draft.domainReasoning,
    '',
  ].join('\n');
}

/**
 * Assemble a schema-valid markdown string from a DistillDraft and PR metadata.
 *
 * @example
 * ```typescript
 * const md = assembleDraft(draft, { prNumber: 42, mergeSha: 'abc' } as ScrapedPR);
 * // md starts with '---\n' (YAML frontmatter)
 * ```
 */
export function assembleDraft(draft: DistillDraft, pr: ScrapedPR): string {
  return renderMarkdown(buildFrontmatter(draft, pr), draft);
}

/** Log a flag-for-human outcome to the audit log and return the result. */
async function flagForHuman(prNumber: number, reason: string, logPath: string): Promise<DistillResult> {
  const entry: SkipLogEntry = {
    prNumber,
    decision: 'flag-for-human',
    reason,
    timestamp: new Date().toISOString(),
  };
  await fs.promises.appendFile(logPath, JSON.stringify(entry) + '\n', 'utf8');
  return { status: 'flag-for-human', reason };
}

/** Format AJV validation errors into a single human-readable string. */
function formatAjvErrors(errors: Array<{ instancePath?: string; message?: string }> | null | undefined): string {
  return (errors ?? [])
    .map(e => `${e.instancePath || '(root)'} ${e.message ?? 'invalid'}`)
    .join('; ');
}

/** Resolve distill options with defaults. */
function resolveDistillOpts(opts: DistillOptions): {
  logPath: string;
  outputDir: string;
  distillFn: (pr: ScrapedPR) => Promise<DistillDraft>;
} {
  return {
    logPath: opts.logPath ?? DEFAULT_PIPELINE_LOG_PATH,
    outputDir: opts.outputDir ?? DEFAULT_PIPELINE_OUTPUT_DIR,
    distillFn: opts.distillFn ?? llmDistill,
  };
}

/** Handle a distill-stage error: re-throw global failures (batch stops), else flag-for-human. */
async function handleDistillError(err: unknown, prNumber: number, logPath: string): Promise<DistillResult> {
  if (isBatchFatalError(err)) throw err;
  return flagForHuman(prNumber, err instanceof Error ? err.message : `Distill failed: ${String(err)}`, logPath);
}

/**
 * Distill a scraped PR into a schema-valid knowledge draft.
 * Writes the draft to agent-memory/_pending/<domain>/<prNumber>-<slug>.md.
 * Never throws — failures return flag-for-human and write to _skipped.ndjson.
 *
 * @example
 * ```typescript
 * const result = await distillPR(pr, { distillFn: myMockFn });
 * // { status: 'written', outputPath: '.../_pending/contacts/42-fix-thing.md', reason: '...' }
 * ```
 */
export async function distillPR(
  pr: ScrapedPR,
  opts: DistillOptions = {}
): Promise<DistillResult> {
  const { logPath, outputDir, distillFn } = resolveDistillOpts(opts);

  // Issue-centric corpus: flag no-issue PRs for triage rather than aliasing the PR number.
  if (pr.linkedIssues.length === 0) {
    return flagForHuman(pr.prNumber, 'PR closes no tracked issue', logPath);
  }

  let draft: DistillDraft;
  try {
    draft = await distillFn(pr);
  } catch (err) {
    return handleDistillError(err, pr.prNumber, logPath);
  }

  // Validate frontmatter against schema.json before writing, so a malformed
  // draft is logged and skipped rather than committed to _pending/.
  const frontmatter = buildFrontmatter(draft, pr);
  if (!validateFrontmatter(frontmatter)) {
    const reason = `Distilled draft failed schema validation: ${formatAjvErrors(validateFrontmatter.errors)}`;
    return flagForHuman(pr.prNumber, reason, logPath);
  }

  const markdown = renderMarkdown(frontmatter, draft);
  const slug = slugify(pr.prTitle);
  const filename = `${pr.prNumber}-${slug}.md`;
  const domainDir = path.join(outputDir, draft.domain);

  await fs.promises.mkdir(domainDir, { recursive: true });

  const outputPath = path.join(domainDir, filename);
  await fs.promises.writeFile(outputPath, markdown, 'utf8');

  return {
    status: 'written',
    outputPath,
    reason: `Distilled PR #${pr.prNumber} to ${draft.domain}`,
    hallucinationRate: hallucinationRate([...draft.relatedFiles, ...draft.entities], pr.fileList),
  };
}
