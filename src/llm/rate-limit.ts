/**
 * Detects whether a thrown error represents an LLM rate / usage limit.
 *
 * Covers the API path (HTTP 429, Anthropic `rate_limit_error`, "too many
 * requests") and the Claude Code CLI path (a subscription "usage limit
 * reached" message surfaced as a `Claude CLI error: ...`).
 *
 * The seeding pipeline stops the whole batch when this is true — rather than
 * flagging each PR for human review — so a throttled run can be resumed later
 * (`--resume`) once the limit resets, without burning the audit log.
 *
 * @example
 * ```typescript
 * isRateLimitError(new Error('HTTP 429: rate limit exceeded')); // true
 * isRateLimitError(new Error('Claude usage limit reached'));     // true
 * isRateLimitError(new Error('scrape failed'));                  // false
 * ```
 */
export function isRateLimitError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    /rate[\s_-]?limit/.test(msg) ||
    /\b429\b/.test(msg) ||
    /too many requests/.test(msg) ||
    /usage limit/.test(msg) ||
    /session limit/.test(msg) ||
    // Claude subscription limit messages: "You've hit your session/5-hour/weekly limit · resets ..."
    /hit your .{0,40}limit/.test(msg) ||
    /limit reached/.test(msg) ||
    /\bquota\b/.test(msg)
  );
}

/**
 * Detects whether a thrown error is an authentication failure (e.g. an expired
 * or missing Claude OAuth token surfaced as `401 Invalid authentication
 * credentials`, or "Failed to authenticate").
 *
 * Like a rate limit, this is a GLOBAL condition — every PR will fail until the
 * operator re-logs in (`docker exec -it cht-seeder claude`) — so the seeding
 * pipeline stops the whole batch rather than flagging each PR for human review.
 *
 * @example
 * ```typescript
 * isAuthError(new Error('Claude CLI error: Failed to authenticate. API Error: 401 Invalid authentication credentials')); // true
 * isAuthError(new Error('scrape failed')); // false
 * ```
 */
export function isAuthError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    /\b401\b/.test(msg) ||
    /invalid authentication/.test(msg) ||
    /failed to authenticate/.test(msg) ||
    /authentication credentials/.test(msg) ||
    /\bunauthorized\b/.test(msg) ||
    /not authenticated/.test(msg)
  );
}

/**
 * True for errors that are global (not a property of the current PR) and should
 * stop the whole batch so the operator can fix the cause and resume: LLM
 * rate/usage limits and authentication failures.
 */
export function isBatchFatalError(err: unknown): boolean {
  return isRateLimitError(err) || isAuthError(err);
}
