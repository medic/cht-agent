/**
 * Detects an LLM rate / usage limit — HTTP 429, Anthropic `rate_limit_error`,
 * "too many requests", or a Claude CLI subscription "session/usage limit" message.
 * Global condition: the runner stops the whole batch (resumable via --resume)
 * rather than flagging each PR.
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
 * Detects an authentication failure (401 / "Failed to authenticate" / expired
 * Claude OAuth). Like a rate limit it's global — every PR fails until re-login —
 * so the runner stops the batch rather than flagging each PR.
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

/** Global errors (rate limit or auth) that should stop the batch, not flag one PR. */
export function isBatchFatalError(err: unknown): boolean {
  return isRateLimitError(err) || isAuthError(err);
}
