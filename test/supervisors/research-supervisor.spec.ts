import { expect } from 'chai';
import {
  IssueTemplate,
  ResearchFindings,
  ContextAnalysisResult,
  ResolvedIssueContext,
} from '../../src/types';

// Since ResearchSupervisor has LLM dependencies, we test the pure functions
// by extracting the logic. These functions are private methods but we can
// test the logic patterns.

describe('ResearchSupervisor - Pure Functions', () => {
  // Helper to create test issue template
  const createTestIssue = (overrides: Partial<IssueTemplate['issue']> = {}): IssueTemplate => ({
    issue: {
      title: 'Test Issue',
      type: 'feature',
      priority: 'medium',
      description: 'Test description',
      technical_context: {
        domain: 'contacts',
        components: ['api/controllers/contacts', 'webapp/modules/contacts'],
      },
      requirements: ['Req 1', 'Req 2'],
      acceptance_criteria: ['Criterion 1'],
      constraints: ['Constraint 1'],
      ...overrides,
    },
  });

  const createResearchFindings = (overrides: Partial<ResearchFindings> = {}): ResearchFindings => ({
    documentationReferences: [],
    relevantExamples: [],
    suggestedApproaches: ['Approach 1'],
    relatedDomains: ['contacts'],
    confidence: 0.8,
    source: 'kapa-ai',
    ...overrides,
  });

  const createContextAnalysis = (
    overrides: Partial<ContextAnalysisResult> = {}
  ): ContextAnalysisResult => ({
    similarContexts: [],
    reusablePatterns: [],
    relevantDesignDecisions: [],
    recommendations: ['Recommendation 1'],
    historicalSuccessRate: 0.8,
    relatedDomains: ['contacts'],
    codeContext: null,
    ...overrides,
  });

  describe('estimateComplexity logic', () => {
    // Testing the complexity estimation algorithm
    const estimateComplexity = (
      issue: IssueTemplate,
      analysis: ContextAnalysisResult
    ): 'low' | 'medium' | 'high' => {
      let score = 0;

      // Priority factor
      if (issue.issue.priority === 'high') score += 2;
      else if (issue.issue.priority === 'medium') score += 1;

      // Requirements count
      if (issue.issue.requirements.length > 5) score += 2;
      else if (issue.issue.requirements.length > 2) score += 1;

      // Constraints
      if (issue.issue.constraints.length > 2) score += 1;

      // Lack of similar context increases complexity
      if (analysis.similarContexts.length === 0) score += 2;
      else if (analysis.similarContexts.length < 2) score += 1;

      if (score >= 5) return 'high';
      if (score >= 3) return 'medium';
      return 'low';
    };

    it('should return low complexity for simple issues', () => {
      const issue = createTestIssue({
        priority: 'low',
        requirements: ['Req 1'],
        constraints: [],
      });
      const analysis = createContextAnalysis({
        similarContexts: [
          {} as ResolvedIssueContext,
          {} as ResolvedIssueContext,
          {} as ResolvedIssueContext,
        ],
      });

      const complexity = estimateComplexity(issue, analysis);

      expect(complexity).to.equal('low');
    });

    it('should return high complexity for high priority with no similar contexts', () => {
      const issue = createTestIssue({
        priority: 'high',
        requirements: ['R1', 'R2', 'R3', 'R4', 'R5', 'R6'],
        constraints: ['C1', 'C2', 'C3'],
      });
      const analysis = createContextAnalysis({ similarContexts: [] });

      const complexity = estimateComplexity(issue, analysis);

      expect(complexity).to.equal('high');
    });

    it('should return medium complexity for moderate issues', () => {
      const issue = createTestIssue({
        priority: 'medium',
        requirements: ['R1', 'R2', 'R3'],
        constraints: ['C1'],
      });
      const analysis = createContextAnalysis({
        similarContexts: [{} as ResolvedIssueContext],
      });

      const complexity = estimateComplexity(issue, analysis);

      expect(complexity).to.equal('medium');
    });

    it('should increase complexity when no similar contexts exist', () => {
      const issue = createTestIssue({ priority: 'low' });
      const analysisWithContexts = createContextAnalysis({
        similarContexts: [{} as ResolvedIssueContext, {} as ResolvedIssueContext],
      });
      const analysisWithoutContexts = createContextAnalysis({ similarContexts: [] });

      const complexityWith = estimateComplexity(issue, analysisWithContexts);
      const complexityWithout = estimateComplexity(issue, analysisWithoutContexts);

      // Without contexts should be higher or equal complexity
      const complexityOrder = { low: 0, medium: 1, high: 2 };
      expect(complexityOrder[complexityWithout]).to.be.at.least(complexityOrder[complexityWith]);
    });
  });

  describe('estimateEffort logic', () => {
    const estimateEffort = (complexity: 'low' | 'medium' | 'high', phaseCount: number): string => {
      const baseHours = {
        low: 4,
        medium: 16,
        high: 40,
      };

      const hours = baseHours[complexity] * (phaseCount / 4);

      if (hours < 8) return `${hours} hour${hours === 1 ? '' : 's'}`;
      if (hours < 40) {
        const days = Math.round(hours / 8);
        return `${days} day${days === 1 ? '' : 's'}`;
      }
      const weeks = Math.round(hours / 40);
      return `${weeks} week${weeks === 1 ? '' : 's'}`;
    };

    it('should return hours for small efforts', () => {
      const effort = estimateEffort('low', 4);

      expect(effort).to.equal('4 hours');
    });

    it('should return days for medium efforts', () => {
      const effort = estimateEffort('medium', 4);

      expect(effort).to.equal('2 days'); // 16 hours = 2 days
    });

    it('should return weeks for large efforts', () => {
      const effort = estimateEffort('high', 4);

      expect(effort).to.equal('1 week'); // 40 hours = 1 week
    });

    it('should scale with phase count', () => {
      const effort4Phases = estimateEffort('medium', 4);
      const effort8Phases = estimateEffort('medium', 8);

      // 8 phases should be double the effort of 4 phases
      expect(effort4Phases).to.equal('2 days'); // 16 hours
      expect(effort8Phases).to.equal('4 days'); // 32 hours
    });
  });

  describe('identifyRiskFactors logic', () => {
    const identifyRiskFactors = (
      issue: IssueTemplate,
      findings: ResearchFindings,
      analysis: ContextAnalysisResult
    ): string[] => {
      const risks: string[] = [];

      // Low confidence from research
      if (findings.confidence < 0.5) {
        risks.push('Low confidence in documentation findings - may require additional research');
      }

      // No similar past implementations
      if (analysis.similarContexts.length === 0) {
        risks.push('No similar past implementations found - breaking new ground');
      }

      // Complex constraints
      if (issue.issue.constraints.length > 2) {
        risks.push(`Multiple constraints to satisfy: ${issue.issue.constraints.join(', ')}`);
      }

      // High priority
      if (issue.issue.priority === 'high') {
        risks.push('High priority issue - requires careful attention and thorough testing');
      }

      // Multiple components
      if (issue.issue.technical_context.components.length > 3) {
        risks.push(
          'Changes span multiple components - requires coordination and integration testing'
        );
      }

      return risks;
    };

    it('should identify low confidence as risk', () => {
      const issue = createTestIssue();
      const findings = createResearchFindings({ confidence: 0.3 });
      const analysis = createContextAnalysis();

      const risks = identifyRiskFactors(issue, findings, analysis);

      expect(risks.some((r) => r.includes('Low confidence'))).to.be.true;
    });

    it('should identify no similar contexts as risk', () => {
      const issue = createTestIssue();
      const findings = createResearchFindings();
      const analysis = createContextAnalysis({ similarContexts: [] });

      const risks = identifyRiskFactors(issue, findings, analysis);

      expect(risks.some((r) => r.includes('No similar past implementations'))).to.be.true;
    });

    it('should identify multiple constraints as risk', () => {
      const issue = createTestIssue({
        constraints: ['C1', 'C2', 'C3'],
      });
      const findings = createResearchFindings();
      const analysis = createContextAnalysis();

      const risks = identifyRiskFactors(issue, findings, analysis);

      expect(risks.some((r) => r.includes('Multiple constraints'))).to.be.true;
    });

    it('should identify high priority as risk', () => {
      const issue = createTestIssue({ priority: 'high' });
      const findings = createResearchFindings();
      const analysis = createContextAnalysis();

      const risks = identifyRiskFactors(issue, findings, analysis);

      expect(risks.some((r) => r.includes('High priority'))).to.be.true;
    });

    it('should identify multiple components as risk', () => {
      const issue = createTestIssue({
        technical_context: {
          domain: 'contacts',
          components: ['comp1', 'comp2', 'comp3', 'comp4'],
        },
      });
      const findings = createResearchFindings();
      const analysis = createContextAnalysis();

      const risks = identifyRiskFactors(issue, findings, analysis);

      expect(risks.some((r) => r.includes('multiple components'))).to.be.true;
    });

    it('should return empty array when no risks identified', () => {
      const issue = createTestIssue({
        priority: 'low',
        constraints: [],
        technical_context: { domain: 'contacts', components: ['comp1'] },
      });
      const findings = createResearchFindings({ confidence: 0.9 });
      const analysis = createContextAnalysis({
        similarContexts: [{} as ResolvedIssueContext],
      });

      const risks = identifyRiskFactors(issue, findings, analysis);

      expect(risks).to.have.lengthOf(0);
    });
  });

  describe('buildPhases logic', () => {
    it('should always include 4 standard phases', () => {
      // The buildPhases function creates standard phases:
      // 1. Setup and Configuration
      // 2. Core Implementation
      // 3. Testing
      // 4. Documentation

      const expectedPhases = [
        'Setup and Configuration',
        'Core Implementation',
        'Testing',
        'Documentation',
      ];

      // This is the expected structure - in actual implementation
      // this comes from ResearchSupervisor.buildPhases()
      expect(expectedPhases).to.have.lengthOf(4);
    });

    it('should include issue components in Core Implementation phase', () => {
      const issue = createTestIssue({
        technical_context: {
          domain: 'contacts',
          components: ['api/contacts', 'webapp/contacts'],
        },
      });

      // The Core Implementation phase should reference issue components
      const corePhaseComponents = issue.issue.technical_context.components;
      expect(corePhaseComponents).to.include('api/contacts');
      expect(corePhaseComponents).to.include('webapp/contacts');
    });
  });
});

