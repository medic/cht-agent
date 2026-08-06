/**
 * Staging Utilities
 *
 * Utilities for managing staged files before writing to cht-core.
 * Handles OS-appropriate temp directories, file operations, and diff generation.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { diffArrays } from 'diff';
import { GeneratedFile, FileDiff } from '../types';

/**
 * Resolve an externally-sourced relative path against a base directory and
 * guarantee the result stays inside that base (H3, #63).
 *
 * `file.relativePath` originates from generated/plan data, so a `../..`-style
 * or absolute value would otherwise escape the staging root or the cht-core
 * root and let a write clobber files outside the intended tree. This rejects
 * absolute `rel` outright and any `rel` whose resolved path is neither the base
 * itself nor a descendant of it. Returns the absolute, contained path.
 *
 * Throws on violation. Write/copy callers let that surface as a rejected
 * promise (matching how they already propagate fs errors); the read helpers
 * catch it and fall back to their usual "not available" sentinel.
 */
const resolveWithin = (base: string, rel: string): string => {
  if (path.isAbsolute(rel)) {
    throw new Error(`Path "${rel}" is absolute and escapes the target directory (${base})`);
  }
  const resolvedBase = path.resolve(base);
  const resolved = path.resolve(resolvedBase, rel);
  if (resolved !== resolvedBase && !resolved.startsWith(resolvedBase + path.sep)) {
    throw new Error(`Path "${rel}" resolves outside the target directory (${resolvedBase})`);
  }
  return resolved;
};

/**
 * Read file content safely, returning null if file doesn't exist or is a directory
 */
