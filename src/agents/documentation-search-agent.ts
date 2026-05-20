/**
 * Documentation Search Agent
 *
 * Searches CHT documentation using MCP integration with Kapa.AI.
 * Uses the MCPClient to query the CHT documentation server.
 */

import {
  ResearchFindings,
  DocumentationReference,
  CHTDomain,
  IssueTemplate,
  MCPParsedDocument,
} from '../types';
import { MCPClient } from '../mcp';
import { TodoTracker, createAgentTodoTracker } from '../utils/todo-tracker';

/**
 * Options for DocumentationSearchAgent
 */
const INCOMPLETE_STARTER_WORDS: ReadonlySet<string> = new Set([
  'and', 'or', 'but', 'the', 'a', 'an',
  'with', 'for', 'to', 'of', 'in', 'on', 'at', 'by', 'from', 'as',
  'into', 'through', 'during', 'before', 'after',
  'above', 'below', 'between', 'under',
]);

const INCOMPLETE_STARTER_PUNCTUATION: ReadonlySet<string> = new Set([',', ';', ':', '.']);

/**
 * Find the content ranges (start/end offsets) for each bullet in `text`.
 * A bullet starts at line-start whitespace + marker (- * • or N.) + whitespace.
 * Content extends until the next bullet's marker, a blank line, or EOF.
 */
function findBulletContentRanges(text: string): { start: number; end: number }[] {
  const bulletStartRe = /(?:^|\n)([ \t]*)(?:[-*•]|\d+\.)[ \t]+/g;
  const markers: { markerStart: number; contentStart: number }[] = [];
  for (const m of text.matchAll(bulletStartRe)) {
    const markerStart = m.index! + (m[0].startsWith('\n') ? 1 : 0);
    markers.push({ markerStart, contentStart: m.index! + m[0].length });
  }
  return markers.map((mk, i) => ({
    start: mk.contentStart,
    end: computeBulletContentEnd(text, mk.contentStart, markers[i + 1]?.markerStart),
  }));
}

function computeBulletContentEnd(text: string, contentStart: number, nextMarkerStart?: number): number {
  const blankLineIdx = text.indexOf('\n\n', contentStart);
  const limit = nextMarkerStart ?? text.length;
  if (blankLineIdx !== -1 && blankLineIdx < limit) return blankLineIdx;
  return limit;
}

function startsWithIncompleteToken(text: string): boolean {
  // Mirror the original regex: token followed by whitespace; require something after.
  const match = /^(\S+)\s/.exec(text);
  if (!match) return false;
  const first = match[1].toLowerCase();
  return INCOMPLETE_STARTER_WORDS.has(first) || INCOMPLETE_STARTER_PUNCTUATION.has(first);
}

export interface DocumentationSearchAgentOptions {
  /** Custom MCP client (useful for testing) */
  mcpClient?: MCPClient;
  /** Use mock responses instead of real MCP (for unit tests only) */
  useMockMCP?: boolean;
}

export class DocumentationSearchAgent {
  private readonly mcpClient: MCPClient;
  private readonly useMockMCP: boolean;
  private readonly todos: TodoTracker;

  constructor(options: DocumentationSearchAgentOptions = {}) {
    this.useMockMCP = options.useMockMCP === true; // Default to false (use real MCP)
    this.mcpClient = options.mcpClient || MCPClient.fromEnv();
    this.todos = createAgentTodoTracker('Doc Search');
  }

  /**
   * Main entry point for documentation search
   */
  async search(issue: IssueTemplate): Promise<ResearchFindings> {
    console.log('\n[Documentation Search Agent] Starting documentation search...');
    console.log(`[Documentation Search Agent] Domain: ${issue.issue.technical_context.domain}`);
    console.log(`[Documentation Search Agent] Issue: ${issue.issue.title}`);

    // Clear any previous todos
    this.todos.clear();

    // Domain should have been inferred by now, but use default if missing
    const domain = issue.issue.technical_context.domain || 'configuration';

    // Build search query from issue
    const searchQuery = this.todos.run(
      'Build search query',
      'Building search query',
      async () => this.buildSearchQuery(issue)
    );
    const query = await searchQuery;

    if (this.useMockMCP) {
      console.log('[Documentation Search Agent] Using MOCKED MCP response');
      return this.getMockFindings(domain, issue);
    }

    try {
      // Search for documentation
      const searchDocsId = this.todos.add('Search documentation via MCP', 'Searching documentation via MCP');
      this.todos.start(searchDocsId);

      const searchResponse = await this.mcpClient.searchDocs({
        query,
        maxResults: 5,
      });
      const parsedDocs = this.mcpClient.parseSearchDocsResponse(searchResponse);
      this.todos.complete(searchDocsId);
      console.log(`[Documentation Search Agent] Found ${parsedDocs.length} documents from search`);

      // Ask a targeted question for more context
      const askQuestionId = this.todos.add('Ask targeted question', 'Asking targeted question');
      this.todos.start(askQuestionId);

      const questionResponse = await this.mcpClient.askQuestion({
        question: this.buildQuestion(issue),
      });
      const parsedAnswer = this.mcpClient.parseAskQuestionResponse(questionResponse);
      this.todos.complete(askQuestionId);
      console.log(`[Documentation Search Agent] Got answer with ${parsedAnswer.sources.length} sources`);

      // Build research findings
      const findings = await this.todos.run(
        'Build research findings',
        'Building research findings',
        async () => this.buildResearchFindings(parsedDocs, parsedAnswer, issue)
      );

      console.log(
        `[Documentation Search Agent] Found ${findings.documentationReferences.length} documentation references`
      );
      console.log(`[Documentation Search Agent] Confidence: ${findings.confidence}`);

      this.todos.printSummary();
      return findings;
    } catch (error) {
      console.error('[Documentation Search Agent] Error calling MCP:', error);
      this.todos.printSummary();

      // Return empty findings on error
      return {
        documentationReferences: [],
        relevantExamples: [],
        suggestedApproaches: [
          'MCP server unavailable - manual documentation review recommended',
        ],
        relatedDomains: [],
        confidence: 0,
        source: 'error',
      };
    }
  }

