/**
 * Global shutdown coordination.
 *
 * SIGINT/SIGTERM set a flag that long-running loops check between iterations,
 * so they can exit cleanly without losing in-flight file writes.
 *
 * Modules that initiate long work (the code-gen agent) call
 * installShutdownHandlers() once. Consumers (any module inside a retry loop)
 * call isShutdownRequested() between iterations.
 *
 * Lives here, not in the agent, to avoid circular imports between the agent
 * and the code-gen module (the module needs the flag too).
 */

let shutdownRequested = false;
let installed = false;

export function installShutdownHandlers(): void {
  if (installed) return;
  installed = true;
  const set = (): void => { shutdownRequested = true; };
  process.once('SIGINT', set);
  process.once('SIGTERM', set);
}

export function isShutdownRequested(): boolean {
  return shutdownRequested;
}

/** Test-only reset. Do not call from production paths. */
export function __resetShutdownForTests(): void {
  shutdownRequested = false;
  installed = false;
}