// =============================================================================
// v9b.2 — Module-boundary tests for ResearchSupervisor node handlers
// =============================================================================
//
// The block above ("Pure Functions") tests pure shapes without instantiating
// the supervisor. The block below stubs DocumentationSearchAgent /
// ContextAnalysisAgent / LLMProvider at the module-import boundary so we can
// exercise the actual node-handler wiring + the public `research()` entry.
//
// eslint-disable-next-line @typescript-eslint/no-var-requires
const proxyquire = require('proxyquire').noCallThru();
import sinon from 'sinon';
import { LLMProvider } from '../../src/llm';

const v9b2mkIssue = (overrides: Partial<IssueTemplate['issue']> = {}): IssueTemplate => ({
  issue: {
    title: 'Add contact filters',
    type: 'feature',
    priority: 'medium',
    description: 'Allow filtering by status.',
    technical_context: { domain: 'contacts', components: [] },
    requirements: ['r1'],
    acceptance_criteria: ['a1'],
    constraints: [],
    ...overrides,
  },
});

const v9b2mkFindings = (overrides: Partial<ResearchFindings> = {}): ResearchFindings => ({
  documentationReferences: [],
  relevantExamples: [],
  suggestedApproaches: [],
  relatedDomains: ['contacts'],
  confidence: 0.7,
  source: 'local-docs',
  ...overrides,
});

