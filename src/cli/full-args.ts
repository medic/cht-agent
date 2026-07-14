/**
 * Argument parsing for the full-workflow CLI (`src/cli/full.ts`).
 *
 * Kept in its own module so it can be unit-tested without importing the CLI
 * entrypoint (which runs the workflow on import).
 */

export interface CliArgs {
  verbose: boolean;
  ticketPath: string | null;
}

/**
 * Parse CLI flags and the positional ticket path from argv. Flags are
 * position-independent, so `--verbose` may appear before or after the ticket.
 */
export function parseCliArgs(argv: string[]): CliArgs {
  const args = argv.slice(2);
  const verbose = args.includes('--verbose') || args.includes('-v');
  const ticketPath = args.find((arg) => !arg.startsWith('-')) ?? null;
  return { verbose, ticketPath };
}
