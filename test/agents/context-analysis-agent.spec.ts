import { expect } from 'chai';
import * as sinon from 'sinon';
import * as contextLoader from '../../src/utils/context-loader';
import { ContextAnalysisAgent } from '../../src/agents/context-analysis-agent';
import { IssueTemplate, ResolvedIssueContext } from '../../src/types';

describe('ContextAnalysisAgent', () => {
  let agent: ContextAnalysisAgent;

  beforeEach(() => {
    // Stub ensureAgentMemoryExists to prevent filesystem operations during tests
    sinon.stub(contextLoader, 'ensureAgentMemoryExists');
    agent = new ContextAnalysisAgent();
  });

  afterEach(() => {
    sinon.restore();
  });

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
      requirements: ['Requirement 1'],
      acceptance_criteria: ['Criterion 1'],
      constraints: ['Constraint 1'],
      ...overrides,
    },
  });

  // Helper to create test resolved issue context
  const createResolvedContext = (
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

  describe('calculateSimilarityScore', () => {
    it('should return higher score when category matches', () => {
      const issue = createTestIssue({ type: 'feature' });
      const resolved = createResolvedContext({ category: 'feature' });
      const resolvedDifferent = createResolvedContext({ category: 'bug' });

      // Access private method for testing
      const scoreMatch = (agent as any).calculateSimilarityScore(issue, resolved);
      const scoreDifferent = (agent as any).calculateSimilarityScore(issue, resolvedDifferent);

      expect(scoreMatch).to.be.greaterThan(scoreDifferent);
    });

    it('should return higher score when domain matches', () => {
      const issue = createTestIssue({
        technical_context: { domain: 'contacts', components: [] },
      });
      const resolvedMatch = createResolvedContext({ domains: ['contacts'] });
      const resolvedDifferent = createResolvedContext({ domains: ['messaging'] });

      const scoreMatch = (agent as any).calculateSimilarityScore(issue, resolvedMatch);
      const scoreDifferent = (agent as any).calculateSimilarityScore(issue, resolvedDifferent);

      expect(scoreMatch).to.be.greaterThan(scoreDifferent);
    });

    it('should return higher score when components overlap', () => {
      const issue = createTestIssue({
        technical_context: {
          domain: 'contacts',
          components: ['contacts-controller', 'contacts-module'],
        },
      });
      const resolvedMatch = createResolvedContext({
        components: {
          api: ['contacts-controller'],
          webapp: ['contacts-module'],
        },
      });
      const resolvedNoOverlap = createResolvedContext({
        components: {
          api: ['other-controller'],
          webapp: ['other-module'],
        },
      });

      const scoreMatch = (agent as any).calculateSimilarityScore(issue, resolvedMatch);
      const scoreNoOverlap = (agent as any).calculateSimilarityScore(issue, resolvedNoOverlap);

      expect(scoreMatch).to.be.greaterThan(scoreNoOverlap);
    });

    it('should cap score at 1.0', () => {
      const issue = createTestIssue({
        type: 'feature',
        technical_context: {
          domain: 'contacts',
          components: ['contacts-controller'],
        },
      });
      const resolved = createResolvedContext({
        category: 'feature',
        domains: ['contacts'],
        components: { api: ['contacts-controller'] },
      });

      const score = (agent as any).calculateSimilarityScore(issue, resolved);

      expect(score).to.be.at.most(1.0);
    });
  });

  describe('calculateSuccessRate', () => {
    it('should return 0.5 for empty contexts', () => {
      const rate = (agent as any).calculateSuccessRate([]);

      expect(rate).to.equal(0.5);
    });

    it('should return 1.0 when all contexts are completed', () => {
      const contexts = [
        createResolvedContext({ phase: 'completed' }),
        createResolvedContext({ phase: 'completed' }),
        createResolvedContext({ phase: 'completed' }),
      ];

      const rate = (agent as any).calculateSuccessRate(contexts);

      expect(rate).to.equal(1.0);
    });

    it('should calculate correct ratio for mixed phases', () => {
      const contexts = [
        createResolvedContext({ phase: 'completed' }),
        createResolvedContext({ phase: 'completed' }),
        createResolvedContext({ phase: 'implementation' as any }), // Not completed
        createResolvedContext({ phase: 'validation' as any }), // Not completed
      ];

      const rate = (agent as any).calculateSuccessRate(contexts);

      expect(rate).to.equal(0.5); // 2 out of 4
    });
  });

  describe('findCommonComponents', () => {
    it('should return empty array for empty contexts', () => {
      const common = (agent as any).findCommonComponents([]);

      expect(common).to.deep.equal([]);
    });

    it('should find components that appear in multiple contexts', () => {
      const contexts = [
        createResolvedContext({
          components: { api: ['contacts-controller'], webapp: ['contacts-module'] },
        }),
        createResolvedContext({
          components: { api: ['contacts-controller'], webapp: ['other-module'] },
        }),
        createResolvedContext({
          components: { api: ['contacts-controller'], webapp: ['contacts-module'] },
        }),
      ];

      const common = (agent as any).findCommonComponents(contexts);

      expect(common).to.include('contacts-controller');
    });

    it('should return at most 3 common components', () => {
      const contexts = [
        createResolvedContext({
          components: { api: ['a', 'b', 'c', 'd', 'e'] },
        }),
        createResolvedContext({
          components: { api: ['a', 'b', 'c', 'd', 'e'] },
        }),
      ];

      const common = (agent as any).findCommonComponents(contexts);

      expect(common).to.have.lengthOf.at.most(3);
    });

    it('should sort by frequency (most common first)', () => {
      const contexts = [
        createResolvedContext({ components: { api: ['a', 'b'] } }),
        createResolvedContext({ components: { api: ['a', 'b'] } }),
        createResolvedContext({ components: { api: ['a'] } }),
      ];

      const common = (agent as any).findCommonComponents(contexts);

      // 'a' appears 3 times, 'b' appears 2 times
      expect(common[0]).to.equal('a');
    });
  });

  describe('generateRecommendations', () => {
    it('should recommend reviewing similar contexts when found', () => {
      const issue = createTestIssue();
      const similarContexts = [createResolvedContext(), createResolvedContext()];

      const recommendations = (agent as any).generateRecommendations(
        issue,
        similarContexts,
        [],
        undefined
      );

      expect(recommendations.some((r: string) => r.includes('similar past implementation'))).to.be
        .true;
    });

    it('should add test coverage recommendation for features', () => {
      const issue = createTestIssue({ type: 'feature' });

      const recommendations = (agent as any).generateRecommendations(issue, [], [], undefined);

      expect(recommendations.some((r: string) => r.includes('test coverage'))).to.be.true;
    });

    it('should add regression test recommendation for bugs', () => {
      const issue = createTestIssue({ type: 'bug' });

      const recommendations = (agent as any).generateRecommendations(issue, [], [], undefined);

      expect(recommendations.some((r: string) => r.includes('regression'))).to.be.true;
    });

    it('should add validation recommendation for high priority issues', () => {
      const issue = createTestIssue({ priority: 'high' });

      const recommendations = (agent as any).generateRecommendations(issue, [], [], undefined);

      expect(recommendations.some((r: string) => r.includes('integration tests'))).to.be.true;
    });
  });
});
