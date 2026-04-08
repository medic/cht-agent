/**
 * Anthropic (Claude) LLM Provider
 *
 * Adapter for Anthropic's Claude models.
 * Implements the LLMProvider interface.
 */

import { ChatAnthropic } from '@langchain/anthropic';
import { HumanMessage, AIMessage, SystemMessage, ToolMessage, BaseMessage } from '@langchain/core/messages';
import {
  LLMProvider,
  LLMConfig,
  LLMMessage,
  LLMResponse,
  InvokeOptions,
  LLMToolDefinition,
  DEFAULT_CONFIG,
  capMaxTokens,
} from '../types';

/**
 * Extract text content from a LangChain message response.
 * Handles both plain string and array-of-blocks content.
 */
function extractTextContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((block: any) => block.type === 'text')
      .map((block: any) => block.text)
      .join('');
  }
  return JSON.stringify(content);
}

/**
 * Convert LLMToolDefinition to LangChain ToolDefinition format.
 */
function toLangChainTools(tools: LLMToolDefinition[]) {
  return tools.map(tool => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  }));
}

/**
 * Create an Anthropic LLM provider
 */
export const createAnthropicProvider = (config: LLMConfig): LLMProvider => {
  /** Create a ChatAnthropic instance with optional temperature/maxTokens overrides */
  const createModel = (overrides?: { temperature?: number; maxTokens?: number }) => new ChatAnthropic({
    modelName: config.model,
    anthropicApiKey: config.apiKey,
    temperature: overrides?.temperature ?? config.temperature ?? DEFAULT_CONFIG.temperature,
    maxTokens: capMaxTokens(config.model, overrides?.maxTokens ?? config.maxTokens ?? DEFAULT_CONFIG.maxTokens),
    topP: undefined,
    streaming: true,
  });

  const model = createModel();

  /**
   * Run a multi-round tool-use loop.
   * Invokes the model with tools bound, executes tool calls via the handler,
   * and repeats until the model returns a text-only response or maxRounds is reached.
   */
  const invokeWithToolLoop = async (
    baseModel: ChatAnthropic,
    initialMessages: BaseMessage[],
    options: InvokeOptions,
  ): Promise<LLMResponse> => {
    const langchainTools = toLangChainTools(options.tools!);
    const boundModel = baseModel.bindTools(langchainTools, { tool_choice: 'auto' });
    const maxRounds = options.maxToolRounds ?? 10;
    const totalUsage = { inputTokens: 0, outputTokens: 0 };
    let lastStopReason: string | undefined;

    const messages = [...initialMessages];

    for (let round = 0; round < maxRounds; round++) {
      const response = await boundModel.invoke(messages);

      if (response.usage_metadata) {
        totalUsage.inputTokens += response.usage_metadata.input_tokens;
        totalUsage.outputTokens += response.usage_metadata.output_tokens;
      }
      lastStopReason = response.response_metadata?.stop_reason as string | undefined;

      if (!response.tool_calls || response.tool_calls.length === 0) {
        return {
          content: extractTextContent(response.content),
          model: config.model,
          usage: totalUsage,
          stopReason: lastStopReason,
        };
      }

      messages.push(response);
      for (const toolCall of response.tool_calls) {
        try {
          const result = await options.toolHandler!(toolCall.name, toolCall.args);
          messages.push(new ToolMessage({
            content: result,
            tool_call_id: toolCall.id!,
          }));
        } catch (error) {
          messages.push(new ToolMessage({
            content: `Error: ${error instanceof Error ? error.message : String(error)}`,
            tool_call_id: toolCall.id!,
            status: 'error',
          }));
        }
      }
    }

    // Max rounds reached — invoke without tools to force a text response
    const finalResponse = await baseModel.invoke(messages);
    if (finalResponse.usage_metadata) {
      totalUsage.inputTokens += finalResponse.usage_metadata.input_tokens;
      totalUsage.outputTokens += finalResponse.usage_metadata.output_tokens;
    }

    return {
      content: extractTextContent(finalResponse.content),
      model: config.model,
      usage: totalUsage,
      stopReason: finalResponse.response_metadata?.stop_reason as string | undefined,
    };
  };

  const invoke = async (prompt: string, options?: InvokeOptions): Promise<LLMResponse> => {
    const invokeModel = options?.temperature !== undefined || options?.maxTokens !== undefined
      ? createModel({ temperature: options?.temperature, maxTokens: options?.maxTokens })
      : model;

    if (options?.tools?.length && options.toolHandler) {
      return invokeWithToolLoop(invokeModel, [new HumanMessage(prompt)], options);
    }

    const response = await invokeModel.invoke(prompt);

    return {
      content: extractTextContent(response.content),
      model: config.model,
      usage: response.usage_metadata
        ? {
          inputTokens: response.usage_metadata.input_tokens,
          outputTokens: response.usage_metadata.output_tokens,
        }
        : undefined,
      stopReason: response.response_metadata?.stop_reason as string | undefined,
    };
  };

  const invokeWithMessages = async (
    messages: LLMMessage[],
    options?: InvokeOptions
  ): Promise<LLMResponse> => {
    const invokeModel = options?.temperature !== undefined || options?.maxTokens !== undefined
      ? createModel({ temperature: options?.temperature, maxTokens: options?.maxTokens })
      : model;

    if (options?.tools?.length && options.toolHandler) {
      const baseMessages: BaseMessage[] = messages.map((msg) => {
        switch (msg.role) {
          case 'system': return new SystemMessage(msg.content);
          case 'assistant': return new AIMessage(msg.content);
          case 'user':
          default: return new HumanMessage(msg.content);
        }
      });
      return invokeWithToolLoop(invokeModel, baseMessages, options);
    }

    const langchainMessages: Array<[string, string]> = messages.map((msg) => {
      switch (msg.role) {
        case 'system':
          return ['system', msg.content];
        case 'user':
          return ['human', msg.content];
        case 'assistant':
          return ['assistant', msg.content];
        default:
          return ['human', msg.content];
      }
    });

    const response = await invokeModel.invoke(langchainMessages);

    return {
      content: extractTextContent(response.content),
      model: config.model,
      usage: response.usage_metadata
        ? {
          inputTokens: response.usage_metadata.input_tokens,
          outputTokens: response.usage_metadata.output_tokens,
        }
        : undefined,
      stopReason: response.response_metadata?.stop_reason as string | undefined,
    };
  };

  const invokeForJSON = async <T>(prompt: string, options?: InvokeOptions): Promise<T> => {
    // Increase maxTokens for JSON responses to avoid truncation
    const jsonOptions = {
      ...options,
      maxTokens: options?.maxTokens ?? 16384,
    };

    const response = await invoke(prompt, jsonOptions);
    let content = response.content;

    // Check if response was truncated
    if (response.stopReason === 'max_tokens') {
      console.warn('[LLM] Response was truncated due to max_tokens limit');
    }

    // Strip markdown code blocks if present
    const codeBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      content = codeBlockMatch[1].trim();
    }

    // Try to extract JSON object from the response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('LLM response did not contain valid JSON object');
    }

    let jsonStr = jsonMatch[0];

    // Clean up common JSON issues
    // Remove trailing commas before ] or }
    jsonStr = jsonStr.replace(/,(\s*[}\]])/g, '$1');

    try {
      return JSON.parse(jsonStr) as T;
    } catch (error) {
      // Log a snippet of the problematic JSON for debugging
      const snippet = jsonStr.substring(0, 500);
      console.error(`[LLM] JSON parse error. First 500 chars: ${snippet}...`);
      console.error(`[LLM] Stop reason: ${response.stopReason}`);
      throw new Error(`Failed to parse LLM response as JSON: ${error}`);
    }
  };

  return {
    providerType: 'anthropic',
    modelName: config.model,
    invoke,
    invokeWithMessages,
    invokeForJSON,
  };
};
