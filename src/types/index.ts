/**
 * Core types and interfaces for the CHT Multi-Agent System
 * Based on the domain-first context structure
 */

/**
 * CHT Domains based on functional areas
 */
export type CHTDomain =
  | 'authentication'
  | 'contacts'
  | 'forms-and-reports'
  | 'tasks-and-targets'
  | 'messaging'
  | 'data-sync'
  | 'configuration'
  | 'interoperability';

/**
 * Issue type classification
 */
export type IssueType = 'feature' | 'bug' | 'improvement';

/**
 * Priority level
 */
export type Priority = 'high' | 'medium' | 'low';

/**
 * Complexity level
 */
export type Complexity = 'low' | 'medium' | 'high';

/**
 * Issue template structure
 */
export interface IssueTemplate {
  issue: {
    title: string;
    type: IssueType;
    priority: Priority;
    description: string;
    technical_context: {
      domain: CHTDomain; // Required - must be specified in ticket frontmatter
      components: string[];
      existing_references?: string[];
    };
    requirements: string[];
    acceptance_criteria: string[];
    constraints: string[];
    reference_data?: {
      similar_implementations?: string[];
      documentation?: string[];
    };
  };
}

/**
 * Component reference in domain context
 */
export interface ComponentReference {
  path: string;
  purpose: string;
  key_functions?: string[];
}

/**
 * Domain components structure (from components.json)
 */
export interface DomainComponents {
  domain: string;
  last_updated: string;
  components: {
    api?: {
      controllers?: ComponentReference[];
      services?: ComponentReference[];
    };
    webapp?: {
      modules?: ComponentReference[];
      services?: ComponentReference[];
    };
    sentinel?: {
      transitions?: ComponentReference[];
    };
    shared_libs?: Array<{
      path: string;
      purpose: string;
      critical: boolean;
    }>;
    ddocs?: ComponentReference[];
    tests?: {
      unit?: string[];
      integration?: string[];
      e2e?: string[];
    };
  };
}

/**
 * Domain overview metadata (from YAML frontmatter)
 */
export interface DomainOverviewMetadata {
  domain: string;
  last_updated: string;
  related_domains: string[];
}

/**
 * CHT Services
 */
export type CHTService = 'api' | 'webapp' | 'sentinel' | 'admin';

/**
 * Workflow step
 */
export interface WorkflowStep {
  step: number;
  service: string;
  component: string;
  action: string;
  input?: string;
  output?: string;
}

/**
 * Workflow components (from involved-components.json)
 */
export interface WorkflowComponents {
  workflow: string;
  last_updated: string;
  services: Array<{
    service: string;
    role: string;
    components: string[];
    entry_point: string;
  }>;
  shared_libs: Array<{
    name: string;
    used_by: string[];
    purpose: string;
  }>;
  data_flow: string;
}

/**
 * Documentation reference from Kapa.AI
 */
export interface DocumentationReference {
  url: string;
  title: string;
  topics: string[];
  relevantSections?: string[];
  codeExamples?: string[];
}

/**
 * Solution pattern
 */
export interface SolutionPattern {
  problem: string;
  approach: string;
  implementation: string;
  tradeoffs: string[];
  successRate: number;
}

/**
 * Research findings from Documentation Search Agent
 */
export interface ResearchFindings {
  documentationReferences: DocumentationReference[];
  relevantExamples: string[];
  suggestedApproaches: string[];
  relatedDomains: CHTDomain[];
  confidence: number; // 0-1
  source: 'kapa-ai' | 'local-docs' | 'cached';
}

/**
 * Context file metadata (from resolved issues)
 */
export interface ResolvedIssueContext {
  id: string;
  issue_number?: number;
  timestamp: string;
  category: string;
  domains: CHTDomain[];
  phase: 'research' | 'implementation' | 'validation' | 'completed';
  task_id: string;
  summary: string;
  tech_stack: string[];
  components: {
    api?: string[];
    webapp?: string[];
    sentinel?: string[];
    shared_libs?: string[];
    tests?: string[];
  };
  tags?: string[];
}

/**
 * Code pattern from previous implementations
 */
export interface CodePattern {
  pattern: string;
  description: string;
  example: string;
  domain: CHTDomain;
  frequency: number;
}

/**
 * Design decision record
 */
export interface DesignDecision {
  decision: string;
  rationale: string;
  alternatives: string[];
  consequences: string[];
  domain: CHTDomain;
}

/**
 * Context analysis results from Context Analysis Agent
 */
export interface ContextAnalysisResult {
  similarContexts: ResolvedIssueContext[];
  reusablePatterns: CodePattern[];
  relevantDesignDecisions: DesignDecision[];
  recommendations: string[];
  historicalSuccessRate: number; // 0-1
  relatedDomains: CHTDomain[];
  codeArchitectureSummary?: string;
}

/**
 * Architecture insight from OpenDeepWiki code analysis
 */
export interface ArchitectureInsight {
  component: string;
  description: string;
  patterns: string[];
  dependencies: string[];
}

/**
 * Module relationship from code structure analysis
 */
export interface ModuleRelationship {
  source: string;
  target: string;
  relationship: 'imports' | 'extends' | 'implements' | 'calls' | 'depends-on';
  description: string;
}

/**
 * Code context findings from OpenDeepWiki Code Context Agent
 */
