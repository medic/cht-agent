/**
 * Compiled-settings QA oracle (P4).
 *
 * The task/target/contact-summary/app-settings artifacts have no XForm to fetch:
 * their fix lives in JS/JSON source that `compile-app-settings` bundles (some of
 * it webpack+terser-minified) into `app_settings.json`. So the QA oracle here is
 * a byte-exact comparison of the CORRECTED source's compiled output against the
 * deployed `GET /api/v1/settings` document — the settings analogue of the
 * form-XML bind oracle.
 *
 * Empirical basis (pinned cht-conf 3.21.5 vs a live CHT 4.21.1 provisioned from
 * the SAME config — verified 2026-07-18):
 *  - `compile-app-settings` offline is byte-DETERMINISTIC (two runs sha-identical);
 *    the embedded JS bundles (tasks.rules, contact_summary) are minified strings,
 *    deterministically.
 *  - Deployed settings = the compiled output + ~17 server-injected default
 *    TOP-LEVEL keys + a few server-default PERMISSION keys absent from the config
 *    source. ZERO keys the compiler produces are dropped.
 *  - Every compiler-owned section was byte-identical compiled-vs-deployed:
 *    `tasks.rules` (string), `tasks.targets` (object incl. key order),
 *    `tasks.isDeclarative`, `contact_summary` (string), top-level `schedules`.
 *    NOTE targets live at `tasks.targets`, NOT top-level; there is no
 *    `tasks.schedules`.
 *
 * Comparator design (implemented exactly, per the empirical facts):
 *  - Iterate ONLY the keys of the COMPILED document (never the deployed keys —
 *    that would pull in the ~17 server defaults and read a false diff).
 *  - `tasks.rules` + `contact_summary` compare strict `===` (bundled JS strings).
 *  - `tasks.targets` and other objects deep-equal; scalars `===`.
 *  - `permissions`: compare ONLY the keys present in `compiled.permissions`
 *    (deployed-only permission keys are server defaults — ignored).
 *
 * The operational prerequisites for the offline compile (symlinking the source
 * config's node_modules into the sandbox, NODE_OPTIONS for webpack-4) live in
 * `compileSettingsOffline` below; the runner supplies the compile verb + env.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { createConvertSandbox, runOfflineCompile } from './cht-conf-runner';
import { ChtConfExecResult, SettingsSection, SettingsSectionCheck } from '../types';

/** Where cht-conf writes the compiled settings inside the project dir. */
const APP_SETTINGS_JSON = 'app_settings.json';

/**
 * Build artifacts that `compile-app-settings` regenerates from JS/JSON source.
 *
 * These are never hand-edited: the QA phase recompiles them offline (see
 * compileSettingsOffline) and the deploy path runs compile+upload. Code
 * generation therefore must not be held to producing them — the executor has no
 * shell to run a build with, so a plan item naming one can never be satisfied.
 */
const COMPILED_ARTIFACTS = new Set<string>([APP_SETTINGS_JSON]);

/**
 * True when `filePath` names a compiled artifact rather than editable source.
 * Matches on basename so it holds for both repo-relative and absolute paths.
 */
export const isCompiledArtifact = (filePath: string): boolean =>
  COMPILED_ARTIFACTS.has(path.basename(filePath));

/** The two sections whose values are minified JS bundle strings (compared ===). */
const STRING_SECTIONS = new Set<string>(['tasks.rules', 'contact_summary']);

/** The permissions section gets the compiled-keys-only rule (server defaults ignored). */
const PERMISSIONS_SECTION = 'permissions';

export interface CompileSettingsOfflineOptions {
  bin?: string;
  timeoutMs?: number;
}

/**
 * Compile a config project's app_settings OFFLINE and return the parsed document.
 *
 * Steps (mirrors the offline-convert sandbox posture so the mount is never
 * mutated):
 *  1. Copy the config into a fresh sandbox (`createConvertSandbox` — excludes
 *     node_modules/.git/.cht-agent).
 *  2. SYMLINK the SOURCE config's `node_modules` into the sandbox (read-only use)
 *     so webpack can resolve the config's runtime deps (cht-nootils, dayjs). The
 *     sandbox copy deliberately excludes node_modules (heavyweight); the symlink
 *     restores just the resolution path without copying ~300MB.
 *  3. Run `compile-app-settings` (NODE_OPTIONS=--openssl-legacy-provider set by
 *     the runner for webpack-4 under Node>=17).
 *  4. Read + JSON.parse `<sandbox>/app_settings.json`.
 *
 * Throws a clear, prerequisite-naming error when node_modules is absent (webpack
 * cannot resolve the config deps) or the compile fails. The caller owns removing
 * the returned sandbox dir.
 */
