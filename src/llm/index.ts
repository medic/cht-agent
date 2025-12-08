/**
 * LLM Module
 *
 * Provides an abstraction layer for LLM providers.
 * Supports multiple providers (Claude, GPT, Gemini) through a unified interface.
 *
 * Usage:
 *   import { createLLMProviderFromEnv } from './llm';
 *   const llm = createLLMProviderFromEnv();
 *   const response = await llm.invoke('Your prompt here');
 */

// Export types
export {
  LLMProvider,
  LLMConfig,
  LLMProviderType,
  LLMMessage,
  LLMResponse,
  InvokeOptions,
  MessageRole,
  DEFAULT_CONFIG,
  DEFAULT_MODELS,
} from './types';

// Export factory functions
export {
  createLLMProvider,
  createLLMProviderFromEnv,
  createLLMProviderWithOptions,
  getLLMConfigFromEnv,
} from './factory';

// Export individual providers (for direct use if needed)
export { createAnthropicProvider } from './providers/anthropic';
