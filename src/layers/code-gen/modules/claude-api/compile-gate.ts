/**
 * Compile gate for the claude-api code-gen path.
 *
 * The claude-api module synthesizes files in memory, so it cannot use the
 * claude-code-cli path's in-place `tsc --noEmit` gate directly. This helper
 * gives it the same type-check: it materializes the generated files into a git
 * snapshot of cht-core, runs the shared compile validator, and always rolls
 * back. It degrades to a skip (never a hard error) when cht-core is not a usable
 * git workspace, so the module keeps its run-anywhere property. Only a failed
 * hard reset during rollback throws (cht-core left dirty; the run must halt).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { GeneratedFile } from '../../interface';
import { compileCheck, CompileValidationResult } from '../../../../agents/compile-validator';
import {
  snapshotChtCore,
  rollbackChtCore,
  ChtCoreSnapshot,
  RollbackResult,
} from '../claude-code-cli/workspace';

const LOG = '[claude-api compile-gate]';

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function skipped(reason: string): CompileValidationResult {
  return { passed: true, issues: [], skipped: true, skipReason: reason };
}

/** Real path of the nearest existing ancestor of `target` (target itself if it exists). */
function nearestExistingRealPath(target: string): string {
  let current = target;
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return fs.realpathSync(current);
}

/** The cht-core root, precomputed in both lexical and realpath forms. */
interface ChtCoreRoots {
  root: string;
  rootPrefix: string;
  realRoot: string;
  realRootPrefix: string;
}

/**
 * The symlink-escape half of the guard, split out to keep pathSafetyReason's
 * cognitive complexity low. `full` is the already-resolved absolute target.
 */
function symlinkEscapeReason(full: string, filePath: string, roots: ChtCoreRoots): string | null {
  // A symlinked ancestor directory pointing outside cht-core defeats the lexical
  // check, because writeFileSync follows symlinks.
  const realAncestor = nearestExistingRealPath(path.dirname(full));
  if (realAncestor !== roots.realRoot && !realAncestor.startsWith(roots.realRootPrefix)) {
    return `path escapes cht-core via a symlinked directory: ${filePath}`;
  }
  // A pre-existing symlink AT the leaf is also followed by writeFileSync, even a
  // dangling one (which existsSync/realpathSync miss). lstat detects it either way.
  try {
    if (fs.lstatSync(full).isSymbolicLink()) {
      return `path is a pre-existing symlink (would write outside cht-core): ${filePath}`;
    }
  } catch (err) {
    // ENOENT: the leaf does not exist yet, which is the normal create case.
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      return `path could not be lstat-checked: ${filePath} (${msg(err)})`;
    }
  }
  return null;
}

/**
 * Reason a file.path is unsafe to materialize, or null if it is safe to write.
 * `file.path` comes straight from LLM plan output and is written to disk WITHOUT
 * HC2 approval (the only upstream scope check, validateAgainstManifest, is
 * log-only), and is prompt-injection-reachable via untrusted doc context, so it
 * is fully untrusted. Kept as a self-contained function so it can later be lifted
 * to the shared write boundary.
 */
function pathSafetyReason(roots: ChtCoreRoots, filePath: string): string | null {
  if (path.isAbsolute(filePath)) {
    return `absolute file path (outside cht-core): ${filePath}`;
  }
  const full = path.resolve(roots.root, filePath);
  if (full === roots.root || !full.startsWith(roots.rootPrefix)) {
    return `out-of-bounds file path (path traversal): ${filePath}`;
  }
  // A path inside .git survives `git reset --hard` + `git clean -fd`, so it would
  // outlive the gate's rollback and can corrupt cht-core (e.g. overwrite .git/config).
  if (path.relative(roots.root, full).split(path.sep).includes('.git')) {
    return `path inside a .git directory (would survive rollback): ${filePath}`;
  }
  return symlinkEscapeReason(full, filePath, roots);
}

/**
 * Write the generated files into chtCorePath, skipping any path that fails the
 * safety guard (pathSafetyReason). Returns the absolute paths actually written.
 */
function materializeGuarded(chtCorePath: string, files: ReadonlyArray<GeneratedFile>): string[] {
  const root = path.resolve(chtCorePath);
  const realRoot = fs.realpathSync(root);
  const roots: ChtCoreRoots = {
    root,
    rootPrefix: root + path.sep,
    realRoot,
    realRootPrefix: realRoot + path.sep,
  };
  const written: string[] = [];
  for (const file of files) {
    const reason = pathSafetyReason(roots, file.path);
    if (reason) {
      console.warn(`${LOG} Skipping unsafe file path: ${reason}`);
      continue;
    }
    const full = path.resolve(root, file.path);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, file.content, 'utf8');
    written.push(full);
  }
  return written;
}

