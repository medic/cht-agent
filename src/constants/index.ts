/**
 * Project-wide constants for the CHT Multi-Agent System
 */

import * as path from 'node:path';

/**
 * Default Kapa AI MCP server URL.
 * Override via the MCP_SERVER_URL environment variable.
 */
export const DEFAULT_MCP_SERVER_URL = 'https://mcp-docs.dev.medicmobile.org/mcp';

/**
 * The 8 functional domains of the CHT project.
 * Used by the memory pipeline (distiller, filter) and knowledge utilities.
 */
export const CHT_DOMAINS = [
  'authentication', 'contacts', 'forms-and-reports', 'tasks-and-targets',
  'messaging', 'data-sync', 'configuration', 'interoperability',
] as const;

/** Audit log for PRs that were skipped or flagged during pipeline processing. */
export const DEFAULT_PIPELINE_LOG_PATH = path.join(
  __dirname, '..', '..', 'agent-memory', '_skipped.ndjson'
);

/** Output directory for pending knowledge drafts awaiting review. */
export const DEFAULT_PIPELINE_OUTPUT_DIR = path.join(
  __dirname, '..', '..', 'agent-memory', '_pending'
);
