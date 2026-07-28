/**
 * Workspace snapshot/capture/rollback helpers for the claude-code-cli module.
 *
 * The CLI edits cht-core in place via its native tools. To preserve the existing
 * HC2 preview-mode contract, we:
 *
 *   1. Snapshot HEAD + stash uncommitted work before running the CLI, and record
 *      the untracked files already present (the baseline).
 *   2. Let the CLI edit files in place.
 *   3. Capture the diff (`git diff --name-status preRunSha`) as GeneratedFile[],
 *      counting only untracked files absent from the baseline.
 *   4. Roll back via `git reset --hard preRunSha` + a clean scoped to the files
 *      this session created + restore stash.
 *
 * Steps 1/3/4 reason about a session DELTA, not absolute repo state (#140): a
 * blanket untracked sweep both misattributes the operator's files as generated
 * and deletes them on rollback (unrecoverable when they were ignored at stash
 * time, e.g. unmasked by stashing an uncommitted .gitignore edit).
 *
 * The captured GeneratedFile[] then flows through the existing staging path
 * (writeToStaging → HC2 preview → writeToChtCore). The user reviews the diff
 * at HC2 before anything sticks in cht-core.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { GeneratedFile } from '../../interface';
import { readEnv } from '../../../../utils/env';

const execFileAsync = promisify(execFile);

/** Marker prefix baked into our stash names so we can recognize our own leaks. */
const STASH_MARKER_PREFIX = 'cht-agent-claude-code-cli-';

export interface ChtCoreSnapshot {
  /** SHA of HEAD at the time of snapshot. Used for `git diff` capture and `git reset`. */
  headSha: string;
  /** Stash ref (e.g., `stash@{0}`) if uncommitted work was stashed; null if working tree was clean. */
  stashRef: string | null;
  /**
   * Marker name baked into `git stash push -m <name>` so we can identify our stash
   * by name later (more robust than `stash@{0}` when other stashes exist).
   */
  stashName: string | null;
  /**
   * Untracked paths present immediately AFTER the stash, i.e. the files that were
   * already in the operator's working tree and are NOT ours. Capture and rollback
   * both work against this baseline so the cycle reasons about a session DELTA
   * rather than absolute repo state (#140).
   *
   * Required, deliberately not optional: an absent baseline degrading to "clean
   * everything" would silently reintroduce the data loss this field exists to fix.
   */
  baselineUntracked: string[];
}

/**
 * Refuse to start when a previous run left one of our stashes behind (a hard
 * kill between snapshot and rollback strands the operator's work there). Taking
 * a second stash on top would bury it further, so stop and print the recovery
 * command. Set CHT_AGENT_IGNORE_LEAKED_STASH=true to proceed deliberately.
 */
async function assertNoLeakedStash(chtCorePath: string): Promise<void> {
  if (readEnv('CHT_AGENT_IGNORE_LEAKED_STASH') === 'true') return;
  const { stdout } = await execFileAsync(
    'git', ['stash', 'list', '--format=%gd %gs'], { cwd: chtCorePath }
  );
  const leaked = stdout.split('\n').filter(l => l.includes(STASH_MARKER_PREFIX));
  if (leaked.length === 0) return;
  const ref = leaked[0].split(' ')[0];
  throw new Error(
    `cht-core at ${chtCorePath} has a leftover cht-agent stash from an interrupted run: ` +
    `${leaked[0].trim()}. Your uncommitted work is inside it. Recover with: ` +
    `git -C ${chtCorePath} stash pop ${ref} ` +
    `(or re-run with CHT_AGENT_IGNORE_LEAKED_STASH=true to proceed and leave it in place).`
  );
}

/**
 * Warn when the work being stashed includes a `.gitignore` edit: stashing it
 * reverts ignore rules to HEAD for the duration of the session, so files ignored
 * only by that edit become visible. The baseline delta keeps this SAFE; the
 * warning is operator transparency.
 */
function warnOnIgnoreRuleEdits(statusLines: readonly string[], chtCorePath: string): void {
  const touchesIgnoreRules = statusLines.some(line => {
    const filePath = line.substring(3).trim();
    return filePath === '.gitignore' || filePath.endsWith('/.gitignore');
  });
  if (!touchesIgnoreRules) return;
  console.warn(
    `[claude-code-cli] Uncommitted .gitignore change in ${chtCorePath} will be stashed for this ` +
    `session, so ignore rules revert to HEAD and files ignored only by that edit become visible. ` +
    `They are recorded in the session baseline and will be left untouched.`
  );
}

/** Untracked, non-ignored paths in the working tree right now. */
async function listUntracked(chtCorePath: string): Promise<string[]> {
  const { stdout } = await execFileAsync(
    'git', ['ls-files', '--others', '--exclude-standard'], { cwd: chtCorePath }
  );
  return stdout.split('\n').filter(Boolean);
}

