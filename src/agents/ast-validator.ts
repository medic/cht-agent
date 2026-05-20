/**
 * TypeScript-AST cross-file validator.
 *
 * Catches semantic bugs the regex-based `cross-file-validator.ts` cannot:
 *
 * - **Pass 1: signature coverage (C2).** When a method's parameter list changes
 *   between originalContent and content, scan in-batch callers and flag any
 *   that still pass the old argument count.
 * - **Pass 4: permission literals (C1).** When `app_settings.json` is in the
 *   batch, scan every TS file for `can_*` string literals; flag any that don't
 *   match a key in the `permissions` object of the new OR original content.
 *
 * Pass 2 (return shape) and Pass 3 (constructor injection imports) are out of
 * scope for v5 — covered by the prompt rules in Batch B and tracked as v6
 * candidates.
 */

import * as ts from 'typescript';
import { GeneratedFile, CrossFileIssue } from '../types';

interface MethodSignature {
  params: { name: string; optional: boolean }[];
}

/**
 * Validate generated files using TypeScript AST analysis.
 * Returns the list of cross-file issues; empty if no problems found.
 */
export function astValidate(files: GeneratedFile[]): CrossFileIssue[] {
  const issues: CrossFileIssue[] = [];
  const tsFiles = files.filter(f => /\.tsx?$/.test(f.relativePath));

  if (tsFiles.length > 0) {
    issues.push(...checkSignatureCoverage(tsFiles));
  }

  const appSettings = files.find(f => f.relativePath.endsWith('/app_settings.json'));
  if (appSettings && tsFiles.length > 0) {
    issues.push(...checkPermissionLiterals(tsFiles, appSettings));
  }

  return issues;
}

/**
 * Pass 1: detect signature drift without caller updates.
 *
 * For each TS file that was MODIFY (has originalContent), parse both versions
 * and collect class method signatures. For each method whose parameter list
 * grew, scan every OTHER in-batch TS file for calls of `.methodName(args)`
 * and flag any caller passing the old arg count.
 */
function checkSignatureCoverage(tsFiles: GeneratedFile[]): CrossFileIssue[] {
  const issues: CrossFileIssue[] = [];
  for (const file of tsFiles) {
    if (!file.originalContent) continue;
    issues.push(...collectSignatureDriftIssues(file, tsFiles));
  }
  return issues;
}

/** A method whose param list grew between original and new content. */
interface GrownMethod {
  modifiedFilePath: string;
  methodName: string;
  oldParamCount: number;
  newParamNames: string;
}

/**
 * For one MODIFY'd TS file, find every method whose param list grew and
 * collect call-site mismatches across the rest of the batch.
 */
function collectSignatureDriftIssues(
  modifiedFile: GeneratedFile,
  tsFiles: GeneratedFile[],
): CrossFileIssue[] {
  const issues: CrossFileIssue[] = [];
  for (const grown of findGrownMethods(modifiedFile)) {
    issues.push(...collectCallSiteIssuesAcrossFiles(grown, tsFiles));
  }
  return issues;
}

function collectCallSiteIssuesAcrossFiles(
  grown: GrownMethod,
  tsFiles: GeneratedFile[],
): CrossFileIssue[] {
  const issues: CrossFileIssue[] = [];
  for (const otherFile of tsFiles) {
    if (otherFile.relativePath === grown.modifiedFilePath) continue;
    issues.push(...findStaleCallers(otherFile, grown));
  }
  return issues;
}

/** Compare new vs original signatures and emit GrownMethod records. */
function findGrownMethods(modifiedFile: GeneratedFile): GrownMethod[] {
  const newMethods = collectMethodSignatures(modifiedFile.relativePath, modifiedFile.content);
  const oldMethods = collectMethodSignatures(modifiedFile.relativePath, modifiedFile.originalContent!);
  const grown: GrownMethod[] = [];
  for (const [methodName, newSig] of newMethods) {
    const oldSig = oldMethods.get(methodName);
    if (!oldSig || newSig.params.length <= oldSig.params.length) continue;
    grown.push({
      modifiedFilePath: modifiedFile.relativePath,
      methodName,
      oldParamCount: oldSig.params.length,
      newParamNames: newSig.params.slice(oldSig.params.length).map(p => p.name).join(', '),
    });
  }
  return grown;
}

/**
 * Scan one file for `.methodName(args)` call sites that still pass the old
 * argument count. Returns an issue for each match.
 */
function findStaleCallers(otherFile: GeneratedFile, grown: GrownMethod): CrossFileIssue[] {
  // Captures the arg list contents one level deep (no nested parens).
  const callerRe = new RegExp(String.raw`\.${escapeRegex(grown.methodName)}\s*\(([^()]*)\)`, 'g');
  const issues: CrossFileIssue[] = [];
  const flagged = new Set<number>();
  let cm: RegExpExecArray | null;
  while ((cm = callerRe.exec(otherFile.content)) !== null) {
    const issue = buildStaleCallerIssue(cm, otherFile, grown, flagged);
    if (issue) issues.push(issue);
  }
  return issues;
}

