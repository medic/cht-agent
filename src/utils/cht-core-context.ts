/**
 * CHT Core Code Context Gatherer
 * Reads relevant code from cht-core based on domain mappings
 */

import * as fs from 'fs';
import * as path from 'path';
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

  if (!fs.existsSync(fullPath)) {
    return [];
  }

  const stats = fs.statSync(fullPath);

  if (stats.isFile()) {
    return [fullPath];
  }

  if (stats.isDirectory()) {
    // Get main files from directory (limit to key files)
    const files: string[] = [];
    try {
      const entries = fs.readdirSync(fullPath);
      for (const entry of entries) {
        const entryPath = path.join(fullPath, entry);
        const entryStats = fs.statSync(entryPath);

        if (entryStats.isFile() && /\.(ts|js)$/.test(entry)) {
          files.push(entryPath);
          // Limit to 5 files per directory
          if (files.length >= 5) break;
        }
      }
    } catch {
      // Ignore read errors
    }
    return files;
  }

  return [];
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
  if (!index || !index.domains[domain]) {
    console.warn(`No component mapping found for domain: ${domain}`);
    return null;
  }

  const mapping = index.domains[domain];
  const codeSnippets: CodeSnippet[] = [];
  const availableFiles: string[] = [];
  const missingFiles: string[] = [];

  // Collect all file paths from mapping
  const allPaths: Array<{ path: string; relevance: 'high' | 'medium' | 'low' }> = [];

  // Webapp services are high relevance
  for (const p of mapping.webapp.services) {
    allPaths.push({ path: p, relevance: 'high' });
  }

  // Webapp modules are high relevance
  for (const p of mapping.webapp.modules) {
    allPaths.push({ path: p, relevance: 'high' });
  }

  // API controllers are medium relevance
  for (const p of mapping.api.controllers) {
    allPaths.push({ path: p, relevance: 'medium' });
  }

  // Sentinel transitions are medium relevance
  for (const p of mapping.sentinel.transitions) {
    allPaths.push({ path: p, relevance: 'medium' });
  }

  // Shared libs are low relevance (usually large)
  for (const lib of mapping.shared_libs) {
    if (lib.critical) {
      allPaths.push({ path: `${lib.path}/src`, relevance: 'low' });
    }
  }

  // Prioritize paths that match the prioritize list
  const sortedPaths = allPaths.sort((a, b) => {
    const aMatch = prioritize.some((p) => a.path.includes(p));
    const bMatch = prioritize.some((p) => b.path.includes(p));
    if (aMatch && !bMatch) return -1;
    if (!aMatch && bMatch) return 1;

    const relevanceOrder = { high: 0, medium: 1, low: 2 };
    return relevanceOrder[a.relevance] - relevanceOrder[b.relevance];
  });

  // Read files
  for (const { path: relativePath, relevance } of sortedPaths) {
    if (codeSnippets.length >= maxSnippets) break;

    const files = resolveToFiles(chtCorePath, relativePath);

    if (files.length === 0) {
      missingFiles.push(relativePath);
      continue;
    }

    for (const file of files) {
      if (codeSnippets.length >= maxSnippets) break;

      const content = readFileWithLimit(file);
      if (content) {
        const relPath = path.relative(chtCorePath, file);
        availableFiles.push(relPath);
        codeSnippets.push({
          filePath: relPath,
          content,
          language: getLanguage(file),
          relevance,
        });
      }
    }
  }

  return {
    domain,
    description: mapping.description,
    codeSnippets,
    availableFiles,
    missingFiles,
  };
}

/**
 * Format code context for LLM prompt
 */
export function formatContextForPrompt(context: CHTCoreContext): string {
  if (!context || context.codeSnippets.length === 0) {
    return '';
  }

  const lines: string[] = [
    `## CHT Core Code Context (${context.domain})`,
    '',
    `Domain: ${context.description}`,
    '',
    '### Relevant Code Files:',
    '',
  ];

  for (const snippet of context.codeSnippets) {
    lines.push(`#### ${snippet.filePath} (${snippet.relevance} relevance)`);
    lines.push('```' + snippet.language);
    lines.push(snippet.content);
    lines.push('```');
    lines.push('');
  }

  if (context.missingFiles.length > 0) {
    lines.push('### Files not found (may need verification):');
    for (const file of context.missingFiles) {
      lines.push(`- ${file}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Get a summary of available components for a domain
 */
export function getDomainComponentSummary(domain: CHTDomain): string | null {
  const index = loadIndex('domain-to-components') as DomainToComponentsIndex | null;
  if (!index || !index.domains[domain]) {
    return null;
  }

  const mapping = index.domains[domain];
  const lines: string[] = [
    `## ${domain} Domain Components`,
    '',
    `**Description:** ${mapping.description}`,
    '',
  ];

  if (mapping.webapp.services.length > 0) {
    lines.push('**Webapp Services:**');
    for (const s of mapping.webapp.services) {
      lines.push(`- ${s}`);
    }
    lines.push('');
  }

  if (mapping.webapp.modules.length > 0) {
    lines.push('**Webapp Modules:**');
    for (const m of mapping.webapp.modules) {
      lines.push(`- ${m}`);
    }
    lines.push('');
  }

  if (mapping.api.controllers.length > 0) {
    lines.push('**API Controllers:**');
    for (const c of mapping.api.controllers) {
      lines.push(`- ${c}`);
    }
    lines.push('');
  }

  if (mapping.sentinel.transitions.length > 0) {
    lines.push('**Sentinel Transitions:**');
    for (const t of mapping.sentinel.transitions) {
      lines.push(`- ${t}`);
    }
    lines.push('');
  }

  if (mapping.shared_libs.length > 0) {
    lines.push('**Shared Libraries:**');
    for (const lib of mapping.shared_libs) {
      lines.push(`- ${lib.name} (${lib.critical ? 'critical' : 'optional'})`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
