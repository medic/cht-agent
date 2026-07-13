/**
 * Core types and interfaces for the CHT Multi-Agent System
 * Based on the domain-first context structure
 */

import {
  CHT_DOMAINS,
  CHT_SERVICES,
  CHT_WORKFLOWS,
  CHT_LAYERS,
  CONFIG_ARTIFACTS,
  CONFIG_MECHANISMS,
} from '../constants';

/**
 * CHT Domains based on functional areas.
 * Derived from CHT_DOMAINS — the single TS source of truth (mirrored in schema.json).
 */
export type CHTDomain = (typeof CHT_DOMAINS)[number];

/**
 * Whether a ticket/context concerns the cht-core platform, the deployment's cht-conf
 * configuration, or is still ambiguous. Derived from CHT_LAYERS (mirrored in schema.json).
 */
export type CHTLayer = (typeof CHT_LAYERS)[number];

/**
 * The suspected cht-conf artifact for a config ticket/context.
 * Derived from CONFIG_ARTIFACTS (mirrored in schema.json).
 */
export type ConfigArtifact = (typeof CONFIG_ARTIFACTS)[number];

/**
 * The config mechanism a fix edits (e.g. an XLSForm `relevant` expression or a
 * `tasks.js` `appliesIf`). Derived from CONFIG_MECHANISMS (mirrored in schema.json).
 */
export type ConfigMechanism = (typeof CONFIG_MECHANISMS)[number];

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
      // Layer routing. Optional on a freshly parsed ticket: the parser only sets it when
      // present in frontmatter, leaving it absent otherwise. Domain inference fills the
      // gap and defaults it to cht-core, so after enrichIssueTemplate it is always set
      // (frontmatter wins over inference). cht-conf marks a deployment-config ticket.
      layer?: CHTLayer;
      configArtifact?: ConfigArtifact;
      artifactName?: string;
      chtConfVersion?: string;
      deploymentRef?: string;
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
 * CHT Services. Derived from CHT_SERVICES (mirrored in schema.json).
 */
export type CHTService = (typeof CHT_SERVICES)[number];

/**
 * Cross-domain workflow processes and technical workstreams. A draft keeps one
 * primary domain and links cross-cutting work here, rather than splitting into
 * sub-domains (see docs/domain-taxonomy-findings.md). Derived from CHT_WORKFLOWS.
 */
export type CHTWorkflow = (typeof CHT_WORKFLOWS)[number];

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

  /**
   * Layer discriminator. Absent or 'cht-core' for platform contexts (the default that
   * preserves today's behavior); 'cht-conf' for deployment-config contexts. The fields
   * below are only populated for cht-conf entries.
   */
  layer?: CHTLayer;
  /** The cht-conf artifact this context resolved (form, task, app-settings, …). */
  configArtifact?: ConfigArtifact;
  /** The config mechanism the fix edits (relevant, appliesIf, constraint, …). */
  mechanism?: ConfigMechanism;
  /** The reusable fix as a config snippet (before/after `relevant`, `tasks.js` block, …). */
  fix?: string;
  /** cht-conf actions involved in applying the fix (e.g. convert-app-forms, upload-app-settings). */
  chtConfActions?: string[];
  /** Other artifacts the fix touches or depends on (e.g. a task that reads a form field). */
  relatedArtifacts?: string[];
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
  relatedDomains: CHTDomain[];
  codeArchitectureSummary?: string;
  /** Code context gathered from cht-core codebase */
  codeContext?: CodeContext | null;
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
  /**
   * Layer routing, lifted out of the ticket at graph init so agents receive it
   * explicitly (and later disambiguation of `investigate` can update it without
   * rewriting the ticket). Absent for tickets that predate the layer field.
   */
  layer?: CHTLayer;
  configArtifact?: ConfigArtifact;
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
// OpenDeepWiki Code Context Layer Types
// ============================================================================

/**
 * Architecture insight from OpenDeepWiki code analysis
 */