function buildStaleCallerIssue(
  match: RegExpExecArray,
  otherFile: GeneratedFile,
  grown: GrownMethod,
  flagged: Set<number>,
): CrossFileIssue | null {
  const argsText = match[1].trim();
  const argCount = argsText === '' ? 0 : splitArgs(argsText).length;
  if (argCount !== grown.oldParamCount) return null;
  if (flagged.has(match.index)) return null;
  flagged.add(match.index);
  return {
    filePath: otherFile.relativePath,
    referencedIdentifier: grown.methodName,
    expectedSource: grown.modifiedFilePath,
    reason: `Method "${grown.methodName}" gained parameter(s) (${grown.newParamNames}) in ${grown.modifiedFilePath}, but this call site passes ${argCount} arguments (old signature). Add the new argument(s).`,
  };
}

function collectMethodSignatures(filePath: string, content: string): Map<string, MethodSignature> {
  const sigs = new Map<string, MethodSignature>();
  const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);
  const visit = (node: ts.Node): void => {
    collectMethodsFromClassNode(node, sourceFile, sigs);
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  return sigs;
}

function collectMethodsFromClassNode(
  node: ts.Node,
  sourceFile: ts.SourceFile,
  sigs: Map<string, MethodSignature>,
): void {
  if (!isClassLikeNode(node)) return;
  for (const member of node.members) {
    if (isMethodWithName(member)) registerMethodSignature(member, sourceFile, sigs);
  }
}

function isClassLikeNode(node: ts.Node): node is ts.ClassDeclaration | ts.ClassExpression {
  return ts.isClassDeclaration(node) || ts.isClassExpression(node);
}

function isMethodWithName(member: ts.ClassElement): member is ts.MethodDeclaration {
  return ts.isMethodDeclaration(member) && !!member.name;
}

function registerMethodSignature(
  member: ts.MethodDeclaration,
  sourceFile: ts.SourceFile,
  sigs: Map<string, MethodSignature>,
): void {
  sigs.set(member.name!.getText(sourceFile), {
    params: member.parameters.map(p => ({
      name: p.name.getText(sourceFile),
      optional: !!p.questionToken || !!p.initializer,
    })),
  });
}

/**
 * Pass 4: cross-reference permission string literals with app_settings.json.
 *
 * Builds the set of defined `permissions` keys from the new content + originalContent
 * of app_settings.json. Scans every TS file for `'can_X_Y_Z'` style string literals.
 * Flags any literal that doesn't appear in the defined set.
 */
function checkPermissionLiterals(
  tsFiles: GeneratedFile[],
  appSettings: GeneratedFile,
): CrossFileIssue[] {
  const definedPermissions = collectDefinedPermissions(appSettings);
  if (definedPermissions.size === 0) return [];

  const issues: CrossFileIssue[] = [];
  for (const file of tsFiles) {
    issues.push(...findUndefinedPermissionLiterals(file, definedPermissions));
  }
  return issues;
}

/**
 * Match string literals matching the `can_X_Y(_Z...)` shape
 * (3+ underscore-separated segments).
 */
const PERMISSION_LITERAL_RE = /['"]([a-z]+(?:_[a-z_]+){2,})['"]/g;

function findUndefinedPermissionLiterals(
  file: GeneratedFile,
  definedPermissions: Set<string>,
): CrossFileIssue[] {
  const seen = new Set<string>();
  const literals = extractCanLiteralsFromContent(file.content, seen);
  return literals
    .filter(literal => !definedPermissions.has(literal))
    .map(literal => buildPermissionIssue(literal, file.relativePath));
}

/**
 * Pull every `can_*` literal out of `content`, deduped via `seen`. Returns
 * the literals in source order, which keeps the resulting issue list stable
 * across reruns.
 */
function extractCanLiteralsFromContent(content: string, seen: Set<string>): string[] {
  const re = new RegExp(PERMISSION_LITERAL_RE.source, 'g');
  const out: string[] = [];
  for (const m of content.matchAll(re)) {
    const literal = m[1];
    if (!literal.startsWith('can_') || seen.has(literal)) continue;
    seen.add(literal);
    out.push(literal);
  }
  return out;
}

function buildPermissionIssue(literal: string, filePath: string): CrossFileIssue {
  return {
    filePath,
    referencedIdentifier: literal,
    expectedSource: 'config/default/app_settings.json',
    reason: `Permission "${literal}" is referenced but not defined in app_settings.json's permissions object.`,
  };
}

function collectDefinedPermissions(appSettings: GeneratedFile): Set<string> {
  const keys = new Set<string>();
  addPermissionKeysFromJson(keys, appSettings.content);
  if (appSettings.originalContent) {
    addPermissionKeysFromJson(keys, appSettings.originalContent);
  }
  return keys;
}

function addPermissionKeysFromJson(keys: Set<string>, jsonText: string): void {
  try {
    const parsed = JSON.parse(jsonText) as { permissions?: Record<string, unknown> };
    for (const k of Object.keys(parsed.permissions ?? {})) keys.add(k);
  } catch {
    // malformed JSON; defer to other validators
  }
}

/**
 * Escape regex metacharacters in `str` so the result can be embedded in a
 * RegExp source. The character class matches any single regex metacharacter;
 * the canonical MDN helper. S7780/S7781 are false positives here because the
 * pattern is a character class, not a plain string literal.
 */
function escapeRegex(str: string): string {
  // NOSONAR
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // NOSONAR
}

function splitArgs(argsText: string): string[] {
  // Naive split on top-level commas. Doesn't handle inline objects, but the regex
  // already restricts to single-paren-depth captures, so nested calls bail out.
  return argsText.split(',').map(s => s.trim()).filter(Boolean);
}
