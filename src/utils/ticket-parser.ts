/**
 * Ticket Parser - Parses markdown ticket files with minimal YAML frontmatter
 *
 * Frontmatter contains only metadata (title, type, priority, domain)
 * All detailed content is extracted from markdown body sections
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { IssueTemplate, CHTDomain } from '../types';

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

  const yamlContent = lines.slice(1, endIndex).join('\n');
  const markdown = lines.slice(endIndex + 1).join('\n');

  // Parse YAML using js-yaml
  let metadata: Record<string, string> = {};
  try {
    const parsed = yaml.load(yamlContent);
    if (parsed && typeof parsed === 'object') {
      // Convert all values to strings for consistency
      metadata = Object.fromEntries(
        Object.entries(parsed as Record<string, unknown>).map(([key, value]) => [
          key,
          String(value ?? ''),
        ])
      );
    }
  } catch (error) {
    // If YAML parsing fails, return empty metadata
    console.warn('Failed to parse YAML frontmatter:', error);
  }

  return { metadata, markdown };
}

/**
 * Validate that type is a valid ticket type
 */
type TicketType = 'feature' | 'bug' | 'enhancement';

function validateType(type: string): TicketType {
  const validTypes: TicketType[] = ['feature', 'bug', 'enhancement'];

  if (validTypes.includes(type as TicketType)) {
    return type as TicketType;
  }

  throw new Error(`Invalid type: "${type}". Must be one of: ${validTypes.join(', ')}`);
}

/**
 * Validate that priority is a valid priority level
 */
type TicketPriority = 'high' | 'medium' | 'low';

function validatePriority(priority: string): TicketPriority {
  const validPriorities: TicketPriority[] = ['high', 'medium', 'low'];

  if (validPriorities.includes(priority as TicketPriority)) {
    return priority as TicketPriority;
  }

  throw new Error(`Invalid priority: "${priority}". Must be one of: ${validPriorities.join(', ')}`);
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

  if (!metadata.domain) {
    throw new Error(
      'Ticket must have a "domain" in frontmatter (authentication|contacts|forms-and-reports|tasks-and-targets|messaging|data-sync|configuration)'
    );
  }

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

  // Validate type, priority, and domain
  const validatedType = validateType(metadata.type);
  const validatedPriority = validatePriority(metadata.priority);
  const validatedDomain = validateDomain(metadata.domain);

  // Build IssueTemplate
  const issueTemplate: IssueTemplate = {
    issue: {
      title: metadata.title,
      type: validatedType,
      priority: validatedPriority,
      description: descriptionSection || markdown.trim() || '',
      technical_context: {
        domain: validatedDomain,
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
