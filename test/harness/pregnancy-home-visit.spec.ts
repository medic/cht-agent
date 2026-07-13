/**
 * Tier-2 QA proof (mission 04 A2) — headless Enketo skip-logic check for the
 * PNC demo bug, via `cht-conf-test-harness` (real Enketo in headless Chromium).
 *
 * This is the assertion that "the miscarriage symptom is gone and the
 * ongoing-pregnancy behaviour is intact": with `visit_option = miscarriage` the
 * `danger_signs` group must be SKIPPED; with `visit_option = yes` it must STILL
 * appear. Run against the PLANTED config it must FAIL (red = symptom
 * reproduced); against the CORRECTED config it must PASS (green = fix proven).
 *
 * NOT part of the default gate suite: it is excluded via `.mocharc.json`
 * `ignore` and run explicitly with `npm run test:harness` (`.mocharc.harness.json`).
 * It also self-skips when the harness (and its Chromium) is not installed, so a
 * plain `npm test` stays green in a Chromium-less container.
 *
 *   OPERATOR / CI notes (verified against cht-conf-test-harness 5.0.4):
 *   - `npm i` pulls puppeteer-chromium-resolver, which downloads Chromium 93
 *     to ~/.chromium-browser-snapshots on install (needs network). The agent
 *     runtime image (docker/Dockerfile) bakes the puppeteer Debian libs and
 *     relocates that snapshot to the agent user's home, with a fail-closed
 *     launch check at build — this spec runs in-container. Hosts without
 *     Chromium still self-skip (see above).
 *   - Harness 5.0.4 bundles ONLY cht-core 4.11 — coreVersion must be '4.11.0'
 *     (any 5.x throws). The demo config is cht-core 5.2.0 config/default; the
 *     `relevant` skip-logic is standard XForms and reproduces under 4.11
 *     emulation, but note the version gap.
 *   - The per-page answer arrays for fillForm depend on the compiled form's
 *     visible-question order; complete PAGES_* against the compiled XML on first
 *     run (the assertion below is the stable part).
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { expect } from 'chai';

// Optional dependency: present only in a Chromium-equipped image/CI.
let Harness: new (options: Record<string, unknown>) => HarnessLike;
try {
  // Optional dep — resolved only in a Chromium image; absent here by design.
  // eslint-disable-next-line @typescript-eslint/no-var-requires, n/no-missing-require, n/no-unpublished-require
  Harness = require('cht-conf-test-harness');
} catch {
  Harness = undefined as unknown as typeof Harness;
}

interface FillResult {
  errors: unknown[];
  report?: { form: string; fields: Record<string, unknown> };
}
interface HarnessLike {
  start(): Promise<void>;
  stop(): Promise<void>;
  clear(): Promise<void>;
  fillForm(formName: string, ...pages: string[][]): Promise<FillResult>;
}

const DEMO_CONFIG = path.resolve('demo/config-pnc-demo');
const FORM = 'pregnancy_home_visit';
const FORM_XML_REL = path.join('forms', 'app', `${FORM}.xml`);

// The correct yes-only gate and the planted, widened gate.
const YES_GATE = "selected(../pregnancy_summary/visit_option, 'yes')";
const PLANTED_GATE =
  "selected(../pregnancy_summary/visit_option, 'yes') or selected(../pregnancy_summary/visit_option, 'miscarriage')";

// Per-page answers for fillForm. The first array drives the pregnancy_summary
// page where visit_option is chosen; the trailing arrays cover the pages the
// form still shows for that outcome. CONFIRM these against the compiled form on
// first run — the danger_signs assertion is the invariant that matters.
const PAGES_MISCARRIAGE: string[][] = [['miscarriage']];
const PAGES_YES: string[][] = [['yes'], ['no', 'no', 'no']];

/** A group is "shown" when its node survived the irrelevant:false prune and holds a value. */
const groupShown = (fields: Record<string, unknown>, group: string): boolean => {
  const node = fields[group];
  if (node === undefined || node === null) {
    return false;
  }
  if (typeof node !== 'object') {
    return node !== '';
  }
  return Object.values(node as Record<string, unknown>).some((v) => v !== '' && v !== null && v !== undefined);
};

/** Copy the demo config to a temp project and (optionally) correct the danger_signs bind. */
const buildProject = (label: string, correct: boolean): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `phv-${label}-`));
  fs.cpSync(DEMO_CONFIG, dir, { recursive: true });
  // coreVersion is the only 4.11-supported target for harness 5.0.4.
  fs.writeFileSync(path.join(dir, 'harness.defaults.json'), JSON.stringify({ coreVersion: '4.11.0' }, null, 2));
  if (correct) {
    const xmlPath = path.join(dir, FORM_XML_REL);
    const xml = fs.readFileSync(xmlPath, 'utf8').replace(PLANTED_GATE, YES_GATE);
    fs.writeFileSync(xmlPath, xml);
  }
  return dir;
};

const maybe = Harness ? describe : describe.skip;

maybe('pregnancy_home_visit danger_signs skip-logic (cht-conf-test-harness)', function () {
  this.timeout(120000);

  const runOutcome = async (projectDir: string, pages: string[][]): Promise<FillResult> => {
    const harness = new Harness({
      directory: projectDir,
      coreVersion: '4.11.0',
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
    await harness.start();
    try {
      await harness.clear();
      return await harness.fillForm(FORM, ...pages);
    } finally {
      await harness.stop();
    }
  };

  describe('CORRECTED config (green = fix proven)', () => {
    let dir: string;
    before(() => { dir = buildProject('corrected', true); });
    after(() => { fs.rmSync(dir, { recursive: true, force: true }); });

    it('SKIPS danger_signs when visit_option = miscarriage', async () => {
      const result = await runOutcome(dir, PAGES_MISCARRIAGE);
      expect(result.report, 'form did not submit — complete PAGES_MISCARRIAGE for the compiled form').to.not.equal(undefined);
      expect(groupShown(result.report!.fields, 'danger_signs')).to.equal(false);
    });

    it('STILL shows danger_signs when visit_option = yes (no regression)', async () => {
      const result = await runOutcome(dir, PAGES_YES);
      expect(result.report).to.not.equal(undefined);
      expect(groupShown(result.report!.fields, 'danger_signs')).to.equal(true);
    });
  });

  describe('PLANTED config (red = symptom reproduced)', () => {
    let dir: string;
    before(() => { dir = buildProject('planted', false); });
    after(() => { fs.rmSync(dir, { recursive: true, force: true }); });

    it('WRONGLY shows danger_signs when visit_option = miscarriage', async () => {
      const result = await runOutcome(dir, PAGES_MISCARRIAGE);
      expect(result.report).to.not.equal(undefined);
      // The bug: the widened gate leaves danger_signs relevant for miscarriage.
      expect(groupShown(result.report!.fields, 'danger_signs')).to.equal(true);
    });
  });
});
