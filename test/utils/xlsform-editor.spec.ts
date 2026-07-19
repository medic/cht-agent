import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import ExcelJS from 'exceljs';

import {
  applyXlsformEdits,
  cellText,
  XlsformEdit,
  XlsformEditError,
} from '../../src/utils/xlsform-editor';
import {
  extractBindAttr,
  extractBindRelevant,
  extractTopLevelGroupBinds,
  verifyFormBinds,
} from '../../src/utils/xform-inspect';
import { canOfflineConvert, offlineConvertForm, stageProject } from '../helpers/offline-convert';

const REPO_FIXTURE = path.resolve('demo/config-pnc-demo');
const FORM = 'pregnancy_home_visit';
const FIXTURE_XLSX = path.join(REPO_FIXTURE, 'forms', 'app', `${FORM}.xlsx`);
const FORM_XML_REL = path.join('forms', 'app', `${FORM}.xml`);
const DANGER_NODESET = '/data/danger_signs';

const YES_GATE = "selected(../pregnancy_summary/visit_option, 'yes')";
const PLANTED_GATE =
  "selected(../pregnancy_summary/visit_option, 'yes') or selected(../pregnancy_summary/visit_option, 'miscarriage')";

const DANGER_EDIT: XlsformEdit = {
  sheet: 'survey',
  match: { column: 'name', value: 'danger_signs' },
  set: { column: 'relevant', value: YES_GATE },
};

// --- tmp helpers ------------------------------------------------------------

const tmpDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'cht-agent-xlsx-'));

/** Write a synthetic survey sheet (rows[0] is the header) and return its path. */
const writeSurvey = async (rows: string[][]): Promise<string> => {
  const file = path.join(tmpDir(), 'form.xlsx');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('survey');
  rows.forEach((r) => ws.addRow(r));
  await wb.xlsx.writeFile(file);
  return file;
};

/** Snapshot every non-empty survey cell as A1-address → normalized text. */
const snapshotSurvey = async (xlsxPath: string): Promise<Record<string, string>> => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(xlsxPath);
  const ws = wb.getWorksheet('survey');
  if (!ws) {
    throw new Error('no survey sheet');
  }
  const snap: Record<string, string> = {};
  ws.eachRow({ includeEmpty: false }, (row) => {
    row.eachCell({ includeEmpty: false }, (cell) => {
      snap[cell.address] = cellText(cell.value);
    });
  });
  return snap;
};

const readCell = async (xlsxPath: string, sheet: string, row: number, col: number): Promise<string> => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(xlsxPath);
  return cellText(wb.getWorksheet(sheet)!.getRow(row).getCell(col).value);
};

const differingLineIndexes = (a: string, b: string): number[] => {
  const la = a.split('\n');
  const lb = b.split('\n');
  const n = Math.max(la.length, lb.length);
  const diffs: number[] = [];
  for (let i = 0; i < n; i++) {
    if (la[i] !== lb[i]) {
      diffs.push(i);
    }
  }
  return diffs;
};

// --- matcher semantics (pure exceljs, always runs) --------------------------

