import { expect } from 'chai';
import * as path from 'path';
import {
  parseFrontmatter,
  validateFrontmatter,
  validateBody,
  validateFile,
  findContextFiles,
  loadSchema,
} from '../../src/cli/validate-context';

const defs = loadSchema();

const VALID_FRONTMATTER = {
  id: 'cht-core-1234',
  category: 'bug',
  domain: 'contacts',
  subDomain: 'lineage',
  issueNumber: 1234,
  issueUrl: 'https://github.com/medic/cht-core/issues/1234',
  title: 'Fix duplicate contact creation',
  lastUpdated: '2025-06-01',
  summary: 'Fixed a bug where duplicate contacts were created during offline sync.',
  services: ['api', 'webapp'],
  techStack: ['typescript', 'angular'],
};

const VALID_BODY = `
## Problem

Description of the problem.

## Root Cause

What caused it.

## Solution

How it was fixed.

## Code Patterns

Relevant patterns.

## Design Choices

Why this approach.

## Related Files

- path/to/file.ts

## Testing

What was tested.

## Related Issues

- #5678: Related issue
`;

const buildMarkdown = (frontmatter: Record<string, unknown>, body: string) => {
  const lines = Object.entries(frontmatter).map(([key, value]) => {
    if (Array.isArray(value)) {
      return `${key}:\n${value.map(v => `  - ${v}`).join('\n')}`;
    }
    return `${key}: ${value}`;
  });
  return `---\n${lines.join('\n')}\n---\n${body}`;
};

