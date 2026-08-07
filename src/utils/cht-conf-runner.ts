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
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
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

/**
 * Build the minimal child env from the allow-list, then layer any explicit
 * overrides on top. `extraEnv` is how the offline COMPILE path injects
 * `NODE_OPTIONS=--openssl-legacy-provider` (webpack-4's md4 hash aborts under
 * Node>=17 without it) WITHOUT widening the allow-list to inherit the agent's
 * whole environment — the override is set explicitly for the compile invocation.
 */
const minimalEnv = (extraEnv?: NodeJS.ProcessEnv): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = {};
  for (const key of CHT_CONF_ENV_ALLOWLIST) {
    if (process.env[key] !== undefined) {
      env[key] = process.env[key];
    }
  }
  if (extraEnv) {
    for (const [key, value] of Object.entries(extraEnv)) {
      if (value !== undefined) {
        env[key] = value;
      }
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
  ...(options.instanceUrl !== undefined ? [`--url=${options.instanceUrl}`] : []),
  `--source=${options.configPath}`,
  ...AUTONOMOUS_FLAGS,
  ...(options.skipValidate ? ['--skip-validate'] : []),
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
      env: minimalEnv(options.extraEnv),
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
/** How much of a failed cht-conf run to keep as the diagnostic tail. */
const FAILURE_TAIL_LINES = 12;
const FAILURE_TAIL_MAX_CHARS = 2_000;

/**
 * The last few meaningful lines of a failed cht-conf run.
 *
 * Prefers ERROR/Error lines when present — cht-conf's real cause line is
 * `ERROR <reason>`, which can otherwise be buried under a webpack stack trace.
 */
export const chtConfFailureTail = (output: string): string => {
  const lines = output.split('\n').map(l => l.trimEnd()).filter(l => l.trim() !== '');
  const errorLines = lines.filter(l => /\bERROR\b|\bError:/.test(l));
  const chosen = (errorLines.length > 0 ? errorLines : lines).slice(-FAILURE_TAIL_LINES);
  const text = chosen.join('\n');
  return text.length > FAILURE_TAIL_MAX_CHARS
    ? `${text.slice(-FAILURE_TAIL_MAX_CHARS)}\n... (truncated)`
    : text;
};

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
    // Same cwd requirement as runOfflineCompile (see its comment): cht-conf's
    // eslint-loader resolves .eslintrc PLUGINS relative to the child's cwd, not
    // --source. The app-settings bucket compiles before it uploads, so from any
    // other cwd eslint-plugin-json fails to resolve, webpack warns, and cht-conf
    // makes that a hard failure — the upload never runs and the apply reports
    // FAILED with no visible reason.
    cwd: options.configPath,
    // Same reason runOfflineCompile sets it: minimalEnv drops NODE_OPTIONS
    // (not on CHT_CONF_ENV_ALLOWLIST), and the app-settings bucket compiles
    // with webpack 4, whose md4 hash aborts under Node>=17 without the legacy
    // provider (ERR_OSSL_EVP_UNSUPPORTED). The container sets NODE_OPTIONS for
    // exactly this, but the scrubbed child env never saw it — so the compile
    // died before upload-app-settings ever ran.
    //
    // PYTHONHASHSEED for the same reason runOfflineConvert pins it: the form
    // buckets run pyxform, whose output is hash-order dependent. Unpinned here,
    // QA's whole-document RED oracle compares a deployed form against a locally
    // converted one and aborts ENVIRONMENT DRIFT on convert churn alone —
    // measured on 13 of 25 pairs for f_client-create.
    extraEnv: { NODE_OPTIONS: COMPILE_NODE_OPTIONS, PYTHONHASHSEED: '0' },
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
    if (status === 'failed') {
      // Only the non-zero-exit path reaches here, and cht-conf puts the actual
      // reason on stdout/stderr — which the classifier reads and drops. Without
      // this the QA log says "applied — FAILED" with no cause, and the operator
      // has to re-run the bucket by hand to find out why. Bounded tail: webpack
      // dumps hundreds of lines, and the reason is always at the end.
      warnings.push(
        `cht-conf ${options.action} exited ${run.exitCode}:\n${chtConfFailureTail(run.output)}`,
      );
    }
  }

  return {
    action: options.action,
    status,
    commands: [...verbs],
    warnings,
  };
};

// --- Offline convert (mission 05) -------------------------------------------
//
// The dev-phase form-fix step converts the edited workbook OFFLINE (no --url,
// never uploads) so the QA phase's reproduce(RED) step still sees the buggy
// DEPLOYED form. It converts a temp SANDBOX copy of the config project so the
// mount is never mutated before human approval.

/** The convert-only verb for each form bucket (never the paired upload verb). */
const CONVERT_VERBS: Record<'app-forms' | 'contact-forms', string> = {
  'app-forms': 'convert-app-forms',
  'contact-forms': 'convert-contact-forms',
};

// Never copied into the convert sandbox: heavyweight/irrelevant to convert, and
// .cht-agent carries the descriptor which must never ride into the mount.
const SANDBOX_EXCLUDES = new Set(['node_modules', '.git', '.cht-agent']);

export interface OfflineConvertOptions {
  /** The project dir to convert in (should be a sandbox copy, never the mount). */
  configPath: string;
  /** Base form name — the positional single-form filter. */
  form: string;
  /** Which convert bucket (default 'app-forms'). */
  bucket?: 'app-forms' | 'contact-forms';
  bin?: string;
  timeoutMs?: number;
}

