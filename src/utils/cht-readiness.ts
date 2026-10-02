/**
 * CHT readiness polling for the Test Environment Layer.
 *
 * The agent never runs Docker — the human brings the environment up. This util
 * polls the CHT monitoring endpoint until the instance reports healthy, or
 * rejects with a clear "is the environment up?" message.
 *
 * See: designs/layer_recommendations/test-environment-layer.md
 */

import { ReadinessOptions } from '../types';

const MONITORING_PATH = '/api/v2/monitoring';
const MIN_PROBE_MS = 1_000;

// Waiting cannot fix a certificate the runtime does not trust, or a URL that redirects.
const TLS_VERIFY_CODES = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

type NotReady = { ready: false; reason: string; terminal: boolean };
type ProbeOutcome = { ready: true } | NotReady;
type FetchResponse = Awaited<ReturnType<typeof fetch>>;

const READY: ProbeOutcome = { ready: true };

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

const causeOf = (error: Error): NodeJS.ErrnoException | undefined =>
  error.cause instanceof Error ? error.cause : undefined;

/** Node reports every network and TLS failure as `fetch failed`; the reason is on error.cause. */
const describeProbeFailure = (error: unknown): NotReady => {
  if (!(error instanceof Error)) {
    return { ready: false, reason: 'unreachable', terminal: false };
  }
  const cause = causeOf(error);
  const detail = cause?.message || cause?.code;
  return {
    ready: false,
    reason: detail ? `${error.message} (${detail})` : error.message,
    terminal: cause?.code !== undefined && TLS_VERIFY_CODES.has(cause.code),
  };
};

/** Monitoring reports '' for a version it cannot read, i.e. while the app or CouchDB is down. */
const isVersion = (value: unknown): boolean => typeof value === 'string' && value !== '';

const isHealthy = (body: unknown): boolean => {
  const version = (body as { version?: { app?: unknown; couchdb?: unknown } } | null)?.version;
  return isVersion(version?.app) && isVersion(version?.couchdb);
};

const classifyResponse = async (response: FetchResponse): Promise<ProbeOutcome> => {
  if (response.status >= 300 && response.status < 400) {
    const reason = `HTTP ${response.status} redirect — check the URL's scheme and host`;
    return { ready: false, reason, terminal: true };
  }
  if (!response.ok) {
    return { ready: false, reason: `HTTP ${response.status}`, terminal: false };
  }
  const body: unknown = await response.json().catch(() => null);
  return isHealthy(body) ? READY : { ready: false, reason: 'the app or CouchDB is not up yet', terminal: false };
};

const probeOnce = async (url: string, requestTimeoutMs: number): Promise<ProbeOutcome> => {
  try {
    const response = await fetch(`${url}${MONITORING_PATH}`, {
      // Until cht-api is up it answers every route with a 200 "starting" page, and returns
      // its 503 only to clients that ask for JSON.
      headers: { Accept: 'application/json' },
      redirect: 'manual',
      signal: AbortSignal.timeout(requestTimeoutMs),
    });
    return await classifyResponse(response);
  } catch (error) {
    return describeProbeFailure(error);
  }
};

const resolveReadiness = (options: ReadinessOptions): Required<ReadinessOptions> => {
  const maxDelayMs = options.maxDelayMs ?? 15_000;
  return {
    maxWaitMs: options.maxWaitMs ?? 120_000,
    maxDelayMs,
    requestTimeoutMs: options.requestTimeoutMs ?? 10_000,
    initialDelayMs: Math.min(options.initialDelayMs ?? 2_000, maxDelayMs),
  };
};

const assertFiniteBudget = (maxWaitMs: number): void => {
  if (!Number.isFinite(maxWaitMs) || maxWaitMs < 0) {
    throw new Error(`waitForReady: maxWaitMs must be a finite, non-negative number (got ${maxWaitMs})`);
  }
};

const reportChange = (outcome: NotReady, previous: string | undefined): string => {
  if (outcome.reason !== previous) {
    console.log(`[cht-readiness] not ready: ${outcome.reason}`);
  }
  return outcome.reason;
};

const isFinal = (outcome: NotReady, remaining: number, reserve: number): boolean =>
  outcome.terminal || remaining <= reserve;

const notReadyError = (url: string, maxWaitMs: number, outcome: NotReady): Error =>
  new Error(
    outcome.terminal
      ? `CHT at ${url} cannot become ready as configured: ${outcome.reason}.`
      : `CHT did not become ready at ${url} within ${maxWaitMs}ms (last: ${outcome.reason}). ` +
          'Is the environment up? Bring it up (human-gated) and retry.'
  );

/**
 * Poll `${url}/api/v2/monitoring` until it reports healthy, using exponential backoff.
 * The last sleep stops short of the deadline so the final probe has a real budget.
 */
export const waitForReady = async (url: string, options: ReadinessOptions = {}): Promise<void> => {
  const { maxWaitMs, maxDelayMs, requestTimeoutMs, initialDelayMs } = resolveReadiness(options);
  assertFiniteBudget(maxWaitMs);
  const reserve = Math.min(requestTimeoutMs, MIN_PROBE_MS);
  const start = Date.now();
  let delay = initialDelayMs;
  let previousReason: string | undefined;

  for (;;) {
    const budget = Math.min(requestTimeoutMs, Math.max(maxWaitMs - (Date.now() - start), reserve));
    const outcome = await probeOnce(url, budget);
    if (outcome.ready) {
      return;
    }
    previousReason = reportChange(outcome, previousReason);
    const remaining = maxWaitMs - (Date.now() - start);
    if (isFinal(outcome, remaining, reserve)) {
      throw notReadyError(url, maxWaitMs, outcome);
    }
    await sleep(Math.min(delay, remaining - reserve));
    delay = Math.min(delay * 1.5, maxDelayMs);
  }
};
