/**
 * LLM Factory
 *
 * Creates LLM providers based on configuration.
 * Reads configuration from environment variables.
 *
 * Supports two modes:
 * - API mode (LLM_PROVIDER=anthropic): Uses Anthropic API with API key
 * - CLI mode (LLM_PROVIDER=claude-cli): Uses Claude Code CLI (no API key needed)
 */

import { LLMProvider, LLMConfig, LLMProviderType, DEFAULT_MODELS } from './types';
import { createAnthropicProvider } from './providers/anthropic';
import { createClaudeCLIProvider, ClaudeCLIConfig } from './providers/claude-cli';

/**
 * Extended provider type that includes CLI option
 */
export type ExtendedProviderType = LLMProviderType | 'claude-cli';

/**
 * Check if using CLI provider
 */
export const isUsingCLIProvider = (): boolean => {
  return process.env.LLM_PROVIDER === 'claude-cli';
};

/**
 * Get LLM configuration from environment variables
 */
export const getLLMConfigFromEnv = (): LLMConfig => {
  const providerEnv = process.env.LLM_PROVIDER || 'anthropic';

  // Handle CLI provider separately (doesn't need API key)
  if (providerEnv === 'claude-cli') {
    // Return a minimal config for CLI - the actual CLI config is handled separately
    return {
      provider: 'anthropic', // CLI is anthropic-compatible
      model: process.env.LLM_MODEL || 'claude-cli',
      apiKey: 'cli-mode', // Placeholder - not used by CLI
      temperature: process.env.LLM_TEMPERATURE
        ? parseFloat(process.env.LLM_TEMPERATURE)
        : undefined,
      maxTokens: process.env.LLM_MAX_TOKENS
        ? parseInt(process.env.LLM_MAX_TOKENS, 10)
        : undefined,
    };
  }

  const provider = providerEnv as LLMProviderType;

  // Validate provider
  const supportedProviders: LLMProviderType[] = ['anthropic', 'openai', 'gemini'];
  if (!supportedProviders.includes(provider)) {
    throw new Error(
      `Unsupported LLM provider: ${providerEnv}. Supported: ${supportedProviders.join(', ')}, claude-cli`
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
 * Get CLI configuration from environment variables
 */
export const getCLIConfigFromEnv = (): ClaudeCLIConfig => {
  return {
    executablePath: process.env.CLAUDE_CLI_PATH || 'claude',
    workingDirectory: process.env.CHT_CORE_PATH || process.cwd(),
    timeout: process.env.CLAUDE_CLI_TIMEOUT
      ? parseInt(process.env.CLAUDE_CLI_TIMEOUT, 10)
      : 300000,
    maxTurns: process.env.CLAUDE_CLI_MAX_TURNS
      ? parseInt(process.env.CLAUDE_CLI_MAX_TURNS, 10)
      : 20, // CLI needs multiple turns to complete (test files can need 15+ turns)
    model: process.env.LLM_MODEL || 'claude-cli',
    temperature: process.env.LLM_TEMPERATURE
      ? parseFloat(process.env.LLM_TEMPERATURE)
      : undefined,
    maxTokens: process.env.LLM_MAX_TOKENS
      ? parseInt(process.env.LLM_MAX_TOKENS, 10)
      : undefined,
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
 *
 * Automatically detects CLI mode when LLM_PROVIDER=claude-cli
 */
export const createLLMProviderFromEnv = (): LLMProvider => {
  // Check if using CLI provider
  if (isUsingCLIProvider()) {
    const cliConfig = getCLIConfigFromEnv();
    console.log(`[LLM Factory] Using Claude Code CLI provider`);
    console.log(`[LLM Factory] CLI path: ${cliConfig.executablePath}`);
    console.log(`[LLM Factory] Working directory: ${cliConfig.workingDirectory}`);
    return createClaudeCLIProvider(cliConfig);
  }

  // Use API-based provider
  const config = getLLMConfigFromEnv();
  console.log(`[LLM Factory] Using ${config.provider} API provider`);
  console.log(`[LLM Factory] Model: ${config.model}`);
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
