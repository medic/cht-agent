/**
 * Anthropic (Claude) LLM Provider
 *
 * Adapter for Anthropic's Claude models.
 * Implements the LLMProvider interface.
 */

import { ChatAnthropic } from '@langchain/anthropic';
import {
  LLMProvider,
  LLMConfig,
  LLMMessage,
  LLMResponse,
  InvokeOptions,
  DEFAULT_CONFIG,
} from '../types';

/**
 * Create an Anthropic LLM provider
 */
export const createAnthropicProvider = (config: LLMConfig): LLMProvider => {
  const model = new ChatAnthropic({
    modelName: config.model,
    anthropicApiKey: config.apiKey,
    temperature: config.temperature ?? DEFAULT_CONFIG.temperature,
    maxTokens: config.maxTokens ?? DEFAULT_CONFIG.maxTokens,
  });

  const invoke = async (prompt: string, options?: InvokeOptions): Promise<LLMResponse> => {
    const invokeModel = options?.temperature !== undefined
      ? new ChatAnthropic({
        modelName: config.model,
        anthropicApiKey: config.apiKey,
        temperature: options.temperature,
        maxTokens: options.maxTokens ?? config.maxTokens ?? DEFAULT_CONFIG.maxTokens,
      })
      : model;

    const response = await invokeModel.invoke(prompt);
    const content = typeof response.content === 'string'
      ? response.content
      : JSON.stringify(response.content);

    return {
      content,
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
    const invokeModel = options?.temperature !== undefined
      ? new ChatAnthropic({
        modelName: config.model,
        anthropicApiKey: config.apiKey,
        temperature: options.temperature,
        maxTokens: options.maxTokens ?? config.maxTokens ?? DEFAULT_CONFIG.maxTokens,
      })
      : model;

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
    const content = typeof response.content === 'string'
      ? response.content
      : JSON.stringify(response.content);

    return {
      content,
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
    const response = await invoke(prompt, options);
    const content = response.content;

    // Try to extract JSON from the response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('LLM response did not contain valid JSON');
    }

    try {
      return JSON.parse(jsonMatch[0]) as T;
    } catch (error) {
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
