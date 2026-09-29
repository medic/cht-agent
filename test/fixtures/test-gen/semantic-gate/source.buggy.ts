// Buggy variant: a deliberate off-by-one mutation of source.fixed.ts.
// Items are 0-indexed (`${i}`) instead of 1-indexed. For ['apple','banana']
// this emits "0. apple\n1. banana" instead of "1. apple\n2. banana".
// A generated test that genuinely probes the numbering MUST fail here.
// See README.md in this directory.
export const formatListForPrompt = (
  items: string[],
  emptyMessage: string = 'None provided',
): string => {
  if (!items || items.length === 0) {
    return emptyMessage;
  }
  return items.map((item, i) => `${i}. ${item}`).join('\n');
};
