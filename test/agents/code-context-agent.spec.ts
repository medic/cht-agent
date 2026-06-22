import { expect } from 'chai';
import * as sinon from 'sinon';
import { CodeContextAgent } from '../../src/agents/code-context-agent';
import { OpenDeepWikiClient, DeepWikiRateLimitError } from '../../src/mcp';
import { IssueTemplate, OpenDeepWikiMCPResponse } from '../../src/types';

describe('CodeContextAgent', () => {
  let agent: CodeContextAgent;

  beforeEach(() => {
    agent = new CodeContextAgent({ useMockMCP: true });
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
    const catalogFixture = {
      repository: 'medic/cht-core',
      documents: [
        { title: 'Project Overview', path: '1-getting-started.1-overview' },
        { title: 'Contact Management', path: '4-frontend.2-modules.2-contacts' },
        { title: 'Unit Testing', path: '9-testing.1-unit-tests' },
      ],
    };

    const documentFixture = {
      repository: 'medic/cht-core',
      path: '4-frontend.2-modules.2-contacts',
      title: 'Contact Management',
      content: [
        '# Contact Management',
        '',
        'The contacts module handles CRUD operations and hierarchy navigation for people and places.',
        '',
        '## Data Flow',
        '',
        'Requests flow from the webapp to the API.',
        '',
        '## Architecture',
        '',
        '```mermaid',
        'graph TD',
        '    A[webapp/contacts] -->|HTTP| B[api/people]',
        '    B --> C[shared-libs/lineage]',
        '```',
      ].join('\n'),
    };

    const stubDeepWikiClient = (agentInstance: CodeContextAgent) => {
      const stubClient = sinon.createStubInstance(OpenDeepWikiClient);
      stubClient.getDocumentCatalog.resolves(catalogFixture);
      stubClient.readFullDocument.resolves(documentFixture);
      (agentInstance as any).deepWikiClient = stubClient;
      return stubClient;
    };

    it('should default to real MCP mode (useMockMCP false)', () => {
      const defaultAgent = new CodeContextAgent();

      expect((defaultAgent as any).useMockMCP).to.be.false;
    });

    it('should use the default OpenDeepWiki server URL', () => {
      const defaultAgent = new CodeContextAgent();

      expect((defaultAgent as any).deepWikiServerUrl).to.equal(
        'https://opendeepwiki.dev.medicmobile.org/api/mcp'
      );
    });

    it('should allow overriding the server URL via constructor option', () => {
      const customAgent = new CodeContextAgent({
        deepWikiServerUrl: 'https://custom.example.com/api/mcp',
      });

      expect((customAgent as any).deepWikiServerUrl).to.equal('https://custom.example.com/api/mcp');
    });

    it('should produce findings from live wiki documents', async () => {
      const realAgent = new CodeContextAgent({ useMockMCP: false });
      const stubClient = stubDeepWikiClient(realAgent);
      const issue = createTestIssue({
        title: 'Fix contact hierarchy bug',
        technical_context: { domain: 'contacts', components: ['webapp/contacts'] },
      });

      const result = await realAgent.search(issue);

      expect(stubClient.getDocumentCatalog.calledOnceWith('cht-core')).to.be.true;
      expect(result.source).to.equal('opendeepwiki');
      expect(result.warnings).to.have.lengthOf(0);
      expect(result.confidence).to.equal(0.8);

      expect(result.architectureInsights).to.have.lengthOf(1);
      expect(result.architectureInsights[0].component).to.equal('Contact Management');
      expect(result.architectureInsights[0].description).to.include('CRUD operations');
      expect(result.architectureInsights[0].patterns).to.include('Data Flow');

      expect(result.diagrams).to.have.lengthOf(1);
      expect(result.diagrams[0]).to.include('graph TD');

      expect(result.moduleRelationships).to.have.lengthOf(2);
      expect(result.moduleRelationships[0].source).to.equal('webapp/contacts');
      expect(result.moduleRelationships[0].target).to.equal('api/people');
      expect(result.moduleRelationships[0].description).to.include('HTTP');
      expect(result.moduleRelationships[1].target).to.equal('shared-libs/lineage');
    });

    it('should only read documents relevant to the query', async () => {
      const realAgent = new CodeContextAgent({ useMockMCP: false });
      const stubClient = stubDeepWikiClient(realAgent);
      const issue = createTestIssue({
        title: 'Fix contact hierarchy bug',
        technical_context: { domain: 'contacts', components: [] },
      });

      await realAgent.search(issue);

      expect(stubClient.readFullDocument.calledOnce).to.be.true;
      expect(stubClient.readFullDocument.firstCall.args[1]).to.equal(
        '4-frontend.2-modules.2-contacts'
      );
    });

    it('should add a warning when the catalog fetch fails', async () => {
      const realAgent = new CodeContextAgent({ useMockMCP: false });
      const stubClient = sinon.createStubInstance(OpenDeepWikiClient);
      stubClient.getDocumentCatalog.rejects(new Error('Network error'));
      (realAgent as any).deepWikiClient = stubClient;

      const result = await realAgent.search(createTestIssue());

      expect(result.architectureInsights).to.have.lengthOf(0);
      expect(result.warnings).to.have.lengthOf(1);
      expect(result.warnings[0]).to.include('cht-core');
      expect(result.confidence).to.equal(0.3);
    });

    it('should add a rate-limit warning on DeepWikiRateLimitError', async () => {
      const realAgent = new CodeContextAgent({ useMockMCP: false });
      const stubClient = sinon.createStubInstance(OpenDeepWikiClient);
      stubClient.getDocumentCatalog.rejects(new DeepWikiRateLimitError('cht-core'));
      (realAgent as any).deepWikiClient = stubClient;

      const result = await realAgent.search(createTestIssue());

      expect(result.warnings).to.have.lengthOf(1);
      expect(result.warnings[0]).to.include('Rate limited');
    });
  });

  describe('selectRelevantDocs', () => {
    const entries = [
      { title: 'Project Overview', path: '1-getting-started.1-overview' },
      { title: 'Contact Management', path: '4-frontend.2-modules.2-contacts' },
      { title: 'SMS Messaging', path: '11-messaging.1-sms' },
    ];

    it('should rank documents by query term matches', () => {
      const selected = (agent as any).selectRelevantDocs(entries, 'contacts contact hierarchy');

      expect(selected[0].title).to.equal('Contact Management');
    });

    it('should fall back to architecture/overview docs when nothing matches', () => {
      const selected = (agent as any).selectRelevantDocs(entries, 'zzz qqq');

      expect(selected).to.have.lengthOf(1);
      expect(selected[0].title).to.equal('Project Overview');
    });

    it('should limit the number of selected documents', () => {
      const many = Array.from({ length: 10 }, (_, i) => ({
        title: `Contacts Doc ${i}`,
        path: `contacts-${i}`,
      }));

      const selected = (agent as any).selectRelevantDocs(many, 'contacts');

      expect(selected).to.have.lengthOf(3);
    });
  });

  describe('parseDiagramRelationships', () => {
    it('should parse plain and labelled edges with node label resolution', () => {
      const diagram = [
        'graph TD',
        '    A[webapp/tasks] --> B[rules-engine]',
        '    B -->|emits| C',
      ].join('\n');

      const rels = (agent as any).parseDiagramRelationships(diagram, 'Tasks');

      expect(rels).to.have.lengthOf(2);
      expect(rels[0].source).to.equal('webapp/tasks');
      expect(rels[0].target).to.equal('rules-engine');
      expect(rels[0].relationship).to.equal('depends-on');
      expect(rels[1].source).to.equal('rules-engine');
      expect(rels[1].target).to.equal('C');
      expect(rels[1].description).to.include('emits');
    });

    it('should return empty array for diagrams without edges', () => {
      const rels = (agent as any).parseDiagramRelationships('sequenceDiagram\n  A->>B: hi', 'Doc');

      expect(rels).to.deep.equal([]);
    });
  });

  describe('extractLeadParagraph', () => {
    it('should skip headings and return the first prose paragraph', () => {
      const content = '# Title\n\nFirst paragraph here.\n\nSecond paragraph.';

      const lead = (agent as any).extractLeadParagraph(content);

      expect(lead).to.equal('First paragraph here.');
    });

    it('should truncate long paragraphs', () => {
      const content = `# Title\n\n${'word '.repeat(100)}`;

      const lead = (agent as any).extractLeadParagraph(content);

      expect(lead.length).to.be.at.most(301);
      expect(lead.endsWith('…')).to.be.true;
    });

    it('should return empty string when there is no prose', () => {
      const lead = (agent as any).extractLeadParagraph('# Only Heading');

      expect(lead).to.equal('');
    });
  });
});
