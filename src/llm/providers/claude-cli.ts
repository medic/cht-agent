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

import { spawn, ChildProcess } from 'node:child_process';
import { extractJsonObject } from '../json-extract';
import { isBatchFatalError } from '../rate-limit';
import {
  LLMProvider,
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
  /** Timeout in milliseconds (default: 600000 = 10 minutes) */
  timeout?: number;
  /** Max agentic turns - set to 1 for simple completions (default: 1) */
  maxTurns?: number;
  /** Model to use (passed via prompt context, CLI uses account default) */
  model?: string;
  /** Default temperature */
  temperature?: number;
  /** Default max tokens */
  maxTokens?: number;
  /** Pass --dangerously-skip-permissions to the CLI. Default: true (preserves prior behavior). */
  skipPermissions?: boolean;
  /**
   * Maximum number of automatic retries for transient failures (default: 3, or
   * the `CLAUDE_CLI_MAX_RETRIES` env var). 0 disables retries. Only transient
   * errors are retried — see {@link isRetryableCLIError}.
   */
  maxRetries?: number;
  /**
   * Base delay (ms) for exponential backoff between retries (default: 1000, so
   * 1s / 2s / 4s). Mainly a testing/tuning seam; production should leave the
   * default.
   */
  retryBaseDelayMs?: number;
}

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_BASE_DELAY_MS = 1000;

/** Resolve to a non-negative integer, falling back to `fallback` on garbage. */
const toRetryCount = (value: number, fallback: number): number => {
  if (!Number.isFinite(value) || value < 0) return fallback;
  return Math.floor(value);
};

/**
 * Resolve the retry budget from explicit config, then the
 * `CLAUDE_CLI_MAX_RETRIES` env var, then the default.
 */
const resolveMaxRetries = (config: ClaudeCLIConfig): number => {
  if (typeof config.maxRetries === 'number') {
    return toRetryCount(config.maxRetries, DEFAULT_MAX_RETRIES);
  }
  const fromEnv = process.env.CLAUDE_CLI_MAX_RETRIES;
  if (fromEnv !== undefined && fromEnv !== '') {
    return toRetryCount(Number.parseInt(fromEnv, 10), DEFAULT_MAX_RETRIES);
  }
  return DEFAULT_MAX_RETRIES;
};

/** Promise-based sleep used between retry attempts. */
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Decide whether a failed CLI invocation is worth retrying.
 *
 * Only *timeouts* are retried: they are the transient/network failure this
 * provider surfaces, and a fresh spawn often succeeds. Deliberately NOT retried:
 * - Rate-limit / usage-limit and auth notices — the provider classifies these
 *   as batch-fatal (see {@link parseResponse} / `isBatchFatalError`) so the
 *   pipeline stops fast instead of burning backoff against an exhausted quota
 *   or a login that won't fix itself in seconds.
 * - Config errors (`ENOENT`/`EACCES`) — retrying a missing/unexecutable binary
 *   is pointless.
 * - Deterministic non-zero exits / empty results — retrying would mask, not
 *   fix, a real failure.
 */
export function isRetryableCLIError(error: unknown): boolean {
  return /timed out after/i.test(describeError(error));
}

/** Render any thrown value as a log-safe string. */
const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Tools to deny when running the CLI in text-only mode.
 *
 * The CLI does not currently support a wildcard or empty-allow-list flag through
 * spawn without a shell, so we maintain an explicit deny list. Re-evaluate this
 * with each major CLI release.
 */
export const DISALLOWED_TOOLS = [
  'Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep',
  'WebSearch', 'WebFetch', 'Agent', 'NotebookEdit', 'LSP',
] as const;

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

/* istanbul ignore next -- only invoked from the 60s progress interval below */
function totalLength(chunks: string[]): number {
  let total = 0;
  for (const c of chunks) total += c.length;
  return total;
}

/**
 * Extract the CLI's JSON result envelope from stdout (which may have leading
 * non-JSON noise). Returns null if no result envelope is found. Linear scan.
 */
