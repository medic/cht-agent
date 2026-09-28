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
 * Extract a JSON object string from LLM output: strip a code fence, then return
 * the FIRST brace-balanced `{ ... }`.
 *
 * It used to span `indexOf('{')` to `lastIndexOf('}')`, which is the same thing
 * whenever the response holds exactly one object and garbage whenever it holds
 * two. A coherence run produced
 *
 *     {"contradictions": [{...}]}
 *     {"contradictions": []}
 *
 * and the outermost span glued both together into a string that cannot parse,
 * losing the draft's whole check to a response that was two valid answers rather
 * than none. Taking the first balanced object also drops trailing prose for free.
 *
 * String-aware, so a brace inside a quoted value does not end the object — and
 * these payloads quote draft prose, where braces are common. Still linear.
 */
export function extractJsonObject(text: string): string | null {
  const content = stripCodeFence(text);
  const start = content.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < content.length; i++) {
    const ch = content[i];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { escaped = inString; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return content.slice(start, i + 1);
  }
  // Unbalanced — a genuinely truncated response. Fall back to the old span so a
  // caller's own repair pass still gets something to work with.
  const end = content.lastIndexOf('}');
  return end > start ? content.slice(start, end + 1) : null;
}
