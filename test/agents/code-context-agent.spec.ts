import { expect } from 'chai';
import { CodeContextAgent } from '../../src/agents/code-context-agent';
import { IssueTemplate, OpenDeepWikiMCPResponse } from '../../src/types';

describe('CodeContextAgent', () => {
  let agent: CodeContextAgent;

  beforeEach(() => {
    agent = new CodeContextAgent({ useMockMCP: true });
  });

  // Helper to create test issue template
  const createTestIssue = (overrides: Partial<IssueTemplate['issue']> = {}): IssueTemplate => ({
    issue: {
      title: 'Test Issue',
      type: 'feature',
      priority: 'medium',
      description: 'Test description for the issue',
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

  describe('search', () => {
    it('should return code context findings for contacts domain', async () => {
      const issue = createTestIssue({
        technical_context: { domain: 'contacts', components: ['api/contacts'] },
      });

      const result = await agent.search(issue);

      expect(result.architectureInsights).to.be.an('array');
      expect(result.architectureInsights.length).to.be.greaterThan(0);
      expect(result.source).to.equal('mock');
      expect(result.confidence).to.be.greaterThan(0);
    });

    it('should return code context findings for forms-and-reports domain', async () => {
      const issue = createTestIssue({
        technical_context: { domain: 'forms-and-reports', components: ['webapp/forms'] },
      });

      const result = await agent.search(issue);

      expect(result.architectureInsights.length).to.be.greaterThan(0);
    });

    it('should return code context findings for tasks-and-targets domain', async () => {
      const issue = createTestIssue({
        technical_context: { domain: 'tasks-and-targets', components: [] },
      });

      const result = await agent.search(issue);

      expect(result.architectureInsights.length).to.be.greaterThan(0);
    });

    it('should return code context findings for authentication domain', async () => {
      const issue = createTestIssue({
        technical_context: { domain: 'authentication', components: [] },
      });

      const result = await agent.search(issue);

      expect(result.architectureInsights.length).to.be.greaterThan(0);
    });

    it('should return code context findings for messaging domain', async () => {
      const issue = createTestIssue({
        technical_context: { domain: 'messaging', components: [] },
      });

      const result = await agent.search(issue);

      expect(result.architectureInsights.length).to.be.greaterThan(0);
    });

    it('should return code context findings for data-sync domain', async () => {
      const issue = createTestIssue({
        technical_context: { domain: 'data-sync', components: [] },
      });

      const result = await agent.search(issue);

      expect(result.architectureInsights.length).to.be.greaterThan(0);
    });

    it('should return code context findings for configuration domain', async () => {
      const issue = createTestIssue({
        technical_context: { domain: 'configuration', components: [] },
      });

      const result = await agent.search(issue);

      expect(result.architectureInsights.length).to.be.greaterThan(0);
    });

    it('should use configuration as default domain when domain is undefined', async () => {
      const issue = {
        issue: {
          title: 'Test Issue',
          type: 'feature' as const,
          priority: 'medium' as const,
          description: 'Test description',
          technical_context: {
            domain: undefined as any,
            components: [],
          },
          requirements: [],
          acceptance_criteria: [],
          constraints: [],
        },
      };

      const result = await agent.search(issue);

      expect(result.architectureInsights).to.be.an('array');
    });

    it('should include module relationships', async () => {
      const issue = createTestIssue({
        technical_context: { domain: 'contacts', components: [] },
      });

      const result = await agent.search(issue);

      expect(result.moduleRelationships).to.be.an('array');
      expect(result.moduleRelationships.length).to.be.greaterThan(0);
    });

    it('should include diagrams', async () => {
      const issue = createTestIssue({
        technical_context: { domain: 'contacts', components: [] },
      });

      const result = await agent.search(issue);

      expect(result.diagrams).to.be.an('array');
      expect(result.diagrams.length).to.be.greaterThan(0);
    });

    it('should include relevant repos', async () => {
      const issue = createTestIssue({
        technical_context: { domain: 'contacts', components: [] },
      });

      const result = await agent.search(issue);

      expect(result.relevantRepos).to.be.an('array');
      expect(result.relevantRepos).to.include('cht-core');
    });

    it('should have high confidence when insights are found', async () => {
      const issue = createTestIssue({
        technical_context: { domain: 'contacts', components: [] },
      });

      const result = await agent.search(issue);

      expect(result.confidence).to.equal(0.8);
    });

    it('should have empty warnings for successful mock responses', async () => {
      const issue = createTestIssue({
        technical_context: { domain: 'contacts', components: [] },
      });

      const result = await agent.search(issue);

      expect(result.warnings).to.be.an('array');
      expect(result.warnings).to.have.lengthOf(0);
    });
  });

  describe('buildSearchQuery', () => {
    it('should include domain in query', () => {
      const issue = createTestIssue({
        technical_context: { domain: 'contacts', components: [] },
      });

      const query = (agent as any).buildSearchQuery(issue);

      expect(query).to.include('contacts');
    });

    it('should include components in query', () => {
      const issue = createTestIssue({
        technical_context: {
          domain: 'contacts',
          components: ['api/contacts-controller'],
        },
      });

      const query = (agent as any).buildSearchQuery(issue);

      expect(query).to.include('api/contacts-controller');
    });

    it('should include title in query', () => {
      const issue = createTestIssue({
        title: 'Add contact search feature',
      });

      const query = (agent as any).buildSearchQuery(issue);

      expect(query).to.include('Add contact search feature');
    });
  });

  describe('determineRepos', () => {
    it('should always include cht-core', () => {
      const repos = (agent as any).determineRepos('contacts');

      expect(repos).to.include('cht-core');
    });

    it('should include cht-conf for configuration domain', () => {
      const repos = (agent as any).determineRepos('configuration');

      expect(repos).to.include('cht-core');
      expect(repos).to.include('cht-conf');
    });

    it('should include cht-watchdog for data-sync domain', () => {
      const repos = (agent as any).determineRepos('data-sync');

      expect(repos).to.include('cht-core');
      expect(repos).to.include('cht-watchdog');
    });

    it('should include cht-watchdog for messaging domain', () => {
      const repos = (agent as any).determineRepos('messaging');

      expect(repos).to.include('cht-core');
      expect(repos).to.include('cht-watchdog');
    });

    it('should only include cht-core for contacts domain', () => {
      const repos = (agent as any).determineRepos('contacts');

      expect(repos).to.deep.equal(['cht-core']);
    });

    it('should only include cht-core for forms-and-reports domain', () => {
      const repos = (agent as any).determineRepos('forms-and-reports');

      expect(repos).to.deep.equal(['cht-core']);
    });

    it('should only include cht-core for tasks-and-targets domain', () => {
      const repos = (agent as any).determineRepos('tasks-and-targets');

      expect(repos).to.deep.equal(['cht-core']);
    });

    it('should only include cht-core for authentication domain', () => {
      const repos = (agent as any).determineRepos('authentication');

      expect(repos).to.deep.equal(['cht-core']);
    });
  });

  describe('processMCPResponse', () => {
    it('should return insights from successful response', () => {
      const response: OpenDeepWikiMCPResponse = {
        success: true,
        data: {
          architectureInsights: [
            {
              component: 'api/test',
              description: 'Test component',
              patterns: ['pattern1'],
              dependencies: ['dep1'],
            },
          ],
          moduleRelationships: [
            {
              source: 'a',
              target: 'b',
              relationship: 'calls',
              description: 'a calls b',
            },
          ],
          diagrams: ['graph TD\n    A --> B'],
          structure: [],
        },
      };

      const result = (agent as any).processMCPResponse(response, 'cht-core');

      expect(result.insights).to.have.lengthOf(1);
      expect(result.relationships).to.have.lengthOf(1);
      expect(result.diagrams).to.have.lengthOf(1);
      expect(result.warnings).to.have.lengthOf(0);
    });

    it('should return empty results with warning for failed response', () => {
      const response: OpenDeepWikiMCPResponse = {
        success: false,
        error: 'Service unavailable',
      };

      const result = (agent as any).processMCPResponse(response, 'cht-core');

      expect(result.insights).to.have.lengthOf(0);
      expect(result.relationships).to.have.lengthOf(0);
      expect(result.diagrams).to.have.lengthOf(0);
      expect(result.warnings).to.have.lengthOf(1);
      expect(result.warnings[0]).to.include('cht-core');
    });

    it('should return empty results with warning for rate-limited response', () => {
      const response: OpenDeepWikiMCPResponse = {
        success: false,
        rateLimited: true,
      };

      const result = (agent as any).processMCPResponse(response, 'cht-core');

      expect(result.insights).to.have.lengthOf(0);
      expect(result.warnings).to.have.lengthOf(1);
      expect(result.warnings[0]).to.include('Rate limited');
    });

    it('should return empty results with warning when data is missing', () => {
      const response: OpenDeepWikiMCPResponse = {
        success: true,
      };

      const result = (agent as any).processMCPResponse(response, 'cht-core');

      expect(result.insights).to.have.lengthOf(0);
      expect(result.warnings).to.have.lengthOf(1);
    });
  });

  describe('MCP integration', () => {
    it('should throw error when MCP is disabled and not implemented', async () => {
      const agentWithoutMock = new CodeContextAgent({ useMockMCP: false });
      const issue = createTestIssue();

      try {
        await agentWithoutMock.search(issue);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect((error as Error).message).to.include('OpenDeepWiki MCP integration not yet implemented');
      }
    });
  });
});
