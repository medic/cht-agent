/**
 * Observability module — Langfuse client singleton and LangChain callback handler factory.
 *
 * All exports are no-ops when LANGFUSE_ENABLED=false (the default in tests and CI).
 * The Langfuse client is initialised lazily on first use so env vars loaded by
 * dotenv.config() in the entry point are available before the constructor runs.
 *
 * Usage:
 *   const handler = makeLangfuseHandler(traceId, sessionId);
 *   const trace   = createTrace(traceId, sessionId);
 *   await filterPR(pr, { langfuseHandler: handler });
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
 * const trace = getLangfuse().trace({ id: 'my-trace' });
 * await getLangfuse().flushAsync();
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

/**
 * Create a LangChain CallbackHandler for a given trace and session.
 * The SDK no-ops automatically when LANGFUSE_ENABLED=false.
 * Pass to any LangChain chain.invoke() call to capture token counts, latency,
 * and model names automatically.
 *
 * @param traceId   - Unique identifier for this trace (e.g. `pipeline-pr-medic-cht-core-12345`).
 * @param sessionId - Session identifier grouping all traces from one pipeline run.
 *
 * @example
 * ```typescript
 * const handler = makeLangfuseHandler('pipeline-pr-medic-cht-core-42', 'session-abc');
 * await chain.invoke(prompt, { callbacks: [handler] });
 * ```
 */
export function makeLangfuseHandler(traceId: string, sessionId?: string): CallbackHandler {
  return new CallbackHandler({
    root: getLangfuse().trace({ id: traceId, sessionId }),
  });
}

/**
 * Create a Langfuse trace for manual (non-LangChain) span instrumentation.
 *
 * @param id        - Trace identifier (same as the one passed to makeLangfuseHandler).
 * @param sessionId - Session identifier for this pipeline run.
 *
 * @example
 * ```typescript
 * const trace = createTrace('pipeline-pr-medic-cht-core-42', 'session-abc');
 * const span = trace.span({ name: 'scrape', input: { prNum: 42 } });
 * span.end({ output: { fileCount: 10 } });
 * ```
 */
export function createTrace(id: string, sessionId?: string) {
  return getLangfuse().trace({ id, sessionId });
}
