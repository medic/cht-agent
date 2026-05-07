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
} from '../types';
import { MockCodeContextData, MOCK_CODE_CONTEXT_DATA } from './code-context-agent.mock-data';

const EMPTY_MOCK_CODE_CONTEXT_DATA: MockCodeContextData = {
  insights: [],
  relationships: [],
  diagrams: [],
};

export class CodeContextAgent {
  private readonly useMockMCP: boolean;

  constructor(options: { modelName?: string; useMockMCP?: boolean } = {}) {
    this.useMockMCP = options.useMockMCP !== false;
  }

  /**
   * Main entry point for code context search
   */
  async search(issue: IssueTemplate): Promise<CodeContextFindings> {
    console.log('\n[Code Context Agent] Starting code context search...');
    console.log(`[Code Context Agent] Domain: ${issue.issue.technical_context.domain}`);
    console.log(`[Code Context Agent] Issue: ${issue.issue.title}`);

    const domain = issue.issue.technical_context.domain || 'configuration';

    // Determine which repos to search
    const repos = this.determineRepos(domain);
    console.log(`[Code Context Agent] Searching repos: ${repos.join(', ')}`);

    // Build search query
    const searchQuery = this.buildSearchQuery(issue);
    console.log(`[Code Context Agent] Search query: ${searchQuery}`);

    // Fetch from all relevant repos and merge
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

  /**
   * Determine which CHT repos to search based on domain
   */
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

  /**
   * Build search query from issue template
   */
  private buildSearchQuery(issue: IssueTemplate): string {
    const { title, technical_context } = issue.issue;
    const terms = [technical_context.domain, ...technical_context.components, title].join(' ');
    return terms;
  }

  /**
   * Call OpenDeepWiki via MCP (mocked for POC)
   */
  private async callOpenDeepWiki(
    _query: string,
    domain: CHTDomain,
    repo: string
  ): Promise<OpenDeepWikiMCPResponse> {
    if (this.useMockMCP) {
      return this.mockOpenDeepWikiResponse(domain, repo);
    }

    throw new Error('OpenDeepWiki MCP integration not yet implemented');
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
        structure: [],
      },
    };
  }

  /**
   * Process MCP response from a single repo
   */
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
