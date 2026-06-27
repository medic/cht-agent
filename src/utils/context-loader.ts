/**
 * Context file loader utilities
 * Handles loading domain contexts, workflow contexts, and resolved issues
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as yaml from 'js-yaml';
import {
  DomainComponents,
  DomainOverviewMetadata,
  WorkflowComponents,
  ResolvedIssueContext,
  CHTDomain,
  CHTLayer,
  ConfigArtifact,
  ConfigMechanism,
} from '../types';
import { CHT_LAYERS, CONFIG_ARTIFACTS, CONFIG_MECHANISMS } from '../constants';

const AGENT_MEMORY_PATH = path.join(process.cwd(), 'agent-memory');

/**
 * Parse YAML frontmatter from markdown files
 */
export const parseFrontmatter = (content: string): { metadata: Record<string, unknown>; body: string } => {
  const frontmatterRegex = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;
  const match = frontmatterRegex.exec(content);

  if (!match) {
    return { metadata: {}, body: content };
  }

  const [, frontmatter, body] = match;

  // Parse YAML using js-yaml with JSON_SCHEMA to prevent auto date conversion
  let metadata: Record<string, unknown> = {};
  try {
    const parsed = yaml.load(frontmatter, { schema: yaml.JSON_SCHEMA });
    if (parsed && typeof parsed === 'object') {
      metadata = parsed as Record<string, unknown>;
    }
  } catch (error) {
    // If YAML parsing fails, return empty metadata
    console.warn('Failed to parse YAML frontmatter:', error);
  }

  return { metadata, body };
};

/**
 * Load domain overview
 */
export const loadDomainOverview = (
  domain: CHTDomain
): { metadata: DomainOverviewMetadata; content: string } | null => {
  const overviewPath = path.join(AGENT_MEMORY_PATH, 'domains', domain, 'overview.md');

  if (!fs.existsSync(overviewPath)) {
    return null;
  }

  const content = fs.readFileSync(overviewPath, 'utf-8');
  const { metadata, body } = parseFrontmatter(content);

  return {
    metadata: metadata as unknown as DomainOverviewMetadata,
    content: body,
  };
};

/**
 * Load domain components
 */
export const loadDomainComponents = (domain: CHTDomain): DomainComponents | null => {
  const componentsPath = path.join(AGENT_MEMORY_PATH, 'domains', domain, 'components.json');

  if (!fs.existsSync(componentsPath)) {
    return null;
  }

  const content = fs.readFileSync(componentsPath, 'utf-8');
  return JSON.parse(content) as DomainComponents;
};

/**
 * Load workflow components
 */
export const loadWorkflowComponents = (workflow: string): WorkflowComponents | null => {
  const workflowPath = path.join(
    AGENT_MEMORY_PATH,
    'workflows',
    workflow,
    'involved-components.json'
  );

  if (!fs.existsSync(workflowPath)) {
    return null;
  }

  const content = fs.readFileSync(workflowPath, 'utf-8');
  return JSON.parse(content) as WorkflowComponents;
};

/**
 * Load workflow flow documentation
 */
export const loadWorkflowFlow = (
  workflow: string
): { metadata: Record<string, unknown>; content: string } | null => {
  const flowPath = path.join(AGENT_MEMORY_PATH, 'workflows', workflow, 'flow.md');

  if (!fs.existsSync(flowPath)) {
    return null;
  }

  const content = fs.readFileSync(flowPath, 'utf-8');
  const { metadata, body } = parseFrontmatter(content);

  return { metadata, content: body };
};

/**
 * Find resolved issues by domain. Reads the memory-pipeline drafts at
 * `domains/<domain>/issues/*.md` and maps their frontmatter onto ResolvedIssueContext.
 */
export const findResolvedIssuesByDomain = (domain: CHTDomain): ResolvedIssueContext[] => {
  const draftsPath = path.join(AGENT_MEMORY_PATH, 'domains', domain, 'issues');

  if (!fs.existsSync(draftsPath)) {
    return [];
  }

  return scanDraftsForIssues(draftsPath, domain);
};

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

const asEnum = <T extends string>(value: unknown, allowed: readonly T[]): T | undefined =>
  typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined;

