import { expect } from 'chai';
import { DocumentationSearchAgent } from '../../src/agents/documentation-search-agent';
import { createTestIssue } from '../helpers';

describe('DocumentationSearchAgent', () => {
  let agent: DocumentationSearchAgent;

  beforeEach(() => {
    agent = new DocumentationSearchAgent({ useMockMCP: true });
  });

  describe('search', () => {
    // Test all domains with a single parameterized test
    const domains = [
      { name: 'contacts', expectedTopic: 'contacts' },
      { name: 'forms-and-reports', expectedTopic: 'forms' },
      { name: 'tasks-and-targets', expectedTopic: null },
      { name: 'authentication', expectedTopic: null },
      { name: 'messaging', expectedTopic: null },
      { name: 'data-sync', expectedTopic: null },
      { name: 'configuration', expectedTopic: null },
    ];

    domains.forEach(({ name, expectedTopic }) => {
      it(`should return research findings for ${name} domain`, async () => {
        const issue = createTestIssue({
          technical_context: { domain: name as any, components: [] },
        });

        const result = await agent.search(issue);

        expect(result.documentationReferences).to.be.an('array');
        expect(result.documentationReferences.length).to.be.greaterThan(0);
        
        if (expectedTopic) {
          expect(result.documentationReferences[0].topics).to.include(expectedTopic);
        }
      });
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

      // Should not throw and should use configuration domain
      expect(result.documentationReferences).to.be.an('array');
    });

    it('should include relevant examples from documentation', async () => {
      const issue = createTestIssue({
        technical_context: { domain: 'contacts', components: [] },
      });

      const result = await agent.search(issue);

      expect(result.relevantExamples).to.be.an('array');
    });

    it('should include suggested approaches', async () => {
      const issue = createTestIssue({
        technical_context: { domain: 'contacts', components: [] },
      });

      const result = await agent.search(issue);

      expect(result.suggestedApproaches).to.be.an('array');
      expect(result.suggestedApproaches.length).to.be.greaterThan(0);
    });

    it('should identify related domains from documentation topics', async () => {
      const issue = createTestIssue({
        technical_context: { domain: 'contacts', components: [] },
      });

      const result = await agent.search(issue);

      expect(result.relatedDomains).to.be.an('array');
    });

    it('should have high confidence when references are found', async () => {
      const issue = createTestIssue({
        technical_context: { domain: 'contacts', components: [] },
      });

      const result = await agent.search(issue);

      expect(result.confidence).to.be.greaterThan(0.8);
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

    it('should truncate description to 200 characters', () => {
      const longDescription = 'A'.repeat(500);
      const issue = createTestIssue({
        description: longDescription,
      });

      const query = (agent as any).buildSearchQuery(issue);

      // Query should be shorter than full description
      expect(query.length).to.be.lessThan(700);
    });
  });

  describe('generateApproaches', () => {
    it('should generate approaches from relevant sections', () => {
      const references = [
        {
          url: 'https://example.com',
          title: 'Test Reference',
          topics: ['contacts'],
          relevantSections: ['Contact Types', 'Hierarchies'],
        },
      ];
      const issue = createTestIssue();

      const approaches = (agent as any).generateApproaches(references, issue);

      expect(approaches.some((a: string) => a.includes('Contact Types'))).to.be.true;
      expect(approaches.some((a: string) => a.includes('Hierarchies'))).to.be.true;
    });

    it('should add best practices recommendation for features', () => {
      const references: any[] = [];
      const issue = createTestIssue({ type: 'feature' });

      const approaches = (agent as any).generateApproaches(references, issue);

      expect(approaches.some((a: string) => a.includes('best practices'))).to.be.true;
    });

    it('should add debugging recommendation for bugs', () => {
      const references: any[] = [];
      const issue = createTestIssue({ type: 'bug' });

      const approaches = (agent as any).generateApproaches(references, issue);

      expect(approaches.some((a: string) => a.includes('Debug'))).to.be.true;
    });

    it('should limit approaches to 5', () => {
      const references = [
        {
          url: 'https://example.com',
          title: 'Test',
          topics: [],
          relevantSections: ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7'],
        },
      ];
      const issue = createTestIssue();

      const approaches = (agent as any).generateApproaches(references, issue);

      expect(approaches.length).to.be.at.most(5);
    });
  });

  describe('identifyRelatedDomains', () => {
    it('should identify contacts domain from topics', () => {
      const topics = ['contact', 'person'];

      const domains = (agent as any).identifyRelatedDomains(topics);

      expect(domains).to.include('contacts');
    });

    it('should identify forms-and-reports domain from topics', () => {
      const topics = ['form', 'enketo'];

      const domains = (agent as any).identifyRelatedDomains(topics);

      expect(domains).to.include('forms-and-reports');
    });

    it('should identify tasks-and-targets domain from topics', () => {
      const topics = ['task', 'target', 'rules'];

      const domains = (agent as any).identifyRelatedDomains(topics);

      expect(domains).to.include('tasks-and-targets');
    });

    it('should identify authentication domain from topics', () => {
      const topics = ['auth', 'permission', 'role'];

      const domains = (agent as any).identifyRelatedDomains(topics);

      expect(domains).to.include('authentication');
    });

    it('should identify messaging domain from topics', () => {
      const topics = ['sms', 'notification'];

      const domains = (agent as any).identifyRelatedDomains(topics);

      expect(domains).to.include('messaging');
    });

    it('should identify data-sync domain from topics', () => {
      const topics = ['sync', 'replication', 'offline'];

      const domains = (agent as any).identifyRelatedDomains(topics);

      expect(domains).to.include('data-sync');
    });

    it('should identify configuration domain from topics', () => {
      const topics = ['config', 'settings'];

      const domains = (agent as any).identifyRelatedDomains(topics);

      expect(domains).to.include('configuration');
    });

    it('should return empty array when no topics match', () => {
      const topics = ['random', 'unrelated'];

      const domains = (agent as any).identifyRelatedDomains(topics);

      expect(domains).to.deep.equal([]);
    });

    it('should identify multiple domains from mixed topics', () => {
      const topics = ['contact', 'hierarchy', 'form', 'submission'];

      const domains = (agent as any).identifyRelatedDomains(topics);

      expect(domains).to.include('contacts');
      expect(domains).to.include('forms-and-reports');
    });
  });

  describe('processMCPResponse', () => {
    it('should return empty findings for unsuccessful response', () => {
      const issue = createTestIssue();
      const mcpResponse = { success: false, data: null };

      const findings = (agent as any).processMCPResponse(mcpResponse, issue);

      expect(findings.documentationReferences).to.deep.equal([]);
      expect(findings.confidence).to.equal(0);
    });

    it('should extract unique code examples', () => {
      const issue = createTestIssue();
      const mcpResponse = {
        success: true,
        data: {
          references: [
            { url: 'https://1.com', title: 'T1', topics: [], codeExamples: ['example1', 'example2'] },
            { url: 'https://2.com', title: 'T2', topics: [], codeExamples: ['example1', 'example3'] },
          ],
          summary: 'Test',
          relatedTopics: [],
        },
      };

      const findings = (agent as any).processMCPResponse(mcpResponse, issue);

      // Should deduplicate 'example1'
      expect(findings.relevantExamples).to.have.lengthOf(3);
    });

    it('should use "cached" source when using mock MCP', () => {
      const issue = createTestIssue();
      const mcpResponse = {
        success: true,
        data: {
          references: [{ url: 'https://1.com', title: 'T1', topics: [] }],
          summary: 'Test',
          relatedTopics: [],
        },
      };

      const findings = (agent as any).processMCPResponse(mcpResponse, issue);

      expect(findings.source).to.equal('cached');
    });
  });

  describe('MCP integration', () => {
    it('should throw error when MCP is disabled and not implemented', async () => {
      const agentWithoutMock = new DocumentationSearchAgent({ useMockMCP: false });
      const issue = createTestIssue();

      try {
        await agentWithoutMock.search(issue);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect((error as Error).message).to.include('MCP integration not yet implemented');
      }
    });
  });
});
