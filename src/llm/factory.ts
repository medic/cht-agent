/**
 * LLM Factory
 *
 * Creates LLM providers based on configuration.
 * Reads configuration from environment variables.
 */

import { LLMProvider, LLMConfig, LLMProviderType, DEFAULT_MODELS } from './types';
import { createAnthropicProvider } from './providers/anthropic';

/**
 * Get LLM configuration from environment variables
 */
export const getLLMConfigFromEnv = (): LLMConfig => {
  const provider = (process.env.LLM_PROVIDER || 'anthropic') as LLMProviderType;

  // Validate provider
  const supportedProviders: LLMProviderType[] = ['anthropic', 'openai', 'gemini'];
  if (!supportedProviders.includes(provider)) {
    throw new Error(
      `Unsupported LLM provider: ${provider}. Supported: ${supportedProviders.join(', ')}`
    );
  }

  // Get API key based on provider
  let apiKey: string | undefined;
  switch (provider) {
    case 'anthropic':
      apiKey = process.env.ANTHROPIC_API_KEY;
      break;
    case 'openai':
      apiKey = process.env.OPENAI_API_KEY;
      break;
    case 'gemini':
      apiKey = process.env.GEMINI_API_KEY;
      break;
  }

  if (!apiKey) {
    throw new Error(`API key not found for provider: ${provider}`);
  }

  // Get model name (use default if not specified)
  const model = process.env.LLM_MODEL || DEFAULT_MODELS[provider];

  // Get optional settings
  const temperature = process.env.LLM_TEMPERATURE
    ? parseFloat(process.env.LLM_TEMPERATURE)
    : undefined;
  const maxTokens = process.env.LLM_MAX_TOKENS
    ? parseInt(process.env.LLM_MAX_TOKENS, 10)
    : undefined;

  return {
    provider,
    model,
    apiKey,
    temperature,
    maxTokens,
  };
};

/**
 * Create an LLM provider based on configuration
 */
export const createLLMProvider = (config: LLMConfig): LLMProvider => {
  switch (config.provider) {
    case 'anthropic':
      return createAnthropicProvider(config);

    case 'openai':
      // TODO: Implement OpenAI provider when needed
      throw new Error('OpenAI provider not yet implemented. Coming soon!');

    case 'gemini':
      // TODO: Implement Gemini provider when needed
      throw new Error('Gemini provider not yet implemented. Coming soon!');

    default:
      throw new Error(`Unknown provider: ${config.provider}`);
  }
};

/**
 * Create an LLM provider from environment configuration
 * Convenience function that combines getLLMConfigFromEnv and createLLMProvider
 */
export const createLLMProviderFromEnv = (): LLMProvider => {
  const config = getLLMConfigFromEnv();
  return createLLMProvider(config);
};

/**
 * Create an LLM provider with custom options
 * Allows overriding environment settings
 */
export const createLLMProviderWithOptions = (
  options: Partial<LLMConfig> = {}
): LLMProvider => {
  const envConfig = getLLMConfigFromEnv();

  const config: LLMConfig = {
    ...envConfig,
    ...options,
    // Ensure required fields are present
    provider: options.provider || envConfig.provider,
    model: options.model || envConfig.model,
    apiKey: options.apiKey || envConfig.apiKey,
  };

  return createLLMProvider(config);
};
