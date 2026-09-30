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
 * Steps 1/3/4 reason about a session DELTA, not absolute repo state: a
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
import { constants as fsConstants, Stats } from 'node:fs';
import * as path from 'node:path';
import { CodeGenHaltError, GeneratedFile } from '../../interface';

const execFileAsync = promisify(execFile);

/**
 * What a workspace safety stop means for the operator's tree:
 *  - precondition: the snapshot refused before it changed anything;
 *  - stash: a stash step failed or was incomplete;
 *  - drift: the repo changed under the session, so rollback did nothing;
 *  - reset: rollback could not reset the tree, so it left the stash in place.
 */
type WorkspaceSafetyKind = 'precondition' | 'stash' | 'drift' | 'reset';

/**
 * A stop that must end the run. `lines` are the operator instructions; the
 * caller prints them once with its own log prefix (see reportSafetyError).
 */
export class WorkspaceSafetyError extends CodeGenHaltError {
  readonly kind: WorkspaceSafetyKind;

  readonly lines: string[];

  constructor(
    kind: WorkspaceSafetyKind,
    message: string,
    options: { cause?: unknown; lines?: string[] } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'WorkspaceSafetyError';
    this.kind = kind;
    this.lines = options.lines ?? [];
  }
}

const reportedSafetyErrors = new WeakSet<WorkspaceSafetyError>();

/** Print a safety error's instructions once, however many layers see it. */
export function reportSafetyError(err: unknown, logPrefix: string): void {
  if (!(err instanceof WorkspaceSafetyError) || reportedSafetyErrors.has(err)) return;
  reportedSafetyErrors.add(err);
  for (const line of err.lines) console.error(`${logPrefix} ${line}`);
}

/**
 * One POSIX shell word. Paths printed inside copy-paste commands come from the
 * session (so from the LLM), and a bare `'` or `;` in one must not break out.
 */
function shellQuote(word: string): string {
  const escaped = word.replaceAll("'", String.raw`'\''`);
  return `'${escaped}'`;
}

/**
 * Output cap for every git call. Node's 1 MiB default truncates a large listing
 * or `git show` of a big file (precedent: TSC_MAX_BUFFER in compile-validator).
 */
const GIT_MAX_BUFFER = 64 * 1024 * 1024;

/**
 * Inherited env vars that point git at another repo, index, object store or
 * config (`git rev-parse --local-env-vars` on 2.55, plus GIT_INTERNAL_SUPER_PREFIX
 * from 2.39), or that change pathspec matching. GIT_LITERAL_PATHSPECS turns our
 * `:(literal)` clean into a silent no-op; GIT_ICASE_PATHSPECS makes it delete a
 * case variant of the session file.
 */
const STRIPPED_GIT_ENV = [
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_CONFIG',
  'GIT_CONFIG_PARAMETERS',
  'GIT_CONFIG_COUNT',
  'GIT_OBJECT_DIRECTORY',
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_IMPLICIT_WORK_TREE',
  'GIT_GRAFT_FILE',
  'GIT_INDEX_FILE',
  'GIT_NO_REPLACE_OBJECTS',
  'GIT_REPLACE_REF_BASE',
  'GIT_PREFIX',
  'GIT_SHALLOW_FILE',
  'GIT_COMMON_DIR',
  'GIT_INTERNAL_SUPER_PREFIX',
  'GIT_LITERAL_PATHSPECS',
  'GIT_GLOB_PATHSPECS',
  'GIT_NOGLOB_PATHSPECS',
  'GIT_ICASE_PATHSPECS',
];

/**
 * Config that stops a repo-local `core.fsmonitor` or hook from running a program
 * inside our git calls. One builder hardens every call, through the env, not
 * `-c`. Both forms reach the git programs that git runs. The env form keeps our
 * argv, so every node 'Command failed: git <argv>' message shows the command as
 * the operator would type it. The env form needs git 2.31 or later.
 */
const HARDENED_GIT_CONFIG: ReadonlyArray<readonly [string, string]> = [
  ['core.fsmonitor', 'false'],
  ['core.hooksPath', '/dev/null'],
];

/** Built per call, so a variable set after module load is still stripped. */
function gitChildEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, LC_ALL: 'C' };
  for (const name of STRIPPED_GIT_ENV) delete env[name];
  env.GIT_CONFIG_COUNT = String(HARDENED_GIT_CONFIG.length);
  HARDENED_GIT_CONFIG.forEach(([key, value], i) => {
    env[`GIT_CONFIG_KEY_${i}`] = key;
    env[`GIT_CONFIG_VALUE_${i}`] = value;
  });
  return env;
}

/** Every git call in this file goes through here. */
function runGit(args: readonly string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync('git', [...args], { cwd, env: gitChildEnv(), maxBuffer: GIT_MAX_BUFFER });
}

/**
 * git's own words for a failed call: stderr when there is any, otherwise the
 * error message without node's first "Command failed: <argv>" line. Never
 * `${err}`, which embeds the whole argv.
 */
function gitErrorText(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const stderr = String((err as { stderr?: unknown }).stderr ?? '').trim();
  if (stderr) return stderr;
  const lines = err.message.split('\n');
  if (lines[0].startsWith('Command failed:')) lines.shift();
  return lines.join('\n').trim() || err.message;
}

function isMaxBufferError(err: unknown): boolean {
  return (err as { code?: unknown } | null)?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER';
}

/**
 * A git read before `git stash push`: nothing has changed yet, so its failure
 * is a `precondition` refusal, never a plain error that a caller retries.
 * Never wrap a read that runs after the push; the undo rules apply there.
 */
async function readBeforeStash<T>(what: string, read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (err) {
    throw readRefusal(what, err);
  }
}

function readRefusal(what: string, err: unknown): WorkspaceSafetyError {
  const message = `cht-agent could not read ${what} (${gitErrorText(err)}); nothing was changed.`;
  return new WorkspaceSafetyError('precondition', message, { cause: err, lines: [message] });
}

/** The log prefix of the snapshot and rollback lines when the caller names none. */
const DEFAULT_LOG_PREFIX = '[claude-code-cli]';

/** What the operator chose at a stash failure point. */
export type StashChoice = 'handled' | 'retry' | 'abort';

/** A stash step that failed, as the screen shows it. The workspace helpers print its lines first. */
export interface StashFailure {
  step: 'push' | 'undo' | 'restore' | 'drop';
  lines: readonly string[];
  choices: readonly StashChoice[];
}

/** Asks the operator what to do at a stash failure point. Only a caller with a terminal passes one. */
export type StashFailureResolver = (failure: StashFailure) => Promise<StashChoice>;

/** How a caller of the snapshot and the rollback wants their lines printed, and what it accepts. */
export interface WorkspaceCallOptions {
  /** The prefix of every line that these calls print (default `[claude-code-cli]`). */
  logPrefix?: string;
  /**
   * Leftover cht-agent stashes that the operator chose to keep at the start of
   * the run. The leftover check skips them; this run never pops or drops them.
   */
  acceptedLeftoverShas?: readonly string[];
  /** Asks the operator at a stash failure point. Absent (no terminal): the failure stops the run, as before. */
  resolveStashFailure?: StashFailureResolver;
  /** Called with the SHA of an entry of ours that a drop left behind after the work was proven back. */
  onSpareStash?: (sha: string) => void;
}

/** Our own entry that a drop left behind after the work was proven back. */
interface SpareStash {
  sha: string;
  name: string;
}

/** One screen of a failure: its error (Abort throws it) and the lines that say why it shows again. */
interface FailureScreen {
  error: WorkspaceSafetyError;
  reason: readonly string[];
}

/** What a choice at a snapshot failure leads to: a new snapshot from the top, or a screen again. */
type SnapshotNext =
  | { rerun: true; spares: readonly SpareStash[] }
  | { rerun: false; screen: FailureScreen };

/** A stash failure that the operator can answer, keyed by the error that Abort throws. */
interface RegisteredFailure {
  step: StashFailure['step'];
  choices: readonly StashChoice[];
  trailer: string;
  next: (choice: 'handled' | 'retry') => Promise<SnapshotNext>;
  /** Checked before an Abort: the error to throw instead (HEAD moved), printed already; or null. */
  beforeAbort?: () => Promise<WorkspaceSafetyError | null>;
}

const registeredFailures = new WeakMap<WorkspaceSafetyError, RegisteredFailure>();

const operatorAborts = new WeakSet<WorkspaceSafetyError>();

/** True for a safety error that the operator chose Abort for: every caller stops the run on it. */
export function isOperatorAbort(err: unknown): boolean {
  return err instanceof WorkspaceSafetyError && operatorAborts.has(err);
}

const PUSH_CHOICES: readonly StashChoice[] = ['handled', 'retry', 'abort'];

const PUSH_TRAILER = 'Choose Retry after you fix the cause above, "I handled it myself" after you dealt with it ' +
  'another way, or Abort to stop the run.';

/**
 * Register the choices at a failed push. The tree is unchanged or already put
 * back there, so "I handled it myself" and Retry both run the snapshot again.
 * Headless callers never read the registration.
 */
function withPushChoices(error: WorkspaceSafetyError, spares: readonly SpareStash[] = []): WorkspaceSafetyError {
  registeredFailures.set(error, {
    step: 'push', choices: PUSH_CHOICES, trailer: PUSH_TRAILER, next: async () => ({ rerun: true, spares }),
  });
  return error;
}

/** At a failed undo, restore or drop, the steps above are the way out, and Retry runs the step again. */
const RESTORE_CHOICES: readonly StashChoice[] = ['handled', 'retry', 'abort'];

/** When HEAD moved, the reset step is gone from the screen, so the last sentence would not be true. */
const RESTORE_TRAILER_HEAD_MOVED = 'Choose Retry after you fix the cause above, "I handled it myself" after you ran ' +
  'the steps above, or Abort to stop the run.';

const RESTORE_TRAILER = `${RESTORE_TRAILER_HEAD_MOVED} The steps above still apply after Abort.`;

function rerun(spares: readonly SpareStash[] = []): SnapshotNext {
  return { rerun: true, spares };
}

function showAgain(error: WorkspaceSafetyError, reason: readonly string[] = []): SnapshotNext {
  return { rerun: false, screen: { error, reason } };
}

/** A proven spare copy of ours, when the drop kept our entry. */
function spareOf(stash: TakenStash, drop: DropOutcome): SpareStash[] {
  return drop === 'kept' ? [{ sha: stash.sha, name: stash.name }] : [];
}

/** Marker prefix baked into our stash names so we can recognize our own leaks. */
export const STASH_MARKER_PREFIX = 'cht-agent-claude-code-cli-';

/**
 * A stash message that ENDS with the marker plus the timestamp we generate.
 * Anchored so a user stash that merely mentions the marker in prose does not
 * read as one of ours. The prefix is escaped, so it always matches literally.
 */
export function buildLeakedStashLine(prefix: string): RegExp {
  const literal = prefix.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
  return new RegExp(String.raw`:\s*${literal}\d+\s*$`);
}

const LEAKED_STASH_LINE = buildLeakedStashLine(STASH_MARKER_PREFIX);

/** The start of the Find line; a screen without the steps cuts its lines there. */
const FIND_STEP = 'Find the stash: ';

/**
 * Recovery guidance for stashed work, as two commands that each run as copied.
 * Deliberately a LOOKUP by name, not `stash pop <name>`: a stash name is not a
 * valid git reference, and a `stash@{N}` ref goes stale the moment anything
 * else is stashed, so the restore resolves the ref when it runs. `--index`
 * keeps the operator's staged/unstaged split.
 */
function recoveryHintSteps(chtCorePath: string, stashName: string): string[] {
  const repo = shellQuote(chtCorePath);
  const pattern = shellQuote(`: ${stashName}$`);
  const notFound = shellQuote(`stash ${stashName} not found`);
  return [
    `${FIND_STEP}git -C ${repo} stash list --format='%gd  %cr  %gs' | grep -E ${pattern}`,
    `Restore it: ref=$(git -C ${repo} stash list --format='%gd %gs' | grep -E ${pattern} | cut -d' ' -f1); ` +
      `if [ -n "$ref" ]; then git -C ${repo} stash pop --index "$ref"; else echo ${notFound}; fi`,
  ];
}

const RESTORE_WITHOUT_INDEX_NOTE = 'If git says "conflicts in index", run the restore again without --index.';

function recoveryHintLines(chtCorePath: string, stashName: string): string[] {
  return [...recoveryHintSteps(chtCorePath, stashName), RESTORE_WITHOUT_INDEX_NOTE];
}

/** One `git stash list` entry. `sha` is the stash commit, the only stable identity. */
interface StashEntry {
  ref: string;
  sha: string;
  createdAt: number;
  message: string;
}

/**
 * The stash list as a flat NUL stream, four fields per entry, so a message that
 * holds a newline or a NUL-free oddity cannot shift the fields.
 */
async function listStashes(chtCorePath: string): Promise<StashEntry[]> {
  const { stdout } = await runGit(
    ['stash', 'list', '-z', '--format=%gd%x00%H%x00%ct%x00%gs'], chtCorePath,
  );
  const fields = stdout.split('\0');
  const entries: StashEntry[] = [];
  for (let i = 0; i + 3 < fields.length; i += 4) {
    entries.push({ ref: fields[i], sha: fields[i + 1], createdAt: Number(fields[i + 2]), message: fields[i + 3] });
  }
  return entries;
}

/** Our entry: its message ENDS with `: <name>` (a substring match would take a decoy). */
function findStashByName(entries: readonly StashEntry[], name: string): StashEntry | undefined {
  return entries.find(e => e.message.endsWith(`: ${name}`));
}

/** The marker name at the end of a leftover stash message. */
function leakedStashName(message: string): string {
  return message.slice(message.lastIndexOf(':') + 1).trim();
}

/** git output with only its trailing newline removed (paths may end in spaces). */
function stripNewline(stdout: string): string {
  return stdout.endsWith('\n') ? stdout.slice(0, -1) : stdout;
}

export interface ChtCoreSnapshot {
  /** SHA of HEAD at the time of snapshot. Used for `git diff` capture and `git reset`. */
  headSha: string;
  /** The branch HEAD pointed at (`refs/heads/...`), or null for a detached HEAD. */
  headRef: string | null;
  /** The repo toplevel this snapshot belongs to. Rollback refuses any other repo. */
  repoRoot: string;
  /**
   * Commit SHA of our stash if uncommitted work was stashed; null if the working
   * tree was clean. The SHA, unlike `stash@{N}`, cannot come to name another entry.
   */
  stashSha: string | null;
  /** Marker name baked into `git stash push -m <name>`; what the operator searches for. */
  stashName: string | null;
  /**
   * Untracked paths present immediately AFTER the stash, i.e. the files that were
   * already in the operator's working tree and are NOT ours.
   *
   * Entries include the paths that were IGNORED at snapshot time, so a session
   * that changes an ignore rule cannot turn an operator file into session output.
   * An entry that ends in `/` covers its whole subtree (see isOperatorPath).
   *
   * Required, deliberately not optional: an absent baseline degrading to "clean
   * everything" would silently reintroduce the data loss this field exists to fix.
   */
  baselineUntracked: string[];
  /**
   * The untracked files listed just before the push, set only when a stash was
   * taken. "I handled it myself" at a failed restore uses it to prove the work
   * is back before the stash is dropped. Without it, a failed restore stops
   * the run as before.
   */
  prePushUntracked?: string[];
}

/** A cht-agent stash that no run restored, as the leftover check lists it. */
export interface LeftoverStash {
  /** The marker name, which the Find and Restore commands look up. */
  name: string;
  /** The stash commit, the only stable identity (a `stash@{N}` ref shifts). */
  sha: string;
  /** Unix seconds (`%ct`). */
  createdAt: number;
  /** How long ago, for example "3 days ago". */
  age: string;
}

const AGE_UNITS: ReadonlyArray<readonly [seconds: number, unit: string]> = [
  [86400, 'day'], [3600, 'hour'], [60, 'minute'],
];

/** A coarse "how long ago", from `%ct` in JS: a new `stash list` argv would add a git call. */
function ageText(createdAt: number, nowMs: number): string {
  const seconds = Math.max(0, Math.floor(nowMs / 1000) - createdAt);
  const found = AGE_UNITS.find(([size]) => seconds >= size);
  if (!found) return 'less than a minute ago';
  const count = Math.floor(seconds / found[0]);
  return `${count} ${found[1]}${count === 1 ? '' : 's'} ago`;
}

/**
 * The leftover cht-agent stashes of this checkout, from one read of the stash
 * list. Anchored: our stash message always ENDS with the marker plus a
 * timestamp, so a user stash that merely mentions the marker ("wip after
 * cht-agent-claude-code-cli crash") is not one. Every match, not the first: a
 * real leftover can sit under a user stash. Throws a `precondition`
 * WorkspaceSafetyError when git cannot read the list.
 */
