/**
 * Strip a leading ```json fence (if any) and return the inner text. Uses
 * indexOf (linear) rather than a backtracking regex.
 */
function stripCodeFence(text: string): string {
  const fence = text.indexOf('```');
  if (fence === -1) return text;
  const bodyStart = text.indexOf('\n', fence);
  const close = text.indexOf('```', fence + 3);
  if (bodyStart === -1 || close <= bodyStart) return text;
  return text.slice(bodyStart + 1, close);
}

/**
 * Extract a JSON object string from LLM output: strip a code fence, then take
 * the outermost `{ ... }` span. Linear (no `[\s\S]*` backtracking).
 */
export function extractJsonObject(text: string): string | null {
  const content = stripCodeFence(text);
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  return content.slice(start, end + 1);
}
