export const PLAN_START = '=== PLAN ===';
export const PLAN_END = '=== END PLAN ===';
export const PLAN_ITEM_RE = /^\d+\.\s*(MODIFY|CREATE)\s+(\S+)\s*[-–—]\s*(.+)/;

export interface PlanItem {
  action: 'MODIFY' | 'CREATE';
  filePath: string;
  rationale: string;
}

/**
 * Strip backticks and surrounding whitespace from file paths.
 * LLMs frequently wrap paths in markdown backticks (e.g. `config/file.json`).
 */
export function sanitizePath(rawPath: string): string {
  return rawPath.replaceAll('`', '').trim();
}

/**
 * Parse the PLAN section from LLM output.
 */
export function parsePlan(output: string): PlanItem[] {
  const lines = output.split('\n').map(l => l.trim());
  const startIndex = lines.indexOf(PLAN_START);
  if (startIndex === -1) return [];
  const endIndex = lines.indexOf(PLAN_END, startIndex + 1);
  const body = lines.slice(startIndex + 1, endIndex === -1 ? lines.length : endIndex);
  return body.flatMap(parsePlanLine);
}

function parsePlanLine(trimmed: string): PlanItem[] {
  const match = PLAN_ITEM_RE.exec(trimmed);
  if (!match) return [];
  return [{
    action: match[1] as 'MODIFY' | 'CREATE',
    filePath: sanitizePath(match[2]),
    rationale: match[3].trim(),
  }];
}
