/**
 * The stash screen at the CLI edge (dev.ts, full.ts).
 *
 * At the start of a run, before any LLM call, it checks the git version, then
 * looks for leftover cht-agent stashes. Below the oldest supported git it stops
 * the run, unless CHT_AGENT_ALLOW_OLD_GIT is true and the git is 2.31 or later.
 * For a leftover, on a terminal it asks what to do. Without one it stops the
 * run, unless CHT_AGENT_IGNORE_LEAKED_STASH is true. During the run, on a
 * terminal, it asks what to do at a stash failure point. The workspace helpers
 * never read the env or a terminal: this module reads both and hands the result
 * to them through the stash policy holder.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline/promises';
import {
  ALLOW_OLD_GIT_ENV,
  GitVersion,
  LeftoverStash,
  MIN_GIT_VERSION,
  StashChoice,
  StashFailureResolver,
  WorkspaceSafetyError,
  canOverrideGitFloor,
  gitFloorLines,
  isBelowGitFloor,
  leftoverStashLines,
  listLeftoverStashes,
  readGitVersion,
  reportSafetyError,
} from '../layers/code-gen/modules/claude-code-cli/workspace';
import { acceptSpareStash, setStashPolicy } from '../utils/stash-policy';

const LOG = '[cht-agent]';

/** The headless override of the leftover check: on only for `true` (any case, spaces trimmed). */
export const IGNORE_LEAKED_STASH_ENV = 'CHT_AGENT_IGNORE_LEAKED_STASH';

/** Shows numbered labels and gives the chosen index, or null when the input closed or on Ctrl-C. */
export type AskChoice = (question: string, labels: readonly string[]) => Promise<number | null>;

export interface ScreenIo {
  /** True only when stdin is a terminal. Never ask without one: an ask at EOF exits 0. */
  interactive: boolean;
  ask: AskChoice;
  env: Readonly<Record<string, string | undefined>>;
}

function parseChoice(answer: string, count: number): number | null {
  const n = Number(answer.trim());
  return Number.isInteger(n) && n >= 1 && n <= count ? n - 1 : null;
}

function menuText(question: string, labels: readonly string[]): string {
  return [question, ...labels.map((label, i) => `  ${i + 1}) ${label}`), `Type 1 to ${labels.length}: `].join('\n');
}

/** Ask until the answer is a listed number. A rejected question (Ctrl-D on a terminal) is null. */
async function askUntilValid(
  rl: readline.Interface,
  firstPrompt: string,
  count: number,
  stopped: Promise<null>,
): Promise<number | null> {
  let prompt = firstPrompt;
  for (;;) {
    const answer = await Promise.race([rl.question(prompt).catch(() => null), stopped]);
    if (answer === null) return null;
    const choice = parseChoice(answer, count);
    if (choice !== null) return choice;
    prompt = `Please type a number from 1 to ${count}: `;
  }
}

/**
 * Ask on the terminal. A closed input and Ctrl-C give null, which the callers
 * read as "Abort". Without a terminal it gives null at once: a question on an
 * ended stdin never settles, and node then exits 0 in silence.
 */
export async function askChoice(question: string, labels: readonly string[]): Promise<number | null> {
  if (process.stdin.isTTY !== true) return null;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  // rl.close() and an EOF leave question() pending, so these settle the answer.
  const stopped = new Promise<null>(resolve => {
    rl.once('close', () => resolve(null));
    rl.once('SIGINT', () => resolve(null));
  });
  try {
    return await askUntilValid(rl, menuText(question, labels), labels.length, stopped);
  } finally {
    rl.close();
  }
}

function isTrue(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === 'true';
}

/** The claude-api gate skips a path that is not a git checkout, so the check does too. */
function isGitCheckout(chtCorePath: string): boolean {
  return fs.existsSync(path.join(chtCorePath, '.git'));
}

/**
 * A failed read does not stop the run: the snapshot reads the version again
 * before it stashes anything, and refuses there.
 */
async function readGitVersionOrWarn(chtCorePath: string): Promise<GitVersion | null> {
  try {
    return await readGitVersion(chtCorePath);
  } catch (err) {
    if (!(err instanceof WorkspaceSafetyError)) throw err;
    console.warn(`${LOG} ${err.message} The run goes on: cht-agent reads the git version again before it stashes anything.`);
    return null;
  }
}

/**
 * The git version check at the start of a run. Gives true when the git is below
 * MIN_GIT_VERSION and CHT_AGENT_ALLOW_OLD_GIT is true (it printed the warning).
 * Below MIN_OVERRIDE_GIT_VERSION the env var has no effect: every snapshot
 * refuses there, so the run stops here, before any LLM call. It never asks, so
 * a terminal changes nothing. Throws a `precondition` WorkspaceSafetyError to
 * stop the run.
 */
