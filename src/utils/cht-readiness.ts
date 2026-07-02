/**
 * CHT readiness polling for the Test Environment Layer.
 *
 * The agent never runs Docker — the human brings the environment up. This util
 * polls the CHT monitoring endpoint until the instance reports healthy, or
 * rejects after a timeout with a clear "is the environment up?" message.
 *
 * See: designs/layer_recommendations/test-environment-layer.md
 */

import { ReadinessOptions } from '../types';

const MONITORING_PATH = '/api/v2/monitoring';

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Poll `${url}/api/v2/monitoring` until it responds OK, using exponential
 * backoff. Resolves once healthy; rejects if it never becomes ready in time.
 */
export const waitForReady = async (url: string, options: ReadinessOptions = {}): Promise<void> => {
  const maxWaitMs = options.maxWaitMs ?? 120_000;
  const maxDelayMs = options.maxDelayMs ?? 15_000;
  const requestTimeoutMs = options.requestTimeoutMs ?? 10_000;
  let delay = options.initialDelayMs ?? 2_000;

  const start = Date.now();
  let lastError = 'no response';

  while (Date.now() - start < maxWaitMs) {
    try {
      // Bound each request so a hung connection can't block past maxWaitMs.
      const response = await fetch(`${url}${MONITORING_PATH}`, {
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
      if (response.ok) {
        return;
      }
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'unreachable';
    }

    const remaining = maxWaitMs - (Date.now() - start);
    if (remaining <= 0) {
      break;
    }
    await sleep(Math.min(delay, remaining));
    delay = Math.min(delay * 1.5, maxDelayMs);
  }

  throw new Error(
    `CHT did not become ready at ${url} within ${maxWaitMs}ms (last: ${lastError}). ` +
      'Is the environment up? Bring it up (human-gated) and retry.'
  );
};
