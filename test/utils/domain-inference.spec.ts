import { expect } from 'chai';
import { IssueTemplate, CHTDomain } from '../../src/types';

// Note: Tests for inferDomainAndComponents and enrichIssueTemplate
// are limited because they require mocking the ChatAnthropic LLM.
// The @langchain/anthropic package is ESM-only which creates conflicts
// with the current test setup. Integration tests or a separate ESM test
// runner would be needed for full coverage.

describe('domain-inference', () => {
  // Helper to create test issue template
  const createTestIssue = (overrides: Partial<IssueTemplate['issue']> = {}): IssueTemplate => ({
    issue: {
      title: 'Test Issue',
      type: 'feature',
      priority: 'medium',
      description: 'Test description',
      technical_context: {
        domain: undefined as unknown as CHTDomain,
        components: [],
      },
      requirements: ['Req 1'],
      acceptance_criteria: ['Criterion 1'],
      constraints: ['Constraint 1'],
      ...overrides,
    },
  });

  describe('IssueTemplate structure', () => {
    it('should create valid issue template with domain', () => {
      const issue = createTestIssue({
        technical_context: {
          domain: 'contacts',
          components: ['api/contacts-controller'],
        },
      });

      expect(issue.issue.technical_context.domain).to.equal('contacts');
      expect(issue.issue.technical_context.components).to.deep.equal(['api/contacts-controller']);
    });

    it('should handle all valid CHT domains', () => {
      const validDomains: CHTDomain[] = [
        'authentication',
        'contacts',
        'forms-and-reports',
        'tasks-and-targets',
        'messaging',
        'data-sync',
        'configuration',
      ];

      for (const domain of validDomains) {
        const issue = createTestIssue({
          technical_context: { domain, components: [] },
        });

        expect(issue.issue.technical_context.domain).to.equal(domain);
      }
    });

    it('should include requirements in issue template', () => {
      const issue = createTestIssue({
        requirements: ['First requirement', 'Second requirement'],
      });

      expect(issue.issue.requirements).to.have.lengthOf(2);
      expect(issue.issue.requirements).to.include('First requirement');
    });

    it('should include constraints in issue template', () => {
      const issue = createTestIssue({
        constraints: ['Must work offline', 'Must be fast'],
      });

      expect(issue.issue.constraints).to.have.lengthOf(2);
      expect(issue.issue.constraints).to.include('Must work offline');
    });

    it('should include reference data in issue template', () => {
      const issue = createTestIssue({
        reference_data: {
          similar_implementations: ['https://github.com/medic/cht-core/pull/123'],
          documentation: ['https://docs.communityhealthtoolkit.org/'],
        },
      });

      expect(issue.issue.reference_data?.similar_implementations).to.have.lengthOf(1);
      expect(issue.issue.reference_data?.documentation).to.have.lengthOf(1);
    });

    it('should include existing references in technical context', () => {
      const issue = createTestIssue({
        technical_context: {
          domain: 'contacts',
          components: [],
          existing_references: ['api/contacts/controller.js', 'webapp/modules/contacts'],
        },
      });

      expect(issue.issue.technical_context.existing_references).to.have.lengthOf(2);
    });
  });
});
