/**
 * Documentation Search Agent
 *
 * Searches CHT documentation using MCP integration with Kapa.AI
 * For POC, this uses mocked responses until MCP server is ready
 */

import {
  ResearchFindings,
  DocumentationReference,
  CHTDomain,
  IssueTemplate,
  MCPResponse,
} from '../types';

export class DocumentationSearchAgent {
  private useMockMCP: boolean;

  constructor(options: { modelName?: string; useMockMCP?: boolean } = {}) {
    // Model will be used when MCP integration is complete
    // For now, we use mocked responses
    this.useMockMCP = options.useMockMCP ?? !process.env.MCP_SERVER_URL
  }

  /**
   * Main entry point for documentation search
   */
  async search(issue: IssueTemplate): Promise<ResearchFindings> {
    console.log('\n[Documentation Search Agent] Starting documentation search...');
    console.log(`[Documentation Search Agent] Domain: ${issue.issue.technical_context.domain}`);
    console.log(`[Documentation Search Agent] Issue: ${issue.issue.title}`);

    // Domain should have been inferred by now, but use default if missing
    const domain = issue.issue.technical_context.domain || 'configuration';

    // Build search query from issue
    const searchQuery = this.buildSearchQuery(issue);
    console.log(`[Documentation Search Agent] Search query: ${searchQuery}`);

    // Call MCP (mocked for now)
    const mcpResponse = await this.callKapaAI(searchQuery, domain);

    // Process and structure findings
    const findings = this.processMCPResponse(mcpResponse, issue);

    console.log(
      `[Documentation Search Agent] Found ${findings.documentationReferences.length} documentation references`
    );
    console.log(`[Documentation Search Agent] Confidence: ${findings.confidence}`);

    return findings;
  }

  /**
   * Build search query from issue template
   */
  private buildSearchQuery(issue: IssueTemplate): string {
    const { title, description, technical_context } = issue.issue;

    // Extract key terms
    const terms = [technical_context.domain, ...technical_context.components, title].join(' ');

    return `${terms} ${description.substring(0, 200)}`;
  }

  /**
   * Call Kapa.AI via MCP
   */
  private async callKapaAI(query: string, domain: CHTDomain): Promise<MCPResponse> {
    if (this.useMockMCP) {
      return this.mockKapaAIResponse(query, domain);
    }

    const mcpServerUrl = process.env.MCP_SERVER_URL;
    if (!mcpServerUrl) {
      throw new Error('MCP_SERVER_URL is not set in environment');
    }

    const response = await fetch(mcpServerUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'search_docs',
          arguments: { query, maxResults: 5 },
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`MCP server responded with status ${response.status}`);
    }

    const json = (await response.json()) as {
      result?: { content?: Array<{ type: string; text?: string }> };
      error?: { message: string };
    };

    if (json.error) {
      throw new Error(`MCP error: ${json.error.message}`);
    }

    const textContent = json.result?.content
      ?.filter((c) => c.type === 'text')
      .map((c) => c.text ?? '')
      .join('\n');

    return this.parseMCPTextResponse(textContent ?? '', domain);
  }

  /**
   * Parse free-form MCP text response into structured MCPResponse
   */
  private parseMCPTextResponse(text: string, domain: CHTDomain): MCPResponse {
    if (!text) {
      return { success: false, error: 'Empty response from MCP server' };
    }

    const urlRegex = /https?:\/\/[^\s),"]+/g;
    const urls = [...new Set(text.match(urlRegex) ?? [])];

    const references = urls.map((url) => {
      const slug = url.match(/\/([^/]+)\/?$/)?.[1]?.replace(/-/g, ' ') ?? url;
      return {
        url,
        title: slug.charAt(0).toUpperCase() + slug.slice(1),
        topics: [domain],
        relevantSections: [] as string[],
      };
    });

    return {
      success: true,
      data: {
        references,
        summary: text.substring(0, 300),
        relatedTopics: [domain],
      },
    };
  }

  /**
   * Mock Kapa.AI response for POC/testing
   */
  private mockKapaAIResponse(_query: string, domain: CHTDomain): MCPResponse {
    console.log('[Documentation Search Agent] Using MOCKED Kapa.AI response');

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

    return {
      success: true,
      data: {
        references,
        summary: `Found ${references.length} relevant documentation pages for ${domain}`,
        relatedTopics: references.flatMap((r) => r.topics),
      },
    };
  }

  /**
   * Process MCP response and structure findings
   */
  private processMCPResponse(mcpResponse: MCPResponse, issue: IssueTemplate): ResearchFindings {
    if (!mcpResponse.success || !mcpResponse.data) {
      return {
        documentationReferences: [],
        relevantExamples: [],
        suggestedApproaches: [],
        relatedDomains: [],
        confidence: 0,
        source: 'kapa-ai',
      };
    }

    const { references, relatedTopics } = mcpResponse.data;

    // Extract code examples
    const relevantExamples = references
      .flatMap((ref) => ref.codeExamples || [])
      .filter((example, index, self) => self.indexOf(example) === index);

    // Suggest approaches based on documentation
    const suggestedApproaches = this.generateApproaches(references, issue);

    // Identify related domains from topics
    const relatedDomains = this.identifyRelatedDomains(relatedTopics);

    return {
      documentationReferences: references,
      relevantExamples,
      suggestedApproaches,
      relatedDomains,
      confidence: references.length > 0 ? 0.85 : 0.3,
      source: this.useMockMCP ? 'cached' : 'kapa-ai',
    };
  }

  /**
   * Generate suggested approaches based on documentation
   */
  private generateApproaches(references: DocumentationReference[], issue: IssueTemplate): string[] {
    const approaches: string[] = [];

    // Extract relevant sections as approaches
    references.forEach((ref) => {
      if (ref.relevantSections) {
        ref.relevantSections.forEach((section) => {
          approaches.push(`Follow ${section} pattern from ${ref.title}`);
        });
      }
    });

    // Add issue-specific approach
    if (issue.issue.type === 'feature') {
      approaches.push('Implement following CHT best practices and existing patterns');
    } else if (issue.issue.type === 'bug') {
      approaches.push('Debug using CHT debugging guidelines and common issue patterns');
    }

    return approaches.slice(0, 5); // Limit to top 5
  }

  /**
   * Identify related domains from topics
   */
  private identifyRelatedDomains(topics: string[]): CHTDomain[] {
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
}
