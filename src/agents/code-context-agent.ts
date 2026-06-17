/**
 * Code Context Agent
 *
 * Searches CHT code architecture using MCP integration with OpenDeepWiki
 */

import {
  CodeContextFindings,
  ArchitectureInsight,
  ModuleRelationship,
  CHTDomain,
  IssueTemplate,
  OpenDeepWikiMCPResponse,
  DeepWikiCatalogEntry,
  DeepWikiDocument,
} from '../types';
import { OpenDeepWikiClient, DeepWikiRateLimitError } from '../mcp';
import { DEFAULT_DEEPWIKI_MCP_URL } from '../constants';
import { MockCodeContextData, MOCK_CODE_CONTEXT_DATA } from './code-context-agent.mock-data';

const EMPTY_MOCK_CODE_CONTEXT_DATA: MockCodeContextData = {
  insights: [],
  relationships: [],
  diagrams: [],
};

// Bounds tuned against observed OpenDeepWiki doc sizes (e.g. cht-core architecture
// docs: ~7 headings, diagrams with 20+ edges), not hard protocol limits.
// MAX_DOCS_PER_REPO trades recall against per-doc HTTP round-trips on the shared server.
const MAX_DOCS_PER_REPO = 3;
const MAX_PATTERNS_PER_DOC = 8;
const MAX_RELATIONSHIPS_PER_DOC = 25;
const MAX_DESCRIPTION_LENGTH = 300;

export class CodeContextAgent {
  private readonly useMockMCP: boolean;
  private readonly deepWikiServerUrl: string;
  private readonly deepWikiClient: OpenDeepWikiClient;

  constructor(
    options: { modelName?: string; useMockMCP?: boolean; deepWikiServerUrl?: string } = {}
  ) {
    this.useMockMCP = options.useMockMCP === true;
    this.deepWikiServerUrl =
      options.deepWikiServerUrl ?? process.env.DEEPWIKI_MCP_URL ?? DEFAULT_DEEPWIKI_MCP_URL;
    this.deepWikiClient = OpenDeepWikiClient.fromEnv({ serverUrl: this.deepWikiServerUrl });
  }

  /**
   * Main entry point for code context search
   */
  async search(issue: IssueTemplate): Promise<CodeContextFindings> {
    console.log('\n[Code Context Agent] Starting code context search...');
    console.log(`[Code Context Agent] Domain: ${issue.issue.technical_context.domain}`);
    console.log(`[Code Context Agent] Issue: ${issue.issue.title}`);

    const domain = issue.issue.technical_context.domain || 'configuration';

    const repos = this.determineRepos(domain);
    console.log(`[Code Context Agent] Searching repos: ${repos.join(', ')}`);

    const searchQuery = this.buildSearchQuery(issue);
    console.log(`[Code Context Agent] Search query: ${searchQuery}`);

    const allInsights: ArchitectureInsight[] = [];
    const allRelationships: ModuleRelationship[] = [];
    const allDiagrams: string[] = [];
    const warnings: string[] = [];

    const results = await Promise.all(
      repos.map(async repo => {
        const response = await this.callOpenDeepWiki(searchQuery, domain, repo);
        return this.processMCPResponse(response, repo);
      })
    );

    results.forEach(processed => {
      allInsights.push(...processed.insights);
      allRelationships.push(...processed.relationships);
      allDiagrams.push(...processed.diagrams);
      warnings.push(...processed.warnings);
    });

    const confidence = allInsights.length > 0 ? 0.8 : 0.3;

    const findings: CodeContextFindings = {
      architectureInsights: allInsights,
      moduleRelationships: allRelationships,
      diagrams: allDiagrams,
      relevantRepos: repos,
      warnings,
      confidence,
      source: this.useMockMCP ? 'mock' : 'opendeepwiki',
    };

    console.log(
      `[Code Context Agent] Found ${findings.architectureInsights.length} architecture insights`
    );
    console.log(`[Code Context Agent] Confidence: ${findings.confidence}`);

    return findings;
  }

  private determineRepos(domain: CHTDomain): string[] {
    const repos = ['cht-core'];

    if (domain === 'configuration') {
      repos.push('cht-conf');
    }

    if (domain === 'data-sync' || domain === 'messaging') {
      repos.push('cht-watchdog');
    }

    return repos;
  }

  private buildSearchQuery(issue: IssueTemplate): string {
    const { title, technical_context } = issue.issue;
    const terms = [technical_context.domain, ...technical_context.components, title].join(' ');
    return terms;
  }

