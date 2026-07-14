/**
 * Tier-2 QA runner (mission 05, F7).
 *
 * After the tier-1 GREEN (bind assertions + F6 whole-document identity), the
 * opt-in tier-2 hook shells the PARTNER repo's OWN pinned mocha over the
 * affected form's `cht-conf-test-harness` spec(s) — an Enketo-level proof that
 * the corrected form fills as intended. This is a stronger, slower oracle than
 * the static bind check, so it is default OFF (operators still own the
 * full-suite regression); the hook runs only `test/forms/<form>*.spec.js`.
 *
 * Self-skip philosophy (mirrors the offline-convert helper): when the config
 * repo has no runnable harness (`node_modules/.bin/mocha` absent, or the
 * `cht-conf-test-harness` dep missing) or no spec for the form, the hook returns
 * `{ ran: false, reason }` and leaves `succeeded` unchanged — it never fails a
 * green loop just because tier-2 could not run.
 *
 * The child gets a minimal env (least-privilege — the mocha run executes the
 * config repo's own JS, which must never see the agent's LLM keys) plus the
 * repo's TZ convention (`TZ=Africa/Nairobi`, as the partner's `test-unit`
 * script sets), matching the runner env cht-conf-runner uses.
 */

import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { QaTier2Result } from '../types';

/** Generous default: the harness boots headless Chromium + Enketo per file. */
const DEFAULT_TIER2_TIMEOUT_MS = 300_000;

/** How many trailing characters of mocha output to keep for the report. */
const OUTPUT_TAIL_CHARS = 4000;

/**
 * Env allowlist for the mocha child. The harness needs PATH/HOME (Chromium),
 * TMPDIR, and the locale vars; TZ is added explicitly below. LLM provider keys
 * are deliberately excluded.
 */
const TIER2_ENV_ALLOWLIST = ['PATH', 'HOME', 'NODE_PATH', 'TMPDIR', 'LANG', 'LC_ALL', 'CHROME_BIN', 'CHROMIUM_BIN'];

/** The partner repo's TZ convention (its `test-unit` script sets this). */
const TIER2_TZ = 'Africa/Nairobi';

const tier2Env = (): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = {};
  for (const key of TIER2_ENV_ALLOWLIST) {
    if (process.env[key] !== undefined) {
      env[key] = process.env[key];
    }
  }
  env.TZ = process.env.TZ ?? TIER2_TZ;
  return env;
};

export interface Tier2RunOptions {
  configRoot: string;
  form: string;
  timeoutMs?: number;
  /** Override the mocha binary path (tests point this at a fake script). */
  mochaBin?: string;
  /** Injectable spawn for tests (defaults to node:child_process spawn). */
  spawnFn?: typeof spawn;
}

/**
 * Resolve the repo-pinned mocha binary. The partner repo installs mocha into
 * `<configRoot>/node_modules/.bin/mocha`; we deliberately do NOT fall back to a
 * global mocha (a version/plugin mismatch would be worse than an honest skip).
 */
export const resolveRepoMocha = (configRoot: string): string =>
  path.join(configRoot, 'node_modules', '.bin', 'mocha');

/**
 * Find the affected form's harness spec(s): the primary `test/forms/<form>.spec.js`
 * and the agent sibling `test/forms/<form>.agent.spec.js`, whichever exist.
 * Returns config-root-relative glob-free paths (mocha is given explicit files,
 * not a glob, so shell expansion is irrelevant).
 */
export const findFormSpecs = (configRoot: string, form: string): string[] => {
  const candidates = [
    path.join('test', 'forms', `${form}.spec.js`),
    path.join('test', 'forms', `${form}.agent.spec.js`),
  ];
  return candidates.filter((rel) => fs.existsSync(path.join(configRoot, rel)));
};

/**
 * True when the config repo has a runnable harness: the pinned mocha binary and
 * the `cht-conf-test-harness` dependency are both present. A missing either ⇒
 * honest self-skip.
 */
const harnessRunnable = (configRoot: string, mochaBin: string): { ok: true } | { ok: false; reason: string } => {
  if (!fs.existsSync(mochaBin)) {
    return { ok: false, reason: `repo-pinned mocha not found at ${path.relative(configRoot, mochaBin) || mochaBin}` };
  }
  if (!fs.existsSync(path.join(configRoot, 'node_modules', 'cht-conf-test-harness'))) {
    return { ok: false, reason: 'cht-conf-test-harness is not installed in the config repo' };
  }
  return { ok: true };
};

const keepTail = (s: string): string => (s.length > OUTPUT_TAIL_CHARS ? s.slice(-OUTPUT_TAIL_CHARS) : s);

/**
 * Run tier-2: shell the repo-pinned mocha over the affected form's harness
 * spec(s) from the config-repo root. Never rejects — spawn errors and timeouts
 * become `{ ran: true, passed: false }` with the reason folded into the tail, so
 * the QA workflow can aggregate without a try/catch.
 */
export const runTier2 = async (options: Tier2RunOptions): Promise<QaTier2Result> => {
  const { configRoot, form } = options;
  const mochaBin = options.mochaBin ?? resolveRepoMocha(configRoot);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIER2_TIMEOUT_MS;
  const spawnFn = options.spawnFn ?? spawn;

  const runnable = harnessRunnable(configRoot, mochaBin);
  if (!runnable.ok) {
    return { ran: false, reason: runnable.reason };
  }
  const specs = findFormSpecs(configRoot, form);
  if (specs.length === 0) {
    return { ran: false, reason: `no harness spec for ${form} under test/forms/` };
  }

  const args = [...specs, '--timeout', '120000', '--reporter', 'spec'];
  console.log(`[tier-2] mocha ${specs.join(' ')} (cwd=${configRoot})`);

  return new Promise<QaTier2Result>((resolve) => {
    const proc = spawnFn(mochaBin, args, {
      cwd: configRoot,
      env: tier2Env(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const chunks: string[] = [];
    let settled = false;

    const finish = (passed: boolean, extra?: string): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      const output = keepTail(chunks.join('') + (extra ? `\n${extra}` : ''));
      resolve({ ran: true, passed, outputTail: output });
    };

    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      finish(false, `[tier-2] TIMEOUT after ${timeoutMs}ms`);
    }, timeoutMs);

    proc.stdout?.on('data', (d) => chunks.push(d.toString()));
    proc.stderr?.on('data', (d) => chunks.push(d.toString()));
    proc.on('error', (err) => finish(false, `[tier-2] spawn error: ${err.message}`));
    proc.on('close', (code) => finish(code === 0));
  });
};
