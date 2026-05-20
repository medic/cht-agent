/**
 * CHT Core Code Context Gatherer
 * Reads relevant code from cht-core based on domain mappings
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadIndex } from './context-loader';
import { CHTDomain } from '../types';

export interface DomainComponentMapping {
  description: string;
  api: {
    controllers: string[];
    services: string[];
  };
  webapp: {
    modules: string[];
    services: string[];
  };
  sentinel: {
    transitions: string[];
  };
  shared_libs: Array<{
    name: string;
    path: string;
    critical: boolean;
  }>;
  tests: {
    unit: string[];
    integration: string[];
    e2e: string[];
  };
}

export interface DomainToComponentsIndex {
  last_updated: string;
  domains: Record<string, DomainComponentMapping>;
}

export interface CodeSnippet {
  filePath: string;
  content: string;
  language: string;
  relevance: 'high' | 'medium' | 'low';
}

export interface CHTCoreContext {
  domain: CHTDomain;
  description: string;
  codeSnippets: CodeSnippet[];
  availableFiles: string[];
  missingFiles: string[];
}

/**
 * Get the CHT Core path from environment or default
 */
export function getCHTCorePath(): string | null {
  const envPath = process.env.CHT_CORE_PATH;
  if (envPath && fs.existsSync(envPath)) {
    return envPath;
  }

  // Try common locations
  const commonPaths = [
    path.join(process.cwd(), '..', 'cht-core'),
    path.join(process.env.HOME || '', 'projects', 'cht-core'),
    path.join(process.env.HOME || '', 'projects', 'node_projects', 'cht-core'),
  ];

  for (const p of commonPaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  return null;
}

/**
 * Detect language from file extension
 */
function getLanguage(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const langMap: Record<string, string> = {
    '.ts': 'typescript',
    '.js': 'javascript',
    '.html': 'html',
    '.css': 'css',
    '.scss': 'scss',
    '.json': 'json',
    '.xml': 'xml',
  };
  return langMap[ext] || 'text';
}

/**
 * Read a file with size limit to avoid loading huge files
 */
function readFileWithLimit(filePath: string, maxLines: number = 200): string | null {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }

    const stats = fs.statSync(filePath);
    // Skip files larger than 100KB
    if (stats.size > 100 * 1024) {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n').slice(0, maxLines);
      return lines.join('\n') + '\n// ... (truncated)';
    }

    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Resolve a path that might be a directory to actual files
 */
function resolveToFiles(basePath: string, relativePath: string): string[] {
  const fullPath = path.join(basePath, relativePath);
  if (!fs.existsSync(fullPath)) return [];
  const stats = fs.statSync(fullPath);
  if (stats.isFile()) return [fullPath];
  if (stats.isDirectory()) return readTopTsJsFiles(fullPath, 5);
  return [];
}

function readTopTsJsFiles(dirPath: string, limit: number): string[] {
  try {
    return collectTsJsFilesUpTo(fs.readdirSync(dirPath), dirPath, limit);
  } catch {
    return [];
  }
}

function collectTsJsFilesUpTo(entries: string[], dirPath: string, limit: number): string[] {
  return entries
    .filter(entry => isTsJsFile(dirPath, entry))
    .slice(0, limit)
    .map(entry => path.join(dirPath, entry));
}

function isTsJsFile(dirPath: string, entry: string): boolean {
  if (!/\.(ts|js)$/.test(entry)) return false;
  try {
    return fs.statSync(path.join(dirPath, entry)).isFile();
  } catch {
    return false;
  }
}

/**
 * Gather code context for a domain from cht-core
 */
export function gatherDomainContext(
  domain: CHTDomain,
  options: { maxSnippets?: number; prioritize?: string[] } = {}
): CHTCoreContext | null {
  const { maxSnippets = 10, prioritize = [] } = options;

  const chtCorePath = getCHTCorePath();
  if (!chtCorePath) {
    console.warn('CHT Core path not found. Set CHT_CORE_PATH environment variable.');
    return null;
  }

  const index = loadIndex('domain-to-components') as DomainToComponentsIndex | null;
  if (!index?.domains[domain]) {
    console.warn(`No component mapping found for domain: ${domain}`);
    return null;
  }

  const mapping = index.domains[domain];
  const allPaths = collectMappedPaths(mapping);
  const sortedPaths = sortPathsByPrioritization(allPaths, prioritize);

  const codeSnippets: CodeSnippet[] = [];
  const availableFiles: string[] = [];
  const missingFiles: string[] = [];
  for (const { path: relativePath, relevance } of sortedPaths) {
    if (codeSnippets.length >= maxSnippets) break;
    addSnippetsForPath({
      chtCorePath, relativePath, relevance, maxSnippets, codeSnippets, availableFiles, missingFiles,
    });
  }
  return { domain, description: mapping.description, codeSnippets, availableFiles, missingFiles };
}

interface DomainMapping {
  webapp: { services: string[]; modules: string[] };
  api: { controllers: string[] };
  sentinel: { transitions: string[] };
  shared_libs: { path: string; critical: boolean }[];
}
type RelevancePath = { path: string; relevance: 'high' | 'medium' | 'low' };

function collectMappedPaths(mapping: DomainMapping): RelevancePath[] {
  return [
    ...mapping.webapp.services.map(p => ({ path: p, relevance: 'high' as const })),
    ...mapping.webapp.modules.map(p => ({ path: p, relevance: 'high' as const })),
    ...mapping.api.controllers.map(p => ({ path: p, relevance: 'medium' as const })),
    ...mapping.sentinel.transitions.map(p => ({ path: p, relevance: 'medium' as const })),
    ...mapping.shared_libs
      .filter(lib => lib.critical)
      .map(lib => ({ path: `${lib.path}/src`, relevance: 'low' as const })),
  ];
}

function sortPathsByPrioritization(paths: RelevancePath[], prioritize: string[]): RelevancePath[] {
  const relevanceOrder = { high: 0, medium: 1, low: 2 };
  return paths.toSorted((a, b) => {
    const aMatch = prioritize.some(p => a.path.includes(p));
    const bMatch = prioritize.some(p => b.path.includes(p));
    if (aMatch && !bMatch) return -1;
    if (!aMatch && bMatch) return 1;
    return relevanceOrder[a.relevance] - relevanceOrder[b.relevance];
  });
}

function addSnippetsForPath(args: {
  chtCorePath: string;
  relativePath: string;
  relevance: 'high' | 'medium' | 'low';
  maxSnippets: number;
  codeSnippets: CodeSnippet[];
  availableFiles: string[];
  missingFiles: string[];
}): void {
  const files = resolveToFiles(args.chtCorePath, args.relativePath);
  if (files.length === 0) {
    args.missingFiles.push(args.relativePath);
    return;
  }
  for (const file of files) {
    if (args.codeSnippets.length >= args.maxSnippets) break;
    appendSnippetIfReadable(file, args);
  }
}

function appendSnippetIfReadable(
  file: string,
  args: {
    chtCorePath: string;
    relevance: 'high' | 'medium' | 'low';
    codeSnippets: CodeSnippet[];
    availableFiles: string[];
  },
): void {
  const content = readFileWithLimit(file);
  if (!content) return;
  const relPath = path.relative(args.chtCorePath, file);
  args.availableFiles.push(relPath);
  args.codeSnippets.push({ filePath: relPath, content, language: getLanguage(file), relevance: args.relevance });
}

/**
 * Format code context for LLM prompt
 */
export function formatContextForPrompt(context: CHTCoreContext): string {
  if (!context || context.codeSnippets.length === 0) return '';
  const lines: string[] = [
    `## CHT Core Code Context (${context.domain})`,
    '',
    `Domain: ${context.description}`,
    '',
    '### Relevant Code Files:',
    '',
  ];
  for (const snippet of context.codeSnippets) appendSnippetLines(lines, snippet);
  appendMissingFiles(lines, context.missingFiles);
  return lines.join('\n');
}

function appendSnippetLines(lines: string[], snippet: CodeSnippet): void {
  lines.push(
    `#### ${snippet.filePath} (${snippet.relevance} relevance)`,
    '```' + snippet.language,
    snippet.content,
    '```',
    '',
  );
}

function appendMissingFiles(lines: string[], missingFiles: string[]): void {
  if (missingFiles.length === 0) return;
  lines.push('### Files not found (may need verification):');
  for (const file of missingFiles) lines.push(`- ${file}`);
  lines.push('');
}

/**
 * Get a summary of available components for a domain
 */
export function getDomainComponentSummary(domain: CHTDomain): string | null {
  const index = loadIndex('domain-to-components') as DomainToComponentsIndex | null;
  if (!index?.domains[domain]) return null;
  const mapping = index.domains[domain];
  const lines: string[] = [
    `## ${domain} Domain Components`,
    '',
    `**Description:** ${mapping.description}`,
    '',
  ];
  appendBulletSection(lines, '**Webapp Services:**', mapping.webapp.services);
  appendBulletSection(lines, '**Webapp Modules:**', mapping.webapp.modules);
  appendBulletSection(lines, '**API Controllers:**', mapping.api.controllers);
  appendBulletSection(lines, '**Sentinel Transitions:**', mapping.sentinel.transitions);
  if (mapping.shared_libs.length > 0) {
    lines.push('**Shared Libraries:**');
    for (const lib of mapping.shared_libs) {
      lines.push(`- ${lib.name} (${lib.critical ? 'critical' : 'optional'})`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

function appendBulletSection(lines: string[], heading: string, items: string[]): void {
  if (items.length === 0) return;
  lines.push(heading);
  for (const item of items) lines.push(`- ${item}`);
  lines.push('');
}
