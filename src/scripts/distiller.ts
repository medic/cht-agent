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
import { ChatAnthropic } from '@langchain/anthropic';
import { ChatOpenAI } from '@langchain/openai';
import { z } from 'zod';
import type {
  ScrapedPR,
  DistillDraft,
  DistillResult,
  DistillOptions,
  SkipLogEntry,
} from '../types/pipeline';
import { CHT_DOMAINS, DEFAULT_PIPELINE_LOG_PATH, DEFAULT_PIPELINE_OUTPUT_DIR } from '../constants';

const DEFAULT_DISTILL_MODEL = 'anthropic/claude-sonnet-4-5';
const ANTHROPIC_DISTILL_MODEL = 'claude-sonnet-4-5-20251015';

/** Max chars of PR body to send (generous — distiller needs more context than triage) */
const BODY_LIMIT = 4000;
/** Max chars of each linked issue body */
const ISSUE_BODY_LIMIT = 500;
/** Max linked issues to include */
const MAX_ISSUES = 3;
/** Max review comments to include */
const MAX_REVIEWS = 3;
const REVIEW_BODY_LIMIT = 300;

const draftSchema = z.object({
  domain: z.enum(CHT_DOMAINS),
  title: z.string().min(1).max(100),
  category: z.enum(['bug', 'feature', 'improvement']),
  summary: z.string().min(1),
  tags: z.array(z.string()),
  entities: z.array(z.string()),
  concepts: z.array(z.string()),
  problem: z.string().min(1),
  rootCause: z.string().min(1),
  solution: z.string().min(1),
  codePatterns: z.string(),
  designChoices: z.string(),
  relatedFiles: z.array(z.string()),
});

// Cached on first call — avoids recreating the client for each PR in a batch
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _distillChain: any;

function getDistillChain() {
  if (_distillChain !== undefined) return _distillChain;

  const openrouterKey = process.env.OPENROUTER_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  if (openrouterKey) {
    const llm = new ChatOpenAI({
      modelName: process.env.DISTILL_MODEL ?? DEFAULT_DISTILL_MODEL,
      maxTokens: 2000,
      configuration: { apiKey: openrouterKey, baseURL: 'https://openrouter.ai/api/v1' },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _distillChain = (llm as any).withStructuredOutput(draftSchema);
  } else if (anthropicKey) {
    const llm = new ChatAnthropic({
      model: ANTHROPIC_DISTILL_MODEL,
      apiKey: anthropicKey,
      maxTokens: 2000,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _distillChain = (llm as any).withStructuredOutput(draftSchema);
  } else {
    _distillChain = null;
  }

  return _distillChain;
}

/**
 * Build the distillation prompt from a ScrapedPR.
 * Truncates long fields to keep cost predictable.
 */
function buildPrompt(pr: ScrapedPR): string {
  const body = (pr.prBody ?? '').slice(0, BODY_LIMIT);
  const fileList = pr.fileList.slice(0, 50).join('\n');

  const issueContext = pr.linkedIssues
    .slice(0, MAX_ISSUES)
    .map(i => `Issue #${i.number} (body excerpt):\n${i.body.slice(0, ISSUE_BODY_LIMIT)}`)
    .join('\n\n');

  const reviewContext = pr.reviewComments
    .filter(r => r.body.trim().length > 0)
    .slice(0, MAX_REVIEWS)
    .map(r => `Review by ${r.author}:\n${r.body.slice(0, REVIEW_BODY_LIMIT)}`)
    .join('\n\n');

  return `You are a technical knowledge curator for the Community Health Toolkit (CHT) project.

Analyse this merged GitHub PR and produce a structured knowledge entry for the agent memory system.

The CHT has 8 functional domains — pick the most specific one that fits:
  ${CHT_DOMAINS.join(', ')}

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
  "domain": "<one of the 8 domains above>",
  "title": "<concise title ≤100 chars describing the change>",
  "category": "bug" | "feature" | "improvement",
  "summary": "<1-2 sentence summary of the problem and resolution>",
  "tags": ["<tag1>", "<tag2>"],
  "entities": ["<file or module path>"],
  "concepts": ["<architectural concept>"],
  "problem": "<what was wrong — symptoms, affected users, error messages>",
  "rootCause": "<specific code path or architectural reason>",
  "solution": "<how it was fixed — approach and key changes>",
  "codePatterns": "<reusable patterns from this fix with file paths>",
  "designChoices": "<why this approach over alternatives>",
  "relatedFiles": ["<path1>", "<path2>"]
}`;
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
 * Convert a string to a URL-safe kebab-case slug.
 *
 * @example
 * ```typescript
 * slugify('Fix: Prevent Duplicate Contact Creation'); // 'fix-prevent-duplicate-contact-creation'
 * ```
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60);
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
  const today = new Date().toISOString().slice(0, 10);

  const frontmatter = [
    '---',
    `id: cht-core-${pr.prNumber}`,
    `category: ${draft.category}`,
    `domain: ${draft.domain}`,
    `title: ${draft.title}`,
    `last_updated: "${today}"`,
    `summary: "${draft.summary.replaceAll('"', "'")}"`,
    `tags:`,
    ...draft.tags.map(t => `  - ${t}`),
    `source_pr: medic/cht-core#${pr.prNumber}`,
    `source_sha: ${pr.mergeSha}`,
    `distilled_at: "${today}"`,
    `reviewed_by: null`,
    `reviewed_at: null`,
    `confidence: medium`,
    `entities:`,
    ...draft.entities.map(e => `  - ${e}`),
    `concepts:`,
    ...draft.concepts.map(c => `  - ${c}`),
    `related_issues: []`,
    `stale: false`,
    '---',
  ].join('\n');

  const relatedFilesSection = draft.relatedFiles.length > 0
    ? draft.relatedFiles.map(f => `- ${f}`).join('\n')
    : '_none_';

  return [
    frontmatter,
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
  ].join('\n');
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
  const logPath = opts.logPath ?? DEFAULT_PIPELINE_LOG_PATH;
  const outputDir = opts.outputDir ?? DEFAULT_PIPELINE_OUTPUT_DIR;
  const distillFn = opts.distillFn ?? llmDistill;

  let draft: DistillDraft;
  try {
    draft = await distillFn(pr);
  } catch (err) {
    const reason = err instanceof Error ? err.message : `Distill failed: ${String(err)}`;
    const entry: SkipLogEntry = {
      prNumber: pr.prNumber,
      decision: 'flag-for-human',
      reason,
      timestamp: new Date().toISOString(),
    };
    await fs.promises.appendFile(logPath, JSON.stringify(entry) + '\n', 'utf8');
    return { status: 'flag-for-human', reason };
  }

  const markdown = assembleDraft(draft, pr);
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
  };
}
