import { PlanItem } from './plan';

/**
 * Threshold for switching MODIFY files to search-replace / Python transform mode.
 * Code/content files up to 1000 lines get full-file output (fits in 65K output tokens).
 * JSON files up to 2000 lines get full-file output; beyond that, Python transform.
 */
export const LARGE_FILE_LINE_THRESHOLD = 1000;
export const LARGE_JSON_LINE_THRESHOLD = 2000;

/**
 * Char thresholds catch minified single-line-heavy files that wouldn't trip the line count
 * but would blow past the 65K output-token budget on a full-file rewrite.
 * 50K for JSON (matches minified compactness), 80K for everything else.
 */
export const LARGE_FILE_CHAR_THRESHOLD = 80000;
export const LARGE_JSON_CHAR_THRESHOLD = 50000;

/**
 * Check if a MODIFY file is large enough to warrant search-replace / transform mode.
 * Returns false for CREATE actions and for files not present in the content map.
 */
export function isLargeFile(planItem: PlanItem, originalContentMap: Map<string, string>): boolean {
  if (planItem.action !== 'MODIFY') return false;
  const original = originalContentMap.get(planItem.filePath);
  if (!original) return false;
  const lineCount = original.split('\n').length;
  const charCount = original.length;
  const isJson = planItem.filePath.endsWith('.json');
  const lineThreshold = isJson ? LARGE_JSON_LINE_THRESHOLD : LARGE_FILE_LINE_THRESHOLD;
  const charThreshold = isJson ? LARGE_JSON_CHAR_THRESHOLD : LARGE_FILE_CHAR_THRESHOLD;
  return lineCount > lineThreshold || charCount > charThreshold;
}
