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
import { createLLMProviderFromEnv, isUsingCLIProvider } from './factory';

export { isUsingCLIProvider };

/**
 * The chain surface the pipeline scripts consume.
 */
export interface StructuredChain<T> {
  invoke(prompt: string): Promise<T>;
}

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
 * const result = await chain.invoke(prompt); // validated TriageOutput
 * ```
 */
export const createStructuredCliChain = <T>(
  schema: z.ZodType<T>,
  shape: string
): StructuredChain<T> => {
  const provider = createLLMProviderFromEnv();

  return {
    invoke: async (prompt: string): Promise<T> => {
      const jsonPrompt = `${prompt}

Return a single JSON object with exactly this shape (no extra keys):
${shape}`;

      // One-shot classification/extraction: no agentic turns, no tools —
      // the CLI provider's defaults (20 turns, tools on) are code-gen oriented.
      const raw = await provider.invokeForJSON<unknown>(jsonPrompt, {
        disableTools: true,
        maxTurns: 1,
      });

      return schema.parse(raw);
    },
  };
};