function extractResultEnvelope(stdout: string): CLIResponse | null {
  const start = stdout.indexOf('{');
  const end = stdout.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  const candidate = stdout.slice(start, end + 1);
  if (!/"type"\s*:\s*"result"/.test(candidate)) return null;
  try {
    return JSON.parse(candidate) as CLIResponse;
  } catch (e) {
    console.error('[Claude CLI] Failed to parse matched JSON:', e);
    return null;
  }
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
  const timeout = config.timeout ?? 600000; // 10 minutes
  const maxTurns = config.maxTurns ?? 20; // Multiple turns needed - test files can need 15+
  const modelName = config.model ?? 'claude-cli';
  const skipPermissions = config.skipPermissions ?? true;
  const maxRetries = resolveMaxRetries(config);
  const retryBaseDelayMs = config.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS;
  // Note: CLI doesn't support temperature/maxTokens directly via flags
  // These would be handled by account settings or model defaults

  // Track active processes for cleanup
  const activeProcesses = new Set<ChildProcess>();

  // Install signal handlers so Ctrl+C / SIGTERM kills any in-flight Claude CLI
  // subprocesses. Without this, killing the parent leaves orphans that may
  // continue accruing cost. Multiple provider instances will register multiple
  // handlers; process.once is the right semantics (run at most once per signal).
  /* istanbul ignore next -- signal-driven cleanup, not reachable in unit tests */
  const shutdownHandler = () => {
    for (const proc of activeProcesses) {
      try {
        proc.kill('SIGTERM');
      } catch {
        // best effort
      }
    }
  };
  process.once('SIGINT', shutdownHandler);
  process.once('SIGTERM', shutdownHandler);

  /**
   * Execute Claude CLI with the given prompt
   */
  const executeCLI = async (prompt: string, options?: InvokeOptions): Promise<string> => {
    return new Promise((resolve, reject) => {
      const effectiveMaxTurns = options?.maxTurns ?? maxTurns;
      const args = [
        '-p',
        '--output-format', 'json',
        '--max-turns', effectiveMaxTurns.toString(),
      ];

      if (skipPermissions) {
        args.push('--dangerously-skip-permissions');
      }

      if (options?.disableTools) {
        // Disable all tools to force text-only output via an explicit deny list
        // (see DISALLOWED_TOOLS for the rationale).
        args.push('--disallowedTools', DISALLOWED_TOOLS.join(','));
      }

      const promptPreview = prompt.substring(0, 80).replaceAll('\n', ' ');
      console.log(`[Claude CLI] Starting: "${promptPreview}..." (${prompt.length} chars, maxTurns=${effectiveMaxTurns}, tools=${options?.disableTools ? 'disabled' : 'enabled'})`);
      const startTime = Date.now();

      // Don't use shell: true to avoid prompt being interpreted by shell
      // This allows special characters in prompts to be passed correctly
      const proc = spawn(executablePath, args, {
        cwd: workingDirectory,
        env: { ...process.env },
        stdio: ['pipe', 'pipe', 'pipe'], // Capture all streams
      });

      // Write the prompt to stdin (avoids E2BIG when prompts exceed MAX_ARG_STRLEN
      // = 131,072 bytes on Linux). The CLI reads the `-p` content from stdin when
      // the positional <prompt> argv is absent.
      //
      // `end(prompt)` writes the buffer and then signals EOF. Node queues internally
      // if `prompt.length` exceeds the pipe's high-water mark (typically 16 KiB)
      // and flushes as the kernel drains. No await needed: spawn doesn't read
      // stdout until the child runs.
      proc.stdin?.end(prompt);

      activeProcesses.add(proc);

      const stdoutChunks: string[] = [];
      const stderrChunks: string[] = [];

      // Periodic progress logging every 60 seconds
      /* istanbul ignore next -- 60s interval callback, not reachable in unit tests */
      const progressId = setInterval(() => {
        const elapsed = Math.round((Date.now() - startTime) / 1000);
        const stdoutSize = totalLength(stdoutChunks);
        const stderrSize = totalLength(stderrChunks);
        console.log(`[Claude CLI] Still running... ${elapsed}s elapsed, stdout=${stdoutSize} bytes, stderr=${stderrSize} bytes`);
      }, 60000);

      // Setup timeout
      /* istanbul ignore next -- timeout callback fires only after `timeout` ms */
      const timeoutId = setTimeout(() => {
        clearInterval(progressId);
        proc.kill('SIGTERM');
        activeProcesses.delete(proc);
        const elapsed = Math.round((Date.now() - startTime) / 1000);
        console.log(`[Claude CLI] TIMEOUT after ${elapsed}s`);
        reject(new Error(`Claude CLI timed out after ${timeout}ms`));
      }, timeout);

      proc.stdout?.on('data', (data) => {
        stdoutChunks.push(data.toString());
      });

      proc.stderr?.on('data', (data) => {
        stderrChunks.push(data.toString());
      });

      proc.on('error', (error) => {
        clearTimeout(timeoutId);
        clearInterval(progressId);
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
        clearInterval(progressId);
        activeProcesses.delete(proc);

        const elapsed = Math.round((Date.now() - startTime) / 1000);
        const stdout = stdoutChunks.join('');
        const stderr = stderrChunks.join('');

        console.log(`[Claude CLI] Completed in ${elapsed}s (code=${code}, stdout=${stdout.length} bytes, stderr=${stderr.length} bytes)`);

        if (code !== 0 && !stdout) {
          reject(new Error(`Claude CLI exited with code ${code}: ${stderr || 'Unknown error'}`));
          return;
        }

        resolve(stdout);
      });
    });
  };

  /**
   * Execute the CLI with automatic retries + exponential backoff for transient
   * failures (see {@link isRetryableCLIError}). Wraps only the spawn/transport
   * step: response parsing (and its batch-fatal rate-limit/auth classification)
   * runs downstream in `invoke`, deliberately outside the retry loop.
   */
  const canRetry = (error: unknown, attempt: number): boolean =>
    attempt < maxRetries && isRetryableCLIError(error);

  // Log the transient failure and wait out the exponential backoff (1s/2s/4s
  // at the default base) before the next attempt.
  const backoffAfterFailure = async (error: unknown, attempt: number): Promise<void> => {
    const delay = retryBaseDelayMs * 2 ** attempt;
    console.log(
      `[Claude CLI] Attempt ${attempt + 1}/${maxRetries + 1} failed (${describeError(error)}); retrying in ${delay}ms...`
    );
    await sleep(delay);
  };

  // One attempt. Resolves the CLI stdout on success. On a retryable failure with
  // attempts remaining, backs off and resolves `null` to signal "try again";
  // otherwise rethrows. (executeCLI only ever resolves a string, so `null` is an
  // unambiguous retry sentinel.)
  const attemptExecute = async (
    prompt: string,
    options: InvokeOptions | undefined,
    attempt: number,
  ): Promise<string | null> => {
    try {
      return await executeCLI(prompt, options);
    } catch (error) {
      if (!canRetry(error, attempt)) throw error;
      await backoffAfterFailure(error, attempt);
      return null;
    }
  };

  const executeCLIWithRetry = async (prompt: string, options?: InvokeOptions): Promise<string> => {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const stdout = await attemptExecute(prompt, options, attempt);
      if (stdout !== null) return stdout;
    }
    // Unreachable: the final attempt either returns stdout or rethrows (canRetry
    // is false once attempt === maxRetries), so the loop never falls through.
    /* istanbul ignore next -- defensive, loop always returns or throws above */
    throw new Error('Claude CLI retry loop exhausted without a result');
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

    // Claude CLI can include non-JSON content before the result object.
    const envelope = extractResultEnvelope(stdout);
    if (envelope) return envelope;

    // Try parsing the entire output as JSON
    try {
      return JSON.parse(stdout);
    } catch {
      // No JSON envelope. A plain-text usage/rate-limit or auth notice (the CLI
      // can emit these without a result envelope) must NOT be mistaken for a
      // successful result — classify it as an error so the batch stops instead
      // of silently flagging a PR. See isBatchFatalError / run-pipeline.
      if (isBatchFatalError(stdout)) {
        console.error(`[Claude CLI] Limit/auth notice in plain-text output: ${stdout.substring(0, 200)}`);
        return {
          type: 'result',
          subtype: 'error',
          result: stdout.trim(),
          session_id: '',
          total_cost_usd: 0,
          duration_ms: 0,
          num_turns: 0,
          is_error: true,
        };
      }
      // Otherwise treat stdout as the result. Log first 200 chars for debugging.
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
    const stdout = await executeCLIWithRetry(prompt, options);
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
    const content = response.content;

    // Check if content is empty or undefined
    if (!content || content.trim() === '') {
      throw new Error('CLI returned empty response');
    }

    // Strip any ```json fence and extract the outermost JSON object.
    const extracted = extractJsonObject(content);
    if (!extracted) {
      throw new Error('CLI response did not contain valid JSON object');
    }

    let jsonStr = extracted;

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

  // CLI provider declares itself as 'anthropic' for compatibility with LLMProvider consumers.
  // honorsCustomTools is false: the CLI ignores custom tool definitions and runs its own
  // agentic loop, which is the explicit capability the providerType shim hides.
  const provider: LLMProvider = {
    providerType: 'anthropic',
    modelName,
    honorsCustomTools: false,
    invoke,
    invokeWithMessages,
    invokeForJSON,
  };
  return provider;
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
