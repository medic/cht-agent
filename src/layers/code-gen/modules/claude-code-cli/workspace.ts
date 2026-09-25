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
import { constants as fsConstants } from 'node:fs';
import * as path from 'node:path';
import { CodeGenHaltError, GeneratedFile } from '../../interface';
import { readEnv } from '../../../../utils/env';

const execFileAsync = promisify(execFile);

/**
 * What a workspace safety stop means for the operator's tree:
 *  - precondition: the snapshot refused before it changed anything;
 *  - stash: a stash step failed or was incomplete;
 *  - drift: the repo changed under the session, so rollback did nothing;
 *  - reset: rollback could not reset the tree, so it left the stash in place.
 */
export type WorkspaceSafetyKind = 'precondition' | 'stash' | 'drift' | 'reset';

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
export function shellQuote(word: string): string {
  return `'${word.replaceAll("'", String.raw`'\''`)}'`;
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
 * inside our git calls. Passed through the env, not `-c`, so the argv (and every
 * spec stub keyed on it) stays unchanged; git treats both forms the same.
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

/** Env flag read, tolerant of casing and stray whitespace. */
function isFlagEnabled(name: string): boolean {
  return readEnv(name)?.trim().toLowerCase() === 'true';
}

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
    `Find the stash: git -C ${repo} stash list --format='%gd  %cr  %gs' | grep -E ${pattern}`,
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
   * already in the operator's working tree and are NOT ours. Capture and rollback
   * both work against this baseline so the cycle reasons about a session DELTA
   * rather than absolute repo state.
   *
   * Entries include the paths that were IGNORED at snapshot time, so a session
   * that changes an ignore rule cannot turn an operator file into session output.
   * An entry that ends in `/` covers its whole subtree (see isOperatorPath).
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
  // Anchored: our stash message always ENDS with the marker plus a timestamp, so a
  // user stash that merely mentions the marker ("wip after cht-agent-claude-code-cli
  // crash") is not a false positive. Report every match, not just the first: a real
  // leak can sit underneath a user stash, and naming the wrong one sends the
  // operator to the wrong place.
  const leaked = (await listStashes(chtCorePath)).filter(e => LEAKED_STASH_LINE.test(e.message));
  if (leaked.length === 0) return;
  const names = leaked.map(e => leakedStashName(e.message));
  const listed = leaked.map((e, i) => `${names[i]} (created ${new Date(e.createdAt * 1000).toISOString()})`);
  // Not "from an interrupted run": the stash can belong to a run that is still
  // active on this checkout.
  throw new Error([
    `cht-core at ${chtCorePath} has ${leaked.length} leftover cht-agent stash(es) that no run ` +
      `restored: ${listed.join('; ')}. It may hold your uncommitted work, or belong to another ` +
      'cht-agent run that is still active here.',
    ...names.flatMap(n => recoveryHintSteps(chtCorePath, n)),
    RESTORE_WITHOUT_INDEX_NOTE,
    'Or re-run with CHT_AGENT_IGNORE_LEAKED_STASH=true to proceed and leave it in place.',
  ].join('\n'));
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
  const parts = 'RC'.includes(line[0]) ? body.split(' -> ') : [body];
  return parts.map(part => unquote(part.trim()));
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
): Promise<void> {
  try {
    await runGit(args, cwd);
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
  headSha: string,
): Promise<TakenStash> {
  warnOnIgnoreRuleEdits(statusLines, chtCorePath);
  const name = `${STASH_MARKER_PREFIX}${Date.now()}`;
  const prePush = await listUntracked(chtCorePath);
  // Exit codes lie both ways: non-zero on a removal warning after a complete
  // stash, zero with nothing saved (a dirty submodule) or a partial clean.
  const pushError = await runGit(['stash', 'push', '-u', '-m', name], chtCorePath)
    .then(() => undefined, (err: unknown) => err);
  const ours = findStashByName(await listStashes(chtCorePath), name);
  const leftovers = await stashLeftovers(chtCorePath, prePush);
  if (!ours) throw await stashNotCreatedError(chtCorePath, pushError, leftovers, prePush);
  const stash: TakenStash = { sha: ours.sha, name, prePush };
  if (leftovers.length > 0) {
    await undoStash(chtCorePath, stash, headSha);
    throw await partialStashError(chtCorePath, pushError, leftovers, prePush);
  }

  // Print recovery up front: if the process is hard-killed before rollback, these
  // lines are the operator's only pointer to their stashed work.
  console.log(`[claude-code-cli] Stashed your uncommitted work as "${name}". If this run is interrupted:`);
  for (const line of recoveryHintLines(chtCorePath, name)) console.log(`[claude-code-cli]   ${line}`);
  return stash;
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
  const survivors: string[] = [];
  for (const relPath of prePush.filter(p => !p.endsWith('/'))) {
    if (!(await pathIsRemoved(path.join(chtCorePath, relPath)))) survivors.push(relPath);
  }
  return [...statusZPaths(stdout), ...survivors];
}

/** Paths in `status --porcelain=v1 -z` output; a rename or copy carries its old path as an extra token. */
function statusZPaths(stdout: string): string[] {
  const tokens = stdout.split('\0').filter(Boolean);
  const paths: string[] = [];
  let i = 0;
  while (i < tokens.length) {
    paths.push(tokens[i].slice(3));
    i += 'RC'.includes(tokens[i][0]) ? 2 : 1;
  }
  return paths;
}

async function stashNotCreatedError(
  chtCorePath: string,
  pushError: unknown,
  leftovers: readonly string[],
  prePush: readonly string[],
): Promise<WorkspaceSafetyError> {
  const text = pushError === undefined
    ? 'git stash push exited 0 but saved nothing (for example, changes inside a submodule, which git stash does not save)'
    : gitErrorText(pushError);
  const lines = [
    `git stash could not save your uncommitted work, so nothing was stashed and your tree is unchanged: ${text}`,
    ...pathListLines('Changes that were not stashed:', leftovers),
    ...(await permissionLines(chtCorePath, text, [...leftovers, ...prePush])),
  ];
  return new WorkspaceSafetyError('stash', lines[0], { lines, cause: pushError });
}

async function partialStashError(
  chtCorePath: string,
  pushError: unknown,
  leftovers: readonly string[],
  prePush: readonly string[],
): Promise<WorkspaceSafetyError> {
  const text = pushError === undefined ? 'git stash push exited 0' : gitErrorText(pushError);
  const lines = [
    `git stash did not clear these paths, so cht-agent put your work back and stopped (${text}):`,
    ...pathListLines('Paths the stash left:', leftovers).slice(1),
    ...(await permissionLines(chtCorePath, text, [...leftovers, ...prePush])),
  ];
  return new WorkspaceSafetyError('stash', lines[0], { lines, cause: pushError });
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

/**
 * Put the tree back exactly as it was before the push, from our stash commit W
 * (worktree from W, index from W^2, untracked files from W^3), then drop W.
 * Not `stash pop`, which fails on these half-cleaned states, and not
 * `checkout W^3 --`, which stages. Only the differing paths are restored, so a
 * read-only dir whose files did not change is never written. W is dropped only
 * once the tree is proven back; otherwise it stays and this throws `stash`.
 */
async function undoStash(chtCorePath: string, stash: TakenStash, headSha: string): Promise<void> {
  let differing: string[];
  try {
    await restoreFromStash(chtCorePath, stash.sha);
    differing = await pathsNotRestored(chtCorePath, stash);
  } catch (err) {
    throw await undoFailedError(chtCorePath, stash, headSha, [`(the restore failed: ${gitErrorText(err)})`], err);
  }
  if (differing.length > 0) throw await undoFailedError(chtCorePath, stash, headSha, differing);
  if (await dropStashBySha(chtCorePath, stash.sha)) return;
  console.warn(`[claude-code-cli] Your work is restored; the stash entry ${stash.name} is a spare copy.`);
}

async function restoreFromStash(chtCorePath: string, sha: string): Promise<void> {
  const worktree = await zPaths(chtCorePath, ['diff', '--name-only', '--no-renames', '-z', sha, '--']);
  await restorePaths(chtCorePath, sha, '--worktree', worktree);
  const index = await zPaths(chtCorePath, ['diff', '--cached', '--name-only', '--no-renames', '-z', `${sha}^2`, '--']);
  await restorePaths(chtCorePath, `${sha}^2`, '--staged', index);
  const missing: string[] = [];
  for (const relPath of await stashUntrackedPaths(chtCorePath, sha)) {
    if (await pathIsRemoved(path.join(chtCorePath, relPath))) missing.push(relPath);
  }
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
 */
async function pathsNotRestored(chtCorePath: string, stash: TakenStash): Promise<string[]> {
  const tracked = await zPaths(chtCorePath, ['diff', '--name-only', '--no-renames', '--ignore-submodules=all', '-z', stash.sha, '--']);
  const staged = await zPaths(
    chtCorePath, ['diff', '--cached', '--name-only', '--no-renames', '--ignore-submodules=all', '-z', `${stash.sha}^2`, '--'],
  );
  const untracked = await untrackedEntriesNotRestored(chtCorePath, stash.sha);
  const now = new Set(await listUntracked(chtCorePath));
  const before = new Set(stash.prePush);
  const extra = [...now].filter(p => !before.has(p));
  const gone = [...before].filter(p => !now.has(p));
  return [...new Set([...tracked, ...staged, ...untracked, ...extra, ...gone])];
}

async function untrackedEntriesNotRestored(chtCorePath: string, sha: string): Promise<string[]> {
  if (!(await gitSucceeds(['rev-parse', '-q', '--verify', `${sha}^3`], chtCorePath))) return [];
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

/** The undo could not prove the tree is back: keep the stash, and say how to finish by hand. */
async function undoFailedError(
  chtCorePath: string,
  stash: TakenStash,
  headSha: string,
  differing: readonly string[],
  cause?: unknown,
): Promise<WorkspaceSafetyError> {
  const onDisk: string[] = [];
  for (const relPath of await stashUntrackedPaths(chtCorePath, stash.sha).catch(() => [])) {
    if (!(await pathIsRemoved(path.join(chtCorePath, relPath)))) onDisk.push(relPath);
  }
  const steps = [`git -C ${shellQuote(chtCorePath)} reset --hard ${headSha}`];
  if (onDisk.length > 0) steps.push(literalCleanCommand(chtCorePath, onDisk));
  steps.push(...recoveryHintSteps(chtCorePath, stash.name));
  const lines = [
    `git stash did not complete, and cht-agent could not fully put your work back. Your work is still in stash ${stash.name}.`,
    ...pathListLines('These paths do not match what the stash holds (cht-agent did not delete any of them):', differing),
    'The rest of your work is already back in the working tree.',
    'To recover, run these steps in this order:',
    ...steps.map((step, i) => `  ${i + 1}. ${step}`),
    RESTORE_WITHOUT_INDEX_NOTE,
  ];
  return new WorkspaceSafetyError('stash', lines[0], { lines, cause });
}

/**
 * Refuse a path below the repo toplevel: every path we read, capture and clean
 * is toplevel-relative, and a subdirectory would put the operator's files
 * outside the baseline. A symlink to the toplevel is fine (the prefix is empty).
 */
async function assertAtToplevel(chtCorePath: string): Promise<void> {
  const { stdout } = await runGit(['rev-parse', '--show-prefix'], chtCorePath);
  const prefix = stdout.trim();
  if (!prefix) return;
  const message =
    `${chtCorePath} is the subdirectory ${prefix} of a git repo, not its top level; refuse to run ` +
    'claude-code-cli. Point CHT_CORE_PATH at the repo root.';
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
  const { stdout } = await runGit(
    ['rev-parse', '--path-format=absolute', ...IN_PROGRESS_MARKERS.flatMap(m => ['--git-path', m])],
    chtCorePath,
  );
  const found: string[] = [];
  for (const markerPath of stdout.split('\n').filter(Boolean)) {
    if (!(await pathIsRemoved(markerPath))) found.push(path.basename(markerPath));
  }
  if (found.length === 0) return;
  const message =
    `cht-core at ${chtCorePath} is in the middle of a git operation (${found.join(', ')}); refuse to ` +
    'run claude-code-cli. Finish or abort that operation, then run again.';
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
export async function snapshotChtCore(chtCorePath: string): Promise<ChtCoreSnapshot> {
  await assertAtToplevel(chtCorePath);
  // A leftover stash from an interrupted run holds the operator's work; stashing
  // on top of it would bury it deeper.
  await assertNoLeakedStash(chtCorePath);

  const repoRoot = await readRepoRoot(chtCorePath);
  const headSha = await readHeadSha(chtCorePath);
  const headRef = await readHeadRef(chtCorePath);
  await assertNoOperationInProgress(chtCorePath);

  // Refuse if there are unmerged paths (git stash would fail later).
  const { stdout: status } = await runGit(['status', '--porcelain'], chtCorePath);
  const lines = status.split('\n').filter(Boolean);
  assertNoUnmergedPaths(lines, chtCorePath);

  // Stash uncommitted work (if any) so the CLI sees a clean workspace.
  const stash = lines.length > 0 ? await stashOperatorWork(chtCorePath, lines, headSha) : null;
  const baselineUntracked = await readBaselineOrUndo(chtCorePath, stash, headSha);

  return {
    headSha, headRef, repoRoot, stashSha: stash?.sha ?? null, stashName: stash?.name ?? null, baselineUntracked,
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
  headSha: string,
): Promise<string[]> {
  try {
    return [...await listUntracked(chtCorePath), ...await listIgnored(chtCorePath)];
  } catch (err) {
    if (!stash) throw err;
    await undoStash(chtCorePath, stash, headSha);
    const message =
      `The snapshot failed after the stash (${gitErrorText(err)}); cht-agent put your work back, ` +
      'so nothing was changed.';
    throw new WorkspaceSafetyError('precondition', message, { cause: err, lines: [message] });
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
 * files). Without that subtraction, pre-existing files are reported as
 * session-generated and an HC2 approve would write them back into cht-core.
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
    `HEAD moved from ${preRunSha} to ${head} during the session, so cht-agent captured nothing: ` +
    'a commit made during the session is not session output.';
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
 * rollback. A blanket `git clean -fd` would also delete pre-existing untracked
 * files that the stash never captured, which is unrecoverable.
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
  const survivors: string[] = [];
  for (const relPath of deltaPaths) {
    if (relPath.endsWith('/') || !(await pathIsRemoved(path.join(chtCorePath, relPath)))) survivors.push(relPath);
  }
  return survivors;
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
 * After a failed reset, the clean and the pop are `skipped` on purpose: the
 * stash stays in place, and the operator recovers with the checklist.
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
  /** After a failed restore: untracked paths it wrote (they are also in the stash). */
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
 * Always restore cht-core to the snapshot state: reset to HEAD, clean the files
 * this session created, restore the stash if one was created. The reset runs
 * through the verify-then-throw helper so a non-zero exit that actually
 * succeeded does not generate a misleading warning. Returns a typed result the
 * orchestrator inspects to emit a recovery checklist when the reset or the
 * restore failed.
 *
 * Residuals: the full list is on #140. The two that operators will hit:
 *  - OVERWRITE: if the session overwrites a file that was untracked or ignored
 *    at snapshot, capture excludes it and rollback cannot restore its prior
 *    content, because it was never in the stash. The file keeps the session's
 *    content.
 *  - DELETE: if the session deletes such a file, it is gone for the same reason.
 */
export async function rollbackChtCore(
  chtCorePath: string,
  snapshot: ChtCoreSnapshot,
): Promise<RollbackResult> {
  await assertRollbackAllowed(chtCorePath, snapshot);
  const result: RollbackResult = { reset: 'ok', clean: 'ok', stashPop: 'skipped', errors: [] };

  await resetToSnapshot(chtCorePath, snapshot, result);
  if (result.reset === 'failed') {
    // A pop now would merge the operator's work into a half-reset tree, and a
    // later `reset --hard` would then destroy it. Leave the stash and the files.
    await recordResetFailureState(chtCorePath, snapshot, result);
    return result;
  }
  await cleanStep(chtCorePath, snapshot, result);
  if (snapshot.stashSha) await popStep(chtCorePath, snapshot, result);
  return result;
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
    throw driftError(
      [`cht-agent could not read the repo state before rollback (${gitErrorText(err)}); nothing was changed.`],
      err,
    );
  }
  if (lines) throw driftError(lines);
  rolledBackSnapshots.add(snapshot);
}

function driftError(lines: string[], cause?: unknown): WorkspaceSafetyError {
  return new WorkspaceSafetyError('drift', lines[0], { lines, cause });
}

type DriftCheck = (chtCorePath: string, snapshot: ChtCoreSnapshot) => Promise<string[] | null>;

/** In order: the right repo, then HEAD and branch, then our stash. */
const DRIFT_CHECKS: readonly DriftCheck[] = [repoRootDrift, headDrift, stashDrift];

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

async function headDrift(chtCorePath: string, snapshot: ChtCoreSnapshot): Promise<string[] | null> {
  const moved = await describeHeadMove(chtCorePath, snapshot);
  if (!moved) return null;
  return [
    `${moved} cht-agent did not reset, clean or restore anything: a hard reset now would move or orphan commits.`,
    ...stashKeptLines(chtCorePath, snapshot),
    ...(await sessionStateLines(chtCorePath, snapshot)),
  ];
}

async function describeHeadMove(chtCorePath: string, snapshot: ChtCoreSnapshot): Promise<string | null> {
  const head = await readHeadSha(chtCorePath);
  if (head !== snapshot.headSha) return `HEAD moved from ${snapshot.headSha} to ${head} during the session.`;
  const headRef = await readHeadRef(chtCorePath);
  if (headRef === snapshot.headRef) return null;
  return `The branch changed from ${snapshot.headRef ?? 'a detached HEAD'} to ${headRef ?? 'a detached HEAD'} during the session.`;
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

function stashKeptLines(chtCorePath: string, snapshot: ChtCoreSnapshot): string[] {
  if (!snapshot.stashName) return [];
  return [
    `Your uncommitted work is still in stash ${snapshot.stashName}. It was NOT restored.`,
    ...recoveryHintLines(chtCorePath, snapshot.stashName),
  ];
}

/** What the session left in the tree, for the operator to sort out by hand. */
async function sessionStateLines(chtCorePath: string, snapshot: ChtCoreSnapshot): Promise<string[]> {
  return [
    ...(await listingLines('Tracked files that differ from HEAD:', () => trackedPathsDifferingFrom(chtCorePath, 'HEAD'))),
    ...(await listingLines(
      'Untracked files that appeared during the session:',
      () => computeCleanDelta(chtCorePath, snapshot.baselineUntracked),
    )),
    'Review these files yourself, and keep or remove each one.',
  ];
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
    );
  } catch (err) {
    result.reset = 'failed';
    result.errors.push(`reset: ${gitErrorText(err)}`);
    console.warn(`[claude-code-cli] git reset --hard during rollback failed: ${gitErrorText(err)}`);
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
): Promise<void> {
  let outcome: { survivors: string[]; gitErrors: string[] };
  try {
    const delta = await computeCleanDelta(chtCorePath, snapshot.baselineUntracked);
    // Nothing of ours to remove: never run `git clean -fd --` with no paths, which
    // degenerates to a blanket clean.
    if (delta.length === 0) return;
    outcome = await cleanSessionCreatedFiles(chtCorePath, delta);
  } catch (err) {
    recordCleanFailure(result, gitErrorText(err));
    return;
  }
  recordCleanOutcome(result, outcome);
}

/** A clean failed only if a session path survived; the real paths go in the error, not chunk numbers. */
function recordCleanOutcome(result: RollbackResult, outcome: { survivors: string[]; gitErrors: string[] }): void {
  if (outcome.survivors.length > 0) {
    result.survivors = outcome.survivors;
    const gitSaid = outcome.gitErrors.length > 0 ? `; git said: ${outcome.gitErrors.join('; ')}` : '';
    recordCleanFailure(result, `these session files are still on disk: ${summarizePaths(outcome.survivors)}${gitSaid}`);
    return;
  }
  if (outcome.gitErrors.length > 0) {
    console.warn('[claude-code-cli] git clean -fd exited non-zero but session-created files were removed; continuing.');
  }
}

function recordCleanFailure(result: RollbackResult, text: string): void {
  result.clean = 'failed';
  result.errors.push(`clean: ${text}`);
  console.warn(`[claude-code-cli] git clean -fd during rollback failed: ${text}`);
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
): Promise<void> {
  const stashSha = snapshot.stashSha as string;
  try {
    await runGit(['stash', 'apply', '--index', stashSha], chtCorePath);
  } catch (err) {
    await recordPopFailure(chtCorePath, snapshot, result, err);
    return;
  }
  result.stashPop = 'ok';
  if (await dropStashBySha(chtCorePath, stashSha)) return;
  console.warn(
    `[claude-code-cli] Your work is restored; the stash entry ${snapshot.stashName} is a spare copy.`
  );
}

/** Drop the entry whose commit is `sha`. True only when git confirms it dropped that one. */
async function dropStashBySha(chtCorePath: string, sha: string): Promise<boolean> {
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const outcome = await dropStashOnce(chtCorePath, sha);
      if (outcome !== 'retry') return outcome === 'dropped';
    }
  } catch {
    // Fall through: the entry stays, and the caller reports it as a spare copy.
  }
  return false;
}

async function dropStashOnce(chtCorePath: string, sha: string): Promise<'dropped' | 'missing' | 'retry'> {
  const entries = await listStashes(chtCorePath);
  const ours = entries.find(e => e.sha === sha);
  if (!ours) return 'missing';
  // Without -q, so git prints the "Dropped <ref> (<sha>)" line we check.
  const { stdout } = await runGit(['stash', 'drop', ours.ref], chtCorePath);
  const dropped = /^Dropped \S+ \(([0-9a-f]+)\)$/m.exec(stdout)?.[1];
  if (dropped === sha) return 'dropped';
  // The list moved between our read and the drop: put the other entry back.
  const other = entries.find(e => e.sha === dropped);
  if (other) await runGit(['stash', 'store', '-m', other.message, other.sha], chtCorePath);
  return 'retry';
}

/** Read-only: record why the restore failed and what now blocks a manual one. */
async function recordPopFailure(
  chtCorePath: string,
  snapshot: ChtCoreSnapshot,
  result: RollbackResult,
  err: unknown,
): Promise<void> {
  const stashSha = snapshot.stashSha as string;
  const text = gitErrorText(err);
  result.stashPop = 'failed';
  result.errors.push(`stash apply: ${text}`);
  result.popResidue = await readPathsForReport(
    () => computeCleanDelta(chtCorePath, snapshot.baselineUntracked), 'untracked files the failed restore wrote', result,
  );
  result.popBlockers = await readPathsForReport(
    () => stashBlockingPaths(chtCorePath, stashSha), 'paths that block the restore', result,
  );
  await recordPermissionBlockers(
    chtCorePath, result, 'stash apply: ', [...(result.popBlockers ?? []), ...(result.popResidue ?? [])],
  );
  console.warn(
    `[claude-code-cli] git stash apply --index during rollback failed: ${text}. ` +
    `Your work is still in stash ${snapshot.stashName}.`
  );
}

/** Tracked paths whose content differs from the stash, plus its untracked files already on disk. */
async function stashBlockingPaths(chtCorePath: string, stashSha: string): Promise<string[]> {
  const { stdout } = await runGit(['diff', '--name-only', '--no-renames', '-z', stashSha, '--'], chtCorePath);
  const onDisk: string[] = [];
  for (const relPath of await stashUntrackedPaths(chtCorePath, stashSha)) {
    if (!(await pathIsRemoved(path.join(chtCorePath, relPath)))) onDisk.push(relPath);
  }
  return [...new Set([...stdout.split('\0').filter(Boolean), ...onDisk])];
}

/** The untracked files a `stash push -u` saved (its third parent), if any. */
async function stashUntrackedPaths(chtCorePath: string, stashSha: string): Promise<string[]> {
  if (!(await gitSucceeds(['rev-parse', '-q', '--verify', `${stashSha}^3`], chtCorePath))) return [];
  const { stdout } = await runGit(['ls-tree', '-r', '-z', '--name-only', `${stashSha}^3`], chtCorePath);
  return stdout.split('\0').filter(Boolean);
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
export function rollbackHaltError(
  moduleLabel: string,
  chtCorePath: string,
  snapshot: ChtCoreSnapshot,
  rollback: RollbackResult,
): WorkspaceSafetyError | null {
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
  const steps = [popCauseStep(rollback), `git -C ${shellQuote(chtCorePath)} reset --hard ${snapshot.headSha}`];
  if (residue.length > 0) steps.push(literalCleanCommand(chtCorePath, residue));
  steps.push(...recoveryHintSteps(chtCorePath, String(snapshot.stashName)));
  return [
    `Rollback could not restore your work: git stash apply --index failed. Your work is still in stash ${snapshot.stashName}.`,
    ...pathListLines('Paths that block the restore:', rollback.popBlockers),
    ...pathListLines('Untracked files the failed restore wrote (the stash also holds them):', residue),
    'To recover, run these steps in this order:',
    ...steps.map((step, i) => `  ${i + 1}. ${step}`),
    RESTORE_WITHOUT_INDEX_NOTE,
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
  const steps = [
    resetCauseStep(rollback),
    `git -C ${shellQuote(chtCorePath)} reset --hard ${snapshot.headSha}`,
  ];
  if (survivors.length > 0) steps.push(literalCleanCommand(chtCorePath, survivors));
  if (snapshot.stashName) steps.push(...recoveryHintSteps(chtCorePath, snapshot.stashName));
  return [
    'Rollback stopped: git reset --hard failed, so cht-agent did not clean or restore anything.',
    ...stashStillHeldLines(snapshot),
    ...pathListLines('Tracked files that still hold session edits:', rollback.sessionEdits),
    ...pathListLines('Session files still on disk:', survivors),
    'To recover, run these steps in this order:',
    ...steps.map((step, i) => `  ${i + 1}. ${step}`),
    ...(snapshot.stashName ? [RESTORE_WITHOUT_INDEX_NOTE] : []),
    'Run cht-agent again only after your working tree is back to your own state.',
  ];
}

function stashStillHeldLines(snapshot: ChtCoreSnapshot): string[] {
  if (!snapshot.stashName) return [];
  return [`Your uncommitted work is still in stash ${snapshot.stashName}. It was NOT restored.`];
}

function resetCauseStep(rollback: RollbackResult): string {
  return permissionCauseText(errorTextOf(rollback, 'reset: '), recordedBlockers(rollback), 'run the steps below');
}

function pathListLines(heading: string, paths: readonly string[] | undefined): string[] {
  if (!paths || paths.length === 0) return [];
  return [heading, ...paths.map(p => `  - ${JSON.stringify(p)}`)];
}

/** A clean of exactly these paths: each one a quoted `:(literal)` word, never a blanket clean. */
function literalCleanCommand(chtCorePath: string, paths: readonly string[]): string {
  const words = paths.map(p => shellQuote(toLiteralPathspec(p)));
  return `git -C ${shellQuote(chtCorePath)} clean -fd -- ${words.join(' ')}`;
}

