/**
 * Structured-output adapter for the Claude Code CLI provider.
 *
 * Bridges LangChain's `withStructuredOutput(zodSchema)` chains (used by the
 * memory distillation pipeline) to the CLI provider's `invokeForJSON`, so the
 * host-side seeding pipeline can run on the operator's Claude subscription
 * via `claude -p` with no API key (LLM_PROVIDER=claude-cli), mirroring the
 * code-gen factory option.
 *
 * The returned object is duck-type compatible with the only chain method the
 * pipeline uses: `invoke(prompt) -> parsed object`. Validation parity with
 * withStructuredOutput is kept by parsing the JSON through the same zod
 * schema; a mismatch throws, which the pipeline's existing error paths handle
 * (filter -> flag-for-human, distiller -> failed draft).
 */

import { z } from 'zod';
import { createLLMProviderFromEnv } from './factory';
import { fromLangChain, type GenerationResult } from '../observability';

export { isUsingCLIProvider } from './factory';

/**
 * The chain surface the pipeline scripts consume.
 */
export interface StructuredChain<T> {
  invoke(prompt: string): Promise<GenerationResult<T>>;
}

/**
 * Wrap a LangChain chat model as a StructuredChain that reports token usage.
 *
 * @example
 * ```typescript
 * const chain = createLangChainStructuredChain(new ChatAnthropic({ ... }), triageSchema);
 * const { parsed, usage } = await chain.invoke(prompt);
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const createLangChainStructuredChain = <T>(llm: any, schema: z.ZodType<T>): StructuredChain<T> => {
  const structured = llm.withStructuredOutput(schema, { includeRaw: true });
  return { invoke: async (prompt: string) => fromLangChain<T>(await structured.invoke(prompt)) };
};

/**
 * Create a structured-output chain backed by the Claude CLI provider.
 *
 * @param schema - zod schema the response must satisfy (same one passed to
 *                 withStructuredOutput in API mode).
 * @param shape  - human-readable JSON shape appended to the prompt, since the
 *                 CLI has no response_format/tool-forcing channel.
 *
 * @example
 * ```typescript
 * const chain = createStructuredCliChain(triageSchema,
 *   '{"decision": "distill" | "skip" | "flag-for-human", "reason": "<short explanation>"}');
 * const { parsed, costUsd } = await chain.invoke(prompt); // parsed: validated TriageOutput
 * ```
 */
export const createStructuredCliChain = <T>(
  schema: z.ZodType<T>,
  shape: string
): StructuredChain<T> => {
  const provider = createLLMProviderFromEnv();

  return {
    invoke: async (prompt: string): Promise<GenerationResult<T>> => {
      const jsonPrompt = `${prompt}

Return a single JSON object with exactly this shape (no extra keys):
${shape}`;

      // One-shot classification/extraction: no agentic turns, no tools —
      // the CLI provider's defaults (20 turns, tools on) are code-gen oriented.
      const options = { disableTools: true, maxTurns: 1 };
      if (!provider.invokeForJSONWithResponse) {
        return { parsed: schema.parse(await provider.invokeForJSON<unknown>(jsonPrompt, options)) };
      }
      const { parsed, response } = await provider.invokeForJSONWithResponse<unknown>(jsonPrompt, options);
      return { parsed: schema.parse(parsed), model: response.model, costUsd: response.costUsd };
    },
  };
};
