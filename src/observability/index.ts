/** Langfuse v5 (OpenTelemetry) tracing; everything no-ops when LANGFUSE_ENABLED=false. */

import { AsyncLocalStorage } from 'node:async_hooks';
import { LangfuseClient } from '@langfuse/client';
import { LangfuseSpanProcessor } from '@langfuse/otel';
import { propagateAttributes, startActiveObservation, startObservation, type LangfuseGeneration, type LangfuseSpan } from '@langfuse/tracing';
import { context, propagation, trace } from '@opentelemetry/api';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { LLMCallError } from '../llm/types';

// Bounds how long an unreachable Langfuse can stall a run; the OTLP exporter retries internally.
const REQUEST_TIMEOUT_SECONDS = 3;

interface LangfuseRuntime {
  provider: NodeTracerProvider;
  client: LangfuseClient;
}

let runtime: LangfuseRuntime | undefined;

const traceFailures = new AsyncLocalStorage<string[]>();

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Marks the observation ERROR and records it so the enclosing withTrace root is marked too. */
function markFailed(observation: { update(attrs: { level: 'ERROR'; statusMessage: string }): unknown }, message: string): void {
  observation.update({ level: 'ERROR', statusMessage: message });
  traceFailures.getStore()?.push(message);
}

function getRuntime(): LangfuseRuntime | undefined {
  if (process.env.LANGFUSE_ENABLED === 'false') return undefined;
  if (runtime === undefined) {
    const provider = new NodeTracerProvider({
      spanProcessors: [new LangfuseSpanProcessor({ timeout: REQUEST_TIMEOUT_SECONDS })],
    });
    provider.register();
    runtime = { provider, client: new LangfuseClient({ timeout: REQUEST_TIMEOUT_SECONDS }) };
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
  const failures: string[] = [];
  return traceFailures.run(failures, () => propagateAttributes({ traceName: name, ...propagated }, () =>
    observeStep({ name, input, output: () => undefined, failure: () => summarizeFailures(failures) }, fn)));
}

function summarizeFailures(failures: string[]): string | undefined {
  if (failures.length === 0) return undefined;
  return failures.length === 1 ? failures[0] : `${failures.length} observations failed; first: ${failures[0]}`;
}

export type StepType = 'span' | 'agent' | 'tool' | 'chain' | 'retriever' | 'evaluator';

export interface StepOptions<T> {
  name: string;
  asType?: StepType;
  input?: unknown;
  /** Maps the result to the recorded output; defaults to the result itself, `undefined` records nothing. */
  output?: (result: T) => unknown;
  /** Returns an error message when a result that did not throw still represents a failure. */
  failure?: (result: T) => string | undefined;
}

/** Child of the active observation (so nested steps nest automatically); a no-op span before any withTrace. */
export async function observeStep<T>(opts: StepOptions<T>, fn: (step: TraceRoot) => Promise<T>): Promise<T> {
  const run = async (step: TraceRoot): Promise<T> => {
    if (opts.input !== undefined) step.update({ input: opts.input });
    try {
      const result = await fn(step);
      const output = opts.output ? opts.output(result) : result;
      if (output !== undefined) step.update({ output });
      const failed = opts.failure?.(result);
      if (failed) markFailed(step, failed);
      return result;
    } catch (err) {
      const message = errorMessage(err);
      step.update({ output: { error: message } });
      markFailed(step, message);
      throw err;
    }
  };
  return startActiveObservation(opts.name, run, { asType: (opts.asType ?? 'span') as 'span' });
}

interface NodeUpdate {
  errors?: string[];
  currentPhase?: string;
  messages?: Array<{ content: string }>;
}

/** Wraps a LangGraph node: nodes report failure through `errors` rather than throwing. */
export function observeNode<S, R>(
  opts: { name: string; asType?: StepType; input?: (state: NoInfer<S>) => unknown; output?: (result: NoInfer<R>) => Record<string, unknown> },
  node: (state: S, step: TraceRoot) => Promise<R>
): (state: S) => Promise<R> {
  return (state) => observeStep({
    name: opts.name,
    asType: opts.asType,
    input: opts.input?.(state),
    output: (r) => {
      const update = r as NodeUpdate;
      return { phase: update.currentPhase, summary: update.messages?.[0]?.content, errors: update.errors, ...opts.output?.(r) };
    },
    failure: (r) => (r as NodeUpdate).errors?.join('; ') || undefined,
  }, (step) => node(state, step));
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

export function fromLLMResponse<T>(
  response: { model: string; usage?: { inputTokens: number; outputTokens: number }; costUsd?: number },
  parsed: T
): GenerationResult<T> {
  const u = response.usage;
  const usage = u && { input: u.inputTokens, output: u.outputTokens, total: u.inputTokens + u.outputTokens };
  return { parsed, model: response.model, usage, costUsd: response.costUsd };
}

function isEmptyOutput(parsed: unknown): boolean {
  return parsed === null || parsed === undefined || (typeof parsed === 'string' && parsed.trim() === '');
}

export interface GenerationOptions<T> {
  name: string;
  model: string;
  input: string;
  /** Maps the parsed result to the recorded output; defaults to the parsed result itself. */
  output?: (parsed: T) => unknown;
  /** Returns an error message when a result that did not throw still represents a failure. */
  failure?: (parsed: T) => string | undefined;
}

function completeGeneration<T>(generation: LangfuseGeneration, opts: GenerationOptions<T>, result: GenerationResult<T>): void {
  const output = opts.output ? opts.output(result.parsed) : result.parsed;
  generation.update({
    output,
    model: result.model ?? opts.model,
    usageDetails: result.usage,
    costDetails: result.costUsd === undefined ? undefined : { total: result.costUsd },
  });
  const failed = opts.failure?.(result.parsed) ?? (isEmptyOutput(output) ? 'model returned empty output' : undefined);
  if (failed) markFailed(generation, failed);
  generation.end();
}

function spendOf(err: unknown): { model?: string; usageDetails?: Record<string, number>; costDetails?: { total: number } } {
  if (!(err instanceof LLMCallError)) return {};
  const spent = fromLLMResponse(err.response, undefined);
  return { model: spent.model, usageDetails: spent.usage, costDetails: spent.costUsd === undefined ? undefined : { total: spent.costUsd } };
}

async function recordGeneration<T>(
  generation: LangfuseGeneration | undefined,
  opts: GenerationOptions<T>,
  invoke: () => Promise<GenerationResult<T>>
): Promise<T> {
  if (!generation) return (await invoke()).parsed;
  try {
    const result = await invoke();
    completeGeneration(generation, opts, result);
    return result.parsed;
  } catch (err) {
    const message = errorMessage(err);
    generation.update({ output: { error: message }, ...spendOf(err) });
    markFailed(generation, message);
    generation.end();
    throw err;
  }
}

export async function observeGeneration<T>(
  root: TraceRoot | undefined,
  opts: GenerationOptions<T>,
  invoke: () => Promise<GenerationResult<T>>
): Promise<T> {
  const generation = root?.startObservation(opts.name, { model: opts.model, input: opts.input }, { asType: 'generation' });
  return recordGeneration(generation, opts, invoke);
}

/** Generation under the active observation, for code that has no root handle; records nothing outside a trace. */
export async function observeActiveGeneration<T>(
  opts: GenerationOptions<T>,
  invoke: () => Promise<GenerationResult<T>>
): Promise<T> {
  const active = trace.getActiveSpan() === undefined ? undefined : startObservation(opts.name, { model: opts.model, input: opts.input }, { asType: 'generation' });
  return recordGeneration(active, opts, invoke);
}
