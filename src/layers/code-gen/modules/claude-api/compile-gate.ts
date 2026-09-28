/**
 * Compile gate for the claude-api code-gen path.
 *
 * The claude-api module synthesizes files in memory, so it cannot use the
 * claude-code-cli path's in-place `tsc --noEmit` gate directly. This helper
 * gives it the same type-check: it materializes the generated files into a git
 * snapshot of cht-core, runs the shared compile validator, and always rolls
 * back. It degrades to a skip (never a hard error) when cht-core is not a usable
 * git workspace, so the module keeps its run-anywhere property. It halts the
 * run (a halt error) when the operator's tree needs attention: a snapshot
 * `stash`, `drift` or `reset` error, a rollback drift, or a failed reset or
 * restore. It skips only on a snapshot `precondition` refusal or a plain error.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { GeneratedFile } from '../../interface';
import { compileCheck, CompileValidationResult } from '../../../../agents/compile-validator';
import {
  snapshotChtCore,
  rollbackChtCore,
  settleRollback,
  reportSafetyError,
  ChtCoreSnapshot,
  WorkspaceSafetyError,
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
 * A pre-existing symlink AT the leaf is also followed by writeFileSync, even a
 * dangling one (which existsSync/realpathSync miss). lstat detects it either way.
 */
function leafSymlinkReason(full: string, filePath: string): string | null {
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
  return leafSymlinkReason(full, filePath);
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
 * A failed snapshot leaves nothing for the gate to roll back. A `precondition`
 * refusal (nothing was changed) prints all its lines, which hold the way out,
 * and skips the compile gate; a plain error only skips it. A `stash`, `drift`
 * or `reset` stop halts the run, because the operator's tree needs attention:
 * the undo may have kept the stash, and its lines say how to recover.
 */
function snapshotFailure(err: unknown): CompileValidationResult {
  if (!(err instanceof WorkspaceSafetyError)) {
    console.warn(`${LOG} Compile gate skipped: snapshot failed: ${msg(err)}`);
    return skipped(`snapshot failed: ${msg(err)}`);
  }
  reportSafetyError(err, LOG);
  if (err.kind !== 'precondition') throw err;
  console.warn(`${LOG} Compile gate skipped (see the lines above).`);
  return skipped(`snapshot failed: ${err.message}`);
}

/**
 * Roll back after the compile check; a failure prints its checklist once, then
 * throws. Returns the non-fatal rollback warnings.
 */
async function rollBackGate(chtCorePath: string, snapshot: ChtCoreSnapshot): Promise<string[]> {
  try {
    const rollback = await rollbackChtCore(chtCorePath, snapshot);
    return settleRollback(rollback, { logPrefix: LOG, label: 'claude-api compile gate', chtCorePath, snapshot });
  } catch (err) {
    reportSafetyError(err, LOG);
    throw err;
  }
}

/**
 * Type-check the claude-api module's in-memory files. Materializes them into a
 * git snapshot of cht-core behind a path-traversal guard, runs the shared
 * compile validator, and always rolls back. Returns a CompileValidationResult:
 * the compile issues fold into the module output's crossFileIssues, and a skip
 * sets compileGateSkipped / compileGateSkipReason. Throws a halt error on a
 * snapshot `stash`/`drift`/`reset` error, on a rollback drift, and on a failed
 * reset or restore.
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
    return snapshotFailure(err);
  }

  const result = await compileMaterialized(chtCorePath, files);

  // Always roll back (plain sequential call, no throw-from-finally). A rollback
  // drift, or a failed reset or restore, throws from here.
  return withWarnings(result, await rollBackGate(chtCorePath, snapshot));
}

/** Write the in-bounds files and type-check them; any failure here degrades to a skip. */
async function compileMaterialized(
  chtCorePath: string,
  files: ReadonlyArray<GeneratedFile>,
): Promise<CompileValidationResult> {
  try {
    const written = materializeGuarded(chtCorePath, files);
    return written.length === 0
      ? skipped('no in-bounds files to type-check')
      : await runCompileDefensive(chtCorePath);
  } catch (err) {
    return skipped(`materialization failed: ${msg(err)}`);
  }
}

function withWarnings(result: CompileValidationResult, warnings: string[]): CompileValidationResult {
  return warnings.length > 0 ? { ...result, warnings } : result;
}