  /**
   * Call OpenDeepWiki via MCP.
   *
   * The deployed server exposes document-oriented tools. `search_documents`
   * currently fails server-side ("An error occurred invoking 'search_documents'"),
   * so the agent fetches the document catalog, picks the entries most relevant
   * to the query, reads them, and extracts structured findings from their
   * markdown content. Server-side failure is intentional as that feature
   * makes an LLM call and we don't want to pay for that.
   */
  private async callOpenDeepWiki(
    query: string,
    domain: CHTDomain,
    repo: string
  ): Promise<OpenDeepWikiMCPResponse> {
    if (this.useMockMCP) {
      return this.mockOpenDeepWikiResponse(domain, repo);
    }

    console.log(
      `[Code Context Agent] Calling OpenDeepWiki MCP server for ${repo}: ${this.deepWikiServerUrl}`
    );

    try {
      const catalog = await this.deepWikiClient.getDocumentCatalog(repo);
      const selectedDocs = this.selectRelevantDocs(catalog.documents, query);

      const documents = await Promise.all(
        selectedDocs.map(entry => this.deepWikiClient.readFullDocument(repo, entry.path))
      );

      return {
        success: true,
        data: this.extractFindingsFromDocuments(documents),
      };
    } catch (error) {
      return this.toErrorResponse(error, repo);
    }
  }

  /**
   * Map an OpenDeepWiki failure to a response envelope, flagging rate limits
   * separately so the caller can surface a distinct warning.
   */
  private toErrorResponse(error: unknown, repo: string): OpenDeepWikiMCPResponse {
    if (error instanceof DeepWikiRateLimitError) {
      return { success: false, rateLimited: true };
    }

    const message = error instanceof Error ? error.message : String(error);
    console.error(`[Code Context Agent] OpenDeepWiki call failed for ${repo}: ${message}`);
    return { success: false, error: message };
  }

  /**
   * Select the catalog entries most relevant to the search query.
   * Entries are scored by distinct query-term matches against title and path;
   * when nothing matches, architecture/overview documents are used as fallback.
   */
  private selectRelevantDocs(
    entries: DeepWikiCatalogEntry[],
    query: string
  ): DeepWikiCatalogEntry[] {
    const terms = [
      ...new Set(
        query
          .toLowerCase()
          .split(/[^a-z0-9]+/)
          .filter(term => term.length >= 3)
      ),
    ];

    const scored = entries
      .map(entry => {
        const haystack = `${entry.title} ${entry.path}`.toLowerCase();
        const score = terms.filter(term => haystack.includes(term)).length;
        return { entry, score };
      })
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score);

    if (scored.length > 0) {
      return scored.slice(0, MAX_DOCS_PER_REPO).map(({ entry }) => entry);
    }

