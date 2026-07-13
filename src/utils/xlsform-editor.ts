/**
 * Deterministic, orchestrator-side surgical editor for XLSForm workbooks
 * (mission 05). The code-gen CLI never touches the binary `.xlsx`; instead it
 * emits a structured fix descriptor (`.cht-agent/xlsform-fix.json`) and this
 * first-party utility applies the described cell edits to a COPY of the
 * workbook (the caller guarantees `xlsxPath` is a sandbox copy, never the
 * mount).
 *
 * The fidelity contract (proven by the P1 spec against the planted demo
 * fixture): editing one cell changes ONLY that cell on reopen, and the offline
 * `cht convert-app-forms` of the edited workbook produces XML whose only bind
 * delta is the target — sibling binds stay byte-invariant. exceljs manages the
 * shared-strings table on write, so repointing the target cell never mutates a
 * string other cells alias (the demo fixture shares one string across
 * `survey!K153/K173/K205`; the spec verifies K173/K205 survive).
 *
 * Row location mirrors XLSForm semantics: a header row (row 1) maps column
 * names to indices; the `type` column is walked to compute each row's group
 * path from the `begin group`/`begin repeat` ... `end group`/`end repeat`
 * stack, so a `match` can disambiguate same-named questions in different
 * groups. `end group`/`end repeat` marker rows are never edit targets.
 */

import ExcelJS from 'exceljs';

/** How a descriptor locates the row to edit within a sheet. */
export interface XlsformEditMatch {
  /** Header name of the column to match on (typically `name`). */
  column: string;
  /** Exact cell value the match column must equal. */
  value: string;
  /**
   * Optional ancestor group-name path (outermost first), used to disambiguate
   * when the same `value` appears in more than one group. Compared exactly
   * against the row's computed group path (which excludes the row itself).
   */
  groupPath?: string[];
}

/** The cell mutation a descriptor edit performs. */
export interface XlsformCellSet {
  /** Header name of the column to write (e.g. `relevant`). */
  column: string;
  /** New cell value (XLSForm expression syntax). Written verbatim. */
  value: string;
}

/** A single surgical edit: locate one row on a sheet, set one cell. */
export interface XlsformEdit {
  /** Worksheet name (e.g. `survey`). */
  sheet: string;
  match: XlsformEditMatch;
  set: XlsformCellSet;
}

/** Record of an edit that was applied — for logging and the HC2/report payload. */
export interface AppliedEdit {
  sheet: string;
  rowNumber: number;
  /** A1-style address of the mutated cell (e.g. `K153`). */
  cellAddress: string;
  matchColumn: string;
  matchValue: string;
  /** The row's computed ancestor group path (excludes the row itself). */
  groupPath: string[];
  setColumn: string;
  previousValue: string;
  newValue: string;
}

export type XlsformEditErrorCode =
  | 'sheet-not-found'
  | 'no-header-row'
  | 'match-column-not-found'
  | 'set-column-not-found'
  | 'no-match'
  | 'ambiguous-match';

/** Typed failure so the orchestrator can key refinement feedback precisely. */
export class XlsformEditError extends Error {
  readonly code: XlsformEditErrorCode;
  constructor(code: XlsformEditErrorCode, message: string) {
    super(message);
    this.name = 'XlsformEditError';
    this.code = code;
  }
}

/** Normalize any exceljs cell value to the plain text a survey sheet holds. */
export const cellText = (value: ExcelJS.CellValue): string => {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'object') {
    const rich = value as Partial<ExcelJS.CellRichTextValue>;
    if (Array.isArray(rich.richText)) {
      return rich.richText.map((run) => run.text).join('');
    }
    const formula = value as Partial<ExcelJS.CellFormulaValue>;
    if (typeof formula.formula === 'string') {
      return formula.result !== undefined && formula.result !== null
        ? String(formula.result)
        : formula.formula;
    }
    const hyperlink = value as Partial<ExcelJS.CellHyperlinkValue>;
    if (typeof hyperlink.text === 'string') {
      return hyperlink.text;
    }
    const errorCell = value as Partial<ExcelJS.CellErrorValue>;
    if (errorCell.error !== undefined) {
      return String(errorCell.error);
    }
  }
  return String(value);
};

// XLSForm structural markers. pyxform accepts both spaced and underscored
// spellings; whitespace/underscore runs are normalized before comparison.
const BEGIN_MARKER = /^begin (group|repeat)$/;
const END_MARKER = /^end (group|repeat)$/;
const normalizeType = (type: string): string => type.trim().toLowerCase().replace(/[\s_]+/g, ' ');

