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

  describe('analyze', () => {
    it('should return empty analysis when no domain specified', async () => {
      const issueWithoutDomain = {
        issue: {
          title: 'Test',
          type: 'feature' as const,
          priority: 'medium' as const,
          description: 'Test',
          technical_context: { domain: undefined as any, components: [] },
          requirements: [],
          acceptance_criteria: [],
          constraints: [],
        },
      };

      const result = await agent.analyze(issueWithoutDomain);

      expect(result.similarContexts).to.deep.equal([]);
      expect(result.recommendations).to.include('Domain not specified - unable to analyze context');
      // #135: the synthetic success rate is gone
      expect(result).to.not.have.property('historicalSuccessRate');
    });

    it('should return related domains when domain overview exists', async () => {
      const issue = createTestIssue();

      sinon.stub(contextLoader, 'loadDomainOverview').returns({
        metadata: { domain: 'contacts', last_updated: '2024-01-15', related_domains: ['forms-and-reports'] },
        content: 'Overview',
      });
      sinon.stub(contextLoader, 'loadDomainComponents').returns(null);
      sinon.stub(contextLoader, 'findResolvedIssuesByDomain').returns([]);
      sinon.stub(contextLoader, 'getRelatedDomains').returns(['forms-and-reports']);

      const result = await agent.analyze(issue);

      expect(result.relatedDomains).to.deep.equal(['forms-and-reports']);
    });

    it('should not report a synthetic historical success rate (#135)', async () => {
      const issue = createTestIssue();

      sinon.stub(contextLoader, 'loadDomainOverview').returns(null);
      sinon.stub(contextLoader, 'loadDomainComponents').returns(null);
      sinon.stub(contextLoader, 'findResolvedIssuesByDomain').returns([
        createResolvedContext({ phase: 'completed', category: 'feature', domains: ['contacts'] }),
        createResolvedContext({ id: 'r2', issue_number: 2, phase: 'completed', category: 'feature', domains: ['contacts'] }),
      ]);
      sinon.stub(contextLoader, 'getRelatedDomains').returns([]);

      const result = await agent.analyze(issue);

      expect(result.similarContexts.length).to.be.greaterThan(0);
      expect(result).to.not.have.property('historicalSuccessRate');
    });

    it('should extract patterns from similar contexts', async () => {
      const issue = createTestIssue();

      sinon.stub(contextLoader, 'loadDomainOverview').returns(null);
      sinon.stub(contextLoader, 'loadDomainComponents').returns(null);
      sinon.stub(contextLoader, 'findResolvedIssuesByDomain').returns([
        createResolvedContext({ category: 'feature', domains: ['contacts'], components: { api: ['shared'] } }),
        createResolvedContext({ id: 'r2', category: 'feature', domains: ['contacts'], components: { api: ['shared'] } }),
      ]);
      sinon.stub(contextLoader, 'getRelatedDomains').returns([]);

      const result = await agent.analyze(issue);

      expect(result.reusablePatterns.length).to.be.greaterThan(0);
    });
  });

  describe('layer scoping and dedupe (#134/#135)', () => {
    it('should never surface cht-conf entries for a cht-core ticket', () => {
      sinon.stub(contextLoader, 'findResolvedIssuesByDomain').returns([
        createResolvedContext({
          id: 'core-1',
          issue_number: 1,
          category: 'feature',
          domains: ['contacts'],
        }),
        createResolvedContext({
          id: 'conf-1',
          issue_number: 2,
          category: 'feature',
          domains: ['contacts'],
          layer: 'cht-conf',
          configArtifact: 'form',
        }),
      ]);

      const issue = createTestIssue({
        type: 'feature',
        technical_context: { domain: 'contacts', components: [] },
      });
      const result = (agent as any).findSimilarIssues(issue, 'contacts');

      expect(result.map((r: any) => r.id)).to.deep.equal(['core-1']);
    });

    it('should only surface cht-conf entries for a cht-conf ticket', () => {
      sinon.stub(contextLoader, 'findResolvedIssuesByDomain').returns([
        createResolvedContext({
          id: 'core-1',
          issue_number: 1,
          category: 'bug',
          domains: ['forms-and-reports'],
        }),
        createResolvedContext({
          id: 'conf-1',
          issue_number: 2,
          category: 'bug',
          domains: ['forms-and-reports'],
          layer: 'cht-conf',
          configArtifact: 'form',
          mechanism: 'relevant',
        }),
      ]);

      const issue = createTestIssue({
        type: 'bug',
        technical_context: {
          domain: 'forms-and-reports',
          components: [],
          layer: 'cht-conf',
          configArtifact: 'form',
        },
      });
      const result = (agent as any).findSimilarIssues(issue, 'forms-and-reports');

      expect(result.map((r: any) => r.id)).to.deep.equal(['conf-1']);
    });

    it('should keep both layers in play for an investigate ticket', () => {
      sinon.stub(contextLoader, 'findResolvedIssuesByDomain').returns([
        createResolvedContext({
          id: 'core-1',
          issue_number: 1,
          category: 'feature',
          domains: ['contacts'],
        }),
        createResolvedContext({
          id: 'conf-1',
          issue_number: 2,
          category: 'feature',
          domains: ['contacts'],
          layer: 'cht-conf',
          configArtifact: 'form',
        }),
      ]);

      const issue = createTestIssue({
        type: 'feature',
        technical_context: {
          domain: 'contacts',
          components: [],
          layer: 'investigate',
          configArtifact: 'form',
        },
      });
      const result = (agent as any).findSimilarIssues(issue, 'contacts');

      const ids = result.map((r: any) => r.id);
      expect(ids).to.include('core-1');
      expect(ids).to.include('conf-1');
    });

    it('should de-duplicate similar issues by issue id on a relinked corpus', () => {
      // Fixture mirrors the post-#129-relink corpus: two drafts distilled from
      // different PRs of the SAME GitHub issue share a trustworthy issueNumber.
      sinon.stub(contextLoader, 'findResolvedIssuesByDomain').returns([
        createResolvedContext({
          id: 'contacts/9601-dedupe-check',
          issue_number: 9601,
          category: 'feature',
          domains: ['contacts'],
          components: { api: ['contacts-controller'] },
        }),
        createResolvedContext({
          id: 'contacts/9601-dedupe-modal',
          issue_number: 9601,
          category: 'feature',
          domains: ['contacts'],
          components: {},
        }),
        createResolvedContext({
          id: 'contacts/8000-other',
          issue_number: 8000,
          category: 'feature',
          domains: ['contacts'],
          components: {},
        }),
      ]);

      const issue = createTestIssue({
        type: 'feature',
        technical_context: { domain: 'contacts', components: ['contacts-controller'] },
      });
      const result = (agent as any).findSimilarIssues(issue, 'contacts');

      // The higher-scoring draft of issue 9601 survives; its duplicate does not
      expect(result.map((r: any) => r.id)).to.deep.equal([
        'contacts/9601-dedupe-check',
        'contacts/8000-other',
      ]);
    });

    it('should keep entries without issue_number distinct', () => {
      sinon.stub(contextLoader, 'findResolvedIssuesByDomain').returns([
        createResolvedContext({ id: 'r1', category: 'feature', domains: ['contacts'] }),
        createResolvedContext({ id: 'r2', category: 'feature', domains: ['contacts'] }),
      ]);

      const issue = createTestIssue({
        type: 'feature',
        technical_context: { domain: 'contacts', components: [] },
      });
      const result = (agent as any).findSimilarIssues(issue, 'contacts');

      expect(result).to.have.lengthOf(2);
    });
  });

  describe('config-aware scoring (#134)', () => {
    const confTicket = createTestIssue({
      type: 'bug',
      description: 'The relevant expression keeps the question visible after a miscarriage',
      technical_context: {
        domain: 'forms-and-reports',
        components: [],
        layer: 'cht-conf',
        configArtifact: 'form',
      },
    });

    it('should rank a matching configArtifact above a non-matching one', () => {
      const matching = createResolvedContext({
        category: 'bug',
        layer: 'cht-conf',
        configArtifact: 'form',
      });
      const nonMatching = createResolvedContext({
        category: 'bug',
        layer: 'cht-conf',
        configArtifact: 'task',
      });

      const scoreMatching = (agent as any).calculateSimilarityScore(confTicket, matching);
      const scoreNonMatching = (agent as any).calculateSimilarityScore(confTicket, nonMatching);

      expect(scoreMatching).to.be.greaterThan(scoreNonMatching);
    });

    it('should add mechanism overlap when the ticket text names the mechanism', () => {
      const namedMechanism = createResolvedContext({
        category: 'bug',
        layer: 'cht-conf',
        configArtifact: 'form',
        mechanism: 'relevant',
      });
      const otherMechanism = createResolvedContext({
        category: 'bug',
        layer: 'cht-conf',
        configArtifact: 'form',
        mechanism: 'events',
      });

      const scoreNamed = (agent as any).calculateSimilarityScore(confTicket, namedMechanism);
      const scoreOther = (agent as any).calculateSimilarityScore(confTicket, otherMechanism);

      expect(scoreNamed).to.be.greaterThan(scoreOther);
    });

    it('should ignore core-shaped component overlap for cht-conf entries', () => {
      const ticketWithComponents = createTestIssue({
        type: 'bug',
        technical_context: {
          domain: 'forms-and-reports',
          components: ['contacts-controller'],
          layer: 'cht-conf',
          configArtifact: 'form',
        },
      });
      const overlapWrongArtifact = createResolvedContext({
        category: 'bug',
        layer: 'cht-conf',
        configArtifact: 'task',
        components: { api: ['contacts-controller'] },
      });
      const matchingArtifactNoOverlap = createResolvedContext({
        category: 'bug',
        layer: 'cht-conf',
        configArtifact: 'form',
        components: {},
      });

      const scoreOverlap = (agent as any).calculateSimilarityScore(
        ticketWithComponents,
        overlapWrongArtifact
      );
      const scoreArtifact = (agent as any).calculateSimilarityScore(
        ticketWithComponents,
        matchingArtifactNoOverlap
      );

      expect(scoreArtifact).to.be.greaterThan(scoreOverlap);
    });

    it('should keep the original scoring for core-core pairs', () => {
      const issue = createTestIssue({
        type: 'feature',
        technical_context: { domain: 'contacts', components: [] },
      });
      const resolved = createResolvedContext({ category: 'feature', domains: ['contacts'] });

      const score = (agent as any).calculateSimilarityScore(issue, resolved);

      // category (0.3) + domain (0.4), no component overlap
      expect(score).to.be.closeTo(0.7, 0.0001);
    });
  });

  describe('config patterns and design decisions (#134)', () => {
    const snippet = "# before\n${pnc_visit} = 'yes'\n# after\n${pnc_visit} = 'yes' and ${pnc_outcome} != 'miscarriage'";

    const confContext = createResolvedContext({
      id: 'conf-1',
      issue_number: 2,
      category: 'bug',
      domains: ['forms-and-reports'],
      layer: 'cht-conf',
      configArtifact: 'form',
      mechanism: 'relevant',
      summary: 'PNC follow-up prompted after miscarriage',
      fix: snippet,
    });

    it('should emit the config snippet as the pattern for cht-conf entries', () => {
      const patterns = (agent as any).extractPatterns([confContext], null);

      expect(patterns).to.have.lengthOf(1);
      expect(patterns[0].example).to.equal(snippet);
      expect(patterns[0].pattern).to.include('relevant');
      expect(patterns[0].pattern).to.include('form');
      expect(patterns[0].description).to.include('PNC follow-up');
    });

    it('should fall back to an issue reference when the snippet is missing', () => {
      const withoutFix = createResolvedContext({
        id: 'conf-2',
        layer: 'cht-conf',
        configArtifact: 'task',
        fix: undefined,
      });

      const patterns = (agent as any).extractPatterns([withoutFix], null);

      expect(patterns).to.have.lengthOf(1);
      expect(patterns[0].example).to.include('conf-2');
    });

    it('should not group cht-conf entries into core component patterns', () => {
      const confA = createResolvedContext({
        id: 'conf-a',
        layer: 'cht-conf',
        configArtifact: 'form',
        components: { api: ['shared-component'] },
      });
      const confB = createResolvedContext({
        id: 'conf-b',
        layer: 'cht-conf',
        configArtifact: 'form',
        components: { api: ['shared-component'] },
      });

      const patterns = (agent as any).extractPatterns([confA, confB], null);

      expect(patterns).to.have.lengthOf(2);
      const names = patterns.map((p: any) => p.pattern);
      expect(names.some((n: string) => n.includes('implementation pattern'))).to.be.false;
    });

    it('should still group core entries into component patterns', () => {
      const coreA = createResolvedContext({ id: 'core-a', components: { api: ['shared'] } });
      const coreB = createResolvedContext({ id: 'core-b', components: { api: ['shared'] } });

      const patterns = (agent as any).extractPatterns([coreA, coreB], null);

      expect(patterns).to.have.lengthOf(1);
      expect(patterns[0].pattern).to.equal('shared implementation pattern');
    });

    it('should emit a config-layer design decision for cht-conf entries', () => {
      const decisions = (agent as any).extractDesignDecisions(
        [confContext],
        'forms-and-reports'
      );

      expect(decisions).to.have.lengthOf(1);
      expect(decisions[0].decision).to.include('config layer');
      expect(decisions[0].decision).to.include('form');
      expect(decisions[0].decision).to.include('relevant');
      expect(decisions[0].rationale).to.include('PNC follow-up');
    });

    it('should analyze a cht-conf ticket end to end against config entries only', async () => {
      sinon.stub(contextLoader, 'loadDomainOverview').returns(null);
      sinon.stub(contextLoader, 'loadDomainComponents').returns(null);
      sinon.stub(contextLoader, 'getRelatedDomains').returns([]);
      sinon.stub(contextLoader, 'findResolvedIssuesByDomain').returns([
        createResolvedContext({
          id: 'core-1',
          issue_number: 1,
          category: 'bug',
          domains: ['forms-and-reports'],
        }),
        confContext,
      ]);

      const issue = createTestIssue({
        type: 'bug',
        technical_context: {
          domain: 'forms-and-reports',
          components: [],
          layer: 'cht-conf',
          configArtifact: 'form',
        },
      });

      const result = await agent.analyze(issue);

      expect(result.similarContexts.map((c) => c.id)).to.deep.equal(['conf-1']);
      expect(result.reusablePatterns).to.have.lengthOf(1);
      expect(result.reusablePatterns[0].example).to.equal(snippet);
      expect(result).to.not.have.property('historicalSuccessRate');
    });
  });

  describe('findSimilarIssues', () => {
    it('should return empty array when no resolved issues exist', () => {
      sinon.stub(contextLoader, 'findResolvedIssuesByDomain').returns([]);

      const issue = createTestIssue();
      const result = (agent as any).findSimilarIssues(issue, 'contacts');

      expect(result).to.deep.equal([]);
    });

    it('should return at most 5 similar issues', () => {
      sinon.stub(contextLoader, 'findResolvedIssuesByDomain').returns(
        Array.from({ length: 10 }, (_, i) =>
          createResolvedContext({
            id: `resolved-${i}`,
            category: 'feature',
            domains: ['contacts'],
            components: { api: ['contacts-controller'] },
          })
        )
      );

      const issue = createTestIssue({
        type: 'feature',
        technical_context: { domain: 'contacts', components: ['contacts-controller'] },
      });
      const result = (agent as any).findSimilarIssues(issue, 'contacts');

      expect(result.length).to.be.at.most(5);
    });
  });
});