/**
 * Run a git operation; on a non-zero exit, ask the supplied inspector whether
 * the operation actually succeeded (some git commands warn-and-exit-nonzero
 * even when the side effect landed). If the inspector says "yes," log and
 * continue. If "no," re-throw the original error.
 *
 * Use only for ops whose effect is independently inspectable (stash push,
 * reset, clean, stash pop). Pure-read git calls do not need this.
 */
async function gitExecVerifyOrThrow(
  args: string[],
  cwd: string,
  verifyDidSucceed: () => Promise<boolean>,
  successLabel: string,
): Promise<void> {
  try {
    await execFileAsync('git', args, { cwd });
  } catch (err) {
    const succeeded = await verifyDidSucceed().catch(() => false);
    if (!succeeded) throw err;
    console.warn(
      `[claude-code-cli] git ${args.slice(0, 2).join(' ')} exited non-zero but ${successLabel}; continuing.`
    );
  }
}

/**
 * Capture the current cht-core state. Stashes any uncommitted work so that
 * (a) the CLI sees a clean workspace, and (b) we can restore the user's work
 * after rollback. Refuses to run if cht-core has unmerged paths or other state
 * that `git stash` cannot capture cleanly.
 */
export async function snapshotChtCore(chtCorePath: string): Promise<ChtCoreSnapshot> {
  // A leftover stash from an interrupted run holds the operator's work; stashing
  // on top of it would bury it deeper.
  await assertNoLeakedStash(chtCorePath);

  // Capture HEAD
  const { stdout: head } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: chtCorePath });
  const headSha = head.trim();

  // Refuse if there are unmerged paths (git stash would fail later).
  const { stdout: status } = await execFileAsync('git', ['status', '--porcelain'], { cwd: chtCorePath });
  const lines = status.split('\n').filter(Boolean);
  for (const line of lines) {
    // Unmerged paths show up as "UU", "AA", "DD", etc. in the first two columns.
    const code = line.substring(0, 2);
    if (code === 'UU' || code === 'AA' || code === 'DD' || code === 'AU' || code === 'UA' || code === 'DU' || code === 'UD') {
      throw new Error(
        `cht-core has unmerged paths at ${chtCorePath}; refuse to run claude-code-cli. ` +
        `Resolve conflicts and try again.`
      );
    }
  }

  // Stash uncommitted work (if any) so the CLI sees a clean workspace.
  let stashRef: string | null = null;
  let stashName: string | null = null;
  if (lines.length > 0) {
    warnOnIgnoreRuleEdits(lines, chtCorePath);
    const name = `${STASH_MARKER_PREFIX}${Date.now()}`;
    // `git stash push -u` can exit non-zero on file-removal warnings even when
    // the stash was successfully created (R14/R15). Verify by checking the
    // top-of-stack message for our unique marker before re-throwing.
    await gitExecVerifyOrThrow(
      ['stash', 'push', '-u', '-m', name],
      chtCorePath,
      async () => {
        const { stdout } = await execFileAsync(
          'git', ['stash', 'list', '-1', '--format=%gs'], { cwd: chtCorePath }
        );
        return stdout.includes(name);
      },
      `stash "${name}" was created`,
    );
    stashName = name;
    // Capture the top stash ref. `git stash list -1 --format=%gd` returns just the ref name.
    const { stdout: stashList } = await execFileAsync(
      'git', ['stash', 'list', '-1', '--format=%gd'], { cwd: chtCorePath }
    );
    stashRef = stashList.trim();
    // Print recovery up front: if the process is hard-killed before rollback,
    // this line is the operator's only pointer to their stashed work.
    console.log(
      `[claude-code-cli] Stashed your uncommitted work as "${name}" (${stashRef}). ` +
      `If this run is interrupted, recover with: git -C ${chtCorePath} stash pop ${stashRef}`
    );
  }

  // Record the untracked baseline AFTER the stash: stashing an uncommitted
  // .gitignore edit reverts ignore rules to HEAD, which can unmask files that
  // were ignored only by that edit. Reading here means those files land in the
  // baseline (they are the operator's, not ours), which is what makes the
  // capture/clean delta correct regardless of the ignore-rule churn. The read is
  // unconditional: the stash is conditional on a dirty tree, but unmasked or
  // pre-existing untracked files can exist either way.
  const baselineUntracked = await listUntracked(chtCorePath);

  return { headSha, stashRef, stashName, baselineUntracked };
}

/**
 * Capture every file the CLI modified during its run, packaged as GeneratedFile[].
 * MODIFY entries carry originalContent (the pre-run version from `git show`).
 * CREATE entries omit originalContent.
 *
 * Untracked files are attributed to the session only when they are NOT in
 * `baselineUntracked` (the post-stash snapshot of the operator's own untracked
 * files). Without that subtraction, pre-existing files are reported as
 * session-generated and an HC2 approve would write them back into cht-core (#140).
 */
