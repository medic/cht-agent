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
  | 'configuration';

/**
 * CHT Services
 */
export type CHTService = 'api' | 'webapp' | 'sentinel' | 'admin';

/**
 * Issue template structure
 */
export interface IssueTemplate {
  issue: {
    title: string;
    type: 'feature' | 'bug' | 'enhancement';
    priority: 'high' | 'medium' | 'low';
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
  source: 'kapa-ai' | 'local-docs' | 'cached' | 'mock' | 'error';
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
 * Code snippet from cht-core codebase
 */
export interface CodeSnippet {
  filePath: string;
  content: string;
  language: string;
  relevance: 'high' | 'medium' | 'low';
}

/**
 * Code context gathered from cht-core codebase
 */
export interface CodeContext {
  domain: CHTDomain;
  description: string;
  codeSnippets: CodeSnippet[];
  availableFiles: string[];
  missingFiles: string[];
}

/**
 * Context analysis results from Context Analysis Agent
 */
export interface ContextAnalysisResult {
  similarContexts: ResolvedIssueContext[];
  reusablePatterns: CodePattern[];
  relevantDesignDecisions: DesignDecision[];
  recommendations: string[];
  /** Historical success rate (0-1), null if no historical data available */
  historicalSuccessRate: number | null;
  relatedDomains: CHTDomain[];
  /** Code context gathered from cht-core codebase */
  codeContext: CodeContext | null;
}

/**
 * Orchestration plan generated by Research Supervisor
 */
export interface OrchestrationPlan {
  summary: string;
  keyFindings: string[];
  /** Synthesized recommendation based on all research findings */
  recommendedApproach: string;
  estimatedComplexity: 'low' | 'medium' | 'high';
  phases: Array<{
    name: string;
    description: string;
    estimatedComplexity: 'low' | 'medium' | 'high';
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
  contextAnalysis?: ContextAnalysisResult;
  orchestrationPlan?: OrchestrationPlan;
  currentPhase: 'init' | 'doc-search' | 'context-analysis' | 'plan-generation' | 'complete' | 'error';
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
    content: any;
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
 * Available MCP tools for CHT documentation
 */
export type MCPToolName = 'search_docs' | 'ask_question' | 'get_sources';

/**
 * Parameters for search_docs MCP tool
 */
export interface MCPSearchDocsParams {
  query: string;
  maxResults?: number;
}

/**
 * Parameters for ask_question MCP tool
 */
export interface MCPAskQuestionParams {
  question: string;
  threadId?: string; // For conversation continuity
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
 * Raw response from ask_question MCP tool
 * Returns markdown-formatted answer with sources
 */
export interface MCPAskQuestionResponse {
  /** Markdown content with answer, sources, thread ID, and question ID */
  content: string;
}

/**
 * Raw response from get_sources MCP tool
 */
export interface MCPGetSourcesResponse {
  /** Markdown list of available documentation sources */
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
 * Parsed answer from ask_question response
 */
export interface MCPParsedAnswer {
  answer: string;
  sources: Array<{
    title: string;
    url: string;
  }>;
  threadId?: string;
  questionAnswerId?: string;
}

/**
 * Parsed source from get_sources response
 */
export interface MCPParsedSource {
  type: string;
  description: string;
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

/**
 * Legacy MCP types (kept for backward compatibility)
 * @deprecated Use the new MCP* types instead
 */
export interface MCPToolCall {
  tool: 'search_docs' | 'get_context';
  parameters: {
    query: string;
    domain?: CHTDomain;
    max_results?: number;
  };
}

/**
 * Legacy MCP Response (kept for backward compatibility)
 * @deprecated Use MCPSearchDocsResponse or MCPAskQuestionResponse instead
 */
export interface MCPResponse {
  success: boolean;
  data?: {
    references: DocumentationReference[];
    summary: string;
    relatedTopics: string[];
  };
  error?: string;
}

/**
 * Human feedback for validation checkpoints
 */
export interface HumanFeedback {
  approved: boolean;
  feedback?: string;
  additionalContext?: string;
  timestamp: string;
}

/**
 * Validation checkpoint types
 */
export type ValidationCheckpoint = 'research' | 'implementation';

/**
 * Research state with human feedback support
 */
export interface ResearchStateWithFeedback extends ResearchState {
  humanFeedback?: HumanFeedback;
  iterationCount: number;
}

// ============================================================================
// DEVELOPMENT SUPERVISOR TYPES
// ============================================================================

/**
 * Development workflow options
 */
export interface DevelopmentOptions {
  chtCorePath: string;
  previewMode: boolean; // true = staging + diff, false = direct write
  stagingPath?: string; // OS temp directory when previewMode=true
}

/**
 * File language types supported
 */
export type FileLanguage =
  | 'typescript'
  | 'javascript'
  | 'json'
  | 'xml'
  | 'yaml'
  | 'markdown'
  | 'html'
  | 'css'
  | 'shell';

/**
 * File type classification
 */
export type FileType = 'source' | 'test' | 'config' | 'documentation' | 'fixture';

/**
 * Generated file representation
 */
export interface GeneratedFile {
  relativePath: string; // Path relative to cht-core root
  content: string;
  language: FileLanguage;
  type: FileType;
  description: string;
  action: 'create' | 'modify'; // New file or modifying existing
  originalContent?: string; // For diff generation when modifying
}

/**
 * Code Generation Agent input
 */
export interface CodeGenerationInput {
  issue: IssueTemplate;
  orchestrationPlan: OrchestrationPlan;
  researchFindings: ResearchFindings;
  contextAnalysis: ContextAnalysisResult;
  chtCorePath: string;
  additionalContext?: string; // Feedback from previous iteration
}

/**
 * Code Generation Agent output
 */
export interface CodeGenerationResult {
  files: GeneratedFile[];
  summary: string;
  implementedRequirements: string[];
  pendingRequirements: string[];
  notes: string[];
  confidence: number; // 0-1
}

/**
 * Test environment configuration
 */
export interface TestEnvironmentConfig {
  type: 'unit' | 'integration' | 'e2e';
  framework: string;
  setupCommands: string[];
  teardownCommands: string[];
  dependencies: string[];
}

/**
 * Test Environment Agent input
 */
export interface TestEnvironmentInput {
  issue: IssueTemplate;
  orchestrationPlan: OrchestrationPlan;
  codeGeneration: CodeGenerationResult;
  chtCorePath: string;
  additionalContext?: string;
}

/**
 * Test Environment Agent output
 */
export interface TestEnvironmentResult {
  configs: TestEnvironmentConfig[];
  testFiles: GeneratedFile[];
  testDataFiles: GeneratedFile[];
  setupInstructions: string[];
  estimatedCoverage: number; // 0-100
}

/**
 * Requirement validation status
 */
export interface RequirementValidation {
  requirement: string;
  met: boolean;
  notes?: string;
}

/**
 * Acceptance criteria validation status
 */
export interface AcceptanceCriteriaValidation {
  criteria: string;
  passed: boolean;
  notes?: string;
}

/**
 * Implementation validation result
 */
export interface ImplementationValidation {
  requirementsMet: RequirementValidation[];
  acceptanceCriteriaPassed: AcceptanceCriteriaValidation[];
  overallScore: number; // 0-100
  recommendations: string[];
}

/**
 * Development phase types
 */
export type DevelopmentPhase =
  | 'init'
  | 'code-generation'
  | 'test-setup'
  | 'validation'
  | 'complete';

/**
 * Development Supervisor State
 */
export interface DevelopmentState {
  messages: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: string;
  }>;
  issue: IssueTemplate;
  orchestrationPlan: OrchestrationPlan;
  researchFindings: ResearchFindings;
  contextAnalysis: ContextAnalysisResult;
  options: DevelopmentOptions;
  codeGeneration?: CodeGenerationResult;
  testEnvironment?: TestEnvironmentResult;
  validationResult?: ImplementationValidation;
  currentPhase: DevelopmentPhase;
  errors: string[];
}

/**
 * Development Supervisor input (from Research phase)
 */
export interface DevelopmentInput {
  issue: IssueTemplate;
  orchestrationPlan: OrchestrationPlan;
  researchFindings: ResearchFindings;
  contextAnalysis: ContextAnalysisResult;
  options: DevelopmentOptions;
  additionalContext?: string;
}

/**
 * Diff result for a single file
 */
export interface FileDiff {
  relativePath: string;
  action: 'create' | 'modify' | 'delete';
  additions: number;
  deletions: number;
  diff: string; // Unified diff format
}

/**
 * Development workflow result
 */
export interface DevelopmentWorkflowResult {
  approved: boolean;
  result: DevelopmentState | undefined;
  iterationCount: number;
  filesWritten: string[];
}
