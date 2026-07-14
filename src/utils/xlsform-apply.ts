/**
 * The deterministic apply→convert→assert core for a cht-conf form fix (mission
 * 05), factored out of the supervisor node so it is unit-testable against the
 * real fixture without langgraph state.
 *
 * Sequence (all against a temp SANDBOX copy — never the mount):
 *   1. sandbox = copy of the config project (sans node_modules/.git/.cht-agent)
 *   2. baseline offline convert of the UNEDITED workbook (same cht version) —
 *      the honest sibling-invariance reference (R11: churn cancels)
 *   3. apply the descriptor's cell edit(s) to the sandbox workbook (exceljs)
 *   4. offline convert again (convert-only, never upload — R6)
 *   5. assert the target bind equals expect.relevant and every sibling
 *      top-level group bind is unchanged vs the baseline conversion
 *
 * On any failure the sandbox is removed and a typed error string is returned so
 * the supervisor can key refinement feedback to the descriptor. On success the
 * sandbox is KEPT (its .xlsx/.xml are the artifacts staging byte-copies).
 */

import * as fs from 'node:fs';
import { XlsformApplyResult, XlsformBindDiff, FormBindExpectation } from '../types';
import { AppliedEdit, applyXlsformEdits, XlsformEditError } from './xlsform-editor';
import { XlsformFixDescriptor } from './xlsform-fix';
import { createConvertSandbox, runOfflineConvert } from './cht-conf-runner';
import { extractBindRelevant, extractTopLevelGroupBinds } from './xform-inspect';

export type XlsformApplyOutcome =
  | { ok: true; result: XlsformApplyResult; appliedEdits: AppliedEdit[] }
  | { ok: false; error: string };

export interface XlsformApplyOptions {
  bin?: string;
  timeoutMs?: number;
}

const tail = (text: string, n = 400): string => (text.length > n ? `…${text.slice(-n)}` : text);

/**
 * Collapse internal whitespace runs to a single space and trim the ends.
 *
 * The converter (pyxform via cht-conf) trims and normalizes whitespace when it
 * emits an attribute: a leading space written to a workbook cell is absent from
 * the emitted XPath. XPath is whitespace-insensitive OUTSIDE string literals, so
 * this is safe for the expressions we compare. The one accepted edge is a
 * literal internal double-space inside a quoted string (e.g. `'a  b'`), which
 * this would collapse — vanishingly rare in `relevant`/`calculate` gates and
 * out of scope for the sibling-invariance oracle. Documented here so a future
 * reader knows the comparison is deliberately whitespace-normalized, not exact.
 */
const normalizeWhitespace = (value: string): string => value.replace(/\s+/g, ' ').trim();

