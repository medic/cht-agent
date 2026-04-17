/**
 * Ticket Parser - Parses markdown ticket files with minimal YAML frontmatter
 *
 * Frontmatter contains only metadata (title, type, priority, domain)
 * All detailed content is extracted from markdown body sections
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as yaml from 'js-yaml';
import { IssueTemplate, CHTDomain, IssueType, Priority } from '../types';

const parseFrontmatterYaml = (yamlContent: string): Record<string, string> => {
  try {
    const parsed = yaml.load(yamlContent);
    if (parsed && typeof parsed === 'object') {
      return Object.fromEntries(
        Object.entries(parsed as Record<string, unknown>).map(([key, value]) => [
          key,
          typeof value === 'string' ? value : JSON.stringify(value ?? ''),
        ])
      );
    }
  } catch (error) {
    console.warn('Failed to parse YAML frontmatter:', error);
  }
  return {};
};

const extractFrontmatter = (content: string): {
  metadata: Record<string, string>;
  markdown: string;
} => {
  const lines = content.split('\n');

  if (lines[0]?.trim() !== '---') {
    return { metadata: {}, markdown: content };
  }

  const endIndex = lines.findIndex((line, i) => i > 0 && line.trim() === '---');

  if (endIndex === -1) {
    return { metadata: {}, markdown: content };
  }

  const yamlContent = lines.slice(1, endIndex).join('\n');
  const markdown = lines.slice(endIndex + 1).join('\n');
  const metadata = parseFrontmatterYaml(yamlContent);

  return { metadata, markdown };
};

const VALID_TYPES: IssueType[] = ['feature', 'bug', 'improvement'];
const VALID_PRIORITIES: Priority[] = ['high', 'medium', 'low'];
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

const validateType = (type: string): IssueType => {
  if (VALID_TYPES.includes(type as IssueType)) {
    return type as IssueType;
  }
  throw new Error(`Invalid type: "${type}". Must be one of: ${VALID_TYPES.join(', ')}`);
};

const validatePriority = (priority: string): Priority => {
  if (VALID_PRIORITIES.includes(priority as Priority)) {
    return priority as Priority;
  }
  throw new Error(`Invalid priority: "${priority}". Must be one of: ${VALID_PRIORITIES.join(', ')}`);
};

const validateDomain = (domain: string): CHTDomain => {
  if (VALID_DOMAINS.includes(domain as CHTDomain)) {
    return domain as CHTDomain;
  }
  throw new Error(`Invalid domain: "${domain}". Must be one of: ${VALID_DOMAINS.join(', ')}`);
};

const extractSection = (markdown: string, sectionTitle: string): string => {
  const regex = new RegExp(String.raw`##\s+${sectionTitle}\s*\n([\s\S]*?)(?=\n##|$)`, 'i');
  const match = regex.exec(markdown);
  return match ? match[1].trim() : '';
};

const parseBulletLine = (trimmed: string): string | null => {
  if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
    return trimmed.substring(2).trim();
  }
  if (/^\d+\.\s/.test(trimmed)) {
    return trimmed.replace(/^\d+\.\s/, '').trim();
  }
  return null;
};

const extractBulletList = (text: string): string[] => {
  return text
    .split('\n')
    .map(line => parseBulletLine(line.trim()))
    .filter((item): item is string => item !== null);
};

const extractCodeItem = (trimmed: string): string | null => {
  if (trimmed.startsWith('- `') || trimmed.startsWith('* `')) {
    const match = /`([^`]+)`/.exec(trimmed);
    return match ? match[1] : null;
  }
  if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
    const item = trimmed.substring(2).trim();
    return item || null;
  }
  return null;
};

const extractCodeItems = (text: string): string[] => {
  return text
    .split('\n')
    .map(line => extractCodeItem(line.trim()))
    .filter((item): item is string => item !== null);
};

const extractMarkdownLinks = (text: string): string[] => {
  const urls: string[] = [];
  const regex = /\[([^\]]*)]\(([^)]*)\)/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    urls.push(match[2]);
  }
  return urls;
};

const extractURLs = (text: string): string[] => {
  const markdownUrls = extractMarkdownLinks(text);
  const plainUrls = text.match(/https?:\/\/[^\s)]+/g) || [];
  const uniquePlain = plainUrls.filter(url => !markdownUrls.includes(url));
  return [...markdownUrls, ...uniquePlain];
};

const validateMetadata = (metadata: Record<string, string>) => {
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
};

const extractSubsection = (text: string, heading: string): string | null => {
  const regex = new RegExp(String.raw`\*\*${heading}:\*\*([\s\S]*?)(?=\n\*\*|\n##|$)`, 'i');
  const match = regex.exec(text);
  return match ? match[1] : null;
};

export const parseTicketFile = (filePath: string): IssueTemplate => {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Ticket file not found: ${filePath}`);
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const { metadata, markdown } = extractFrontmatter(content);

  validateMetadata(metadata);

  const descriptionSection = extractSection(markdown, 'Description');
  const technicalContextSection = extractSection(markdown, 'Technical Context');
  const requirementsSection = extractSection(markdown, 'Requirements');
  const acceptanceCriteriaSection = extractSection(markdown, 'Acceptance Criteria');
  const constraintsSection = extractSection(markdown, 'Constraints');
  const referencesSection = extractSection(markdown, 'References');

  const components = extractCodeItems(technicalContextSection);
  const existingRefsText = extractSubsection(technicalContextSection, 'Existing References');
  const existingReferences = existingRefsText ? extractBulletList(existingRefsText) : [];

  const similarImplText = extractSubsection(referencesSection, 'Similar Implementations');
  const documentationText = extractSubsection(referencesSection, 'Documentation');

  return {
    issue: {
      title: metadata.title,
      type: validateType(metadata.type),
      priority: validatePriority(metadata.priority),
      description: descriptionSection || markdown.trim() || '',
      technical_context: {
        domain: validateDomain(metadata.domain),
        components,
        existing_references: existingReferences,
      },
      requirements: extractBulletList(requirementsSection),
      acceptance_criteria: extractBulletList(acceptanceCriteriaSection),
      constraints: extractBulletList(constraintsSection),
      reference_data: {
        similar_implementations: similarImplText ? extractURLs(similarImplText) : [],
        documentation: documentationText ? extractURLs(documentationText) : [],
      },
    },
  };
};

export const findTicketFiles = (dirPath: string): string[] => {
  if (!fs.existsSync(dirPath)) {
    return [];
  }

  return fs
    .readdirSync(dirPath)
    .filter(file => file.endsWith('.md') && !file.toLowerCase().includes('readme'))
    .map(file => path.join(dirPath, file));
};
