import * as path from 'node:path';

/**
 * Extract the public API surface of a file for use in cross-file prompts.
 *
 * Returns a structured text block listing exports, public class members,
 * namespace properties, HTML bindings, JSON keys, etc. Enough for a sibling
 * file's generation prompt to know what identifiers it can safely reference.
 *
 * Regex-based (not AST). Covers the 80% case for cht-core conventions.
 * A future iteration can upgrade to TypeScript Compiler API for precision.
 */
export function extractPublicSurface(filePath: string, content: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const base = path.basename(filePath).toLowerCase();

  if (base.endsWith('.component.html') || ext === '.html') {
    return extractHtmlIdentifiers(content);
  }
  if (ext === '.ts' || ext === '.tsx') {
    return extractTsSurface(content);
  }
  if (ext === '.js') {
    return extractTsSurface(content);
  }
  if (ext === '.json') {
    return extractJsonKeys(content);
  }
  if (ext === '.properties') {
    return extractPropertiesKeys(content);
  }

  return content.split('\n').slice(0, 30).join('\n');
}

function extractTsSurface(content: string): string {
  const lines: string[] = [];
  const seen = new Set<string>();

  const exportRe = /^export\s+(?:default\s+)?(class|function|interface|type|enum|const|let|abstract\s+class)\s+(\w+)/gm;
  let m: RegExpExecArray | null;
  while ((m = exportRe.exec(content)) !== null) {
    const decl = `export ${m[1]} ${m[2]}`;
    if (!seen.has(decl)) { seen.add(decl); lines.push(decl); }
  }

  // Public class members. D6 fix: any leading whitespace, not just 2-space indent,
  // so the extractor is robust against tab-indented or 4-space external fixtures.
  // Excludes private/protected/# fields, optional public/readonly/async modifiers.
  // NOSONAR_BEGIN
  const memberRe = /^[ \t]+(?!private\s|protected\s|#)(?:public\s+)?(?:readonly\s+)?(async\s+)?(\w+)\s*(\([^)]*\)[^{;]*|[:=][^;]*);?/gm;
  // NOSONAR_END
  while ((m = memberRe.exec(content)) !== null) {
    const sig = m[0].trim();
    if (/^(constructor|ngOnInit|ngOnDestroy|ngAfterViewInit)\b/.test(sig)) continue;
    if (!seen.has(sig)) { seen.add(sig); lines.push(`  ${sig}`); }
  }

  // Namespace-style object properties (Actions, Selectors namespaces).
  // Multi-line safe: [\s\S]*? spans newlines, \n\} anchor requires close-brace
  // at column 0 (cht-core convention for the Selectors namespace).
  // Must stay byte-identical to the namespace regex in src/agents/cross-file-validator.ts.
  const namespaceRe = /export\s+const\s+(\w+)\s*=\s*\{([\s\S]*?)\n\}\s*;?/g;
  while ((m = namespaceRe.exec(content)) !== null) {
    const namespaceName = m[1];
    const body = m[2];
    const propRe = /^\s+(\w+)\s*[:=]/gm;
    let p: RegExpExecArray | null;
    const props: string[] = [];
    while ((p = propRe.exec(body)) !== null) {
      if (!props.includes(p[1])) props.push(p[1]);
    }
    if (props.length > 0) {
      lines.push(`namespace ${namespaceName}: { ${props.join(', ')} }`);
    }
  }

  return lines.length > 0 ? lines.join('\n') : '(no public surface detected)';
}

function extractHtmlIdentifiers(content: string): string {
  // D5 fix: collect *ngFor-declared locals and #templateRef declarations so they
  // don't false-flag as undeclared component fields.
  const declaredLocals = new Set<string>();
  const ngForLocalRe = /\*ngFor\s*=\s*"\s*let\s+(\w+)(?:\s*,\s*(\w+))?(?:\s+of\s+\w+)?/g;
  let nf: RegExpExecArray | null;
  while ((nf = ngForLocalRe.exec(content)) !== null) {
    declaredLocals.add(nf[1]);
    if (nf[2]) declaredLocals.add(nf[2]);
  }
  const tplRefRe = /#(\w+)(?=[\s>=/])/g;
  while ((nf = tplRefRe.exec(content)) !== null) {
    declaredLocals.add(nf[1]);
  }

  const ids = new Set<string>();
  // Matches Angular structural directives (*ngIf, *ngFor), property bindings
  // ([...]) excluding class/style/ngClass/ngStyle, and event bindings ((...))
  // excluding ngModelChange. Must stay byte-identical to cross-file-validator.ts.
  // NOSONAR_BEGIN
  const bindingRe = /(?:\*ngIf|\*ngFor[^=]*|\[(?!class\.|style\.|ngClass|ngStyle)[^\]]+\]|\((?!ngModelChange)[^)]+\))="([^"]+)"/g;
  // NOSONAR_END
  let m: RegExpExecArray | null;
  while ((m = bindingRe.exec(content)) !== null) {
    const idRe = /\b([a-zA-Z_$][\w$]*)\b/g;
    let i: RegExpExecArray | null;
    while ((i = idRe.exec(m[1])) !== null) {
      ids.add(i[1]);
    }
  }
  const interpRe = /\{\{\s*([^}|]+?)\s*(?:\|[^}]*)?\}\}/g;
  while ((m = interpRe.exec(content)) !== null) {
    const idRe = /\b([a-zA-Z_$][\w$]*)\b/g;
    let i: RegExpExecArray | null;
    while ((i = idRe.exec(m[1])) !== null) {
      ids.add(i[1]);
    }
  }
  const KEYWORDS = new Set(['true','false','null','undefined','let','of','as','then','else','async','await','typeof']);
  const filtered = Array.from(ids)
    .filter(i => !KEYWORDS.has(i))
    .filter(i => !declaredLocals.has(i))
    .sort((a, b) => a.localeCompare(b));
  return `Template identifiers referenced: ${filtered.join(', ')}`;
}

function extractJsonKeys(content: string): string {
  try {
    const obj = JSON.parse(content);
    if (typeof obj !== 'object' || obj === null) return '(non-object JSON)';
    const lines: string[] = ['Top-level keys:'];
    for (const k of Object.keys(obj)) {
      const v = (obj as Record<string, unknown>)[k];
      if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
        const subKeys = Object.keys(v).slice(0, 8);
        const more = Object.keys(v).length > 8 ? ', ...' : '';
        lines.push(`  ${k}: { ${subKeys.join(', ')}${more} }`);
      } else {
        lines.push(`  ${k}: ${typeof v}`);
      }
    }
    return lines.join('\n');
  } catch {
    return '(unparseable JSON; first 20 lines)\n' + content.split('\n').slice(0, 20).join('\n');
  }
}

function extractPropertiesKeys(content: string): string {
  const keys: string[] = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq > 0) keys.push(trimmed.substring(0, eq).trim());
  }
  if (keys.length === 0) return '(no keys)';
  if (keys.length <= 50) return `Keys: ${keys.join(', ')}`;
  return `Keys (${keys.length} total, showing first 50): ${keys.slice(0, 50).join(', ')}, ...`;
}
