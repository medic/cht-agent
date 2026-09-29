/**
 * The operator's stash policy for this run.
 *
 * The CLI edge (dev.ts, full.ts) sets it once, after the leftover check at the
 * start of the run. The two workspace callers (the claude-code-cli module and
 * the claude-api compile gate) read it and pass it to the workspace helpers as
 * explicit options. The workspace helpers never read it, the env or a terminal.
 *
 * Lives here, in the style of shutdown.ts, so no new field has to travel
 * through the supervisor, the agent and the module input. A caller that never
 * sets it gets the default: no accepted leftovers and no resolver, which is
 * the headless behavior (a stash failure stops the run with its lines).
 */

import type { StashFailureResolver } from '../layers/code-gen/modules/claude-code-cli/workspace';

export interface StashPolicy {
  /** Leftover cht-agent stashes that the operator chose to keep ("Continue anyway"). */
  acceptedLeftoverShas: readonly string[];
  /** Asks the operator at a stash failure point. Absent without a terminal. */
  resolveStashFailure?: StashFailureResolver;
  /** Set only by the CLI edge: a spare copy of ours that the run proved joins the accepted SHAs. */
  onSpareStash?: (sha: string) => void;
}

const DEFAULT_POLICY: StashPolicy = Object.freeze({ acceptedLeftoverShas: Object.freeze([]) });

let policy: StashPolicy = DEFAULT_POLICY;

/** A frozen copy with no `undefined` keys, so no caller can change the policy after it is set. */
function frozenPolicy(next: StashPolicy): StashPolicy {
  return Object.freeze({
    acceptedLeftoverShas: Object.freeze([...next.acceptedLeftoverShas]),
    ...(next.resolveStashFailure ? { resolveStashFailure: next.resolveStashFailure } : {}),
    ...(next.onSpareStash ? { onSpareStash: next.onSpareStash } : {}),
  });
}

export function setStashPolicy(next: StashPolicy): void {
  policy = frozenPolicy(next);
}

/** A spare copy of our own entry that the run proved: later snapshots of the run skip it. */
export function acceptSpareStash(sha: string): void {
  if (policy.acceptedLeftoverShas.includes(sha)) return;
  policy = frozenPolicy({ ...policy, acceptedLeftoverShas: [...policy.acceptedLeftoverShas, sha] });
}

export function getStashPolicy(): StashPolicy {
  return policy;
}

/** Test-only reset. Do not call from production paths. */
export function __resetStashPolicyForTests(): void {
  policy = DEFAULT_POLICY;
}