const readFileSafe = async (filePath: string): Promise<string | null> => {
  try {
    // Check if it's a file first
    const stats = await fs.promises.stat(filePath);
    if (!stats.isFile()) {
      return null; // Return null for directories or other non-file types
    }
    return await fs.promises.readFile(filePath, 'utf-8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    // Return null for common "not readable" errors
    if (code === 'ENOENT' || code === 'EISDIR' || code === 'EACCES') {
      return null;
    }
    throw error;
  }
};

/**
 * Generate a simple unified diff between two strings
 */
type DiffResult = { diff: string; additions: number; deletions: number };

const generateUnifiedDiff = (
  originalContent: string | null,
  newContent: string,
  filePath: string
): DiffResult => {
  const newLines = newContent.split('\n');
  const diffLines: string[] = [];

  if (originalContent === null) {
    diffLines.push(`--- /dev/null`, `+++ b/${filePath}`);
    return appendNewFileDiff(diffLines, newLines);
  }
  diffLines.push(`--- a/${filePath}`, `+++ b/${filePath}`);
  return appendModifiedFileDiff(diffLines, originalContent.split('\n'), newLines);
};

function appendNewFileDiff(diffLines: string[], newLines: string[]): DiffResult {
  diffLines.push(`@@ -0,0 +1,${newLines.length} @@`);
  for (const line of newLines) diffLines.push(`+${line}`);
  return { diff: diffLines.join('\n'), additions: newLines.length, deletions: 0 };
}

/**
 * Lines of unchanged context kept around each change, as in `git diff -U3`.
 */
const DIFF_CONTEXT_LINES = 3;

/**
 * Render a real (LCS-aligned) unified diff.
 *
 * This previously compared originalLines[i] to newLines[i] index-by-index with
 * no alignment, so a single inserted or deleted line shifted every line after
 * it and the whole file rendered as changed — a 5-line edit to a 2,553-line
 * tasks.js displayed as "+2490 -2501", with identical lines shown as both added
 * and removed. HC2 exists so a human can review the change before it is
 * written; a diff that reports every line as touched defeats that entirely.
 * `diff` is already a dependency, so use its LCS implementation.
 */
function appendModifiedFileDiff(
  diffLines: string[],
  originalLines: string[],
  newLines: string[],
): DiffResult {
  const parts = diffLines_(originalLines, newLines);
  const stats = { additions: 0, deletions: 0 };
  for (const part of parts) {
    if (part.added) stats.additions += part.lines.length;
    else if (part.removed) stats.deletions += part.lines.length;
  }
  renderHunks(diffLines, parts);
  return { diff: diffLines.join('\n'), additions: stats.additions, deletions: stats.deletions };
}

interface DiffPart {
  added?: boolean;
  removed?: boolean;
  lines: string[];
}

const diffLines_ = (originalLines: string[], newLines: string[]): DiffPart[] =>
  diffArrays(originalLines, newLines).map(part => ({
    ...(part.added ? { added: true } : {}),
    ...(part.removed ? { removed: true } : {}),
    lines: part.value,
  }));

/**
 * Group the LCS parts into hunks with up to DIFF_CONTEXT_LINES of surrounding
 * context, emitting a `@@` header per hunk with correct 1-based line numbers.
 */
function renderHunks(diffLines: string[], parts: DiffPart[]): void {
  let origLine = 1;
  let newLine = 1;
  let pending: { origStart: number; newStart: number; origCount: number; newCount: number; body: string[] } | null = null;

  const flush = (): void => {
    if (!pending) return;
    diffLines.push(
      `@@ -${pending.origStart},${pending.origCount} +${pending.newStart},${pending.newCount} @@`,
      ...pending.body,
    );
    pending = null;
  };

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part.added && !part.removed) {
      const isFirst = pending === null;
      const leading = isFirst ? [] : part.lines.slice(0, DIFF_CONTEXT_LINES);
      const hasMoreChanges = parts.slice(i + 1).some(p => p.added || p.removed);
      if (pending) {
        for (const line of leading) {
          pending.body.push(` ${line}`);
          pending.origCount++;
          pending.newCount++;
        }
        // A long unchanged run ends the hunk; a short one stays as inner context.
        if (part.lines.length > DIFF_CONTEXT_LINES * 2 || !hasMoreChanges) flush();
        else {
          for (const line of part.lines.slice(DIFF_CONTEXT_LINES)) {
            pending.body.push(` ${line}`);
            pending.origCount++;
            pending.newCount++;
          }
        }
      }
      origLine += part.lines.length;
      newLine += part.lines.length;
      continue;
    }

    if (!pending) {
      // Open a hunk, back-filling trailing context from the previous unchanged run.
      const prev = parts[i - 1];
      const context = prev && !prev.added && !prev.removed ? prev.lines.slice(-DIFF_CONTEXT_LINES) : [];
      pending = {
        origStart: Math.max(1, origLine - context.length),
        newStart: Math.max(1, newLine - context.length),
        origCount: context.length,
        newCount: context.length,
        body: context.map(line => ` ${line}`),
      };
    }
    for (const line of part.lines) {
      if (part.added) {
        pending.body.push(`+${line}`);
        pending.newCount++;
        newLine++;
      } else {
        pending.body.push(`-${line}`);
        pending.origCount++;
        origLine++;
      }
    }
  }
  flush();
}

/**
 * Create a unique staging directory in the OS temp folder
 */
export const createStagingDirectory = async (): Promise<string> => {
  const tempDir = os.tmpdir();
  const stagingDir = path.join(tempDir, `cht-agent-staging-${Date.now()}`);

  await fs.promises.mkdir(stagingDir, { recursive: true });
  console.log(`📁 Staging directory created: ${stagingDir}`);

  return stagingDir;
};

/**
 * Write generated files to staging area
 */
export const writeToStaging = async (
  files: GeneratedFile[],
  stagingPath: string
): Promise<string[]> => {
  const writtenFiles: string[] = [];

  for (const file of files) {
    const fullPath = resolveWithin(stagingPath, file.relativePath);
    const dirPath = path.dirname(fullPath);

    // Ensure directory exists
    await fs.promises.mkdir(dirPath, { recursive: true });

    // Write file
    await fs.promises.writeFile(fullPath, file.content, 'utf-8');
    writtenFiles.push(file.relativePath);
  }

  return writtenFiles;
};

/**
 * Byte-copy one already-materialized file (e.g. a corrected .xlsx / regenerated
 * .xml from the mission-05 convert sandbox) INTO a staging or target tree at
 * `relativePath`. Uses fs.copyFile (binary-safe) instead of the utf-8
 * writeFile path, so binary artifacts survive — the GeneratedFile pipeline's
 * utf-8 assumption never touches them. Path-traversal guarded by resolveWithin.
 */
