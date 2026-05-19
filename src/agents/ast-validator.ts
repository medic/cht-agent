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

    const newMethods = collectMethodSignatures(file.relativePath, file.content);
    const oldMethods = collectMethodSignatures(file.relativePath, file.originalContent);

    for (const [methodName, newSig] of newMethods) {
      const oldSig = oldMethods.get(methodName);
      if (!oldSig) continue;
      if (newSig.params.length <= oldSig.params.length) continue;

      const addedParams = newSig.params.slice(oldSig.params.length).map(p => p.name);
      const newParamNames = addedParams.join(', ');

      for (const otherFile of tsFiles) {
        if (otherFile.relativePath === file.relativePath) continue;
        // Match `.methodName(args)` calls. Captures the arg list contents (one level deep — no nested parens).
        const callerRe = new RegExp(`\\.${escapeRegex(methodName)}\\s*\\(([^()]*)\\)`, 'g');
        let cm: RegExpExecArray | null;
        const flagged = new Set<number>();
        while ((cm = callerRe.exec(otherFile.content)) !== null) {
          const argsText = cm[1].trim();
          const argCount = argsText === '' ? 0 : splitArgs(argsText).length;
          if (argCount === oldSig.params.length && !flagged.has(cm.index)) {
            flagged.add(cm.index);
            issues.push({
              filePath: otherFile.relativePath,
              referencedIdentifier: methodName,
              expectedSource: file.relativePath,
              reason: `Method "${methodName}" gained parameter(s) (${newParamNames}) in ${file.relativePath}, but this call site passes ${argCount} arguments (old signature). Add the new argument(s).`,
            });
          }
        }
      }
    }
  }

  return issues;
}

function collectMethodSignatures(filePath: string, content: string): Map<string, MethodSignature> {
  const sigs = new Map<string, MethodSignature>();
  const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);

  const visit = (node: ts.Node): void => {
    if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
      for (const member of node.members) {
        if (ts.isMethodDeclaration(member) && member.name) {
          const name = member.name.getText(sourceFile);
          const params = member.parameters.map(p => ({
            name: p.name.getText(sourceFile),
            optional: !!p.questionToken || !!p.initializer,
          }));
          sigs.set(name, { params });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);

  return sigs;
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
  const issues: CrossFileIssue[] = [];

  const definedPermissions = collectDefinedPermissions(appSettings);
  if (definedPermissions.size === 0) return [];

  // Match string literals matching the `can_X_Y(_Z...)` shape (≥3 underscore-separated segments).
  const literalRe = /['"]([a-z]+(?:_[a-z_]+){2,})['"]/g;

  for (const file of tsFiles) {
    const seenInFile = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = literalRe.exec(file.content)) !== null) {
      const literal = m[1];
      if (!literal.startsWith('can_')) continue;
      if (seenInFile.has(literal)) continue;
      seenInFile.add(literal);

      if (!definedPermissions.has(literal)) {
        issues.push({
          filePath: file.relativePath,
          referencedIdentifier: literal,
          expectedSource: 'config/default/app_settings.json',
          reason: `Permission "${literal}" is referenced but not defined in app_settings.json's permissions object.`,
        });
      }
    }
    literalRe.lastIndex = 0;
  }

  return issues;
}

function collectDefinedPermissions(appSettings: GeneratedFile): Set<string> {
  const keys = new Set<string>();
  try {
    const parsed = JSON.parse(appSettings.content) as { permissions?: Record<string, unknown> };
    for (const k of Object.keys(parsed.permissions ?? {})) keys.add(k);
  } catch {
    // malformed JSON; defer to other validators
  }
  if (appSettings.originalContent) {
    try {
      const parsed = JSON.parse(appSettings.originalContent) as { permissions?: Record<string, unknown> };
      for (const k of Object.keys(parsed.permissions ?? {})) keys.add(k);
    } catch { /* ignore */ }
  }
  return keys;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function splitArgs(argsText: string): string[] {
  // Naive split on top-level commas. Doesn't handle inline objects, but the regex
  // already restricts to single-paren-depth captures, so nested calls bail out.
  return argsText.split(',').map(s => s.trim()).filter(Boolean);
}
