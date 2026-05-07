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

type MockCodeContextData = {
  insights: ArchitectureInsight[];
  relationships: ModuleRelationship[];
  diagrams: string[];
};

const createArchitectureInsight = (
  component: string,
  description: string,
  patterns: string[],
  dependencies: string[]
): ArchitectureInsight => ({
  component,
  description,
  patterns,
  dependencies,
});

const createModuleRelationship = (
  source: string,
  target: string,
  relationship: ModuleRelationship['relationship'],
  description: string
): ModuleRelationship => ({
  source,
  target,
  relationship,
  description,
});

type MockCodeContextSeed = {
  insights: Array<Parameters<typeof createArchitectureInsight>>;
  relationships: Array<Parameters<typeof createModuleRelationship>>;
  diagrams: string[];
};

const buildDiagram = (...lines: string[]): string =>
  ['graph TD', ...lines.map(line => `    ${line}`)].join('\n');

const createMockCodeContextData = (seed: MockCodeContextSeed): MockCodeContextData => ({
  insights: seed.insights.map(args => createArchitectureInsight(...args)),
  relationships: seed.relationships.map(args => createModuleRelationship(...args)),
  diagrams: seed.diagrams,
});

const EMPTY_MOCK_CODE_CONTEXT_DATA: MockCodeContextData = {
  insights: [],
  relationships: [],
  diagrams: [],
};

const SECONDARY_REPO_MOCK_DATA: Record<string, MockCodeContextData> = {
  'cht-conf': createMockCodeContextData({
    insights: [
      [
        'cht-conf/src/lib/compile-app-settings',
        'Compiles app_settings.json from declarative config files',
        ['compilation pipeline', 'JSON schema validation'],
        ['cht-conf/src/nools', 'cht-conf/src/contact-summary'],
      ],
    ],
    relationships: [
      [
        'cht-conf/src/lib',
        'api/controllers/settings',
        'calls',
        'cht-conf uploads compiled config via settings API',
      ],
    ],
    diagrams: [
      buildDiagram(
        'A[cht-conf CLI] --> B[compile-app-settings]',
        'B --> C[nools compiler]',
        'B --> D[contact-summary compiler]',
        'A -->|upload| E[api/settings]'
      ),
    ],
  }),
  'cht-watchdog': createMockCodeContextData({
    insights: [
      [
        'cht-watchdog/src/monitor',
        'Monitors CHT instance health, connectivity, and sync status',
        ['health polling', 'alerting', 'metric collection'],
        ['cht-watchdog/src/config', 'cht-watchdog/src/notifier'],
      ],
    ],
    relationships: [
      [
        'cht-watchdog/src/monitor',
        'api/services/monitoring',
        'calls',
        'Watchdog polls API monitoring endpoints for health checks',
      ],
    ],
    diagrams: [
      buildDiagram(
        'A[cht-watchdog] --> B[api/monitoring]',
        'A --> C[alerting/notifier]',
        'B --> D[CouchDB/_active_tasks]'
      ),
    ],
  }),
};