describe('applyXlsformEdits — matcher semantics', () => {
  const DUP_ROWS = [
    ['type', 'name', 'relevant'],
    ['begin group', 'grpA', ''],
    ['text', 'dup', 'OLD_A'],
    ['end group', 'grpA', ''],
    ['begin group', 'grpB', ''],
    ['text', 'dup', 'OLD_B'],
    ['end group', 'grpB', ''],
  ];

  it('errors ambiguous-match when a name repeats and no groupPath is given', async () => {
    const file = await writeSurvey(DUP_ROWS);
    try {
      await applyXlsformEdits(file, [
        { sheet: 'survey', match: { column: 'name', value: 'dup' }, set: { column: 'relevant', value: 'X' } },
      ]);
      expect.fail('expected an ambiguous-match error');
    } catch (err) {
      expect(err).to.be.instanceOf(XlsformEditError);
      expect((err as XlsformEditError).code).to.equal('ambiguous-match');
    }
  });

  it('disambiguates a repeated name via groupPath', async () => {
    const file = await writeSurvey(DUP_ROWS);
    const applied = await applyXlsformEdits(file, [
      {
        sheet: 'survey',
        match: { column: 'name', value: 'dup', groupPath: ['grpB'] },
        set: { column: 'relevant', value: 'NEW_B' },
      },
    ]);
    expect(applied).to.have.length(1);
    expect(applied[0].rowNumber).to.equal(6);
    expect(applied[0].previousValue).to.equal('OLD_B');
    expect(applied[0].newValue).to.equal('NEW_B');
    expect(applied[0].groupPath).to.deep.equal(['grpB']);
    // grpA's dup untouched (row 3, relevant col = 3)
    expect(await readCell(file, 'survey', 3, 3)).to.equal('OLD_A');
    expect(await readCell(file, 'survey', 6, 3)).to.equal('NEW_B');
  });

  it('excludes end-group marker rows (matching a group name hits only the begin row)', async () => {
    const file = await writeSurvey(DUP_ROWS);
    const applied = await applyXlsformEdits(file, [
      { sheet: 'survey', match: { column: 'name', value: 'grpA' }, set: { column: 'relevant', value: 'G' } },
    ]);
    expect(applied).to.have.length(1);
    expect(applied[0].rowNumber).to.equal(2); // begin group row, not the end-group row 4
    expect(applied[0].groupPath).to.deep.equal([]);
  });

  it('computes nested ancestor group paths', async () => {
    const file = await writeSurvey([
      ['type', 'name', 'relevant'],
      ['begin group', 'outer', ''],
      ['begin group', 'inner', ''],
      ['text', 'q', 'OLD'],
      ['end group', 'inner', ''],
      ['end group', 'outer', ''],
    ]);
    const applied = await applyXlsformEdits(file, [
      {
        sheet: 'survey',
        match: { column: 'name', value: 'q', groupPath: ['outer', 'inner'] },
        set: { column: 'relevant', value: 'NEW' },
      },
    ]);
    expect(applied[0].groupPath).to.deep.equal(['outer', 'inner']);
    expect(applied[0].rowNumber).to.equal(4);
  });

  it('a wrong groupPath yields no-match', async () => {
    const file = await writeSurvey([
      ['type', 'name', 'relevant'],
      ['begin group', 'outer', ''],
      ['text', 'q', 'OLD'],
      ['end group', 'outer', ''],
    ]);
    try {
      await applyXlsformEdits(file, [
        { sheet: 'survey', match: { column: 'name', value: 'q', groupPath: ['nope'] }, set: { column: 'relevant', value: 'X' } },
      ]);
      expect.fail('expected no-match');
    } catch (err) {
      expect((err as XlsformEditError).code).to.equal('no-match');
    }
  });

  it('normalizes underscored begin_group/end_group spellings', async () => {
    const file = await writeSurvey([
      ['type', 'name', 'relevant'],
      ['begin_group', 'g', ''],
      ['text', 'x', 'OLD'],
      ['end_group', 'g', ''],
    ]);
    const applied = await applyXlsformEdits(file, [
      { sheet: 'survey', match: { column: 'name', value: 'x', groupPath: ['g'] }, set: { column: 'relevant', value: 'Y' } },
    ]);
    expect(applied[0].groupPath).to.deep.equal(['g']);
  });

  // --- P2: clear semantics + the calculate-type guardrail --------------------

  it('clear:true removes the cell (value = null) — the attribute-dropping primitive', async () => {
    const file = await writeSurvey([
      ['type', 'name', 'relevant', 'calculation'],
      ['select_one x', 'edu', "../hh = 'at_school'", 'member_filter = 2'],
    ]);
    const applied = await applyXlsformEdits(file, [
      { sheet: 'survey', match: { column: 'name', value: 'edu' }, set: { column: 'calculation', clear: true } },
    ]);
    expect(applied).to.have.length(1);
    expect(applied[0].setColumn).to.equal('calculation');
    expect(applied[0].previousValue).to.equal('member_filter = 2');
    expect(applied[0].newValue).to.equal(''); // reported empty
    // The cell is a TRUE removal — reopened it reads back empty (null).
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(file);
    const cell = wb.getWorksheet('survey')!.getRow(2).getCell(4);
    expect(cellText(cell.value)).to.equal('');
    // relevant (untouched) survives.
    expect(await readCell(file, 'survey', 2, 3)).to.equal("../hh = 'at_school'");
  });

  it('GUARDRAIL: clearing the calculation column on a calculate-type row fails BEFORE writing', async () => {
    const file = await writeSurvey([
      ['type', 'name', 'calculation'],
      ['calculate', 'computed', 'today()'],
    ]);
    const before = await snapshotSurvey(file);
    try {
      await applyXlsformEdits(file, [
        { sheet: 'survey', match: { column: 'name', value: 'computed' }, set: { column: 'calculation', clear: true } },
      ]);
      expect.fail('expected a calculate-required guardrail error');
    } catch (err) {
      expect(err).to.be.instanceOf(XlsformEditError);
      expect((err as XlsformEditError).code).to.equal('calculate-required');
      expect((err as XlsformEditError).message).to.match(/type is "calculate"/);
      expect((err as XlsformEditError).message).to.match(/computed/); // names the row's match value
    }
    // fail-fast: the workbook was never written.
    expect(await snapshotSurvey(file)).to.deep.equal(before);
  });

  it('GUARDRAIL also fires for an EMPTY-STRING value on a calculate-type calculation cell', async () => {
    const file = await writeSurvey([
      ['type', 'name', 'calculation'],
      ['calculate', 'computed', 'today()'],
    ]);
    try {
      await applyXlsformEdits(file, [
        { sheet: 'survey', match: { column: 'name', value: 'computed' }, set: { column: 'calculation', value: '' } },
      ]);
      expect.fail('expected a calculate-required guardrail error for value: ""');
    } catch (err) {
      expect((err as XlsformEditError).code).to.equal('calculate-required');
    }
  });

  it('GUARDRAIL does NOT fire when clearing a NON-calculation column on a calculate row', async () => {
    // Clearing `relevant` (not `calculation`) on a calculate row is fine.
    const file = await writeSurvey([
      ['type', 'name', 'relevant', 'calculation'],
      ['calculate', 'computed', "x = 'y'", 'today()'],
    ]);
    const applied = await applyXlsformEdits(file, [
      { sheet: 'survey', match: { column: 'name', value: 'computed' }, set: { column: 'relevant', clear: true } },
    ]);
    expect(applied).to.have.length(1);
    expect(await readCell(file, 'survey', 2, 3)).to.equal(''); // relevant cleared
    expect(await readCell(file, 'survey', 2, 4)).to.equal('today()'); // calculation intact
  });

  it('GUARDRAIL does NOT fire when clearing calculation on a NON-calculate row (a select_one)', async () => {
    // The M8 shape: a select_one carrying a spurious calculate — clearing it is allowed.
    const file = await writeSurvey([
      ['type', 'name', 'calculation'],
      ['select_one edu', 'edu', 'member_filter = 2'],
    ]);
    const applied = await applyXlsformEdits(file, [
      { sheet: 'survey', match: { column: 'name', value: 'edu' }, set: { column: 'calculation', clear: true } },
    ]);
    expect(applied).to.have.length(1);
    expect(await readCell(file, 'survey', 2, 3)).to.equal('');
  });

  it('rejects a set with BOTH value and clear, and one with NEITHER (invalid-set)', async () => {
    const file = await writeSurvey([
      ['type', 'name', 'relevant'],
      ['text', 'x', 'OLD'],
    ]);
    const both = { sheet: 'survey', match: { column: 'name', value: 'x' }, set: { column: 'relevant', value: 'A', clear: true } } as unknown as XlsformEdit;
    const neither = { sheet: 'survey', match: { column: 'name', value: 'x' }, set: { column: 'relevant' } } as unknown as XlsformEdit;
    for (const edit of [both, neither]) {
      try {
        await applyXlsformEdits(file, [edit]);
        expect.fail('expected invalid-set');
      } catch (err) {
        expect((err as XlsformEditError).code).to.equal('invalid-set');
      }
    }
  });

  it('errors on a missing sheet, match column, and set column', async () => {
    const file = await writeSurvey([
      ['type', 'name', 'relevant'],
      ['text', 'x', 'OLD'],
    ]);
    const bad = async (edit: XlsformEdit): Promise<string> => {
      try {
        await applyXlsformEdits(file, [edit]);
        return 'no-error';
      } catch (err) {
        return (err as XlsformEditError).code;
      }
    };
    expect(await bad({ sheet: 'nope', match: { column: 'name', value: 'x' }, set: { column: 'relevant', value: 'A' } })).to.equal('sheet-not-found');
    expect(await bad({ sheet: 'survey', match: { column: 'nope', value: 'x' }, set: { column: 'relevant', value: 'A' } })).to.equal('match-column-not-found');
    expect(await bad({ sheet: 'survey', match: { column: 'name', value: 'x' }, set: { column: 'nope', value: 'A' } })).to.equal('set-column-not-found');
  });

  it('leaves the file untouched when an edit throws', async () => {
    const file = await writeSurvey([
      ['type', 'name', 'relevant'],
      ['text', 'x', 'OLD'],
    ]);
    const before = await snapshotSurvey(file);
    try {
      await applyXlsformEdits(file, [
        { sheet: 'survey', match: { column: 'name', value: 'missing' }, set: { column: 'relevant', value: 'A' } },
      ]);
    } catch {
      /* expected */
    }
    expect(await snapshotSurvey(file)).to.deep.equal(before);
  });
});

