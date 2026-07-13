/**
 * Test-only offline convert oracle for the mission-05 xlsform specs.
 *
 * Deliberately INDEPENDENT of the production `cht-conf-runner` so the fidelity
 * spec proves the editor against a raw `cht` invocation (a runner bug can't
 * mask an editor bug). Convert-dependent specs self-skip when the converter is
 * unavailable — mirroring the tier-2 harness self-skip — so the default gate
 * suite stays green on hosts without cht/pyxform.
 */

import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/** Deployment-pinned cht-conf binary (same seam as resolveChtConfBin). */
export const resolveConvertBin = (): string => process.env.CHT_CONF_BIN || 'cht';

/**
 * True when an offline `convert-app-forms` can run here: the pinned cht binary
 * resolves and reports a version. cht >= 4 bundles its own pyxform; the runtime
 * image bakes `xls2xform-medic` for the <= 3 case. On a bare CI host (no cht)
 * this is false and convert-dependent describe() blocks skip.
 */
export const canOfflineConvert = (): boolean => {
  try {
    const res = spawnSync(resolveConvertBin(), ['--version'], { timeout: 15000 });
    return res.status === 0;
  } catch {
    return false;
  }
};

/** Copy a config project to a fresh tmp dir so edit+convert never touches the fixture. */
export const stageProject = (srcDir: string): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cht-agent-convtest-'));
  fs.cpSync(srcDir, dir, { recursive: true });
  return dir;
};

/**
 * Run the documented URL-less convert for one app form (PLANTED-BUG.md:95-101):
 * `cht --source=<dir> --skip-* convert-app-forms -- <form>`. Regenerates
 * `<dir>/forms/app/<form>.xml` in place.
 */
export const offlineConvertForm = (
  projectDir: string,
  formName: string
): { status: number; stdout: string; stderr: string } => {
  const res = spawnSync(
    resolveConvertBin(),
    [
      `--source=${projectDir}`,
      '--skip-dependency-check',
      '--skip-validate',
      '--skip-version-check',
      '--skip-git-check',
      '--skip-translation-check',
      'convert-app-forms',
      '--',
      formName,
    ],
    { cwd: projectDir, timeout: 120000, encoding: 'utf-8' }
  );
  return { status: res.status ?? -1, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
};
