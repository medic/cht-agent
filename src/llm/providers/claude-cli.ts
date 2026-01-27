/**
 * Claude Code CLI LLM Provider
 *
 * Drop-in replacement for the Anthropic API provider that uses
 * the Claude Code CLI instead. This allows using Claude MAX
 * subscriptions without requiring API keys.
 *
 * Prerequisites:
 * - Claude Code CLI installed: npm install -g @anthropic-ai/claude-code
 * - Logged in via: claude login
 */

import { spawn, ChildProcess } from 'child_process';
import {
  LLMProvider,
  LLMProviderType,
  LLMMessage,
  LLMResponse,
  InvokeOptions,
} from '../types';

/**
 * Configuration for Claude CLI provider
 */
export interface ClaudeCLIConfig {
  /** Path to Claude CLI executable (default: "claude") */
  executablePath?: string;
  /** Working directory for CLI execution */
  workingDirectory?: string;
  /** Timeout in milliseconds (default: 300000 = 5 minutes) */
  timeout?: number;
  /** Max agentic turns - set to 1 for simple completions (default: 1) */
  maxTurns?: number;
  /** Model to use (passed via prompt context, CLI uses account default) */
  model?: string;
  /** Default temperature */
  temperature?: number;
  /** Default max tokens */
  maxTokens?: number;
}

/**
 * Response structure from Claude CLI JSON output
 */
interface CLIResponse {
  type: 'result';
  subtype: 'success' | 'error';
  result: string;
  session_id: string;
  total_cost_usd: number;
  duration_ms: number;
  num_turns: number;
  is_error: boolean;
}

/**
 * Create a Claude CLI LLM provider
 *
 * This provider spawns the Claude Code CLI for each request,
 * making it compatible with Claude MAX subscriptions.
 */