  /**
   * Build search query from issue template
   */
  buildSearchQuery(issue: IssueTemplate): string {
    const { title, description, technical_context } = issue.issue;

    // Extract key terms
    const terms = [technical_context.domain, ...technical_context.components, title].join(' ');

    return `${terms} ${description.substring(0, 200)}`;
  }

  /**
   * Build a question for the ask_question tool
   */
  private buildQuestion(issue: IssueTemplate): string {
    const { title, description, technical_context, type } = issue.issue;

    const questionType = type === 'bug' ? 'debug and fix' : 'implement';

    return `How do I ${questionType} "${title}" in CHT? Context: ${description.substring(0, 300)}. Domain: ${technical_context.domain}`;
  }

  /**
   * Build ResearchFindings from MCP responses
   */
  private buildResearchFindings(
    searchDocs: MCPParsedDocument[],
    answer: { answer: string; sources: Array<{ title: string; url: string }> },
    issue: IssueTemplate
  ): ResearchFindings {
    // Convert parsed documents to DocumentationReference format
    const documentationReferences: DocumentationReference[] = [];

    // Add references from search results
    for (const doc of searchDocs) {
      documentationReferences.push({
        url: doc.sourceUrl,
        title: doc.title || doc.section,
        topics: this.extractTopics(doc.content),
        relevantSections: [doc.section].filter(Boolean),
        codeExamples: this.extractCodeExamples(doc.content),
      });
    }

    // Add references from answer sources (avoid duplicates)
    for (const source of answer.sources) {
      const exists = documentationReferences.some((ref) => ref.url === source.url);
      if (!exists) {
        documentationReferences.push({
          url: source.url,
          title: source.title,
          topics: [],
          relevantSections: [],
        });
      }
    }

    // Extract topics from all documents
    const allTopics = documentationReferences.flatMap((ref) => ref.topics);

    // Generate approaches from the answer
    const suggestedApproaches = this.generateApproaches(documentationReferences, issue, answer.answer);

    // Identify related domains from topics
    const relatedDomains = this.identifyRelatedDomains(allTopics);

    // Calculate confidence based on results
    const confidence = this.calculateConfidence(documentationReferences, answer);

    return {
      documentationReferences,
      relevantExamples: documentationReferences.flatMap((ref) => ref.codeExamples || []),
      suggestedApproaches,
      relatedDomains,
      confidence,
      source: 'kapa-ai',
    };
  }

  /**
   * Extract topics from document content
   */
  private extractTopics(content: string): string[] {
    const topics: string[] = [];

    // Look for common CHT keywords in the content
    const keywords = [
      'contact', 'hierarchy', 'form', 'report', 'task', 'target',
      'permission', 'role', 'sync', 'replication', 'offline',
      'sentinel', 'transition', 'workflow', 'validation',
    ];

    const lowerContent = content.toLowerCase();
    for (const keyword of keywords) {
      if (lowerContent.includes(keyword)) {
        topics.push(keyword);
      }
    }

    return [...new Set(topics)]; // Remove duplicates
  }

  /**
   * Extract code examples from document content
   */
  private extractCodeExamples(content: string): string[] {
    const matches = content.match(/```[\s\S]*?```/g) ?? [];
    return matches
      .slice(0, 3)
      .map(block => block.split('\n')[1]?.trim().substring(0, 50))
      .filter((line): line is string => !!line);
  }