/** Run the shared compile validator; any unexpected throw degrades to a skip. */
async function runCompileDefensive(chtCorePath: string): Promise<CompileValidationResult> {
  try {
    return await compileCheck(chtCorePath);
  } catch (err) {
    return skipped(`compile gate raised: ${msg(err)}`);
  }
}

/**
 * Act on the rollback result. Throws ONLY when the hard reset failed (cht-core
 * is left dirty and the run must halt); clean / stash-pop failures are logged
 * but not fatal. Mirrors the claude-code-cli rollback policy.
 */
function handleApiRollbackOutcome(
  rollback: RollbackResult,
  snapshot: ChtCoreSnapshot,
  chtCorePath: string,
): void {
  const anyFailed =
    rollback.reset === 'failed' || rollback.clean === 'failed' || rollback.stashPop === 'failed';
  if (!anyFailed) return;

  console.error(`${LOG} ROLLBACK INCOMPLETE; cht-core may be in an unexpected state:`);
  for (const e of rollback.errors) console.error(`${LOG}   - ${e}`);

  if (rollback.reset === 'failed') {
    emitRecoveryChecklist(snapshot, chtCorePath);
    throw new Error(
      `claude-api compile gate rollback failed: ${rollback.errors.join('; ')}. ` +
        'Inspect the cht-core working tree before retrying.',
    );
  }
}

/** Log a manual-recovery checklist when rollback left cht-core dirty. */
function emitRecoveryChecklist(snapshot: ChtCoreSnapshot, chtCorePath: string): void {
  const lines: string[] = [
    '',
    `${LOG} To recover manually:`,
    `${LOG}   1. cd ${chtCorePath}`,
    `${LOG}   2. git status`,
    `${LOG}   3. git diff`,
    `${LOG}   4. git reset --hard ${snapshot.headSha}   # DESTRUCTIVE; discards working-tree changes`,
    `${LOG}   5. git stash list`,
  ];
  if (snapshot.stashRef) {
    lines.push(`${LOG}   6. git stash pop ${snapshot.stashRef}   # restore stashed pre-run state`);
  }
  lines.push(`${LOG}   7. Re-run only after the working tree is clean.`);
  for (const line of lines) console.error(line);
}

/**
 * Type-check the claude-api module's in-memory files. Materializes them into a
 * git snapshot of cht-core behind a path-traversal guard, runs the shared
 * compile validator, and always rolls back. Returns a CompileValidationResult:
 * the compile issues fold into the module output's crossFileIssues, and a skip
 * sets compileGateSkipped / compileGateSkipReason. Throws only on a failed hard
 * reset during rollback.
 */
export async function runApiCompileGate(
  chtCorePath: string,
  files: ReadonlyArray<GeneratedFile>,
): Promise<CompileValidationResult> {
  // Nothing to type-check: no disk touch, and not a "skip" (avoids a misleading banner).
  if (files.length === 0) {
    return { passed: true, issues: [] };
  }
  // Cheap, synchronous, spawns nothing: keeps the gate a no-op in non-git workspaces.
  if (!chtCorePath || !fs.existsSync(path.join(chtCorePath, '.git'))) {
    return skipped('cht-core is not a git repo; compile gate needs snapshot/rollback');
  }

  let snapshot: ChtCoreSnapshot;
  try {
    snapshot = await snapshotChtCore(chtCorePath);
  } catch (err) {
    // snapshotChtCore throws on unmerged paths / git failures; nothing staged, so no rollback.
    return skipped(`snapshot failed: ${msg(err)}`);
  }

  let result: CompileValidationResult;
  try {
    const written = materializeGuarded(chtCorePath, files);
    result =
      written.length === 0
        ? skipped('no in-bounds files to type-check')
        : await runCompileDefensive(chtCorePath);
  } catch (err) {
    result = skipped(`materialization failed: ${msg(err)}`);
  }

  // Always roll back (plain sequential call, no throw-from-finally). Only a
  // failed hard reset throws, via handleApiRollbackOutcome.
  const rollback = await rollbackChtCore(chtCorePath, snapshot);
  handleApiRollbackOutcome(rollback, snapshot, chtCorePath);
  return result;
}
