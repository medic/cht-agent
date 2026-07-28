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

/**
 * A `%gd %gs` stash-list line whose MESSAGE ends with our marker plus the
 * timestamp we generate. Anchored so a user stash that merely mentions the
 * marker in prose does not read as one of ours. Linear, no backtracking.
 */
const LEAKED_STASH_LINE = /:\s*cht-agent-claude-code-cli-\d+\s*$/;

/** Env flag read, tolerant of casing and stray whitespace. */
function isFlagEnabled(name: string): boolean {
  return readEnv(name)?.trim().toLowerCase() === 'true';
}

/**
 * Recovery guidance for stashed work. Deliberately a LOOKUP, not `stash pop
 * <name>`: a stash name is not a valid git reference, and a `stash@{N}` ref goes
 * stale the moment anything else is stashed. The durable identifier is the
 * marker in the message, so tell the operator how to resolve the ref at recovery
 * time rather than baking in one that may have shifted.
 */
function recoveryHint(chtCorePath: string, stashName?: string): string {
  const marker = stashName ?? STASH_MARKER_PREFIX;
  return (
    `Recover by locating the stash and popping the ref it reports: ` +
    `git -C ${chtCorePath} stash list | grep ${marker}   then   ` +
    `git -C ${chtCorePath} stash pop <the stash@{N} shown>`
  );
}

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
  if (isFlagEnabled('CHT_AGENT_IGNORE_LEAKED_STASH')) return;
  const { stdout } = await execFileAsync(
    'git', ['stash', 'list', '--format=%gd %gs'], { cwd: chtCorePath }
  );
  // Anchored: our stash message always ENDS with the marker plus a timestamp, so a
  // user stash that merely mentions the marker ("wip after cht-agent-claude-code-cli
  // crash") is not a false positive. Report every match, not just the first — a real
  // leak can sit underneath a user stash, and naming the wrong one sends the
  // operator to the wrong place.
  const leaked = stdout.split('\n').filter(l => LEAKED_STASH_LINE.test(l));
  if (leaked.length === 0) return;
  const listed = leaked.map(l => l.trim()).join('; ');
  throw new Error(
    `cht-core at ${chtCorePath} has ${leaked.length} leftover cht-agent stash(es) from an ` +
    `interrupted run: ${listed}. Your uncommitted work is inside. ${recoveryHint(chtCorePath)} ` +
    `(or re-run with CHT_AGENT_IGNORE_LEAKED_STASH=true to proceed and leave it in place).`
  );
}

/**
 * Paths named by a `status --porcelain` line. Handles both the rename form
 * (`R  old -> new`, either side may be the ignore file) and C-quoted paths,
 * which git emits for anything non-ASCII (`"caf\303\251/.gitignore"`).
 */
function pathsFromStatusLine(line: string): string[] {
  const unquote = (p: string) => (p.startsWith('"') && p.endsWith('"') ? p.slice(1, -1) : p);
  const body = line.substring(3).trim();
  return body.split(' -> ').map(part => unquote(part.trim()));
}

/**
 * Warn when the work being stashed includes a `.gitignore` edit: stashing it
 * reverts ignore rules to HEAD for the duration of the session, so files ignored
 * only by that edit become visible. cht-agent's own capture and clean stay safe
 * (the baseline delta covers them), but the CLI itself is not constrained by the
 * baseline, so the warning must not promise the files are untouchable.
 */
function warnOnIgnoreRuleEdits(statusLines: readonly string[], chtCorePath: string): void {
  const touchesIgnoreRules = statusLines.some(line =>
    pathsFromStatusLine(line).some(p => p === '.gitignore' || p.endsWith('/.gitignore'))
  );
  if (!touchesIgnoreRules) return;
  console.warn(
    `[claude-code-cli] Uncommitted .gitignore change in ${chtCorePath} will be stashed for this ` +
    `session, so ignore rules revert to HEAD and files ignored only by that edit become visible. ` +
    `cht-agent records them in the session baseline and will not capture or delete them, but the ` +
    `CLI can still read, overwrite, or delete them while it runs, and such edits cannot be undone ` +
    `by rollback. Commit or move anything you cannot afford to lose before starting.`
  );
}

