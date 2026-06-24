/**
 * Pipeline types for the PR scraper and distillation pipeline.
 * These types model the data flowing through scrape → filter → distill stages.
 */

/**
 * A GitHub issue linked from a PR description, fetched via /issues/{n}.
 * Captures the issue body and any top-level comments for context.
 */
export interface LinkedIssue {
  /** The GitHub issue number */
  number: number;
  /** The issue body (markdown) */
  body: string;
  /** Top-level comment bodies, in chronological order */
  comments: string[];
}

/**
 * A review summary submitted via /pulls/{n}/reviews.
 * Represents review-level (not inline) feedback from a reviewer.
 */
export interface ReviewComment {
  /** GitHub username of the reviewer */
  author: string;
  /** Whether the reviewer is a member of the organisation */
  isOrgMember: boolean;
  /** The review body text (markdown) */
  body: string;
}

/**
 * The fully-assembled output of the scraper for a single merged PR.
 * Combines PR metadata, file changes, linked issues, and review comments.
 */
export interface ScrapedPR {
  /** The GitHub PR number */
  prNumber: number;
  /** PR title */
  prTitle: string;
  /** PR body (markdown) */
  prBody: string;
  /** Labels applied to the PR */
  labels: string[];
  /** The merge commit SHA */
  mergeSha: string;
  /** ISO-8601 timestamp at which the PR was merged */
  mergedAt: string;
  /** Paths of all files changed in the PR */
  fileList: string[];
  /** Unified diff of all changes */
  diff: string;
  /** Issues linked from the PR description */
  linkedIssues: LinkedIssue[];
  /** Review summaries (not inline comments) left on the PR */
  reviewComments: ReviewComment[];
  /** GitHub login of the PR author */
  author: string;
}

/**
 * The outcome of the filter stage for a single PR.
 * - 'distill'        — proceed to distillation
 * - 'skip'           — discard silently
 * - 'flag-for-human' — cannot be decided automatically; needs manual triage
 */
export type FilterDecision = 'distill' | 'skip' | 'flag-for-human';

/**
 * A record written to _skipped.ndjson when a PR is not forwarded for distillation.
 * Provides an audit trail for filtered-out or flagged PRs.
 */
export interface SkipLogEntry {
  /** The GitHub PR number that was filtered */
  prNumber: number;
  /** The filter decision that caused this log entry */
  decision: FilterDecision;
  /** Human-readable explanation for the decision */
  reason: string;
  /** ISO-8601 timestamp when the decision was recorded */
  timestamp: string;
}

/** The outcome of the filter stage for a single PR */
export interface FilterResult {
  decision: FilterDecision;
  reason: string;
}

/** Options for filterPR — used to inject test doubles and override defaults */
export interface FilterOptions {
  /** Override default _skipped.ndjson path */
  logPath?: string;
  /** Skip LLM triage and return flag-for-human immediately */
  skipLlm?: boolean;
  /** Inject a triage function replacing the real LLM call (for testing) */
  triageFn?: (pr: ScrapedPR) => Promise<FilterResult>;
}

// Single source of truth lives in ../types (derived from ../constants); re-exported
// here so pipeline consumers can keep importing these from one module.
import type { CHTDomain, CHTService, CHTWorkflow } from './index';
export type { CHTDomain, CHTService, CHTWorkflow };

/**
 * The structured output the LLM returns when distilling a PR.
 * Assembled into markdown by distiller.ts — not written raw.
 */
export interface DistillDraft {
  domain: CHTDomain;
  /** Whether the chosen domain is a principled match or a forced least-bad pick */
  domainFit: 'strong' | 'weak';
  /** The model's rationale for the domain choice — emitted into the draft for reviewers */
  domainReasoning: string;
  title: string;
  category: 'bug' | 'feature' | 'improvement';
  summary: string;
  /** CHT services involved in the change (schema-required, min 1) */
  services: CHTService[];
  /** Technologies relevant to the fix (schema-required, min 1) */
  techStack: string[];
  tags: string[];
  /** Cross-domain workstreams this PR participates in (0+; empty if none) */
  relatedWorkflows: CHTWorkflow[];
  /** Referenced files, modules, or named patterns */
  entities: string[];
  /** Referenced architectural or domain concepts */
  concepts: string[];
  problem: string;
  rootCause: string;
  solution: string;
  codePatterns: string;
  designChoices: string;
  relatedFiles: string[];
  /** How the change was tested — body for the `## Testing` section */
  testing: string;
  /** Related cht-core issues/PRs (e.g. "#123: desc") — body for `## Related Issues` */
  relatedIssues: string[];
}

/** Outcome of the distill stage for a single PR */
export type DistillStatus = 'written' | 'flag-for-human';

/** Result returned by distillPR */
export interface DistillResult {
  status: DistillStatus;
  /** Absolute path of the written draft file — set only when status === 'written' */
  outputPath?: string;
  reason: string;
}

/** Options for distillPR — used to inject test doubles and override defaults */
export interface DistillOptions {
  /** Override base _pending directory (default: agent-memory/_pending) */
  outputDir?: string;
  /** Override _skipped.ndjson path */
  logPath?: string;
  /** Inject a distill function replacing the real LLM call (for testing) */
  distillFn?: (pr: ScrapedPR) => Promise<DistillDraft>;
}

/** Options for openReviewPR — used to inject test doubles and override defaults */
export interface OpenReviewOptions {
  /** Actually create branches and PRs; default is dry-run */
  apply?: boolean;
  /** Override _pending base directory */
  pendingDir?: string;
  /** Override agent-memory/domains base directory */
  domainsDir?: string;
  /** Override _skipped.ndjson path */
  logPath?: string;
  /** Date string in YYYYMMDD format for branch naming (default: today) */
  date?: string;
  /** Inject execFileSync replacement for testing */
  execFn?: (file: string, args: string[]) => string;
}

/** Result of promoting a domain's pending drafts to a review PR */
export interface ReviewPRResult {
  domain: string;
  branch: string;
  prUrl?: string;
  filesPromoted: number;
  status: 'created' | 'dry-run' | 'skipped' | 'failed';
  /** Failure reason — set only when status === 'failed' */
  error?: string;
}

/**
 * Error thrown by the scraper when it cannot successfully retrieve or parse
 * data for a specific PR. Carries the PR number for caller-side correlation.
 *
 * @example
 * ```typescript
 * throw new ScraperError('Rate limit exceeded', 42);
 *
 * try { ... } catch (err) {
 *   if (err instanceof ScraperError) console.error(err.prNumber);
 * }
 * ```
 */
export class ScraperError extends Error {
  /**
   * @param message   - Description of what went wrong
   * @param prNumber  - The PR number that triggered the failure
   * @param options   - Optional ErrorOptions (e.g. `{ cause }`)
   */
  constructor(
    message: string,
    public readonly prNumber: number,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'ScraperError';
  }
}