export async function listLeftoverStashes(chtCorePath: string): Promise<LeftoverStash[]> {
  const stashes = await readBeforeStash('the stash list', () => listStashes(chtCorePath));
  const now = Date.now();
  return stashes
    .filter(e => LEAKED_STASH_LINE.test(e.message))
    .map(e => ({ name: leakedStashName(e.message), sha: e.sha, createdAt: e.createdAt, age: ageText(e.createdAt, now) }));
}

/**
 * What the operator needs to decide about leftover stashes: each name with its
 * time and age, and the commands to find and restore each one. Each caller adds
 * its own action line. Not "from an interrupted run": the stash can belong to a
 * run that is still active on this checkout.
 */
export function leftoverStashLines(chtCorePath: string, entries: readonly LeftoverStash[]): string[] {
  const listed = entries.map(e => `${e.name} (created ${new Date(e.createdAt * 1000).toISOString()}, ${e.age})`);
  return [
    `cht-core at ${chtCorePath} has ${entries.length} leftover cht-agent stash(es) that no run ` +
      `restored: ${listed.join('; ')}. It may hold your uncommitted work, or belong to another ` +
      'cht-agent run that is still active here.',
    ...entries.flatMap(e => recoveryHintSteps(chtCorePath, e.name)),
    RESTORE_WITHOUT_INDEX_NOTE,
  ];
}

/**
 * Refuse to stash while a leftover cht-agent stash that the caller did not
 * accept is in the list (a hard kill between snapshot and rollback strands the
 * operator's work there, or another run is active here). Taking a second
 * stash on top would bury it further, so stop and print the recovery command.
 * The CLI edge decides what to accept (its start check); this never reads the env.
 */
async function assertNoLeakedStash(chtCorePath: string, accepted: readonly string[] = []): Promise<void> {
  const leaked = (await listLeftoverStashes(chtCorePath)).filter(e => !accepted.includes(e.sha));
  if (leaked.length === 0) return;
  const lines = [
    ...leftoverStashLines(chtCorePath, leaked),
    'Or run npm run dev:run or npm run full again: their start check lets you continue and leave the stash in place.',
  ];
  throw new WorkspaceSafetyError('precondition', lines[0], { lines });
}

/**
 * Paths named by a `status --porcelain` line. Handles both the rename form
 * (`R  old -> new`, either side may be the ignore file) and C-quoted paths,
 * which git emits for anything non-ASCII (`"caf\303\251/.gitignore"`). Only a
 * rename or copy has two paths; any other name may hold " -> " itself.
 */
function pathsFromStatusLine(line: string): string[] {
  const unquote = (p: string) => (p.startsWith('"') && p.endsWith('"') ? p.slice(1, -1) : p);
  const body = line.substring(3).trim();
  const parts = isRenameOrCopy(line[0], line[1]) ? body.split(' -> ') : [body];
  return parts.map(part => unquote(part.trim()));
}

/** A rename or copy in either status column; ` R` is an intent-to-add rename. */
function isRenameOrCopy(x: string, y: string): boolean {
  return 'RC'.includes(x) || 'RC'.includes(y);
}

/**
 * Warn when the work being stashed includes a `.gitignore` edit: stashing it
 * reverts ignore rules to HEAD for the duration of the session, so files ignored
 * only by that edit become visible. cht-agent's own capture and clean stay safe
 * (the baseline delta covers them), but the CLI itself is not constrained by the
 * baseline, so the warning must not promise the files are untouchable.
 */