/**
 * Copy a config project to a fresh temp dir (excluding node_modules/.git/
 * .cht-agent) so the dev-phase convert never touches the mount (R4). Returns the
 * sandbox path; the caller is responsible for removing it.
 */
export const createConvertSandbox = (configPath: string): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cht-agent-convert-'));
  fs.cpSync(configPath, dir, {
    recursive: true,
    filter: (src) => !SANDBOX_EXCLUDES.has(path.basename(src)),
  });
  return dir;
};

/**
 * Run an OFFLINE `convert-<bucket>` for ONE form (no --url, --skip-validate, the
 * `-- <form>` filter). Convert-only: the paired upload verb is never run, so a
 * dev-phase convert cannot fix the deployed form ahead of QA's reproduce step
 * (R6). Never rejects (folds spawn/timeout into the result, like runChtConf).
 */
export const runOfflineConvert = (options: OfflineConvertOptions): Promise<ChtConfExecResult> =>
  runChtConf({
    verbs: [CONVERT_VERBS[options.bucket ?? 'app-forms']],
    configPath: options.configPath,
    skipValidate: true,
    extraArgs: [options.form],
    logLabel: `offline ${CONVERT_VERBS[options.bucket ?? 'app-forms']}: ${options.form}`,
    bin: options.bin,
    timeoutMs: options.timeoutMs,
    // pyxform-medic iterates hash-ordered containers when emitting bind
    // attribute order and the secondary-instance <item> children, so Python's
    // per-process hash randomization makes convert NON-deterministic for
    // choice-heavy forms. minimalEnv drops PYTHONHASHSEED, so every convert got
    // a fresh seed — and the apply's collateral oracle diffs a BASELINE convert
    // against a POST-EDIT convert, two separate processes. Measured: converting
    // the UNTOUCHED e_household-create workbook twice already yields 55 canonical
    // diff lines, and f_client-create produced 4 different SHA1s in 4 runs at
    // identical byte length. A perfect descriptor therefore read as collateral
    // damage ~36% of the time, and the refinement loop cannot fix an environment
    // bug by rewriting JSON — m7 ran to exhaustion on it. Pinned: byte-identical
    // across repeated converts, apply ok 5/5 with the descriptor unchanged.
    extraEnv: { PYTHONHASHSEED: '0' },
    // instanceUrl omitted -> URL-less convert, no upload verb.
  });

// --- Offline compile (P4, compiled-settings oracle) -------------------------
//
// The QA compiled-settings oracle compiles the corrected config's app_settings
// OFFLINE (no --url, never uploads) and diffs the artifact-owned sections against
// the deployed settings. The compile runs `compile-app-settings --no-check` in a
// SANDBOX copy (like the convert path) so the mount is never mutated.

/** The compile-only verb (never the paired upload-app-settings). */
export const COMPILE_VERB = 'compile-app-settings';

/**
 * webpack-4 (cht-conf's app-settings bundler) uses an md4 hash that OpenSSL 3
 * (Node >= 17) refuses; the legacy provider re-enables it. Set explicitly on the
 * compile child env — NOT inherited — so the compile does not abort with
 * `error:0308010C digital envelope routines::unsupported`.
 */
export const COMPILE_NODE_OPTIONS = '--openssl-legacy-provider';

export interface OfflineCompileOptions {
  /** The project dir to compile in (should be a sandbox copy, never the mount). */
  configPath: string;
  bin?: string;
  timeoutMs?: number;
}

/**
 * Run an OFFLINE `compile-app-settings --no-check` (no --url, no upload verb).
 *
 * NODE_OPTIONS=--openssl-legacy-provider is set on the child env for webpack-4
 * under Node>=17. `--no-check` rides after the `--` separator as an extraArg: in
 * cht-conf 3.21.5 `compile-app-settings` only reads `--debug` from its extraArgs
 * (`--no-check` is parsed by minimist but ignored), so it is a no-op that keeps
 * the documented invocation stable across versions WITHOUT unminifying the
 * bundles (passing `--debug` WOULD disable minification and break byte-parity
 * with the deployed, minified settings — so we never do). Output is
 * byte-deterministic and minified, matching the deployed document.
 *
 * Never rejects (folds spawn/timeout into the result, like runChtConf). The
 * caller reads `<configPath>/app_settings.json` afterwards.
 */
export const runOfflineCompile = (options: OfflineCompileOptions): Promise<ChtConfExecResult> =>
  runChtConf({
    verbs: [COMPILE_VERB],
    configPath: options.configPath,
    extraArgs: ['--no-check'],
    logLabel: `offline ${COMPILE_VERB}`,
    bin: options.bin,
    timeoutMs: options.timeoutMs,
    extraEnv: { NODE_OPTIONS: COMPILE_NODE_OPTIONS },
    // cht-conf's eslint-loader resolves the config's .eslintrc PLUGINS relative
    // to the child process cwd, not --source — from any other cwd the plugins
    // (e.g. eslint-plugin-json, installed in the config's node_modules) fail to
    // load, the loader emits webpack warnings, and cht-conf turns those into a
    // hard compile failure. Run IN the (sandboxed) project dir. Verified live
    // against the partner config, 2026-07-18.
    cwd: options.configPath,
    // instanceUrl omitted -> URL-less compile, no upload verb.
  });
