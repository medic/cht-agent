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
  const items: PlanItem[] = [];
  const lines = output.split('\n');

  let inPlan = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed === PLAN_START) {
      inPlan = true;
      continue;
    }
    if (trimmed === PLAN_END) {
      break;
    }

    if (inPlan) {
      const match = PLAN_ITEM_RE.exec(trimmed);
      if (match) {
        items.push({
          action: match[1] as 'MODIFY' | 'CREATE',
          filePath: sanitizePath(match[2]),
          rationale: match[3].trim(),
        });
      }
    }
  }

  return items;
}
