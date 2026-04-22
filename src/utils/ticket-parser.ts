/**
 * Ticket Parser - Parses markdown ticket files with minimal YAML frontmatter
 *
 * Frontmatter contains only metadata (title, type, priority, domain)
 * All detailed content is extracted from markdown body sections
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
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

  // Parse YAML using js-yaml with JSON_SCHEMA for security (prevents code execution)
  let metadata: Record<string, string> = {};
  try {
    // Using JSON_SCHEMA to safely parse YAML without executing arbitrary code
    const parsed = yaml.load(yamlContent, { schema: yaml.JSON_SCHEMA }) as Record<string, unknown>;
    if (parsed && typeof parsed === 'object') {
      // Convert all values to strings for consistency
      const stringifyValue = (val: unknown): string => {
        if (val === null || val === undefined) {
          return '';
        }
        if (typeof val === 'object') {
          return JSON.stringify(val);
        }
        // At this point, val is a primitive (string, number, boolean, symbol, bigint)
        return String(val as string | number | boolean | symbol | bigint);
      };
      metadata = Object.fromEntries(
        Object.entries(parsed).map(([key, value]) => [
          key,
          stringifyValue(value),
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
 * Valid ticket types
 */
const VALID_TYPES = ['feature', 'bug', 'improvement'] as const;

/**
 * Valid ticket priorities
 */
const VALID_PRIORITIES = ['high', 'medium', 'low'] as const;

/**
 * Valid CHT domains
 */
const VALID_DOMAINS: CHTDomain[] = [
  'authentication',
  'contacts',
  'forms-and-reports',
  'tasks-and-targets',
  'messaging',
  'data-sync',
  'configuration',
  'interoperability',
];

/**
 * Validate that type is a valid ticket type
 */
type TicketType = (typeof VALID_TYPES)[number];

function validateType(type: string): TicketType {
  if (VALID_TYPES.includes(type as TicketType)) {
    return type as TicketType;
  }

  throw new Error(`Invalid type: "${type}". Must be one of: ${VALID_TYPES.join(', ')}`);
}

/**
 * Validate that priority is a valid priority level
 */
type TicketPriority = (typeof VALID_PRIORITIES)[number];

function validatePriority(priority: string): TicketPriority {
  if (VALID_PRIORITIES.includes(priority as TicketPriority)) {
    return priority as TicketPriority;
  }

  throw new Error(
    `Invalid priority: "${priority}". Must be one of: ${VALID_PRIORITIES.join(', ')}`
  );
}

/**
 * Validate that domain is a valid CHTDomain
 */
function validateDomain(domain: string): CHTDomain {
  if (VALID_DOMAINS.includes(domain as CHTDomain)) {
    return domain as CHTDomain;
  }

  throw new Error(`Invalid domain: "${domain}". Must be one of: ${VALID_DOMAINS.join(', ')}`);
}

/**
 * Extract content from a markdown section
 * Returns all text until the next heading or end of content
 */
function extractSection(markdown: string, sectionTitle: string): string {
  const regex = new RegExp(String.raw`##\s+${sectionTitle}\s*\n([\s\S]*?)(?=\n##|$)`, 'i');
  const match = new RegExp(regex).exec(markdown);
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
      const match = new RegExp(/`([^`]+)`/).exec(trimmed);
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
    const isDuplicate = urls.includes(url);
    if (!isDuplicate) {
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
    throw new Error('Ticket must have a "type" in frontmatter (feature|bug|improvement)');
  }

  if (!metadata.priority) {
    throw new Error('Ticket must have a "priority" in frontmatter (high|medium|low)');
  }

  if (!metadata.domain) {
    throw new Error(
      'Ticket must have a "domain" in frontmatter (authentication|contacts|forms-and-reports|tasks-and-targets|messaging|data-sync|configuration|interoperability)'
    );
  }

  // Extract sections from markdown
  const descriptionSection = extractSection(markdown, 'Description');
  const hasDescriptionSection = /##\s*Description/i.test(markdown);
  const technicalContextSection = extractSection(markdown, 'Technical Context');
  const requirementsSection = extractSection(markdown, 'Requirements');
  const acceptanceCriteriaSection = extractSection(markdown, 'Acceptance Criteria');
  const constraintsSection = extractSection(markdown, 'Constraints');
  const referencesSection = extractSection(markdown, 'References');

  // Parse technical context
  const components = extractCodeItems(technicalContextSection);
  const existingReferencesMatch = new RegExp(/\*\*Existing References:\*\*([\s\S]*?)(?=\n\*\*|\n##|$)/i).exec(technicalContextSection);
  const existingReferences = existingReferencesMatch
    ? extractBulletList(existingReferencesMatch[1])
    : [];

  // Parse requirements, acceptance criteria, and constraints
  const requirements = extractBulletList(requirementsSection);
  const acceptanceCriteria = extractBulletList(acceptanceCriteriaSection);
  const constraints = extractBulletList(constraintsSection);

  // Parse references
  const similarImplementationsMatch = new RegExp(/\*\*Similar Implementations:\*\*([\s\S]*?)(?=\n\*\*|\n##|$)/i).exec(referencesSection);
  const documentationMatch = new RegExp(/\*\*Documentation:\*\*([\s\S]*?)(?=\n\*\*|\n##|$)/i).exec(referencesSection);

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
      description: hasDescriptionSection ? descriptionSection : markdown.trim(),
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
 * Validation result interface
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Map error messages to user-friendly validation errors
 */
function mapErrorMessage(errorMessage: string): string {
  const errorMap: Array<[string, string]> = [
    ['Ticket file not found', 'Ticket file not found'],
    ['must have a "title"', 'Title is required in the YAML frontmatter'],
    ['must have a "type"', 'Type is required in the YAML frontmatter'],
    ['must have a "priority"', 'Priority is required in the YAML frontmatter'],
    ['must have a "domain"', 'Domain is required in the YAML frontmatter'],
    ['Invalid type:', `Type must be one of: ${VALID_TYPES.join(', ')}`],
    ['Invalid priority:', `Priority must be one of: ${VALID_PRIORITIES.join(', ')}`],
    ['Invalid domain:', `Domain must be one of: ${VALID_DOMAINS.join(', ')}`],
  ];

  for (const [pattern, message] of errorMap) {
    if (errorMessage.includes(pattern)) {
      return message;
    }
  }

  return `Failed to process ticket: ${errorMessage}`;
}

/**
 * Validate content warnings for parsed ticket
 */
function validateContentWarnings(ticket: IssueTemplate): string[] {
  const warnings: string[] = [];
  const description = ticket.issue.description;

  if (description?.trim().length < 20) {
    warnings.push('Description is brief - consider adding more detail');
  }

  if (!description?.includes('##')) {
    warnings.push('Ticket should include markdown sections');
  }

  if (ticket.issue.requirements.length === 0) {
    warnings.push('Consider adding requirements');
  }

  if (ticket.issue.acceptance_criteria.length === 0) {
    warnings.push('Consider adding acceptance criteria');
  }

  return warnings;
}

/**
 * Validate a ticket file
 */
export function validateTicketFile(filePath: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  try {
    const ticket = parseTicketFile(filePath);

    const description = ticket.issue.description?.trim();
    if (description === '' || description === undefined) {
      errors.push('Description cannot be empty');
    } else {
      warnings.push(...validateContentWarnings(ticket));
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    errors.push(mapErrorMessage(errorMessage));
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
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
