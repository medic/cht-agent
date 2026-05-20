/**
 * Workspace snapshot/capture/rollback helpers for the claude-code-cli module.
 *
 * The CLI edits cht-core in place via its native tools. To preserve the existing
 * HC2 preview-mode contract, we:
 *
 *   1. Snapshot HEAD + stash uncommitted work before running the CLI.
 *   2. Let the CLI edit files in place.
 *   3. Capture the diff (`git diff --name-status preRunSha`) as GeneratedFile[].
 *   4. Roll back via `git reset --hard preRunSha` + `git clean -fd` + restore stash.
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

const execFileAsync = promisify(execFile);

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
    const name = `cht-agent-claude-code-cli-${Date.now()}`;
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
  }

  return { headSha, stashRef, stashName };
}

/**
 * Capture every file the CLI modified during its run, packaged as GeneratedFile[].
 * MODIFY entries carry originalContent (the pre-run version from `git show`).
 * CREATE entries omit originalContent.
 */
export async function captureChtCoreDiff(
  chtCorePath: string,
  preRunSha: string,
): Promise<GeneratedFile[]> {
  // git diff --name-status against the pre-run SHA picks up tracked changes (M, A, D, R, ...)
  // but NOT untracked files. For untracked CREATEs the CLI made, we also need ls-files --others.
  const { stdout: nameList } = await execFileAsync(
    'git', ['diff', '--name-status', preRunSha], { cwd: chtCorePath }
  );
  const { stdout: untrackedList } = await execFileAsync(
    'git', ['ls-files', '--others', '--exclude-standard'], { cwd: chtCorePath }
  );

  const files: GeneratedFile[] = [];
  await collectTrackedChanges(files, nameList, chtCorePath, preRunSha);
  await collectUntrackedCreates(files, untrackedList, chtCorePath, preRunSha);
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
  const relPath = parts[parts.length - 1];
  if (!status || !relPath || status === 'D') return null;
  return { relPath, action: status === 'A' ? 'create' : 'modify' };
}

async function collectUntrackedCreates(
  files: GeneratedFile[],
  untrackedList: string,
  chtCorePath: string,
  preRunSha: string,
): Promise<void> {
  for (const relPath of untrackedList.split('\n').filter(Boolean)) {
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
 * Always restore cht-core to the snapshot state: reset to HEAD, clean untracked,
 * pop the stash if one was created. Each op runs through the verify-then-throw
 * helper so a non-zero exit that actually succeeded does not generate a
 * misleading warning. Returns a typed result the orchestrator inspects to emit
 * a recovery checklist when reset failed.
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
    await gitExecVerifyOrThrow(
      ['clean', '-fd'],
      chtCorePath,
      async () => {
        const { stdout } = await execFileAsync('git', ['status', '--porcelain'], { cwd: chtCorePath });
        return stdout.trim() === '';
      },
      'working tree is clean',
    );
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

