/**
 * Debug Logger
 *
 * A tiny, dependency-free logger for `--verbose` debug output (see `src/cli`).
 *
 * Design goals (from #51):
 * - Output goes to **stderr**, so it never pollutes stdout / piped results.
 * - Sensitive data (API keys, tokens, passwords) is **redacted** before it is
 *   ever written.
 * - Long payloads (LLM prompts/responses) are **truncated** so logs stay useful.
 * - When disabled, every method is a no-op, so normal output is unchanged.
 *
 * The sink and clock are injectable, which keeps the redaction/truncation logic
 * unit-testable without touching the real stderr or wall clock.
 */

const DEFAULT_MAX_LENGTH = 500;

export interface DebugLogger {
  /** Whether debug output is enabled. */
  readonly enabled: boolean;
  /** Log a labelled message, optionally with a (redacted, truncated) payload. */
  log(label: string, data?: unknown): void;
  /**
   * Start a timer. Returns a `stop()` function that logs the elapsed
   * milliseconds under the same label. No-op when disabled.
   */
  time(label: string): () => void;
}

export interface DebugLoggerOptions {
  /** Master switch. When false, all methods are no-ops. */
  enabled: boolean;
  /** Max characters of a stringified payload before truncation (default 500). */
  maxLength?: number;
  /** Output sink; defaults to `process.stderr`. Injectable for tests. */
  sink?: (line: string) => void;
  /** Clock for timings; defaults to `Date.now`. Injectable for tests. */
  now?: () => number;
}

/**
 * Redact secrets from a string before logging. Patterns are deliberately simple
 * and linear-time (no nested quantifiers) to avoid catastrophic backtracking.
 */
export function redactSensitive(text: string): string {
  return text
    // Anthropic-style API keys: sk-ant-...
    .replace(/sk-ant-[A-Za-z0-9_-]{6,}/g, 'sk-ant-***REDACTED***')
    // Other `sk-` prefixed keys (e.g. OpenAI): sk-<long token>
    .replace(/sk-[A-Za-z0-9]{16,}/g, 'sk-***REDACTED***')
    // Authorization headers: redact the whole credential (scheme + token), so
    // both "Bearer <jwt>" and "Basic <base64>" forms are covered. Runs before
    // the standalone Bearer rule so the credential is redacted exactly once.
    .replace(/(authorization"?\s*[:=]\s*"?)[^"\n,}]{4,}/gi, '$1***REDACTED***')
    // Standalone Bearer tokens elsewhere in the text.
    .replace(/Bearer\s+[A-Z0-9._-]{8,}/gi, 'Bearer ***REDACTED***')
    // key/value pairs: apiKey / api_key / token / secret / password
    .replace(
      /("?(?:api[_-]?key|apikey|token|secret|password)"?\s*[:=]\s*)("?)([^"\s,}]{4,})\2/gi,
      '$1$2***REDACTED***$2'
    );
}

/** Truncate long text, appending a marker with the original length. */
export function truncate(text: string, maxLength: number = DEFAULT_MAX_LENGTH): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}… (${text.length} chars total)`;
}

/** Stringify any value for logging (handles circular structures gracefully). */
function stringify(data: unknown): string {
  if (typeof data === 'string') return data;
  try {
    return JSON.stringify(data);
  } catch {
    return String(data);
  }
}

/** Render a payload: stringify → redact → truncate (redact first so a split token can't leak). */
function formatData(data: unknown, maxLength: number): string {
  return truncate(redactSensitive(stringify(data)), maxLength);
}

/** Build the ": <payload>" suffix for a log line, or "" when there is no payload. */
function renderSuffix(data: unknown, maxLength: number): string {
  return data === undefined ? '' : `: ${formatData(data, maxLength)}`;
}

/** Shared no-op logger returned when debug output is disabled. */
const NOOP_LOGGER: DebugLogger = {
  enabled: false,
  log: () => undefined,
  time: () => () => undefined,
};

/** Create a debug logger. When `enabled` is false a shared no-op logger is returned. */
export function createDebugLogger(options: DebugLoggerOptions): DebugLogger {
  if (!options.enabled) return NOOP_LOGGER;
  const maxLength = options.maxLength ?? DEFAULT_MAX_LENGTH;
  const sink = options.sink ?? ((line: string) => process.stderr.write(line));
  const now = options.now ?? Date.now;

  const log = (label: string, data?: unknown): void => {
    sink(`[debug] ${label}${renderSuffix(data, maxLength)}\n`);
  };

  const time = (label: string): (() => void) => {
    const start = now();
    return () => log(`${label} (${now() - start}ms)`);
  };

  return { enabled: true, log, time };
}
