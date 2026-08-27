/**
 * Test-gen verification — prove a generated spec red→green before it ships.
 *
 * Motivated by the live m4 incident (2026-08-26): the LLM test-gen path
 * produced two harness specs whose fixtures were broken (wrong report field
 * name; one-level lineage where the config walks four), and NOTHING executed
 * them — the ticket's pinned qaSpecs displaced them in tier-2, and test-gen is
 * the dev graph's terminal node. One spec failed when finally run by hand; the
 * other passed vacuously (its parsed dose set was always empty).
 *
 * The rule this module enforces is the pipeline's own: an artifact is
 * trustworthy only when a deterministic run proves it. For a spec, "proven" is
 * the red→green discipline:
 *   RUNS  — mocha executes it with no fixture/environment crash;
 *   RED   — it FAILS against the PRE-FIX sources (it can detect the bug);
 *   GREEN — it PASSES with the fix applied (the fix satisfies it).
 *
 * Mechanics reuse the proven pieces: `createConvertSandbox` for the isolated
 * copy (node_modules symlinked, mount never touched — at test-gen time the
 * mount IS the pre-fix baseline, the fix exists only as GeneratedFiles),
 * `runTier2` for the mocha runs (env allowlist, TZ, timeout, tail capture,
 * environmental-failure classification) and `runOfflineCompile` for settings
 * artifacts (the harness reads the COMPILED app_settings.json, so each side of
 * the red/green needs its own compile).
 *
 * Scope: the LLM test-gen path only (settings artifacts — all text files). The
 * deterministic form/contact-form specs are derived from a verified bindDiff
 * and are executed by QA tier-2's default selection already.
 *
 * Opt-in via TEST_GEN_VERIFY=1 (two harness boots + up to two offline compiles
 * per attempt is real wall-clock); TEST_GEN_MAX_REPAIRS bounds the repair loop
 * (default 2).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { GeneratedFile, SpecVerification } from '../../../types';
import {
  harnessRunnable,
  isTier2EnvironmentalFailure,
  resolveRepoMocha,
  runTier2,
  tier2TailExcerpt,
} from '../../../utils/cht-conf-tier2';
import { createConvertSandbox, runOfflineCompile } from '../../../utils/cht-conf-runner';

/** Opt-in gate: TEST_GEN_VERIFY=1|true. Default OFF (wall-clock cost). */
export const testGenVerifyEnabled = (): boolean =>
  process.env.TEST_GEN_VERIFY === '1' || process.env.TEST_GEN_VERIFY === 'true';

/** Bounded repair budget: TEST_GEN_MAX_REPAIRS, default 2, clamped 0–5. */
export const testGenMaxRepairs = (): number => {
  const raw = Number.parseInt(process.env.TEST_GEN_MAX_REPAIRS ?? '', 10);
  if (Number.isNaN(raw)) {
    return 2;
  }
  return Math.min(5, Math.max(0, raw));
};

/** The artifacts whose harness specs read the COMPILED app_settings.json. */
const SETTINGS_ARTIFACTS = new Set(['task', 'target', 'contact-summary', 'app-settings']);
export const artifactNeedsCompile = (configArtifact: string | undefined): boolean =>
  configArtifact !== undefined && SETTINGS_ARTIFACTS.has(configArtifact);

/** Injectable seams so the matrix logic is unit-testable without a harness. */
export interface VerifySeams {
  runTier2Fn?: typeof runTier2;
  compileFn?: typeof runOfflineCompile;
}

export interface VerifyGeneratedSpecsOptions extends VerifySeams {
  /** The config project root (the mount — read only; all runs use a sandbox). */
  configRoot: string;
  /** This run's generated spec files (in-memory; not yet in the mount). */
  specFiles: ReadonlyArray<GeneratedFile>;
  /** This run's fix files (in-memory; the mount is still pre-fix). */
  fixFiles: ReadonlyArray<GeneratedFile>;
  /** True for settings artifacts — compile app_settings on each side. */
  needsCompile: boolean;
}

const writeGenerated = (root: string, files: ReadonlyArray<GeneratedFile>): void => {
  for (const file of files) {
    const target = path.join(root, file.relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, file.content, 'utf8');
  }
};

/** Revert fix files inside the sandbox to their pre-fix state. */
const revertGenerated = (root: string, files: ReadonlyArray<GeneratedFile>): void => {
  for (const file of files) {
    const target = path.join(root, file.relativePath);
    if (file.action === 'modify' && file.originalContent !== undefined) {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, file.originalContent, 'utf8');
    } else {
      fs.rmSync(target, { force: true });
    }
  }
};

const unproven = (partial: Partial<SpecVerification> & { reason: string }): SpecVerification => ({
  ran: true,
  verified: false,
  repairs: 0,
  ...partial,
});

/**
 * One red→green verification pass over the generated spec set.
 *
 * Order is RED first (mount content = pre-fix, so the first sandbox state is
 * already the baseline), then the fix files are written on top for GREEN —
 * one sandbox, two runs, at most two compiles.
 */
