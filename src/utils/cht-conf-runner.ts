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
export const FORM_BUCKETS = new Set<ConfigUploadAction>(['app-forms', 'contact-forms']);

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
 *
 * The credentialed URL is never logged, but argv is readable by every process in the
 * same PID namespace (/proc/<pid>/cmdline) for the life of the child; cht-conf 6.x takes
 * a remote --url only this way. Acceptable for a disposable instance.
 */
const buildExecArgs = (options: ChtConfExecOptions): string[] => [
  `--url=${options.instanceUrl}`,
  `--source=${options.configPath}`,
  ...AUTONOMOUS_FLAGS,
  ...options.verbs,
  ...(options.extraArgs?.length ? ['--', ...options.extraArgs] : []),
];

const bucketExecOptions = (options: ChtConfRunOptions): ChtConfExecOptions => {
  const verbs = CONFIG_ACTION_COMMANDS[options.action];
  const formFilter = options.artifact && FORM_BUCKETS.has(options.action) ? [options.artifact] : [];
  return {
    verbs,
    instanceUrl: options.instanceUrl,
    configPath: options.configPath,
    extraArgs: formFilter,
    logLabel: `${options.action}: ${verbs.join(' ')}`,
    cwd: options.cwd,
    bin: options.bin,
    timeoutMs: options.timeoutMs,
  };
};

/** Exported for testing: exactly the argv runBucket spawns, via the same lowering. */
export const buildChtConfArgs = (options: ChtConfRunOptions): string[] =>
  buildExecArgs(bucketExecOptions(options));

// cht-conf logs a "no changes" line per artifact when its hash matches the
// instance. CRUCIALLY these skip lines contain the word "uploaded" (e.g.
// "Form x not uploaded, no changes"), so a naive /uploaded/ match misfires —
// the skip phrasing must be detected FIRST, per line. Verified against
// cht-conf src (upload-forms.js, upload-app-settings.js,
// upload-custom-translations.js, upload-configuration-docs.js).
const SKIP_LINE = /no changes|not updated|already up to date|nothing to upload/;
// Positive upload signals. The lookbehind binds to `uploaded` only, so it stops
// "not uploaded"; "not updated" is excluded by SKIP_LINE winning the per-line test.
const UPLOAD_LINE = /(?<!not )uploaded|upload complete|updated successfully/;
// cht-conf warns and still exits 0 when a verb had nothing to do at all — an
// unmatched form filter (args-form-filter.js) or a missing bucket input file
// (upload-configuration-docs.js). Nothing changed on the instance, so these
// must not classify as uploaded.
const NO_WORK_LINE = /no matches found for files matching form filter|no configuration file found at path/;

/**
 * Classify a finished cht-conf run. cht-conf exits 0 for BOTH a real upload and
 * a hash-based skip, so status is parsed from stdout per line: a bucket counts
 * as `uploaded` only when ANY artifact verifiably uploaded; every other clean
 * exit (hash-based skips, no-work warnings, unrecognized output) is `skipped` —
 * never assume an upload without evidence. A non-zero exit (or spawn error) is
 * `failed`. Exported for testing.
 */
export const classifyChtConfOutput = (output: string, exitCode: number | null): ConfigActionStatus => {
  if (exitCode !== 0) {
    return 'failed';
  }
  const lines = output.toLowerCase().split('\n');
  const uploadedAny = lines.some((line) => !SKIP_LINE.test(line) && UPLOAD_LINE.test(line));
  return uploadedAny ? 'uploaded' : 'skipped';
};