  /**
   * Generate suggested approaches based on documentation and answer
   */
  generateApproaches(
    references: DocumentationReference[],
    _issue: IssueTemplate,
    answer: string
  ): string[] {
    const approaches = this.approachesFromBullets(answer);
    if (approaches.length === 0) {
      approaches.push(...this.approachesFromSentences(answer));
    }
    if (approaches.length < 3) {
      this.appendApproachesFromSections(approaches, references);
    }
    return approaches.slice(0, 5); // Limit to top 5
  }

  private approachesFromBullets(answer: string): string[] {
    return this.extractBulletPoints(answer)
      .slice(0, 3)
      .filter(bullet => bullet.length > 20 && this.isCompleteSentence(bullet));
  }

  private approachesFromSentences(answer: string): string[] {
    return this.extractKeySentences(answer).slice(0, 3).filter(s => s.length > 20);
  }

  private appendApproachesFromSections(approaches: string[], references: DocumentationReference[]): void {
    for (const ref of references) {
      this.appendApproachesFromOneReference(approaches, ref);
    }
  }

  private appendApproachesFromOneReference(approaches: string[], ref: DocumentationReference): void {
    for (const section of ref.relevantSections ?? []) {
      if (section && approaches.length < 5) {
        approaches.push(`Follow ${section} pattern from ${ref.title}`);
      }
    }
  }