// --- P1 fidelity gate (a): reopen the real planted fixture ------------------

describe('P1 fidelity — reopen (planted pregnancy_home_visit.xlsx)', () => {
  it('changes ONLY the target cell; shared-string siblings K173/K205 survive', async () => {
    const dir = tmpDir();
    const editedXlsx = path.join(dir, `${FORM}.xlsx`);
    fs.copyFileSync(FIXTURE_XLSX, editedXlsx);

    const before = await snapshotSurvey(FIXTURE_XLSX);
    const applied = await applyXlsformEdits(editedXlsx, [DANGER_EDIT]);
    const after = await snapshotSurvey(editedXlsx);

    expect(applied).to.have.length(1);
    expect(applied[0].cellAddress).to.equal('K153');
    expect(applied[0].rowNumber).to.equal(153);
    expect(applied[0].previousValue).to.equal(PLANTED_GATE);
    expect(applied[0].newValue).to.equal(YES_GATE);

    const changed = Object.keys(before).filter((k) => before[k] !== after[k]);
    const dropped = Object.keys(before).filter((k) => !(k in after));
    const added = Object.keys(after).filter((k) => !(k in before));
    expect(changed, 'exactly the target cell changed').to.deep.equal(['K153']);
    expect(dropped, 'no cells dropped').to.deep.equal([]);
    expect(added, 'no cells added').to.deep.equal([]);
    // the two group cells that aliased the same shared string keep the yes-only gate
    expect(after.K173).to.equal(YES_GATE);
    expect(after.K205).to.equal(YES_GATE);
  });
});

