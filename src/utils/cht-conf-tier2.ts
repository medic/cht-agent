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
  /**
   * Back-compat alias for `{ configArtifact: 'form', artifactName: form }`. When
   * `configArtifact` is set it is ignored; kept so existing `form`-only call
   * sites (and their tests) keep working unchanged.
   */
  form?: string;
  /** P5: which artifact this run verifies — drives the default spec selection. */
  configArtifact?: string;
  /** P5: the artifact id (form name / task id / 'app-settings'). */
  artifactName?: string;
  /**
   * P5: the ticket's pinned tier-2 specs (repo-relative). When present these are
   * run EXACTLY (a directory entry expands to `*.spec.js` directly inside it);
   * a missing entry is an honest self-skip that names it.
   */
  qaSpecs?: string[];
  timeoutMs?: number;
  /** Override the mocha binary path (tests point this at a fake script). */
  mochaBin?: string;
  /** Injectable spawn for tests (defaults to node:child_process spawn). */
  spawnFn?: typeof spawn;
}

/** The selection inputs `findTier2Specs` resolves a spec list from. */
export interface Tier2SpecSelection {
  configArtifact: string;
  artifactName: string;
  /** Pinned repo-relative specs; when present they win over the defaults. */
  qaSpecs?: string[];
}

/**
 * Result of tier-2 spec selection: the resolved repo-relative spec files, or an
 * honest `reason` when none could be selected (missing pinned entry, an artifact
 * that requires `qaSpecs`, or no default spec on disk). `specs` and `reason` are
 * mutually exclusive — a non-empty `specs` means "run these"; a `reason` means
 * "self-skip with this message".
 */
export interface Tier2SpecResult {
  specs: string[];
  reason?: string;
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
 *
 * Retained for the form/contact-form default selection (and back-compat call
 * sites); `findTier2Specs` delegates here for those two artifacts.
 */
export const findFormSpecs = (configRoot: string, form: string): string[] => {
  const candidates = [
    path.join('test', 'forms', `${form}.spec.js`),
    path.join('test', 'forms', `${form}.agent.spec.js`),
  ];
  return candidates.filter((rel) => fs.existsSync(path.join(configRoot, rel)));
};

/**
 * List the `*.spec.js` files DIRECTLY inside a config-root-relative directory
 * (non-recursive — the plan's "directory rule": exact paths + this expansion,
 * no glob library). Returns config-root-relative paths, sorted for a stable spec
 * order; an empty array when the directory is missing/unreadable/has none.
 */
const listSpecsInDir = (configRoot: string, relDir: string): string[] => {
  let entries: string[];
  try {
    entries = fs.readdirSync(path.join(configRoot, relDir));
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.endsWith('.spec.js'))
    .sort()
    .map((e) => path.join(relDir, e));
};

/**
 * Resolve ONE pinned `qaSpecs` entry (config-root-relative) to the spec files it
 * names: a `.spec.js` file → itself when it exists; a directory → the
 * `*.spec.js` files directly inside it; anything else (missing, or a directory
 * with no specs) → `{ missing: entry }`. A pinned entry that resolves to zero
 * files is a config error, not a silent drop.
 */
const resolveQaSpecEntry = (
  configRoot: string,
  entry: string
): { specs: string[] } | { missing: string } => {
  const abs = path.join(configRoot, entry);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(abs);
  } catch {
    return { missing: entry };
  }
  if (stat.isDirectory()) {
    const specs = listSpecsInDir(configRoot, entry);
    return specs.length > 0 ? { specs } : { missing: entry };
  }
  return { specs: [entry] };
};

/**
 * P5: per-artifact tier-2 spec selection.
 *
 *  - `qaSpecs` present → run EXACTLY those (each must exist under configRoot; a
 *    directory expands to `*.spec.js` directly inside it). Any missing entry
 *    yields an honest `reason` naming ALL missing entries — never a partial run
 *    that silently drops the pin.
 *  - no `qaSpecs` → defaults by artifact:
 *      form / contact-form → `test/forms/<artifactName>.spec.js` + `.agent.spec.js`
 *      task / target       → every `test/tasks/*.spec.js`
 *      contact-summary     → `test/contact-summary.spec.js` + `test/contact-summary/*.spec.js`
 *      app-settings        → require qaSpecs (honest skip recommending the frontmatter)
 *  - an unknown artifact with no qaSpecs also skips with a reason.
 */
