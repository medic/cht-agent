/**
 * LLM Factory
 *
 * Creates LLM providers based on configuration.
 * Reads configuration from environment variables.
 *
 * Supports two modes:
 * - API mode (LLM_PROVIDER=anthropic|openai|gemini): Uses an API-keyed provider
 * - CLI mode (LLM_PROVIDER=claude-cli): Uses the Claude Code CLI binary (no API key)
 *
 * The two modes are structurally distinct config types (APIProviderConfig vs
 * CLIProviderConfig) so functions that accept one cannot be miscalled with the other.
 */

import {
  LLMProvider,
  LLMConfig,
  APIProviderConfig,
  CLIProviderConfig,
  APIProviderType,
  DEFAULT_MODELS,
} from './types';
import { createAnthropicProvider } from './providers/anthropic';
import { createClaudeCLIProvider } from './providers/claude-cli';

/**
 * Extended provider type that includes CLI option
 */
export type ExtendedProviderType = APIProviderType | 'claude-cli';

/**
 * Check if using CLI provider
 */
export const isUsingCLIProvider = (): boolean => {
  return process.env.LLM_PROVIDER === 'claude-cli';
};

/**
 * Resolve the API key env var for a given API provider.
 * Extend when adding new API providers.
 */
const resolveAPIKey = (provider: APIProviderType): string | undefined => {
  switch (provider) {
    case 'anthropic': return process.env.ANTHROPIC_API_KEY;
    case 'openai':    return process.env.OPENAI_API_KEY;
    case 'gemini':    return process.env.GEMINI_API_KEY;
  }
};

/**
 * Read API-keyed LLM configuration from environment variables.
 * Throws if called in CLI mode — use getCLIConfigFromEnv() or createLLMProviderFromEnv() instead.
 */
export const getAPIConfigFromEnv = (): APIProviderConfig => {
  if (isUsingCLIProvider()) {
    throw new Error(
      'getAPIConfigFromEnv() is not applicable in CLI mode (LLM_PROVIDER=claude-cli). ' +
      'Use getCLIConfigFromEnv() or createLLMProviderFromEnv() instead.'
    );
  }

  const providerEnv = process.env.LLM_PROVIDER || 'anthropic';
  const supportedProviders: APIProviderType[] = ['anthropic', 'openai', 'gemini'];
  if (!supportedProviders.includes(providerEnv as APIProviderType)) {
    throw new Error(
      `Unsupported LLM provider: ${providerEnv}. Supported API providers: ${supportedProviders.join(', ')}, plus claude-cli`
    );
  }
  const provider = providerEnv as APIProviderType;

  const apiKey = resolveAPIKey(provider);
  if (!apiKey) {
    throw new Error(`API key not found for provider: ${provider}`);
  }

  const model = process.env.LLM_MODEL || DEFAULT_MODELS[provider];
  const temperature = process.env.LLM_TEMPERATURE
    ? parseFloat(process.env.LLM_TEMPERATURE)
    : undefined;
  const maxTokens = process.env.LLM_MAX_TOKENS
    ? Number.parseInt(process.env.LLM_MAX_TOKENS, 10)
    : undefined;

  return {
    mode: 'api',
    provider,
    apiKey,
    model,
    temperature,
    maxTokens,
  };
};

/**
 * Read CLI configuration from environment variables.
 */
export const getCLIConfigFromEnv = (): CLIProviderConfig => {
  return {
    mode: 'cli',
    provider: 'claude-cli',
    executablePath: process.env.CLAUDE_CLI_PATH || 'claude',
    workingDirectory: process.env.CHT_CORE_PATH || process.cwd(),
    timeout: process.env.CLAUDE_CLI_TIMEOUT
      ? Number.parseInt(process.env.CLAUDE_CLI_TIMEOUT, 10)
      : 600000, // 10 minutes — code gen can be slow
    maxTurns: process.env.CLAUDE_CLI_MAX_TURNS
      ? Number.parseInt(process.env.CLAUDE_CLI_MAX_TURNS, 10)
      : 20, // CLI needs multiple turns to complete (test files can need 15+ turns)
    model: process.env.LLM_MODEL || 'claude-cli',
    temperature: process.env.LLM_TEMPERATURE
      ? parseFloat(process.env.LLM_TEMPERATURE)
      : undefined,
    maxTokens: process.env.LLM_MAX_TOKENS
      ? Number.parseInt(process.env.LLM_MAX_TOKENS, 10)
      : undefined,
    skipPermissions: process.env.CLAUDE_CLI_SKIP_PERMISSIONS !== 'false',
  };
};

/**
 * Read LLM configuration from environment variables.
 * Returns a discriminated union — narrow on config.mode before reading apiKey or CLI-specific fields.
 */
export const getLLMConfigFromEnv = (): LLMConfig => {
  return isUsingCLIProvider() ? getCLIConfigFromEnv() : getAPIConfigFromEnv();
};

/**
 * Create an LLM provider based on configuration
 */
export const createLLMProvider = (config: LLMConfig): LLMProvider => {
  if (config.mode === 'cli') {
    return createClaudeCLIProvider(config);
  }
  switch (config.provider) {
    case 'anthropic':
      return createAnthropicProvider(config);

    case 'openai':
      throw new Error('OpenAI provider not yet implemented. Coming soon!');

    case 'gemini':
      throw new Error('Gemini provider not yet implemented. Coming soon!');
  }
};

/**
 * Create an LLM provider from environment configuration
 * Convenience function that combines getLLMConfigFromEnv and createLLMProvider
 *
 * Automatically detects CLI mode when LLM_PROVIDER=claude-cli
 */
export const createLLMProviderFromEnv = (): LLMProvider => {
  if (isUsingCLIProvider()) {
    const cliConfig = getCLIConfigFromEnv();
    console.log(`[LLM Factory] Using Claude Code CLI provider`);
    console.log(`[LLM Factory] CLI path: ${cliConfig.executablePath}`);
    console.log(`[LLM Factory] Working directory: ${cliConfig.workingDirectory}`);
    console.log(`[LLM Factory] Skip permissions: ${cliConfig.skipPermissions ?? true}`);
    return createClaudeCLIProvider(cliConfig);
  }

  const config = getAPIConfigFromEnv();
  console.log(`[LLM Factory] Using ${config.provider} API provider`);
  console.log(`[LLM Factory] Model: ${config.model}`);
  return createLLMProvider(config);
};

/**
 * Create an API-keyed LLM provider with custom options.
 * Not applicable to CLI mode — throws if LLM_PROVIDER=claude-cli.
 * Use createLLMProviderFromEnv() instead for CLI mode.
 */
export const createLLMProviderWithOptions = (
  options: Partial<APIProviderConfig> = {}
): LLMProvider => {
  if (isUsingCLIProvider()) {
    throw new Error(
      'createLLMProviderWithOptions() is not applicable in CLI mode (LLM_PROVIDER=claude-cli). ' +
      'Use createLLMProviderFromEnv() instead.'
    );
  }

  const envConfig = getAPIConfigFromEnv();

  const config: APIProviderConfig = {
    ...envConfig,
    ...options,
    mode: 'api',
    provider: options.provider || envConfig.provider,
    model: options.model || envConfig.model,
    apiKey: options.apiKey || envConfig.apiKey,
  };

  return createLLMProvider(config);
};