export async function captureChtCoreDiff(
  chtCorePath: string,
  preRunSha: string,
  baselineUntracked: readonly string[],
): Promise<GeneratedFile[]> {
  // git diff --name-status against the pre-run SHA picks up tracked changes (M, A, D, R, ...)
  // but NOT untracked files. For untracked CREATEs the CLI made, we also need ls-files --others.
  const { stdout: nameList } = await execFileAsync(
    'git', ['diff', '--name-status', preRunSha], { cwd: chtCorePath }
  );
  const untrackedNow = await listUntracked(chtCorePath);

  const files: GeneratedFile[] = [];
  await collectTrackedChanges(files, nameList, chtCorePath, preRunSha);
  await collectUntrackedCreates(files, untrackedNow, chtCorePath, preRunSha, new Set(baselineUntracked));
  return files;
}

async function collectTrackedChanges(
  files: GeneratedFile[],
  nameList: string,
  chtCorePath: string,
  preRunSha: string,
): Promise<void> {
  for (const line of nameList.split('\n').filter(Boolean)) {
    const entry = parseDiffStatusLine(line);
    if (!entry) continue;
    const file = await readChtCoreFile(chtCorePath, entry.relPath, preRunSha, entry.action);
    if (file) files.push(file);
  }
}

function parseDiffStatusLine(line: string): { relPath: string; action: 'create' | 'modify' } | null {
  const parts = line.split('\t');
  const status = parts[0]?.charAt(0);
  const relPath = parts.at(-1);
  if (!status || !relPath || status === 'D') return null;
  return { relPath, action: status === 'A' ? 'create' : 'modify' };
}

async function collectUntrackedCreates(
  files: GeneratedFile[],
  untrackedNow: readonly string[],
  chtCorePath: string,
  preRunSha: string,
  baseline: ReadonlySet<string>,
): Promise<void> {
  for (const relPath of untrackedNow) {
    if (baseline.has(relPath)) continue; // the operator's file, not ours
    const file = await readChtCoreFile(chtCorePath, relPath, preRunSha, 'create');
    if (file) files.push(file);
  }
}

async function readChtCoreFile(
  chtCorePath: string,
  relPath: string,
  preRunSha: string,
  action: 'create' | 'modify',
): Promise<GeneratedFile | null> {
  const fullPath = path.join(chtCorePath, relPath);
  let content: string;
  try {
    content = await fs.readFile(fullPath, 'utf-8');
  } catch {
    // File vanished mid-capture or is binary; skip.
    return null;
  }

  let originalContent: string | undefined;
  if (action === 'modify') {
    try {
      const { stdout } = await execFileAsync('git', ['show', `${preRunSha}:${relPath}`], { cwd: chtCorePath });
      originalContent = stdout;
    } catch {
      // Binary or other read failure; skip originalContent.
    }
  }

  return {
    path: relPath,
    content,
    purpose: action === 'create' ? 'CLI-created file' : 'CLI-modified file',
    originalContent,
  };
}

/** Max pathspec entries per `git clean` invocation, to stay clear of OS arg limits. */
const CLEAN_PATHSPEC_CHUNK = 1000;

/**
 * Wrap a path so git treats it as a LITERAL filename, not an fnmatch glob.
 *
 * Without this, a session file named `pages/[id].tsx` is a bracket-expression
 * pathspec that also matches the operator's `pages/d.tsx` — `git clean` deletes
 * both, exits 0, and the verifier (which only runs on a non-zero exit) never
 * notices. Same class for `*` and `?` in a filename. Every path we hand to git
 * for deletion comes from `ls-files` output, i.e. it is always a real filename.
 */
function toLiteralPathspec(relPath: string): string {
  return `:(literal)${relPath}`;
}

/**
 * Untracked paths that appeared DURING the session: everything untracked now
 * minus the operator's post-stash baseline. Only these may be deleted on
 * rollback — a blanket `git clean -fd` would also delete pre-existing untracked
 * files that the stash never captured, which is unrecoverable (#140 RC-3).
 */
async function computeCleanDelta(
  chtCorePath: string,
  baselineUntracked: readonly string[],
): Promise<string[]> {
  const baseline = new Set(baselineUntracked);
  const untrackedNow = await listUntracked(chtCorePath);
  return untrackedNow.filter(p => !baseline.has(p));
}

/** True when every delta path is gone from disk (what "removed" actually means). */
async function allPathsRemoved(chtCorePath: string, deltaPaths: readonly string[]): Promise<boolean> {
  for (const relPath of deltaPaths) {
    try {
      await fs.access(path.join(chtCorePath, relPath));
      return false; // still there
    } catch {
      // ENOENT: removed, keep checking the rest.
    }
  }
  return true;
}

