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
  collectExportedDeclarations(content, lines, seen);
  collectPublicClassMembers(content, lines, seen);
  collectNamespaceMembers(content, lines);
  return lines.length > 0 ? lines.join('\n') : '(no public surface detected)';
}

function collectExportedDeclarations(content: string, lines: string[], seen: Set<string>): void {
  const exportRe = /^export\s+(?:default\s+)?(class|function|interface|type|enum|const|let|abstract\s+class)\s+(\w+)/gm;
  for (const m of content.matchAll(exportRe)) {
    const decl = `export ${m[1]} ${m[2]}`;
    if (!seen.has(decl)) { seen.add(decl); lines.push(decl); }
  }
}

function collectPublicClassMembers(content: string, lines: string[], seen: Set<string>): void {
  // Public class members. D6 fix: any leading whitespace, not just 2-space indent,
  // so the extractor is robust against tab-indented or 4-space external fixtures.
  // Split into method and property regexes; filter out private/protected/# in JS.
  for (const re of CLASS_MEMBER_REGEXES) {
    for (const m of content.matchAll(re)) appendPublicMember(m[0], lines, seen);
  }
}

const CLASS_MEMBER_REGEXES: ReadonlyArray<RegExp> = [
  /^[ \t]+(?:public\s+)?(?:readonly\s+)?(?:async\s+)?\w+\s*\([^)]*\)[^{;]*;?/gm,
  /^[ \t]+(?:public\s+)?(?:readonly\s+)?\w+\s*[:=][^;]*;?/gm,
];

const NON_PUBLIC_MEMBER_PREFIXES = ['private ', 'protected ', '#'];
const LIFECYCLE_HOOK_RE = /^(constructor|ngOnInit|ngOnDestroy|ngAfterViewInit)\b/;

function appendPublicMember(rawLine: string, lines: string[], seen: Set<string>): void {
  const sig = rawLine.trim();
  if (NON_PUBLIC_MEMBER_PREFIXES.some(prefix => sig.startsWith(prefix))) return;
  if (LIFECYCLE_HOOK_RE.test(sig)) return;
  if (seen.has(sig)) return;
  seen.add(sig);
  lines.push(`  ${sig}`);
}

function collectNamespaceMembers(content: string, lines: string[]): void {
  // Namespace-style object properties (Actions, Selectors namespaces).
  // Multi-line safe: [\s\S]*? spans newlines, \n\} anchor requires close-brace
  // at column 0 (cht-core convention for the Selectors namespace).
  // Must stay byte-identical to the namespace regex in src/agents/cross-file-validator.ts.
  const namespaceRe = /export\s+const\s+(\w+)\s*=\s*\{([\s\S]*?)\n\}\s*;?/g;
  for (const m of content.matchAll(namespaceRe)) {
    const props = extractNamespaceProps(m[2]);
    if (props.length > 0) lines.push(`namespace ${m[1]}: { ${props.join(', ')} }`);
  }
}

function extractNamespaceProps(body: string): string[] {
  const propRe = /^\s+(\w+)\s*[:=]/gm;
  const props: string[] = [];
  for (const p of body.matchAll(propRe)) {
    if (!props.includes(p[1])) props.push(p[1]);
  }
  return props;
}

const TEMPLATE_KEYWORDS = new Set(['true','false','null','undefined','let','of','as','then','else','async','await','typeof']);

function extractHtmlIdentifiers(content: string): string {
  // D5 fix: collect *ngFor-declared locals and #templateRef declarations so they
  // don't false-flag as undeclared component fields.
  const declaredLocals = collectTemplateDeclaredLocals(content);
  const ids = collectTemplateReferencedIds(content);
  const filtered = Array.from(ids)
    .filter(i => !TEMPLATE_KEYWORDS.has(i) && !declaredLocals.has(i))
    .sort((a, b) => a.localeCompare(b));
  return `Template identifiers referenced: ${filtered.join(', ')}`;
}

function collectTemplateDeclaredLocals(content: string): Set<string> {
  const declaredLocals = new Set<string>();
  const ngForLocalRe = /\*ngFor\s*=\s*"\s*let\s+(\w+)(?:\s*,\s*(\w+))?(?:\s+of\s+\w+)?/g;
  for (const nf of content.matchAll(ngForLocalRe)) {
    declaredLocals.add(nf[1]);
    if (nf[2]) declaredLocals.add(nf[2]);
  }
  const tplRefRe = /#(\w+)(?=[\s>=/])/g;
  for (const nf of content.matchAll(tplRefRe)) declaredLocals.add(nf[1]);
  return declaredLocals;
}

const ANGULAR_BINDING_REGEXES: ReadonlyArray<RegExp> = [
  /\*ngIf="([^"]+)"/g,
  /\*ngFor[^=]*="([^"]+)"/g,
  /\[(?!class\.|style\.|ngClass|ngStyle)[^\]]+\]="([^"]+)"/g,
  /\((?!ngModelChange)[^)]+\)="([^"]+)"/g,
];

function collectTemplateReferencedIds(content: string): Set<string> {
  const ids = new Set<string>();
  // Angular structural directives, property bindings, and event bindings — run
  // as four smaller regexes and merge. Equivalent to the composite in
  // cross-file-validator.ts.
  for (const re of ANGULAR_BINDING_REGEXES) {
    for (const m of content.matchAll(re)) collectIdentifiers(m[1], ids);
  }
  const interpRe = /\{\{\s*([^}|]+?)\s*(?:\|[^}]*)?\}\}/g;
  for (const m of content.matchAll(interpRe)) collectIdentifiers(m[1], ids);
  return ids;
}

function collectIdentifiers(expression: string, ids: Set<string>): void {
  const idRe = /\b([a-zA-Z_$][\w$]*)\b/g;
  for (const i of expression.matchAll(idRe)) ids.add(i[1]);
}

function extractJsonKeys(content: string): string {
  try {
    const obj = JSON.parse(content);
    if (typeof obj !== 'object' || obj === null) return '(non-object JSON)';
    const lines: string[] = ['Top-level keys:'];
    for (const k of Object.keys(obj)) {
      lines.push(`  ${k}: ${summarizeJsonValue((obj as Record<string, unknown>)[k])}`);
    }
    return lines.join('\n');
  } catch {
    return '(unparseable JSON; first 20 lines)\n' + content.split('\n').slice(0, 20).join('\n');
  }
}

function summarizeJsonValue(v: unknown): string {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return typeof v;
  const allKeys = Object.keys(v);
  const subKeys = allKeys.slice(0, 8);
  const more = allKeys.length > 8 ? ', ...' : '';
  return `{ ${subKeys.join(', ')}${more} }`;
}

function extractPropertiesKeys(content: string): string {
  const keys: string[] = [];
  for (const line of content.split('\n')) {
    const key = parsePropertyKey(line);
    if (key) keys.push(key);
  }
  if (keys.length === 0) return '(no keys)';
  if (keys.length <= 50) return `Keys: ${keys.join(', ')}`;
  return `Keys (${keys.length} total, showing first 50): ${keys.slice(0, 50).join(', ')}, ...`;
}

function parsePropertyKey(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;
  const eq = trimmed.indexOf('=');
  return eq > 0 ? trimmed.substring(0, eq).trim() : null;
}
