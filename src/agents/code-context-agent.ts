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

export class CodeContextAgent {
  private useMockMCP: boolean;

  constructor(options: { modelName?: string; useMockMCP?: boolean } = {}) {
    this.useMockMCP = options.useMockMCP !== false; // TODO: Remove mockMCP after OpenDeepWiki is live
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

    for (const repo of repos) {
      const response = await this.callOpenDeepWiki(searchQuery, domain, repo);
      const processed = this.processMCPResponse(response, repo);
      allInsights.push(...processed.insights);
      allRelationships.push(...processed.relationships);
      allDiagrams.push(...processed.diagrams);
      warnings.push(...processed.warnings);
    }

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

    // TODO: Actual MCP implementation when OpenDeepWiki is deployed
    throw new Error('OpenDeepWiki MCP integration not yet implemented');
  }

  /**
   * Mock OpenDeepWiki response for POC/testing
   * Returns repo-specific data: cht-core gets domain insights,
   * secondary repos (cht-conf, cht-watchdog) get repo-specific insights.
   */
  private mockOpenDeepWikiResponse(domain: CHTDomain, repo: string): OpenDeepWikiMCPResponse {
    console.log(`[Code Context Agent] Using MOCKED OpenDeepWiki response for ${repo}`);

    // Secondary repos return repo-specific data (not duplicates of cht-core)
    if (repo === 'cht-conf') {
      return {
        success: true,
        data: {
          architectureInsights: [
            {
              component: 'cht-conf/src/lib/compile-app-settings',
              description: 'Compiles app_settings.json from declarative config files',
              patterns: ['compilation pipeline', 'JSON schema validation'],
              dependencies: ['cht-conf/src/nools', 'cht-conf/src/contact-summary'],
            },
          ],
          moduleRelationships: [
            {
              source: 'cht-conf/src/lib',
              target: 'api/controllers/settings',
              relationship: 'calls',
              description: 'cht-conf uploads compiled config via settings API',
            },
          ],
          diagrams: [
            `graph TD
    A[cht-conf CLI] --> B[compile-app-settings]
    B --> C[nools compiler]
    B --> D[contact-summary compiler]
    A -->|upload| E[api/settings]`,
          ],
          structure: [],
        },
      };
    }

    if (repo === 'cht-watchdog') {
      return {
        success: true,
        data: {
          architectureInsights: [
            {
              component: 'cht-watchdog/src/monitor',
              description: 'Monitors CHT instance health, connectivity, and sync status',
              patterns: ['health polling', 'alerting', 'metric collection'],
              dependencies: ['cht-watchdog/src/config', 'cht-watchdog/src/notifier'],
            },
          ],
          moduleRelationships: [
            {
              source: 'cht-watchdog/src/monitor',
              target: 'api/services/monitoring',
              relationship: 'calls',
              description: 'Watchdog polls API monitoring endpoints for health checks',
            },
          ],
          diagrams: [
            `graph TD
    A[cht-watchdog] --> B[api/monitoring]
    A --> C[alerting/notifier]
    B --> D[CouchDB/_active_tasks]`,
          ],
          structure: [],
        },
      };
    }

    // cht-core: domain-specific mock data
    const mockData: Record<
      CHTDomain,
      {
        insights: ArchitectureInsight[];
        relationships: ModuleRelationship[];
        diagrams: string[];
      }
    > = {
      contacts: {
        insights: [
          {
            component: 'api/controllers/people',
            description: 'REST controller handling contact CRUD operations and search',
            patterns: ['RESTful endpoints', 'CouchDB views', 'lineage validation'],
            dependencies: ['shared-libs/lineage', 'shared-libs/contacts'],
          },
          {
            component: 'webapp/modules/contacts',
            description: 'Angular module for contact display, search, and hierarchy navigation',
            patterns: ['Angular module pattern', 'service-controller separation', 'search indexing'],
            dependencies: ['webapp/services/db', 'webapp/services/search'],
          },
        ],
        relationships: [
          {
            source: 'webapp/modules/contacts',
            target: 'api/controllers/people',
            relationship: 'calls',
            description: 'Webapp contacts module calls people API for CRUD operations',
          },
          {
            source: 'api/controllers/people',
            target: 'shared-libs/lineage',
            relationship: 'depends-on',
            description: 'People controller uses lineage lib for hierarchy validation',
          },
        ],
        diagrams: [
          `graph TD
    A[webapp/contacts] -->|HTTP| B[api/people]
    B --> C[shared-libs/lineage]
    B --> D[CouchDB]
    A --> E[webapp/search-service]`,
        ],
      },
      'forms-and-reports': {
        insights: [
          {
            component: 'api/controllers/forms',
            description: 'Handles form submission, validation, and XForm processing',
            patterns: ['XForm parsing', 'validation pipeline', 'Enketo integration'],
            dependencies: ['shared-libs/rules-engine', 'sentinel/transitions'],
          },
          {
            component: 'sentinel/transitions',
            description: 'Background processing pipeline triggered after form submission',
            patterns: ['event-driven transitions', 'sequential processing', 'error recovery'],
            dependencies: ['shared-libs/infodoc', 'api/services/db'],
          },
        ],
        relationships: [
          {
            source: 'webapp/modules/reports',
            target: 'api/controllers/forms',
            relationship: 'calls',
            description: 'Reports module submits forms via API',
          },
          {
            source: 'api/controllers/forms',
            target: 'sentinel/transitions',
            relationship: 'depends-on',
            description: 'Form submissions trigger sentinel transitions',
          },
        ],
        diagrams: [
          `graph TD
    A[webapp/reports] -->|submit| B[api/forms]
    B --> C[sentinel/transitions]
    C --> D[shared-libs/rules-engine]
    B --> E[Enketo]`,
        ],
      },
      'tasks-and-targets': {
        insights: [
          {
            component: 'shared-libs/rules-engine',
            description: 'Core rules engine that evaluates task and target rules',
            patterns: ['rule evaluation', 'emission pipeline', 'caching'],
            dependencies: ['shared-libs/calendar-interval', 'shared-libs/contact-types-utils'],
          },
          {
            component: 'webapp/modules/tasks',
            description: 'UI module for displaying and managing tasks',
            patterns: ['Angular module pattern', 'lazy loading', 'task prioritization'],
            dependencies: ['shared-libs/rules-engine', 'webapp/services/db'],
          },
        ],
        relationships: [
          {
            source: 'webapp/modules/tasks',
            target: 'shared-libs/rules-engine',
            relationship: 'depends-on',
            description: 'Tasks module uses rules engine for task evaluation',
          },
          {
            source: 'shared-libs/rules-engine',
            target: 'shared-libs/calendar-interval',
            relationship: 'imports',
            description: 'Rules engine uses calendar-interval for date calculations',
          },
        ],
        diagrams: [
          `graph TD
    A[webapp/tasks] --> B[shared-libs/rules-engine]
    A[webapp/targets] --> B
    B --> C[shared-libs/calendar-interval]
    B --> D[contact-types-utils]`,
        ],
      },
      authentication: {
        insights: [
          {
            component: 'api/auth',
            description: 'Authentication middleware handling session management and permissions',
            patterns: ['session-based auth', 'role-based access', 'cookie management'],
            dependencies: ['api/services/cookie', 'CouchDB/_users'],
          },
        ],
        relationships: [
          {
            source: 'webapp/services/auth',
            target: 'api/auth',
            relationship: 'calls',
            description: 'Webapp auth service calls API auth endpoints',
          },
        ],
        diagrams: [
          `graph TD
    A[webapp/auth-service] -->|login/logout| B[api/auth]
    B --> C[CouchDB/_users]
    B --> D[api/cookie-service]`,
        ],
      },
      messaging: {
        insights: [
          {
            component: 'sentinel/schedule/outbound',
            description: 'Outbound message scheduling and gateway integration',
            patterns: ['scheduled processing', 'gateway abstraction', 'retry logic'],
            dependencies: ['api/services/messaging', 'shared-libs/message-utils'],
          },
        ],
        relationships: [
          {
            source: 'sentinel/schedule/outbound',
            target: 'api/services/messaging',
            relationship: 'calls',
            description: 'Outbound scheduler uses messaging service for delivery',
          },
        ],
        diagrams: [
          `graph TD
    A[sentinel/outbound] --> B[api/messaging]
    B --> C[SMS Gateway]
    A --> D[shared-libs/message-utils]`,
        ],
      },
      'data-sync': {
        insights: [
          {
            component: 'api/services/replication',
            description: 'CouchDB replication management for offline-first sync',
            patterns: ['filtered replication', 'purging', 'conflict resolution'],
            dependencies: ['api/services/db', 'shared-libs/purging-utils'],
          },
          {
            component: 'webapp/services/db-sync',
            description: 'Client-side sync coordination between PouchDB and CouchDB',
            patterns: ['PouchDB sync', 'offline detection', 'retry backoff'],
            dependencies: ['webapp/services/db', 'api/services/replication'],
          },
        ],
        relationships: [
          {
            source: 'webapp/services/db-sync',
            target: 'api/services/replication',
            relationship: 'calls',
            description: 'Client sync service coordinates with server replication',
          },
          {
            source: 'api/services/replication',
            target: 'shared-libs/purging-utils',
            relationship: 'depends-on',
            description: 'Replication service uses purging utils for data management',
          },
        ],
        diagrams: [
          `graph TD
    A[webapp/db-sync] -->|replicate| B[api/replication]
    B --> C[CouchDB]
    B --> D[shared-libs/purging-utils]
    A --> E[PouchDB]`,
        ],
      },
      configuration: {
        insights: [
          {
            component: 'cht-conf/src/lib',
            description: 'Configuration compilation and upload tooling',
            patterns: ['declarative config', 'compilation pipeline', 'validation'],
            dependencies: ['cht-conf/src/nools', 'cht-conf/src/contact-summary'],
          },
          {
            component: 'api/controllers/settings',
            description: 'App settings management and validation API',
            patterns: ['settings CRUD', 'validation middleware', 'defaults merging'],
            dependencies: ['api/services/config', 'shared-libs/settings'],
          },
        ],
        relationships: [
          {
            source: 'cht-conf/src/lib',
            target: 'api/controllers/settings',
            relationship: 'calls',
            description: 'cht-conf uploads compiled config via settings API',
          },
          {
            source: 'api/controllers/settings',
            target: 'shared-libs/settings',
            relationship: 'depends-on',
            description: 'Settings controller uses shared settings library',
          },
        ],
        diagrams: [
          `graph TD
    A[cht-conf] -->|upload| B[api/settings]
    B --> C[shared-libs/settings]
    B --> D[CouchDB/app_settings]`,
        ],
      },
    };

    const domainData = mockData[domain] || { insights: [], relationships: [], diagrams: [] };

    return {
      success: true,
      data: {
        architectureInsights: domainData.insights,
        moduleRelationships: domainData.relationships,
        diagrams: domainData.diagrams,
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