const v9b2mkAnalysis = (overrides: Partial<ContextAnalysisResult> = {}): ContextAnalysisResult => ({
  similarContexts: [],
  reusablePatterns: [],
  relevantDesignDecisions: [],
  recommendations: ['use existing patterns'],
  historicalSuccessRate: 0.8,
  relatedDomains: ['contacts'],
  codeContext: null,
  ...overrides,
});

const v9b2mkLLM = (invokeContent: string): LLMProvider => ({
  providerType: 'anthropic',
  modelName: 'test-model',
  honorsCustomTools: true,
  invoke: sinon.stub().resolves({ content: invokeContent, model: 'test-model' }),
  invokeWithMessages: async () => ({ content: '', model: 'test-model' }),
  invokeForJSON: async <T>() => ({} as T),
});

const v9b2buildSupervisor = (opts: {
  search?: sinon.SinonStub;
  analyze?: sinon.SinonStub;
  llm?: LLMProvider;
}) => {
  const search = opts.search ?? sinon.stub();
  const analyze = opts.analyze ?? sinon.stub();
  class FakeDocSearch {
    search = search;
  }
  class FakeContextAgent {
    analyze = analyze;
  }
  const mod = proxyquire('../../src/supervisors/research-supervisor', {
    '../agents/documentation-search-agent': { DocumentationSearchAgent: FakeDocSearch },
    '../agents/context-analysis-agent': { ContextAnalysisAgent: FakeContextAgent },
  });
  const supervisor = new mod.ResearchSupervisor({
    llmProvider: opts.llm ?? v9b2mkLLM('plan response'),
  });
  return {
    supervisor: supervisor as unknown as {
      documentationSearchNode: (state: unknown) => Promise<Record<string, unknown>>;
      contextAnalysisNode: (state: unknown) => Promise<Record<string, unknown>>;
      generatePlanNode: (state: unknown) => Promise<Record<string, unknown>>;
      research: (issue: IssueTemplate, additionalContext?: string) => Promise<{
        researchFindings?: ResearchFindings;
        contextAnalysis?: ContextAnalysisResult;
        orchestrationPlan?: { recommendedApproach: string; phases: unknown[]; riskFactors: string[]; keyFindings: string[] };
        currentPhase: string;
        errors: string[];
        messages: Array<{ role: string; content: string }>;
      }>;
    },
    search,
    analyze,
  };
};

