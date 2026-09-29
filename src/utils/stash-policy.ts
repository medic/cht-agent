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
 * sets it gets the default: no accepted leftovers, which is the headless
 * behavior (a leftover stash stops the run with its lines).
 */

export interface StashPolicy {
  /** Leftover cht-agent stashes that the operator chose to keep ("Continue anyway"). */
  acceptedLeftoverShas: readonly string[];
}

const DEFAULT_POLICY: StashPolicy = Object.freeze({ acceptedLeftoverShas: Object.freeze([]) });

let policy: StashPolicy = DEFAULT_POLICY;

/** Store a frozen copy, so no caller can change the policy after it is set. */
export function setStashPolicy(next: StashPolicy): void {
  policy = Object.freeze({ acceptedLeftoverShas: Object.freeze([...next.acceptedLeftoverShas]) });
}

export function getStashPolicy(): StashPolicy {
  return policy;
}

/** Test-only reset. Do not call from production paths. */
export function __resetStashPolicyForTests(): void {
  policy = DEFAULT_POLICY;
}