    // Fallback: architecture and overview documents give general code context
    return entries
      .filter(entry => /architecture|overview/i.test(`${entry.title} ${entry.path}`))
      .slice(0, MAX_DOCS_PER_REPO);
  }

  private extractFindingsFromDocuments(documents: DeepWikiDocument[]): {
    architectureInsights: ArchitectureInsight[];
    moduleRelationships: ModuleRelationship[];
    diagrams: string[];
  } {
    const architectureInsights: ArchitectureInsight[] = [];
    const moduleRelationships: ModuleRelationship[] = [];
    const diagrams: string[] = [];

    for (const doc of documents) {
      architectureInsights.push(this.buildInsight(doc));

      const docDiagrams = this.extractMermaidDiagrams(doc.content);
      diagrams.push(...docDiagrams);

      const relationships = docDiagrams
        .flatMap(diagram => this.parseDiagramRelationships(diagram, doc.title))
        .slice(0, MAX_RELATIONSHIPS_PER_DOC);
      moduleRelationships.push(...relationships);
    }

    return {
      architectureInsights,
      moduleRelationships: this.dedupeRelationships(moduleRelationships),
      diagrams,
    };
  }

  private buildInsight(doc: DeepWikiDocument): ArchitectureInsight {
    return {
      component: doc.title || doc.path,
      description: this.extractLeadParagraph(doc.content),
      patterns: this.extractSectionHeadings(doc.content),
      dependencies: [],
    };
  }

  private extractLeadParagraph(content: string): string {
    const withoutCodeBlocks = content.replace(/```[\s\S]*?```/g, '');

    const paragraph = withoutCodeBlocks
      .split(/\n\s*\n/)
      .map(block => block.trim())
      .find(block => block.length > 0 && !block.startsWith('#') && !block.startsWith('-'));

    if (!paragraph) {
      return '';
    }

    const text = paragraph.replace(/\s+/g, ' ');
    return text.length > MAX_DESCRIPTION_LENGTH
      ? `${text.slice(0, MAX_DESCRIPTION_LENGTH)}…`
      : text;
  }

  private extractSectionHeadings(content: string): string[] {
    const headings: string[] = [];
    const headingRegex = /^##+\s+(.+)$/gm;

    let match;
    while ((match = headingRegex.exec(content)) !== null) {
      const heading = match[1].trim();
      if (heading && heading.toLowerCase() !== 'overview') {
        headings.push(heading);
      }
    }

    return [...new Set(headings)].slice(0, MAX_PATTERNS_PER_DOC);
  }

  private extractMermaidDiagrams(content: string): string[] {
    const diagrams: string[] = [];
    const mermaidRegex = /```mermaid\s*\n([\s\S]*?)```/g;

    let match;
    while ((match = mermaidRegex.exec(content)) !== null) {
      const diagram = match[1].trim();
      if (diagram) {
        diagrams.push(diagram);
      }
    }

    return diagrams;
  }

  /**
   * Parse `A -->|label| B` edges out of a mermaid flowchart into module
   * relationships, resolving node ids to their declared labels when available
   */
  private parseDiagramRelationships(diagram: string, docTitle: string): ModuleRelationship[] {
    const labels = new Map<string, string>();
    const labelRegex = /(\w+)\s*[[({]+"?([^\])}"]+)"?[\])}]+/g;

    let labelMatch;
    while ((labelMatch = labelRegex.exec(diagram)) !== null) {
      // Mermaid labels may contain <br/> line breaks; flatten them to spaces
      const label = labelMatch[2].replace(/<br\s*\/?>/gi, ' ').replace(/\s+/g, ' ').trim();
      labels.set(labelMatch[1], label);
    }

    // Strip inline node-label definitions (`A[Foo]`, `B("Bar")`, `C{Baz}`) down to
    // the bare node id so the edge pattern below stays simple. Labels are already
    // captured in the `labels` map above.
    const edgesOnly = diagram.replace(/(\w+)\s*[[({][^\])}]*[\])}]/g, '$1');

    const relationships: ModuleRelationship[] = [];
    // Matches `A --> B` and `A -->|label| B` on the stripped diagram.
    const edgeRegex = /(\w+)\s*-->\s*(?:\|([^|]*)\|\s*)?(\w+)/g;

    let edgeMatch;
    while ((edgeMatch = edgeRegex.exec(edgesOnly)) !== null) {
      const [, sourceId, rawLabel, targetId] = edgeMatch;
      const label = (rawLabel ?? '').replace(/"/g, '').trim();
      relationships.push({
        source: labels.get(sourceId) ?? sourceId,
        target: labels.get(targetId) ?? targetId,
        relationship: 'depends-on',
        description: label
          ? `${label} (from "${docTitle}" diagram)`
          : `Relationship from "${docTitle}" architecture diagram`,
      });
    }

    return relationships;
  }

  private dedupeRelationships(relationships: ModuleRelationship[]): ModuleRelationship[] {
    const seen = new Set<string>();
    return relationships.filter(rel => {
      const key = `${rel.source}|${rel.target}|${rel.description}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  /**
   * Mock OpenDeepWiki response for POC/testing
   * Returns repo-specific data: cht-core gets domain insights,
   * secondary repos (cht-conf, cht-watchdog) get repo-specific insights.
   */
  private mockOpenDeepWikiResponse(domain: CHTDomain, repo: string): OpenDeepWikiMCPResponse {
    console.log(`[Code Context Agent] Using MOCKED OpenDeepWiki response for ${repo}`);

    const mockData =
      MOCK_CODE_CONTEXT_DATA.secondaryRepos[repo] ||
      MOCK_CODE_CONTEXT_DATA.domains[domain] ||
      EMPTY_MOCK_CODE_CONTEXT_DATA;

    return this.buildMockResponse(mockData);
  }

  /**
   * Wrap raw mock arrays into the OpenDeepWiki response envelope
   */
  private buildMockResponse(mockData: MockCodeContextData): OpenDeepWikiMCPResponse {
    return {
      success: true,
      data: {
        architectureInsights: mockData.insights,
        moduleRelationships: mockData.relationships,
        diagrams: mockData.diagrams,
      },
    };
  }

  private processMCPResponse(
    response: OpenDeepWikiMCPResponse,
    repo: string
  ): {
    insights: ArchitectureInsight[];
    relationships: ModuleRelationship[];
    diagrams: string[];
    warnings: string[];
  } {
    const warnings: string[] = [];

    if (response.rateLimited) {
      warnings.push(`Rate limited when querying ${repo} - results may be incomplete`);
      return { insights: [], relationships: [], diagrams: [], warnings };
    }

    if (!response.success || !response.data) {
      warnings.push(`Failed to fetch code context from ${repo}`);
      return { insights: [], relationships: [], diagrams: [], warnings };
    }

    return {
      insights: response.data.architectureInsights,
      relationships: response.data.moduleRelationships,
      diagrams: response.data.diagrams,
      warnings,
    };
  }
}
