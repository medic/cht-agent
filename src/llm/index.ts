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
  APIProviderConfig,
  CLIProviderConfig,
  APIProviderType,
  LLMMessage,
  LLMResponse,
  InvokeOptions,
  LLMToolDefinition,
  ToolHandler,
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
  getAPIConfigFromEnv,
  getCLIConfigFromEnv,
  isUsingCLIProvider,
  ExtendedProviderType,
} from './factory';

// Export individual providers (for direct use if needed)
export { createAnthropicProvider } from './providers/anthropic';
export { createClaudeCLIProvider, validateClaudeCLI, ClaudeCLIConfig } from './providers/claude-cli';
