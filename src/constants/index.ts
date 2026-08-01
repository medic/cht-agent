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
 * The functional domains of the CHT project.
 * Used by the memory pipeline (distiller, filter) and knowledge utilities.
 */
export const CHT_DOMAINS = [
  'authentication', 'contacts', 'forms-and-reports', 'tasks-and-targets',
  'messaging', 'data-sync', 'configuration', 'interoperability', 'infrastructure',
  'data-access',
] as const;

/**
 * Cross-domain workflow processes and technical workstreams.
 * Mirrors the CHTWorkflow type and the schema.json CHTWorkflow enum — keep in sync.
 */
export const CHT_WORKFLOWS = [
  'form-submission', 'user-registration', 'contact-creation', 'task-scheduling',
  'message-processing', 'data-migration', 'ui-extensions', 'nouveau-search', 'observability',
] as const;

/**
 * CHT services. Mirrors the CHTService type and the schema.json CHTService enum
 * — the taxonomy-schema-sync test asserts they stay equal.
 */
export const CHT_SERVICES = ['api', 'webapp', 'sentinel', 'admin'] as const;

/** Audit log for PRs that were skipped or flagged during pipeline processing. */
export const DEFAULT_PIPELINE_LOG_PATH = path.join(
  __dirname, '..', '..', 'agent-memory', '_skipped.ndjson'
);

/** Output directory for pending knowledge drafts awaiting review. */
export const DEFAULT_PIPELINE_OUTPUT_DIR = path.join(
  __dirname, '..', '..', 'agent-memory', '_pending'
);
/**
 * Default OpenDeepWiki MCP server base URL.
 * Repo-specific query parameters (?owner=medic&name=<repo>) are appended per request.
 * Override via the DEEPWIKI_MCP_URL environment variable.
 */
export const DEFAULT_DEEPWIKI_MCP_URL = 'https://opendeepwiki.dev.medicmobile.org/api/mcp';

/**
 * Default GitHub organization that owns the CHT repositories indexed in OpenDeepWiki.
 */
export const DEFAULT_DEEPWIKI_REPO_OWNER = 'medic';