export const createClaudeCLIProvider = (config: ClaudeCLIConfig = {}): LLMProvider => {
  const executablePath = config.executablePath ?? 'claude';
  const workingDirectory = config.workingDirectory ?? process.cwd();
  const timeout = config.timeout ?? 300000; // 5 minutes
  const maxTurns = config.maxTurns ?? 20; // Multiple turns needed - test files can need 15+
  const modelName = config.model ?? 'claude-cli';
  // Note: CLI doesn't support temperature/maxTokens directly via flags
  // These would be handled by account settings or model defaults

  // Track active processes for cleanup
  const activeProcesses = new Set<ChildProcess>();

  /**
   * Execute Claude CLI with the given prompt
   */
  const executeCLI = async (prompt: string, _options?: InvokeOptions): Promise<string> => {
    return new Promise((resolve, reject) => {
      const args = [
        '-p', prompt,
        '--output-format', 'json',
        '--max-turns', maxTurns.toString(),
      ];

      // Note: CLI doesn't support temperature/maxTokens directly
      // These are handled by the account settings or model defaults

      // Don't use shell: true to avoid prompt being interpreted by shell
      // This allows special characters in prompts to be passed correctly
      const proc = spawn(executablePath, args, {
        cwd: workingDirectory,
        env: { ...process.env },
        stdio: ['pipe', 'pipe', 'pipe'], // Capture all streams
      });

      // Close stdin immediately to signal no more input
      // This prevents the CLI from waiting for user input
      proc.stdin?.end();

      activeProcesses.add(proc);

      const stdoutChunks: string[] = [];
      const stderrChunks: string[] = [];

      // Setup timeout
      const timeoutId = setTimeout(() => {
        proc.kill('SIGTERM');
        activeProcesses.delete(proc);
        reject(new Error(`Claude CLI timed out after ${timeout}ms`));
      }, timeout);

      proc.stdout.on('data', (data) => {
        stdoutChunks.push(data.toString());
      });

      proc.stderr.on('data', (data) => {
        stderrChunks.push(data.toString());
      });

      proc.on('error', (error) => {
        clearTimeout(timeoutId);
        activeProcesses.delete(proc);

        const nodeError = error as NodeJS.ErrnoException;
        if (nodeError.code === 'ENOENT') {
          reject(new Error(
            `Claude Code CLI not found at "${executablePath}". ` +
            'Install with: npm install -g @anthropic-ai/claude-code'
          ));
        } else if (nodeError.code === 'EACCES') {
          reject(new Error(
            'Permission denied executing Claude CLI. Check file permissions.'
          ));
        } else {
          reject(new Error(`Failed to execute Claude CLI: ${error.message}`));
        }
      });

      proc.on('close', (code) => {
        clearTimeout(timeoutId);
        activeProcesses.delete(proc);

        const stdout = stdoutChunks.join('');
        const stderr = stderrChunks.join('');

        if (code !== 0 && !stdout) {
          reject(new Error(`Claude CLI exited with code ${code}: ${stderr || 'Unknown error'}`));
          return;
        }

        resolve(stdout);
      });
    });
  };

  /**
   * Parse CLI JSON response
   */
  const parseResponse = (stdout: string): CLIResponse => {
    // Handle empty stdout
    if (!stdout || stdout.trim() === '') {
      console.error('[Claude CLI] Warning: CLI returned empty stdout');
      return {
        type: 'result',
        subtype: 'error',
        result: '',
        session_id: '',
        total_cost_usd: 0,
        duration_ms: 0,
        num_turns: 0,
        is_error: true,
      };
    }

    // Claude CLI can include non-JSON content before the result
    // Look for the JSON result object
    const jsonMatch = stdout.match(/\{[\s\S]*"type"\s*:\s*"result"[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch (e) {
        console.error('[Claude CLI] Failed to parse matched JSON:', e);
      }
    }

    // Try parsing the entire output as JSON
    try {
      return JSON.parse(stdout);
    } catch {
      // If no JSON found, treat stdout as the result
      // Log first 200 chars for debugging
      console.warn(`[Claude CLI] Non-JSON response (first 200 chars): ${stdout.substring(0, 200)}`);
      return {
        type: 'result',
        subtype: 'success',
        result: stdout.trim(),
        session_id: '',
        total_cost_usd: 0,
        duration_ms: 0,
        num_turns: 1,
        is_error: false,
      };
    }
  };

  /**
   * Invoke with a simple prompt
   */
  const invoke = async (prompt: string, options?: InvokeOptions): Promise<LLMResponse> => {
    const stdout = await executeCLI(prompt, options);
    const parsed = parseResponse(stdout);

    if (parsed.is_error) {
      throw new Error(`Claude CLI error: ${parsed.result}`);
    }

    // Ensure result is always a string
    const result = parsed.result ?? '';
    if (!result && !parsed.is_error) {
      console.warn('[Claude CLI] Warning: CLI returned empty result');
    }

    return {
      content: result,
      model: modelName,
      usage: undefined, // CLI doesn't provide token usage
      stopReason: parsed.subtype === 'success' ? 'end_turn' : 'error',
    };
  };

  /**
   * Invoke with conversation messages
   */
  const invokeWithMessages = async (
    messages: LLMMessage[],
    options?: InvokeOptions
  ): Promise<LLMResponse> => {
    // Convert messages to a single prompt
    // Claude CLI doesn't support multi-turn in the same way as API
    const formattedMessages = messages.map((msg) => {
      switch (msg.role) {
        case 'system':
          return `[System]: ${msg.content}`;
        case 'user':
          return `[User]: ${msg.content}`;
        case 'assistant':
          return `[Assistant]: ${msg.content}`;
        default:
          return msg.content;
      }
    }).join('\n\n');

    const prompt = `${formattedMessages}\n\n[Assistant]:`;

    return invoke(prompt, options);
  };

  /**
   * Invoke and parse response as JSON
   */
  const invokeForJSON = async <T>(prompt: string, options?: InvokeOptions): Promise<T> => {
    // Add JSON instruction to prompt
    const jsonPrompt = `${prompt}

IMPORTANT: Respond with valid JSON only. Do not include any text before or after the JSON object.`;

    const response = await invoke(jsonPrompt, options);
    let content = response.content;

    // Check if content is empty or undefined
    if (!content || content.trim() === '') {
      throw new Error('CLI returned empty response');
    }

    // Strip markdown code blocks if present
    const codeBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      content = codeBlockMatch[1].trim();
    }

    // Try to extract JSON object from the response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('CLI response did not contain valid JSON object');
    }

    let jsonStr = jsonMatch[0];

    // Clean up common JSON issues
    jsonStr = jsonStr.replace(/,(\s*[}\]])/g, '$1');

    try {
      return JSON.parse(jsonStr) as T;
    } catch (error) {
      const snippet = jsonStr.substring(0, 500);
      console.error(`[Claude CLI] JSON parse error. First 500 chars: ${snippet}...`);
      throw new Error(`Failed to parse CLI response as JSON: ${error}`);
    }
  };

  return {
    providerType: 'anthropic' as LLMProviderType, // Compatible with anthropic type
    modelName,
    invoke,
    invokeWithMessages,
    invokeForJSON,
  };
};

/**
 * Validate Claude CLI installation
 */
export const validateClaudeCLI = async (
  executablePath = 'claude'
): Promise<{ valid: boolean; version?: string; error?: string }> => {
  return new Promise((resolve) => {
    const proc = spawn(executablePath, ['--version'], {
      timeout: 5000,
    });

    let stdout = '';
    proc.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ valid: true, version: stdout.trim() });
      } else {
        resolve({ valid: false, error: `CLI exited with code ${code}` });
      }
    });

    proc.on('error', (err) => {
      resolve({
        valid: false,
        error: `CLI not found at "${executablePath}": ${err.message}`,
      });
    });
  });
};
