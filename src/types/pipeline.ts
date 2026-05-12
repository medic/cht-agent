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
