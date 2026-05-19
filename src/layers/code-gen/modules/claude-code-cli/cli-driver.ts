/**
 * Tool-using Claude Code CLI driver.
 *
 * Unlike `src/llm/providers/claude-cli.ts` (which spawns the CLI as a text-only LLM
 * oracle by deny-listing every tool), this driver spawns the CLI as a tool-using
 * agent with `Read`, `Write`, `Edit`, `Grep`, `Glob` enabled. The CLI does the file
 * I/O directly in the working directory; this module just sets up the process and
 * captures the JSON transcript.
 */

import { spawn, ChildProcess } from 'node:child_process';
import { readEnv } from '../../../../utils/env';

export enum ClaudeCliPhase {
  Plan = 'plan',
  Execute = 'execute',
}

export interface SpawnOptions {
  /** Working directory for the CLI. Should be the cht-core repo root. */
  cwd: string;
  /** Tools the CLI is allowed to use (e.g., ['Read', 'Write', 'Edit', 'Grep', 'Glob']). */
  allowedTools: string[];
  /** Permission mode for the CLI's tool-call gating. `acceptEdits` skips the prompt. */
  permissionMode: 'default' | 'acceptEdits' | 'bypassPermissions';
  /** Phase tag for logging. */
  phase: ClaudeCliPhase;
  /** Per-spawn timeout in milliseconds. Defaults to 30 minutes for execute, 10 for plan. */
  timeoutMs?: number;
  /** Max agentic turns the CLI is allowed. Tool-using agents need more than text oracles. */
  maxTurns?: number;
}

const DEFAULT_EXECUTE_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_PLAN_TIMEOUT_MS = 10 * 60 * 1000;
/**
 * Max agentic turns the CLI is allowed. v5 runner observed 12-item plans
 * averaging 5-6 tool calls per item; 150 leaves comfortable headroom for plans
 * up to ~20 items. Larger plans require manual scope splitting.
 */
export const DEFAULT_MAX_TURNS = 150;

/**
 * Spawn the Claude Code CLI as a tool-using agent.
 *
 * Returns the raw stdout (typically the CLI's JSON transcript). The caller is
 * responsible for parsing the JSON and extracting the assistant's summary text.
 */
export async function spawnClaudeCli(prompt: string, opts: SpawnOptions): Promise<string> {
  const cliPath = readEnv('CLAUDE_CLI_PATH') || 'claude';
  const timeoutMs = opts.timeoutMs ?? (opts.phase === ClaudeCliPhase.Execute
    ? DEFAULT_EXECUTE_TIMEOUT_MS
    : DEFAULT_PLAN_TIMEOUT_MS);
  const maxTurns = opts.maxTurns ?? DEFAULT_MAX_TURNS;

  return new Promise<string>((resolve, reject) => {
    const args = [
      '-p',
      '--output-format', 'json',
      '--max-turns', maxTurns.toString(),
      '--allowedTools', opts.allowedTools.join(','),
      '--permission-mode', opts.permissionMode,
    ];

    const promptPreview = prompt.substring(0, 80).replace(/\n/g, ' ');
    console.log(
      `[claude-code-cli ${opts.phase}] Starting: "${promptPreview}..." ` +
      `(${prompt.length} chars, tools=${opts.allowedTools.join('+')}, maxTurns=${maxTurns})`
    );
    const startTime = Date.now();

    const proc: ChildProcess = spawn(cliPath, args, {
      cwd: opts.cwd,
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Pipe the prompt via stdin (R4 lesson; avoids E2BIG).
    proc.stdin?.end(prompt);

    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];

    const progressId = setInterval(() => {
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      const stdoutSize = stdoutChunks.reduce((sum, c) => sum + c.length, 0);
      console.log(`[claude-code-cli ${opts.phase}] Still running... ${elapsed}s elapsed, stdout=${stdoutSize} bytes`);
    }, 60_000);

    const timeoutId = setTimeout(() => {
      clearInterval(progressId);
      proc.kill('SIGTERM');
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      console.log(`[claude-code-cli ${opts.phase}] TIMEOUT after ${elapsed}s`);
      reject(new Error(`Claude CLI ${opts.phase} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    proc.stdout?.on('data', (data) => { stdoutChunks.push(data.toString()); });
    proc.stderr?.on('data', (data) => { stderrChunks.push(data.toString()); });

    proc.on('error', (error) => {
      clearTimeout(timeoutId);
      clearInterval(progressId);
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code === 'ENOENT') {
        reject(new Error(
          `Claude Code CLI not found at "${cliPath}". ` +
          'Install with: npm install -g @anthropic-ai/claude-code'
        ));
        return;
      }
      reject(new Error(`Failed to execute Claude CLI: ${error.message}`));
    });

    proc.on('close', (code) => {
      clearTimeout(timeoutId);
      clearInterval(progressId);

      const stdout = stdoutChunks.join('');
      const stderr = stderrChunks.join('');
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      console.log(
        `[claude-code-cli ${opts.phase}] Completed in ${elapsed}s ` +
        `(code=${code}, stdout=${stdout.length} bytes, stderr=${stderr.length} bytes)`
      );

      if (code !== 0 && !stdout) {
        reject(new Error(`Claude CLI ${opts.phase} exited with code ${code}: ${stderr || 'Unknown error'}`));
        return;
      }
      if (!stdout.trim()) {
        reject(new Error(`Claude CLI ${opts.phase} returned empty stdout`));
        return;
      }
      resolve(stdout);
    });
  });
}

/**
 * Typed result extracted from the CLI's JSON transcript. Preserves the fields
 * the orchestrator needs to detect partial-completion (is_error, num_turns) in
 * addition to the result text.
 */
export interface ClaudeCliResult {
  result: string;
  isError: boolean;
  numTurns: number;
  sessionId?: string;
  cost?: number;
}

/**
 * Parse the CLI's JSON output into a typed result. Empty stdout is treated as
 * an error case (isError=true) so callers can surface partial completions.
 * Unparseable stdout falls back to the raw text with isError=false.
 */
export function parseCliResult(stdout: string): ClaudeCliResult {
  if (!stdout || stdout.trim() === '') {
    return { result: '', isError: true, numTurns: 0 };
  }

  // Look for the result-shaped JSON object first (matches the existing claude-cli.ts pattern).
  const jsonMatch = stdout.match(/\{[\s\S]*"type"\s*:\s*"result"[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]) as Partial<{
        result: string;
        is_error: boolean;
        num_turns: number;
        session_id: string;
        total_cost_usd: number;
      }>;
      return {
        result: parsed.result ?? '',
        isError: !!parsed.is_error,
        numTurns: parsed.num_turns ?? 0,
        sessionId: parsed.session_id,
        cost: parsed.total_cost_usd,
      };
    } catch {
      // fall through
    }
  }

  // Fall back to treating the whole stdout as the result.
  try {
    const parsed = JSON.parse(stdout) as Partial<{
      result: string;
      is_error: boolean;
      num_turns: number;
    }>;
    return {
      result: parsed.result ?? '',
      isError: !!parsed.is_error,
      numTurns: parsed.num_turns ?? 0,
    };
  } catch {
    return { result: stdout.trim(), isError: false, numTurns: 0 };
  }
}