  /**
   * Extract complete bullet points from text (handles multi-line bullets)
   */
  private extractBulletPoints(text: string): string[] {
    const bullets: string[] = [];
    const ranges = findBulletContentRanges(text);
    for (const { start, end } of ranges) {
      const content = text.slice(start, end)
        .replace(/\n\s+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (content.length > 10) bullets.push(content);
    }
    return bullets;
  }

  /**
   * Check if text appears to be a complete sentence/thought
   */
  private isCompleteSentence(text: string): boolean {
    // Incomplete if starts with lowercase (continuation of previous)
    if (/^[a-z]/.test(text)) {
      return false;
    }
    if (startsWithIncompleteToken(text)) {
      return false;
    }

    // Should have at least some structure (subject + verb typically)
    // Very simple heuristic: has at least 3 words
    const wordCount = text.split(/\s+/).length;
    if (wordCount < 3) {
      return false;
    }

    return true;
  }

  /**
   * Extract key sentences from the answer that might be useful approaches
   */
  private extractKeySentences(text: string): string[] {
    const sentences: string[] = [];
    // Sentences containing action words or recommendations.
    const actionPatterns = [
      /you (?:can|could|should|need to|must|might|may)\s+[^.!?]+[.!?]/gi,
      /(?:implement|configure|set up|create|add|modify|update|use|enable|disable)\s+[^.!?]+[.!?]/gi,
      /the (?:recommended|suggested|best|proper)\s+[^.!?]+[.!?]/gi,
    ];
    for (const pattern of actionPatterns) {
      this.appendKeySentencesForPattern(text, pattern, sentences);
    }
    return sentences;
  }

  private appendKeySentencesForPattern(text: string, pattern: RegExp, sentences: string[]): void {
    for (const m of text.matchAll(pattern)) {
      const cleaned = m[0].trim();
      if (cleaned.length > 20 && cleaned.length < 300 && !sentences.includes(cleaned)) {
        sentences.push(cleaned);
      }
    }
  }

  /**
   * Identify related domains from topics
   */
  identifyRelatedDomains(topics: string[]): CHTDomain[] {
    const domainKeywords: Record<CHTDomain, string[]> = {
      contacts: ['contact', 'hierarchy', 'lineage', 'person', 'place'],
      'forms-and-reports': ['form', 'report', 'xform', 'enketo', 'submission'],
      'tasks-and-targets': ['task', 'target', 'rules', 'scheduling', 'goal'],
      authentication: ['auth', 'login', 'permission', 'role', 'security'],
      messaging: ['sms', 'message', 'notification', 'alert'],
      'data-sync': ['sync', 'replication', 'offline', 'couchdb', 'purge'],
      configuration: ['config', 'settings', 'cht-conf'],
      interoperability: ['fhir', 'openhim', 'outbound', 'dhis2', 'openmrs', 'interoperability', 'mediator'],
    };

    const relatedDomains: CHTDomain[] = [];

    for (const [domain, keywords] of Object.entries(domainKeywords)) {
      const hasMatch = keywords.some((keyword) =>
        topics.some((topic) => topic.toLowerCase().includes(keyword))
      );

      if (hasMatch) {
        relatedDomains.push(domain as CHTDomain);
      }
    }

    return relatedDomains;
  }

  /**
   * Calculate confidence based on results quality
   */
  private calculateConfidence(
    references: DocumentationReference[],
    answer: { answer: string; sources: Array<{ title: string; url: string }> }
  ): number {
    let confidence = 0.3; // Base confidence

    // More references = higher confidence
    if (references.length > 0) confidence += 0.2;
    if (references.length > 2) confidence += 0.1;
    if (references.length > 4) confidence += 0.1;

    // Answer with sources = higher confidence
    if (answer.answer.length > 100) confidence += 0.1;
    if (answer.sources.length > 0) confidence += 0.1;

    // Cap at 0.95
    return Math.min(confidence, 0.95);
  }

  /**
   * Get mock findings for testing
   */
  private getMockFindings(domain: CHTDomain, issue: IssueTemplate): ResearchFindings {
    // Domain-specific mock responses
    const mockData: Record<CHTDomain, DocumentationReference[]> = {
      contacts: [
        {
          url: 'https://docs.communityhealthtoolkit.org/apps/reference/contact-page/',
          title: 'Contacts Overview',
          topics: ['contacts', 'hierarchy', 'lineage'],
          relevantSections: ['Contact Types', 'Hierarchies', 'Creating Contacts'],
          codeExamples: ['contact creation', 'lineage validation'],
        },
        {
          url: 'https://docs.communityhealthtoolkit.org/apps/features/contacts/',
          title: 'Managing Contacts',
          topics: ['contact management', 'profiles', 'relationships'],
          relevantSections: ['Contact Profiles', 'Parent-Child Relationships'],
        },
      ],
      'forms-and-reports': [
        {
          url: 'https://docs.communityhealthtoolkit.org/apps/reference/forms/',
          title: 'Forms Reference',
          topics: ['forms', 'xforms', 'enketo', 'validation'],
          relevantSections: ['Form Design', 'Validation Rules', 'Form Submission Pipeline'],
          codeExamples: ['form validation', 'enketo integration'],
        },
        {
          url: 'https://docs.communityhealthtoolkit.org/apps/features/reports/',
          title: 'Reports',
          topics: ['reports', 'data collection', 'submissions'],
          relevantSections: ['Report Types', 'Form Processing', 'Sentinel Transitions'],
        },
      ],
      'tasks-and-targets': [
        {
          url: 'https://docs.communityhealthtoolkit.org/apps/reference/tasks/',
          title: 'Tasks Reference',
          topics: ['tasks', 'rules engine', 'scheduling'],
          relevantSections: ['Task Configuration', 'Rules Engine', 'Task Emission'],
          codeExamples: ['task rules', 'scheduling logic'],
        },
        {
          url: 'https://docs.communityhealthtoolkit.org/apps/reference/targets/',
          title: 'Targets Reference',
          topics: ['targets', 'analytics', 'goals'],
          relevantSections: ['Target Configuration', 'Aggregation', 'Progress Tracking'],
        },
      ],
      authentication: [
        {
          url: 'https://docs.communityhealthtoolkit.org/apps/guides/security/',
          title: 'Security and Authentication',
          topics: ['authentication', 'authorization', 'security'],
          relevantSections: ['User Authentication', 'Session Management', 'Permissions'],
        },
      ],
      messaging: [
        {
          url: 'https://docs.communityhealthtoolkit.org/apps/reference/app-settings/sms/',
          title: 'SMS Configuration',
          topics: ['sms', 'messaging', 'notifications'],
          relevantSections: ['SMS Gateway', 'Message Processing', 'Outbound Messages'],
        },
      ],
      'data-sync': [
        {
          url: 'https://docs.communityhealthtoolkit.org/apps/guides/database/',
          title: 'Database and Sync',
          topics: ['sync', 'replication', 'offline', 'couchdb'],
          relevantSections: ['Replication Strategy', 'Offline-First', 'Conflict Resolution'],
          codeExamples: ['sync configuration', 'purging rules'],
        },
      ],
      configuration: [
        {
          url: 'https://docs.communityhealthtoolkit.org/apps/reference/app-settings/',
          title: 'App Settings',
          topics: ['configuration', 'app-settings', 'cht-conf'],
          relevantSections: ['Base Settings', 'Configuration Options'],
        },
      ],
      interoperability: [
        {
          url: 'https://docs.communityhealthtoolkit.org/apps/guides/interoperability/',
          title: 'Interoperability Overview',
          topics: ['fhir', 'openhim', 'outbound', 'dhis2', 'openmrs', 'interoperability'],
          relevantSections: ['Outbound Push', 'FHIR Resources', 'OpenHIM Mediators'],
          codeExamples: ['outbound push configuration', 'FHIR resource mapping'],
        },
      ],
    };

    const references = mockData[domain] || [];
    const allTopics = references.flatMap((r) => r.topics);

    return {
      documentationReferences: references,
      relevantExamples: references.flatMap((ref) => ref.codeExamples || []),
      suggestedApproaches: this.generateApproaches(references, issue, ''),
      relatedDomains: this.identifyRelatedDomains(allTopics),
      confidence: references.length > 0 ? 0.85 : 0.3,
      source: 'mock',
    };
  }
}