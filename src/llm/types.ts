/**
 * LLM Provider Types
 *
 * Defines the interface and types for LLM providers.
 * This abstraction allows easy switching between different LLM providers
 * (Claude, GPT, Gemini, etc.) without changing the consuming code.
 */

/**
 * Supported LLM providers
 */
export type LLMProviderType = 'anthropic' | 'openai' | 'gemini';

/**
 * LLM configuration from environment
 */
export interface LLMConfig {
  provider: LLMProviderType;
  model: string;
  apiKey: string;
  temperature?: number;
  maxTokens?: number;
}

/**
 * Message role types
 */
export type MessageRole = 'user' | 'assistant' | 'system';

/**
 * Message structure for LLM conversations
 */
export interface LLMMessage {
  role: MessageRole;
  content: string;
}

/**
 * Options for invoking the LLM
 */
export interface InvokeOptions {
  temperature?: number;
  maxTokens?: number;
  stopSequences?: string[];
}

/**
 * Response from LLM invocation
 */
export interface LLMResponse {
  content: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
  model: string;
  stopReason?: string;
}

/**
 * LLM Provider Interface
 *
 * All LLM providers must implement this interface.
 * This ensures consistent behavior across different providers.
 */
export interface LLMProvider {
  /**
   * Get the provider type
   */
  readonly providerType: LLMProviderType;

  /**
   * Get the model name
   */
  readonly modelName: string;

  /**
   * Invoke the LLM with a simple prompt
   */
  invoke(prompt: string, options?: InvokeOptions): Promise<LLMResponse>;

  /**
   * Invoke the LLM with a conversation (multiple messages)
   */
  invokeWithMessages(messages: LLMMessage[], options?: InvokeOptions): Promise<LLMResponse>;

  /**
   * Invoke and parse the response as JSON
   * Useful for structured output
   */
  invokeForJSON<T>(prompt: string, options?: InvokeOptions): Promise<T>;
}

/**
 * Default configuration values
 */
export const DEFAULT_CONFIG = {
  temperature: 0.3,
  maxTokens: 16384, // Increased for code generation tasks
} as const;

/**
 * Default models for each provider
 * Note: Opus 4.5 requires patch-package fix for LangChain top_p bug
 * See: patches/@langchain+anthropic+0.3.34.patch
 */
export const DEFAULT_MODELS: Record<LLMProviderType, string> = {
  anthropic: 'claude-opus-4-5-20251101',
  openai: 'gpt-4-turbo-preview',
  gemini: 'gemini-pro',
} as const;

/**
 * Get the configured model name from environment or use default
 * Reads from LLM_MODEL environment variable
 */
export function getConfiguredModel(provider: LLMProviderType = 'anthropic'): string {
  const envModel = process.env.LLM_MODEL;
  if (envModel && envModel.trim()) {
    return envModel.trim();
  }
  return DEFAULT_MODELS[provider];
}
