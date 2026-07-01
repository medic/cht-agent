/**
 * Observability module — Langfuse client singleton and trace/handler factory.
 *
 * One reusable primitive: `startTrace()` creates a trace and the LangChain
 * callback handler rooted on it, so every LLM call and manual span lands under
 * the same trace. All exports no-op when LANGFUSE_ENABLED=false (the default in
 * tests and CI). The client is created lazily so dotenv vars loaded by the entry
 * point are available before the constructor runs.
 *
 * Usage:
 *   const { trace, handler } = startTrace({ name: 'my-workflow', sessionId, input, tags });
 *   await chain.invoke(prompt, { callbacks: [handler] });   // auto-captures model + tokens
 *   const span = trace.span({ name: 'fetch' }); span.end({ output });
 *   trace.update({ output: result });
 *   await getLangfuse().flushAsync();
 */

import Langfuse from 'langfuse';
import { CallbackHandler } from 'langfuse-langchain';

// Lazy singleton — created on first call so dotenv vars are available
let _client: Langfuse | undefined;

/**
 * Returns the shared Langfuse client, creating it on first call.
 * Reads LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY, LANGFUSE_HOST, and LANGFUSE_ENABLED
 * from process.env at call time (not at module-load time).
 *
 * @example
 * ```typescript
 * await getLangfuse().flushAsync(); // flush buffered traces before exit
 * ```
 */
export function getLangfuse(): Langfuse {
  if (_client === undefined) {
    _client = new Langfuse({
      publicKey: process.env.LANGFUSE_PUBLIC_KEY,
      secretKey: process.env.LANGFUSE_SECRET_KEY,
      baseUrl: process.env.LANGFUSE_HOST ?? 'https://cloud.langfuse.com',
      enabled: process.env.LANGFUSE_ENABLED !== 'false',
    });
  }
  return _client;
}

/** A trace plus the LangChain callback handler rooted on it. */
export interface TraceContext {
  trace: ReturnType<Langfuse['trace']>;
  handler: CallbackHandler;
}

/**
 * Start a Langfuse trace and a LangChain callback handler rooted on it.
 *
 * The handler auto-captures model name, token usage, and latency for any chain
 * it's passed to; use `trace.span()` for non-LLM steps and `trace.update()` to
 * set the trace output. The SDK no-ops when LANGFUSE_ENABLED=false.
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
 * const { trace, handler } = startTrace({
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
  return { trace, handler: new CallbackHandler({ root: trace }) };
}
