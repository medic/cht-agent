/**
 * Extract a JSON object string from LLM output: strip a leading ```json fence
 * if present, then take the outermost `{ ... }` span. Uses indexOf/lastIndexOf
 * (linear) rather than `[\s\S]*` regexes, which SonarCloud flags for
 * super-linear backtracking.
 */
export function extractJsonObject(text: string): string | null {
  let content = text;

  const fence = content.indexOf('```');
  if (fence !== -1) {
    const bodyStart = content.indexOf('\n', fence);
    const close = content.indexOf('```', fence + 3);
    if (bodyStart !== -1 && close > bodyStart) {
      content = content.slice(bodyStart + 1, close);
    }
  }

  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  return start !== -1 && end > start ? content.slice(start, end + 1) : null;
}