export async function runGitFloorCheck(chtCorePath: string, env: ScreenIo['env']): Promise<boolean> {
  if (!isGitCheckout(chtCorePath)) return false;
  const version = await readGitVersionOrWarn(chtCorePath);
  if (!version || !isBelowGitFloor(version)) return false;
  const lines = gitFloorLines(version);
  if (!isTrue(env[ALLOW_OLD_GIT_ENV]) || !canOverrideGitFloor(version)) {
    throw new WorkspaceSafetyError('precondition', lines[0], { lines });
  }
  console.warn(
    `${LOG} git ${version.text} is older than ${MIN_GIT_VERSION}. ${ALLOW_OLD_GIT_ENV}=true: the run goes on at your own risk.`,
  );
  console.warn(`${LOG} ${lines[1]}`);
  return true;
}

/**
 * A failed read does not stop the run: the snapshot reads the stash list again
 * before it stashes anything, and refuses a leftover there.
 */
async function readLeftoversOrWarn(chtCorePath: string): Promise<LeftoverStash[]> {
  try {
    return await listLeftoverStashes(chtCorePath);
  } catch (err) {
    if (!(err instanceof WorkspaceSafetyError)) throw err;
    console.warn(`${LOG} ${err.message} The run goes on: cht-agent reads the stash list again before it stashes anything.`);
    return [];
  }
}

const LEFTOVER_LABELS = [
  'I restored it myself, continue',
  'Continue anyway (the stash stays; this run never pops or drops it)',
  'Abort',
] as const;

/** The lines, then the choices. "Abort" throws the error that was shown, so it prints only once. */
async function askLeftoverChoice(
  chtCorePath: string,
  entries: readonly LeftoverStash[],
  ask: AskChoice,
): Promise<'restored' | 'continue'> {
  const lines = leftoverStashLines(chtCorePath, entries);
  const shown = new WorkspaceSafetyError('precondition', lines[0], { lines });
  reportSafetyError(shown, LOG);
  const index = await ask('What do you want to do?', LEFTOVER_LABELS);
  if (index === 0) return 'restored';
  if (index === 1) return 'continue';
  throw shown;
}

async function leftoverScreen(chtCorePath: string, first: LeftoverStash[], ask: AskChoice): Promise<string[]> {
  let entries = first;
  while (entries.length > 0) {
    if ((await askLeftoverChoice(chtCorePath, entries, ask)) === 'continue') return entries.map(e => e.sha);
    entries = await readLeftoversOrWarn(chtCorePath);
  }
  return [];
}

function headlessLeftovers(
  chtCorePath: string,
  entries: readonly LeftoverStash[],
  env: ScreenIo['env'],
): string[] {
  const lines = leftoverStashLines(chtCorePath, entries);
  if (!isTrue(env[IGNORE_LEAKED_STASH_ENV])) {
    const stop = 'No terminal to ask on, so the run stops. To continue and leave the stash in place, set ' +
      `${IGNORE_LEAKED_STASH_ENV}=true.`;
    throw new WorkspaceSafetyError('precondition', lines[0], { lines: [...lines, stop] });
  }
  for (const line of lines) console.warn(`${LOG} ${line}`);
  console.warn(`${LOG} ${IGNORE_LEAKED_STASH_ENV}=true: continuing. The stash stays, and this run never pops or drops it.`);
  return entries.map(e => e.sha);
}

/**
 * The leftover check at the start of a run. Gives the SHAs that the operator
 * chose to keep ("Continue anyway", or the env override without a terminal).
 * Throws a `precondition` WorkspaceSafetyError to stop the run.
 */
export async function runLeftoverCheck(chtCorePath: string, io: ScreenIo): Promise<string[]> {
  if (!isGitCheckout(chtCorePath)) return [];
  const entries = await readLeftoversOrWarn(chtCorePath);
  if (entries.length === 0) return [];
  return io.interactive ? leftoverScreen(chtCorePath, entries, io.ask) : headlessLeftovers(chtCorePath, entries, io.env);
}

const FAILURE_LABELS: Readonly<Record<StashChoice, string>> = {
  handled: 'I handled it myself',
  retry: 'Retry',
  abort: 'Abort',
};

/**
 * The resolver for the stash failure points, or undefined without a terminal
 * (the workspace helpers then stop the run with their lines). The helpers print
 * the lines first; this only asks. A closed input or Ctrl-C means Abort.
 */
export function makeStashFailureResolver(io: Pick<ScreenIo, 'interactive' | 'ask'>): StashFailureResolver | undefined {
  if (!io.interactive) return undefined;
  return async failure => {
    const index = await io.ask('What do you want to do?', failure.choices.map(c => FAILURE_LABELS[c]));
    return index === null ? 'abort' : failure.choices[index] ?? 'abort';
  };
}

function terminalIo(): ScreenIo {
  return { interactive: process.stdin.isTTY === true, ask: askChoice, env: process.env };
}

/** Run the git version check and the leftover check, then set this run's stash policy. Call before any LLM call. */
export async function prepareStashPolicy(chtCorePath: string, io: ScreenIo = terminalIo()): Promise<void> {
  const allowOldGit = await runGitFloorCheck(chtCorePath, io.env);
  setStashPolicy({
    acceptedLeftoverShas: await runLeftoverCheck(chtCorePath, io),
    resolveStashFailure: makeStashFailureResolver(io),
    onSpareStash: acceptSpareStash,
    allowOldGit,
  });
}
