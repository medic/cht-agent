// Fixed variant: mirrors the live formatListForPrompt in
// src/utils/domain-inference.ts. Items are 1-indexed (`${i + 1}`).
// See README.md in this directory.
export const formatListForPrompt = (
  items: string[],
  emptyMessage: string = 'None provided',
): string => {
  if (!items || items.length === 0) {
    return emptyMessage;
  }
  return items.map((item, i) => `${i + 1}. ${item}`).join('\n');
};
