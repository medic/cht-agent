import { expect } from 'chai';
import * as sinon from 'sinon';
import { ResearchSupervisor } from '../../src/supervisors/research-supervisor';
import {
  IssueTemplate,
  ResearchFindings,
  CodeContextFindings,
  ContextAnalysisResult,
} from '../../src/types';

/**
 * Layer plumbing (#134): the supervisor lifts layer/configArtifact from the
 * ticket into graph state and hands them to CodeContextAgent.search(). These
 * tests run the real LangGraph with the agents and planner stubbed out.
 */
describe('ResearchSupervisor - layer routing (#134)', () => {
  let originalApiKey: string | undefined;

  before(() => {
    // ChatAnthropic requires a key at construction; no request is ever made
    originalApiKey = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'test-key-never-used';
  });

  after(() => {
    if (originalApiKey === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = originalApiKey;
    }
  });

  afterEach(() => {
    sinon.restore();
  });

  const createTestIssue = (
    overrides: Partial<IssueTemplate['issue']> = {}
  ): IssueTemplate => ({
    issue: {
      title: 'Test Issue',
      type: 'bug',
      priority: 'medium',
      description: 'Test description',
      technical_context: {
        domain: 'contacts',
        components: [],
      },
      requirements: ['Req 1'],
      acceptance_criteria: ['Criterion 1'],
      constraints: [],
      ...overrides,
    },
  });

  const researchFindings: ResearchFindings = {
    documentationReferences: [],
    relevantExamples: [],
    suggestedApproaches: ['Approach 1'],
    relatedDomains: ['contacts'],
    confidence: 0.8,
    source: 'kapa-ai',
  };

  const codeContextFindings: CodeContextFindings = {
    architectureInsights: [],
    moduleRelationships: [],
    diagrams: [],
    relevantRepos: ['cht-conf'],
    warnings: [],
    confidence: 0.8,
    source: 'mock',
  };

  const contextAnalysis: ContextAnalysisResult = {
    similarContexts: [],
    reusablePatterns: [],
    relevantDesignDecisions: [],
    recommendations: ['Recommendation 1'],
    historicalSuccessRate: 0.8,
    relatedDomains: [],
  };

  const runWithStubbedAgents = async (issue: IssueTemplate) => {
    const supervisor = new ResearchSupervisor({ useMockMCP: true });
    const searchStub = sinon.stub().resolves(codeContextFindings);

    (supervisor as any).docSearchAgent = { search: sinon.stub().resolves(researchFindings) };
    (supervisor as any).codeContextAgent = { search: searchStub };
    (supervisor as any).contextAgent = { analyze: sinon.stub().resolves(contextAnalysis) };
    (supervisor as any).plannerModel = { invoke: sinon.stub().resolves({ content: 'the plan' }) };

    const result = await supervisor.research(issue);
    return { searchStub, result };
  };

  it('should pass the ticket layer and configArtifact into the Code Context search', async () => {
    const issue = createTestIssue({
      technical_context: {
        domain: 'forms-and-reports',
        components: [],
        layer: 'cht-conf',
        configArtifact: 'form',
      },
    });

    const { searchStub, result } = await runWithStubbedAgents(issue);

    expect(searchStub.calledOnce).to.be.true;
    expect(searchStub.firstCall.args[1]).to.deep.equal({
      layer: 'cht-conf',
      configArtifact: 'form',
    });
    expect(result.currentPhase).to.equal('complete');
  });

  it('should pass empty routing for tickets without a layer', async () => {
    const issue = createTestIssue();

    const { searchStub, result } = await runWithStubbedAgents(issue);

    expect(searchStub.calledOnce).to.be.true;
    expect(searchStub.firstCall.args[1]).to.deep.equal({
      layer: undefined,
      configArtifact: undefined,
    });
    expect(result.currentPhase).to.equal('complete');
  });

  it('should carry layer and configArtifact in the final graph state', async () => {
    const issue = createTestIssue({
      technical_context: {
        domain: 'forms-and-reports',
        components: [],
        layer: 'investigate',
        configArtifact: 'task',
      },
    });

    const { result } = await runWithStubbedAgents(issue);

    expect(result.layer).to.equal('investigate');
    expect(result.configArtifact).to.equal('task');
  });

  describe('formatInsightLine', () => {
    const insight = {
      component: 'Contact Management',
      description: 'Handles CRUD for people and places',
      patterns: ['Data Flow', 'Architecture'],
      dependencies: [],
      sourceRepo: 'cht-conf',
    };

    it('should label the source wiki when asked (investigate tickets)', () => {
      const supervisor = new ResearchSupervisor({ useMockMCP: true });

      const line = (supervisor as any).formatInsightLine(insight, true);

      expect(line).to.equal(
        '- [cht-conf] **Contact Management**: Handles CRUD for people and places (patterns: Data Flow, Architecture)'
      );
    });

    it('should render the pre-layer format when labelling is off', () => {
      const supervisor = new ResearchSupervisor({ useMockMCP: true });

      const line = (supervisor as any).formatInsightLine(insight, false);

      expect(line).to.equal(
        '- **Contact Management**: Handles CRUD for people and places (patterns: Data Flow, Architecture)'
      );
    });

    it('should never render an empty label for unlabelled insights', () => {
      const supervisor = new ResearchSupervisor({ useMockMCP: true });

      const line = (supervisor as any).formatInsightLine(
        { ...insight, sourceRepo: undefined },
        true
      );

      expect(line).to.equal(
        '- **Contact Management**: Handles CRUD for people and places (patterns: Data Flow, Architecture)'
      );
    });
  });

  it('should not label insight lines in the plan prompt for tickets without a layer', async () => {
    const supervisor = new ResearchSupervisor({ useMockMCP: true });
    const issue = createTestIssue();
    const labelledFindings: CodeContextFindings = {
      ...codeContextFindings,
      architectureInsights: [
        {
          component: 'Contacts',
          description: 'desc',
          patterns: ['p'],
          dependencies: [],
          sourceRepo: 'cht-core',
        },
      ],
    };

    const prompt = (supervisor as any).buildPlanPrompt(
      issue,
      researchFindings,
      contextAnalysis,
      labelledFindings
    );

    expect(prompt).to.include('- **Contacts**: desc (patterns: p)');
    expect(prompt).to.not.include('[cht-core]');
  });

  it('should label insight lines in the plan prompt for investigate tickets', async () => {
    const supervisor = new ResearchSupervisor({ useMockMCP: true });
    const issue = createTestIssue({
      technical_context: { domain: 'contacts', components: [], layer: 'investigate' },
    });
    const labelledFindings: CodeContextFindings = {
      ...codeContextFindings,
      architectureInsights: [
        {
          component: 'Forms',
          description: 'desc',
          patterns: ['p'],
          dependencies: [],
          sourceRepo: 'cht-conf',
        },
      ],
    };

    const prompt = (supervisor as any).buildPlanPrompt(
      issue,
      researchFindings,
      contextAnalysis,
      labelledFindings
    );

    expect(prompt).to.include('- [cht-conf] **Forms**: desc (patterns: p)');
  });
});