export interface ArchitectureInsight {
  component: string;
  description: string;
  patterns: string[];
  dependencies: string[];
  /**
   * The DeepWiki repo the insight came from (cht-core, cht-conf, …). Keeps
   * findings attributable when several wikis are merged — most importantly for
   * layer: investigate tickets, which query the cht-core and cht-conf wikis together.
   */
  sourceRepo?: string;
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
 * Outcome of comparing a deployment's config artifact against the canonical
 * baseline (#134). Produced by src/utils/canonical-diff.ts.
 */
export interface CanonicalDiffResult {
  artifact: ConfigArtifact;
  artifactName?: string;
  /** Project-relative path that was compared (the first candidate found). */
  relativePath?: string;
  status:
    | 'differs'
    | 'identical'
    | 'binary-differs'
    | 'missing-in-canonical'
    | 'missing-in-deployment'
    | 'unavailable';
  /** Line diff for text artifacts (canonical = -, deployment = +), truncated. */
  diff?: string;
  summary: string;
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
  /**
   * For layer: cht-conf tickets with a mounted deployment config: the suspect
   * artifact's delta against the canonical baseline. Absent when the mount or
   * the layer/artifact routing does not apply.
   */
  canonicalDiff?: CanonicalDiffResult;
}

/**
 * Catalog entry returned by the OpenDeepWiki `get_document_catalog` tool
 */
export interface DeepWikiCatalogEntry {
  title: string;
  path: string;
  order?: number;
  hasParent?: boolean;
}

/**
 * Document catalog returned by the OpenDeepWiki `get_document_catalog` tool
 */
export interface DeepWikiCatalog {
  repository: string;
  branch?: string;
  language?: string;
  documentCount?: number;
  documents: DeepWikiCatalogEntry[];
}

/**
 * Document content returned by the OpenDeepWiki `read_document` tool
 */
export interface DeepWikiDocument {
  repository: string;
  path: string;
  title: string;
  content: string;
  startLine?: number;
  endLine?: number;
  totalLines?: number;
}

/**
 * Configuration for the OpenDeepWiki MCP client
 */
export interface DeepWikiClientConfig {
  serverUrl: string;
  owner: string;
  timeout: number; // milliseconds
}

/**
 * Normalized response from OpenDeepWiki used inside the Code Context Agent
 */
export interface OpenDeepWikiMCPResponse {
  success: boolean;
  data?: {
    architectureInsights: ArchitectureInsight[];
    moduleRelationships: ModuleRelationship[];
    diagrams: string[];
  };
  error?: string;
  rateLimited?: boolean;
}
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
  /**
   * Installed form id -> CouchDB revision of its `form:<id>` doc. The rev is
   * the change-detection hash for the apply -> verify loop: re-discover after
   * applyConfig and a changed rev proves the upload took (an unchanged rev
   * matches cht-conf's `skipped` status). Populated by the real discovery
   * path; optional so hand-built configs (tests, fixtures) stay lightweight.
   */
  formVersions?: Record<string, string>;
}

/**
 * A bucket of cht-conf upload work, mapping to the underlying cht-conf verbs
 * (see designs/cht-conf-agent-extension.md §7.2 step 4). The agent drives these
 * over HTTP against the instance; it never edits the config itself.
 * - `app-settings`      compile-app-settings + upload-app-settings
 * - `app-settings-only` upload-app-settings (NO compile) — for a deployment-
 *                       recovered, pre-compiled app_settings.json where
 *                       recompiling would clobber the minified contact-summary /
 *                       tasks / targets (see demo/site-reconstruction/README.md §2a)
 * - `app-forms`         convert-app-forms + upload-app-forms
 * - `contact-forms`     convert-contact-forms + upload-contact-forms
 * - `resources`         upload-resources + upload-branding + upload-custom-translations
 */
export type ConfigUploadAction =
  | 'app-settings'
  | 'app-settings-only'
  | 'app-forms'
  | 'contact-forms'
  | 'resources';

/**
 * Inputs to applyConfig. `configPath` defaults to cht-core's in-repo
 * `config/default`; for cht-conf tickets it points at the mounted deployment
 * config (CHT_CONF_PATH). `actions` narrows which cht-conf uploads run — omit
 * to run the full set (the cht-core default-config flow).
 */
export interface ApplyConfigOptions {
  /** Path to the cht-conf project to compile + upload (default: config/default). */
  configPath?: string;
  /** Which cht-conf upload buckets to run (default: all four). */
  actions?: ConfigUploadAction[];
  /**
   * Restrict an upload to a single artifact by name (e.g. a form id like
   * `pregnancy`) so the validate loop re-uploads only the one form it changed.
   * Passed as a positional form filter to the form-upload verbs (cht-conf's
   * args-form-filter); ignored with a warning for the settings/resources
   * buckets. Omit to upload the whole bucket.
   */
  artifact?: string;
}

/**
 * Per-action outcome of a cht-conf upload. `uploaded` = the artifact changed and
 * was pushed; `skipped` = cht-conf's hash check found it identical to the
 * instance (no-op, not a failure); `failed` = the verb errored. The verify step
 * needs this three-way distinction — a boolean can't tell "skipped" from "ran".
 */
export type ConfigActionStatus = 'uploaded' | 'skipped' | 'failed';

/**
 * Outcome of a single cht-conf upload bucket within applyConfig.
 */
export interface ConfigActionResult {
  action: ConfigUploadAction;
  status: ConfigActionStatus;
  /** The cht-conf verbs this bucket ran (for evidence/logging). */
  commands: string[];
  warnings: string[];
}

/**
 * Result of applying a config to the instance. The verify step (and the QA
 * Supervisor) asserts on this rather than re-deriving success from logs.
 */
export interface ConfigApplyResult {
  configPath: string;
  /** Single artifact targeted, if the apply was narrowed to one. */
  artifact?: string;
  /** Per-bucket outcome, in the order the buckets ran. */
  actions: ConfigActionResult[];
  /** True unless some action failed (a skipped/no-change action is not a failure). */
  succeeded: boolean;
  warnings: string[];
}

// ============================================================================
// QA VERIFY TYPES (mission 04 A2 — deployed-content assertion, G3)
// ============================================================================

/**
 * One XForm bind whose `relevant` expression the QA verify step asserts against
 * the deployed form (target bind + the siblings that must stay unchanged).
 */
export interface FormBindExpectation {
  /** The bind nodeset, e.g. '/data/danger_signs'. */
  nodeset: string;
  /** The exact `relevant` expression the deployed bind must carry. */
  relevant: string;
}

/** Per-bind outcome of verifying a deployed form's binds. */
export interface FormBindCheck {
  nodeset: string;
  expected: string;
  /** The `relevant` actually found on the deployed bind (absent if the bind is missing). */
  actual?: string;
  passed: boolean;
  note?: string;
}

/** Config-artifact kinds the QA verify step can content-assert (tier 1: form only). */
export type VerifyArtifactType = 'form';

/**
 * Inputs to TestEnvironmentAgent.verifyArtifact — real content verification of
 * a deployed artifact (not "the CouchDB rev changed"). For a form: fetch the
 * uploaded XForm and assert each expected bind's `relevant`.
 */
export interface VerifyArtifactOptions {
  configArtifact: VerifyArtifactType;
  /** The artifact id (a form id like `pregnancy_home_visit`). */
  artifactName: string;
  /** The target bind + sibling binds, each with the `relevant` it must carry. */
  expectedBinds: FormBindExpectation[];
}

/** Outcome of verifyArtifact: the per-bind checks plus a rolled-up pass/fail. */
export interface VerifyArtifactResult {
  artifact: string;
  configArtifact: VerifyArtifactType;
  passed: boolean;
  checks: FormBindCheck[];
  summary: string;
}

// ============================================================================
// QA WORKFLOW TYPES (mission 04 A3 — the closed loop, G1)
// ============================================================================

/**
 * Inputs to the QA (Test Environment) workflow: apply a Development fix to a
 * live instance and prove it in red -> green order (reproduce the symptom, apply,
 * re-verify). The `verify` set is snapshotted from the CORRECTED local form, so
 * the deployed pre-fix form fails it (red) and the deployed post-fix form passes
 * it (green).
 */
export interface QaInput {
  issue: IssueTemplate;
  /** The corrected deployment config to apply (CHT_CONF_PATH). */
  configPath: string;
  /** What to content-assert — before the fix (must fail) and after (must pass). */
  verify: VerifyArtifactOptions;
  /** cht-conf upload buckets for applyConfig (default derived from configArtifact). */
  applyActions?: ConfigUploadAction[];
  /** How to reach / bring up the instance. */
  provision: ProvisionOptions;
  /** cht-conf data project for prepareTestData; seeding is skipped when absent. */
  testDataPath?: string;
  /** Skip the interactive HC3 gate (automated / CI runs). */
  autoApprove?: boolean;
}

/**
 * Outcome of the QA workflow, carrying BOTH the red reproduction evidence and
 * the green fix evidence so the report shows the transition, not just a final
 * pass. `succeeded` requires reproduced (red) AND applied AND verified (green).
 */
export interface QaResult {
  /** False when QA was skipped (cht-core ticket, --qa off, or not applicable). */
  ran: boolean;
  /** HC3 destructive-op approval (false = aborted before seed/apply). */
  approved: boolean;
  /** The symptom reproduced against the as-deployed config (red baseline). */
  reproduced: boolean;
  /** The deployed artifact carries the corrected logic after the fix (green). */
  verified: boolean;
  /** reproduced && the apply succeeded && verified. */
  succeeded: boolean;
  /** verifyArtifact against the as-deployed (pre-fix) form — expected to FAIL. */
  redEvidence?: VerifyArtifactResult;
  /** verifyArtifact against the deployed (post-fix) form — expected to PASS. */
  greenEvidence?: VerifyArtifactResult;
  applyResult?: ConfigApplyResult;
  /** CouchDB rev of the form doc before/after the apply (corroboration). */
  preFormRev?: string;
  postFormRev?: string;
  revChanged?: boolean;
  /** Human-readable transition log (red -> apply -> green). */
  messages: string[];
  /** Why QA did not complete (guard failure, no reproduction, apply/verify fail). */
  abortReason?: string;
}

/**
 * Inputs to a single cht-conf bucket invocation (see src/utils/cht-conf-runner.ts).
 * The runner builds the `cht` argv from these; the agent never embeds credentials
 * in a log line.
 */
export interface ChtConfRunOptions {
  action: ConfigUploadAction;
  /** The instance URL WITH embedded credentials (https://user:pass@host). */
  instanceUrl: string;
  /** Project folder passed to cht-conf `--source`. */
  configPath: string;
  /** Optional single-form filter (positional arg on the form-upload verbs). */
  artifact?: string;
  /** Override the cht-conf binary (default: `cht`); lets tests stub a fake script. */
  bin?: string;
  /** Per-bucket timeout in ms before the process is killed and marked failed. */
  timeoutMs?: number;
}

/**
 * Inputs to a generic cht-conf invocation (the low-level runner under
 * runBucket, also driving the test-data verbs csv-to-docs / upload-docs /
 * create-users). Verbs run in order inside ONE `cht` process.
 */
export interface ChtConfExecOptions {
  /** cht-conf actions to run, in order (e.g. ['csv-to-docs', 'upload-docs']). */
  verbs: string[];
  /**
   * The instance URL WITH embedded credentials (https://user:pass@host).
   * OMIT for an OFFLINE run (no `--url`) — e.g. the dev-phase convert-only step,
   * which never touches an instance.
   */
  instanceUrl?: string;
  /** Project folder passed to cht-conf `--source`. */
  configPath: string;
  /**
   * Add `--skip-validate` (Enketo/pyxform form validation off). Not in
   * AUTONOMOUS_FLAGS; used by the offline convert step, matching the fixture's
   * documented offline convert.
   */
  skipValidate?: boolean;
  /** Positional args appended after the verbs (e.g. a form filter). */
  extraArgs?: string[];
  /**
   * Working directory for the spawned process. cht-conf writes report files
   * (upload-docs.<ts>.log.json) into its cwd, so data runs point this at the
   * data project to keep droppings out of the repo. Defaults to the agent cwd.
   */
  cwd?: string;
  /** Log label ("[cht-conf] <label> ..."); defaults to the joined verbs. */
  logLabel?: string;
  /** Override the cht-conf binary (default: `cht`); lets tests stub a fake script. */
  bin?: string;
  /** Timeout in ms before the process is killed. */
  timeoutMs?: number;
}

/**
 * Raw outcome of a generic cht-conf invocation. Never a rejection — spawn
 * errors and timeouts are folded in so callers can aggregate without
 * per-invocation try/catch. Callers interpret `output` (cht-conf logs
 * everything to stdout) with the parsers in src/utils/test-data.ts.
 */
export interface ChtConfExecResult {
  /** Process exit code; null when it never exited cleanly (killed / not started). */
  exitCode: number | null;
  /** Interleaved stdout+stderr of the run. */
  output: string;
  /** True when the run was killed by the timeout. */
  timedOut: boolean;
  /** Set when the process could not be spawned at all (e.g. binary missing). */
  startError?: string;
}

/**
 * Inputs to prepareTestData's real path. The data project is a cht-conf
 * project folder: docs come from `<dataPath>/csv/*.csv` (csv-to-docs naming:
 * place.<type>.csv, person.csv, report.<form>.csv, contact.csv, users.csv),
 * and user accounts from `<dataPath>/users.csv` (hand-written, or generated
 * by csv-to-docs from users.*.csv inputs). create-users only runs when that
 * file exists — cht-conf throws on a missing users.csv.
 */
export interface PrepareTestDataOptions {
  /** cht-conf project folder holding csv/ (required by the real path). */
  dataPath?: string;
  /** Override the cht-conf binary (default: `cht`); lets tests stub a fake script. */
  bin?: string;
  /** Per-invocation timeout in ms before the process is killed. */
  timeoutMs?: number;
}

/**
 * Tuning for readiness polling (see src/utils/cht-readiness.ts)
 */
export interface ReadinessOptions {
  /** Maximum total time to wait before giving up (ms). */
  maxWaitMs?: number;
  /** Initial delay between polls (ms). */
  initialDelayMs?: number;
  /** Upper bound on the exponential backoff delay (ms). */
  maxDelayMs?: number;
  /** Per-request timeout so a hung connection can't block past maxWaitMs (ms). */
  requestTimeoutMs?: number;
}

/**
 * Inputs to provision an environment (need a local code path OR a published version)
 */
export interface ProvisionOptions {
  chtCorePath?: string;
  version?: string;
  network?: string;
  /**
   * Target URL of the running instance. Real-path fallback order:
   * options.url ?? process.env.CHT_URL ?? https://nginx (cht-agent-net).
   */
  url?: string;
  /**
   * Credentials for the instance. Real-path fallback order: options.auth,
   * then creds embedded in the resolved URL (always stripped from handle.url
   * — logged URLs and fetch() must stay cred-free), then
   * COUCHDB_USER/COUCHDB_PASSWORD env (the scripts/test-env-up.sh seam),
   * then medic/password (cht-docker-compose.sh defaults).
   */
  auth?: { user: string; password: string };
  /** Readiness polling tuning (the human may take minutes to bring the env up). */
  readiness?: ReadinessOptions;
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
  /** True when every cht-conf seeding invocation exited cleanly. */
  succeeded: boolean;
  /**
   * _ids of the docs seeded via csv-to-docs + upload-docs (evidence for the
   * QA verify step; also what the couchdb-tier reset wipes and reseeds).
   * User ACCOUNTS created by create-users are not docs and are not listed.
   */
  seededDocIds: string[];
}

/**
 * Reset granularity (see Test Environment Layer recommendation, three-tier reset)
 */
export type ResetTier = 'couchdb' | 'restart' | 'full';

// ============================================================================
// MCP tool types (additional) — from #63 dev layer
// ============================================================================

/**
 * Available MCP tools for CHT documentation
 */
export type MCPToolName = 'search_docs' | 'ask_question' | 'get_sources';

/**
 * Parameters for ask_question MCP tool
 */
export interface MCPAskQuestionParams {
  question: string;
  threadId?: string; // For conversation continuity
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

// ============================================================================
// Human feedback / validation checkpoint types — from #63 dev layer
// ============================================================================

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
// Code context types — from #63 dev layer
// ============================================================================

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

// ============================================================================
// DEVELOPMENT SUPERVISOR TYPES
// ============================================================================

/**
 * Where the development phase writes its generated fix, and which toolchain
 * validates it. Resolved from the ticket's layer by resolveDevelopmentTarget
 * (src/utils/dev-target.ts): cht-conf tickets target the mounted deployment
 * config repo (CHT_CONF_PATH) with the cht-conf toolchain; everything else
 * stays on the cht-core working copy.
 */
export interface DevelopmentTarget {
  /** Working copy the development phase edits and writes to. */
  repoPath: string;
  toolchain: 'cht-conf' | 'cht-core';
}

/**
 * Development workflow options
 */
export interface DevelopmentOptions {
  chtCorePath: string;
  previewMode: boolean; // true = staging + diff, false = direct write
  stagingPath?: string; // OS temp directory when previewMode=true
  /**
   * Layer-routed write/workspace target (#134). When set (cht-conf tickets),
   * the development phase edits and writes the fix under
   * developmentTarget.repoPath (the CHT_CONF_PATH deployment config) rather than
   * chtCorePath. Absent for cht-core tickets, which keep chtCorePath unchanged
   * — so cht-core behaviour is byte-identical to before layer routing existed.
   */
  developmentTarget?: DevelopmentTarget;
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
  | 'properties'
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
  /** DeepWiki / canonical-config findings forwarded from the research phase. */
  codeContextFindings?: CodeContextFindings;
  additionalContext?: string; // Feedback from previous iteration
  /** Files from previous iteration that passed validation — carry forward unchanged */
  passingFiles?: GeneratedFile[];
  /** Files that the validator flagged — only regenerate these (preserves original action) */
  failingFiles?: FailingFileRef[];
}

export type FailingFileRef = { path: string; action: 'create' | 'modify' };

/**
 * Cross-file issue surfaced by static validators OR runtime signals.
 *
 * Static validators (cross-file-validator, ast-validator) fill
 * referencedIdentifier + expectedSource + reason.
 *
 * Runtime signals (partial generation, plan adherence, compile errors,
 * LLM-flagged discoveries) fill issueType + description.
 *
 * Consumers should display the first non-empty of `reason` or `description`.
 */
export interface CrossFileIssue {
  filePath: string;
  referencedIdentifier?: string;
  expectedSource?: string;
  reason?: string;
  /**
   * Discriminator for non-static-validator issue kinds. Known values:
   * 'compile-error', 'partial-completion', 'plan-adherence-missing',
   * 'plan-adherence-extra', 'plan-discovered-missing'.
   */
  issueType?: string;
  /** Human-readable description for runtime-signal issues. */
  description?: string;
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
  beadsSessionId?: string;
  crossFileIssues?: CrossFileIssue[];
  /** True when the compile gate did not run (e.g., tsc unavailable). HC2 banner reads this. */
  compileGateSkipped?: boolean;
  /** Human-readable reason associated with {@link compileGateSkipped}. */
  compileGateSkipReason?: string;
}

/**
 * One requirement mapped to the test scenarios that cover it. Mirrors the
 * test-gen layer's TestScenario shape but declared here to keep `src/types`
 * free of any import from `src/layers/*` (which would close a dependency cycle).
 */
export interface TestScenarioChecklistItem {
  requirement: string;
  scenarios: Array<{
    name: string;
    type: 'happy-path' | 'error' | 'edge-case' | 'boundary';
    description: string;
  }>;
}

/**
 * Test Generation result, as consumed by the Development Supervisor. `files`
 * is the types-local GeneratedFile (same as CodeGenerationResult.files); the
 * adapter converts the layer's LayerGeneratedFile output to this shape.
 */
export interface TestGenerationResult {
  files: GeneratedFile[];
  explanation: string;
  requirementsChecklist: TestScenarioChecklistItem[];
  warnings?: string[];
  tokensUsed?: number;
  modelUsed?: string;
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
 * Per-file validation feedback for selective regeneration
 */
export interface FileValidationFeedback {
  filePath: string;
  passed: boolean;
  issues: string[];
}

/**
 * Implementation validation result
 */
export interface ImplementationValidation {
  requirementsMet: RequirementValidation[];
  acceptanceCriteriaPassed: AcceptanceCriteriaValidation[];
  overallScore: number; // 0-100
  recommendations: string[];
  feedbackForCodeGen?: string; // Actionable feedback for refinement loop retry
  perFileFeedback?: FileValidationFeedback[]; // Per-file pass/fail for selective regeneration
}

/**
 * Development phase types
 */
export type DevelopmentPhase =
  | 'init'
  | 'code-generation'
  | 'test-generation'
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
  /** DeepWiki / canonical-config findings forwarded from the research phase. */
  codeContextFindings?: CodeContextFindings;
  options: DevelopmentOptions;
  codeGeneration?: CodeGenerationResult;
  testGeneration?: TestGenerationResult;
  validationResult?: ImplementationValidation;
  currentPhase: DevelopmentPhase;
  errors: string[];
  iterationCount?: number;
  validationFeedback?: string;
  perFileFeedback?: FileValidationFeedback[];
}

/**
 * Development Supervisor input (from Research phase)
 */
export interface DevelopmentInput {
  issue: IssueTemplate;
  orchestrationPlan: OrchestrationPlan;
  researchFindings: ResearchFindings;
  contextAnalysis: ContextAnalysisResult;
  /** DeepWiki / canonical-config findings forwarded from the research phase. */
  codeContextFindings?: CodeContextFindings;
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
