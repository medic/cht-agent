/**
 * cht-conf runner for the Test Environment Layer.
 *
 * Isolates the `child_process` calls to cht-conf (the way cht-readiness.ts
 * isolates `fetch`), so the Test Environment Agent stays orchestration-only.
 * The agent NEVER runs Docker — cht-conf talks to the already-running instance
 * over HTTP, so spawning it is allowed (and the sandbox allow-list sanctions
 * `Bash(cht:*)`).
 *
 * Two layers: runChtConf spawns one `cht` process for an ordered verb list
 * (cht-conf runs named actions in sequence) and reports the raw outcome;
 * runBucket wraps it for the config upload buckets, classifying stdout into
 * uploaded/skipped/failed. The test-data verbs (csv-to-docs, upload-docs,
 * create-users) drive runChtConf directly.
 *
 * See: designs/layer_recommendations/test-environment-layer.md
 */

import { spawn } from 'node:child_process';
import {
  ChtConfExecOptions,
  ChtConfExecResult,
  ChtConfRunOptions,
  ConfigActionResult,
  ConfigActionStatus,
  ConfigUploadAction,
} from '../types';

/**
 * The cht-conf verbs each upload bucket runs, in order. Single source of truth
 * for both the real runner and the mock fixture.
 */
export const CONFIG_ACTION_COMMANDS: Record<ConfigUploadAction, string[]> = {
  'app-settings': ['compile-app-settings', 'upload-app-settings'],
  // Upload a pre-compiled app_settings.json verbatim, skipping compile — the
  // path for a deployment recovered via `backup-app-settings` (recompiling from
  // a source tree you do not have would clobber contact-summary/tasks/targets).
  'app-settings-only': ['upload-app-settings'],
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

const DEFAULT_TIMEOUT_MS = 180_000;

/**
 * The cht-conf binary to spawn. Overridable via CHT_CONF_BIN so the agent can run
 * a deployment's OWN pinned cht-conf — e.g. a throwaway
 * `<config>/node_modules/.bin/cht` that `npm ci` installed into the mounted
 * config repo — instead of the image's global `cht`, matching the version the
 * config was authored/compiled with. A per-call `options.bin` still wins.
 */
export const resolveChtConfBin = (): string => process.env.CHT_CONF_BIN || 'cht';

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
 * The full cht-conf argv for a generic invocation (url, source, safe flags,
 * verbs). Extra args ride AFTER a literal `--` separator: cht-conf's main.js
 * treats every bare positional as an action name and throws
 * "Unsupported action(s)" otherwise — only `cmdArgs['--']` reaches
 * environment.extraArgs (which is what args-form-filter reads).
 */
const buildExecArgs = (options: ChtConfExecOptions): string[] => [
  `--url=${options.instanceUrl}`,
  `--source=${options.configPath}`,
  ...AUTONOMOUS_FLAGS,
  ...options.verbs,
  ...(options.extraArgs?.length ? ['--', ...options.extraArgs] : []),
];

/**
 * Build the cht-conf argv for a bucket (no credentials are logged; the URL with
 * embedded creds lives only in the argv passed to spawn). Exported for testing.
 */
export const buildChtConfArgs = (options: ChtConfRunOptions): string[] => {
  // A single-form filter is a `--`-separated extra arg consumed by the
  // form verbs (cht-conf's args-form-filter reads environment.extraArgs).
  const formFilter = options.artifact && FORM_BUCKETS.includes(options.action) ? [options.artifact] : [];
  return buildExecArgs({
    verbs: CONFIG_ACTION_COMMANDS[options.action],
    instanceUrl: options.instanceUrl,
    configPath: options.configPath,
    extraArgs: formFilter,
  });
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
 * Run one `cht` process for an ordered verb list. Resolves with the raw
 * outcome (never rejects — spawn errors and timeouts are folded into the
 * result so callers can aggregate without try/catch per invocation).
 */
export const runChtConf = (options: ChtConfExecOptions): Promise<ChtConfExecResult> => {
  const bin = options.bin ?? resolveChtConfBin();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const args = buildExecArgs(options);

  // Log the verbs, never the cred-embedded URL.
  const label = options.logLabel ?? options.verbs.join(' ');
  console.log(`[cht-conf] ${label} (--source=${options.configPath})`);

  return new Promise((resolve) => {
    const proc = spawn(bin, args, {
      env: minimalEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
      ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
    });
    const chunks: string[] = [];
    let settled = false;

    const finish = (result: Omit<ChtConfExecResult, 'output'>): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutId);
      resolve({ ...result, output: chunks.join('') });
    };

    const timeoutId = setTimeout(() => {
      proc.kill('SIGTERM');
      finish({ exitCode: null, timedOut: true });
    }, timeoutMs);

    proc.stdout?.on('data', (data) => chunks.push(data.toString()));
    proc.stderr?.on('data', (data) => chunks.push(data.toString()));

    proc.on('error', (error) => {
      finish({ exitCode: null, timedOut: false, startError: error.message });
    });

    proc.on('close', (code) => {
      finish({ exitCode: code, timedOut: false });
    });
  });
};

/**
 * Run one cht-conf upload bucket against the instance. Resolves with the
 * per-bucket result (never rejects — a non-zero exit or spawn error becomes
 * `status: 'failed'` so the caller can aggregate without try/catch per bucket).
 */
export const runBucket = async (options: ChtConfRunOptions): Promise<ConfigActionResult> => {
  const verbs = CONFIG_ACTION_COMMANDS[options.action];
  const warnings: string[] = [];

  if (options.artifact && !FORM_BUCKETS.includes(options.action)) {
    warnings.push(`artifact targeting ignored for the ${options.action} bucket`);
  }
  const formFilter = options.artifact && FORM_BUCKETS.includes(options.action) ? [options.artifact] : [];

  const run = await runChtConf({
    verbs,
    instanceUrl: options.instanceUrl,
    configPath: options.configPath,
    extraArgs: formFilter,
    logLabel: `${options.action}: ${verbs.join(' ')}`,
    bin: options.bin,
    timeoutMs: options.timeoutMs,
  });

  let status: ConfigActionStatus;
  if (run.timedOut) {
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    warnings.push(`cht-conf ${options.action} timed out after ${timeoutMs}ms`);
    status = 'failed';
  } else if (run.startError !== undefined) {
    warnings.push(`cht-conf ${options.action} failed to start: ${run.startError}`);
    status = 'failed';
  } else {
    status = classifyChtConfOutput(run.output, run.exitCode);
  }

  return {
    action: options.action,
    status,
    commands: [...verbs],
    warnings,
  };
};