// --- P1 fidelity gate (b): convert oracle (self-skips without cht) ----------

const withConvert = canOfflineConvert() ? describe : describe.skip;

withConvert('P1 fidelity — convert oracle (planted pregnancy_home_visit.xlsx)', function () {
  this.timeout(180000);
  let baselineXml: string;
  let regenXml: string;
  let baselineDir: string;
  let editedDir: string;

  before(async function () {
    this.timeout(180000);
    // Baseline: convert the UNEDITED project with the SAME cht binary, so any
    // version-specific cosmetic churn cancels and the ONLY diff is the edit (R11).
    baselineDir = stageProject(REPO_FIXTURE);
    const baseRun = offlineConvertForm(baselineDir, FORM);
    if (baseRun.status !== 0) {
      throw new Error(`baseline convert failed (${baseRun.status}): ${baseRun.stderr}`);
    }
    baselineXml = fs.readFileSync(path.join(baselineDir, FORM_XML_REL), 'utf-8');

    // Edited: apply the descriptor edit to a copy, then convert.
    editedDir = stageProject(REPO_FIXTURE);
    await applyXlsformEdits(path.join(editedDir, 'forms', 'app', `${FORM}.xlsx`), [DANGER_EDIT]);
    const editRun = offlineConvertForm(editedDir, FORM);
    if (editRun.status !== 0) {
      throw new Error(`edited convert failed (${editRun.status}): ${editRun.stderr}`);
    }
    regenXml = fs.readFileSync(path.join(editedDir, FORM_XML_REL), 'utf-8');
  });

  after(() => {
    for (const dir of [baselineDir, editedDir]) {
      if (dir) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it('baseline convert reproduces the planted (buggy) danger_signs gate — red', () => {
    expect(extractBindRelevant(baselineXml, DANGER_NODESET)).to.equal(PLANTED_GATE);
  });

  it('edited convert emits the corrected yes-only gate — green', () => {
    expect(extractBindRelevant(regenXml, DANGER_NODESET)).to.equal(YES_GATE);
  });

  it('every sibling top-level group bind is unchanged vs the pre-edit conversion', () => {
    const siblingsBefore = extractTopLevelGroupBinds(baselineXml).filter((b) => b.nodeset !== DANGER_NODESET);
    const siblingsAfter = extractTopLevelGroupBinds(regenXml).filter((b) => b.nodeset !== DANGER_NODESET);
    expect(siblingsAfter).to.deep.equal(siblingsBefore);
    expect(siblingsBefore.length).to.be.greaterThan(0);
  });

  it('exactly one XML line differs and it is the danger_signs bind (byte-level sibling invariance)', () => {
    const diffs = differingLineIndexes(baselineXml, regenXml);
    expect(diffs, 'only one line differs between the two conversions').to.have.length(1);
    const line = regenXml.split('\n')[diffs[0]];
    expect(line).to.contain(`nodeset="${DANGER_NODESET}"`);
    expect(line).to.contain(YES_GATE);
    expect(line).to.not.contain('miscarriage');
  });
});

// --- P2 M8-shaped end-to-end: remove a spurious `calculate` via clear ---------
//
// The M8 bug: a required, user-answerable select ALSO carries a `calculate` that
// overwrites the user's selection. The fix removes ONLY the calculate, keeping
// `relevant` + `required`. There is no select_one-with-calculate in the CI
// fixture, so this plants one (via the editor — the same primitive the applier
// uses) on a real select_one row (g_age_correct: required + relevant), converts
// to reproduce the buggy compiled bind (RED via the P2 attrs oracle), then
// applies `set.clear:true` on `calculation` and re-converts to prove the
// calculate is GONE while relevant/required are byte-unchanged (GREEN). This is
// the editor+real-convert+inspector path the M8 descriptor drives end to end.
const EDU_NODESET = '/data/pregnancy_summary/g_age_correct';
const EDU_ROW_NAME = 'g_age_correct';
const EDU_RELEVANT = "selected(../visit_option, 'yes')";
const SPURIOUS_CALC = 'concat("x", "y")';

withConvert('P2 M8 e2e — remove a spurious calculate (clear) via convert', function () {
  this.timeout(240000);
  let buggyXml: string;
  let fixedXml: string;
  let buggyDir: string;
  let fixedDir: string;

  before(async function () {
    this.timeout(240000);
    // 1. Plant the M8 bug: write a spurious calculate onto a select_one row.
    buggyDir = stageProject(REPO_FIXTURE);
    const buggyXlsx = path.join(buggyDir, 'forms', 'app', `${FORM}.xlsx`);
    await applyXlsformEdits(buggyXlsx, [
      { sheet: 'survey', match: { column: 'name', value: EDU_ROW_NAME }, set: { column: 'calculation', value: SPURIOUS_CALC } },
    ]);
    const buggyRun = offlineConvertForm(buggyDir, FORM);
    if (buggyRun.status !== 0) {
      throw new Error(`buggy convert failed (${buggyRun.status}): ${buggyRun.stderr}`);
    }
    buggyXml = fs.readFileSync(path.join(buggyDir, FORM_XML_REL), 'utf-8');

    // 2. Apply the M8 fix on top of the buggy workbook: clear the calculate.
    fixedDir = stageProject(buggyDir); // copy the BUGGY project (calculate present)
    const fixedXlsx = path.join(fixedDir, 'forms', 'app', `${FORM}.xlsx`);
    await applyXlsformEdits(fixedXlsx, [
      { sheet: 'survey', match: { column: 'name', value: EDU_ROW_NAME }, set: { column: 'calculation', clear: true } },
    ]);
    const fixedRun = offlineConvertForm(fixedDir, FORM);
    if (fixedRun.status !== 0) {
      throw new Error(`fixed convert failed (${fixedRun.status}): ${fixedRun.stderr}`);
    }
    fixedXml = fs.readFileSync(path.join(fixedDir, FORM_XML_REL), 'utf-8');
  });

  after(() => {
    for (const dir of [buggyDir, fixedDir]) {
      if (dir) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it('planting the calculate produces the buggy compiled bind (calculate present)', () => {
    expect(extractBindAttr(buggyXml, EDU_NODESET, 'calculate')).to.equal(SPURIOUS_CALC);
    // relevant + required are on the bind too (the M8 shape).
    expect(extractBindAttr(buggyXml, EDU_NODESET, 'relevant')).to.equal(EDU_RELEVANT);
    expect(extractBindAttr(buggyXml, EDU_NODESET, 'required')).to.equal('true()');
  });

  it('the M8 attrs oracle reads RED against the buggy bind (calculate must be absent)', () => {
    const red = verifyFormBinds(buggyXml, [
      { nodeset: EDU_NODESET, attrs: { calculate: null, relevant: EDU_RELEVANT, required: 'true()' } },
    ]);
    expect(red.passed).to.equal(false);
    const calc = red.checks.find((c) => c.attr === 'calculate');
    expect(calc?.passed).to.equal(false);
    expect(calc?.actual).to.equal(SPURIOUS_CALC);
    expect(calc?.note).to.match(/should be absent/);
    // relevant + required already correct — the failure is isolated to calculate.
    expect(red.checks.filter((c) => c.attr !== 'calculate').every((c) => c.passed)).to.equal(true);
  });

  it('clearing the calculate drops the attribute from the compiled bind', () => {
    expect(extractBindAttr(fixedXml, EDU_NODESET, 'calculate')).to.equal(undefined);
    // No empty-attribute residue — the cleared cell leaves calculate="" nowhere.
    const bindTag = /<bind\b[^>]*nodeset="\/data\/pregnancy_summary\/g_age_correct"[^>]*>/.exec(fixedXml);
    expect(bindTag).to.not.equal(null);
    expect(bindTag![0]).to.not.contain('calculate=');
  });

  it('the M8 attrs oracle reads GREEN once the calculate is removed (relevant/required intact)', () => {
    const green = verifyFormBinds(fixedXml, [
      { nodeset: EDU_NODESET, attrs: { calculate: null, relevant: EDU_RELEVANT, required: 'true()' } },
    ]);
    expect(green.passed).to.equal(true);
    expect(green.checks.every((c) => c.passed)).to.equal(true);
  });
});
