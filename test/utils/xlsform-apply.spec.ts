import { expect } from 'chai';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { applyXlsformFixToProject } from '../../src/utils/xlsform-apply';
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
});
