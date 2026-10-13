import { fromLLMResponse, type GenerationOptions, type GenerationResult } from '../../src/observability';

export interface RecordedGeneration {
  name: string;
  model?: string;
  costUsd?: number;
  failure?: string;
  error?: string;
}

/**
 * Stand-in for the observability module that records each generation a caller opens.
 *
 * @example
 * const { records, observability } = generationRecorder();
 * proxyquire(modulePath, { '../../../../observability': observability });
 * // after the run: records[0] => { name: 'code-gen-plan', model: 'claude-opus-5-5', costUsd: 0.1 }
 */
export function generationRecorder() {
  const records: RecordedGeneration[] = [];
  const observeActiveGeneration = async <T>(opts: GenerationOptions<T>, invoke: () => Promise<GenerationResult<T>>): Promise<T> => {
    try {
      const result = await invoke();
      records.push({ name: opts.name, model: result.model, costUsd: result.costUsd, failure: opts.failure?.(result.parsed) });
      return result.parsed;
    } catch (err) {
      records.push({ name: opts.name, error: (err as Error).message });
      throw err;
    }
  };
  return { records, observability: { fromLLMResponse, observeActiveGeneration } };
}