export const verifyGeneratedSpecs = async (
  options: VerifyGeneratedSpecsOptions,
): Promise<SpecVerification> => {
  const { configRoot, specFiles, fixFiles, needsCompile } = options;
  const runTier2Fn = options.runTier2Fn ?? runTier2;
  const compileFn = options.compileFn ?? runOfflineCompile;

  if (specFiles.length === 0) {
    return { ran: false, verified: false, repairs: 0, reason: 'no generated specs to verify' };
  }
  const specRelPaths = specFiles.map((f) => f.relativePath);
  const nonSpec = specRelPaths.filter((rel) => !/\.spec\.[jt]s$/.test(rel));
  if (nonSpec.length > 0) {
    return {
      ran: false, verified: false, repairs: 0,
      reason: `generated test output contains non-spec files (${nonSpec.join(', ')}) — verification handles mocha specs only`,
    };
  }
  const runnable = harnessRunnable(configRoot, resolveRepoMocha(configRoot));
  if (!runnable.ok) {
    return { ran: false, verified: false, repairs: 0, reason: runnable.reason };
  }

  let sandbox: string | undefined;
  try {
    sandbox = createConvertSandbox(configRoot);
    const nodeModules = path.join(sandbox, 'node_modules');
    if (!fs.existsSync(nodeModules)) {
      fs.symlinkSync(path.join(configRoot, 'node_modules'), nodeModules, 'dir');
    }
    // Belt and braces: the sandbox copy of the mount must be PRE-fix. The
    // mount normally is (the code-gen module rolls its edits back), but a
    // stale tree would silently invert red/green — revert defensively.
    revertGenerated(sandbox, fixFiles);
    writeGenerated(sandbox, specFiles);

    const mochaBin = resolveRepoMocha(configRoot);
    const runSpecs = async (): Promise<{ passed: boolean | undefined; tail: string | undefined }> => {
      const result = await runTier2Fn({
        configRoot: sandbox as string,
        configArtifact: 'app-settings', // selection is fully pinned below; artifact is display-only here
        artifactName: '(test-gen verify)',
        qaSpecs: specRelPaths,
        mochaBin,
      });
      if (!result.ran) {
        return { passed: undefined, tail: result.reason };
      }
      return { passed: result.passed, tail: result.outputTail };
    };

    // RED — the specs must FAIL against the pre-fix sources, on an assertion.
    if (needsCompile) {
      const compile = await compileFn({ configPath: sandbox });
      if (compile.exitCode !== 0) {
        return unproven({ reason: `pre-fix offline compile failed: ${tier2TailExcerpt(compile.output, 5)}` });
      }
    }
    const red = await runSpecs();
    if (red.passed === undefined) {
      return unproven({ reason: `RED run did not start: ${red.tail ?? 'unknown'}` });
    }
    if (isTier2EnvironmentalFailure(red.tail)) {
      return unproven({
        red: false, redTail: red.tail,
        reason: 'RED run crashed environmentally (harness browser) — the specs never executed',
      });
    }
    if (red.passed) {
      return unproven({
        red: false, redTail: red.tail,
        reason: 'specs PASS against the PRE-FIX sources — they cannot detect the bug (vacuous fixtures?)',
      });
    }

    // GREEN — with the fix applied, the same specs must pass.
    writeGenerated(sandbox, fixFiles);
    if (needsCompile) {
      const compile = await compileFn({ configPath: sandbox });
      if (compile.exitCode !== 0) {
        return unproven({ red: true, redTail: red.tail, reason: `post-fix offline compile failed: ${tier2TailExcerpt(compile.output, 5)}` });
      }
    }
    const green = await runSpecs();
    if (green.passed !== true) {
      return unproven({
        red: true, green: false, redTail: red.tail, greenTail: green.tail,
        reason: 'specs FAIL with the fix applied — the spec (or its fixtures) contradicts the machine-verified fix',
      });
    }

    return {
      ran: true, verified: true, red: true, green: true, repairs: 0,
      redTail: red.tail, greenTail: green.tail,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ran: false, verified: false, repairs: 0, reason: `verification errored: ${message}` };
  } finally {
    if (sandbox) {
      fs.rmSync(sandbox, { recursive: true, force: true });
    }
  }
};

/**
 * The repair feedback handed back to test-gen when a pass is unproven. States
 * the invariant out loud: the FIX is already machine-verified, so a failing or
 * vacuous spec indicts the SPEC's fixtures, never the fix.
 */
export const buildSpecRepairBrief = (verification: SpecVerification): string => {
  const lines: string[] = [
    'The generated spec(s) were executed against the real config (red→green verification) and are NOT proven:',
    `- verdict: ${verification.reason ?? 'unproven'}`,
  ];
  if (verification.red === false && verification.redTail) {
    lines.push('', 'Output against the PRE-FIX sources (the specs MUST fail here, on the bug):',
      tier2TailExcerpt(verification.redTail, 12));
  }
  if (verification.green === false && verification.greenTail) {
    lines.push('', 'Output WITH the fix applied (the specs MUST pass here):',
      tier2TailExcerpt(verification.greenTail, 12));
  }
  lines.push(
    '',
    'Rules for the repair:',
    '- The FIX is already machine-verified (deterministic apply / compiled-settings oracle). Do NOT change it.',
    '- The defect is in the SPEC: almost always a fixture that does not match the real config —',
    '  wrong report field names (read the form/config source for the exact paths the code reads),',
    '  missing contact lineage depth, wrong choice values, or a date that changes which items are due.',
    '- Regenerate ONLY the spec file(s). Keep the same scenarios; fix the fixtures so the specs',
    '  FAIL against the pre-fix sources and PASS with the fix.',
  );
  return lines.join('\n');
};