export const compileSettingsOffline = async (
  configPath: string,
  options: CompileSettingsOfflineOptions = {}
): Promise<{ settings: Record<string, unknown>; sandboxDir: string }> => {
  const sourceNodeModules = path.join(configPath, 'node_modules');
  if (!fs.existsSync(sourceNodeModules)) {
    throw new Error(
      `compileSettingsOffline: ${configPath}/node_modules is missing — the offline ` +
        `compile needs the config's installed runtime deps (cht-nootils, dayjs) for ` +
        `webpack to resolve. Run \`npm ci\` in the config project first.`
    );
  }

  const sandboxDir = createConvertSandbox(configPath);
  try {
    // Symlink (not copy) the source node_modules into the sandbox: read-only use,
    // avoids duplicating ~300MB, and keeps the sandbox otherwise mount-independent.
    const sandboxNodeModules = path.join(sandboxDir, 'node_modules');
    if (!fs.existsSync(sandboxNodeModules)) {
      fs.symlinkSync(sourceNodeModules, sandboxNodeModules, 'dir');
    }

    const run: ChtConfExecResult = await runOfflineCompile({
      configPath: sandboxDir,
      bin: options.bin,
      timeoutMs: options.timeoutMs,
    });
    if (run.exitCode !== 0 || run.timedOut || run.startError !== undefined) {
      let why: string;
      if (run.timedOut) {
        why = 'timed out';
      } else if (run.startError !== undefined) {
        why = `failed to start: ${run.startError}`;
      } else {
        why = `exited with code ${run.exitCode}`;
      }
      // Surface a bounded output tail so the failure is diagnosable without the
      // full (potentially large) webpack log.
      const tail = run.output.slice(-1000);
      throw new Error(`compileSettingsOffline: compile-app-settings ${why}\n${tail}`);
    }

    const settingsPath = path.join(sandboxDir, APP_SETTINGS_JSON);
    if (!fs.existsSync(settingsPath)) {
      throw new Error(
        `compileSettingsOffline: compile-app-settings produced no ${APP_SETTINGS_JSON} in the sandbox`
      );
    }
    const parsed = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as unknown;
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`compileSettingsOffline: ${APP_SETTINGS_JSON} is not a JSON object`);
    }
    return { settings: parsed as Record<string, unknown>, sandboxDir };
  } catch (error) {
    // On failure the caller never gets the sandbox path, so clean it up here.
    fs.rmSync(sandboxDir, { recursive: true, force: true });
    throw error;
  }
};

/**
 * Derive the compiled-document sections a settings artifact owns.
 *  - `task` / `target` → the `tasks` section: `tasks.rules` (minified string),
 *    `tasks.targets` (object), `tasks.isDeclarative` (scalar).
 *  - `contact-summary` → `contact_summary` (minified string).
 *  - `app-settings` → EVERY compiled top-level key (whole-document scope) — the
 *    caller passes the compiled doc so the sections are its actual keys.
 */
export const deriveSettingsSections = (
  configArtifact: string,
  compiled: Record<string, unknown>
): SettingsSection[] => {
  switch (configArtifact) {
    case 'task':
    case 'target':
      return ['tasks.rules', 'tasks.targets', 'tasks.isDeclarative'];
    case 'contact-summary':
      return ['contact_summary'];
    case 'app-settings':
      // Whole-document scope: every top-level key the compiler produced.
      return Object.keys(compiled);
    default:
      throw new Error(
        `deriveSettingsSections: unsupported settings artifact "${configArtifact}" ` +
          `(handles task, target, contact-summary, app-settings)`
      );
  }
};

/** Read a dotted path (e.g. `tasks.rules`) out of a document; undefined when absent. */
const readPath = (doc: Record<string, unknown>, dotted: string): unknown => {
  const segments = dotted.split('.');
  let cursor: unknown = doc;
  for (const seg of segments) {
    if (cursor === null || typeof cursor !== 'object' || Array.isArray(cursor)) {
      return undefined;
    }
    cursor = (cursor as Record<string, unknown>)[seg];
  }
  return cursor;
};

/** True when a section path is present (not undefined) in the document. */
const pathPresent = (doc: Record<string, unknown>, dotted: string): boolean =>
  readPath(doc, dotted) !== undefined;

/**
 * First-difference hint for two long strings: their lengths and the first index
 * at which they diverge. Never dumps the strings themselves (they can be ~200KB
 * minified bundles).
 */
const stringDiffNote = (compiled: string, deployed: string): string => {
  let i = 0;
  const min = Math.min(compiled.length, deployed.length);
  while (i < min && compiled[i] === deployed[i]) {
    i++;
  }
  return (
    `string differs — compiled length ${compiled.length}, deployed length ${deployed.length}, ` +
    `first divergence at index ${i}`
  );
};

/**
 * Structural deep-equality (order-sensitive for objects, matching the empirical
 * key-order-identical finding). Values here are JSON (from JSON.parse), so
 * NaN/functions/undefined-in-arrays are not a concern.
 */
