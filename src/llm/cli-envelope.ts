/**
 * Parsing helpers for `claude -p --output-format json` stdout, shared by the
 * text-only provider and the code-gen CLI driver.
 */

export interface CliModelUsageEntry {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
  costUSD?: number;
}

function isResultMessage(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && (value as { type?: unknown }).type === 'result';
}

function resultFrom(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return value.find(isResultMessage) ?? null;
  return isResultMessage(value) ? value : null;
}

function tryParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Parse stdout as a single JSON object (not an array or scalar), for CLI output
 * that has the result fields but no `type` marker.
 *
 * @example
 * parsePlainObject('{"result":"ok"}'); // { result: 'ok' }
 * parsePlainObject('[{"type":"system"}]'); // null
 */
export function parsePlainObject<T = Record<string, unknown>>(stdout: string): T | null {
  const value = tryParse(stdout);
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as T) : null;
}

/**
 * True when stdout is valid JSON of any shape.
 *
 * @example
 * isJson('[1]'); // true
 * isJson('rate limited'); // false
 */
export function isJson(stdout: string): boolean {
  return tryParse(stdout) !== undefined;
}

function span(text: string, open: string, close: string): string | null {
  const start = text.indexOf(open);
  const end = text.lastIndexOf(close);
  return start === -1 || end <= start ? null : text.slice(start, end + 1);
}

function* lineBlocks(text: string): Generator<string> {
  const lines = text.split('\n');
  const starts = lines.flatMap((line, i) => (line.startsWith('[') || line.startsWith('{') ? [i] : []));
  const ends = lines.flatMap((line, i) => (/[\]}]\s*$/.test(line) && !/^\s/.test(line) ? [i] : [])).reverse();
  for (const start of starts) {
    for (const end of ends) {
      if (end >= start) yield lines.slice(start, end + 1).join('\n');
    }
  }
}

function* candidatesFrom(stdout: string): Generator<string | null> {
  yield stdout.trim();
  yield span(stdout, '[', ']');
  yield span(stdout, '{', '}');
  yield* lineBlocks(stdout);
}

/**
 * Find the `type: "result"` message in CLI stdout. Newer CLI versions print a JSON
 * array of every message (init, assistant, result); older ones print the result
 * object alone. Either may be preceded or followed by non-JSON noise, including
 * noise with brackets, as long as the JSON starts and ends at column 0 of a line.
 *
 * @example
 * findResultEnvelope('[{"type":"system"},{"type":"result","result":"ok"}]'); // { type: 'result', result: 'ok' }
 * findResultEnvelope('warn [cli]\n[{"type":"result","result":"ok"}]');      // { type: 'result', result: 'ok' }
 */
export function findResultEnvelope<T = Record<string, unknown>>(stdout: string): T | null {
  for (const candidate of candidatesFrom(stdout)) {
    if (!candidate) continue;
    const found = resultFrom(tryParse(candidate));
    if (found) return found as T;
  }
  return null;
}

function promptTokens(entry: CliModelUsageEntry): number {
  return (entry.inputTokens ?? 0) + (entry.cacheReadInputTokens ?? 0) + (entry.cacheCreationInputTokens ?? 0);
}

/**
 * Derive the model that actually served the call (the highest-cost `modelUsage`
 * entry, since the CLI may add cheap helper-model calls) and the token usage
 * summed across every model. Prompt tokens include cache reads and writes.
 *
 * @example
 * summarizeModelUsage({ 'claude-opus-5-5': { inputTokens: 2, cacheReadInputTokens: 8, outputTokens: 4, costUSD: 0.5 } });
 * // { model: 'claude-opus-5-5', usage: { inputTokens: 10, outputTokens: 4 } }
 */
export function summarizeModelUsage(
  modelUsage: Record<string, CliModelUsageEntry> | undefined
): { model?: string; usage?: { inputTokens: number; outputTokens: number } } {
  const entries = Object.entries(modelUsage ?? {});
  if (entries.length === 0) return {};
  const [model] = entries.reduce((top, e) => ((e[1].costUSD ?? 0) > (top[1].costUSD ?? 0) ? e : top));
  const usage = entries.reduce(
    (sum, [, e]) => ({ inputTokens: sum.inputTokens + promptTokens(e), outputTokens: sum.outputTokens + (e.outputTokens ?? 0) }),
    { inputTokens: 0, outputTokens: 0 }
  );
  return { model, usage };
}