/**
 * Untracked, non-ignored paths in the working tree right now.
 *
 * `-z` is mandatory, not cosmetic. Git's default `core.quotePath=true` C-quotes
 * any non-ASCII path (`"caf\303\251.txt"`), which would silently drop the file
 * from capture and make the clean match nothing while still reporting success.
 * `core.quotePath=false` is not sufficient either: a newline in a filename would
 * then break line splitting into bogus paths. NUL delimiting is the only form
 * that survives every legal filename.
 */
async function listUntracked(chtCorePath: string): Promise<string[]> {
  const { stdout } = await execFileAsync(
    'git', ['ls-files', '--others', '--exclude-standard', '-z'], { cwd: chtCorePath }
  );
  return stdout.split('\0').filter(Boolean);
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
/** True when the git command exits zero. For predicate-style git calls. */
async function gitSucceeds(args: string[], cwd: string): Promise<boolean> {
  try {
    await execFileAsync('git', args, { cwd });
    return true;
  } catch {
    return false;
  }
}

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

/** Unmerged paths show up as "UU", "AA", "DD", etc. in the first two columns. */
const UNMERGED_CODES = new Set(['UU', 'AA', 'DD', 'AU', 'UA', 'DU', 'UD']);

function assertNoUnmergedPaths(statusLines: readonly string[], chtCorePath: string): void {
  if (!statusLines.some(line => UNMERGED_CODES.has(line.substring(0, 2)))) return;
  throw new Error(
    `cht-core has unmerged paths at ${chtCorePath}; refuse to run claude-code-cli. ` +
    `Resolve conflicts and try again.`
  );
}

/**
 * Stash the operator's uncommitted work under a marked name, returning the ref
 * only once OUR marker is confirmed on top of the stack.
 */
async function stashOperatorWork(
  chtCorePath: string,
  statusLines: readonly string[],
): Promise<{ stashRef: string | null; stashName: string | null }> {
  warnOnIgnoreRuleEdits(statusLines, chtCorePath);
  const name = `${STASH_MARKER_PREFIX}${Date.now()}`;
  const topMessageIsOurs = async () => {
    const { stdout } = await execFileAsync(
      'git', ['stash', 'list', '-1', '--format=%gs'], { cwd: chtCorePath }
    );
    return stdout.includes(name);
  };

  // `git stash push -u` can exit non-zero on file-removal warnings even when
  // the stash was successfully created (R14/R15). Verify by checking the
  // top-of-stack message for our unique marker before re-throwing.
  await gitExecVerifyOrThrow(
    ['stash', 'push', '-u', '-m', name],
    chtCorePath,
    topMessageIsOurs,
    `stash "${name}" was created`,
  );

  // Confirm our stash is on top before trusting the ref. The verify-or-throw
  // helper only inspects on a non-zero exit, but `stash push -u` can exit ZERO
  // having saved nothing; taking top-of-stack blindly would then hand rollback a
  // third-party stash to pop.
  if (!(await topMessageIsOurs())) {
    console.warn(
      `[claude-code-cli] git stash push reported success but "${name}" is not on top of the ` +
      `stash stack; treating the run as unstashed so rollback never pops someone else's stash.`
    );
    return { stashRef: null, stashName: null };
  }

  // `git stash list -1 --format=%gd` returns just the ref name.
  const { stdout: stashList } = await execFileAsync(
    'git', ['stash', 'list', '-1', '--format=%gd'], { cwd: chtCorePath }
  );
  const stashRef = stashList.trim();
  // Print recovery up front: if the process is hard-killed before rollback, this
  // line is the operator's only pointer to their stashed work. The name is
  // durable; the stash@{N} ref is not, so lead with the name.
  console.log(
    `[claude-code-cli] Stashed your uncommitted work as "${name}" (currently ${stashRef}). ` +
    `If this run is interrupted: ${recoveryHint(chtCorePath, name)}`
  );
  return { stashRef, stashName: name };
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
  assertNoUnmergedPaths(lines, chtCorePath);

  // Stash uncommitted work (if any) so the CLI sees a clean workspace.
  const { stashRef, stashName } = lines.length > 0
    ? await stashOperatorWork(chtCorePath, lines)
    : { stashRef: null, stashName: null };

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
 * Enforce the required-baseline contract at RUNTIME, not just in the type, for
 * every path that consumes it. An untyped caller (or a stale test literal)
 * passing undefined would make `new Set(undefined)` an empty set, which fails
 * silently in opposite but equally wrong directions: the clean would treat every
 * untracked file as session-created and delete it, while the capture would report
 * every operator file as a session CREATE into HC2. Fail loudly instead.
 *
 * `caller` and `consequence` are parameterized because the two call sites fail
 * differently; the "missing or not an array" phrasing is shared and asserted on.
 */
function assertBaseline(
  baselineUntracked: readonly string[],
  caller: string,
  consequence: string,
): void {
  if (Array.isArray(baselineUntracked)) return;
  throw new Error(
    `${caller}: snapshot.baselineUntracked is missing or not an array. ${consequence} ` +
    'Pass the ChtCoreSnapshot returned by snapshotChtCore.'
  );
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
  assertBaseline(
    baselineUntracked,
    'captureChtCoreDiff',
    'Refusing to capture, because an absent baseline would report every pre-existing untracked ' +
    'file as session-generated and offer it for approval into cht-core.',
  );
  // git diff --name-status against the pre-run SHA picks up tracked changes (M, A, D, R, ...)
  // but NOT untracked files. For untracked CREATEs the CLI made, we also need ls-files --others.
  // `-z` for the same reason as listUntracked: unquoted, NUL-delimited paths.
  const { stdout: nameList } = await execFileAsync(
    'git', ['diff', '--name-status', '-z', preRunSha], { cwd: chtCorePath }
  );
  const untrackedNow = await listUntracked(chtCorePath);

  return [
    ...await collectTrackedChanges(nameList, chtCorePath, preRunSha),
    ...await collectUntrackedCreates(untrackedNow, chtCorePath, preRunSha, new Set(baselineUntracked)),
  ];
}

async function collectTrackedChanges(
  nameList: string,
  chtCorePath: string,
  preRunSha: string,
): Promise<GeneratedFile[]> {
  const files: GeneratedFile[] = [];
  for (const entry of parseDiffNameStatusZ(nameList)) {
    const file = await readChtCoreFile(chtCorePath, entry.relPath, preRunSha, entry.action);
    if (file) files.push(file);
  }
  return files;
}

/**
 * Parse `git diff --name-status -z` output. Unlike the line/tab form, `-z` emits
 * a flat NUL-delimited token stream: `STATUS\0PATH\0` per entry, except renames
 * and copies (`R100`, `C75`) which emit `STATUS\0OLD\0NEW\0`. Consuming the extra
 * token is what keeps the parser in phase; a line-based split would treat the old
 * path as the next status and desynchronize the rest of the stream.
 */
interface DiffEntry { relPath: string; action: 'create' | 'modify' }

/**
 * Path tokens a `-z` status entry carries. Renames and copies emit OLD and NEW;
 * everything else emits one path.
 */
function pathTokenCount(code: string): number {
  return code === 'R' || code === 'C' ? 2 : 1;
}

/** The capture entry for one status/path pair, or null when it is not capturable. */
function diffEntryFor(code: string, relPath: string | undefined): DiffEntry | null {
  if (!relPath || code === 'D') return null;
  return { relPath, action: code === 'A' ? 'create' : 'modify' };
}

function parseDiffNameStatusZ(nameList: string): DiffEntry[] {
  // Empty tokens only ever come from the trailing NUL: git emits neither an
  // empty status nor an empty path, so dropping them cannot desynchronize the
  // status/path pairing.
  const tokens = nameList.split('\0').filter(Boolean);
  const entries: DiffEntry[] = [];
  let i = 0;
  while (i < tokens.length) {
    const code = tokens[i].charAt(0);
    // For R/C the NEW path is the one on disk now (matches the previous
    // `parts.at(-1)` semantics).
    const pathCount = pathTokenCount(code);
    const entry = diffEntryFor(code, tokens[i + pathCount]);
    i += pathCount + 1;
    if (entry) entries.push(entry);
  }
  return entries;
}

async function collectUntrackedCreates(
  untrackedNow: readonly string[],
  chtCorePath: string,
  preRunSha: string,
  baseline: ReadonlySet<string>,
): Promise<GeneratedFile[]> {
  const files: GeneratedFile[] = [];
  for (const relPath of untrackedNow) {
    if (baseline.has(relPath)) continue; // the operator's file, not ours
    const file = await readChtCoreFile(chtCorePath, relPath, preRunSha, 'create');
    if (file) files.push(file);
  }
  return files;
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
  assertBaseline(
    baselineUntracked,
    'rollbackChtCore',
    'Refusing to clean, because an absent baseline would delete every untracked file in the target repo.',
  );
  const baseline = new Set(baselineUntracked);
  const untrackedNow = await listUntracked(chtCorePath);
  return untrackedNow.filter(p => !baseline.has(p));
}

/**
 * True when every delta path is gone from disk (what "removed" actually means).
 *
 * Only ENOENT counts as removed: an EACCES/ENOTDIR/ELOOP failure means the clean
 * did NOT do its job and must be reported. `lstat`, not `access`, so a surviving
 * broken symlink is seen as still-present rather than followed to nowhere.
 */
async function allPathsRemoved(chtCorePath: string, deltaPaths: readonly string[]): Promise<boolean> {
  for (const relPath of deltaPaths) {
    if (!(await pathIsRemoved(path.join(chtCorePath, relPath)))) return false;
  }
  return true;
}

/** ENOENT means removed; anything still stat-able, or any other errno, does not. */
async function pathIsRemoved(fullPath: string): Promise<boolean> {
  try {
    await fs.lstat(fullPath);
    return false; // still there
  } catch (err) {
    return (err as NodeJS.ErrnoException)?.code === 'ENOENT';
  }
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
 * Delete the untracked files that APPEARED DURING the session (delta against the
 * snapshot baseline), never the operator's pre-existing untracked files.
 *
 * "Appeared during", not "created by the CLI": the delta is computed at rollback
 * time, so an untracked file written mid-run by the operator, an editor, or a
 * watcher is inside it and will be deleted. Narrowing that further would need
 * per-write attribution the CLI does not provide.
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

  // Keep going after a failing chunk: aborting would leave later chunks' session
  // files behind on top of whatever the failing chunk left. Report them together.
  const failures: string[] = [];
  for (let i = 0; i < delta.length; i += CLEAN_PATHSPEC_CHUNK) {
    const chunk = delta.slice(i, i + CLEAN_PATHSPEC_CHUNK);
    try {
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
    } catch (err) {
      failures.push(`paths ${i}-${i + chunk.length - 1}: ${err}`);
    }
  }
  if (failures.length > 0) throw new Error(failures.join('; '));
}

/**
 * Always restore cht-core to the snapshot state: reset to HEAD, clean the files
 * this session created, pop the stash if one was created. Each op runs through
 * the verify-then-throw helper so a non-zero exit that actually succeeded does
 * not generate a misleading warning. Returns a typed result the orchestrator
 * inspects to emit a recovery checklist when reset failed.
 *
 * Documented residuals. All are strictly better than the pre-#140 behavior,
 * which deleted every pre-existing untracked file outright:
 *
 *  - OVERWRITE: if the session overwrites a baseline-untracked file, capture
 *    excludes it and rollback cannot restore its prior content — it was never in
 *    the stash. The file survives, but with the session's content.
 *  - DELETE: if the session deletes a baseline-untracked file, it is gone for the
 *    same reason (never stashed, so nothing to restore from).
 *  - MID-RUN CREATES: untracked files that appear during the run are in the delta
 *    and get cleaned, whoever wrote them (see cleanSessionCreatedFiles).
 *  - EMPTY DIRS: directories the session created are not listed by `ls-files`, so
 *    an empty dir may remain after rollback. Harmless residue.
 *  - SESSION-AUTHORED IGNORE RULES (pre-existing, same on main): if the session
 *    creates or edits a `.gitignore` covering its own output, that output is
 *    invisible to `ls-files --others --exclude-standard`, so it is neither
 *    captured (absent from HC2) nor cleaned (left behind).
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
      // Verify RESTORATION, not HEAD identity. Comparing rev-parse HEAD to the
      // snapshot sha is tautological here (nothing in a session moves HEAD, the
      // CLI has no shell), so a genuinely failed reset — a stale index.lock, say —
      // used to verify as success while the session's edits stayed in the
      // operator's tree. `diff --quiet <sha> --` exits 0 only when tracked content
      // actually matches the snapshot; untracked files are invisible to it, which
      // is correct because the clean step owns those.
      () => gitSucceeds(['diff', '--quiet', snapshot.headSha, '--'], chtCorePath),
      `working tree matches ${snapshot.headSha}`,
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

