import { expect } from 'chai';
import * as sinon from 'sinon';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { buildValidator, normalizeFrontmatter } from '../../src/scripts/schema-utils';
import {
  validateFile,
  validateBody,
  isIssueFile,
  collectMarkdownFiles,
  resolveFiles,
  printResult,
  run,
  FileResult,
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
      const items = value.map((v) => `  - ${v}`).join('\n');
      return `${key}:\n${items}`;
    }
    return `${key}: ${value}`;
  });
  return `---\n${lines.join('\n')}\n---\n${body}`;
};

describe('validate-schema (AJV)', () => {
  const validate = buildValidator();

  afterEach(() => sinon.restore());

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

    it('reports an issue file with unparseable YAML as failed (does not crash)', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vs-bad-yaml-'));
      try {
        const issueDir = path.join(dir, 'domains', 'messaging', 'issues');
        fs.mkdirSync(issueDir, { recursive: true });
        const f = path.join(issueDir, '1-bad-yaml.md');
        // Unquoted summary with an embedded colon: invalid YAML mapping.
        fs.writeFileSync(f, '---\nsummary: Fixed SMS parser: string list bug.\n---\n## Problem\n', 'utf8');
        const result = validateFile(f, validate);
        expect(result.passed).to.equal(false);
        expect(result.skipped).to.equal(false);
        expect(result.errors[0]).to.match(/Invalid YAML frontmatter/);
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

    it('fails an issue file whose frontmatter violates the schema and formats each error', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vs-bad-fm-'));
      try {
        const issueDir = path.join(dir, 'domains', 'contacts', 'issues');
        fs.mkdirSync(issueDir, { recursive: true });
        const f = path.join(issueDir, '1-bad-fm.md');
        // Missing required fields + an out-of-enum domain + an unknown field:
        // exercises the required, additionalProperties, and field-path branches of formatError.
        fs.writeFileSync(f, buildMarkdown({ domain: 'not-a-domain', bogus: 'x' }, VALID_BODY), 'utf8');
        const result = validateFile(f, validate);
        expect(result.passed).to.equal(false);
        const joined = result.errors.join('\n');
        expect(joined).to.match(/missing required field/);
        expect(joined).to.match(/unexpected field "bogus"/);
        expect(result.errors.some(e => e.startsWith('domain:'))).to.equal(true);
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

    it('excludes files under a _pending directory', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vs-pending-'));
      try {
        fs.mkdirSync(path.join(dir, '_pending'), { recursive: true });
        fs.writeFileSync(path.join(dir, '_pending', 'draft.md'), '# draft\n', 'utf8');
        fs.writeFileSync(path.join(dir, 'real.md'), '# real\n', 'utf8');
        const files = collectMarkdownFiles(dir);
        expect(files.some(f => f.includes('_pending'))).to.equal(false);
        expect(files.some(f => f.endsWith('real.md'))).to.equal(true);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe('resolveFiles', () => {
    it('returns the full corpus when no specific file is given', () => {
      const files = resolveFiles(undefined);
      expect(files.length).to.be.greaterThan(0);
      expect(files.every(f => f.endsWith('.md'))).to.equal(true);
    });

    it('returns the single resolved path for an existing file', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vs-resolve-'));
      try {
        const f = path.join(dir, 'a.md');
        fs.writeFileSync(f, '# a\n', 'utf8');
        expect(resolveFiles(f)).to.deep.equal([path.resolve(f)]);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it('logs an error and exits 1 when the specified file does not exist', () => {
      const exitStub = sinon.stub(process, 'exit');
      const errStub = sinon.stub(console, 'error');
      resolveFiles('/no/such/context-file.md');
      expect(exitStub.calledWith(1)).to.equal(true);
      expect(errStub.called).to.equal(true);
    });
  });

  describe('printResult', () => {
    const result = (over: Partial<FileResult>): FileResult => ({
      file: '/repo/agent-memory/domains/x/issues/1.md',
      passed: true,
      skipped: false,
      errors: [],
      ...over,
    });

    it('prints SKIP for a skipped file', () => {
      const log = sinon.stub(console, 'log');
      printResult(result({ skipped: true }));
      expect(log.calledOnce).to.equal(true);
      expect(log.firstCall.args[0]).to.match(/SKIP/);
    });

    it('prints PASS for a passed file', () => {
      const log = sinon.stub(console, 'log');
      printResult(result({ passed: true }));
      expect(log.firstCall.args[0]).to.match(/PASS/);
    });

    it('prints FAIL and one line per error for a failed file', () => {
      const log = sinon.stub(console, 'log');
      printResult(result({ passed: false, errors: ['err one', 'err two'] }));
      expect(log.firstCall.args[0]).to.match(/FAIL/);
      expect(log.callCount).to.equal(3); // FAIL line + 2 error lines
      expect(log.getCall(1).args[0]).to.match(/err one/);
    });
  });

  describe('run', () => {
    it('returns 0 when the full corpus validates', () => {
      sinon.stub(console, 'log');
      expect(run([])).to.equal(0);
    });

    it('returns 1 when a target file fails validation', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vs-run-fail-'));
      try {
        const issueDir = path.join(dir, 'domains', 'contacts', 'issues');
        fs.mkdirSync(issueDir, { recursive: true });
        const f = path.join(issueDir, '1-no-frontmatter.md');
        fs.writeFileSync(f, '# no frontmatter here\n', 'utf8');
        sinon.stub(console, 'log');
        expect(run([f])).to.equal(1);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it('returns 0 and reports nothing to validate when the corpus is empty', () => {
      // node:fs is a read-only namespace import, so inject a fake existsSync via
      // proxyquire (callThru keeps the real fs for buildValidator's readFileSync).
      const proxyquire = require('proxyquire');
      const { run: runEmpty } = proxyquire('../../src/scripts/validate-schema', {
        'node:fs': { existsSync: () => false },
      });
      const log = sinon.stub(console, 'log');
      expect(runEmpty([])).to.equal(0);
      expect(log.calledWith('No context files found to validate.')).to.equal(true);
    });
  });
});