// Map a promoted-draft's frontmatter onto ResolvedIssueContext. Drafts come from merged
// issues, so phase is 'completed'; tags are folded into components so overlap scoring has
// signal against a ticket's technical context. Config fields are only set for cht-conf
// drafts (layer defaults to cht-core, preserving today's behavior).
function mapDraftToResolvedIssue(
  metadata: Record<string, unknown>,
  domain: CHTDomain
): ResolvedIssueContext {
  const services = asStringArray(metadata.services);
  const tags = asStringArray(metadata.tags);
  const has = (svc: string) => (services.includes(svc) ? [svc] : []);

  const layer = asEnum<CHTLayer>(metadata.layer, CHT_LAYERS) ?? 'cht-core';

  return {
    id: typeof metadata.id === 'string' ? metadata.id : `cht-core-${metadata.issueNumber ?? 'unknown'}`,
    issue_number: typeof metadata.issueNumber === 'number' ? metadata.issueNumber : undefined,
    timestamp: typeof metadata.lastUpdated === 'string' ? metadata.lastUpdated : '',
    category: typeof metadata.category === 'string' ? metadata.category : 'unknown',
    domains: [typeof metadata.domain === 'string' ? (metadata.domain as CHTDomain) : domain],
    phase: 'completed',
    task_id: typeof metadata.source_pr === 'string' ? metadata.source_pr : String(metadata.id ?? ''),
    summary: typeof metadata.summary === 'string' ? metadata.summary : '',
    tech_stack: asStringArray(metadata.techStack),
    components: {
      api: has('api'),
      webapp: has('webapp'),
      sentinel: has('sentinel'),
      shared_libs: [...has('admin'), ...tags],
    },
    tags,
    layer,
    configArtifact: asEnum<ConfigArtifact>(metadata.configArtifact, CONFIG_ARTIFACTS),
    mechanism: asEnum<ConfigMechanism>(metadata.mechanism, CONFIG_MECHANISMS),
  };
}

function parseDraftIssue(filePath: string, domain: CHTDomain): ResolvedIssueContext | null {
  const { metadata } = parseFrontmatter(fs.readFileSync(filePath, 'utf-8'));
  if (!metadata.domain && metadata.issueNumber === undefined) {
    return null;
  }
  return mapDraftToResolvedIssue(metadata, domain);
}

function scanDraftsForIssues(dirPath: string, domain: CHTDomain): ResolvedIssueContext[] {
  return fs
    .readdirSync(dirPath, { withFileTypes: true })
    .flatMap(entry => {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) return scanDraftsForIssues(fullPath, domain);
      if (!entry.name.endsWith('.md')) return [];
      const issue = parseDraftIssue(fullPath, domain);
      return issue ? [issue] : [];
    });
}

/**
 * Load index file
 */
export const loadIndex = (indexName: string): Record<string, unknown> | null => {
  const indexPath = path.join(AGENT_MEMORY_PATH, 'indices', `${indexName}.json`);

  if (!fs.existsSync(indexPath)) {
    return null;
  }

  const content = fs.readFileSync(indexPath, 'utf-8');
  return JSON.parse(content);
};

/**
 * Get related domains for a given domain
 */
export const getRelatedDomains = (domain: CHTDomain): CHTDomain[] => {
  const overview = loadDomainOverview(domain);
  if (!overview?.metadata.related_domains) {
    return [];
  }

  return overview.metadata.related_domains as CHTDomain[];
};

/**
 * Check if agent-memory directory exists, create if not
 */
export const ensureAgentMemoryExists = () => {
  const dirs = [
    'domains',
    'workflows',
    'infrastructure',
    'knowledge-base/resolved-issues/by-domain',
    'knowledge-base/resolved-issues/by-workflow',
    'knowledge-base/patterns',
    'agent-workspaces/research-supervisor',
    'agent-workspaces/code-generation-agent',
    'agent-workspaces/test-environment-agent',
    'indices',
  ];

  dirs.forEach((dir) => {
    const fullPath = path.join(AGENT_MEMORY_PATH, dir);
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
    }
  });
};
