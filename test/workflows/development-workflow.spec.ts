import { expect } from 'chai';
import { createDevelopmentInput } from '../../src/workflows/development-workflow';
import {
  ResearchState,
  DevelopmentOptions,
  IssueTemplate,
  OrchestrationPlan,
  ResearchFindings,
  ContextAnalysisResult,
  CodeContextFindings,
} from '../../src/types';

const options: DevelopmentOptions = { chtCorePath: '/tmp/cht-core', previewMode: false };

const issue = {
  issue: {
    title: 'Add contact filters',
    type: 'feature',
    priority: 'medium',
    description: 'Filter contacts by status.',
    technical_context: { domain: 'contacts', components: [] },
    requirements: ['Add filters'],
    acceptance_criteria: ['Filter works'],
    constraints: [],
  },
} as IssueTemplate;

const orchestrationPlan = {
  summary: '',
  keyFindings: [],
  proposedApproach: '',
  estimatedComplexity: 'medium',
  phases: [],
  riskFactors: [],
  estimatedEffort: '',
} as OrchestrationPlan;

const researchFindings = {
  documentationReferences: [],
  relevantExamples: [],
  suggestedApproaches: [],
  relatedDomains: [],
  confidence: 0.5,
  source: 'local-docs',
} as ResearchFindings;

const contextAnalysis = {} as ContextAnalysisResult;

const codeContextFindings: CodeContextFindings = {
  architectureInsights: [
    { component: 'ContactsService', description: 'CRUD for contacts', patterns: ['service'], dependencies: [] },
  ],
  moduleRelationships: [],
  diagrams: [],
  relevantRepos: ['cht-core'],
  warnings: [],
  confidence: 0.9,
  source: 'opendeepwiki',
};

const baseResearch = (overrides: Partial<ResearchState> = {}): ResearchState => ({
  messages: [],
  currentPhase: 'complete',
  errors: [],
  issue,
  orchestrationPlan,
  researchFindings,
  contextAnalysis,
  ...overrides,
});

describe('createDevelopmentInput codeContextFindings bridge (#63)', () => {
  it('forwards codeContextFindings from the research state into the development input', () => {
    const input = createDevelopmentInput(baseResearch({ codeContextFindings }), options);
    expect(input).to.not.equal(null);
    expect(input!.codeContextFindings).to.deep.equal(codeContextFindings);
  });

  it('leaves codeContextFindings undefined when the research phase produced none', () => {
    const input = createDevelopmentInput(baseResearch(), options);
    expect(input).to.not.equal(null);
    expect(input!.codeContextFindings).to.equal(undefined);
  });

  it('returns null when a required research field is missing (issue absent)', () => {
    const input = createDevelopmentInput(baseResearch({ issue: undefined }), options);
    expect(input).to.equal(null);
  });
});