export const stageArtifact = async (
  srcPath: string,
  relativePath: string,
  destDir: string
): Promise<void> => {
  const fullPath = resolveWithin(destDir, relativePath);
  await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.promises.copyFile(srcPath, fullPath);
};

/**
 * Write generated files directly to cht-core
 */
export const writeToChtCore = async (
  files: GeneratedFile[],
  chtCorePath: string
): Promise<string[]> => {
  const writtenFiles: string[] = [];

  for (const file of files) {
    const fullPath = resolveWithin(chtCorePath, file.relativePath);
    const dirPath = path.dirname(fullPath);

    // Ensure directory exists
    await fs.promises.mkdir(dirPath, { recursive: true });

    // Write file
    await fs.promises.writeFile(fullPath, file.content, 'utf-8');
    writtenFiles.push(file.relativePath);
  }

  return writtenFiles;
};

/**
 * Copy all files from staging to cht-core
 */
export const copyToTarget = async (
  stagingPath: string,
  chtCorePath: string
): Promise<string[]> => {
  const copiedFiles: string[] = [];

  const copyRecursive = async (
    srcDir: string,
    destDir: string,
    relativePath: string = ''
  ): Promise<void> => {
    const entries = await fs.promises.readdir(srcDir, { withFileTypes: true });

    for (const entry of entries) {
      const srcPath = path.join(srcDir, entry.name);
      const destPath = path.join(destDir, entry.name);
      const relPath = path.join(relativePath, entry.name);

      if (entry.isDirectory()) {
        await fs.promises.mkdir(destPath, { recursive: true });
        await copyRecursive(srcPath, destPath, relPath);
      } else {
        await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
        await fs.promises.copyFile(srcPath, destPath);
        copiedFiles.push(relPath);
      }
    }
  };

  await copyRecursive(stagingPath, chtCorePath);
  return copiedFiles;
};

/**
 * Remove a path (file or directory) from a staging tree before copyToTarget —
 * e.g. the mission-05 `.cht-agent` descriptor dir, which must never land in the
 * partner repo. Path-traversal guarded; a no-op when the path is absent.
 */
export const removeFromStaging = async (stagingPath: string, relativePath: string): Promise<void> => {
  const fullPath = resolveWithin(stagingPath, relativePath);
  await fs.promises.rm(fullPath, { recursive: true, force: true });
};

/**
 * Clear staging directory (rollback)
 */
