/** Langfuse v5 (OpenTelemetry) tracing; everything no-ops when LANGFUSE_ENABLED=false or a Langfuse key is unset. */

import { LangfuseClient } from '@langfuse/client';
import { LangfuseSpanProcessor } from '@langfuse/otel';
import { propagateAttributes, startObservation, type LangfuseSpan } from '@langfuse/tracing';
import { context, propagation, trace } from '@opentelemetry/api';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';

// Bounds how long an unreachable Langfuse can stall a run; the OTLP exporter retries internally.
const REQUEST_TIMEOUT_SECONDS = 3;

interface LangfuseRuntime {
  provider: NodeTracerProvider;
  client: LangfuseClient;
}

let runtime: LangfuseRuntime | undefined;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function getRuntime(): LangfuseRuntime | undefined {
  if (process.env.LANGFUSE_ENABLED === 'false' || !process.env.LANGFUSE_PUBLIC_KEY || !process.env.LANGFUSE_SECRET_KEY) return undefined;
  if (runtime === undefined) {
    const provider = new NodeTracerProvider({
      spanProcessors: [new LangfuseSpanProcessor({ timeout: REQUEST_TIMEOUT_SECONDS })],
    });
    provider.register();
    // @langfuse/client 5.11.1 ignores `timeout`: score requests use the SDK default of 60 s.
    runtime = { provider, client: new LangfuseClient() };
  }
  return runtime;
}

/** Best-effort flush: an unreachable Langfuse logs a warning instead of failing the run. */
export async function shutdownLangfuse(): Promise<void> {
  if (runtime === undefined) return;
  await runtime.provider.shutdown().catch((err) => console.warn(`[Langfuse] span flush failed: ${errorMessage(err)}`));
  await runtime.client.shutdown().catch((err) => console.warn(`[Langfuse] score flush failed: ${errorMessage(err)}`));
}

/** Shut down and unregister the OTel globals so the next call re-reads process.env (tests only). */
export async function resetLangfuseForTests(): Promise<void> {
  await shutdownLangfuse();
  runtime = undefined;
  trace.disable();
  context.disable();
  propagation.disable();
}

export type TraceRoot = LangfuseSpan;

/** Options for `withTrace`. Propagated fields must be strings ≤ 200 chars (the SDK drops others). */
export interface TraceOptions {
  name: string;
  /** Groups all traces from one run (Sessions view); propagated to every child observation. */
  sessionId?: string;
  userId?: string;
  /** Root observation input — set only the relevant identity, not whole objects. */
  input?: unknown;
  tags?: string[];
  metadata?: Record<string, string>;
}

/** Langfuse generates a new trace id per call; put entity identity in input/tags/metadata to keep it filterable. */
export async function withTrace<T>(opts: TraceOptions, fn: (root: TraceRoot) => Promise<T>): Promise<T> {
  getRuntime();
  const { name, input, ...propagated } = opts;
  return propagateAttributes({ traceName: name, ...propagated }, async () => {
    const root = startObservation(name, { input });
    try {
      return await fn(root);
    } catch (err) {
      const message = errorMessage(err);
      root.update({ output: { error: message }, level: 'ERROR', statusMessage: message });
      throw err;
    } finally {
      root.end();
    }
  });
}

export function scoreTrace(root: TraceRoot, score: { name: string; value: number; comment?: string }): void {
  getRuntime()?.client.score.trace({ otelSpan: root.otelSpan }, score);
}

export interface GenerationResult<T> {
  parsed: T;
  model?: string;
  /** Token counts keyed by Langfuse usage type (`input`, `output`, `total`). */
  usage?: Record<string, number>;
  costUsd?: number;
}

export function fromLangChain<T>(res: {
  raw: { usage_metadata?: { input_tokens?: number; output_tokens?: number; total_tokens?: number }; response_metadata?: { model_name?: string; model?: string } };
  parsed: T;
}): GenerationResult<T> {
  if (res.parsed === null || res.parsed === undefined) {
    throw new Error('structured output parsing failed: the model response did not match the schema');
  }
  const u = res.raw.usage_metadata;
  const meta = res.raw.response_metadata;
  const reported = u ? { input: u.input_tokens, output: u.output_tokens, total: u.total_tokens } : undefined;
  const usage = reported && Object.fromEntries(Object.entries(reported).filter(([, v]) => v !== undefined)) as Record<string, number>;
  return { parsed: res.parsed, model: meta?.model_name ?? meta?.model, usage };
}

export async function observeGeneration<T>(
  root: TraceRoot | undefined,
  opts: { name: string; model: string; input: string },
  invoke: () => Promise<GenerationResult<T>>
): Promise<T> {
  const generation = root?.startObservation(opts.name, { model: opts.model, input: opts.input }, { asType: 'generation' });
  try {
    const result = await invoke();
    generation?.update({
      output: result.parsed,
      model: result.model ?? opts.model,
      usageDetails: result.usage,
      costDetails: result.costUsd === undefined ? undefined : { total: result.costUsd },
    }).end();
    return result.parsed;
  } catch (err) {
    const message = errorMessage(err);
    generation?.update({ output: { error: message }, level: 'ERROR', statusMessage: message }).end();
    throw err;
  }
}