export interface CodeContextFindings {
  architectureInsights: ArchitectureInsight[];
  moduleRelationships: ModuleRelationship[];
  diagrams: string[]; // Mermaid diagram strings
  relevantRepos: string[];
  warnings: string[];
  confidence: number; // 0-1
  source: 'opendeepwiki' | 'mock';
}

/**
 * Wiki structure entry from OpenDeepWiki
 */
export interface WikiStructureEntry {
  path: string;
  title: string;
  description: string;
  children?: WikiStructureEntry[];
}

/**
 * MCP (Model Context Protocol) tool call for OpenDeepWiki
 */
export interface OpenDeepWikiMCPToolCall {
  tool: 'get_wiki_structure' | 'search_code' | 'get_architecture';
  parameters: {
    repo: string;
    query?: string;
    domain?: CHTDomain;
    max_results?: number;
  };
}

/**
 * MCP Response from OpenDeepWiki
 */
export interface OpenDeepWikiMCPResponse {
  success: boolean;
  data?: {
    architectureInsights: ArchitectureInsight[];
    moduleRelationships: ModuleRelationship[];
    diagrams: string[];
    structure: WikiStructureEntry[];
  };
  error?: string;
  rateLimited?: boolean;
}

/**
 * Orchestration plan generated by Research Supervisor
 */
export interface OrchestrationPlan {
  summary: string;
  keyFindings: string[];
  proposedApproach: string;
  estimatedComplexity: Complexity;
  phases: Array<{
    name: string;
    description: string;
    estimatedComplexity: Complexity;
    suggestedComponents: string[];
    dependencies: string[];
  }>;
  riskFactors: string[];
  estimatedEffort: string;
}

/**
 * Research Supervisor State
 */
export interface ResearchState {
  messages: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: string;
  }>;
  issue?: IssueTemplate;
  researchFindings?: ResearchFindings;
  codeContextFindings?: CodeContextFindings;
  contextAnalysis?: ContextAnalysisResult;
  orchestrationPlan?: OrchestrationPlan;
  currentPhase: 'init' | 'doc-search' | 'code-context' | 'context-analysis' | 'plan-generation' | 'complete' | 'error';
  errors: string[];
}

/**
 * Agent message types for communication
 */
export type AgentMessageType = 'task' | 'result' | 'error' | 'context';

/**
 * Agent message structure
 */
export interface AgentMessage {
  id: string;
  timestamp: string;
  source: {
    agent_id: string;
    type: 'supervisor' | 'worker';
  };
  target: {
    agent_id: string;
    broadcast?: boolean;
  };
  message_type: AgentMessageType;
  payload: {
    task_id?: string;
    content: Record<string, unknown>;
    priority: number; // 1-10
    requires_response: boolean;
  };
  metadata: {
    correlation_id: string;
    issue_number?: number;
    domain?: CHTDomain;
  };
}

// ============================================================================
// MCP (Model Context Protocol) Types for CHT Documentation Server
// ============================================================================

/**
 * Parameters for search_docs MCP tool
 */
export interface MCPSearchDocsParams {
  query: string;
  maxResults?: number;
}

/**
 * Raw response from search_docs MCP tool
 * Returns markdown-formatted document snippets
 */
export interface MCPSearchDocsResponse {
  /** Markdown content with document snippets, titles, and source URLs */
  content: string;
}

/**
 * Parsed document from search_docs response
 */
export interface MCPParsedDocument {
  title: string;
  section: string;
  content: string;
  sourceUrl: string;
}

/**
 * MCP Client configuration
 */
export interface MCPClientConfig {
  /** MCP server URL */
  serverUrl: string;
  /** Request timeout in milliseconds */
  timeout?: number;
}

// ============================================================================
// Test Environment Layer Types (#16, #66)
// ============================================================================

/**
 * A single contact_types entry from /api/v1/settings
 */
export interface ContactTypeConfig {
  id: string;
  parents?: string[];
  person?: boolean;
}

/**
 * A role entry from settings.roles, keyed by role name
 */
export interface RoleConfig {
  name?: string;
  offline?: boolean;
}

/**
 * A transition entry from settings.transitions
 */
export type TransitionConfig = boolean | { disable?: boolean };

/**
 * Deployed configuration discovered from a running CHT instance
 */
export interface DiscoveredConfig {
  contactTypes: ContactTypeConfig[];
  roles: Record<string, RoleConfig>;
  permissions: Record<string, string[]>;
  transitions: Record<string, TransitionConfig>;
  forms: string[];
}

/**
 * Inputs to provision an environment (need a local code path OR a published version)
 */
export interface ProvisionOptions {
  chtCorePath?: string;
  version?: string;
  network?: string;
}

/**
 * Handle to a provisioned, reachable CHT environment
 */
export interface EnvironmentHandle {
  url: string;
  auth: { user: string; password: string };
  network: string;
  /** Working copy backing this env (set when source-built; needed by applyConfig/rebuild) */
  chtCorePath?: string;
  source: 'mock' | 'docker';
}

/**
 * Result of seeding test data into the environment
 */
export interface TestDataResult {
  placesCreated: number;
  peopleCreated: number;
  reportsCreated: number;
  usersCreated: number;
  warnings: string[];
}

/**
 * Reset granularity (see Test Environment Layer recommendation, three-tier reset)
 */
export type ResetTier = 'couchdb' | 'restart' | 'full';
