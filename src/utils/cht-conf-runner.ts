/**
 * cht-conf runner for the Test Environment Layer.
 *
 * Isolates the `child_process` calls to cht-conf (the way cht-readiness.ts
 * isolates `fetch`), so the Test Environment Agent stays orchestration-only.
 * The agent NEVER runs Docker — cht-conf talks to the already-running instance
 * over HTTP, so spawning it is allowed (and the sandbox allow-list sanctions
 * `Bash(cht:*)`).
 *
 * One invocation per upload bucket: the bucket's verbs are passed as ordered
 * actions in a single `cht` process (cht-conf runs named actions in sequence).
 *
 * See: designs/layer_recommendations/test-environment-layer.md,
 *      designs/cht-conf-agent-extension.md §7.2,
 *      docs/handoffs/66-phase2-applyconfig-implementation.md
 */

import { spawn } from 'node:child_process';
import { ChtConfRunOptions, ConfigActionResult, ConfigActionStatus, ConfigUploadAction } from '../types';

/**
 * The cht-conf verbs each upload bucket runs, in order. Single source of truth
 * for both the real runner and the mock fixture.
 */
export const CONFIG_ACTION_COMMANDS: Record<ConfigUploadAction, string[]> = {
  'app-settings': ['compile-app-settings', 'upload-app-settings'],
  'app-forms': ['convert-app-forms', 'upload-app-forms'],
  'contact-forms': ['convert-contact-forms', 'upload-contact-forms'],
  resources: ['upload-resources', 'upload-branding', 'upload-custom-translations'],
};

/**
 * Flags that make cht-conf safe to run autonomously. Without these it BLOCKS on
 * stdin (git-status prompt, both-changed form-conflict prompt, etc.) and the
 * agent hangs. `--force` skips all confirmations (overwrite on conflict); the
 * env is a throwaway test instance with a self-signed cert.
 */
const AUTONOMOUS_FLAGS = [
  '--force',
  '--skip-git-check',
  '--skip-version-check',
  '--skip-dependency-check',
  '--skip-translation-check',
  '--accept-self-signed-certs',
  '--verbose',
];

const DEFAULT_BIN = 'cht';
const DEFAULT_TIMEOUT_MS = 180_000;

/** Buckets whose verbs accept a positional single-form filter. */
const FORM_BUCKETS: ConfigUploadAction[] = ['app-forms', 'contact-forms'];

/**
 * cht-conf executes code from the `--source` project (app-settings build,
 * nools, post-processing), so the child gets a minimal env — NOT the agent's
 * full process.env, which holds LLM provider keys (ANTHROPIC_API_KEY etc.). The
 * instance URL + creds are passed as the `--url` arg, not via env, so cht-conf
 * needs nothing secret here. Least-privilege: a malicious config repo can't read
 * keys that were never handed to it.
 */
const CHT_CONF_ENV_ALLOWLIST = ['PATH', 'HOME', 'NODE_PATH', 'TMPDIR', 'LANG', 'LC_ALL'];

const minimalEnv = (): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = {};
  for (const key of CHT_CONF_ENV_ALLOWLIST) {
    if (process.env[key] !== undefined) {
      env[key] = process.env[key];
    }
  }
  return env;
};

/**
 * Build the cht-conf argv for a bucket (no credentials are logged; the URL with
 * embedded creds lives only in the argv passed to spawn). Exported for testing.
 */
export const buildChtConfArgs = (options: ChtConfRunOptions): string[] => {
  const verbs = CONFIG_ACTION_COMMANDS[options.action];
  const args = [`--url=${options.instanceUrl}`, `--source=${options.configPath}`, ...AUTONOMOUS_FLAGS, ...verbs];
  // A single-form filter is a positional arg consumed by the form-upload verbs.
  if (options.artifact && FORM_BUCKETS.includes(options.action)) {
    args.push(options.artifact);
  }
  return args;
};

// cht-conf logs a "no changes" line per artifact when its hash matches the
// instance. CRUCIALLY these skip lines contain the word "uploaded" (e.g.
// "Form x not uploaded, no changes"), so a naive /uploaded/ match misfires —
// the skip phrasing must be detected FIRST, per line. Verified against
// cht-conf src (upload-forms.js, upload-app-settings.js,
// upload-custom-translations.js, upload-configuration-docs.js).
const SKIP_LINE = /no changes|not updated|already up to date|nothing to upload/;
// Positive upload signals that never appear in a skip line. Note the negative
// lookahead: "not uploaded" / "not updated" must NOT count as an upload.
const UPLOAD_LINE = /(?<!not )uploaded|upload complete|updated successfully/;

/**
 * Classify a finished cht-conf run. cht-conf exits 0 for BOTH a real upload and
 * a hash-based skip, so status is parsed from stdout per line: a bucket counts
 * as `uploaded` if ANY artifact actually uploaded; `skipped` if it only emitted
 * skip lines; a non-zero exit (or spawn error) is `failed`. Exported for testing.
 */
export const classifyChtConfOutput = (output: string, exitCode: number | null): ConfigActionStatus => {
  if (exitCode !== 0) {
    return 'failed';
  }
  const lines = output.toLowerCase().split('\n');
  const uploadedAny = lines.some((line) => !SKIP_LINE.test(line) && UPLOAD_LINE.test(line));
  if (uploadedAny) {
    return 'uploaded';
  }
  const skippedAny = lines.some((line) => SKIP_LINE.test(line));
  return skippedAny ? 'skipped' : 'uploaded';
};

/**
 * Run one cht-conf upload bucket against the instance. Resolves with the
 * per-bucket result (never rejects — a non-zero exit or spawn error becomes
 * `status: 'failed'` so the caller can aggregate without try/catch per bucket).
 */
export const runBucket = (options: ChtConfRunOptions): Promise<ConfigActionResult> => {
  const bin = options.bin ?? DEFAULT_BIN;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const verbs = CONFIG_ACTION_COMMANDS[options.action];
  const args = buildChtConfArgs(options);
  const warnings: string[] = [];

  if (options.artifact && !FORM_BUCKETS.includes(options.action)) {
    warnings.push(`artifact targeting ignored for the ${options.action} bucket`);
  }

  // Log the verbs, never the cred-embedded URL.
  console.log(`[cht-conf] ${options.action}: ${verbs.join(' ')} (--source=${options.configPath})`);

  return new Promise((resolve) => {
    const result = (status: ConfigActionStatus): ConfigActionResult => ({
      action: options.action,
      status,
      commands: [...verbs],
      warnings: [...warnings],
    });

    const proc = spawn(bin, args, { env: minimalEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks: string[] = [];
    let settled = false;

    const finish = (status: ConfigActionStatus): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutId);
      resolve(result(status));
    };

    const timeoutId = setTimeout(() => {
      proc.kill('SIGTERM');
      warnings.push(`cht-conf ${options.action} timed out after ${timeoutMs}ms`);
      finish('failed');
    }, timeoutMs);

    proc.stdout?.on('data', (data) => chunks.push(data.toString()));
    proc.stderr?.on('data', (data) => chunks.push(data.toString()));

    proc.on('error', (error) => {
      warnings.push(`cht-conf ${options.action} failed to start: ${error.message}`);
      finish('failed');
    });

    proc.on('close', (code) => {
      finish(classifyChtConfOutput(chunks.join(''), code));
    });
  });
};