export const findTier2Specs = (configRoot: string, selection: Tier2SpecSelection): Tier2SpecResult => {
  const { configArtifact, artifactName, qaSpecs } = selection;

  if (qaSpecs && qaSpecs.length > 0) {
    const found: string[] = [];
    const missing: string[] = [];
    for (const entry of qaSpecs) {
      const resolved = resolveQaSpecEntry(configRoot, entry);
      if ('missing' in resolved) {
        missing.push(resolved.missing);
      } else {
        found.push(...resolved.specs);
      }
    }
    if (missing.length > 0) {
      return {
        specs: [],
        reason: `pinned qaSpecs not found under the config root: ${missing.join(', ')}`,
      };
    }
    // De-duplicate while preserving order (two entries can name the same file).
    return { specs: [...new Set(found)] };
  }

  switch (configArtifact) {
    case 'form':
    case 'contact-form': {
      const specs = findFormSpecs(configRoot, artifactName);
      return specs.length > 0
        ? { specs }
        : { specs: [], reason: `no harness spec for ${artifactName} under test/forms/` };
    }
    case 'task':
    case 'target': {
      const specs = listSpecsInDir(configRoot, path.join('test', 'tasks'));
      return specs.length > 0
        ? { specs }
        : { specs: [], reason: 'no test/tasks/*.spec.js specs found in the config root' };
    }
    case 'contact-summary': {
      const primary = path.join('test', 'contact-summary.spec.js');
      const specs = [
        ...(fs.existsSync(path.join(configRoot, primary)) ? [primary] : []),
        ...listSpecsInDir(configRoot, path.join('test', 'contact-summary')),
      ];
      return specs.length > 0
        ? { specs }
        : {
          specs: [],
          reason: 'no test/contact-summary.spec.js or test/contact-summary/*.spec.js in the config root',
        };
    }
    case 'app-settings':
      return {
        specs: [],
        reason:
          'app-settings has no default tier-2 spec set — pin the regression surface via the ' +
          "ticket's `qaSpecs` frontmatter (e.g. qaSpecs: [\"test/tasks/x.spec.js\"])",
      };
    default:
      return {
        specs: [],
        reason:
          `no default tier-2 spec selection for artifact "${configArtifact}" — pin specs via the ` +
          "ticket's `qaSpecs` frontmatter",
      };
  }
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

/** Default number of trailing output lines the QA panel echoes on a failure. */
const TIER2_TAIL_LINES = 20;

/** Line prefix for the echoed tier-2 output (so it reads as quoted child output). */
const TIER2_TAIL_PREFIX = '   │ ';

/**
 * Parse mocha's spec-reporter passing count from tier-2 output (F9). The
 * reporter prints a summary line like `  12 passing (3s)`; we take the LAST such
 * match (the run's own summary, not any incidental "passing" text). Returns
 * undefined when no summary line is present (e.g. the harness crashed before the
 * epilogue), so callers degrade to a countless "tier-2 passed".
 */
export const parseMochaPassing = (outputTail: string | undefined): number | undefined => {
  if (!outputTail) {
    return undefined;
  }
  const re = /(\d+)\s+passing\b/g;
  let last: number | undefined;
  let m: RegExpExecArray | null;
  while ((m = re.exec(outputTail)) !== null) {
    last = Number(m[1]);
  }
  return last;
};

/**
 * A bounded, prefixed excerpt of the tier-2 output for the QA panel on failure
 * (F9): the last `maxLines` non-blank lines, each prefixed so it reads as quoted
 * child output rather than the workbench's own log. The stored `outputTail` is
 * already char-bounded; this bounds it by LINES for a readable panel.
 */
export const tier2TailExcerpt = (
  outputTail: string | undefined,
  maxLines: number = TIER2_TAIL_LINES,
): string => {
  if (!outputTail) {
    return `${TIER2_TAIL_PREFIX}(no tier-2 output captured)`;
  }
  const lines = outputTail.split('\n').map((l) => l.replace(/\s+$/, ''));
  // Drop leading/trailing blank lines, then keep the last `maxLines`.
  while (lines.length > 0 && lines[0].trim() === '') {
    lines.shift();
  }
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
    lines.pop();
  }
  const tail = lines.slice(-maxLines);
  if (tail.length === 0) {
    return `${TIER2_TAIL_PREFIX}(no tier-2 output captured)`;
  }
  return tail.map((l) => `${TIER2_TAIL_PREFIX}${l}`).join('\n');
};

/**
 * The success one-liner for the QA transition/panel (F9): "tier-2 passed" plus
 * the parsed mocha passing count when the summary line was present.
 */
export const tier2PassLine = (outputTail: string | undefined): string => {
  const passing = parseMochaPassing(outputTail);
  return passing !== undefined ? `tier-2 passed (${passing} passing)` : 'tier-2 passed';
};

/**
 * Run tier-2: shell the repo-pinned mocha over the affected form's harness
 * spec(s) from the config-repo root. Never rejects — spawn errors and timeouts
 * become `{ ran: true, passed: false }` with the reason folded into the tail, so
 * the QA workflow can aggregate without a try/catch.
 */
export const runTier2 = async (options: Tier2RunOptions): Promise<QaTier2Result> => {
  const { configRoot } = options;
  const mochaBin = options.mochaBin ?? resolveRepoMocha(configRoot);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIER2_TIMEOUT_MS;
  const spawnFn = options.spawnFn ?? spawn;

  const runnable = harnessRunnable(configRoot, mochaBin);
  if (!runnable.ok) {
    return { ran: false, reason: runnable.reason };
  }
  // Back-compat: a bare `form` maps to `{ configArtifact: 'form', artifactName }`.
  const configArtifact = options.configArtifact ?? 'form';
  const artifactName = options.artifactName ?? options.form ?? '';
  const selection = findTier2Specs(configRoot, {
    configArtifact,
    artifactName,
    ...(options.qaSpecs ? { qaSpecs: options.qaSpecs } : {}),
  });
  if (selection.specs.length === 0) {
    return { ran: false, reason: selection.reason ?? `no harness spec for ${artifactName} under test/forms/` };
  }
  const specs = selection.specs;

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
      resolve({ ran: true, passed, outputTail: output, specs });
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
