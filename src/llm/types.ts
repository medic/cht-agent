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
 * Tool definition for LLM tool use (Anthropic API)
 */
export interface LLMToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/**
 * Handler that executes tool calls and returns results.
 * The code gen module provides this to map tool names to actual functions.
 */
export type ToolHandler = (toolName: string, toolInput: Record<string, unknown>) => Promise<string>;

/**
 * Options for invoking the LLM
 */
export interface InvokeOptions {
  temperature?: number;
  maxTokens?: number;
  stopSequences?: string[];
  /** Override max agentic turns for CLI provider */
  maxTurns?: number;
  /** Disable all built-in tools in CLI provider (forces text-only output) */
  disableTools?: boolean;
  /** Tool definitions for Anthropic API tool use */
  tools?: LLMToolDefinition[];
  /** Handler to execute tool calls — required when tools are provided */
  toolHandler?: ToolHandler;
  /** Max tool-use round trips before forcing a text response (default: 10) */
  maxToolRounds?: number;
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
  maxTokens: 65536, // Opus 4.6 supports 128K output, Sonnet/Haiku 4.x support 64K
} as const;

/**
 * Default models for each provider
 */
export const DEFAULT_MODELS: Record<LLMProviderType, string> = {
  anthropic: 'claude-opus-4-6',
  openai: 'gpt-4-turbo-preview',
  gemini: 'gemini-pro',
} as const;

/**
 * Known max output token limits per model.
 * Used to cap maxTokens so the API doesn't reject oversized requests.
 * Models not listed here default to DEFAULT_CONFIG.maxTokens.
 */
export const MODEL_MAX_OUTPUT_TOKENS: Record<string, number> = {
  'claude-opus-4-6': 128000,
  'claude-sonnet-4-6': 64000,
  'claude-haiku-4-5': 64000,
  'claude-haiku-4-5-20251001': 64000,
  'claude-opus-4-5': 64000,
  'claude-opus-4-5-20251101': 64000,
  'claude-sonnet-4-5': 64000,
  'claude-sonnet-4-5-20250929': 64000,
  'claude-opus-4-1': 32000,
  'claude-opus-4-1-20250805': 32000,
  'claude-opus-4-0': 32000,
  'claude-opus-4-20250514': 32000,
  'claude-sonnet-4-0': 64000,
  'claude-sonnet-4-20250514': 64000,
};

/**
 * Get the max output tokens for a given model.
 * Returns the known limit or DEFAULT_CONFIG.maxTokens as fallback.
 */
export function getMaxOutputTokens(model: string): number {
  return MODEL_MAX_OUTPUT_TOKENS[model] ?? DEFAULT_CONFIG.maxTokens;
}

/**
 * Cap a requested maxTokens value to the model's actual limit.
 */
export function capMaxTokens(model: string, requested: number): number {
  const limit = getMaxOutputTokens(model);
  return Math.min(requested, limit);
}

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