export const clearStaging = async (stagingPath: string): Promise<void> => {
  try {
    await fs.promises.rm(stagingPath, { recursive: true, force: true });
    console.log(`🗑️  Staging directory cleared: ${stagingPath}`);
  } catch (error) {
    // Ignore errors if directory doesn't exist
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
};

/**
 * Generate diffs for all files in staging compared to cht-core
 */
export const generateDiffs = async (
  files: GeneratedFile[],
  stagingPath: string,
  chtCorePath: string
): Promise<FileDiff[]> => {
  const diffs: FileDiff[] = [];

  for (const file of files) {
    const stagingFilePath = resolveWithin(stagingPath, file.relativePath);
    const chtCoreFilePath = resolveWithin(chtCorePath, file.relativePath);

    const newContent = await readFileSafe(stagingFilePath);
    const originalContent = await readFileSafe(chtCoreFilePath);

    if (newContent === null) {
      continue; // Skip if staged file doesn't exist
    }

    const { diff, additions, deletions } = generateUnifiedDiff(
      originalContent,
      newContent,
      file.relativePath
    );

    diffs.push({
      relativePath: file.relativePath,
      action: originalContent === null ? 'create' : 'modify',
      additions,
      deletions,
      diff,
    });
  }

  return diffs;
};

/**
 * Display diffs in CLI with color coding
 */
export const displayDiffs = (diffs: FileDiff[]): void => {
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║                         FILE CHANGES                           ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');
  if (diffs.length === 0) {
    console.log('No changes to display.\n');
    return;
  }
  displayDiffsSummary(diffs);
  for (const fileDiff of diffs) displayOneFileDiff(fileDiff);
};

function displayDiffsSummary(diffs: FileDiff[]): void {
  const creates = diffs.filter(d => d.action === 'create').length;
  const modifies = diffs.filter(d => d.action === 'modify').length;
  const totalAdditions = diffs.reduce((sum, d) => sum + d.additions, 0);
  const totalDeletions = diffs.reduce((sum, d) => sum + d.deletions, 0);
  console.log(`📊 Summary: ${creates} new files, ${modifies} modified files`);
  console.log(`   +${totalAdditions} additions, -${totalDeletions} deletions\n`);
}

function displayOneFileDiff(fileDiff: FileDiff): void {
  const actionIcon = fileDiff.action === 'create' ? '🆕' : '📝';
  console.log(`${actionIcon} ${fileDiff.relativePath}`);
  console.log(`   +${fileDiff.additions} -${fileDiff.deletions}`);
  console.log('─'.repeat(70));
  const lines = fileDiff.diff.split('\n');
  for (const line of lines.slice(0, 50)) console.log(colorizeDiffLine(line));
  if (lines.length > 50) console.log(`\x1b[33m... ${lines.length - 50} more lines\x1b[0m`);
  console.log();
}

function colorizeDiffLine(line: string): string {
  if (line.startsWith('+') && !line.startsWith('+++')) return `\x1b[32m${line}\x1b[0m`;
  if (line.startsWith('-') && !line.startsWith('---')) return `\x1b[31m${line}\x1b[0m`;
  if (line.startsWith('@@')) return `\x1b[36m${line}\x1b[0m`;
  return line;
}

/**
 * Display summary of files written (for non-preview mode)
 */
export const displayFileSummary = (files: GeneratedFile[]): void => {
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║                      FILES GENERATED                           ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');
  if (files.length === 0) {
    console.log('No files generated.\n');
    return;
  }
  console.log(`📊 Total: ${files.length} files generated\n`);
  displayFileGroup('📦 Source Files', files.filter(f => f.type === 'source'), true);
  displayFileGroup('🧪 Test Files', files.filter(f => f.type === 'test'), true);
  displayFileGroup('⚙️  Config Files', files.filter(f => f.type === 'config'), false);
  displayFileGroup('📋 Fixture Files', files.filter(f => f.type === 'fixture'), false);
  displayFileGroup('📚 Documentation Files', files.filter(f => f.type === 'documentation'), false);
};

function displayFileGroup(label: string, files: GeneratedFile[], includeDescription: boolean): void {
  if (files.length === 0) return;
  console.log(`${label} (${files.length}):`);
  for (const f of files) printFileEntry(f, includeDescription);
  console.log();
}

function printFileEntry(f: GeneratedFile, includeDescription: boolean): void {
  const icon = f.action === 'create' ? '🆕' : '📝';
  console.log(`   ${icon} ${f.relativePath}`);
  if (includeDescription) console.log(`      ${f.description}`);
}

/**
 * Verify cht-core path exists and is a valid directory
 */
export const verifyChtCorePath = async (chtCorePath: string): Promise<boolean> => {
  try {
    const stats = await fs.promises.stat(chtCorePath);
    return stats.isDirectory();
  } catch {
    return false;
  }
};

/**
 * Read existing file from cht-core (for context/patterns)
 */
export const readFromChtCore = async (
  relativePath: string,
  chtCorePath: string
): Promise<string | null> => {
  let fullPath: string;
  try {
    fullPath = resolveWithin(chtCorePath, relativePath);
  } catch {
    // A path that escapes cht-core is "not readable" — honor this helper's
    // null-on-any-problem contract rather than throwing at read sites.
    return null;
  }
  return readFileSafe(fullPath);
};

/**
 * List files in a directory within cht-core
 */
export const listChtCoreDirectory = async (
  relativePath: string,
  chtCorePath: string
): Promise<string[]> => {
  try {
    const fullPath = resolveWithin(chtCorePath, relativePath);
    const entries = await fs.promises.readdir(fullPath, { withFileTypes: true });
    return entries.map((entry) => {
      const entryPath = path.join(relativePath, entry.name);
      return entry.isDirectory() ? `${entryPath}/` : entryPath;
    });
  } catch {
    return [];
  }
};

/**
 * Check if a file exists in cht-core
 */
export const fileExistsInChtCore = async (
  relativePath: string,
  chtCorePath: string
): Promise<boolean> => {
  try {
    const fullPath = resolveWithin(chtCorePath, relativePath);
    await fs.promises.access(fullPath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
};
