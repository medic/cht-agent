/**
 * Ticket Parser - Parses markdown ticket files with minimal YAML frontmatter
 *
 * Frontmatter contains only metadata (title, type, priority, domain)
 * All detailed content is extracted from markdown body sections
 */

import * as fs from 'fs';
import * as path from 'path';
import { IssueTemplate, CHTDomain } from '../types';

/**
 * Simple YAML parser for flat key-value pairs
 */
function parseSimpleYAML(yamlContent: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = yamlContent
    .split('\n')
    .filter((line) => line.trim() && !line.trim().startsWith('#'));

  for (const line of lines) {
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;

    const key = line.substring(0, colonIndex).trim();
    const value = line.substring(colonIndex + 1).trim();

    if (key && value) {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Extract YAML frontmatter from markdown content
 */
function extractFrontmatter(content: string): {
  metadata: Record<string, string>;
  markdown: string;
} {
  const lines = content.split('\n');

  // Check if file starts with ---
  if (lines[0]?.trim() !== '---') {
    return { metadata: {}, markdown: content };
  }

  // Find the closing ---
  let endIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      endIndex = i;
      break;
    }
  }

  if (endIndex === -1) {
    return { metadata: {}, markdown: content };
  }

  const yaml = lines.slice(1, endIndex).join('\n');
  const markdown = lines.slice(endIndex + 1).join('\n');

  return { metadata: parseSimpleYAML(yaml), markdown };
}

/**
 * Validate that domain is a valid CHTDomain
 */
function validateDomain(domain: string): CHTDomain {
  const validDomains: CHTDomain[] = [
    'authentication',
    'contacts',
    'forms-and-reports',
    'tasks-and-targets',
    'messaging',
    'data-sync',
    'configuration',
  ];

  if (validDomains.includes(domain as CHTDomain)) {
    return domain as CHTDomain;
  }

  throw new Error(`Invalid domain: "${domain}". Must be one of: ${validDomains.join(', ')}`);
}

/**
 * Extract content from a markdown section
 * Returns all text until the next heading or end of content
 */
function extractSection(markdown: string, sectionTitle: string): string {
  const regex = new RegExp(`##\\s+${sectionTitle}\\s*\\n([\\s\\S]*?)(?=\\n##|$)`, 'i');
  const match = markdown.match(regex);
  return match ? match[1].trim() : '';
}

/**
 * Extract bullet list items from text
 */
function extractBulletList(text: string): string[] {
  const lines = text.split('\n');
  const items: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('- ')) {
      items.push(trimmed.substring(2).trim());
    } else if (trimmed.startsWith('* ')) {
      items.push(trimmed.substring(2).trim());
    } else if (/^\d+\.\s/.test(trimmed)) {
      // Handle numbered lists
      items.push(trimmed.replace(/^\d+\.\s/, '').trim());
    }
  }

  return items;
}

/**
 * Extract code-formatted items (items wrapped in backticks)
 */
function extractCodeItems(text: string): string[] {
  const items: string[] = [];
  const lines = text.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    // Match lines like "- `component/path`"
    if (trimmed.startsWith('- `') || trimmed.startsWith('* `')) {
      const match = trimmed.match(/[`]([^`]+)[`]/);
      if (match) {
        items.push(match[1]);
      }
    } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      // Also handle non-code items
      const item = trimmed.substring(2).trim();
      if (item) {
        items.push(item);
      }
    }
  }

  return items;
}

/**
 * Extract URLs from markdown links
 */
function extractURLs(text: string): string[] {
  const urls: string[] = [];

  // Match markdown links: [text](url)
  const markdownLinkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  let match;
  while ((match = markdownLinkRegex.exec(text)) !== null) {
    urls.push(match[2]);
  }

  // Also match plain URLs
  const plainUrlRegex = /https?:\/\/[^\s)]+/g;
  const plainUrls = text.match(plainUrlRegex) || [];
  for (const url of plainUrls) {
    if (!urls.includes(url)) {
      urls.push(url);
    }
  }

  return urls;
}

/**
 * Parse a markdown ticket file into an IssueTemplate
 */
export function parseTicketFile(filePath: string): IssueTemplate {
  // Read file
  if (!fs.existsSync(filePath)) {
    throw new Error(`Ticket file not found: ${filePath}`);
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const { metadata, markdown } = extractFrontmatter(content);

  // Validate required metadata
  if (!metadata.title) {
    throw new Error('Ticket must have a "title" in frontmatter');
  }

  if (!metadata.type) {
    throw new Error('Ticket must have a "type" in frontmatter (feature|bug|enhancement)');
  }

  if (!metadata.priority) {
    throw new Error('Ticket must have a "priority" in frontmatter (high|medium|low)');
  }

  // Domain is optional - will be inferred during research if not provided

  // Extract sections from markdown
  const descriptionSection = extractSection(markdown, 'Description');
  const technicalContextSection = extractSection(markdown, 'Technical Context');
  const requirementsSection = extractSection(markdown, 'Requirements');
  const acceptanceCriteriaSection = extractSection(markdown, 'Acceptance Criteria');
  const constraintsSection = extractSection(markdown, 'Constraints');
  const referencesSection = extractSection(markdown, 'References');

  // Parse technical context
  const components = extractCodeItems(technicalContextSection);
  const existingReferencesMatch = technicalContextSection.match(
    /\*\*Existing References:\*\*([\s\S]*?)(?=\n\*\*|\n##|$)/i
  );
  const existingReferences = existingReferencesMatch
    ? extractBulletList(existingReferencesMatch[1])
    : [];

  // Parse requirements, acceptance criteria, and constraints
  const requirements = extractBulletList(requirementsSection);
  const acceptanceCriteria = extractBulletList(acceptanceCriteriaSection);
  const constraints = extractBulletList(constraintsSection);

  // Parse references
  const similarImplementationsMatch = referencesSection.match(
    /\*\*Similar Implementations:\*\*([\s\S]*?)(?=\n\*\*|\n##|$)/i
  );
  const documentationMatch = referencesSection.match(
    /\*\*Documentation:\*\*([\s\S]*?)(?=\n\*\*|\n##|$)/i
  );

  const similarImplementations = similarImplementationsMatch
    ? extractURLs(similarImplementationsMatch[1])
    : [];
  const documentation = documentationMatch ? extractURLs(documentationMatch[1]) : [];

  // Build IssueTemplate
  const issueTemplate: IssueTemplate = {
    issue: {
      title: metadata.title,
      type: metadata.type as 'feature' | 'bug' | 'enhancement',
      priority: metadata.priority as 'high' | 'medium' | 'low',
      description: descriptionSection || markdown.trim() || '',
      technical_context: {
        domain: metadata.domain ? validateDomain(metadata.domain) : undefined,
        components: components,
        existing_references: existingReferences,
      },
      requirements: requirements,
      acceptance_criteria: acceptanceCriteria,
      constraints: constraints,
      reference_data: {
        similar_implementations: similarImplementations,
        documentation: documentation,
      },
    },
  };

  return issueTemplate;
}

/**
 * Find all ticket files in a directory
 */
export function findTicketFiles(dirPath: string): string[] {
  if (!fs.existsSync(dirPath)) {
    return [];
  }

  const files = fs.readdirSync(dirPath);
  return files
    .filter((file) => file.endsWith('.md') && !file.toLowerCase().includes('readme'))
    .map((file) => path.join(dirPath, file));
}
