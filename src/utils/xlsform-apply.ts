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

const cleanup = (dir: string | undefined): void => {
  if (dir) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
};

/** Compare two sibling bind sets by nodeset; describe every change. */
const describeSiblingChanges = (
  before: FormBindExpectation[],
  after: FormBindExpectation[]
): string[] => {
  const beforeMap = new Map(before.map((b) => [b.nodeset, b.relevant]));
  const afterMap = new Map(after.map((b) => [b.nodeset, b.relevant]));
  const changes: string[] = [];
  for (const b of before) {
    if (!afterMap.has(b.nodeset)) {
      changes.push(`${b.nodeset} disappeared`);
    } else if (afterMap.get(b.nodeset) !== b.relevant) {
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
    if (afterRelevant !== descriptor.expect.relevant) {
      return fail(
        `bind ${targetNodeset} converted to "${afterRelevant}" but expect.relevant was ` +
          `"${descriptor.expect.relevant}"`
      );
    }

    // 5b. assert sibling invariance (default on).
    if (descriptor.expect.siblingsUnchanged !== false) {
      const regenSiblings = extractTopLevelGroupBinds(regenXml).filter(
        (b) => b.nodeset !== targetNodeset
      );
      const changes = describeSiblingChanges(baselineSiblings, regenSiblings);
      if (changes.length > 0) {
        return fail(`sibling bind(s) changed unexpectedly: ${changes.join('; ')}`);
      }
    }

    const bindDiff: XlsformBindDiff = {
      nodeset: targetNodeset,
      before: beforeRelevant,
      after: afterRelevant,
      siblingsUnchanged: baselineSiblings.length,
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