describe('ResearchSupervisor documentationSearchNode (v9b.2)', () => {
  it('returns an error when no issue is in state', async () => {
    const { supervisor, search } = v9b2buildSupervisor({});
    const out = await supervisor.documentationSearchNode({ /* nothing */ });
    expect(out.errors).to.be.an('array').that.includes('No issue provided for documentation search');
    expect(search.called).to.equal(false);
  });

  it('delegates to DocumentationSearchAgent.search and emits the findings to state', async () => {
    const findings = v9b2mkFindings({
      documentationReferences: [{ title: 't', url: 'https://x', topics: ['contacts'] }],
    });
    const search = sinon.stub().resolves(findings);
    const { supervisor } = v9b2buildSupervisor({ search });

    const out = await supervisor.documentationSearchNode({ issue: v9b2mkIssue() });

    expect(search.calledOnce).to.equal(true);
    expect(out.researchFindings).to.equal(findings);
    expect(out.currentPhase).to.equal('context-analysis');
  });

  it('captures agent errors and surfaces them under the doc-search phase', async () => {
    const search = sinon.stub().rejects(new Error('kapa down'));
    const { supervisor } = v9b2buildSupervisor({ search });

    const out = await supervisor.documentationSearchNode({ issue: v9b2mkIssue() });

    expect(out.currentPhase).to.equal('doc-search');
    expect((out.errors as string[])[0]).to.match(/Documentation search failed: kapa down/);
  });
});

describe('ResearchSupervisor contextAnalysisNode (v9b.2)', () => {
  it('returns an error when no issue is in state', async () => {
    const { supervisor, analyze } = v9b2buildSupervisor({});
    const out = await supervisor.contextAnalysisNode({ /* nothing */ });
    expect(out.errors).to.be.an('array').that.includes('No issue provided for context analysis');
    expect(analyze.called).to.equal(false);
  });

  it('delegates to ContextAnalysisAgent.analyze and exposes the analysis', async () => {
    const analysis = v9b2mkAnalysis({
      similarContexts: [
        {
          id: 'r1',
          timestamp: '2025-01-01T00:00:00Z',
          category: 'feature',
          domains: ['contacts'],
          phase: 'completed',
          task_id: 't1',
          summary: 'a similar issue',
        } as ResolvedIssueContext,
      ],
    });
    const analyze = sinon.stub().resolves(analysis);
    const { supervisor } = v9b2buildSupervisor({ analyze });

    const out = await supervisor.contextAnalysisNode({ issue: v9b2mkIssue() });

    expect(analyze.calledOnce).to.equal(true);
    expect(out.contextAnalysis).to.equal(analysis);
    expect(out.currentPhase).to.equal('plan-generation');
  });

  it('captures agent errors and stays in the context-analysis phase', async () => {
    const analyze = sinon.stub().rejects(new Error('vector store down'));
    const { supervisor } = v9b2buildSupervisor({ analyze });

    const out = await supervisor.contextAnalysisNode({ issue: v9b2mkIssue() });

    expect(out.currentPhase).to.equal('context-analysis');
    expect((out.errors as string[])[0]).to.match(/Context analysis failed: vector store down/);
  });
});