function warnOnIgnoreRuleEdits(statusLines: readonly string[], chtCorePath: string, logPrefix: string): void {
  const touchesIgnoreRules = statusLines.some(line =>
    pathsFromStatusLine(line).some(p => p === '.gitignore' || p.endsWith('/.gitignore'))
  );
  if (!touchesIgnoreRules) return;
  console.warn(
    `${logPrefix} Uncommitted .gitignore change in ${chtCorePath} will be stashed for this ` +
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
 * git C-quotes control characters even with `core.quotePath=false`, so only
 * `-z` gives verbatim paths.
 */
async function listUntracked(chtCorePath: string): Promise<string[]> {
  const { stdout } = await runGit(['ls-files', '--others', '--exclude-standard', '-z'], chtCorePath);
  return stdout.split('\0').filter(Boolean);
}

/**
 * Ignored paths right now. `--directory` makes a wholly ignored dir one entry
 * (node_modules/ stays cheap). git also lists a dir that is NOT ignored itself
 * but holds only ignored content, next to that content; such a dir entry is
 * dropped, or as a prefix it would hide every new session file below it.
 */
async function listIgnored(chtCorePath: string): Promise<string[]> {
  const { stdout } = await runGit(
    ['ls-files', '--others', '--ignored', '--exclude-standard', '--directory', '-z'], chtCorePath,
  );
  const entries = stdout.split('\0').filter(Boolean);
  const ancestors = new Set(entries.flatMap(properAncestors));
  return entries.filter(e => !(e.endsWith('/') && ancestors.has(e)));
}

/** The dir prefixes above a path: `a/`, `a/b/` for `a/b/c` and for `a/b/c/`. */
function properAncestors(relPath: string): string[] {
  const prefixes: string[] = [];
  for (let i = relPath.indexOf('/'); i !== -1 && i < relPath.length - 1; i = relPath.indexOf('/', i + 1)) {
    prefixes.push(relPath.slice(0, i + 1));
  }
  return prefixes;
}

/**
 * True when the path, or a dir entry above it, is in the snapshot baseline.
 * Exact string compare, no case folding: git reports the names as they are.
 */
function isOperatorPath(relPath: string, baseline: ReadonlySet<string>): boolean {
  return baseline.has(relPath) || properAncestors(relPath).some(prefix => baseline.has(prefix));
}

/** True when the git command exits zero. For predicate-style git calls. */
async function gitSucceeds(args: string[], cwd: string): Promise<boolean> {
  try {
    await runGit(args, cwd);
    return true;
  } catch {
    return false;
  }
}

/**
 * Run a git operation; on a non-zero exit, ask the supplied inspector whether
 * the operation actually succeeded (some git commands warn-and-exit-nonzero
 * even when the side effect landed). If the inspector says "yes," log and
 * continue. If "no," re-throw the original error.
 *
 * Use only for an op whose effect is independently inspectable (the rollback
 * reset). Pure-read git calls do not need this.
 */
async function gitExecVerifyOrThrow(
  args: string[],
  cwd: string,
  verifyDidSucceed: () => Promise<boolean>,
  successLabel: string,
  logPrefix: string,
): Promise<void> {
  try {
    await runGit(args, cwd);
  } catch (err) {
    const succeeded = await verifyDidSucceed().catch(() => false);
    if (!succeeded) throw err;
    console.warn(
      `${logPrefix} git ${args.slice(0, 2).join(' ')} exited non-zero but ${successLabel}; continuing.`
    );
  }
}

/** Unmerged paths show up as "UU", "AA", "DD", etc. in the first two columns. */
const UNMERGED_CODES = new Set(['UU', 'AA', 'DD', 'AU', 'UA', 'DU', 'UD']);

function assertNoUnmergedPaths(statusLines: readonly string[], chtCorePath: string): void {
  if (!statusLines.some(line => UNMERGED_CODES.has(line.substring(0, 2)))) return;
  const message =
    `cht-core has unmerged paths at ${chtCorePath}; refuse to run cht-agent. ` +
    `Resolve conflicts and try again.`;
  throw new WorkspaceSafetyError('precondition', message, { lines: [message] });
}

/**
 * Refuse tracked files flagged `--assume-unchanged`: status does not show their
 * edits, so git stash does not save them, and the rollback reset overwrites
 * them. `ls-files -v` tags such an entry with a lowercase letter. Clearing the
 * flag makes the edit visible, and the stash then saves it. skip-worktree
 * entries (`S`) keep their edits through a cycle, so they stay allowed.
 */
async function assertNoAssumeUnchanged(chtCorePath: string): Promise<void> {
  const { stdout } = await readBeforeStash('the assume-unchanged flags', () => runGit(['ls-files', '-v', '-z'], chtCorePath));
  const flagged = stdout.split('\0').filter(isAssumeUnchangedEntry).map(entry => entry.slice(2));
  if (flagged.length === 0) return;
  const repo = shellQuote(chtCorePath);
  const lines = [
    'git stash cannot save edits to files marked assume-unchanged, so cht-agent did not stash anything. ' +
      'Nothing was changed.',
    ...flagged.map(p => `  - ${JSON.stringify(p)} is marked assume-unchanged. Clear the flag with: ` +
      `git -C ${repo} update-index --no-assume-unchanged -- ${shellQuote(p)}`),
    'Then run again.',
  ];
  throw new WorkspaceSafetyError('precondition', lines[0], { lines });
}

/** `<tag> <path>`, where a lowercase tag marks an assume-unchanged entry. */
function isAssumeUnchangedEntry(entry: string): boolean {
  return entry[1] === ' ' && /^[a-z]$/.test(entry[0]);
}

/** The HEAD a snapshot was taken on: its commit and its branch (null when detached). */
interface SnapshotHead {
  sha: string;
  ref: string | null;
}

/** Our stash, as the snapshot took it, plus the untracked listing from just before the push. */
interface TakenStash {
  sha: string;
  name: string;
  prePush: readonly string[];
}

/**
 * Stash the operator's uncommitted work under a marked name. Success means two
 * things, checked whatever the exit code: our entry is in the list, and the
 * push cleaned the tree. A push that saved nothing throws `stash` (the tree is
 * unchanged); a push that saved but did not clean is undone first, then throws.
 */
async function stashOperatorWork(
  chtCorePath: string,
  statusLines: readonly string[],
  head: SnapshotHead,
  logPrefix: string,
): Promise<TakenStash> {
  const prePush = await readBeforeStash('the untracked files', () => listUntracked(chtCorePath));
  await assertStashCanRoundTrip(chtCorePath, prePush);
  warnOnIgnoreRuleEdits(statusLines, chtCorePath, logPrefix);
  const name = `${STASH_MARKER_PREFIX}${Date.now()}`;
  // Exit codes lie both ways: non-zero on a removal warning after a complete
  // stash, zero with nothing saved (a dirty submodule) or a partial clean.
  const pushError = await runGit(['stash', 'push', '-u', '-m', name], chtCorePath)
    .then(() => undefined, (err: unknown) => err);
  const lookup = await lookUpPushedStash({ chtCorePath, name, prePush, head, logPrefix });
  if (!lookup.entry) throw await stashNotCreatedError(chtCorePath, pushError, prePush, lookup.readError);
  const stash: TakenStash = { sha: lookup.entry.sha, name, prePush };
  const leftovers = await leftoversOrUndo(chtCorePath, stash, head, lookup.readError, logPrefix);
  if (leftovers.length > 0) {
    const trigger = partialPushTrigger(pushError, leftovers, prePush);
    const drop = await undoStash(chtCorePath, stash, head, trigger, logPrefix);
    warnSpareCopy(drop, name, logPrefix);
    throw await partialStashError(chtCorePath, pushError, leftovers, prePush, spareOf(stash, drop));
  }

  // Print recovery up front: if the process is hard-killed before rollback, these
  // lines are the operator's only pointer to their stashed work.
  console.log(`${logPrefix} Stashed your uncommitted work as "${name}". If this run is interrupted:`);
  for (const line of recoveryHintLines(chtCorePath, name)) console.log(`${logPrefix}   ${line}`);
  return stash;
}

/**
 * Our entry after the push. A failed read of the list is tried once more; a
 * list that stays unreadable is a stop, because the work may be in the stash.
 */
async function lookUpPushedStash(push: PushAttempt): Promise<{ entry?: StashEntry; readError?: unknown }> {
  try {
    return { entry: findStashByName(await listStashes(push.chtCorePath), push.name) };
  } catch (firstError) {
    return lookUpPushedStashAgain(push, firstError);
  }
}

/** What the snapshot knows about its push, for a choice after it. */
interface PushAttempt {
  chtCorePath: string;
  name: string;
  prePush: readonly string[];
  head: SnapshotHead;
  logPrefix: string;
}

async function lookUpPushedStashAgain(
  push: PushAttempt,
  firstError: unknown,
): Promise<{ entry?: StashEntry; readError: unknown }> {
  const { chtCorePath, name } = push;
  try {
    return { entry: findStashByName(await listStashes(chtCorePath), name), readError: firstError };
  } catch (err) {
    const lines = [
      `git stash push ran, but cht-agent cannot read the stash list (${gitErrorText(err)}), so it cannot ` +
        `check the result. Your uncommitted work may be in stash ${name}.`,
      ...recoveryHintLines(chtCorePath, name),
    ];
    const error = new WorkspaceSafetyError('stash', lines[0], { lines, cause: err });
    registeredFailures.set(error, {
      step: 'push',
      choices: RESTORE_CHOICES,
      trailer: RESTORE_TRAILER,
      next: () => afterUnreadableList(push, error),
      beforeAbort: () => abortVariant(pushHint(push), error, push.logPrefix),
    });
    throw error;
  }
}

function pushHint(push: PushAttempt): StashHint {
  return { chtCorePath: push.chtCorePath, head: push.head, hintPath: push.chtCorePath, stashName: push.name };
}

/**
 * "I handled it myself" or Retry after the stash list could not be read: read
 * it again. Our entry listed: put the work back from it, then the snapshot runs
 * again. Not listed: nothing of ours holds the work, so the snapshot runs again.
 * HEAD moved: write nothing, and show where the work is.
 */
async function afterUnreadableList(push: PushAttempt, error: WorkspaceSafetyError): Promise<SnapshotNext> {
  let entry: StashEntry | undefined;
  try {
    entry = findStashByName(await listStashes(push.chtCorePath), push.name);
  } catch (err) {
    return showAgain(error, [`cht-agent still cannot read the stash list (${gitErrorText(err)}).`]);
  }
  if (!entry) return rerun();
  const variant = await headMovedVariant(pushHint(push), error);
  if (variant) return showAgain(withMovedPushChoices(push, variant, error));
  const text = 'the stash list could not be read after the push';
  return undoThenRerun({
    chtCorePath: push.chtCorePath,
    stash: { sha: entry.sha, name: push.name, prePush: push.prePush },
    head: push.head,
    trigger: { summary: `git stash push ran, but ${text}.`, gitText: text, pathsInPlay: push.prePush },
    logPrefix: push.logPrefix,
  });
}

/** The variant keeps the base error, so the next choice starts from the base, and it needs no variant before an Abort. */
function withMovedPushChoices(push: PushAttempt, variant: WorkspaceSafetyError, base: WorkspaceSafetyError): WorkspaceSafetyError {
  registeredFailures.set(variant, {
    step: 'push', choices: RESTORE_CHOICES, trailer: RESTORE_TRAILER_HEAD_MOVED, next: () => afterUnreadableList(push, base),
  });
  return variant;
}

/** Put the work back from our entry; a failed undo shows its own screen. */
async function undoThenRerun(ctx: UndoContext): Promise<SnapshotNext> {
  let drop: DropOutcome;
  try {
    drop = await undoStash(ctx.chtCorePath, ctx.stash, ctx.head, ctx.trigger, ctx.logPrefix);
  } catch (err) {
    return showAgain(registeredError(err));
  }
  warnSpareCopy(drop, ctx.stash.name, ctx.logPrefix);
  return rerun(spareOf(ctx.stash, drop));
}

/**
 * The post-push leftovers. When a read after the push failed (this one, or the
 * stash list read before it), the work goes back into the tree and the
 * snapshot stops: an error must never leave the work only in our stash.
 */
async function leftoversOrUndo(
  chtCorePath: string,
  stash: TakenStash,
  head: SnapshotHead,
  earlierReadError: unknown,
  logPrefix: string,
): Promise<string[]> {
  let leftovers: string[];
  try {
    leftovers = await stashLeftovers(chtCorePath, stash.prePush);
  } catch (err) {
    return undoAfterReadFailure(chtCorePath, stash, head, err, logPrefix);
  }
  if (earlierReadError !== undefined) {
    return undoAfterReadFailure(chtCorePath, stash, head, earlierReadError, logPrefix);
  }
  return leftovers;
}

/**
 * Put the work back after a failed read, then stop. "Nothing was changed" only
 * when our entry is gone; a spare entry left behind blocks the next run.
 */
async function undoAfterReadFailure(
  chtCorePath: string,
  stash: TakenStash,
  head: SnapshotHead,
  err: unknown,
  logPrefix: string,
): Promise<never> {
  const text = gitErrorText(err);
  const drop = await undoStash(chtCorePath, stash, head, {
    summary: `The stash push completed, but a later git read failed (${text}).`,
    gitText: text,
    cause: err,
    pathsInPlay: stash.prePush,
  }, logPrefix);
  if (drop === 'kept') throw spareEntryError(stash, text, err);
  const message = `The snapshot failed after the stash (${text}); cht-agent put your work back, so nothing was changed.`;
  throw withPushChoices(new WorkspaceSafetyError('precondition', message, { cause: err, lines: [message] }));
}

/** The work is back, but our entry stays in the list, where the next run's leftover check stops. */
function spareEntryError(stash: TakenStash, gitText: string, err: unknown): WorkspaceSafetyError {
  const message = `The snapshot failed after the stash (${gitText}); cht-agent put your work back, but could not ` +
    `remove its stash entry ${stash.name}.`;
  const lines = [
    message,
    `Your work is restored; the stash entry ${stash.name} is a spare copy.`,
    "The next run's start check shows that entry. Remove it from the stash list when you no longer need it.",
  ];
  return withPushChoices(new WorkspaceSafetyError('stash', message, { cause: err, lines }), spareOf(stash, 'kept'));
}

function warnSpareCopy(drop: DropOutcome, stashName: string, logPrefix: string): void {
  if (drop !== 'kept') return;
  console.warn(`${logPrefix} Your work is restored; the stash entry ${stashName} is a spare copy.`);
}

/** What the partial push itself reported, for the undo's own error text. */
function partialPushTrigger(
  pushError: unknown,
  leftovers: readonly string[],
  prePush: readonly string[],
): UndoTrigger {
  const text = pushError === undefined ? 'git stash push exited 0' : gitErrorText(pushError);
  return {
    summary: `git stash did not complete (${text}).`,
    gitText: text,
    cause: pushError,
    pathsInPlay: [...leftovers, ...prePush],
  };
}

/**
 * What the push left behind: tracked changes (staged, unstaged, intent-to-add,
 * submodule dirt) and pre-push untracked files still on disk. Not "no untracked
 * files": stashing a .gitignore edit legitimately unmasks files. A nested repo
 * (an entry ending in `/`) is never stashed; it stays and joins the baseline.
 */
async function stashLeftovers(chtCorePath: string, prePush: readonly string[]): Promise<string[]> {
  const { stdout } = await runGit(
    ['status', '--porcelain=v1', '-z', '--untracked-files=no', '--ignore-submodules=none'], chtCorePath,
  );
  const survivors = await pathsWhere(chtCorePath, prePush.filter(p => !p.endsWith('/')), prePushFileSurvives);
  return [...statusZPaths(stdout), ...survivors];
}

/**
 * A pre-push untracked file that the push did not take. A directory at its
 * path is never that file: the push's reset put a tracked directory back there
 * (a tracked dir that the operator replaced with a file). Any lstat error other
 * than ENOENT counts as still there.
 */
async function prePushFileSurvives(fullPath: string): Promise<boolean> {
  try {
    return !(await fs.lstat(fullPath)).isDirectory();
  } catch (err) {
    return (err as NodeJS.ErrnoException)?.code !== 'ENOENT';
  }
}

interface StatusEntry {
  x: string;
  y: string;
  path: string;
  /** The source of a rename or copy. */
  origPath?: string;
}

/** Entries of `status --porcelain=v1 -z`; a rename or copy carries its source as the next token. */
function parseStatusZ(stdout: string): StatusEntry[] {
  const tokens = stdout.split('\0').filter(Boolean);
  const entries: StatusEntry[] = [];
  let i = 0;
  while (i < tokens.length) {
    const entry: StatusEntry = { x: tokens[i][0], y: tokens[i][1], path: tokens[i].slice(3) };
    i += 1;
    if (isRenameOrCopy(entry.x, entry.y)) {
      entry.origPath = tokens[i];
      i += 1;
    }
    entries.push(entry);
  }
  return entries;
}

/** Every real path in `status --porcelain=v1 -z` output. */
function statusZPaths(stdout: string): string[] {
  return parseStatusZ(stdout).flatMap(e => (e.origPath === undefined ? [e.path] : [e.path, e.origPath]));
}

/** A path that git stash cannot put back exactly, and why. */
interface RoundTripCandidate {
  relPath: string;
  /**
   * Deleted in the index (`D `), deleted only in the working tree (` D`, `MD`,
   * `TD`), staged as new content and then deleted (`AD`, `RD`, `CD`), or a
   * rename source.
   */
  kind: 'indexDeleted' | 'worktreeDeleted' | 'stagedThenDeleted' | 'renameSource';
}

/**
 * Refuse, before the push, the states that `git stash` cannot put back
 * exactly: a path deleted in the index but kept on disk (`git rm --cached`),
 * the source of a staged rename that is on disk again, a tracked file whose
 * path is now a directory, a staged file that was then deleted, and a tracked
 * directory that is now an ignored file, a symbolic link or a special file.
 * The stash would save them, but its restore fails or differs, or its reset
 * deletes an ignored file, so refusing up front is the only way to change
 * nothing. `prePush` is the untracked listing, which the stash saves.
 */
async function assertStashCanRoundTrip(chtCorePath: string, prePush: readonly string[]): Promise<void> {
  const { stdout } = await readBeforeStash('the staged and unstaged changes', () => runGit(
    ['status', '-z', '--porcelain', '--untracked-files=no', '--ignore-submodules=all'], chtCorePath,
  ));
  const entries = parseStatusZ(stdout);
  const saved: SavedPaths = { untracked: new Set(prePush), staged: new Set(entries.filter(isStaged).map(e => e.path)) };
  const problems: string[] = [];
  for (const candidate of entries.flatMap(roundTripCandidates)) {
    const problem = await roundTripProblem(chtCorePath, candidate, saved);
    if (problem) problems.push(problem);
  }
  if (problems.length === 0) return;
  const lines = [
    'git stash cannot put these changes back exactly, so cht-agent did not stash them. Nothing was changed.',
    ...problems.map(problem => `  - ${problem}`),
    'Then run again.',
  ];
  throw new WorkspaceSafetyError('precondition', lines[0], { lines });
}

function roundTripCandidates(entry: StatusEntry): RoundTripCandidate[] {
  const candidates: RoundTripCandidate[] = [];
  const deleted = deletedKind(entry);
  if (deleted) candidates.push({ relPath: entry.path, kind: deleted });
  if (entry.origPath !== undefined && (entry.x === 'R' || entry.y === 'R')) {
    candidates.push({ relPath: entry.origPath, kind: 'renameSource' });
  }
  return candidates;
}

/** The paths that the stash saves as they are: untracked (in W^3) and staged (in W and W^2). */
interface SavedPaths {
  untracked: ReadonlySet<string>;
  staged: ReadonlySet<string>;
}

/** Staged content at the entry's path (for a rename or copy, its target). */
function isStaged(entry: StatusEntry): boolean {
  return 'AMTRC'.includes(entry.x);
}

function deletedKind(entry: StatusEntry): RoundTripCandidate['kind'] | null {
  if (entry.x === 'D') return 'indexDeleted';
  if (entry.y !== 'D') return null;
  // The stash keeps the staged content, and its restore writes that file back.
  return 'ARC'.includes(entry.x) ? 'stagedThenDeleted' : 'worktreeDeleted';
}

/** The operator text for a candidate that git stash cannot put back, or null when it can. */
async function roundTripProblem(
  chtCorePath: string,
  candidate: RoundTripCandidate,
  saved: SavedPaths,
): Promise<string | null> {
  const blocker = await blockerAbove(chtCorePath, candidate.relPath);
  if (candidate.kind === 'stagedThenDeleted') {
    return stagedThenDeletedProblem(chtCorePath, candidate.relPath, blocker, saved);
  }
  if (blocker) return blockerProblem(candidate.relPath, blocker, saved);
  const stat = await fs.lstat(path.join(chtCorePath, candidate.relPath)).catch(() => null);
  if (!stat) return null;
  return onDiskProblem(chtCorePath, candidate, stat);
}

/** A path above a candidate that is on disk and is not a directory. */
interface Blocker {
  relPath: string;
  stat: Stats;
}

/**
 * The first path above `relPath`, from the top down, that is on disk and is
 * not a directory. ENOENT at any level means none; any other lstat error is a
 * refusal, because then nothing tells what git stash would do there.
 */
async function blockerAbove(chtCorePath: string, relPath: string): Promise<Blocker | null> {
  for (const prefix of properAncestors(relPath)) {
    const dir = prefix.slice(0, -1);
    const stat = await lstatUnlessGone(chtCorePath, dir);
    if (!stat) return null;
    if (!stat.isDirectory()) return { relPath: dir, stat };
  }
  return null;
}

async function lstatUnlessGone(chtCorePath: string, relPath: string): Promise<Stats | null> {
  try {
    return await fs.lstat(path.join(chtCorePath, relPath));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === 'ENOENT') return null;
    const message = `cht-agent cannot check ${JSON.stringify(relPath)} (${code}), so it cannot tell what git ` +
      'stash would do there; nothing was changed.';
    throw new WorkspaceSafetyError('precondition', message, { cause: err, lines: [message] });
  }
}

/**
 * A regular file that the stash saves (untracked or staged) round-trips where
 * a tracked dir was. The push cannot save a path beyond a symbolic link or a
 * special file, and its reset deletes an ignored file (git treats ignored
 * files as expendable).
 */
function blockerProblem(relPath: string, blocker: Blocker, saved: SavedPaths): string | null {
  if (blocker.stat.isSymbolicLink()) return symlinkBlockerText(relPath, blocker.relPath, saved.staged.has(blocker.relPath));
  if (!blocker.stat.isFile()) return specialBlockerText(relPath, blocker);
  if (saved.untracked.has(blocker.relPath) || saved.staged.has(blocker.relPath)) return null;
  const quoted = JSON.stringify(blocker.relPath);
  return `${quoted} is an ignored file where the tracked directory of ${JSON.stringify(relPath)} was, and git ` +
    `stash would delete it. Move ${quoted} away.`;
}

/** A staged link moved away would only leave a staged file that was then deleted, so no move for it. */
function symlinkBlockerText(relPath: string, linkPath: string, staged: boolean): string {
  const quoted = JSON.stringify(linkPath);
  const head = `${quoted}, a directory above ${JSON.stringify(relPath)}, is now a`;
  const beyond = 'and git stash cannot save a path beyond a symbolic link.';
  if (!staged) return `${head} symbolic link, ${beyond} Move ${quoted} away.`;
  return `${head} staged symbolic link, ${beyond} Commit the change first. Moving a staged link away only ` +
    'turns it into a staged file that was then deleted.';
}

function specialBlockerText(relPath: string, blocker: Blocker): string {
  const type = entryTypeWord(blocker.stat);
  return `${JSON.stringify(blocker.relPath)}, a directory above ${JSON.stringify(relPath)}, is now a ${type}, ` +
    `and git stash cannot save a ${type}. Move it away.`;
}

/**
 * Always a problem, on disk or not. The restore command only when nothing is in
 * the way: `git restore` deletes an untracked file or directory in its path.
 * Never an unstage: for a staged add it drops the only copy of the content.
 */
async function stagedThenDeletedProblem(
  chtCorePath: string,
  relPath: string,
  blocker: Blocker | null,
  saved: SavedPaths,
): Promise<string> {
  if (blocker) return blockedStagedFileText(relPath, blocker, saved);
  const head = stagedThenDeletedHead(relPath);
  const stat = await fs.lstat(path.join(chtCorePath, relPath)).catch(() => null);
  if (stat) {
    const type = entryTypeWord(stat);
    return `${head}, and a ${type} is at its path now, so git stash cannot put it back. Move that ${type} away.`;
  }
  const restore = `git -C ${shellQuote(chtCorePath)} restore -- ${shellQuote(toLiteralPathspec(relPath))}`;
  return `${head}, and git stash would put the staged file back on disk. Commit it, or put the file back with: ${restore}`;
}

function stagedThenDeletedHead(relPath: string): string {
  return `${JSON.stringify(relPath)} is staged but deleted from the working tree`;
}

/** Move the blocker, never a restore; a staged link gets the B2 text, since moving it loops. */
function blockedStagedFileText(relPath: string, blocker: Blocker, saved: SavedPaths): string {
  if (blocker.stat.isSymbolicLink() && saved.staged.has(blocker.relPath)) {
    return symlinkBlockerText(relPath, blocker.relPath, true);
  }
  const quoted = JSON.stringify(blocker.relPath);
  return `${stagedThenDeletedHead(relPath)}, and the ${entryTypeWord(blocker.stat)} ${quoted} is where its ` +
    `directory was, so git stash cannot put it back. Move ${quoted} away.`;
}

/** The text for a candidate whose own path is on disk. */
function onDiskProblem(chtCorePath: string, candidate: RoundTripCandidate, stat: Stats): string {
  const quoted = JSON.stringify(candidate.relPath);
  const type = entryTypeWord(stat);
  if (candidate.kind === 'renameSource') {
    return `${quoted} is the source of a staged rename, and a ${type} at that path is on disk again. ` +
      `Commit the rename, or move that ${type} away.`;
  }
  if (stat.isDirectory()) {
    return `${quoted} is a tracked file whose path is now a directory. Commit the change, or move that directory away.`;
  }
  if (candidate.kind === 'worktreeDeleted') {
    return `${quoted} is deleted in the working tree, but a ${type} is at that path. Move it away.`;
  }
  const restore = `git -C ${shellQuote(chtCorePath)} restore --staged -- ${shellQuote(toLiteralPathspec(candidate.relPath))}`;
  return `${quoted} is deleted in the index but still on disk (as after git rm --cached). ` +
    `Commit the delete, or undo it with: ${restore}`;
}

function entryTypeWord(stat: Stats): string {
  if (stat.isSymbolicLink()) return 'symbolic link';
  if (stat.isDirectory()) return 'directory';
  if (stat.isFile()) return 'file';
  return specialTypeWord(stat);
}

function specialTypeWord(stat: Stats): string {
  if (stat.isFIFO()) return 'FIFO';
  if (stat.isSocket()) return 'socket';
  return 'device file';
}

async function stashNotCreatedError(
  chtCorePath: string,
  pushError: unknown,
  prePush: readonly string[],
  listReadError: unknown,
): Promise<WorkspaceSafetyError> {
  const text = pushError === undefined
    ? 'git stash push exited 0 but saved nothing (for example, changes inside a submodule, which git stash does not save)'
    : gitErrorText(pushError);
  const leftovers = await readLeftoversForReport(chtCorePath, prePush);
  const lines = [
    `git stash could not save your uncommitted work, so nothing was stashed and your tree is unchanged: ${text}`,
    ...readFailureLines('the stash list', listReadError),
    ...readFailureLines('the status', leftovers.readError),
    ...pathListLines('Changes that were not stashed:', leftovers.paths),
    ...(await permissionLines(chtCorePath, text, [...leftovers.paths, ...prePush])),
  ];
  return withPushChoices(new WorkspaceSafetyError('stash', lines[0], { lines, cause: pushError ?? listReadError }));
}

async function readLeftoversForReport(
  chtCorePath: string,
  prePush: readonly string[],
): Promise<{ paths: string[]; readError?: unknown }> {
  try {
    return { paths: await stashLeftovers(chtCorePath, prePush) };
  } catch (err) {
    return { paths: [], readError: err };
  }
}

function readFailureLines(what: string, err: unknown): string[] {
  if (err === undefined) return [];
  return [`(A git read of ${what} failed too: ${gitErrorText(err)})`];
}

async function partialStashError(
  chtCorePath: string,
  pushError: unknown,
  leftovers: readonly string[],
  prePush: readonly string[],
  spares: readonly SpareStash[],
): Promise<WorkspaceSafetyError> {
  const text = pushError === undefined ? 'git stash push exited 0' : gitErrorText(pushError);
  const lines = [
    `git stash did not clear these paths, so cht-agent put your work back and stopped (${text}):`,
    ...pathListLines('Paths the stash left:', leftovers).slice(1),
    ...(await permissionLines(chtCorePath, text, [...leftovers, ...prePush])),
  ];
  return withPushChoices(new WorkspaceSafetyError('stash', lines[0], { lines, cause: pushError }), spares);
}

/** The step that fixes what git reported, for an error the operator runs again after. */
async function permissionLines(chtCorePath: string, gitText: string, paths: readonly string[]): Promise<string[]> {
  return [await permissionCauseStep(chtCorePath, gitText, paths, 'run again')];
}

/** Where the filesystem blocks git: dirs it cannot write in and files it cannot read. */
interface PermissionBlockers {
  dirs: readonly string[];
  files: readonly string[];
}

async function permissionCauseStep(
  chtCorePath: string,
  gitText: string,
  relPaths: readonly string[],
  then: string,
): Promise<string> {
  const blockers = gitText.includes('Permission denied')
    ? await findPermissionBlockers(chtCorePath, relPaths)
    : { dirs: [], files: [] };
  return permissionCauseText(gitText, blockers, then);
}

/**
 * The first recovery step: fix what made git fail. It names only what the
 * checks found on disk, never "cannot write" without a named dir.
 */
function permissionCauseText(gitText: string, blockers: PermissionBlockers, then: string): string {
  if (gitText.includes('index.lock')) {
    return 'Another git process may hold the index.lock file named above. ' +
      `Remove that file only if no git process runs, then ${then}.`;
  }
  if (!gitText.includes('Permission denied')) {
    return `Find out why git failed (see its message above) and fix the cause, then ${then}.`;
  }
  const named = [
    ...blockers.dirs.map(d => `git cannot write inside ${JSON.stringify(d)}`),
    ...blockers.files.map(f => `git cannot read ${JSON.stringify(f)}`),
  ];
  if (named.length === 0) {
    return `git hit a permission error (Permission denied, see git's message above). Fix the permissions, then ${then}.`;
  }
  return `${named.join('; ')} (Permission denied). Fix the permissions, then ${then}.`;
}

/**
 * For each path: every dir on the way up to the top level that the current
 * user cannot write in (an rmdir needs write access on the parent), and the
 * path itself when it is a file that the user cannot read. Taken from the tree,
 * not from git's stderr, whose path quoting varies between messages.
 */
async function findPermissionBlockers(chtCorePath: string, relPaths: readonly string[]): Promise<PermissionBlockers> {
  const dirs = new Set<string>();
  const files = new Set<string>();
  for (const relPath of new Set(relPaths)) {
    for (const dir of await unwritableDirsUpToTop(chtCorePath, relPath)) dirs.add(dir);
    if (await isUnreadableFile(path.join(chtCorePath, relPath))) files.add(relPath);
  }
  return { dirs: [...dirs], files: [...files] };
}

async function unwritableDirsUpToTop(chtCorePath: string, relPath: string): Promise<string[]> {
  const found: string[] = [];
  for (const dir of dirsUpToTop(relPath)) {
    if (await isUnwritableDir(path.join(chtCorePath, dir))) found.push(topLevelAsPath(chtCorePath, dir));
  }
  return found;
}

async function isUnwritableDir(fullPath: string): Promise<boolean> {
  return !(await pathIsRemoved(fullPath)) && !(await isWritableDir(fullPath));
}

/** The top level reads better as the repo path than as `.`. */
function topLevelAsPath(chtCorePath: string, dir: string): string {
  return dir === '.' ? chtCorePath : dir;
}

/** `a/b`, `a` and `.` for `a/b/c` (and for the dir entry `a/b/c/`). */
function dirsUpToTop(relPath: string): string[] {
  const dirs: string[] = [];
  let dir = path.dirname(relPath.endsWith('/') ? relPath.slice(0, -1) : relPath);
  while (dir !== '.' && dir !== path.dirname(dir)) {
    dirs.push(dir);
    dir = path.dirname(dir);
  }
  dirs.push('.');
  return dirs;
}

/** True only when the path is a file and the OS positively refuses read access. */
async function isUnreadableFile(fullPath: string): Promise<boolean> {
  try {
    if (!(await fs.lstat(fullPath)).isFile()) return false;
    await fs.access(fullPath, fsConstants.R_OK);
    return false;
  } catch (err) {
    return ['EACCES', 'EPERM'].includes(String((err as NodeJS.ErrnoException)?.code));
  }
}

/** Why the undo runs: what went wrong first, in git's words, and the paths it touched. */
interface UndoTrigger {
  /** One sentence for the operator, true for this trigger. */
  summary: string;
  /** git's own text; the lock and permission checks read it. */
  gitText: string;
  cause?: unknown;
  /** The paths whose dirs and files the permission check looks at. */
  pathsInPlay: readonly string[];
}

/**
 * Put the tree back exactly as it was before the push, from our stash commit W
 * (worktree from W, index from W^2, untracked files from W^3), then drop W.
 * Not `stash pop`, which fails on these half-cleaned states, and not
 * `checkout W^3 --`, which stages. Only the differing paths are restored, so a
 * read-only dir whose files did not change is never written. W is dropped only
 * once the tree is proven back; otherwise it stays and this throws `stash`.
 * Returns what the drop did; the caller reports a spare entry.
 */
async function undoStash(
  chtCorePath: string,
  stash: TakenStash,
  head: SnapshotHead,
  trigger: UndoTrigger,
  logPrefix: string,
): Promise<DropOutcome> {
  const ctx: UndoContext = { chtCorePath, stash, head, trigger, logPrefix };
  try {
    await restoreFromStash(chtCorePath, stash.sha);
  } catch (err) {
    throw await undoFailedError(ctx, { restoreError: err });
  }
  let differing: string[];
  try {
    differing = await pathsNotRestored(chtCorePath, stash);
  } catch (err) {
    throw await undoFailedError(ctx, { verifyError: err });
  }
  if (differing.length > 0) throw await undoFailedError(ctx, { differing });
  return dropStashBySha(chtCorePath, stash.sha, logPrefix);
}

/** Everything an undo needs, so a choice after a failed undo can check or run it again. */
interface UndoContext {
  chtCorePath: string;
  stash: TakenStash;
  head: SnapshotHead;
  trigger: UndoTrigger;
  logPrefix: string;
}

async function restoreFromStash(chtCorePath: string, sha: string): Promise<void> {
  const worktree = await zPaths(chtCorePath, ['diff', '--name-only', '--no-renames', '-z', sha, '--']);
  await restorePaths(chtCorePath, sha, '--worktree', worktree);
  const index = await zPaths(chtCorePath, ['diff', '--cached', '--name-only', '--no-renames', '-z', `${sha}^2`, '--']);
  await restorePaths(chtCorePath, `${sha}^2`, '--staged', index);
  const missing = await pathsWhere(chtCorePath, await stashUntrackedPaths(chtCorePath, sha), pathIsRemoved);
  await restorePaths(chtCorePath, `${sha}^3`, '--worktree', missing);
}

async function restorePaths(chtCorePath: string, source: string, where: string, relPaths: readonly string[]): Promise<void> {
  for (let i = 0; i < relPaths.length; i += CLEAN_PATHSPEC_CHUNK) {
    const chunk = relPaths.slice(i, i + CLEAN_PATHSPEC_CHUNK).map(toLiteralPathspec);
    await runGit(['restore', `--source=${source}`, where, '--', ...chunk], chtCorePath);
  }
}

async function zPaths(chtCorePath: string, args: readonly string[]): Promise<string[]> {
  return (await runGit(args, chtCorePath)).stdout.split('\0').filter(Boolean);
}

/**
 * The paths where the tree does not match what the stash holds. Submodule
 * content is ignored (a stash never records it), and every untracked file must
 * match its W^3 entry by mode: a symlink by its target text, a file by its blob.
 * `alsoUntracked` are untracked paths that may be there besides the pre-push
 * ones (after a rollback: the session files that the clean could not remove).
 */
async function pathsNotRestored(
  chtCorePath: string,
  stash: TakenStash,
  alsoUntracked: ReadonlySet<string> = new Set(),
): Promise<string[]> {
  const tracked = await zPaths(chtCorePath, ['diff', '--name-only', '--no-renames', '--ignore-submodules=all', '-z', stash.sha, '--']);
  const staged = await zPaths(
    chtCorePath, ['diff', '--cached', '--name-only', '--no-renames', '--ignore-submodules=all', '-z', `${stash.sha}^2`, '--'],
  );
  const untracked = await untrackedEntriesNotRestored(chtCorePath, stash.sha);
  const deleted = await deletedPathsOnDisk(chtCorePath, stash.sha);
  const now = new Set(await listUntracked(chtCorePath));
  const before = new Set(stash.prePush);
  const extra = [...now].filter(p => !before.has(p) && !alsoUntracked.has(p));
  const gone = [...before].filter(p => !now.has(p));
  return [...new Set([...tracked, ...staged, ...untracked, ...deleted, ...extra, ...gone])];
}

/**
 * The paths that the stash's worktree (W) or index (W^2) deletes relative to
 * its base, which are on disk anyway. The extra-path check cannot see them when
 * they are ignored (a written-back `d.log` under `*.log`).
 */
async function deletedPathsOnDisk(chtCorePath: string, sha: string): Promise<string[]> {
  const deleted = new Set([
    ...await zPaths(chtCorePath, ['diff', '--name-only', '--no-renames', '--diff-filter=D', '-z', `${sha}^1`, sha]),
    ...await zPaths(chtCorePath, ['diff', '--name-only', '--no-renames', '--diff-filter=D', '-z', `${sha}^1`, `${sha}^2`]),
  ]);
  return pathsWhere(chtCorePath, deleted, deletedPathOnDisk);
}

/**
 * ENOENT and ENOTDIR both mean the deleted path is absent: after the undo of a
 * tracked dir that the operator replaced with a file, `d/b.txt` gives ENOTDIR.
 * Success, or any other errno, means on disk.
 */
async function deletedPathOnDisk(fullPath: string): Promise<boolean> {
  try {
    await fs.lstat(fullPath);
    return true;
  } catch (err) {
    return !['ENOENT', 'ENOTDIR'].includes(String((err as NodeJS.ErrnoException)?.code));
  }
}

async function untrackedEntriesNotRestored(chtCorePath: string, sha: string): Promise<string[]> {
  if (!(await hasUntrackedCommit(chtCorePath, sha))) return [];
  const { stdout } = await runGit(['ls-tree', '-r', '-z', `${sha}^3`], chtCorePath);
  const notRestored: string[] = [];
  for (const entry of stdout.split('\0').filter(Boolean)) {
    // `<mode> <type> <oid>\t<path>`; split at the FIRST tab, a path may hold one.
    const tab = entry.indexOf('\t');
    const [mode, , oid] = entry.slice(0, tab).split(' ');
    const relPath = entry.slice(tab + 1);
    if (!(await stashEntryOnDisk(chtCorePath, relPath, mode, oid))) notRestored.push(relPath);
  }
  return notRestored;
}

const REGULAR_FILE_MODES = new Set(['100644', '100755']);

async function stashEntryOnDisk(chtCorePath: string, relPath: string, mode: string, oid: string): Promise<boolean> {
  const fullPath = path.join(chtCorePath, relPath);
  const stat = await fs.lstat(fullPath).catch(() => null);
  if (mode === '120000') return Boolean(stat?.isSymbolicLink()) && (await symlinkTargetIs(chtCorePath, fullPath, oid));
  if (REGULAR_FILE_MODES.has(mode)) return Boolean(stat?.isFile()) && (await fileBlobIs(chtCorePath, relPath, oid));
  return false;
}

/** hash-object would follow the link, so compare the link text with the stored blob. */
async function symlinkTargetIs(chtCorePath: string, fullPath: string, oid: string): Promise<boolean> {
  const { stdout } = await runGit(['cat-file', 'blob', oid], chtCorePath);
  return (await fs.readlink(fullPath)) === stdout;
}

async function fileBlobIs(chtCorePath: string, relPath: string, oid: string): Promise<boolean> {
  const { stdout } = await runGit(['hash-object', '--no-filters', '--', relPath], chtCorePath);
  return stdout.trim() === oid;
}

/**
 * The undo could not prove the tree is back: keep the stash, and say how to
 * finish by hand. "The rest is back" only when the restore itself completed.
 */
async function undoFailedError(ctx: UndoContext, outcome: UndoOutcome): Promise<WorkspaceSafetyError> {
  const { chtCorePath, stash, trigger } = ctx;
  const differing = outcome.differing ?? [];
  const inTheWay = await untrackedInTheWay(chtCorePath, stash);
  const cause = await permissionCauseStep(
    chtCorePath, trigger.gitText, [...trigger.pathsInPlay, ...differing], 'run the steps below',
  );
  const lines = [
    `${trigger.summary} cht-agent could not fully put your work back. Your work is still in stash ${stash.name}.`,
    ...undoErrorLines(outcome),
    ...untrackedReadErrorLines(stash.name, inTheWay.readError),
    ...pathListLines('These paths do not match what the stash holds (cht-agent did not delete any of them):', differing),
    ...(differing.length > 0 ? ['The rest of your work is already back in the working tree.'] : []),
    ...recoveryStepLines(chtCorePath, {
      cause, headSha: ctx.head.sha, remove: inTheWay.remove, moveAside: inTheWay.moveAside, stashName: stash.name,
    }),
  ];
  return withUndoChoices(ctx, new WorkspaceSafetyError('stash', lines[0], { lines, cause: trigger.cause ?? outcome.restoreError }));
}

function undoHint(ctx: UndoContext): StashHint {
  return { chtCorePath: ctx.chtCorePath, head: ctx.head, hintPath: ctx.chtCorePath, stashName: ctx.stash.name };
}

/**
 * Register the choices at a failed undo: the printed steps put the work back;
 * "handled" checks that. A HEAD-moved variant keeps its base error, so the
 * next check starts from the base, and it needs no variant before an Abort.
 */
function withUndoChoices(ctx: UndoContext, error: WorkspaceSafetyError): WorkspaceSafetyError {
  registeredFailures.set(error, {
    step: 'undo',
    choices: RESTORE_CHOICES,
    trailer: RESTORE_TRAILER,
    next: choice => afterFailedUndo(ctx, error, choice),
    beforeAbort: () => abortVariant(undoHint(ctx), error, ctx.logPrefix),
  });
  return error;
}

function afterFailedUndo(ctx: UndoContext, error: WorkspaceSafetyError, choice: 'handled' | 'retry'): Promise<SnapshotNext> {
  return choice === 'retry' ? retryUndo(ctx, error) : recheckUndo(ctx, error);
}

function withMovedUndoChoices(ctx: UndoContext, variant: WorkspaceSafetyError, base: WorkspaceSafetyError): WorkspaceSafetyError {
  registeredFailures.set(variant, {
    step: 'undo', choices: RESTORE_CHOICES, trailer: RESTORE_TRAILER_HEAD_MOVED, next: choice => afterFailedUndo(ctx, base, choice),
  });
  return variant;
}

/**
 * "I handled it myself" after a failed undo: check the tree against our entry.
 * Back: drop the entry if it is still listed, then the snapshot runs again.
 * Not back with the entry listed: show the failure again with the current paths.
 * Not back with the entry gone: the operator took it; say so, and go on.
 */
async function recheckUndo(ctx: UndoContext, error: WorkspaceSafetyError): Promise<SnapshotNext> {
  const state = await readRestoreState(ctx.chtCorePath, ctx.stash, new Set());
  if ('readLine' in state) return undoScreenAgain(ctx, error, [state.readLine]);
  if (state.differing.length === 0) return state.listed ? dropThenRerun(ctx) : rerun();
  if (!state.listed) {
    warnStashGone(ctx.chtCorePath, ctx.stash, state.differing, ctx.logPrefix);
    return rerun();
  }
  return undoScreenAgain(ctx, await undoFailedError(ctx, { differing: state.differing }), []);
}

/** The failed undo again; when HEAD moved, the variant without the reset step. */
async function undoScreenAgain(ctx: UndoContext, error: WorkspaceSafetyError, reason: readonly string[]): Promise<SnapshotNext> {
  const variant = await headMovedVariant(undoHint(ctx), error);
  if (!variant) return showAgain(error, reason);
  return showAgain(withMovedUndoChoices(ctx, variant, error));
}

/**
 * Retry after a failed undo: put the work back from our entry again, then the
 * snapshot runs again. Our entry gone: the operator took it, so check the
 * tree. HEAD moved: write nothing, and show the failure without the reset step.
 */
async function retryUndo(ctx: UndoContext, error: WorkspaceSafetyError): Promise<SnapshotNext> {
  const listed = await entryListed(ctx.chtCorePath, ctx.stash);
  if (typeof listed === 'string') return undoScreenAgain(ctx, error, [listed]);
  if (!listed) return recheckUndo(ctx, error);
  const variant = await headMovedVariant(undoHint(ctx), error);
  if (variant) return showAgain(withMovedUndoChoices(ctx, variant, error));
  return undoThenRerun(ctx);
}

/** Whether our entry is in the stash list, or the line that says the list could not be read. */
async function entryListed(chtCorePath: string, stash: TakenStash): Promise<boolean | string> {
  try {
    return (await listStashes(chtCorePath)).some(e => e.sha === stash.sha);
  } catch (err) {
    return `cht-agent could not read the stash list (${gitErrorText(err)}).`;
  }
}

async function dropThenRerun(ctx: UndoContext): Promise<SnapshotNext> {
  const drop = await dropStashBySha(ctx.chtCorePath, ctx.stash.sha, ctx.logPrefix);
  warnSpareCopy(drop, ctx.stash.name, ctx.logPrefix);
  return rerun(spareOf(ctx.stash, drop));
}

/** How far the undo got: a restore that threw, a check that could not run, or paths that differ. */
interface UndoOutcome {
  differing?: readonly string[];
  restoreError?: unknown;
  verifyError?: unknown;
}

function undoErrorLines(outcome: UndoOutcome): string[] {
  if (outcome.restoreError !== undefined) {
    return [`The restore from the stash failed part way: ${gitErrorText(outcome.restoreError)}`];
  }
  if (outcome.verifyError !== undefined) {
    return [`The restore ran, but cht-agent could not check the result: ${gitErrorText(outcome.verifyError)}`];
  }
  return [];
}

/**
 * What blocks the restore of the stash's untracked files: those on disk, which
 * a clean step removes. When the stash cannot be read, the pre-push files that
 * are on disk go to a move step instead: a delete could lose a file that the
 * restore does not bring back.
 */
async function untrackedInTheWay(
  chtCorePath: string,
  stash: TakenStash,
): Promise<{ remove: string[]; moveAside: string[]; readError?: unknown }> {
  try {
    return { remove: await stashUntrackedOnDisk(chtCorePath, stash.sha), moveAside: [] };
  } catch (err) {
    const files = await pathsWhere(chtCorePath, stash.prePush.filter(p => !p.endsWith('/')), isFileNotDir);
    return { remove: [], moveAside: files, readError: err };
  }
}

async function isFileNotDir(fullPath: string): Promise<boolean> {
  try {
    return !(await fs.lstat(fullPath)).isDirectory();
  } catch {
    return false;
  }
}

function untrackedReadErrorLines(stashName: string, err: unknown): string[] {
  if (err === undefined) return [];
  return [`cht-agent could not read the untracked files in stash ${stashName}: ${gitErrorText(err)}`];
}

/** The untracked files that the stash saved and that are on disk now (they block a restore). */
async function stashUntrackedOnDisk(chtCorePath: string, stashSha: string): Promise<string[]> {
  return pathsWhere(chtCorePath, await stashUntrackedPaths(chtCorePath, stashSha), isOnDisk);
}

/**
 * Refuse a path below the repo toplevel: every path we read, capture and clean
 * is toplevel-relative, and a subdirectory would put the operator's files
 * outside the baseline. A symlink to the toplevel is fine (the prefix is empty).
 */
async function assertAtToplevel(chtCorePath: string): Promise<void> {
  const { stdout } = await readBeforeStash('the path prefix', () => runGit(['rev-parse', '--show-prefix'], chtCorePath));
  const prefix = stdout.trim();
  if (!prefix) return;
  const message =
    `${chtCorePath} is the subdirectory ${prefix} of a git repo, not its top level; refuse to run ` +
    'cht-agent. Point CHT_CORE_PATH at the repo root.';
  throw new WorkspaceSafetyError('precondition', message, { lines: [message] });
}

/**
 * git's marker files for a merge, cherry-pick, revert, rebase or am that is
 * still in progress. A stash push would silently drop MERGE_HEAD and friends,
 * and a stopped `rebase -i` has a clean tree, so the dirty check misses it.
 */
const IN_PROGRESS_MARKERS = ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply', 'sequencer'];

async function assertNoOperationInProgress(chtCorePath: string): Promise<void> {
  // --git-path, not path.join(.git, ...): in a linked worktree `.git` is a file.
  const { stdout } = await readBeforeStash('the in-progress operation markers', () => runGit(
    ['rev-parse', '--path-format=absolute', ...IN_PROGRESS_MARKERS.flatMap(m => ['--git-path', m])],
    chtCorePath,
  ));
  const found: string[] = [];
  for (const markerPath of stdout.split('\n').filter(Boolean)) {
    if (!(await pathIsRemoved(markerPath))) found.push(path.basename(markerPath));
  }
  if (found.length === 0) return;
  const message =
    `cht-core at ${chtCorePath} is in the middle of a git operation (${found.join(', ')}); refuse to ` +
    'run cht-agent. Finish or abort that operation, then run again.';
  throw new WorkspaceSafetyError('precondition', message, { lines: [message] });
}

async function readHeadSha(chtCorePath: string): Promise<string> {
  return (await runGit(['rev-parse', 'HEAD'], chtCorePath)).stdout.trim();
}

/** The branch HEAD points at, or null when HEAD is detached (`symbolic-ref -q` exits 1). */
async function readHeadRef(chtCorePath: string): Promise<string | null> {
  try {
    return (await runGit(['symbolic-ref', '-q', 'HEAD'], chtCorePath)).stdout.trim() || null;
  } catch (err) {
    if ((err as { code?: unknown }).code === 1) return null;
    throw err;
  }
}

async function readRepoRoot(chtCorePath: string): Promise<string> {
  return stripNewline((await runGit(['rev-parse', '--show-toplevel'], chtCorePath)).stdout);
}

/**
 * Capture the current cht-core state. Stashes any uncommitted work so that
 * (a) the CLI sees a clean workspace, and (b) we can restore the user's work
 * after rollback. Refuses to run if cht-core has unmerged paths or other state
 * that `git stash` cannot capture cleanly.
 */
export async function snapshotChtCore(
  chtCorePath: string,
  options: WorkspaceCallOptions = {},
): Promise<ChtCoreSnapshot> {
  const resolve = options.resolveStashFailure;
  if (!resolve) return snapshotOnce(chtCorePath, options);
  return snapshotWithChoices(chtCorePath, options, resolve);
}

/** The accepted leftovers of one snapshot call with a resolver, and the spare copies of ours among them. */
interface ChoiceLoop {
  accepted: string[];
  spares: SpareStash[];
}

/**
 * With a resolver: at a stash failure point, show the failure and act on the
 * operator's choice. Abort throws the failure's own error, marked; "I handled
 * it myself" and Retry run the snapshot again from the top. Any other error is
 * thrown as it is.
 */
async function snapshotWithChoices(
  chtCorePath: string,
  options: WorkspaceCallOptions,
  resolve: StashFailureResolver,
): Promise<ChtCoreSnapshot> {
  const loop: ChoiceLoop = { accepted: [...(options.acceptedLeftoverShas ?? [])], spares: [] };
  for (;;) {
    const attempt = await attemptSnapshot(chtCorePath, { ...options, acceptedLeftoverShas: loop.accepted });
    if (attempt.snapshot) return attempt.snapshot;
    const spares = await settleSnapshotFailure(attempt.error, resolve, loop, options.logPrefix ?? DEFAULT_LOG_PREFIX);
    acceptSpares(loop, spares, options.onSpareStash);
  }
}

async function attemptSnapshot(
  chtCorePath: string,
  options: WorkspaceCallOptions,
): Promise<{ snapshot?: ChtCoreSnapshot; error?: unknown }> {
  try {
    return { snapshot: await snapshotOnce(chtCorePath, options) };
  } catch (error) {
    return { error };
  }
}

/**
 * Show a registered failure and ask, until a choice lets the snapshot run
 * again; returns the spare copies it may skip. Abort throws the error of the
 * screen shown last, marked. An unregistered error is thrown as it is.
 */
async function settleSnapshotFailure(
  err: unknown,
  resolve: StashFailureResolver,
  loop: ChoiceLoop,
  logPrefix: string,
): Promise<readonly SpareStash[]> {
  let screen: FailureScreen = { error: registeredError(err), reason: [] };
  let first = true;
  for (;;) {
    const registered = registeredFailures.get(screen.error) as RegisteredFailure;
    printScreen(screen, [...loop.spares.map(s => spareCopyLine(s.name)), registered.trailer], logPrefix, first);
    first = false;
    const choice = await askOperator(resolve, { step: registered.step, lines: shownLines(screen), choices: registered.choices });
    if (choice === 'abort') throw markAbort(await abortErrorOf(registered, screen.error));
    const next = await registered.next(choice);
    if (next.rerun) return next.spares;
    screen = next.screen;
  }
}

/** The error that Abort throws: the HEAD-moved variant when HEAD moved, otherwise the one shown. */
async function abortErrorOf(registered: RegisteredFailure, shown: WorkspaceSafetyError): Promise<WorkspaceSafetyError> {
  return (await registered.beforeAbort?.()) ?? shown;
}

function registeredError(err: unknown): WorkspaceSafetyError {
  if (err instanceof WorkspaceSafetyError && registeredFailures.has(err)) return err;
  throw err;
}

/**
 * A screen prints the failure's lines, then `tail` (the trailer, and on the
 * snapshot side a line for each spare copy of ours), with the caller's prefix.
 * The first show goes through reportSafetyError. A re-show prints its reason
 * lines first, then the failure's lines, straight to the console.
 */
function printScreen(screen: FailureScreen, tail: readonly string[], logPrefix: string, first: boolean): void {
  if (first) reportSafetyError(screen.error, logPrefix);
  else printLinesOf(screen.error, shownLines(screen), logPrefix);
  for (const line of tail) console.error(`${logPrefix} ${line}`);
}

/** The lines that a screen shows: the reason lines of a re-show, then the failure's own lines. */
function shownLines(screen: FailureScreen): string[] {
  return [...screen.reason, ...screen.error.lines];
}

/** Print these lines for `error`, and mark it as reported, so that no caller prints it again. */
function printLinesOf(error: WorkspaceSafetyError, lines: readonly string[], logPrefix: string): void {
  reportedSafetyErrors.add(error);
  for (const line of lines) console.error(`${logPrefix} ${line}`);
}

/**
 * When HEAD or the branch moved off the HEAD that the stash was taken on: the
 * line that says so, or null. A reset to the old HEAD would orphan new commits.
 */
async function headMovedSince(chtCorePath: string, head: SnapshotHead): Promise<string | null> {
  let sha: string;
  let ref: string | null;
  try {
    sha = await readHeadSha(chtCorePath);
    ref = await readHeadRef(chtCorePath);
  } catch (err) {
    return `cht-agent could not read HEAD (${gitErrorText(err)}), so it did not put your work back over it.`;
  }
  if (sha === head.sha && ref === head.ref) return null;
  return `HEAD is at ${sha} on ${refLabel(ref)} now, not ${head.sha} on ${refLabel(head.ref)}, so cht-agent did ` +
    'not put your work back over it.';
}

/** Where the stash's work is, for a screen that must not print the reset step. */
interface StashHint {
  chtCorePath: string;
  head: SnapshotHead;
  /** The repo that the Find and Restore commands name. */
  hintPath: string;
  stashName: string;
}

/**
 * The failure again, for a HEAD that moved (or null when it did not): the HEAD
 * line first, the failure's heading and path lists, then where the work is,
 * instead of the reset and clean steps.
 */
async function headMovedVariant(hint: StashHint, error: WorkspaceSafetyError): Promise<WorkspaceSafetyError | null> {
  const moved = await headMovedSince(hint.chtCorePath, hint.head);
  if (!moved) return null;
  const lines = [moved, ...linesBeforeSteps(error.lines), ...stashHintLines(hint.hintPath, hint.stashName)];
  return new WorkspaceSafetyError(error.kind, lines[0], { lines, cause: error.cause });
}

/** Before an Abort: when HEAD moved, print the variant and give it, so that Abort throws it. */
async function abortVariant(hint: StashHint, error: WorkspaceSafetyError, logPrefix: string): Promise<WorkspaceSafetyError | null> {
  const variant = await headMovedVariant(hint, error);
  if (variant) printLinesOf(variant, variant.lines, logPrefix);
  return variant;
}

/** The lines above the numbered steps, or above the Find and Restore lines when there are no numbered steps. */
function linesBeforeSteps(lines: readonly string[]): string[] {
  const steps = lines.findIndex(line => line === RECOVERY_HEADING || line.startsWith(FIND_STEP));
  return steps === -1 ? [...lines] : lines.slice(0, steps);
}

/** Whether our entry is listed, and where the tree differs from it; or the line that says why that is unknown. */
async function readRestoreState(
  chtCorePath: string,
  stash: TakenStash,
  alsoUntracked: ReadonlySet<string>,
): Promise<{ listed: boolean; differing: string[] } | { readLine: string }> {
  try {
    const listed = (await listStashes(chtCorePath)).some(e => e.sha === stash.sha);
    return { listed, differing: await pathsNotRestored(chtCorePath, stash, alsoUntracked) };
  } catch (err) {
    return { readLine: `cht-agent could not check the working tree against stash ${stash.name} (${gitErrorText(err)}).` };
  }
}

/** The operator took our entry and the tree differs from it: name the paths, and how to get the entry back. */
function warnStashGone(chtCorePath: string, stash: TakenStash, differing: readonly string[], logPrefix: string): void {
  console.warn(
    `${logPrefix} Stash ${stash.name} is no longer in the stash list, and these paths do not match it: ` +
      `${summarizePaths(differing)}. Its commit is ${stash.sha}. If you still need it: ` +
      `git -C ${shellQuote(chtCorePath)} stash apply --index ${stash.sha}`,
  );
}

function spareCopyLine(stashName: string): string {
  return `Stash ${stashName} is a spare copy of work that cht-agent already put back. It stays in the stash list.`;
}

/** The operator's choice. A resolver that rejects, or answers a choice that is not offered, means Abort. */
async function askOperator(resolve: StashFailureResolver, failure: StashFailure): Promise<StashChoice> {
  const choice = await resolve(failure).catch((): StashChoice => 'abort');
  return failure.choices.includes(choice) ? choice : 'abort';
}

function markAbort(error: WorkspaceSafetyError): WorkspaceSafetyError {
  operatorAborts.add(error);
  return error;
}

/** A spare copy of ours is proven: this loop's re-run skips it, and so does the rest of the run. */
function acceptSpares(loop: ChoiceLoop, spares: readonly SpareStash[], onSpareStash?: (sha: string) => void): void {
  for (const spare of spares) {
    loop.accepted.push(spare.sha);
    loop.spares.push(spare);
    onSpareStash?.(spare.sha);
  }
}

/** One snapshot from the top: the pre-checks, the stash of the operator's work, and the baseline. */
async function snapshotOnce(chtCorePath: string, options: WorkspaceCallOptions): Promise<ChtCoreSnapshot> {
  const logPrefix = options.logPrefix ?? DEFAULT_LOG_PREFIX;
  await assertAtToplevel(chtCorePath);
  // A leftover stash can hold the operator's work; stashing on top of it would bury it deeper.
  await assertNoLeakedStash(chtCorePath, options.acceptedLeftoverShas);

  const repoRoot = await readBeforeStash('the repo top level', () => readRepoRoot(chtCorePath));
  const headSha = await readBeforeStash('HEAD', () => readHeadSha(chtCorePath));
  const headRef = await readBeforeStash('the branch HEAD points at', () => readHeadRef(chtCorePath));
  await assertNoOperationInProgress(chtCorePath);

  // Refuse if there are unmerged paths (git stash would fail later).
  const { stdout: status } = await readBeforeStash('the status', () => runGit(['status', '--porcelain'], chtCorePath));
  const lines = status.split('\n').filter(Boolean);
  assertNoUnmergedPaths(lines, chtCorePath);
  // Before the dirty-tree branch: such an edit hides from status, so the tree can look clean.
  await assertNoAssumeUnchanged(chtCorePath);

  // Stash uncommitted work (if any) so the CLI sees a clean workspace.
  const head: SnapshotHead = { sha: headSha, ref: headRef };
  const stash = lines.length > 0 ? await stashOperatorWork(chtCorePath, lines, head, logPrefix) : null;
  const baselineUntracked = await readBaselineOrUndo(chtCorePath, stash, head, logPrefix);
  return snapshotOf(head, repoRoot, stash, baselineUntracked);
}

function snapshotOf(
  head: SnapshotHead,
  repoRoot: string,
  stash: TakenStash | null,
  baselineUntracked: string[],
): ChtCoreSnapshot {
  return {
    headSha: head.sha,
    headRef: head.ref,
    repoRoot,
    stashSha: stash?.sha ?? null,
    stashName: stash?.name ?? null,
    baselineUntracked,
    ...(stash ? { prePushUntracked: [...stash.prePush] } : {}),
  };
}

/**
 * Read AFTER the stash, so files that a stashed .gitignore edit unmasks count as
 * the operator's. Read even without a stash: `status.showUntrackedFiles=no` can
 * hide untracked files from the dirty check.
 *
 * If a read fails after a stash was taken, put the work back first: a snapshot
 * error must never leave the operator's work stranded in our stash.
 */
async function readBaselineOrUndo(
  chtCorePath: string,
  stash: TakenStash | null,
  head: SnapshotHead,
  logPrefix: string,
): Promise<string[]> {
  try {
    return [...await listUntracked(chtCorePath), ...await listIgnored(chtCorePath)];
  } catch (err) {
    if (!stash) throw readRefusal('the untracked and ignored files', err);
    return undoAfterReadFailure(chtCorePath, stash, head, err, logPrefix);
  }
}

/**
 * The baseline is required at runtime too: without it, the clean would delete
 * and the capture would claim every untracked file.
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
 * files).
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
  await assertHeadUnmoved(chtCorePath, preRunSha);
  // git diff --name-status against the pre-run SHA picks up tracked changes (M, A, D, R, ...)
  // but NOT untracked files. For untracked CREATEs the CLI made, we also need ls-files --others.
  // `-z` for the same reason as listUntracked: unquoted, NUL-delimited paths.
  const { stdout: nameList } = await runGit(['diff', '--name-status', '-z', preRunSha], chtCorePath);
  const untrackedNow = await listUntracked(chtCorePath);

  return [
    ...await collectTrackedChanges(nameList, chtCorePath, preRunSha),
    ...await collectUntrackedCreates(untrackedNow, chtCorePath, preRunSha, new Set(baselineUntracked)),
  ];
}

/** A commit made during the session (by the operator) is never session output. */
async function assertHeadUnmoved(chtCorePath: string, preRunSha: string): Promise<void> {
  const head = await readHeadSha(chtCorePath);
  if (head === preRunSha) return;
  const message =
    `HEAD moved from ${preRunSha} to ${head} during the session (a commit or a checkout), so cht-agent ` +
    'captured nothing: changes that come with a commit or a checkout are not session output.';
  throw new WorkspaceSafetyError('drift', message, { lines: [message] });
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

/**
 * Parse `git diff --name-status -z` output. Unlike the line/tab form, `-z` emits
 * a flat NUL-delimited token stream: `STATUS\0PATH\0` per entry, except renames
 * and copies (`R100`, `C75`) which emit `STATUS\0OLD\0NEW\0`. Consuming the extra
 * token is what keeps the parser in phase; a line-based split would treat the old
 * path as the next status and desynchronize the rest of the stream.
 */
function parseDiffNameStatusZ(nameList: string): DiffEntry[] {
  // Empty tokens only ever come from the trailing NUL: git emits neither an
  // empty status nor an empty path, so dropping them cannot desynchronize the
  // status/path pairing.
  const tokens = nameList.split('\0').filter(Boolean);
  const entries: DiffEntry[] = [];
  let i = 0;
  while (i < tokens.length) {
    const code = tokens[i].charAt(0);
    // R and C carry OLD then NEW; the NEW path is the one on disk now.
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
  // The operator's files are not ours to capture.
  for (const relPath of untrackedNow.filter(p => !isOperatorPath(p, baseline))) {
    const file = await readUntrackedCreate(chtCorePath, relPath, preRunSha);
    if (file) files.push(file);
  }
  return files;
}

async function readUntrackedCreate(
  chtCorePath: string,
  relPath: string,
  preRunSha: string,
): Promise<GeneratedFile | null> {
  if (relPath.endsWith('/')) {
    // A nested repo or gitfile dir: git lists it as one entry and never its files.
    console.warn(`[claude-code-cli] Not captured: ${relPath} (nested repository).`);
    return null;
  }
  return readChtCoreFile(chtCorePath, relPath, preRunSha, 'create');
}

async function readChtCoreFile(
  chtCorePath: string,
  relPath: string,
  preRunSha: string,
  action: 'create' | 'modify',
): Promise<GeneratedFile | null> {
  const fullPath = path.join(chtCorePath, relPath);
  if (!(await isRegularFile(fullPath, relPath))) return null;
  let content: string;
  try {
    content = await fs.readFile(fullPath, 'utf-8');
  } catch {
    // File vanished mid-capture or is binary; skip.
    return null;
  }

  const originalContent = action === 'modify'
    ? await readOriginalContent(chtCorePath, relPath, preRunSha)
    : undefined;

  return {
    path: relPath,
    content,
    purpose: action === 'create' ? 'CLI-created file' : 'CLI-modified file',
    originalContent,
  };
}

/**
 * Capture reads only regular files: a symlink would leak its target's content
 * (from outside cht-core, too) into HC2, and a dir or special file has no text.
 */
async function isRegularFile(fullPath: string, relPath: string): Promise<boolean> {
  try {
    if ((await fs.lstat(fullPath)).isFile()) return true;
    console.warn(`[claude-code-cli] Not captured: ${relPath} is not a regular file (a symlink, a directory or a special file).`);
  } catch {
    // It vanished mid-capture.
  }
  return false;
}

/** The pre-run content of a tracked file, or undefined when git cannot give it. */
async function readOriginalContent(
  chtCorePath: string,
  relPath: string,
  preRunSha: string,
): Promise<string | undefined> {
  try {
    const { stdout } = await runGit(['show', `${preRunSha}:${relPath}`], chtCorePath);
    return stdout;
  } catch (err) {
    // A truncated stdout must never stand in for the original content.
    if (isMaxBufferError(err)) {
      console.warn(`[claude-code-cli] ${relPath} is too large to read; original content omitted.`);
    }
    return undefined;
  }
}

/** Max pathspec entries per `git clean` invocation, to stay clear of OS arg limits. */
const CLEAN_PATHSPEC_CHUNK = 1000;

/**
 * Wrap a path so git treats it as a LITERAL filename, not an fnmatch glob.
 *
 * Without this, a session file named `pages/[id].tsx` is a bracket-expression
 * pathspec that also matches the operator's `pages/d.tsx`, so `git clean` deletes
 * both and exits 0. Same class for `*` and `?` in a filename. Every path we hand to git
 * for deletion comes from `ls-files` output, i.e. it is always a real filename.
 */
function toLiteralPathspec(relPath: string): string {
  return `:(literal)${relPath}`;
}

/**
 * Untracked paths that appeared DURING the session: everything untracked now
 * minus the operator's post-stash baseline. Only these may be deleted on
 * rollback.
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
  return untrackedNow.filter(p => !isOperatorPath(p, baseline));
}

/**
 * The delta paths still on disk (what "not removed" actually means). Only
 * ENOENT counts as removed: an EACCES/ENOTDIR/ELOOP failure means the clean did
 * NOT do its job. `lstat`, not `access`, so a surviving broken symlink is seen
 * as still-present rather than followed to nowhere. A dir entry (a nested repo
 * or gitfile dir, which `git clean -fd` never removes) always survives.
 */
async function pathsStillOnDisk(chtCorePath: string, deltaPaths: readonly string[]): Promise<string[]> {
  return pathsWhere(chtCorePath, deltaPaths, survivesClean);
}

/** The paths below chtCorePath for which `test` holds, in input order. */
async function pathsWhere(
  chtCorePath: string,
  relPaths: Iterable<string>,
  test: (fullPath: string) => Promise<boolean>,
): Promise<string[]> {
  const found: string[] = [];
  for (const relPath of relPaths) {
    if (await test(path.join(chtCorePath, relPath))) found.push(relPath);
  }
  return found;
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

async function isOnDisk(fullPath: string): Promise<boolean> {
  return !(await pathIsRemoved(fullPath));
}

/** `path.join` keeps the trailing `/` of a dir entry, which `git clean -fd` never removes. */
async function survivesClean(fullPath: string): Promise<boolean> {
  return fullPath.endsWith('/') || isOnDisk(fullPath);
}

/**
 * Per-op outcome of a rollback that passed its pre-checks (a pre-check drift
 * throws instead, and changes nothing). A failed reset or a failed restore
 * halts the run; only a failed clean is non-fatal. After a failed reset, the
 * clean and the pop are `skipped` on purpose: the stash stays in place, and the
 * operator recovers with the checklist.
 */
export interface RollbackResult {
  reset: 'ok' | 'failed';
  clean: 'ok' | 'failed' | 'skipped';
  stashPop: 'ok' | 'failed' | 'skipped';
  errors: string[];
  /** Tracked paths that still differ from the snapshot HEAD after a failed reset. */
  sessionEdits?: string[];
  /** Untracked session paths still on disk (the whole delta when the clean was skipped). */
  survivors?: string[];
  /**
   * After a failed restore: the untracked paths that appeared since the clean,
   * that is, the ones the failed restore wrote (the stash also holds them). The
   * clean survivors are not in it; they stay in `survivors`.
   */
  popResidue?: string[];
  /** After a failed restore: paths where the tree differs from the stash, which block a retry. */
  popBlockers?: string[];
  /** After a reset or restore failed on permissions: the dirs git cannot write in (up to the top level). */
  unwritableDirs?: string[];
  /** After a reset or restore failed on permissions: the listed files git cannot read. */
  unreadableFiles?: string[];
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
 * Whatever git's exit code, every delta path is then checked on disk: a zero
 * exit proves nothing (a nested repo is never removed), and a non-zero exit can
 * still have removed everything.
 */
async function cleanSessionCreatedFiles(
  chtCorePath: string,
  delta: readonly string[],
): Promise<{ survivors: string[]; gitErrors: string[] }> {
  // Keep going after a failing chunk: aborting would leave later chunks' session
  // files behind on top of whatever the failing chunk left. Report them together.
  const gitErrors: string[] = [];
  for (let i = 0; i < delta.length; i += CLEAN_PATHSPEC_CHUNK) {
    const chunk = delta.slice(i, i + CLEAN_PATHSPEC_CHUNK);
    await runGit(['clean', '-fd', '--', ...chunk.map(toLiteralPathspec)], chtCorePath)
      .catch((err: unknown) => { gitErrors.push(gitErrorText(err)); });
  }
  return { survivors: await pathsStillOnDisk(chtCorePath, delta), gitErrors };
}

/** At most this many paths go into one error line. */
const MAX_LISTED_PATHS = 20;

function summarizePaths(paths: readonly string[]): string {
  const listed = paths.slice(0, MAX_LISTED_PATHS).map(p => JSON.stringify(p)).join(', ');
  const more = paths.length - MAX_LISTED_PATHS;
  return more > 0 ? `${listed} and ${more} more` : listed;
}

/**
 * Non-fatal notes for the module output and HC2: session files the rollback
 * could not remove. Left in place, the next run's baseline would count them as
 * the operator's files, so the operator must see them.
 */
export function rollbackWarnings(rollback: RollbackResult): string[] {
  if (rollback.clean !== 'failed' || !rollback.survivors?.length) return [];
  return [
    'Rollback could not remove these session files. Remove them before the next run, or the next run ' +
      `treats them as your files: ${rollback.survivors.map(p => JSON.stringify(p)).join(', ')}`,
  ];
}

/**
 * Restore cht-core to the snapshot state: reset to HEAD, clean the files this
 * session created, restore the stash if one was created. First the pre-checks
 * run; when one fails, this throws `drift` and changes nothing. After a failed
 * reset, the clean and the restore are skipped and the stash stays. The reset
 * runs through the verify-then-throw helper so a non-zero exit that actually
 * succeeded does not generate a misleading warning. Returns a typed result the
 * caller turns into a halt (failed reset or restore) or warnings (failed clean).
 *
 * Residuals: the full list is in the description of PR #149. The two that operators will hit:
 *  - OVERWRITE: if the session overwrites a file that was untracked or ignored
 *    at snapshot, capture excludes it and rollback cannot restore its prior
 *    content, because it was never in the stash. The file keeps the session's
 *    content.
 *  - DELETE: if the session deletes such a file, it is gone for the same reason.
 */
export async function rollbackChtCore(
  chtCorePath: string,
  snapshot: ChtCoreSnapshot,
  options: WorkspaceCallOptions = {},
): Promise<RollbackResult> {
  const call: RestoreCall = {
    logPrefix: options.logPrefix ?? DEFAULT_LOG_PREFIX,
    resolve: options.resolveStashFailure,
    onSpareStash: options.onSpareStash,
  };
  await assertRollbackAllowed(chtCorePath, snapshot);
  const result: RollbackResult = { reset: 'ok', clean: 'ok', stashPop: 'skipped', errors: [] };

  await resetToSnapshot(chtCorePath, snapshot, result, call.logPrefix);
  if (result.reset === 'failed') {
    // A pop now would merge the operator's work into a half-reset tree, and a
    // later `reset --hard` would then destroy it. Leave the stash and the files.
    // No screen here, with or without a resolver: no pop and no retry.
    await recordResetFailureState(chtCorePath, snapshot, result);
  } else {
    await cleanAndRestore(chtCorePath, snapshot, result, call);
  }
  return result;
}

/** How the rollback prints, who answers a failed restore or drop (absent: headless), and the spare hook. */
interface RestoreCall {
  logPrefix: string;
  resolve?: StashFailureResolver;
  onSpareStash?: (sha: string) => void;
}

async function cleanAndRestore(
  chtCorePath: string,
  snapshot: ChtCoreSnapshot,
  result: RollbackResult,
  call: RestoreCall,
): Promise<void> {
  await cleanStep(chtCorePath, snapshot, result, call.logPrefix);
  if (snapshot.stashSha) await popStep(chtCorePath, snapshot, result, call);
}

const rolledBackSnapshots = new WeakSet<ChtCoreSnapshot>();

/**
 * Checks before anything destructive. Each failure throws `drift` and changes
 * nothing: a reset over a moved HEAD orphans or moves commits, and a reset plus
 * clean after the operator restored our stash destroys the restored work.
 * The snapshot counts as used only once every check passed, so a refused call
 * does not burn it.
 */
async function assertRollbackAllowed(chtCorePath: string, snapshot: ChtCoreSnapshot): Promise<void> {
  if (rolledBackSnapshots.has(snapshot)) {
    throw driftError(['This snapshot was already rolled back; nothing was changed.']);
  }
  let lines: string[] | null;
  try {
    lines = await firstDrift(chtCorePath, snapshot);
  } catch (err) {
    throw driftError([
      `cht-agent could not read the repo state before rollback (${gitErrorText(err)}); nothing was changed.`,
      ...stashNotRestoredLines(snapshot),
    ], err);
  }
  if (lines) throw driftError(lines);
  rolledBackSnapshots.add(snapshot);
}

function driftError(lines: string[], cause?: unknown): WorkspaceSafetyError {
  return new WorkspaceSafetyError('drift', lines[0], { lines, cause });
}

type DriftCheck = (chtCorePath: string, snapshot: ChtCoreSnapshot) => Promise<string[] | null>;

/** In order: the right repo at its top level, then HEAD and branch, then our stash. */
const DRIFT_CHECKS: readonly DriftCheck[] = [repoRootDrift, topLevelDrift, headDrift, stashDrift];

async function firstDrift(chtCorePath: string, snapshot: ChtCoreSnapshot): Promise<string[] | null> {
  for (const check of DRIFT_CHECKS) {
    const lines = await check(chtCorePath, snapshot);
    if (lines) return lines;
  }
  return null;
}

async function repoRootDrift(chtCorePath: string, snapshot: ChtCoreSnapshot): Promise<string[] | null> {
  const repoRoot = await readRepoRoot(chtCorePath);
  if (repoRoot === snapshot.repoRoot) return null;
  // No further reads: this is some other repo.
  return [`This snapshot belongs to ${snapshot.repoRoot}, not ${repoRoot}; nothing was changed.`];
}

/**
 * A subdirectory of the right repo passes the root check, but its listings are
 * relative to that subdirectory while the baseline is relative to the top
 * level, so the clean would take an operator file for a session file.
 */
async function topLevelDrift(chtCorePath: string, snapshot: ChtCoreSnapshot): Promise<string[] | null> {
  const prefix = (await runGit(['rev-parse', '--show-prefix'], chtCorePath)).stdout.trim();
  if (!prefix) return null;
  return [
    `Rollback must run at the top level of ${snapshot.repoRoot}, not at ${chtCorePath} ` +
      `(the subdirectory ${prefix}); nothing was changed.`,
  ];
}

async function headDrift(chtCorePath: string, snapshot: ChtCoreSnapshot): Promise<string[] | null> {
  const moved = await describeHeadMove(chtCorePath, snapshot);
  if (!moved) return null;
  return [
    moved,
    ...(await stashStateLines(chtCorePath, snapshot)),
    ...(await sessionStateLines(chtCorePath, snapshot)),
  ];
}

/**
 * Where the work is after a move, from a read of the stash list: the operator
 * may have popped our stash. Read only here, with a stash taken, so the other
 * checks read the list as before.
 */
async function stashStateLines(chtCorePath: string, snapshot: ChtCoreSnapshot): Promise<string[]> {
  if (!snapshot.stashSha) return [];
  let entries: StashEntry[];
  try {
    entries = await listStashes(chtCorePath);
  } catch {
    return stashNotRestoredLines(snapshot);
  }
  if (entries.some(e => e.sha === snapshot.stashSha)) return stashKeptLines(snapshot, chtCorePath);
  return [
    `Stash ${snapshot.stashName} is no longer in the stash list (popped or dropped outside cht-agent). If you ` +
      "restored it, your work is in the working tree together with the session's edits.",
  ];
}

/**
 * Where the work is when the stash list was not read: no claim that the entry
 * is still listed. The hint names the snapshot's repo, where the stash lives.
 */
function stashNotRestoredLines(snapshot: ChtCoreSnapshot): string[] {
  if (!snapshot.stashSha || !snapshot.stashName) return [];
  return stashHintLines(snapshot.repoRoot, snapshot.stashName);
}

function stashHintLines(hintPath: string, stashName: string): string[] {
  return [
    `cht-agent did not restore stash ${stashName}. Unless you restored it yourself, your uncommitted work is in it.`,
    ...recoveryHintLines(hintPath, stashName),
  ];
}

/** The reason line for each kind of move, true for that kind. */
async function describeHeadMove(chtCorePath: string, snapshot: ChtCoreSnapshot): Promise<string | null> {
  const head = await readHeadSha(chtCorePath);
  const headRef = await readHeadRef(chtCorePath);
  if (headRef !== snapshot.headRef) return checkoutChangeLine(snapshot, headRef, head);
  if (head !== snapshot.headSha) return headMoveLine(snapshot, head);
  return null;
}

function refLabel(ref: string | null): string {
  return ref ?? 'a detached HEAD';
}

/** A checkout of another branch (or a detach): a reset here would act on a checkout that is not ours. */
function checkoutChangeLine(snapshot: ChtCoreSnapshot, headRef: string | null, head: string): string {
  const commit = head === snapshot.headSha ? 'at the same commit' : `and HEAD moved from ${snapshot.headSha} to ${head}`;
  return `The checkout changed from ${refLabel(snapshot.headRef)} to ${refLabel(headRef)} (${commit}) during the ` +
    `session. cht-agent did not reset, clean or restore anything: a hard reset here would act on ` +
    `${refLabel(headRef)}, which is not the checkout that it snapshotted.`;
}

/** A commit, an amend, a reset or a checkout of another commit on the same ref. */
function headMoveLine(snapshot: ChtCoreSnapshot, head: string): string {
  return `HEAD moved from ${snapshot.headSha} to ${head} on ${refLabel(snapshot.headRef)} during the session ` +
    '(a commit, an amend, a reset or a checkout). cht-agent did not reset, clean or restore anything: a hard ' +
    `reset now would move HEAD back to ${snapshot.headSha}, and that can orphan commits made since.`;
}

async function stashDrift(chtCorePath: string, snapshot: ChtCoreSnapshot): Promise<string[] | null> {
  if (!snapshot.stashSha) return null;
  const entries = await listStashes(chtCorePath);
  if (entries.some(e => e.sha === snapshot.stashSha)) return null;
  return [
    `Stash ${snapshot.stashName} is no longer in the stash list (popped or dropped outside cht-agent). ` +
    'cht-agent did not reset, clean or restore anything.',
    "If you restored it, your work is in the working tree together with the session's edits.",
    ...(await sessionStateLines(chtCorePath, snapshot)),
  ];
}

/** Where the work is when rollback did not restore it, with the recovery hint when `hintPath` is given. */
function stashKeptLines(snapshot: ChtCoreSnapshot, hintPath?: string): string[] {
  if (!snapshot.stashName) return [];
  return [
    `Your uncommitted work is still in stash ${snapshot.stashName}. It was NOT restored.`,
    ...(hintPath ? recoveryHintLines(hintPath, snapshot.stashName) : []),
  ];
}

/** What the session left in the tree, for the operator to sort out by hand. */
async function sessionStateLines(chtCorePath: string, snapshot: ChtCoreSnapshot): Promise<string[]> {
  const listed = [
    ...(await listingLines('Tracked files that differ from HEAD:', () => trackedPathsDifferingFrom(chtCorePath, 'HEAD'))),
    ...(await listingLines(
      'Untracked files that appeared during the session:',
      () => computeCleanDelta(chtCorePath, snapshot.baselineUntracked),
    )),
  ];
  if (listed.length === 0) return [];
  return [...listed, 'Review these files yourself, and keep or remove each one.'];
}

async function listingLines(heading: string, read: () => Promise<string[]>): Promise<string[]> {
  try {
    return pathListLines(heading, await read());
  } catch (err) {
    return [`${heading} (could not list: ${gitErrorText(err)})`];
  }
}

async function resetToSnapshot(
  chtCorePath: string,
  snapshot: ChtCoreSnapshot,
  result: RollbackResult,
  logPrefix: string,
): Promise<void> {
  try {
    await gitExecVerifyOrThrow(
      ['reset', '--hard', snapshot.headSha],
      chtCorePath,
      // Verify RESTORATION, not HEAD identity: the pre-checks already proved
      // that HEAD is the snapshot's, so HEAD says nothing about a reset that
      // failed (a stale index.lock, say). `diff --quiet <sha> --` exits 0 only
      // when tracked content matches the snapshot; untracked files are the
      // clean step's job.
      () => gitSucceeds(['diff', '--quiet', snapshot.headSha, '--'], chtCorePath),
      `working tree matches ${snapshot.headSha}`,
      logPrefix,
    );
  } catch (err) {
    result.reset = 'failed';
    result.errors.push(`reset: ${gitErrorText(err)}`);
    console.warn(`${logPrefix} git reset --hard during rollback failed: ${gitErrorText(err)}`);
  }
}

/** Read-only: what the failed reset left, so the checklist can name it. */
async function recordResetFailureState(
  chtCorePath: string,
  snapshot: ChtCoreSnapshot,
  result: RollbackResult,
): Promise<void> {
  result.clean = 'skipped';
  result.sessionEdits = await readPathsForReport(
    () => trackedPathsDifferingFrom(chtCorePath, snapshot.headSha), 'tracked session edits', result,
  );
  result.survivors = await readPathsForReport(
    () => computeCleanDelta(chtCorePath, snapshot.baselineUntracked), 'session files', result,
  );
  await recordPermissionBlockers(
    chtCorePath, result, 'reset: ', [...(result.sessionEdits ?? []), ...(result.survivors ?? [])],
  );
}

/** When git's error for `step` is a permission error, record where the tree blocks it. */
async function recordPermissionBlockers(
  chtCorePath: string,
  result: RollbackResult,
  step: string,
  relPaths: readonly string[],
): Promise<void> {
  if (!errorTextOf(result, step).includes('Permission denied')) return;
  const blockers = await findPermissionBlockers(chtCorePath, relPaths);
  result.unwritableDirs = [...blockers.dirs];
  result.unreadableFiles = [...blockers.files];
}

function errorTextOf(result: RollbackResult, step: string): string {
  return result.errors.find(e => e.startsWith(step)) ?? '';
}

function recordedBlockers(rollback: RollbackResult): PermissionBlockers {
  return { dirs: rollback.unwritableDirs ?? [], files: rollback.unreadableFiles ?? [] };
}

async function readPathsForReport(
  read: () => Promise<string[]>,
  what: string,
  result: RollbackResult,
): Promise<string[] | undefined> {
  try {
    return await read();
  } catch (err) {
    result.errors.push(`could not list ${what}: ${gitErrorText(err)}`);
    return undefined;
  }
}

async function trackedPathsDifferingFrom(chtCorePath: string, sha: string): Promise<string[]> {
  const { stdout } = await runGit(['diff', '--name-only', '-z', sha, '--'], chtCorePath);
  return stdout.split('\0').filter(Boolean);
}

async function cleanStep(
  chtCorePath: string,
  snapshot: ChtCoreSnapshot,
  result: RollbackResult,
  logPrefix: string,
): Promise<void> {
  let outcome: { survivors: string[]; gitErrors: string[] };
  try {
    const delta = await computeCleanDelta(chtCorePath, snapshot.baselineUntracked);
    // Nothing of ours to remove: never run `git clean -fd --` with no paths, which
    // degenerates to a blanket clean.
    if (delta.length === 0) return;
    outcome = await cleanSessionCreatedFiles(chtCorePath, delta);
  } catch (err) {
    recordCleanFailure(result, gitErrorText(err), logPrefix);
    return;
  }
  recordCleanOutcome(result, outcome, logPrefix);
}

/** A clean failed only if a session path survived; the real paths go in the error, not chunk numbers. */
function recordCleanOutcome(
  result: RollbackResult,
  outcome: { survivors: string[]; gitErrors: string[] },
  logPrefix: string,
): void {
  if (outcome.survivors.length > 0) {
    result.survivors = outcome.survivors;
    const gitSaid = outcome.gitErrors.length > 0 ? `; git said: ${outcome.gitErrors.join('; ')}` : '';
    recordCleanFailure(result, `these session files are still on disk: ${summarizePaths(outcome.survivors)}${gitSaid}`, logPrefix);
    return;
  }
  if (outcome.gitErrors.length > 0) {
    console.warn(`${logPrefix} git clean -fd exited non-zero but session-created files were removed; continuing.`);
  }
}

function recordCleanFailure(result: RollbackResult, text: string, logPrefix: string): void {
  result.clean = 'failed';
  result.errors.push(`clean: ${text}`);
  console.warn(`${logPrefix} git clean -fd during rollback failed: ${text}`);
}

/**
 * Restore our stash by its SHA, then drop exactly that entry. `apply` + a
 * verified `drop`, not `pop stash@{N}`: the ref can come to name another entry
 * between the lookup and the pop, and `git stash pop <sha>` is rejected.
 */
async function popStep(
  chtCorePath: string,
  snapshot: ChtCoreSnapshot,
  result: RollbackResult,
  call: RestoreCall,
): Promise<void> {
  const stashSha = snapshot.stashSha as string;
  const errorsBefore = result.errors.length;
  try {
    await runGit(['stash', 'apply', '--index', stashSha], chtCorePath);
  } catch (err) {
    await recordPopFailure(chtCorePath, snapshot, result, err, call.logPrefix);
    await offerRestoreChoices({ chtCorePath, snapshot, result, call, errorsBefore });
    return;
  }
  result.stashPop = 'ok';
  await dropRestoredStash({ chtCorePath, snapshot, result, call });
}

/** A rollback that the operator ended with Abort at a screen: settleRollback throws this error. */
const rollbackHalts = new WeakMap<RollbackResult, WorkspaceSafetyError>();

/** What a screen inside the rollback works on. */
interface RollbackContext {
  chtCorePath: string;
  snapshot: ChtCoreSnapshot;
  result: RollbackResult;
  call: RestoreCall;
}

/** Everything a choice after a failed restore needs. */
interface RestoreContext extends RollbackContext {
  stash: TakenStash;
  /** The length of `result.errors` before the restore; a restore that is done after all cuts it back. */
  errorsBefore: number;
}

/**
 * Only with a resolver, and only with the pre-push listing, which the check
 * before a drop needs. Otherwise the failed restore stops the run as before.
 */
async function offerRestoreChoices(base: Omit<RestoreContext, 'stash'>): Promise<void> {
  const prePush = base.snapshot.prePushUntracked;
  const resolve = base.call.resolve;
  if (!resolve || !prePush) return;
  const stash: TakenStash = { sha: base.snapshot.stashSha as string, name: base.snapshot.stashName as string, prePush };
  await resolveRestoreFailure({ ...base, stash }, resolve);
}

/** A screen inside the rollback, with its own trailer; `moved` for the HEAD-moved variant. */
interface RollbackScreen extends FailureScreen {
  trailer: string;
  moved?: boolean;
}

/**
 * A failed restore with a resolver: show the pop checklist (the headless
 * lines), then act on the choice. "I handled it myself" checks the tree
 * against our entry. Abort keeps the error for settleRollback to throw.
 */
async function resolveRestoreFailure(ctx: RestoreContext, resolve: StashFailureResolver): Promise<void> {
  let screen = restoreScreen(ctx, []);
  let first = true;
  for (;;) {
    printScreen(screen, [screen.trailer], ctx.call.logPrefix, first);
    first = false;
    const choice = await askOperator(resolve, { step: 'restore', lines: shownLines(screen), choices: RESTORE_CHOICES });
    if (choice === 'abort') return keepAbort(ctx, await restoreAbortError(ctx, screen));
    const notBack = await RESTORE_ACTIONS[choice](ctx);
    if (!notBack) return;
    screen = await restoreScreenAgain(ctx, notBack);
  }
}

function restoreScreen(ctx: RestoreContext, reason: readonly string[]): RollbackScreen {
  const lines = buildRecoveryChecklist(ctx.chtCorePath, ctx.snapshot, ctx.result);
  return { error: new WorkspaceSafetyError('stash', lines[0], { lines }), reason, trailer: RESTORE_TRAILER };
}

function restoreHint(ctx: RollbackContext): StashHint {
  const { snapshot } = ctx;
  return {
    chtCorePath: ctx.chtCorePath,
    head: { sha: snapshot.headSha, ref: snapshot.headRef },
    hintPath: snapshot.repoRoot,
    stashName: snapshot.stashName as string,
  };
}

/** The checklist again, for the tree as it is now; when HEAD moved, the variant without the reset step. */
async function restoreScreenAgain(ctx: RestoreContext, reason: readonly string[]): Promise<RollbackScreen> {
  await refreshRestoreFailure(ctx);
  const screen = restoreScreen(ctx, reason);
  const variant = await headMovedVariant(restoreHint(ctx), screen.error);
  return variant ? { error: variant, reason: [], trailer: RESTORE_TRAILER_HEAD_MOVED, moved: true } : screen;
}

async function restoreAbortError(ctx: RestoreContext, screen: RollbackScreen): Promise<WorkspaceSafetyError> {
  if (screen.moved) return screen.error;
  return (await abortVariant(restoreHint(ctx), screen.error, ctx.call.logPrefix)) ?? screen.error;
}

function keepAbort(ctx: RollbackContext, error: WorkspaceSafetyError): void {
  rollbackHalts.set(ctx.result, markAbort(error));
}

/** Each gives null when the work is back (the result then says so), or the lines that say why not. */
const RESTORE_ACTIONS: Readonly<Record<'handled' | 'retry', (ctx: RestoreContext) => Promise<readonly string[] | null>>> = {
  handled: ctx => recheckRestore(ctx),
  retry: ctx => retryRestore(ctx),
};

/**
 * Retry after a failed restore, inside this rollback (the snapshot is used
 * already, so a second rollbackChtCore call would refuse): our entry still
 * listed and HEAD and the branch unchanged, then the undo's restore from the
 * stash (no reset), then the same check as "handled" before the drop.
 */
async function retryRestore(ctx: RestoreContext): Promise<readonly string[] | null> {
  const listed = await entryListed(ctx.chtCorePath, ctx.stash);
  if (typeof listed === 'string') return [listed];
  if (!listed) return recheckRestore(ctx);
  // An empty reason: the screen again shows the HEAD line itself.
  if (await headMovedSince(ctx.chtCorePath, restoreHint(ctx).head)) return [];
  try {
    await restoreFromStash(ctx.chtCorePath, ctx.stash.sha);
  } catch (err) {
    return [`The restore failed again: ${gitErrorText(err)}`];
  }
  return recheckRestore(ctx);
}

/**
 * "I handled it myself" after a failed restore: the tree must match our entry.
 * Listed and matching: done, then the drop. Gone and matching: done. Listed
 * and differing: the lines that say so. Gone and differing: the operator took
 * it; say so, and go on. Gives null when done.
 */
async function recheckRestore(ctx: RestoreContext): Promise<readonly string[] | null> {
  const { stash, result } = ctx;
  const state = await readRestoreState(ctx.chtCorePath, stash, new Set(result.survivors ?? []));
  if ('readLine' in state) return [state.readLine];
  if (state.differing.length === 0) return finishRestore(ctx, state.listed);
  if (state.listed) {
    return pathListLines(`The working tree does not match stash ${stash.name} yet. These paths differ:`, state.differing);
  }
  warnStashGone(ctx.chtCorePath, stash, state.differing, ctx.call.logPrefix);
  return finishRestore(ctx, false);
}

/** The restore is done: the result says so, and a listed entry is dropped (it is proven back). */
async function finishRestore(ctx: RestoreContext, listed: boolean): Promise<null> {
  const { result } = ctx;
  console.log(`${ctx.call.logPrefix} Your work is restored from stash ${ctx.stash.name}.`);
  result.stashPop = 'ok';
  result.errors.splice(ctx.errorsBefore);
  delete result.popResidue;
  delete result.popBlockers;
  delete result.unwritableDirs;
  delete result.unreadableFiles;
  if (listed) await dropRestoredStash(ctx);
  return null;
}

/** Before a screen shows again: what now blocks the printed restore (only W^3 files; the tree may have changed). */
async function refreshRestoreFailure(ctx: RestoreContext): Promise<void> {
  const { chtCorePath, result, stash } = ctx;
  const survivors = new Set(result.survivors ?? []);
  result.popResidue = await readPathsForReport(
    async () => (await stashUntrackedOnDisk(chtCorePath, stash.sha)).filter(p => !survivors.has(p)),
    'untracked files the failed restore wrote',
    result,
  );
  result.popBlockers = await readPathsForReport(
    () => stashBlockingPaths(chtCorePath, stash.sha), 'paths that block the restore', result,
  );
}

/** The drop after a proven restore. A spare entry left behind is a warning; with a resolver, a screen. */
async function dropRestoredStash(ctx: RollbackContext): Promise<void> {
  const { snapshot, call } = ctx;
  const sha = snapshot.stashSha as string;
  const drop = await dropStashWithError(ctx.chtCorePath, sha, call.logPrefix);
  if (drop.outcome === 'dropped') return;
  if (drop.outcome === 'kept') call.onSpareStash?.(sha);
  if (drop.outcome === 'kept' && call.resolve) return resolveSpareEntry(ctx, call.resolve, drop.error);
  console.warn(`${call.logPrefix} Your work is restored; the stash entry ${snapshot.stashName} is a spare copy.`);
}

/**
 * A spare entry after a good restore, with a resolver. "I handled it myself"
 * reads the list again. Abort keeps a `stash` error for settleRollback to
 * throw, with the work in the tree.
 */
async function resolveSpareEntry(ctx: RollbackContext, resolve: StashFailureResolver, dropError: unknown): Promise<void> {
  const lines = spareEntryLines(ctx.snapshot, dropError);
  let screen: FailureScreen = { error: new WorkspaceSafetyError('stash', lines[0], { lines }), reason: [] };
  let first = true;
  for (;;) {
    printScreen(screen, [RESTORE_TRAILER], ctx.call.logPrefix, first);
    first = false;
    const choice = await askOperator(resolve, { step: 'drop', lines: shownLines(screen), choices: RESTORE_CHOICES });
    if (choice === 'abort') return keepSpareAbort(ctx, screen.error);
    const stillListed = await SPARE_ACTIONS[choice](ctx);
    if (!stillListed) return;
    screen = { error: screen.error, reason: stillListed };
  }
}

/** Each gives null when our entry is gone, or the line that says why the screen shows again. */
const SPARE_ACTIONS: Readonly<Record<'handled' | 'retry', (ctx: RollbackContext) => Promise<string[] | null>>> = {
  handled: ctx => spareStillListed(ctx),
  retry: async ctx => {
    const drop = await dropStashBySha(ctx.chtCorePath, ctx.snapshot.stashSha as string, ctx.call.logPrefix);
    return drop === 'kept' ? [`cht-agent still could not remove stash ${ctx.snapshot.stashName} from the stash list.`] : null;
  },
};

function spareEntryLines(snapshot: ChtCoreSnapshot, dropError: unknown): string[] {
  return [
    `Your work is restored; the stash entry ${snapshot.stashName} is a spare copy.`,
    ...(dropError === undefined ? [] : [`cht-agent could not remove it from the stash list: ${gitErrorText(dropError)}`]),
  ];
}

/** Null when our entry is gone; otherwise the line that says why the screen shows again. */
async function spareStillListed(ctx: RollbackContext): Promise<string[] | null> {
  const { snapshot } = ctx;
  try {
    const listed = (await listStashes(ctx.chtCorePath)).some(e => e.sha === snapshot.stashSha);
    return listed ? [`Stash ${snapshot.stashName} is still in the stash list.`] : null;
  } catch (err) {
    return [`cht-agent could not read the stash list (${gitErrorText(err)}).`];
  }
}

/** Abort at a spare entry: the failed-clean warnings join the lines, or no one sees them after the halt. */
function keepSpareAbort(ctx: RollbackContext, shown: WorkspaceSafetyError): void {
  const warnings = rollbackWarnings(ctx.result);
  const lines = [...shown.lines, ...warnings];
  const error = new WorkspaceSafetyError('stash', lines[0], { lines });
  printLinesOf(error, warnings, ctx.call.logPrefix);
  keepAbort(ctx, error);
}

/** What a drop did: git confirmed it dropped our entry, our entry was not listed, or it stays. */
type DropOutcome = 'dropped' | 'missing' | 'kept';

/** Drop the entry whose commit is `sha`. `dropped` only when git confirms it dropped that one. */
async function dropStashBySha(chtCorePath: string, sha: string, logPrefix: string): Promise<DropOutcome> {
  return (await dropStashWithError(chtCorePath, sha, logPrefix)).outcome;
}

/** The drop, with git's error when it threw (the entry then stays). */
async function dropStashWithError(
  chtCorePath: string,
  sha: string,
  logPrefix: string,
): Promise<{ outcome: DropOutcome; error?: unknown }> {
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const outcome = await dropStashOnce(chtCorePath, sha, logPrefix);
      if (outcome !== 'retry') return { outcome };
    }
  } catch (error) {
    // The entry stays, and the caller reports it as a spare copy.
    return { outcome: 'kept', error };
  }
  return { outcome: 'kept' };
}

async function dropStashOnce(
  chtCorePath: string,
  sha: string,
  logPrefix: string,
): Promise<'dropped' | 'missing' | 'retry'> {
  const entries = await listStashes(chtCorePath);
  const ours = entries.find(e => e.sha === sha);
  if (!ours) return 'missing';
  // Without -q, so git prints the "Dropped <ref> (<sha>)" line we check.
  const { stdout } = await runGit(['stash', 'drop', ours.ref], chtCorePath);
  const dropped = /^Dropped \S+ \(([0-9a-f]+)\)$/m.exec(stdout)?.[1];
  if (dropped === sha) return 'dropped';
  // The list moved between our read and the drop (most often an operator push
  // on top): the drop took another entry, so put it back.
  if (dropped) await putBackDroppedEntry(chtCorePath, dropped, entries, logPrefix);
  return 'retry';
}

/**
 * Store an entry that our drop took by mistake back into the list, whether or
 * not our earlier read saw it. If that fails, name it, so the operator can.
 */
async function putBackDroppedEntry(
  chtCorePath: string,
  droppedSha: string,
  entries: readonly StashEntry[],
  logPrefix: string,
): Promise<void> {
  const message = entries.find(e => e.sha === droppedSha)?.message ?? await stashCommitSubject(chtCorePath, droppedSha);
  try {
    await runGit(['stash', 'store', '-m', message, droppedSha], chtCorePath);
  } catch (err) {
    console.error(
      `${logPrefix} cht-agent dropped another stash entry (${droppedSha}, "${message}") by mistake and ` +
        `could not store it back (${gitErrorText(err)}). Store it back with: ` +
        `git -C ${shellQuote(chtCorePath)} stash store -m ${shellQuote(message)} ${droppedSha}`,
    );
  }
}

/** For a pushed stash, the commit subject is the message that the list shows (`%gs`). */
async function stashCommitSubject(chtCorePath: string, sha: string): Promise<string> {
  try {
    return (await runGit(['log', '-1', '--format=%s', sha], chtCorePath)).stdout.trim();
  } catch {
    return `stash entry restored by cht-agent (${sha})`;
  }
}

/** Read-only: record why the restore failed and what now blocks a manual one. */
async function recordPopFailure(
  chtCorePath: string,
  snapshot: ChtCoreSnapshot,
  result: RollbackResult,
  err: unknown,
  logPrefix: string,
): Promise<void> {
  const stashSha = snapshot.stashSha as string;
  const text = gitErrorText(err);
  result.stashPop = 'failed';
  result.errors.push(`stash apply: ${text}`);
  const survivors = new Set(result.survivors ?? []);
  result.popResidue = await readPathsForReport(
    async () => (await computeCleanDelta(chtCorePath, snapshot.baselineUntracked)).filter(p => !survivors.has(p)),
    'untracked files the failed restore wrote',
    result,
  );
  result.popBlockers = await readPathsForReport(
    () => stashBlockingPaths(chtCorePath, stashSha), 'paths that block the restore', result,
  );
  await recordPermissionBlockers(
    chtCorePath, result, 'stash apply: ', [...(result.popBlockers ?? []), ...(result.popResidue ?? [])],
  );
  console.warn(
    `${logPrefix} git stash apply --index during rollback failed: ${text}. ` +
    `Your work is still in stash ${snapshot.stashName}.`
  );
}

/** Tracked paths whose content differs from the stash, plus its untracked files already on disk. */
async function stashBlockingPaths(chtCorePath: string, stashSha: string): Promise<string[]> {
  const { stdout } = await runGit(['diff', '--name-only', '--no-renames', '-z', stashSha, '--'], chtCorePath);
  const onDisk = await stashUntrackedOnDisk(chtCorePath, stashSha);
  return [...new Set([...stdout.split('\0').filter(Boolean), ...onDisk])];
}

/** The untracked files a `stash push -u` saved (its third parent), if any. */
async function stashUntrackedPaths(chtCorePath: string, stashSha: string): Promise<string[]> {
  if (!(await hasUntrackedCommit(chtCorePath, stashSha))) return [];
  const { stdout } = await runGit(['ls-tree', '-r', '-z', '--name-only', `${stashSha}^3`], chtCorePath);
  return stdout.split('\0').filter(Boolean);
}

/**
 * Whether the stash has a third parent (its untracked files). `rev-parse -q
 * --verify` exits 1 when there is none; any other failure is a failed read,
 * which must not pass for "no untracked files".
 */
async function hasUntrackedCommit(chtCorePath: string, stashSha: string): Promise<boolean> {
  try {
    await runGit(['rev-parse', '-q', '--verify', `${stashSha}^3`], chtCorePath);
    return true;
  } catch (err) {
    if ((err as { code?: unknown }).code === 1) return false;
    throw err;
  }
}

/** False only when the OS positively refuses write access. */
async function isWritableDir(dir: string): Promise<boolean> {
  try {
    await fs.access(dir, fsConstants.W_OK);
    return true;
  } catch (err) {
    return !['EACCES', 'EPERM', 'EROFS'].includes(String((err as NodeJS.ErrnoException)?.code));
  }
}

/**
 * Operator instructions for a rollback that did not finish, built only from
 * its outcome. Empty when nothing needs a manual step. Callers print them with
 * their own log prefix.
 */
export function buildRecoveryChecklist(
  chtCorePath: string,
  snapshot: ChtCoreSnapshot,
  rollback: RollbackResult,
): string[] {
  if (rollback.reset === 'failed') return resetFailureChecklist(chtCorePath, snapshot, rollback);
  if (rollback.stashPop === 'failed') return popFailureChecklist(chtCorePath, snapshot, rollback);
  return [];
}

/**
 * The halt error for a rollback that left the operator's work in the stash
 * (failed reset or failed restore), or null when the run may continue. A failed
 * clean alone is not a halt.
 */
function rollbackHaltError(
  moduleLabel: string,
  chtCorePath: string,
  snapshot: ChtCoreSnapshot,
  rollback: RollbackResult,
): WorkspaceSafetyError | null {
  // An Abort at a screen inside the rollback: its error was printed and marked there.
  const kept = rollbackHalts.get(rollback);
  if (kept) return kept;
  const kind = rollbackHaltKind(rollback);
  if (!kind) return null;
  return new WorkspaceSafetyError(
    kind,
    `${moduleLabel} rollback failed: ${rollback.errors.join('; ')}. ` +
      'Inspect the cht-core working tree before retrying.',
    { lines: buildRecoveryChecklist(chtCorePath, snapshot, rollback) },
  );
}

function rollbackHaltKind(rollback: RollbackResult): 'reset' | 'stash' | null {
  if (rollback.reset === 'failed') return 'reset';
  if (rollback.stashPop === 'failed') return 'stash';
  return null;
}

/** Who settles a rollback: the prefix and label for its lines, and what it rolled back. */
export interface RollbackCaller {
  logPrefix: string;
  label: string;
  chtCorePath: string;
  snapshot: ChtCoreSnapshot;
}

/**
 * Act on a rollback result for its caller. An incomplete rollback prints its
 * errors under the caller's prefix. A failed reset or restore prints its
 * checklist once and throws the halt; otherwise this returns the non-fatal
 * warnings (a failed clean). It takes the result and never rolls back itself.
 */
export function settleRollback(rollback: RollbackResult, caller: RollbackCaller): string[] {
  reportIncompleteRollback(rollback, caller.logPrefix);
  const halt = rollbackHaltError(caller.label, caller.chtCorePath, caller.snapshot, rollback);
  if (!halt) return rollbackWarnings(rollback);
  reportSafetyError(halt, caller.logPrefix);
  throw halt;
}

function reportIncompleteRollback(rollback: RollbackResult, logPrefix: string): void {
  if (rollback.reset !== 'failed' && rollback.clean !== 'failed' && rollback.stashPop !== 'failed') return;
  console.error(`${logPrefix} ROLLBACK INCOMPLETE; cht-core may be in an unexpected state:`);
  for (const e of rollback.errors) console.error(`${logPrefix}   - ${e}`);
}

/**
 * The safe order after a failed restore. The reset and the removal are safe
 * because the stash entry was not touched: it still holds all of the work that
 * the failed restore wrote only in part.
 */
function popFailureChecklist(
  chtCorePath: string,
  snapshot: ChtCoreSnapshot,
  rollback: RollbackResult,
): string[] {
  const residue = rollback.popResidue ?? [];
  const survivors = rollback.survivors ?? [];
  return [
    `Rollback could not restore your work: git stash apply --index failed. Your work is still in stash ${snapshot.stashName}.`,
    ...pathListLines('Paths that block the restore:', rollback.popBlockers),
    ...pathListLines('Untracked files the failed restore wrote (the stash also holds them):', residue),
    ...pathListLines('Session files the clean could not remove:', survivors),
    ...recoveryStepLines(chtCorePath, {
      cause: popCauseStep(rollback),
      headSha: snapshot.headSha,
      remove: [...residue, ...survivors],
      stashName: snapshot.stashName,
    }),
  ];
}

function popCauseStep(rollback: RollbackResult): string {
  return permissionCauseText(errorTextOf(rollback, 'stash apply: '), recordedBlockers(rollback), 'run the steps below');
}

/**
 * The safe order after a failed reset. `reset --hard` is safe here only because
 * the stash still holds the operator's work and nothing was popped into the tree.
 */
function resetFailureChecklist(
  chtCorePath: string,
  snapshot: ChtCoreSnapshot,
  rollback: RollbackResult,
): string[] {
  const survivors = rollback.survivors ?? [];
  return [
    'Rollback stopped: git reset --hard failed, so cht-agent did not clean or restore anything.',
    ...stashKeptLines(snapshot),
    ...pathListLines('Tracked files that still hold session edits:', rollback.sessionEdits),
    ...pathListLines('Session files still on disk:', survivors),
    ...recoveryStepLines(chtCorePath, {
      cause: resetCauseStep(rollback),
      headSha: snapshot.headSha,
      remove: survivors,
      stashName: snapshot.stashName,
    }),
    'Run cht-agent again only after your working tree is back to your own state.',
  ];
}

function resetCauseStep(rollback: RollbackResult): string {
  return permissionCauseText(errorTextOf(rollback, 'reset: '), recordedBlockers(rollback), 'run the steps below');
}

function pathListLines(heading: string, paths: readonly string[] | undefined): string[] {
  if (!paths || paths.length === 0) return [];
  return [heading, ...paths.map(p => `  - ${JSON.stringify(p)}`)];
}

/**
 * What a manual recovery must do: fix the cause, reset to `headSha`, remove
 * `remove` (or move `moveAside` out of the way), restore the stash.
 */
interface RecoveryPlan {
  cause: string;
  headSha: string;
  remove: readonly string[];
  moveAside?: readonly string[];
  stashName: string | null;
}

const RECOVERY_HEADING = 'To recover, run these steps in this order:';

/**
 * The numbered recovery steps, in the only safe order: the reset and the
 * removal come before the restore, because the stash still holds the work.
 */
function recoveryStepLines(chtCorePath: string, plan: RecoveryPlan): string[] {
  const steps = [
    plan.cause,
    `git -C ${shellQuote(chtCorePath)} reset --hard ${plan.headSha}`,
    ...removalSteps(chtCorePath, plan.remove),
    ...moveAsideSteps(plan.moveAside ?? []),
    ...(plan.stashName ? recoveryHintSteps(chtCorePath, plan.stashName) : []),
  ];
  return [
    RECOVERY_HEADING,
    ...steps.map((step, i) => `  ${i + 1}. ${step}`),
    ...(plan.stashName ? [RESTORE_WITHOUT_INDEX_NOTE] : []),
  ];
}

/**
 * The steps that remove these untracked paths: one scoped clean for the files,
 * and a by-hand step for dir entries (a nested repo, which git clean never removes).
 */
function removalSteps(chtCorePath: string, paths: readonly string[]): string[] {
  const files = paths.filter(p => !p.endsWith('/'));
  const dirs = paths.filter(p => p.endsWith('/'));
  const steps: string[] = [];
  if (files.length > 0) steps.push(literalCleanCommand(chtCorePath, files));
  if (dirs.length > 0) {
    steps.push(
      'Remove these directories by hand (git clean cannot remove a nested repository): ' +
        dirs.map(d => JSON.stringify(d)).join(', '),
    );
  }
  return steps;
}

/** Never a delete: cht-agent could not read the stash's copy of these files. */
function moveAsideSteps(files: readonly string[]): string[] {
  if (files.length === 0) return [];
  return [
    "Move these files out of the way before 'Restore it', and do not delete them: " +
      `${files.map(f => JSON.stringify(f)).join(', ')}. cht-agent could not read the stash's copy of them. ` +
      'After the restore, move back each file that the restore did not bring back.',
  ];
}

/** A clean of exactly these paths: each one a quoted `:(literal)` word, never a blanket clean. */
function literalCleanCommand(chtCorePath: string, paths: readonly string[]): string {
  const words = paths.map(p => shellQuote(toLiteralPathspec(p)));
  return `git -C ${shellQuote(chtCorePath)} clean -fd -- ${words.join(' ')}`;
}