describe('validate-context', () => {
  describe('parseFrontmatter', () => {
    it('should parse valid frontmatter and body', () => {
      const content = buildMarkdown(VALID_FRONTMATTER, VALID_BODY);
      const result = parseFrontmatter(content);

      expect(result.frontmatter).to.not.be.null;
      expect(result.frontmatter!.id).to.equal('cht-core-1234');
      expect(result.frontmatter!.domain).to.equal('contacts');
      expect(result.body).to.include('## Problem');
    });

    it('should return null frontmatter when delimiters are missing', () => {
      const result = parseFrontmatter('No frontmatter here');

      expect(result.frontmatter).to.be.null;
      expect(result.body).to.equal('No frontmatter here');
    });

    it('should keep date values as strings', () => {
      const content = buildMarkdown(VALID_FRONTMATTER, VALID_BODY);
      const result = parseFrontmatter(content);

      expect(result.frontmatter!.lastUpdated).to.be.a('string');
      expect(result.frontmatter!.lastUpdated).to.equal('2025-06-01');
    });
  });

  describe('validateFrontmatter', () => {
    it('should pass with valid frontmatter', () => {
      const errors = validateFrontmatter(VALID_FRONTMATTER, defs, 'test.md');

      expect(errors).to.be.empty;
    });

    it('should report missing required fields', () => {
      const fm = { domain: 'contacts' };
      const errors = validateFrontmatter(fm, defs, 'test.md');
      const missingFields = errors.map(e => e.field);

      expect(missingFields).to.include('id');
      expect(missingFields).to.include('category');
      expect(missingFields).to.include('title');
      expect(missingFields).to.include('issueNumber');
      expect(missingFields).to.include('issueUrl');
      expect(missingFields).to.include('lastUpdated');
      expect(missingFields).to.include('summary');
      expect(missingFields).to.include('services');
      expect(missingFields).to.include('techStack');
    });

    it('should reject invalid domain', () => {
      const fm = { ...VALID_FRONTMATTER, domain: 'invalid-domain' };
      const errors = validateFrontmatter(fm, defs, 'test.md');

      expect(errors).to.have.lengthOf(1);
      expect(errors[0].field).to.equal('domain');
      expect(errors[0].message).to.include('invalid-domain');
    });

    it('should reject invalid category', () => {
      const fm = { ...VALID_FRONTMATTER, category: 'enhancement' };
      const errors = validateFrontmatter(fm, defs, 'test.md');

      expect(errors).to.have.lengthOf(1);
      expect(errors[0].field).to.equal('category');
      expect(errors[0].message).to.include('enhancement');
    });

    it('should reject invalid id format', () => {
      const fm = { ...VALID_FRONTMATTER, id: 'bad-id' };
      const errors = validateFrontmatter(fm, defs, 'test.md');

      expect(errors).to.have.lengthOf(1);
      expect(errors[0].field).to.equal('id');
    });

    it('should reject invalid issueUrl format', () => {
      const fm = { ...VALID_FRONTMATTER, issueUrl: 'https://example.com/issues/1234' };
      const errors = validateFrontmatter(fm, defs, 'test.md');

      expect(errors).to.have.lengthOf(1);
      expect(errors[0].field).to.equal('issueUrl');
    });

    it('should reject invalid lastUpdated format', () => {
      const fm = { ...VALID_FRONTMATTER, lastUpdated: '06-01-2025' };
      const errors = validateFrontmatter(fm, defs, 'test.md');

      expect(errors).to.have.lengthOf(1);
      expect(errors[0].field).to.equal('lastUpdated');
    });

    it('should reject non-integer issueNumber', () => {
      const fm = { ...VALID_FRONTMATTER, issueNumber: 'abc' };
      const errors = validateFrontmatter(fm, defs, 'test.md');

      expect(errors).to.have.lengthOf(1);
      expect(errors[0].field).to.equal('issueNumber');
    });

    it('should reject invalid service in services array', () => {
      const fm = { ...VALID_FRONTMATTER, services: ['api', 'invalid-service'] };
      const errors = validateFrontmatter(fm, defs, 'test.md');

      expect(errors).to.have.lengthOf(1);
      expect(errors[0].field).to.equal('services');
      expect(errors[0].message).to.include('invalid-service');
    });

    it('should reject empty services array', () => {
      const fm = { ...VALID_FRONTMATTER, services: [] };
      const errors = validateFrontmatter(fm, defs, 'test.md');

      expect(errors).to.have.lengthOf(1);
      expect(errors[0].field).to.equal('services');
      expect(errors[0].message).to.include('at least 1');
    });

    it('should reject title exceeding max length', () => {
      const fm = { ...VALID_FRONTMATTER, title: 'A'.repeat(201) };
      const errors = validateFrontmatter(fm, defs, 'test.md');

      expect(errors).to.have.lengthOf(1);
      expect(errors[0].field).to.equal('title');
      expect(errors[0].message).to.include('at most 200');
    });

    it('should allow additional properties like subDomain', () => {
      const fm = { ...VALID_FRONTMATTER, subDomain: 'enketo', customField: 'value' };
      const errors = validateFrontmatter(fm, defs, 'test.md');

      expect(errors).to.be.empty;
    });

    it('should accept all valid domains', () => {
      const domains = [
        'authentication', 'contacts', 'forms-and-reports', 'tasks-and-targets',
        'messaging', 'data-sync', 'configuration', 'interoperability',
      ];

      for (const domain of domains) {
        const fm = { ...VALID_FRONTMATTER, domain };
        const errors = validateFrontmatter(fm, defs, 'test.md');
        expect(errors, `Expected no errors for domain: ${domain}`).to.be.empty;
      }
    });

    it('should accept all valid categories', () => {
      const categories = ['bug', 'feature', 'improvement'];

      for (const category of categories) {
        const fm = { ...VALID_FRONTMATTER, category };
        const errors = validateFrontmatter(fm, defs, 'test.md');
        expect(errors, `Expected no errors for category: ${category}`).to.be.empty;
      }
    });
  });

  describe('validateBody', () => {
    it('should pass with all required sections', () => {
      const errors = validateBody(VALID_BODY, 'test.md');

      expect(errors).to.be.empty;
    });

    it('should report missing sections', () => {
      const body = '## Problem\n\nSome problem.\n';
      const errors = validateBody(body, 'test.md');

      expect(errors.length).to.equal(7);
      const missingSections = errors.map(e => e.message);
      expect(missingSections).to.not.include('Missing required section: ## Problem');
      expect(missingSections).to.include('Missing required section: ## Root Cause');
      expect(missingSections).to.include('Missing required section: ## Solution');
    });

    it('should report all missing sections for empty body', () => {
      const errors = validateBody('', 'test.md');

      expect(errors.length).to.equal(8);
    });
  });

  describe('validateFile', () => {
    it('should validate a real context file from agent-memory', () => {
      const file = path.resolve(__dirname, '../../agent-memory/domains/forms-and-reports/issues/8308-signature-widget-support.md');
      const result = validateFile(file, defs);

      expect(result.valid).to.be.true;
      expect(result.errors).to.be.empty;
    });

    it('should fail for a file without frontmatter', () => {
      const tmpFile = path.resolve(__dirname, '../../agent-memory/TEMPLATE.md');
      // TEMPLATE.md doesn't have real frontmatter, it has the template block
      // Let's use a known file and test the validation logic
      const result = validateFile(tmpFile, defs);

      expect(result.valid).to.be.false;
    });
  });

  describe('findContextFiles', () => {
    it('should find context files in agent-memory', () => {
      const agentMemoryDir = path.resolve(__dirname, '../../agent-memory');
      const files = findContextFiles(agentMemoryDir);

      expect(files.length).to.be.greaterThan(0);
      for (const file of files) {
        expect(file).to.match(/\.md$/);
        expect(file).to.not.include('README.md');
        expect(file).to.not.include('TEMPLATE.md');
      }
    });

    it('should return empty array for non-existent directory', () => {
      const files = findContextFiles('/nonexistent/path');

      expect(files).to.deep.equal([]);
    });
  });
});