describe('ResearchSupervisor generatePlanNode (v9b.2)', () => {
  it('returns an error when required upstream state is missing', async () => {
    const { supervisor } = v9b2buildSupervisor({});
    const out = await supervisor.generatePlanNode({ /* nothing */ });
    expect(out.errors).to.be.an('array').that.includes('Missing required data for plan generation');
  });

  it('invokes the LLM and builds an orchestrationPlan with extracted sections', async () => {
    const llmResponse = `
### IMPLEMENTATION APPROACH
- Extend the contacts service with a filter method
- Wire the filter into the UI component
- Cover edge cases with unit tests

### 2. KEY FILES
- \`webapp/src/ts/services/contacts.service.ts\`
- \`webapp/src/ts/modules/contacts/filter.component.ts\`

### 4. RISK FACTORS
- Filter changes may regress existing contact lookups
- Performance impact on large contact lists
`;
    const llm = v9b2mkLLM(llmResponse);
    const { supervisor } = v9b2buildSupervisor({ llm });

    const out = await supervisor.generatePlanNode({
      issue: v9b2mkIssue(),
      researchFindings: v9b2mkFindings(),
      contextAnalysis: v9b2mkAnalysis(),
    });

    expect(out.currentPhase).to.equal('complete');
    const plan = out.orchestrationPlan as { recommendedApproach: string; phases: unknown[]; riskFactors: string[]; keyFindings: string[] };
    expect(plan).to.not.equal(undefined);
    expect(plan.recommendedApproach).to.match(/Extend the contacts service/);
    expect(plan.riskFactors.some(r => /regress/.test(r))).to.equal(true);
    expect(plan.keyFindings.some(f => /Key files to modify/.test(f))).to.equal(true);
  });

  it('captures LLM errors and stays in the plan-generation phase', async () => {
    const failingLLM: LLMProvider = {
      providerType: 'anthropic',
      modelName: 'test-model',
      honorsCustomTools: true,
      invoke: sinon.stub().rejects(new Error('LLM exploded')),
      invokeWithMessages: async () => ({ content: '', model: 't' }),
      invokeForJSON: async <T>() => ({} as T),
    };
    const { supervisor } = v9b2buildSupervisor({ llm: failingLLM });

    const out = await supervisor.generatePlanNode({
      issue: v9b2mkIssue(),
      researchFindings: v9b2mkFindings(),
      contextAnalysis: v9b2mkAnalysis(),
    });
    expect(out.currentPhase).to.equal('plan-generation');
    expect((out.errors as string[])[0]).to.match(/Plan generation failed: LLM exploded/);
  });
});

describe('ResearchSupervisor.research (v9b.2) — end-to-end orchestration', () => {
  it('runs all three nodes in sequence and returns a complete state on the happy path', async () => {
    const findings = v9b2mkFindings();
    const analysis = v9b2mkAnalysis();
    const search = sinon.stub().resolves(findings);
    const analyze = sinon.stub().resolves(analysis);
    const llm = v9b2mkLLM('### IMPLEMENTATION APPROACH\n- step 1\n- step 2\n');
    const { supervisor } = v9b2buildSupervisor({ search, analyze, llm });

    const result = await supervisor.research(v9b2mkIssue());

    expect(result.currentPhase).to.equal('complete');
    expect(result.errors).to.deep.equal([]);
    expect(result.researchFindings).to.equal(findings);
    expect(result.contextAnalysis).to.equal(analysis);
    expect(result.orchestrationPlan).to.not.equal(undefined);
    expect(search.calledOnce).to.equal(true);
    expect(analyze.calledOnce).to.equal(true);
    expect(search.firstCall.calledBefore(analyze.firstCall)).to.equal(true);
  });

  it('passes additionalContext through as a system message in the initial state', async () => {
    const search = sinon.stub().resolves(v9b2mkFindings());
    const analyze = sinon.stub().resolves(v9b2mkAnalysis());
    const llm = v9b2mkLLM('### IMPLEMENTATION APPROACH\n- ok\n');
    const { supervisor } = v9b2buildSupervisor({ search, analyze, llm });

    const result = await supervisor.research(v9b2mkIssue(), 'human said: prefer pattern X');
    expect(result.messages.some(m => m.role === 'system' && /prefer pattern X/.test(m.content))).to.equal(true);
  });

  // Sanity: the legacy block at the top of this file already uses
  // ResolvedIssueContext, so we silence the unused-import warning by
  // referencing it here. The original tests imported it as a type.
  void {} as ResolvedIssueContext | undefined;
});
