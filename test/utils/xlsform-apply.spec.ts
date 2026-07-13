import { expect } from 'chai';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { applyXlsformFixToProject, collateralChangedLines } from '../../src/utils/xlsform-apply';
import { XlsformFixDescriptor } from '../../src/utils/xlsform-fix';
import { canOfflineConvert } from '../helpers/offline-convert';

const CONFIG = path.resolve('demo/config-pnc-demo');
const YES_GATE = "selected(../pregnancy_summary/visit_option, 'yes')";
const PLANTED_GATE =
  "selected(../pregnancy_summary/visit_option, 'yes') or selected(../pregnancy_summary/visit_option, 'miscarriage')";

const descriptor = (overrides: Partial<XlsformFixDescriptor> = {}): XlsformFixDescriptor => ({
  version: 1,
  form: 'pregnancy_home_visit',
  edits: [
    { sheet: 'survey', match: { column: 'name', value: 'danger_signs' }, set: { column: 'relevant', value: YES_GATE } },
  ],
  expect: { nodeset: '/data/danger_signs', relevant: YES_GATE, siblingsUnchanged: true },
  rationale: 'Restore the yes-only gate.',
  ...overrides,
});

describe('collateralChangedLines (mission 05 — child-bind collateral detection)', () => {
  const model = (danger: string, leaf: string, summary: string): string =>
    [
      '<model>',
      `  <bind nodeset="/data/danger_signs" relevant="${danger}"/>`,
      `  <bind nodeset="/data/danger_signs/leaf" relevant="${leaf}"/>`,
      `  <bind nodeset="/data/summary" relevant="${summary}"/>`,
      '</model>',
    ].join('\n');

  it('reports no collateral when ONLY the target bind line changed', () => {
    const baseline = model(PLANTED_GATE, 'true()', 'S');
    const regen = model(YES_GATE, 'true()', 'S');
    expect(collateralChangedLines(baseline, regen, '/data/danger_signs')).to.deep.equal([]);
  });

  it('catches a changed CHILD bind that the top-level-group oracle misses', () => {
    const baseline = model(PLANTED_GATE, 'true()', 'S');
    const regen = model(YES_GATE, 'false()', 'S'); // target fixed + child corrupted
    const collateral = collateralChangedLines(regen, baseline, '/data/danger_signs');
    // a changed line surfaces as both its old and new form; the point is it is flagged
    expect(collateral.length).to.be.greaterThan(0);
    expect(collateral.join('\n')).to.contain('/data/danger_signs/leaf');
  });

  it('catches a changed top-level sibling bind too', () => {
    const baseline = model(PLANTED_GATE, 'true()', 'S');
    const regen = model(YES_GATE, 'true()', 'DIFFERENT');
    const collateral = collateralChangedLines(baseline, regen, '/data/danger_signs');
    expect(collateral.length).to.be.greaterThan(0);
    expect(collateral.join('\n')).to.contain('/data/summary');
  });

  it('does not confuse the target with a same-prefix child nodeset', () => {
    // only the /data/danger_signs/leaf line differs; the exact-quote marker
    // must NOT treat it as the target -> it IS flagged as collateral.
    const baseline = model(YES_GATE, 'true()', 'S');
    const regen = model(YES_GATE, 'false()', 'S');
    const collateral = collateralChangedLines(baseline, regen, '/data/danger_signs');
    expect(collateral.length).to.be.greaterThan(0);
    expect(collateral.join('\n')).to.contain('/data/danger_signs/leaf');
  });
});

const withConvert = canOfflineConvert() ? describe : describe.skip;

withConvert('applyXlsformFixToProject (mission 05, self-skips without cht)', function () {
  this.timeout(180000);
  const cleanups: string[] = [];

  after(() => {
    for (const dir of cleanups) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('applies + converts + asserts the planted fix and stashes the artifacts', async () => {
    const outcome = await applyXlsformFixToProject(descriptor(), CONFIG);
    expect(outcome.ok, outcome.ok ? '' : outcome.error).to.equal(true);
    if (!outcome.ok) {
      return;
    }
    cleanups.push(outcome.result.sandboxDir);
    expect(outcome.result.bindDiff.before).to.equal(PLANTED_GATE);
    expect(outcome.result.bindDiff.after).to.equal(YES_GATE);
    expect(outcome.result.bindDiff.siblingsUnchanged).to.be.greaterThan(0);
    expect(outcome.appliedEdits).to.have.length(1);
    expect(outcome.appliedEdits[0].cellAddress).to.equal('K153');
    // artifacts exist in the sandbox and the corrected xml carries the fix
    expect(fs.existsSync(outcome.result.xlsxPath)).to.equal(true);
    const xml = fs.readFileSync(outcome.result.xmlPath, 'utf-8');
    expect(xml).to.contain(`relevant="${YES_GATE}"`);
    // the planted widened gate is gone (miscarriage still appears as a choice value)
    expect(xml).to.not.contain(PLANTED_GATE);
    // the real fixture was never touched
    expect(outcome.result.sandboxDir).to.not.equal(CONFIG);
  });

  it('fails (and cleans up) when the converted bind does not match expect.relevant', async () => {
    const d = descriptor({ expect: { nodeset: '/data/danger_signs', relevant: 'WRONG()', siblingsUnchanged: true } });
    const outcome = await applyXlsformFixToProject(d, CONFIG);
    expect(outcome.ok).to.equal(false);
    if (!outcome.ok) {
      expect(outcome.error).to.match(/converted to .* but expect\.relevant/);
    }
  });

  it('fails when the edit matches no row', async () => {
    const d = descriptor({
      edits: [{ sheet: 'survey', match: { column: 'name', value: 'no_such_question' }, set: { column: 'relevant', value: YES_GATE } }],
    });
    const outcome = await applyXlsformFixToProject(d, CONFIG);
    expect(outcome.ok).to.equal(false);
    if (!outcome.ok) {
      expect(outcome.error).to.match(/edit failed \(no-match\)/);
    }
  });

  it('fails when the expected bind nodeset is absent from the converted XML', async () => {
    const d = descriptor({ expect: { nodeset: '/data/does_not_exist', relevant: YES_GATE } });
    const outcome = await applyXlsformFixToProject(d, CONFIG);
    expect(outcome.ok).to.equal(false);
    if (!outcome.ok) {
      expect(outcome.error).to.match(/not present in the regenerated XML/);
    }
  });

  it('reports siblingsUnchanged: 0 when the invariance check is disabled (honest count)', async () => {
    const d = descriptor({ expect: { nodeset: '/data/danger_signs', relevant: YES_GATE, siblingsUnchanged: false } });
    const outcome = await applyXlsformFixToProject(d, CONFIG);
    expect(outcome.ok, outcome.ok ? '' : outcome.error).to.equal(true);
    if (outcome.ok) {
      cleanups.push(outcome.result.sandboxDir);
      expect(outcome.result.bindDiff.siblingsUnchanged).to.equal(0);
    }
  });
});