const DOMAIN_MOCK_DATA: Record<CHTDomain, MockCodeContextData> = {
  contacts: createMockCodeContextData({
    insights: [
      [
        'api/controllers/people',
        'REST controller handling contact CRUD operations and search',
        ['RESTful endpoints', 'CouchDB views', 'lineage validation'],
        ['shared-libs/lineage', 'shared-libs/contacts'],
      ],
      [
        'webapp/modules/contacts',
        'Angular module for contact display, search, and hierarchy navigation',
        [
          'Angular module pattern',
          'service-controller separation',
          'search indexing',
        ],
        ['webapp/services/db', 'webapp/services/search'],
      ],
    ],
    relationships: [
      [
        'webapp/modules/contacts',
        'api/controllers/people',
        'calls',
        'Webapp contacts module calls people API for CRUD operations',
      ],
      [
        'api/controllers/people',
        'shared-libs/lineage',
        'depends-on',
        'People controller uses lineage lib for hierarchy validation',
      ],
    ],
    diagrams: [
      buildDiagram(
        'A[webapp/contacts] -->|HTTP| B[api/people]',
        'B --> C[shared-libs/lineage]',
        'B --> D[CouchDB]',
        'A --> E[webapp/search-service]'
      ),
    ],
  }),
  'forms-and-reports': createMockCodeContextData({
    insights: [
      [
        'api/controllers/forms',
        'Handles form submission, validation, and XForm processing',
        ['XForm parsing', 'validation pipeline', 'Enketo integration'],
        ['shared-libs/rules-engine', 'sentinel/transitions'],
      ],
      [
        'sentinel/transitions',
        'Background processing pipeline triggered after form submission',
        ['event-driven transitions', 'sequential processing', 'error recovery'],
        ['shared-libs/infodoc', 'api/services/db'],
      ],
    ],
    relationships: [
      [
        'webapp/modules/reports',
        'api/controllers/forms',
        'calls',
        'Reports module submits forms via API',
      ],
      [
        'api/controllers/forms',
        'sentinel/transitions',
        'depends-on',
        'Form submissions trigger sentinel transitions',
      ],
    ],
    diagrams: [
      buildDiagram(
        'A[webapp/reports] -->|submit| B[api/forms]',
        'B --> C[sentinel/transitions]',
        'C --> D[shared-libs/rules-engine]',
        'B --> E[Enketo]'
      ),
    ],
  }),
  'tasks-and-targets': createMockCodeContextData({
    insights: [
      [
        'shared-libs/rules-engine',
        'Core rules engine that evaluates task and target rules',
        ['rule evaluation', 'emission pipeline', 'caching'],
        ['shared-libs/calendar-interval', 'shared-libs/contact-types-utils'],
      ],
      [
        'webapp/modules/tasks',
        'UI module for displaying and managing tasks',
        ['Angular module pattern', 'lazy loading', 'task prioritization'],
        ['shared-libs/rules-engine', 'webapp/services/db'],
      ],
    ],
    relationships: [
      [
        'webapp/modules/tasks',
        'shared-libs/rules-engine',
        'depends-on',
        'Tasks module uses rules engine for task evaluation',
      ],
      [
        'shared-libs/rules-engine',
        'shared-libs/calendar-interval',
        'imports',
        'Rules engine uses calendar-interval for date calculations',
      ],
    ],
    diagrams: [
      buildDiagram(
        'A[webapp/tasks] --> B[shared-libs/rules-engine]',
        'A[webapp/targets] --> B',
        'B --> C[shared-libs/calendar-interval]',
        'B --> D[contact-types-utils]'
      ),
    ],
  }),
  authentication: createMockCodeContextData({
    insights: [
      [
        'api/auth',
        'Authentication middleware handling session management and permissions',
        ['session-based auth', 'role-based access', 'cookie management'],
        ['api/services/cookie', 'CouchDB/_users'],
      ],
    ],
    relationships: [
      [
        'webapp/services/auth',
        'api/auth',
        'calls',
        'Webapp auth service calls API auth endpoints',
      ],
    ],
    diagrams: [
      buildDiagram(
        'A[webapp/auth-service] -->|login/logout| B[api/auth]',
        'B --> C[CouchDB/_users]',
        'B --> D[api/cookie-service]'
      ),
    ],
  }),
  messaging: createMockCodeContextData({
    insights: [
      [
        'sentinel/schedule/outbound',
        'Outbound message scheduling and gateway integration',
        ['scheduled processing', 'gateway abstraction', 'retry logic'],
        ['api/services/messaging', 'shared-libs/message-utils'],
      ],
    ],
    relationships: [
      [
        'sentinel/schedule/outbound',
        'api/services/messaging',
        'calls',
        'Outbound scheduler uses messaging service for delivery',
      ],
    ],
    diagrams: [
      buildDiagram(
        'A[sentinel/outbound] --> B[api/messaging]',
        'B --> C[SMS Gateway]',
        'A --> D[shared-libs/message-utils]'
      ),
    ],
  }),
  'data-sync': createMockCodeContextData({
    insights: [
      [
        'api/services/replication',
        'CouchDB replication management for offline-first sync',
        ['filtered replication', 'purging', 'conflict resolution'],
        ['api/services/db', 'shared-libs/purging-utils'],
      ],
      [
        'webapp/services/db-sync',
        'Client-side sync coordination between PouchDB and CouchDB',
        ['PouchDB sync', 'offline detection', 'retry backoff'],
        ['webapp/services/db', 'api/services/replication'],
      ],
    ],
    relationships: [
      [
        'webapp/services/db-sync',
        'api/services/replication',
        'calls',
        'Client sync service coordinates with server replication',
      ],
      [
        'api/services/replication',
        'shared-libs/purging-utils',
        'depends-on',
        'Replication service uses purging utils for data management',
      ],
    ],
    diagrams: [
      buildDiagram(
        'A[webapp/db-sync] -->|replicate| B[api/replication]',
        'B --> C[CouchDB]',
        'B --> D[shared-libs/purging-utils]',
        'A --> E[PouchDB]'
      ),
    ],
  }),
  configuration: createMockCodeContextData({
    insights: [
      [
        'cht-conf/src/lib',
        'Configuration compilation and upload tooling',
        ['declarative config', 'compilation pipeline', 'validation'],
        ['cht-conf/src/nools', 'cht-conf/src/contact-summary'],
      ],
      [
        'api/controllers/settings',
        'App settings management and validation API',
        ['settings CRUD', 'validation middleware', 'defaults merging'],
        ['api/services/config', 'shared-libs/settings'],
      ],
    ],
    relationships: [
      [
        'cht-conf/src/lib',
        'api/controllers/settings',
        'calls',
        'cht-conf uploads compiled config via settings API',
      ],
      [
        'api/controllers/settings',
        'shared-libs/settings',
        'depends-on',
        'Settings controller uses shared settings library',
      ],
    ],
    diagrams: [
      buildDiagram(
        'A[cht-conf] -->|upload| B[api/settings]',
        'B --> C[shared-libs/settings]',
        'B --> D[CouchDB/app_settings]'
      ),
    ],
  }),
  interoperability: createMockCodeContextData({
    insights: [
      [
        'mediator/src/routes',
        'cht-interoperability mediator FHIR routes (patient, encounter, endpoint, organization, service-request) that bridge CHT and external FHIR systems via OpenHIM',
        [
          'route-level FHIR validation',
          'shared request wrapper for consistent responses',
          'resource-specific Joi schemas',
        ],
        [
          'mediator/src/utils/fhir.ts',
          'mediator/src/utils/request.ts',
          'mediator/src/middlewares/index.ts',
        ],
      ],
      [
        'mediator/src/controllers/service-request.ts',
        'Mediator controller orchestrating create vs update behavior for FHIR resources, with identifier-based lookup before create to avoid OpenMRS sync duplicates',
        ['identifier-based existence checks', 'create/update method semantics'],
        ['mediator/src/utils/fhir.ts'],
      ],
      [
        'sentinel/src/schedule/outbound.js',
        'Sentinel outbound push scheduler that retries queued tasks; runs alongside the mark_for_outbound transition for immediate delivery',
        [
          'dual transition + scheduler delivery',
          'send-once/hash-of-payload deduplication',
          'recursive infodoc retries on CouchDB 409',
        ],
        [
          'shared-libs/transitions/src/transitions/mark_for_outbound.js',
          'shared-libs/outbound/src/outbound.js',
          'shared-libs/infodoc/src/infodoc.js',
        ],
      ],
      [
        'api/src/controllers/contacts-by-phone.js',
        'Public GET /api/v1/contacts-by-phone endpoint used by inbound RapidPro flows to resolve a hydrated contact from a normalized phone number',
        [
          'versioned external API',
          'phone normalization',
          'hydration of ancestor hierarchy',
        ],
        ['shared-libs/phone-number/src/phone-number.js'],
      ],
    ],
    relationships: [
      [
        'mediator/src/routes',
        'mediator/src/utils/fhir.ts',
        'depends-on',
        'Routes apply validateFhirResource and resource helpers from the shared FHIR utility',
      ],
      [
        'mediator/src/routes',
        'mediator/src/utils/request.ts',
        'depends-on',
        'Routes pass through requestHandler for consistent response shaping',
      ],
      [
        'shared-libs/transitions/src/transitions/mark_for_outbound.js',
        'shared-libs/outbound/src/outbound.js',
        'calls',
        'Immediate-push transition reuses the extracted send logic shared with the scheduler',
      ],
      [
        'sentinel/src/schedule/outbound.js',
        'shared-libs/outbound/src/outbound.js',
        'calls',
        'Scheduler retries failed pushes via the same shared outbound send logic',
      ],
      [
        'sentinel/src/schedule/outbound.js',
        'shared-libs/infodoc/src/infodoc.js',
        'depends-on',
        'Outbound delegates infodoc completed_tasks updates to infodocLib.saveCompletedTasks for recursive 409 retries',
      ],
      [
        'api/src/controllers/contacts-by-phone.js',
        'shared-libs/phone-number/src/phone-number.js',
        'depends-on',
        'Endpoint normalizes the phone parameter via the shared phone-number library',
      ],
    ],
    diagrams: [
      buildDiagram(
        'A[shared-libs/transitions/mark_for_outbound] -->|immediate| C[shared-libs/outbound]',
        'B[sentinel/schedule/outbound] -->|retry| C',
        'C --> D[shared-libs/infodoc]',
        'C -->|HTTP| E[OpenHIM]',
        'E --> F[mediator/src/routes]',
        'F --> G[mediator/src/utils/fhir]',
        'F --> H[FHIR Server / OpenMRS]',
        'I[RapidPro] -->|inbound SMS| J[api/contacts-by-phone]',
        'J --> K[shared-libs/phone-number]'
      ),
    ],
  }),
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
      SECONDARY_REPO_MOCK_DATA[repo] || DOMAIN_MOCK_DATA[domain] || EMPTY_MOCK_CODE_CONTEXT_DATA;

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
