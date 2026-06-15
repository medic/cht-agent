import { expect } from 'chai';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { buildValidator, normalizeFrontmatter } from '../../src/scripts/schema-utils';
import {
  validateFile,
  validateBody,
  isIssueFile,
  collectMarkdownFiles,
} from '../../src/scripts/validate-schema';

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

describe('validate-schema (AJV)', () => {
  const validate = buildValidator();

  /** Field names AJV flagged (required-miss, additionalProperties, or the failing field). */
  const offending = (fm: Record<string, unknown>): string[] => {
    validate(normalizeFrontmatter(fm));
    return (validate.errors ?? []).map((e) => {
      if (e.keyword === 'required') return (e.params as { missingProperty: string }).missingProperty;
      if (e.keyword === 'additionalProperties') {
        return (e.params as { additionalProperty: string }).additionalProperty;
      }
      return e.instancePath.replace(/^\//, '').split('/')[0];
    });
  };
  const isValid = (fm: Record<string, unknown>): boolean => Boolean(validate(normalizeFrontmatter(fm)));

  describe('frontmatter schema', () => {
    it('accepts a well-formed frontmatter object', () => {
      expect(isValid(VALID_FRONTMATTER)).to.equal(true);
    });

    it('reports every missing required field', () => {
      const missing = offending({ domain: 'contacts' });
      for (const f of ['id', 'category', 'issueNumber', 'issueUrl', 'title', 'lastUpdated', 'summary', 'services', 'techStack']) {
        expect(missing, `expected missing: ${f}`).to.include(f);
      }
    });

    it('rejects an invalid domain', () => {
      expect(offending({ ...VALID_FRONTMATTER, domain: 'invalid-domain' })).to.include('domain');
    });

    it('rejects category enhancement (not in the enum)', () => {
      expect(offending({ ...VALID_FRONTMATTER, category: 'enhancement' })).to.include('category');
    });

    it('rejects a malformed id', () => {
      expect(offending({ ...VALID_FRONTMATTER, id: 'bad-id' })).to.include('id');
    });

    it('accepts a cht-interoperability id and issueUrl (widened alternation)', () => {
      expect(isValid({
        ...VALID_FRONTMATTER,
        id: 'cht-interoperability-116',
        issueNumber: 116,
        issueUrl: 'https://github.com/medic/cht-interoperability/issues/116',
        domain: 'interoperability',
      })).to.equal(true);
    });

    it('rejects an off-domain issueUrl host', () => {
      expect(offending({ ...VALID_FRONTMATTER, issueUrl: 'https://example.com/issues/1234' })).to.include('issueUrl');
    });

    it('rejects a wrongly-ordered date (format:date)', () => {
      expect(offending({ ...VALID_FRONTMATTER, lastUpdated: '06-01-2025' })).to.include('lastUpdated');
    });

    it('rejects an impossible calendar date (real date validation, not a regex)', () => {
      expect(offending({ ...VALID_FRONTMATTER, lastUpdated: '2025-13-45' })).to.include('lastUpdated');
    });

    it('rejects a non-integer issueNumber', () => {
      expect(offending({ ...VALID_FRONTMATTER, issueNumber: 'abc' })).to.include('issueNumber');
    });

    it('rejects an invalid service in the services array', () => {
      expect(offending({ ...VALID_FRONTMATTER, services: ['api', 'invalid-service'] })).to.include('services');
    });

    it('rejects an empty services array', () => {
      expect(offending({ ...VALID_FRONTMATTER, services: [] })).to.include('services');
    });

    it('rejects a title over the max length', () => {
      expect(offending({ ...VALID_FRONTMATTER, title: 'A'.repeat(201) })).to.include('title');
    });

    it('rejects an unknown field (additionalProperties:false)', () => {
      const fm = { ...VALID_FRONTMATTER, customField: 'value' };
      expect(isValid(fm)).to.equal(false);
      expect(offending(fm)).to.include('customField');
    });

    it('accepts the optional #109 provenance fields when present', () => {
      const fm = {
        ...VALID_FRONTMATTER,
        source_pr: 'medic/cht-core#1234',
        source_sha: 'a1b2c3d',
        distilled_at: '2025-06-01',
        reviewed_by: null,
        reviewed_at: null,
        confidence: 'high',
        entities: ['api/src/controllers/contacts.js'],
        concepts: ['lineage'],
        related_issues: ['cht-core-5678'],
        stale: false,
        tags: ['offline'],
      };
      expect(isValid(fm)).to.equal(true);
    });

    it('accepts all valid domains', () => {
      const domains = [
        'authentication', 'contacts', 'forms-and-reports', 'tasks-and-targets',
        'messaging', 'data-sync', 'configuration', 'interoperability',
      ];
      for (const domain of domains) {
        expect(isValid({ ...VALID_FRONTMATTER, domain }), `domain: ${domain}`).to.equal(true);
      }
    });

    it('accepts all valid categories', () => {
      for (const category of ['bug', 'feature', 'improvement']) {
        expect(isValid({ ...VALID_FRONTMATTER, category }), `category: ${category}`).to.equal(true);
      }
    });
  });

  describe('validateBody', () => {
    it('passes with all 8 required sections', () => {
      expect(validateBody(VALID_BODY)).to.be.empty;
    });

    it('reports the 7 missing sections when only Problem is present', () => {
      const errors = validateBody('## Problem\n\nSome problem.\n');
      expect(errors).to.have.lengthOf(7);
      expect(errors).to.not.include('Missing required section: ## Problem');
      expect(errors).to.include('Missing required section: ## Root Cause');
    });

    it('reports all 8 sections for an empty body', () => {
      expect(validateBody('')).to.have.lengthOf(8);
    });
  });

  describe('isIssueFile', () => {
    it('is true for a domains/<domain>/issues/<name>.md path', () => {
      expect(isIssueFile('agent-memory/domains/forms-and-reports/issues/8308-x.md')).to.equal(true);
    });
    it('is false for a non-issue markdown path', () => {
      expect(isIssueFile('agent-memory/domains/forms-and-reports/index.md')).to.equal(false);
    });
  });

  describe('validateFile', () => {
    it('passes a real context file from the corpus', () => {
      const file = path.resolve(__dirname, '../../agent-memory/domains/forms-and-reports/issues/8308-signature-widget-support.md');
      const result = validateFile(file, validate);
      expect(result.passed, JSON.stringify(result.errors)).to.equal(true);
      expect(result.skipped).to.equal(false);
    });

    it('fails an issue file with no frontmatter', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vs-issue-'));
      try {
        const issueDir = path.join(dir, 'domains', 'contacts', 'issues');
        fs.mkdirSync(issueDir, { recursive: true });
        const f = path.join(issueDir, '1-no-frontmatter.md');
        fs.writeFileSync(f, '# no frontmatter here\n', 'utf8');
        const result = validateFile(f, validate);
        expect(result.passed).to.equal(false);
        expect(result.skipped).to.equal(false);
        expect(result.errors[0]).to.match(/Missing YAML frontmatter/);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it('skips a non-issue markdown file with no frontmatter', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vs-index-'));
      try {
        const f = path.join(dir, 'index.md');
        fs.writeFileSync(f, '# Domain index\n\nsome prose\n', 'utf8');
        const result = validateFile(f, validate);
        expect(result.skipped).to.equal(true);
        expect(result.passed).to.equal(true);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it('fails an issue file that is missing a required body section', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vs-body-'));
      try {
        const issueDir = path.join(dir, 'domains', 'contacts', 'issues');
        fs.mkdirSync(issueDir, { recursive: true });
        const f = path.join(issueDir, '1234-x.md');
        fs.writeFileSync(f, buildMarkdown(VALID_FRONTMATTER, '## Problem\n\nonly one section\n'), 'utf8');
        const result = validateFile(f, validate);
        expect(result.passed).to.equal(false);
        expect(result.errors.some(e => e.includes('## Root Cause'))).to.equal(true);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe('collectMarkdownFiles', () => {
    it('finds corpus files and excludes README.md/TEMPLATE.md', () => {
      const domainsDir = path.resolve(__dirname, '../../agent-memory/domains');
      const files = collectMarkdownFiles(domainsDir);
      expect(files.length).to.be.greaterThan(0);
      for (const file of files) {
        expect(file).to.match(/\.md$/);
        expect(path.basename(file)).to.not.equal('README.md');
        expect(path.basename(file)).to.not.equal('TEMPLATE.md');
      }
    });

    it('returns an empty array for a non-existent directory', () => {
      expect(collectMarkdownFiles('/nonexistent/path')).to.deep.equal([]);
    });
  });
});