// Splits a tag body into element-name + the attribute region + self-close mark.
// Group 1: `/` if self-closing, group 2: leading whitespace before `>`. The `$`
// (no `m` flag) matches end-of-string, so a tag reassembled from several
// physical lines (a literal newline inside a quoted attribute value) still
// matches — `[^<>]` includes `\n`.
const OPEN_TAG_RE = /^(\s*)<([A-Za-z_][\w:.-]*)((?:\s+[^<>]*?)?)(\s*\/?)>\s*$/;
// Matches one `name="value"` (or single-quoted) attribute inside a tag body.
const ATTR_RE = /([A-Za-z_][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;

/**
 * True when `buffer` ends in the middle of an XML tag — an unquoted `<` with no
 * matching unquoted `>` after it, or an unterminated quoted attribute value.
 * pyxform entity-escapes `<`/`>` inside attribute values (`&lt;`/`&gt;`), so
 * scanning raw angle brackets outside quotes is safe; quotes are still tracked
 * defensively. Used to reassemble a tag that pyxform wrapped across physical
 * lines (a long `constraint`/`calculate` value carrying a literal newline).
 */
const isInsideOpenTag = (buffer: string): boolean => {
  let inQuote: string | null = null;
  let openIdx = -1;
  for (let i = 0; i < buffer.length; i++) {
    const ch = buffer[i];
    if (inQuote) {
      if (ch === inQuote) {
        inQuote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      inQuote = ch;
    } else if (ch === '<') {
      openIdx = i;
    } else if (ch === '>') {
      openIdx = -1;
    }
  }
  return openIdx !== -1 || inQuote !== null;
};

/**
 * Group physical lines back into logical TAG units before canonicalization.
 * pyxform wraps a long attribute value (e.g. a `constraint` with an embedded
 * newline) across physical lines, so a single `<bind>` tag spans two-plus lines.
 * Diffing per physical line then reads cross-line attribute-ORDER churn (the
 * exceljs re-save migrating `required="true()"` from a tag's first physical line
 * to its last) as false-positive collateral, because canonicalizeTagLine only
 * sees a fragment. Reassembling here means each whole tag is canonicalized as a
 * unit. A single-line tag is its own logical line, so this is a no-op for the
 * common case (byte-identical to `xml.split('\n')`).
 */
const toLogicalLines = (xml: string): string[] => {
  const logical: string[] = [];
  let buffer: string | null = null;
  for (const line of xml.split('\n')) {
    if (buffer === null) {
      if (isInsideOpenTag(line)) {
        buffer = line;
      } else {
        logical.push(line);
      }
    } else {
      buffer += `\n${line}`;
      if (!isInsideOpenTag(buffer)) {
        logical.push(buffer);
        buffer = null;
      }
    }
  }
  // Unterminated tail (malformed XML) — emit what we have rather than drop it.
  if (buffer !== null) {
    logical.push(buffer);
  }
  return logical;
};

/**
 * Canonicalize a single line so that pure attribute-ORDER churn does not read as
 * a change. If the line is exactly one XML tag, parse its attributes, sort them
 * by name, and re-serialize with values byte-exact (quote style preserved). Any
 * line that is not a clean single tag (text, comments, multi-tag lines) is
 * returned trimmed but otherwise untouched. Values are kept byte-exact on
 * purpose: only ordering is neutralized here, so a real value change still
 * surfaces as collateral.
 */
const canonicalizeTagLine = (line: string): string => {
  const m = OPEN_TAG_RE.exec(line);
  if (!m) {
    return line.trim();
  }
  const [, , name, attrRegion, selfClose] = m;
  const attrs: Array<{ name: string; text: string }> = [];
  ATTR_RE.lastIndex = 0;
  let attrMatch: RegExpExecArray | null;
  while ((attrMatch = ATTR_RE.exec(attrRegion)) !== null) {
    // `text` keeps the quote style + value byte-exact; only position is sorted.
    attrs.push({ name: attrMatch[1], text: attrMatch[0] });
  }
  // Bail out (return trimmed original) if the attribute region held anything
  // other than clean name="value" pairs, so we never silently drop content.
  const attrOnlyRegion = attrRegion.replace(/\s+/g, '');
  const parsedRegion = attrs.map((a) => a.text).join('').replace(/\s+/g, '');
  if (attrOnlyRegion !== parsedRegion) {
    return line.trim();
  }
  attrs.sort((a, b) => a.name.localeCompare(b.name));
  const attrPart = attrs.length ? ` ${attrs.map((a) => a.text).join(' ')}` : '';
  const close = selfClose.includes('/') ? '/' : '';
  return `<${name}${attrPart}${close}>`;
};

const cleanup = (dir: string | undefined): void => {
  if (dir) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
};

/**
 * Compare two sibling bind sets by nodeset; describe every change. Values are
 * compared after whitespace normalization (see `normalizeWhitespace`) so pure
 * converter whitespace churn in a sibling's `relevant` is not mistaken for a
 * semantic change.
 */
const describeSiblingChanges = (
  before: FormBindExpectation[],
  after: FormBindExpectation[]
): string[] => {
  const beforeMap = new Map(before.map((b) => [b.nodeset, normalizeWhitespace(b.relevant)]));
  const afterMap = new Map(after.map((b) => [b.nodeset, normalizeWhitespace(b.relevant)]));
  const changes: string[] = [];
  for (const b of before) {
    if (!afterMap.has(b.nodeset)) {
      changes.push(`${b.nodeset} disappeared`);
    } else if (afterMap.get(b.nodeset) !== normalizeWhitespace(b.relevant)) {
      changes.push(`${b.nodeset} relevant changed`);
    }
  }
  for (const a of after) {
    if (!beforeMap.has(a.nodeset)) {
      changes.push(`${a.nodeset} appeared`);
    }
  }
  return changes;
};

/** Options for {@link canonicalDiffLines}. */
export interface CanonicalDiffOptions {
  /**
   * Exclude any line whose canonical form carries `nodeset="<value>"` from the
   * result — the diff of the two documents EVERYWHERE ELSE. Omit to compare the
   * whole document (used by the F6 QA GREEN identity check, where even the
   * target bind must match).
   */
  excludeNodeset?: string;
}

/**
 * The canonical whole-document line delta between two SAME-VERSION conversions:
 * the non-blank canonicalized lines that differ, optionally excluding the lines
 * of one target bind (`opts.excludeNodeset`). Same-version convert is
 * deterministic (proven byte-identical unedited, one-line delta for the
 * single-cell fix — R11).
 *
 * Physical lines are first reassembled into whole TAG units (`toLogicalLines`),
 * then each unit is canonicalized so pure attribute-ORDER churn is neutralized:
 * the exceljs re-save perturbs pyxform's attribute ordering on real workbooks
 * (`required` migrating to a tag's end, `relevant`/`calculate` swapping), which
 * a raw line diff reports as dozens of false positives. This is per-TAG, not
 * per-physical-line, so a `<bind>` whose long `constraint`/`calculate` value
 * carries an embedded newline (pyxform wraps it) — where the churned attribute
 * moves ACROSS that newline — is still neutralized (host repro for
 * postnatal_care_service: 68 raw churn lines → 0 real delta after tag-level
 * canonicalization). Values stay byte-exact, so a genuine value change still
 * surfaces. Multiset diff, so benign reordering is ignored; the exact
 * `nodeset="<value>"` marker (closing quote included, and preserved byte-exact
 * by canonicalization) never matches a `/<root>/<value>/child` line, so a
 * same-prefix child bind is never mistaken for the excluded target.
 *
 * Shared seam (mission-05 F6): the dev-phase collateral oracle
 * (`collateralChangedLines`) and the QA whole-document oracle (deployed-vs-local
 * RED/GREEN in `qa-workflow.ts`) both go through this ONE comparator, so a fix
 * to the canonicalization benefits both.
 */
export const canonicalDiffLines = (
  aXml: string,
  bXml: string,
  opts: CanonicalDiffOptions = {}
): string[] => {
  const counts = new Map<string, number>();
  for (const line of toLogicalLines(aXml)) {
    const canon = canonicalizeTagLine(line);
    counts.set(canon, (counts.get(canon) ?? 0) + 1);
  }
  for (const line of toLogicalLines(bXml)) {
    const canon = canonicalizeTagLine(line);
    counts.set(canon, (counts.get(canon) ?? 0) - 1);
  }
  const marker = opts.excludeNodeset !== undefined ? `nodeset="${opts.excludeNodeset}"` : undefined;
  const diff: string[] = [];
  for (const [line, n] of counts) {
    if (n !== 0 && line.trim().length > 0 && !(marker !== undefined && line.includes(marker))) {
      diff.push(line.trim());
    }
  }
  return diff;
};

/**
 * Byte/line-level collateral check: the non-blank lines that differ between two
 * SAME-VERSION conversions and do NOT belong to the target bind. The top-level
 * group oracle (describeSiblingChanges) only sees `/<root>/<segment>` binds and
 * misses child/nested binds; this catches ANY collateral change (a second edit
 * corrupting a leaf field, etc.). Thin wrapper over {@link canonicalDiffLines}
 * that excludes the target bind's line(s).
 */
export const collateralChangedLines = (
  baselineXml: string,
  regenXml: string,
  targetNodeset: string
): string[] => canonicalDiffLines(baselineXml, regenXml, { excludeNodeset: targetNodeset });

export const applyXlsformFixToProject = async (
  descriptor: XlsformFixDescriptor,
  configPath: string,
  opts: XlsformApplyOptions = {}
): Promise<XlsformApplyOutcome> => {
  const xlsxRelPath = `forms/app/${descriptor.form}.xlsx`;
  const xmlRelPath = `forms/app/${descriptor.form}.xml`;
  let sandboxDir: string | undefined;
  const fail = (error: string): XlsformApplyOutcome => {
    cleanup(sandboxDir);
    return { ok: false, error };
  };

  try {
    sandboxDir = createConvertSandbox(configPath);
    const xlsxPath = `${sandboxDir}/${xlsxRelPath}`;
    const xmlPath = `${sandboxDir}/${xmlRelPath}`;
    if (!fs.existsSync(xlsxPath)) {
      return fail(`workbook not found at ${xlsxRelPath} in the config project`);
    }
    const targetNodeset = descriptor.expect.nodeset;

    // 2. baseline convert of the unedited workbook (same cht version).
    const baseRun = await runOfflineConvert({
      configPath: sandboxDir,
      form: descriptor.form,
      bin: opts.bin,
      timeoutMs: opts.timeoutMs,
    });
    if (baseRun.exitCode !== 0) {
      return fail(`baseline convert failed (exit ${baseRun.exitCode}): ${tail(baseRun.output)}`);
    }
    const baselineXml = fs.readFileSync(xmlPath, 'utf-8');
    const beforeRelevant = extractBindRelevant(baselineXml, targetNodeset);
    const baselineSiblings = extractTopLevelGroupBinds(baselineXml).filter(
      (b) => b.nodeset !== targetNodeset
    );

    // 3. apply the surgical edit(s).
    let appliedEdits: AppliedEdit[];
    try {
      appliedEdits = await applyXlsformEdits(xlsxPath, descriptor.edits);
    } catch (err) {
      if (err instanceof XlsformEditError) {
        return fail(`workbook edit failed (${err.code}): ${err.message}`);
      }
      throw err;
    }

    // 4. convert the edited workbook (convert-only, never upload).
    const editRun = await runOfflineConvert({
      configPath: sandboxDir,
      form: descriptor.form,
      bin: opts.bin,
      timeoutMs: opts.timeoutMs,
    });
    if (editRun.exitCode !== 0) {
      return fail(`convert after edit failed (exit ${editRun.exitCode}): ${tail(editRun.output)}`);
    }
    const regenXml = fs.readFileSync(xmlPath, 'utf-8');

    // 5a. assert the target bind.
    const afterRelevant = extractBindRelevant(regenXml, targetNodeset);
    if (afterRelevant === undefined) {
      return fail(`expected bind ${targetNodeset} is not present in the regenerated XML`);
    }
    // The converter trims/normalizes whitespace, so a leading space written to
    // the cell is absent from the emitted attribute; compare whitespace-
    // normalized on both sides (see `normalizeWhitespace`).
    if (normalizeWhitespace(afterRelevant) !== normalizeWhitespace(descriptor.expect.relevant)) {
      return fail(
        `bind ${targetNodeset} converted to "${afterRelevant}" but expect.relevant was ` +
          `"${descriptor.expect.relevant}"`
      );
    }

    // 5b. assert sibling invariance (default on).
    const checkSiblings = descriptor.expect.siblingsUnchanged !== false;
    if (checkSiblings) {
      const regenSiblings = extractTopLevelGroupBinds(regenXml).filter(
        (b) => b.nodeset !== targetNodeset
      );
      const changes = describeSiblingChanges(baselineSiblings, regenSiblings);
      if (changes.length > 0) {
        return fail(`sibling top-level group bind(s) changed unexpectedly: ${changes.join('; ')}`);
      }
      // Stronger: catch collateral changes to ANY bind (incl. child/nested),
      // which the top-level-group oracle above cannot see.
      const collateral = collateralChangedLines(baselineXml, regenXml, targetNodeset);
      if (collateral.length > 0) {
        return fail(
          `convert changed ${collateral.length} line(s) beyond the target bind ` +
            `(collateral damage): ${collateral.slice(0, 3).join(' | ')}`
        );
      }
    }

    const bindDiff: XlsformBindDiff = {
      nodeset: targetNodeset,
      before: beforeRelevant,
      after: afterRelevant,
      // Honest count: 0 when the invariance check was disabled (nothing verified).
      siblingsUnchanged: checkSiblings ? baselineSiblings.length : 0,
    };
    return {
      ok: true,
      appliedEdits,
      result: { form: descriptor.form, xlsxPath, xmlPath, xlsxRelPath, xmlRelPath, bindDiff, sandboxDir },
    };
  } catch (err) {
    return fail(`unexpected error: ${(err as Error).message}`);
  }
};
