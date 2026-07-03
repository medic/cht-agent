import { GeneratedFile } from '../types';

export interface CrossFileIssue {
  filePath: string;
  referencedIdentifier?: string;
  expectedSource?: string;
  reason?: string;
  /**
   * Discriminator for non-static-validator issue kinds (compile-error,
   * partial-completion, plan-adherence-*, plan-discovered-missing).
   */
  issueType?: string;
  description?: string;
}

/**
 * Validate that every identifier referenced across the generated batch has a
 * matching declaration in the batch (or in the file's originalContent for MODIFY).
 *
 * Catches:
 * - Component-template field mismatches.
 * - Component-selector reference mismatches.
 * - Effect-action method call mismatches.
 *
 * NOTE: assumes the cht-core class-based Actions convention
 * (`export class FooActions { setX() {} }`). Functional `createAction()` actions
 * are NOT detected. If cht-core migrates, update buildActionMethodRegistry.
 * (D7 design risk.)
 */
export function crossFileValidate(files: GeneratedFile[]): CrossFileIssue[] {
  const issues: CrossFileIssue[] = [];

  const componentFields = buildComponentFieldRegistry(files);
  const selectorExports = buildSelectorExportRegistry(files);
  const actionMethods = buildActionMethodRegistry(files);

  for (const file of files) {
    if (file.relativePath.endsWith('.component.html')) {
      issues.push(...validateTemplate(file, componentFields));
    } else if (file.relativePath.endsWith('.component.ts')) {
      issues.push(...validateComponentSelectors(file, selectorExports));
    } else if (file.relativePath.includes('/effects/')) {
      issues.push(...validateEffectActions(file, actionMethods));
    }
  }

  return issues;
}

function buildComponentFieldRegistry(files: GeneratedFile[]): Map<string, Set<string>> {
  const registry = new Map<string, Set<string>>();
  for (const file of files) {
    if (!file.relativePath.endsWith('.component.ts')) continue;
    const base = file.relativePath.replace(/\.component\.ts$/, '');
    registry.set(base, extractComponentFields(file.content));
  }
  return registry;
}

function extractComponentFields(content: string): Set<string> {
  const fields = new Set<string>();
  // Mirrors the public-surface regex but captures member names directly.
  const memberRe = /^[ \t]+(?!private\s|protected\s|#)(?:public\s+)?(?:readonly\s+)?(?:async\s+)?(\w+)\s*[(:=]/gm;
  let m: RegExpExecArray | null;
  while ((m = memberRe.exec(content)) !== null) {
    if (m[1] === 'constructor') continue;
    fields.add(m[1]);
  }
  return fields;
}

function buildSelectorExportRegistry(files: GeneratedFile[]): Set<string> {
  const names = new Set<string>();
  for (const file of files) {
    if (!file.relativePath.includes('/selectors/')) continue;
    extractSelectorNamesFromFile(file, names);
  }
  return names;
}

/**
 * MODIFY files contribute both their new content and their original content
 * so existing selectors aren't false-flagged as missing.
 */
function extractSelectorNamesFromFile(file: GeneratedFile, names: Set<string>): void {
  extractSelectorNamesFromSource(file.content, names);
  if (file.originalContent) extractSelectorNamesFromSource(file.originalContent, names);
}

function extractSelectorNamesFromSource(source: string, names: Set<string>): void {
  // (a) Top-level: export const X = ... / export function X(...)
  // Fresh regex per source to avoid /g `lastIndex` carry-over across inputs.
  const topLevelRe = /(?:export\s+const|export\s+function)\s+(\w+)/g;
  let m: RegExpExecArray | null;
  while ((m = topLevelRe.exec(source)) !== null) names.add(m[1]);

  // (b) Namespace properties: export const Selectors = { foo: ..., bar: ... };
  // The terminator `\n\}` requires the closing brace at column 0, which is the
  // cht-core convention for the Selectors namespace. Inner braces in arrow
  // bodies (e.g., (state) => ({ x: state.x })) are always indented, so they
  // don't terminate the body capture early.
  // Must stay byte-identical to the namespace regex in lib/public-surface.ts.
  const namespaceRe = /export\s+const\s+(\w+)\s*=\s*\{([\s\S]*?)\n\}\s*;?/g;
  while ((m = namespaceRe.exec(source)) !== null) {
    const propRe = /^\s+(\w+)\s*[:=]/gm;
    let p: RegExpExecArray | null;
    while ((p = propRe.exec(m[2])) !== null) names.add(p[1]);
  }
}

function buildActionMethodRegistry(files: GeneratedFile[]): Map<string, Set<string>> {
  const registry = new Map<string, Set<string>>();
  for (const file of files) {
    if (!file.relativePath.includes('/actions/')) continue;
    extractActionMethodsFromFile(file, registry);
  }
  return registry;
}

function extractActionMethodsFromFile(file: GeneratedFile, registry: Map<string, Set<string>>): void {
  extractActionClassesFromSource(file.content, registry);
  if (file.originalContent) extractActionClassesFromSource(file.originalContent, registry);
}

function extractActionClassesFromSource(source: string, registry: Map<string, Set<string>>): void {
  const classRe = /export\s+class\s+(\w+Actions)\s*\{([\s\S]*?)\n\}/g;
  let cm: RegExpExecArray | null;
  while ((cm = classRe.exec(source)) !== null) {
    const className = cm[1];
    const set = registry.get(className) ?? new Set<string>();
    addPublicMethodsToSet(cm[2], set);
    registry.set(className, set);
  }
}

function addPublicMethodsToSet(classBody: string, set: Set<string>): void {
  const methodRe = /^[ \t]+(?!private\s|protected\s|#)(?:public\s+)?(?:async\s+)?(\w+)\s*\(/gm;
  let mm: RegExpExecArray | null;
  while ((mm = methodRe.exec(classBody)) !== null) {
    if (mm[1] !== 'constructor') set.add(mm[1]);
  }
}

const TEMPLATE_KEYWORDS = new Set(
  ['true','false','null','undefined','let','of','as','then','else','async','await','typeof'],
);

/**
 * Extract identifiers referenced in template bindings/interpolation, minus
 * locals declared by *ngFor / #templateRef (D5 fix).
 */
function extractTemplateReferenced(content: string): Set<string> {
  const declaredLocals = collectTemplateDeclaredLocals(content);
  const ids = new Set<string>();
  collectIdsFromBindings(content, ids);
  collectIdsFromInterpolations(content, ids);

  const referenced = new Set<string>();
  for (const id of ids) {
    if (TEMPLATE_KEYWORDS.has(id)) continue;
    if (declaredLocals.has(id)) continue;
    referenced.add(id);
  }
  return referenced;
}

function collectTemplateDeclaredLocals(content: string): Set<string> {
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
  return declaredLocals;
}

function collectIdsFromExpression(expression: string, ids: Set<string>): void {
  const idRe = /\b([a-zA-Z_$][\w$]*)\b/g;
  let i: RegExpExecArray | null;
  while ((i = idRe.exec(expression)) !== null) ids.add(i[1]);
}

function collectIdsFromBindings(content: string, ids: Set<string>): void {
  // Angular structural directives (*ngIf, *ngFor), property bindings ([...])
  // excluding class/style/ngClass/ngStyle, and event bindings ((...)) excluding
  // ngModelChange. Run as four smaller regexes and merge — equivalent to the
  // single composite regex in public-surface.ts.
  for (const re of ANGULAR_BINDING_REGEXES) {
    for (const m of content.matchAll(re)) collectIdsFromExpression(m[1], ids);
  }
}

const ANGULAR_BINDING_REGEXES: ReadonlyArray<RegExp> = [
  /\*ngIf="([^"]+)"/g,
  /\*ngFor[^=]*="([^"]+)"/g,
  /\[(?!class\.|style\.|ngClass|ngStyle)[^\]]+\]="([^"]+)"/g,
  /\((?!ngModelChange)[^)]+\)="([^"]+)"/g,
];