const deepEqual = (a: unknown, b: unknown): boolean => {
  if (a === b) {
    return true;
  }
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    return false;
  }
  const aArr = Array.isArray(a);
  const bArr = Array.isArray(b);
  if (aArr !== bArr) {
    return false;
  }
  if (aArr && bArr) {
    if (a.length !== b.length) {
      return false;
    }
    return a.every((el, i) => deepEqual(el, b[i]));
  }
  const aKeys = Object.keys(a as Record<string, unknown>);
  const bKeys = Object.keys(b as Record<string, unknown>);
  if (aKeys.length !== bKeys.length) {
    return false;
  }
  return aKeys.every((k) =>
    Object.prototype.hasOwnProperty.call(b, k) &&
    deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])
  );
};

/**
 * Compare the `permissions` section under the compiled-keys-only rule: iterate
 * ONLY the keys present in `compiled.permissions`, deep-equal each against the
 * deployed value. Deployed-only permission keys (server defaults) are ignored.
 * Returns null when either side has no permissions object (nothing to compare).
 */
const comparePermissions = (
  compiled: Record<string, unknown>,
  deployed: Record<string, unknown>
): SettingsSectionCheck => {
  const compiledPerms = compiled[PERMISSIONS_SECTION];
  const deployedPerms = deployed[PERMISSIONS_SECTION];
  if (compiledPerms === null || typeof compiledPerms !== 'object' || Array.isArray(compiledPerms)) {
    // No compiled permissions object: nothing the compiler owns here → pass.
    return { path: PERMISSIONS_SECTION, passed: true, note: 'no compiled permissions to compare' };
  }
  if (deployedPerms === null || typeof deployedPerms !== 'object' || Array.isArray(deployedPerms)) {
    return {
      path: PERMISSIONS_SECTION,
      passed: false,
      note: 'deployed settings has no permissions object',
    };
  }
  const compiledMap = compiledPerms as Record<string, unknown>;
  const deployedMap = deployedPerms as Record<string, unknown>;
  const mismatched: string[] = [];
  for (const key of Object.keys(compiledMap)) {
    if (!deepEqual(compiledMap[key], deployedMap[key])) {
      mismatched.push(key);
    }
  }
  if (mismatched.length === 0) {
    return {
      path: PERMISSIONS_SECTION,
      passed: true,
      note: `${Object.keys(compiledMap).length} compiled permission key(s) match (deployed-only keys ignored)`,
    };
  }
  return {
    path: PERMISSIONS_SECTION,
    passed: false,
    note: `${mismatched.length} compiled permission key(s) differ: ${mismatched.slice(0, 5).join(', ')}`,
  };
};

/**
 * Compare one section/path of the compiled document against the deployed one.
 * `permissions` uses the compiled-keys-only rule; the two string sections use
 * strict `===` with a first-difference hint; everything else deep-equals (objects)
 * or `===` (scalars).
 */
const compareSection = (
  section: SettingsSection,
  compiled: Record<string, unknown>,
  deployed: Record<string, unknown>
): SettingsSectionCheck => {
  if (section === PERMISSIONS_SECTION) {
    return comparePermissions(compiled, deployed);
  }

  const compiledVal = readPath(compiled, section);
  const deployedVal = readPath(deployed, section);

  // A section the compiler owns must be present in the compiled document; if it
  // is not, the derivation named a section this config does not produce.
  if (!pathPresent(compiled, section)) {
    return {
      path: section,
      passed: false,
      note: 'section absent from the compiled document (nothing to compare)',
    };
  }
  if (!pathPresent(deployed, section)) {
    return { path: section, passed: false, note: 'section present in compiled but ABSENT from deployed' };
  }

  if (STRING_SECTIONS.has(section)) {
    if (typeof compiledVal !== 'string' || typeof deployedVal !== 'string') {
      return {
        path: section,
        passed: false,
        note: `expected a bundle string on both sides (compiled ${typeof compiledVal}, deployed ${typeof deployedVal})`,
      };
    }
    if (compiledVal === deployedVal) {
      return { path: section, passed: true, note: `bundle string identical (${compiledVal.length} chars)` };
    }
    return { path: section, passed: false, note: stringDiffNote(compiledVal, deployedVal) };
  }

  if (deepEqual(compiledVal, deployedVal)) {
    return { path: section, passed: true };
  }
  const kind = typeof compiledVal === 'object' ? 'object' : 'scalar';
  return { path: section, passed: false, note: `${kind} differs between compiled and deployed` };
};

/**
 * Compare the artifact-owned `sections` of a compiled settings document against a
 * deployed one, per the comparator design at the top of this file. Pure — no I/O.
 * Returns one check per section plus a rolled-up pass/fail.
 */
export const compareCompiledSettings = (
  compiled: Record<string, unknown>,
  deployed: Record<string, unknown>,
  sections: SettingsSection[]
): { passed: boolean; checks: SettingsSectionCheck[] } => {
  const checks = sections.map((section) => compareSection(section, compiled, deployed));
  return { passed: checks.every((check) => check.passed), checks };
};
