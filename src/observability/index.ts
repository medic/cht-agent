/**
 * Observability module — Langfuse client singleton and trace factory.
 *
 * `startTrace()` creates a trace. Callers add direct generation observations so
 * API and Claude CLI model paths are both represented. All exports no-op when LANGFUSE_ENABLED=false (the default in
 * tests and CI). The client is created lazily so dotenv vars loaded by the entry
 * point are available before the constructor runs.
 *
 * Usage:
 *   const { trace } = startTrace({ name: 'my-workflow', sessionId, input, tags });
 *   const span = trace.span({ name: 'fetch' }); span.end({ output });
 *   trace.update({ output: result });
 *   await getLangfuse().shutdownAsync();
 */

import Langfuse from 'langfuse';

// Lazy singleton — created on first call so dotenv vars are available
let _client: Langfuse | undefined;

/**
 * Returns the shared Langfuse client, creating it on first call.
 * Reads LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY, LANGFUSE_BASE_URL, and LANGFUSE_ENABLED
 * from process.env at call time (not at module-load time).
 *
 * @example
 * ```typescript
 * await getLangfuse().shutdownAsync(); // flush buffered traces before exit
 * ```
 */
export function getLangfuse(): Langfuse {
  if (_client === undefined) {
    _client = new Langfuse({
      publicKey: process.env.LANGFUSE_PUBLIC_KEY,
      secretKey: process.env.LANGFUSE_SECRET_KEY,
      baseUrl: process.env.LANGFUSE_BASE_URL ?? 'https://cloud.langfuse.com',
      enabled: process.env.LANGFUSE_ENABLED !== 'false',
      requestTimeout: 3000,
      fetchRetryCount: 1,
    });
  }
  return _client;
}

/** Drop the cached client so the next getLangfuse() re-reads process.env. */
export function resetLangfuseForTests(): void {
  _client = undefined;
}

/** A Langfuse trace rooted at a workflow execution. */
export interface TraceContext {
  trace: ReturnType<Langfuse['trace']>;
}

/** Parsed model output plus whatever usage/cost the provider reported. */
export interface GenerationResult<T> {
  parsed: T;
  model?: string;
  usage?: { input?: number; output?: number; total?: number };
  costUsd?: number;
}

/** Map a LangChain `withStructuredOutput(schema, { includeRaw: true })` result to a GenerationResult. */
export function fromLangChain<T>(res: {
  raw: { usage_metadata?: { input_tokens?: number; output_tokens?: number; total_tokens?: number }; response_metadata?: { model_name?: string; model?: string } };
  parsed: T;
}): GenerationResult<T> {
  const u = res.raw.usage_metadata;
  const meta = res.raw.response_metadata;
  return {
    parsed: res.parsed,
    model: meta?.model_name ?? meta?.model,
    usage: u ? { input: u.input_tokens, output: u.output_tokens, total: u.total_tokens } : undefined,
  };
}

/**
 * Record a model invocation as a Langfuse generation, including tokens and cost.
 * Failed calls end the generation with `level: 'ERROR'` so they show in Langfuse error views.
 *
 * @example
 * ```typescript
 * const parsed = await observeGeneration(trace, { name: 'classify', model: 'claude-cli', input: prompt },
 *   () => chain.invoke(prompt));
 * ```
 */
export async function observeGeneration<T>(
  trace: TraceContext['trace'] | undefined,
  opts: { name: string; model: string; input: string },
  invoke: () => Promise<GenerationResult<T>>
): Promise<T> {
  const generation = trace?.generation(opts);
  try {
    const result = await invoke();
    generation?.end({
      output: result.parsed,
      model: result.model ?? opts.model,
      usageDetails: result.usage,
      costDetails: result.costUsd === undefined ? undefined : { total: result.costUsd },
    });
    return result.parsed;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    generation?.end({ output: { error: message }, level: 'ERROR', statusMessage: message });
    throw err;
  }
}

/**
 * Start a Langfuse trace.
 *
 * Use `trace.generation()` for LLM calls, `trace.span()` for non-LLM steps, and
 * `trace.update()` to set the trace output. The SDK no-ops when disabled.
 *
 * Pass a descriptive `name` (not a unique id) — Langfuse generates the trace id,
 * so re-running the same entity produces a distinct trace each time. Put the
 * entity identity in `input`/`tags`/`metadata` so it stays filterable.
 *
 * @param opts.name      - Human-readable trace name (e.g. `memory-pipeline-pr`).
 * @param opts.sessionId - Groups all traces from one run (Sessions view).
 * @param opts.input     - Trace input — set only the relevant identity, not whole objects.
 * @param opts.tags      - Filterable tags (e.g. `['memory-pipeline', repo]`).
 * @param opts.metadata  - Extra structured context.
 *
 * @example
 * ```typescript
 * const { trace } = startTrace({
 *   name: 'memory-pipeline-pr',
 *   sessionId: 'run-abc',
 *   input: { prNum: 42, repo: 'medic/cht-core' },
 *   tags: ['memory-pipeline', 'medic/cht-core'],
 * });
 * ```
 */
export function startTrace(opts: {
  name: string;
  sessionId?: string;
  userId?: string;
  input?: unknown;
  tags?: string[];
  metadata?: Record<string, unknown>;
}): TraceContext {
  const trace = getLangfuse().trace(opts);
  return { trace };
}