function collectIdsFromInterpolations(content: string, ids: Set<string>): void {
  const interpRe = /\{\{\s*([^}|]+?)\s*(?:\|[^}]*)?\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = interpRe.exec(content)) !== null) collectIdsFromExpression(m[1], ids);
}

const TEMPLATE_BUILTIN_IDENTIFIERS = new Set(['$event', '$any', '$implicit']);

function validateTemplate(file: GeneratedFile, fields: Map<string, Set<string>>): CrossFileIssue[] {
  const base = file.relativePath.replace(/\.component\.html$/, '');
  const componentFields = fields.get(base);
  if (!componentFields) return []; // No paired component in this batch; skip
  return [...extractTemplateReferenced(file.content)]
    .filter(id => !TEMPLATE_BUILTIN_IDENTIFIERS.has(id) && !componentFields.has(id))
    .map(id => ({
      filePath: file.relativePath,
      referencedIdentifier: id,
      expectedSource: `${base}.component.ts`,
      reason: `Template references "${id}" but the component class does not declare it as a public field/method.`,
    }));
}

function validateComponentSelectors(file: GeneratedFile, selectorExports: Set<string>): CrossFileIssue[] {
  const issues: CrossFileIssue[] = [];
  const re = /\bSelectors\.(\w+)/g;
  let m: RegExpExecArray | null;
  const seen = new Set<string>();
  while ((m = re.exec(file.content)) !== null) {
    const name = m[1];
    if (seen.has(name)) continue;
    seen.add(name);
    if (!selectorExports.has(name)) {
      issues.push({
        filePath: file.relativePath,
        referencedIdentifier: `Selectors.${name}`,
        expectedSource: 'webapp/src/ts/selectors/index.ts',
        reason: `Component references "Selectors.${name}" but no selector with that name exists in the batch or the existing selectors file.`,
      });
    }
  }
  return issues;
}

function validateEffectActions(file: GeneratedFile, actionMethods: Map<string, Set<string>>): CrossFileIssue[] {
  const issues: CrossFileIssue[] = [];
  const re = /\bthis\.(\w+Actions)\.(\w+)\s*\(/g;
  const seen = new Set<string>();
  for (const m of file.content.matchAll(re)) {
    const issue = checkEffectActionCall(file.relativePath, m, actionMethods, seen);
    if (issue) issues.push(issue);
  }
  return issues;
}

function checkEffectActionCall(
  filePath: string,
  match: RegExpMatchArray,
  actionMethods: Map<string, Set<string>>,
  seen: Set<string>,
): CrossFileIssue | null {
  const lowerCaseClassName = match[1];
  const className = lowerCaseClassName.charAt(0).toUpperCase() + lowerCaseClassName.slice(1);
  const methodName = match[2];
  const key = `${className}.${methodName}`;
  if (seen.has(key)) return null;
  seen.add(key);
  const methods = actionMethods.get(className);
  // Foreign action class (not in this batch). Cannot validate; skip.
  if (!methods || methods.has(methodName)) return null;
  return {
    filePath,
    referencedIdentifier: key,
    expectedSource: 'webapp/src/ts/actions/<domain>.ts',
    reason: `Effect calls "this.${lowerCaseClassName}.${methodName}(...)" but the action class does not declare the method.`,
  };
}
