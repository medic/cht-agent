/**
 * Staging Utilities
 *
 * Utilities for managing staged files before writing to cht-core.
 * Handles OS-appropriate temp directories, file operations, and diff generation.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { GeneratedFile, FileDiff } from '../types';

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

function appendModifiedFileDiff(
  diffLines: string[],
  originalLines: string[],
  newLines: string[],
): DiffResult {
  let additions = 0;
  let deletions = 0;
  const maxLines = Math.max(originalLines.length, newLines.length);
  let chunkStart = -1;
  let chunkLines: string[] = [];
  for (let i = 0; i < maxLines; i++) {
    const origLine = originalLines[i];
    const newLine = newLines[i];
    if (origLine !== newLine) {
      if (chunkStart === -1) chunkStart = i;
      if (origLine !== undefined) { chunkLines.push(`-${origLine}`); deletions++; }
      if (newLine !== undefined) { chunkLines.push(`+${newLine}`); additions++; }
    } else if (chunkStart !== -1) {
      diffLines.push(`@@ -${chunkStart + 1},${deletions} +${chunkStart + 1},${additions} @@`, ...chunkLines);
      chunkStart = -1;
      chunkLines = [];
    }
  }
  if (chunkLines.length > 0) {
    diffLines.push(`@@ -${chunkStart + 1},${deletions} +${chunkStart + 1},${additions} @@`, ...chunkLines);
  }
  return { diff: diffLines.join('\n'), additions, deletions };
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
    const fullPath = path.join(stagingPath, file.relativePath);
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
 * Write generated files directly to cht-core
 */
export const writeToChtCore = async (
  files: GeneratedFile[],
  chtCorePath: string
): Promise<string[]> => {
  const writtenFiles: string[] = [];

  for (const file of files) {
    const fullPath = path.join(chtCorePath, file.relativePath);
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
    const stagingFilePath = path.join(stagingPath, file.relativePath);
    const chtCoreFilePath = path.join(chtCorePath, file.relativePath);

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
  for (const f of files) {
    const icon = f.action === 'create' ? '🆕' : '📝';
    console.log(`   ${icon} ${f.relativePath}`);
    if (includeDescription) console.log(`      ${f.description}`);
  }
  console.log();
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
  const fullPath = path.join(chtCorePath, relativePath);
  return readFileSafe(fullPath);
};

/**
 * List files in a directory within cht-core
 */
export const listChtCoreDirectory = async (
  relativePath: string,
  chtCorePath: string
): Promise<string[]> => {
  const fullPath = path.join(chtCorePath, relativePath);

  try {
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
  const fullPath = path.join(chtCorePath, relativePath);
  try {
    await fs.promises.access(fullPath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
};