const OUTPUT_TAIL_LINES = 5;
// cht-conf's log.js prefixes every line with a colour code (\x1b[31mERROR ...); the
// escape's trailing `m` defeats \b, so strip before matching the level tag.
// eslint-disable-next-line no-control-regex
const ANSI_ESCAPES = /\x1b\[[0-9;]*m/g;
const ERROR_LINE = /^ERROR\b/;

const outputLines = (output: string): string[] =>
  output
    .replaceAll(ANSI_ESCAPES, '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

/** cht-conf's own account of a failure: its ERROR lines, else the last few lines. */
export const outputTail = (output: string): string[] => {
  const lines = outputLines(output);
  const errors = lines.filter((line) => ERROR_LINE.test(line));
  return (errors.length > 0 ? errors : lines).slice(-OUTPUT_TAIL_LINES).map((line) => `cht-conf: ${line}`);
};

/** cht-conf logs ERROR and still exits 0 on some paths (upload-custom-translations). */
const loggedErrorButExitedZero = (run: ChtConfExecResult): boolean =>
  run.exitCode === 0 && outputLines(run.output).some((line) => ERROR_LINE.test(line));

/**
 * Explain a bucket that produced no upload evidence. `matchedNothing` marks an unmatched
 * form filter or a missing bucket input, as distinct from a hash-based skip of something
 * that exists; applyConfig decides whether a targeted apply actually happened.
 */
const classifySkippedBucket = (
  run: ChtConfExecResult,
  options: ChtConfRunOptions,
  warnings: string[]
): { status: ConfigActionStatus; matchedNothing: boolean } => {
  const lower = run.output.toLowerCase();
  if (NO_WORK_LINE.test(lower)) {
    const what =
      options.artifact !== undefined && FORM_BUCKETS.has(options.action)
        ? `no artifact named "${options.artifact}"`
        : 'nothing to upload (missing bucket input)';
    warnings.push(`cht-conf ${options.action} matched ${what}`);
    return { status: 'skipped', matchedNothing: true };
  }
  if (!SKIP_LINE.test(lower)) {
    warnings.push(`cht-conf ${options.action} produced no upload or skip line — treated as skipped`);
  }
  return { status: 'skipped', matchedNothing: false };
};

/**
 * Strip basic-auth userinfo from any URL in text. cht-conf runs with the
 * credentialed `--url` under `--verbose` and echoes URLs on some paths, so its
 * output is redacted at this boundary — no caller (a log line, a trace span, an
 * error message) can leak the instance password by forwarding it.
 */
export const redactUrlCreds = (text: string): string => text.replaceAll(/(\/\/)[^/\s:@]+:[^/\s]*@/g, '$1***:***@');

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
      resolve({ ...result, output: redactUrlCreds(chunks.join('')) });
    };

    const timeoutId = setTimeout(() => {
      // Signals reach only the direct child: an xls2xform grandchild spawned by a form
      // conversion can outlive the timeout.
      proc.kill('SIGTERM');
      const hardKill = setTimeout(() => proc.kill('SIGKILL'), 5_000);
      hardKill.unref();
      proc.once('close', () => clearTimeout(hardKill));
      finish({ exitCode: null, timedOut: true });
    }, timeoutMs);

    proc.stdout?.on('data', (data) => chunks.push(data.toString()));
    proc.stderr?.on('data', (data) => chunks.push(data.toString()));

    proc.on('error', (error) => {
      // ENOENT covers both a missing binary and an unreachable cwd — name both,
      // and say so, because the bare errno sends people hunting the wrong one.
      const where = options.cwd === undefined ? `bin=${bin}` : `bin=${bin}, cwd=${options.cwd}`;
      const hint = error.message.includes('ENOENT')
        ? ' — check that cht-conf is on PATH (or set CHT_CONF_BIN) and that the cwd exists'
        : '';
      finish({ exitCode: null, timedOut: false, startError: `${error.message} (${where})${hint}` });
    });

    proc.on('close', (code) => {
      finish({ exitCode: code, timedOut: false });
    });
  });
};

/** Failures stdout parsing cannot see: a timeout or a spawn error. */
const noteHardFailure = (
  run: ChtConfExecResult,
  options: ChtConfRunOptions,
  warnings: string[]
): boolean => {
  if (run.timedOut) {
    warnings.push(`cht-conf ${options.action} timed out after ${options.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms`);
    return true;
  }
  if (run.startError !== undefined) {
    warnings.push(`cht-conf ${options.action} failed to start: ${run.startError}`);
    return true;
  }
  return false;
};

/** Map a finished bucket run onto a ConfigActionStatus, appending any failure warning. */
const deriveBucketStatus = (
  run: ChtConfExecResult,
  options: ChtConfRunOptions,
  warnings: string[]
): { status: ConfigActionStatus; matchedNothing: boolean } => {
  if (noteHardFailure(run, options, warnings)) {
    return { status: 'failed', matchedNothing: false };
  }
  const status = classifyChtConfOutput(run.output, run.exitCode);
  if (status === 'failed') {
    warnings.push(...outputTail(run.output));
    return { status, matchedNothing: false };
  }
  // For some problems, cht-conf logs ERROR and continues: for example a translation
  // file named messages-luo.properties, or a failed couch-config read. Report those
  // lines, but keep the status.
  if (loggedErrorButExitedZero(run)) {
    warnings.push(`cht-conf ${options.action} exited 0 but logged errors`, ...outputTail(run.output));
  }
  return status === 'skipped' ? classifySkippedBucket(run, options, warnings) : { status, matchedNothing: false };
};

/**
 * Run one cht-conf upload bucket against the instance. Resolves with the
 * per-bucket result (never rejects — a non-zero exit or spawn error becomes
 * `status: 'failed'` so the caller can aggregate without try/catch per bucket).
 */
export const runBucket = async (options: ChtConfRunOptions): Promise<ConfigActionResult> => {
  const verbs = CONFIG_ACTION_COMMANDS[options.action];
  const warnings: string[] = [];

  if (options.artifact && !FORM_BUCKETS.has(options.action)) {
    warnings.push(`artifact targeting ignored for the ${options.action} bucket`);
  }

  const run = await runChtConf(bucketExecOptions(options));

  const { status, matchedNothing } = deriveBucketStatus(run, options, warnings);
  return {
    action: options.action,
    status,
    commands: [...verbs],
    warnings,
    matchedNothing,
  };
};