/** Build a header-name → 1-based column index map from row 1 (first wins). */
const buildHeaderMap = (sheet: ExcelJS.Worksheet): Map<string, number> => {
  const headerRow = sheet.getRow(1);
  const map = new Map<string, number>();
  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const name = cellText(cell.value).trim();
    if (name && !map.has(name)) {
      map.set(name, colNumber);
    }
  });
  return map;
};

interface RowCandidate {
  rowNumber: number;
  groupPath: string[];
}

/**
 * Walk the sheet top-to-bottom maintaining the group stack, and collect every
 * NON-marker row whose match column equals `match.value` (and, when a
 * `groupPath` is given, whose ancestor path matches exactly).
 */
const findCandidates = (
  sheet: ExcelJS.Worksheet,
  matchCol: number,
  nameCol: number | undefined,
  typeCol: number | undefined,
  match: XlsformEditMatch
): RowCandidate[] => {
  const candidates: RowCandidate[] = [];
  const stack: string[] = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) {
      return; // header row
    }
    const type = typeCol ? normalizeType(cellText(row.getCell(typeCol).value)) : '';
    const ancestorPath = [...stack]; // path BEFORE this row mutates the stack

    if (END_MARKER.test(type)) {
      stack.pop();
      return; // markers are never editable targets
    }

    const matchValue = cellText(row.getCell(matchCol).value).trim();
    if (matchValue === match.value && groupPathMatches(match.groupPath, ancestorPath)) {
      candidates.push({ rowNumber, groupPath: ancestorPath });
    }

    if (BEGIN_MARKER.test(type)) {
      const groupName = nameCol ? cellText(row.getCell(nameCol).value).trim() : '';
      stack.push(groupName);
    }
  });
  return candidates;
};

const groupPathMatches = (expected: string[] | undefined, actual: string[]): boolean => {
  if (!expected) {
    return true;
  }
  return expected.length === actual.length && expected.every((seg, i) => seg === actual[i]);
};

/**
 * Apply the described cell edits to the workbook at `xlsxPath`, mutating it in
 * place. Loads once, applies all edits, saves once. Throws {@link
 * XlsformEditError} (leaving the file untouched) if any edit's sheet/columns
 * are missing or its match is zero or ambiguous.
 */
export const applyXlsformEdits = async (
  xlsxPath: string,
  edits: XlsformEdit[]
): Promise<AppliedEdit[]> => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(xlsxPath);

  const applied: AppliedEdit[] = [];
  for (const edit of edits) {
    const sheet = workbook.getWorksheet(edit.sheet);
    if (!sheet) {
      throw new XlsformEditError(
        'sheet-not-found',
        `Sheet "${edit.sheet}" not found (sheets: ${workbook.worksheets.map((w) => w.name).join(', ')})`
      );
    }
    const headers = buildHeaderMap(sheet);
    if (headers.size === 0) {
      throw new XlsformEditError('no-header-row', `Sheet "${edit.sheet}" has no header row`);
    }
    const matchCol = headers.get(edit.match.column);
    if (!matchCol) {
      throw new XlsformEditError(
        'match-column-not-found',
        `Match column "${edit.match.column}" not found on sheet "${edit.sheet}"`
      );
    }
    const setCol = headers.get(edit.set.column);
    if (!setCol) {
      throw new XlsformEditError(
        'set-column-not-found',
        `Set column "${edit.set.column}" not found on sheet "${edit.sheet}"`
      );
    }
    const nameCol = headers.get('name');
    const typeCol = headers.get('type');

    const candidates = findCandidates(sheet, matchCol, nameCol, typeCol, edit.match);
    if (candidates.length === 0) {
      throw new XlsformEditError(
        'no-match',
        `No row on "${edit.sheet}" where ${edit.match.column}="${edit.match.value}"` +
          (edit.match.groupPath ? ` under group path [${edit.match.groupPath.join(' > ')}]` : '')
      );
    }
    if (candidates.length > 1) {
      const paths = candidates
        .map((c) => `row ${c.rowNumber} (group path [${c.groupPath.join(' > ')}])`)
        .join('; ');
      throw new XlsformEditError(
        'ambiguous-match',
        `${candidates.length} rows on "${edit.sheet}" match ${edit.match.column}=` +
          `"${edit.match.value}": ${paths}. Add a groupPath to disambiguate.`
      );
    }

    const { rowNumber, groupPath } = candidates[0];
    const cell = sheet.getRow(rowNumber).getCell(setCol);
    const previousValue = cellText(cell.value);
    cell.value = edit.set.value;
    applied.push({
      sheet: edit.sheet,
      rowNumber,
      cellAddress: cell.address,
      matchColumn: edit.match.column,
      matchValue: edit.match.value,
      groupPath,
      setColumn: edit.set.column,
      previousValue,
      newValue: edit.set.value,
    });
  }

  await workbook.xlsx.writeFile(xlsxPath);
  return applied;
};
