/**
 * Project-wide constants for the CHT Multi-Agent System
 */

/**
 * Default Kapa AI MCP server URL.
 * Override via the MCP_SERVER_URL environment variable.
 */
export const DEFAULT_MCP_SERVER_URL = 'https://mcp-docs.dev.medicmobile.org/mcp';

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
