import {
  IssueTemplate,
  ResolvedIssueContext,
  ResearchFindings,
  ContextAnalysisResult,
} from '../src/types';

/**
 * Helper to create test issue template
 */
export const createTestIssue = (overrides: Partial<IssueTemplate['issue']> = {}): IssueTemplate => ({
  issue: {
    title: 'Test Issue',
    type: 'feature',
    priority: 'medium',
    description: 'Test description',
    technical_context: {
      domain: 'contacts',
      components: ['api/controllers/contacts', 'webapp/modules/contacts'],
    },
    requirements: ['Requirement 1'],
    acceptance_criteria: ['Criterion 1'],
    constraints: ['Constraint 1'],
    ...overrides,
  },
});

/**
 * Helper to create test resolved issue context
 */
export const createResolvedContext = (
  overrides: Partial<ResolvedIssueContext> = {}
): ResolvedIssueContext => ({
  id: 'resolved-001',
  timestamp: '2024-01-15',
  category: 'feature',
  domains: ['contacts'],
  phase: 'completed',
  task_id: 'TASK-001',
  summary: 'Test resolved issue',
  tech_stack: ['typescript'],
  components: {
    api: ['contacts-controller'],
    webapp: ['contacts-module'],
  },
  ...overrides,
});

/**
 * Helper to create test research findings
 */
export const createResearchFindings = (overrides: Partial<ResearchFindings> = {}): ResearchFindings => ({
  documentationReferences: [],
  relevantExamples: [],
  suggestedApproaches: ['Approach 1'],
  relatedDomains: ['contacts'],
  confidence: 0.8,
  source: 'kapa-ai',
  ...overrides,
});

/**
 * Helper to create test context analysis result
 */
export const createContextAnalysis = (
  overrides: Partial<ContextAnalysisResult> = {}
): ContextAnalysisResult => ({
  similarContexts: [],
  reusablePatterns: [],
  relevantDesignDecisions: [],
  recommendations: ['Recommendation 1'],
  historicalSuccessRate: 0.8,
  relatedDomains: ['contacts'],
  ...overrides,
});

/**
 * Helper to create proxyquire mock for fs module
 */
export const createMockFs = (overrides: {
  existsSync?: () => boolean;
  readFileSync?: () => string;
  readdirSync?: () => any[];
  mkdirSync?: (dirPath: string) => void;
} = {}) => ({
  existsSync: overrides.existsSync || (() => false),
  readFileSync: overrides.readFileSync || (() => ''),
  readdirSync: overrides.readdirSync || (() => []),
  mkdirSync: overrides.mkdirSync || (() => {}),
});
