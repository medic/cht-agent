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
} from '../types';

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
 * Find resolved issues by domain
 */
export const findResolvedIssuesByDomain = (domain: CHTDomain): ResolvedIssueContext[] => {
  const domainPath = path.join(
    AGENT_MEMORY_PATH,
    'knowledge-base',
    'resolved-issues',
    'by-domain',
    domain
  );

  if (!fs.existsSync(domainPath)) {
    return [];
  }

  return scanDirectoryForIssues(domainPath);
};

function parseCompletedIssue(filePath: string): ResolvedIssueContext | null {
  const content = fs.readFileSync(filePath, 'utf-8');
  const { metadata } = parseFrontmatter(content);
  return metadata.phase === 'completed'
    ? metadata as unknown as ResolvedIssueContext
    : null;
}

function processEntry(dirPath: string, entry: fs.Dirent): ResolvedIssueContext[] {
  const fullPath = path.join(dirPath, entry.name);
  if (entry.isDirectory()) return scanDirectoryForIssues(fullPath);
  if (!entry.name.endsWith('.md')) return [];
  const issue = parseCompletedIssue(fullPath);
  return issue ? [issue] : [];
}

function scanDirectoryForIssues(dirPath: string): ResolvedIssueContext[] {
  return fs
    .readdirSync(dirPath, { withFileTypes: true })
    .flatMap(entry => processEntry(dirPath, entry));
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
