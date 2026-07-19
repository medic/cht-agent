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
  expect: { nodeset: '/data/danger_signs', attrs: { relevant: YES_GATE }, siblingsUnchanged: true },
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

  // F1: the exceljs re-save perturbs pyxform's attribute ordering (required
  // migrating to a tag's end, relevant/calculate swapping) — a raw line diff
  // reports every reordered tag as collateral. The canonicalizer must neutralize
  // pure attribute-ORDER churn.
  describe('attribute-order insensitivity (mission 05 follow-up F1)', () => {
    const orderA = (danger: string): string =>
      [
        '<model>',
        `  <bind nodeset="/data/danger_signs" relevant="${danger}" required="true()"/>`,
        `  <bind nodeset="/data/summary" calculate="format-date(x)" relevant="${YES_GATE}" constraint=". != ''"/>`,
        `  <bind nodeset="/data/danger_signs/leaf" type="string" relevant="true()"/>`,
        '</model>',
      ].join('\n');
    // Same binds, same values, permuted attribute positions on every tag.
    const orderB = (danger: string): string =>
      [
        '<model>',
        `  <bind required="true()" relevant="${danger}" nodeset="/data/danger_signs"/>`,
        `  <bind relevant="${YES_GATE}" nodeset="/data/summary" constraint=". != ''" calculate="format-date(x)"/>`,
        `  <bind relevant="true()" type="string" nodeset="/data/danger_signs/leaf"/>`,
        '</model>',
      ].join('\n');

    it('reports ZERO collateral when tags differ ONLY in attribute order', () => {
      const baseline = orderA(PLANTED_GATE);
      const regen = orderB(PLANTED_GATE); // same values, reordered attrs everywhere
      expect(collateralChangedLines(baseline, regen, '/data/danger_signs')).to.deep.equal([]);
    });

    it('reports ZERO collateral when the ONLY real change is the target bind, atop attr-order churn', () => {
      // The target bind's value also changes AND every tag is reordered; the
      // reordering must be neutralized and the target line excluded by marker.
      const baseline = orderA(PLANTED_GATE);
      const regen = orderB(YES_GATE);
      expect(collateralChangedLines(baseline, regen, '/data/danger_signs')).to.deep.equal([]);
    });

    it('still catches a real sibling value change hidden under attr-order churn', () => {
      const baseline = orderA(PLANTED_GATE);
      // reorder everything, fix the target, AND corrupt a sibling value
      const regen = orderB(YES_GATE).replace('calculate="format-date(x)"', 'calculate="format-date(y)"');
      const collateral = collateralChangedLines(baseline, regen, '/data/danger_signs');
      expect(collateral.length).to.be.greaterThan(0);
      expect(collateral.join('\n')).to.contain('/data/summary');
    });

    it('still catches a real child value change hidden under attr-order churn', () => {
      const baseline = orderA(PLANTED_GATE);
      const regen = orderB(YES_GATE).replace('relevant="true()" type="string"', 'relevant="false()" type="string"');
      const collateral = collateralChangedLines(baseline, regen, '/data/danger_signs');
      expect(collateral.length).to.be.greaterThan(0);
      expect(collateral.join('\n')).to.contain('/data/danger_signs/leaf');
    });
  });

  // F1 (follow-up): pyxform wraps a long constraint/calculate value across
  // physical lines, so a single <bind> spans two+ lines with a LITERAL newline
  // inside the quoted value. When the exceljs re-save migrates an attribute
  // (e.g. required="true()") ACROSS that newline, a per-physical-line diff sees
  // both physical lines change and reports false-positive collateral. The
  // canonicalizer must reassemble the whole tag before comparison. Fixtures here
  // mirror the real postnatal_care_service repro (mother_danger_signs bind).
  describe('multi-line tag reassembly (mission 05 follow-up F1)', () => {
    // required on the FIRST physical line, before the wrapped constraint value.
    const wrappedRequiredFirst = (root: string): string =>
      [
        '<model>',
        `  <bind nodeset="/${root}/danger_signs" required="true()" type="select" constraint="not(selected(., 'none')`,
        `and count-selected(.) &gt; 1)"/>`,
        `  <bind nodeset="/${root}/danger_signs/leaf" type="string" relevant="true()"/>`,
        '</model>',
      ].join('\n');
    // Identical bind, required MIGRATED across the newline to the tag end.
    const wrappedRequiredLast = (root: string): string =>
      [
        '<model>',
        `  <bind nodeset="/${root}/danger_signs" type="select" constraint="not(selected(., 'none')`,
        `and count-selected(.) &gt; 1)" required="true()"/>`,
        `  <bind nodeset="/${root}/danger_signs/leaf" type="string" relevant="true()"/>`,
        '</model>',
      ].join('\n');

    it('reports ZERO collateral when a multi-line tag differs ONLY in attr order across the newline', () => {
      const baseline = wrappedRequiredFirst('postnatal_care_service');
      const regen = wrappedRequiredLast('postnatal_care_service');
      // Sanity: raw physical lines DO differ (the churn is real), the oracle
      // must neutralize it at the tag level, not miss the difference entirely.
      expect(baseline).to.not.equal(regen);
      expect(collateralChangedLines(baseline, regen, '/postnatal_care_service/danger_signs')).to.deep.equal(
        []
      );
    });

    it('still catches a real value change inside a multi-line tag', () => {
      const baseline = wrappedRequiredFirst('postnatal_care_service');
      // reorder AND change the wrapped constraint value (> 1 -> > 2)
      const regen = wrappedRequiredLast('postnatal_care_service').replace('&gt; 1)', '&gt; 2)');
      const collateral = collateralChangedLines(
        baseline,
        regen,
        '/postnatal_care_service/danger_signs/leaf'
      );
      expect(collateral.length).to.be.greaterThan(0);
      expect(collateral.join('\n')).to.contain('count-selected');
    });

    it('excludes the target bind even when the target itself is a multi-line tag', () => {
      // The target IS the wrapped bind; its cross-newline attr churn must not be
      // reported (marker match) while a sibling change still would be.
      const baseline = wrappedRequiredFirst('postnatal_care_service');
      const regen = wrappedRequiredLast('postnatal_care_service').replace(
        'relevant="true()"',
        'relevant="false()"'
      );
      const collateral = collateralChangedLines(
        baseline,
        regen,
        '/postnatal_care_service/danger_signs'
      );
      // only the leaf sibling change surfaces; the target's churn is excluded
      expect(collateral.join('\n')).to.contain('/postnatal_care_service/danger_signs/leaf');
      expect(collateral.join('\n')).to.not.contain('count-selected');
    });
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
    // P2 (review): the per-attribute maps are populated on a passing apply —
    // attrs carries the asserted post-fix values, attrsBefore the baseline's.
    expect(outcome.result.bindDiff.attrs).to.deep.equal({ relevant: YES_GATE });
    expect(outcome.result.bindDiff.attrsBefore).to.deep.equal({ relevant: PLANTED_GATE });
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

  it('fails (and cleans up) when the converted bind does not match expect.attrs (P2)', async () => {
    const d = descriptor({ expect: { nodeset: '/data/danger_signs', attrs: { relevant: 'WRONG()' }, siblingsUnchanged: true } });
    const outcome = await applyXlsformFixToProject(d, CONFIG);
    expect(outcome.ok).to.equal(false);
    if (!outcome.ok) {
      // P2: the assertion is per-attribute now — the message names the attr.
      expect(outcome.error).to.match(/converted relevant=.* but expect\.attrs\.relevant/);
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
    const d = descriptor({ expect: { nodeset: '/data/does_not_exist', attrs: { relevant: YES_GATE } } });
    const outcome = await applyXlsformFixToProject(d, CONFIG);
    expect(outcome.ok).to.equal(false);
    if (!outcome.ok) {
      // P2: a value expectation on a missing bind reads '(none)' for that attr.
      expect(outcome.error).to.match(/no relevant attribute \(actual "\(none\)"\) but expect\.attrs\.relevant/);
    }
  });

  it('passes step-5a when expect.attrs.relevant differs from the converted value only in whitespace', async () => {
    // The converter trims/normalizes whitespace, so a leading space and internal
    // double-spaces written into expect.attrs.relevant must not fail the check
    // (F1). The edit still writes the clean YES_GATE into the cell.
    const spacedExpect = `  ${YES_GATE.replace(/ /g, '  ')}  `;
    expect(spacedExpect).to.not.equal(YES_GATE); // proves the values differ byte-for-byte
    const d = descriptor({
      expect: { nodeset: '/data/danger_signs', attrs: { relevant: spacedExpect }, siblingsUnchanged: true },
    });
    const outcome = await applyXlsformFixToProject(d, CONFIG);
    expect(outcome.ok, outcome.ok ? '' : outcome.error).to.equal(true);
    if (outcome.ok) {
      cleanups.push(outcome.result.sandboxDir);
      // the converted bind is the trimmed gate; the whitespace-only expect still matched
      expect(outcome.result.bindDiff.after).to.equal(YES_GATE);
    }
  });

  it('reports siblingsUnchanged: 0 when the invariance check is disabled (honest count)', async () => {
    const d = descriptor({ expect: { nodeset: '/data/danger_signs', attrs: { relevant: YES_GATE }, siblingsUnchanged: false } });
    const outcome = await applyXlsformFixToProject(d, CONFIG);
    expect(outcome.ok, outcome.ok ? '' : outcome.error).to.equal(true);
    if (outcome.ok) {
      cleanups.push(outcome.result.sandboxDir);
      expect(outcome.result.bindDiff.siblingsUnchanged).to.equal(0);
    }
  });

  // P2 GUARDRAIL (apply level): clearing the calculation on a real calculate-type
  // row (patient_age_in_years) fails fast with the descriptive guardrail error;
  // the post-edit convert is never reached (the edit step throws before it), so a
  // bad descriptor costs one informative retry, not a cryptic PyXFormError.
  it('GUARDRAIL: clearing calculation on a calculate-type row fails before the edit-convert', async () => {
    const d = descriptor({
      edits: [
        { sheet: 'survey', match: { column: 'name', value: 'patient_age_in_years' }, set: { column: 'calculation', clear: true } },
      ],
      expect: { nodeset: '/data/patient_age_in_years', attrs: { calculate: null } },
    });
    const outcome = await applyXlsformFixToProject(d, CONFIG);
    expect(outcome.ok).to.equal(false);
    if (!outcome.ok) {
      // Wrapped editor error — code + the descriptive reason, naming the row.
      expect(outcome.error).to.match(/workbook edit failed \(calculate-required\)/);
      expect(outcome.error).to.match(/type is "calculate"/);
      expect(outcome.error).to.match(/patient_age_in_years/);
      // it never got to the assert step (no "converted" / "expect.attrs" wording).
      expect(outcome.error).to.not.match(/expect\.attrs/);
    }
  });
});

// P1: the same deterministic apply→convert→assert core over a CONTACT form,
// exercising the forms/contact layout (resolver) and the contact-forms convert
// bucket end to end against the planted person-create contact-form fixture.
const CONTACT_FORM = 'person-create';
const CONTACT_NODESET = '/data/person/role_other';
// The unedited fixture bind converts to this (baseline).
const CONTACT_BASE = "selected(  /data/person/role ,'other')";

const contactDescriptor = (overrides: Partial<XlsformFixDescriptor> = {}): XlsformFixDescriptor => ({
  version: 1,
  form: CONTACT_FORM,
  edits: [
    { sheet: 'survey', match: { column: 'name', value: 'role_other' }, set: { column: 'relevant', value: 'false()' } },
  ],
  expect: { nodeset: CONTACT_NODESET, attrs: { relevant: 'false()' }, siblingsUnchanged: true },
  rationale: 'Gate the role_other free-text field off (contact-form apply path test).',
  ...overrides,
});

withConvert('applyXlsformFixToProject — contact-form path (P1)', function () {
  this.timeout(180000);
  const cleanups: string[] = [];

  after(() => {
    for (const dir of cleanups) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('applies + converts (contact-forms bucket) + asserts, staging forms/contact paths', async () => {
    const outcome = await applyXlsformFixToProject(contactDescriptor(), CONFIG, {
      configArtifact: 'contact-form',
    });
    expect(outcome.ok, outcome.ok ? '' : outcome.error).to.equal(true);
    if (!outcome.ok) {
      return;
    }
    cleanups.push(outcome.result.sandboxDir);
    // The resolver put both artifacts under forms/contact, not forms/app.
    expect(outcome.result.xlsxRelPath).to.equal(`forms/contact/${CONTACT_FORM}.xlsx`);
    expect(outcome.result.xmlRelPath).to.equal(`forms/contact/${CONTACT_FORM}.xml`);
    expect(outcome.result.xlsxPath).to.contain(`/forms/contact/${CONTACT_FORM}.xlsx`);
    expect(outcome.result.xmlPath).to.contain(`/forms/contact/${CONTACT_FORM}.xml`);
    // The contact-forms convert bucket produced the corrected bind (read-back).
    expect(outcome.result.bindDiff.nodeset).to.equal(CONTACT_NODESET);
    expect(outcome.result.bindDiff.before).to.equal(CONTACT_BASE);
    expect(outcome.result.bindDiff.after).to.equal('false()');
    expect(outcome.result.bindDiff.siblingsUnchanged).to.be.greaterThan(0);
    expect(outcome.appliedEdits).to.have.length(1);
    const xml = fs.readFileSync(outcome.result.xmlPath, 'utf-8');
    expect(xml).to.contain(`nodeset="${CONTACT_NODESET}"`);
    expect(xml).to.contain('relevant="false()"');
    // the real fixture was never touched
    expect(outcome.result.sandboxDir).to.not.equal(CONFIG);
  });

  it('defaults to the forms/app layout when configArtifact is omitted (back-compat)', async () => {
    // Omitting the opt must NOT reach the contact form — it looks under forms/app
    // and fails to find the workbook there, proving the default is `form`.
    const outcome = await applyXlsformFixToProject(contactDescriptor(), CONFIG);
    expect(outcome.ok).to.equal(false);
    if (!outcome.ok) {
      expect(outcome.error).to.match(/workbook not found at forms\/app\/person-create\.xlsx/);
    }
  });
});