/**
 * Per-op outcome of a rollback attempt. `reset` is fatal when failed; the
 * other two are warnings the orchestrator surfaces but does not abort on.
 */
export interface RollbackResult {
  reset: 'ok' | 'failed';
  clean: 'ok' | 'failed';
  stashPop: 'ok' | 'failed' | 'skipped';
  errors: string[];
}

/**
 * Delete only the untracked files this session created (delta against the
 * snapshot baseline), never the operator's pre-existing untracked files.
 *
 * An EMPTY pathspec is deliberately handled by skipping the clean entirely:
 * `git clean -fd --` with no paths degenerates to a blanket clean, which is the
 * exact data loss this function exists to prevent.
 */
async function cleanSessionCreatedFiles(
  chtCorePath: string,
  baselineUntracked: readonly string[],
): Promise<void> {
  const delta = await computeCleanDelta(chtCorePath, baselineUntracked);
  if (delta.length === 0) return; // nothing of ours to remove; never blanket-clean

  for (let i = 0; i < delta.length; i += CLEAN_PATHSPEC_CHUNK) {
    const chunk = delta.slice(i, i + CLEAN_PATHSPEC_CHUNK);
    await gitExecVerifyOrThrow(
      ['clean', '-fd', '--', ...chunk.map(toLiteralPathspec)],
      chtCorePath,
      // The tree is legitimately dirty after a rollback (the operator's own
      // untracked files survive by design), so "status is empty" is the wrong
      // check — it would misreport clean: 'failed' and print a spurious
      // ROLLBACK INCOMPLETE banner. Assert what removal actually means instead.
      () => allPathsRemoved(chtCorePath, chunk),
      'session-created files were removed',
    );
  }
}

/**
 * Always restore cht-core to the snapshot state: reset to HEAD, clean the files
 * this session created, pop the stash if one was created. Each op runs through
 * the verify-then-throw helper so a non-zero exit that actually succeeded does
 * not generate a misleading warning. Returns a typed result the orchestrator
 * inspects to emit a recovery checklist when reset failed.
 *
 * Residual (strictly better than the pre-#140 behavior, which deleted such files
 * outright): if the session OVERWRITES a pre-existing baseline-untracked file,
 * capture excludes it and rollback cannot restore its prior content, because it
 * was never in the stash.
 *
 * Edge: empty directories the session created are not listed by `ls-files`, so
 * an empty dir may remain after rollback. Accepted; harmless residue.
 */
export async function rollbackChtCore(
  chtCorePath: string,
  snapshot: ChtCoreSnapshot,
): Promise<RollbackResult> {
  const result: RollbackResult = { reset: 'ok', clean: 'ok', stashPop: 'skipped', errors: [] };

  try {
    await gitExecVerifyOrThrow(
      ['reset', '--hard', snapshot.headSha],
      chtCorePath,
      async () => {
        const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: chtCorePath });
        return stdout.trim() === snapshot.headSha;
      },
      `HEAD is at ${snapshot.headSha}`,
    );
  } catch (err) {
    result.reset = 'failed';
    result.errors.push(`reset: ${err}`);
    console.warn(`[claude-code-cli] git reset --hard during rollback failed: ${err}`);
  }

  try {
    await cleanSessionCreatedFiles(chtCorePath, snapshot.baselineUntracked);
  } catch (err) {
    result.clean = 'failed';
    result.errors.push(`clean: ${err}`);
    console.warn(`[claude-code-cli] git clean -fd during rollback failed: ${err}`);
  }

  if (snapshot.stashRef) {
    const stashName = snapshot.stashName;
    try {
      await gitExecVerifyOrThrow(
        ['stash', 'pop', snapshot.stashRef],
        chtCorePath,
        async () => {
          // Prefer the name-based check when we have one (robust against other
          // stashes shifting indices); otherwise fall back to the ref-based check.
          const { stdout } = await execFileAsync(
            'git', ['stash', 'list', '--format=%gs'], { cwd: chtCorePath }
          );
          if (stashName) return !stdout.includes(stashName);
          const { stdout: refList } = await execFileAsync(
            'git', ['stash', 'list', '--format=%gd'], { cwd: chtCorePath }
          );
          return !refList.split('\n').includes(snapshot.stashRef!);
        },
        `stash ${snapshot.stashRef} was popped`,
      );
      result.stashPop = 'ok';
    } catch (err) {
      result.stashPop = 'failed';
      result.errors.push(`stash pop ${snapshot.stashRef}: ${err}`);
      console.warn(
        `[claude-code-cli] git stash pop ${snapshot.stashRef} failed: ${err}. ` +
        `Your work is still in the stash; recover with: git -C ${chtCorePath} stash pop ${snapshot.stashRef}`
      );
    }
  }

  return result;
}

