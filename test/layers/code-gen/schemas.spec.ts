import { expect } from 'chai';
import {
  PlanItemSchema,
  PlanSchema,
  GeneratedFileSchema,
  FileContentAssertions,
} from '../../../src/layers/code-gen/schemas';

describe('Code Gen Schemas', () => {
  describe('PlanItemSchema', () => {
    it('should accept a valid MODIFY item', () => {
      const result = PlanItemSchema.safeParse({
        action: 'MODIFY',
        filePath: 'src/services/contact.ts',
        rationale: 'Add filter method to contact service',
      });
      expect(result.success).to.be.true;
    });

    it('should accept a valid CREATE item', () => {
      const result = PlanItemSchema.safeParse({
        action: 'CREATE',
        filePath: 'src/services/filter.service.ts',
        rationale: 'New service for contact filtering',
      });
      expect(result.success).to.be.true;
    });

    it('should reject invalid action', () => {
      const result = PlanItemSchema.safeParse({
        action: 'DELETE',
        filePath: 'src/service.ts',
        rationale: 'Remove old service',
      });
      expect(result.success).to.be.false;
    });

    it('should reject file path without extension', () => {
      const result = PlanItemSchema.safeParse({
        action: 'CREATE',
        filePath: 'src/service',
        rationale: 'This has no extension',
      });
      expect(result.success).to.be.false;
    });

    it('should reject file path too short', () => {
      const result = PlanItemSchema.safeParse({
        action: 'CREATE',
        filePath: 'a',
        rationale: 'Too short path',
      });
      expect(result.success).to.be.false;
    });

    it('should reject rationale shorter than 10 chars', () => {
      const result = PlanItemSchema.safeParse({
        action: 'MODIFY',
        filePath: 'src/service.ts',
        rationale: 'Fix bug',
      });
      expect(result.success).to.be.false;
    });

    it('should accept rationale at exactly 10 chars', () => {
      const result = PlanItemSchema.safeParse({
        action: 'MODIFY',
        filePath: 'src/service.ts',
        rationale: '1234567890',
      });
      expect(result.success).to.be.true;
    });
  });

  describe('PlanSchema', () => {
    it('should accept a plan with multiple items', () => {
      const result = PlanSchema.safeParse({
        items: [
          { action: 'MODIFY', filePath: 'src/a.ts', rationale: 'Modify file A for feature' },
          { action: 'CREATE', filePath: 'src/b.ts', rationale: 'Create new file B for feature' },
        ],
      });
      expect(result.success).to.be.true;
    });

    it('should reject empty plan', () => {
      const result = PlanSchema.safeParse({ items: [] });
      expect(result.success).to.be.false;
    });

    it('should reject plan with invalid items', () => {
      const result = PlanSchema.safeParse({
        items: [
          { action: 'MODIFY', filePath: 'a', rationale: 'short' },
        ],
      });
      expect(result.success).to.be.false;
    });
  });

  describe('GeneratedFileSchema', () => {
    it('should accept valid generated file', () => {
      const result = GeneratedFileSchema.safeParse({
        path: 'src/service.ts',
        content: 'export class Service { run() {} }',
        purpose: 'Main service',
      });
      expect(result.success).to.be.true;
    });

    it('should accept file without purpose', () => {
      const result = GeneratedFileSchema.safeParse({
        path: 'src/service.ts',
        content: 'export class Service { run() {} }',
      });
      expect(result.success).to.be.true;
    });

    it('should reject content shorter than 20 chars', () => {
      const result = GeneratedFileSchema.safeParse({
        path: 'src/service.ts',
        content: 'short content',
      });
      expect(result.success).to.be.false;
    });

    it('should reject path shorter than 3 chars', () => {
      const result = GeneratedFileSchema.safeParse({
        path: 'a',
        content: 'export class Service { run() {} }',
      });
      expect(result.success).to.be.false;
    });
  });
});

describe('FileContentAssertions', () => {
  describe('isNotPlaintext()', () => {
    it('should pass for valid TypeScript code', () => {
      const content = `import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class ContactService {
  getContacts() { return []; }
}`;
      const failures = FileContentAssertions.isNotPlaintext(content, 'src/service.ts');
      expect(failures).to.deep.equal([]);
    });

    it('should pass for valid JavaScript code', () => {
      const content = `const db = require('../db');

module.exports = {
  async getContacts(req, res) {
    const contacts = await db.query('contacts');
    res.json(contacts);
  }
};`;
      const failures = FileContentAssertions.isNotPlaintext(content, 'src/controller.js');
      expect(failures).to.deep.equal([]);
    });

    it('should fail for plaintext description starting with "This file"', () => {
      const content = 'This file should implement the contact filtering feature by adding a new method.';
      const failures = FileContentAssertions.isNotPlaintext(content, 'src/service.ts');
      expect(failures).to.have.length.greaterThan(0);
      expect(failures[0]).to.include('plaintext description');
    });

    it('should fail for plaintext starting with "I would"', () => {
      const content = 'I would implement this by creating a new service class that handles filtering.';
      const failures = FileContentAssertions.isNotPlaintext(content, 'src/service.ts');
      expect(failures).to.have.length.greaterThan(0);
    });

    it('should fail for plaintext starting with "The implementation should"', () => {
      const content = 'The implementation should include a filter method that takes parameters.';
      const failures = FileContentAssertions.isNotPlaintext(content, 'src/service.ts');
      expect(failures).to.have.length.greaterThan(0);
    });

    it('should pass for JSON files (different rules)', () => {
      const content = 'This file contains the configuration for the contact module.';
      const failures = FileContentAssertions.isNotPlaintext(content, 'config.json');
      expect(failures).to.deep.equal([]);
    });

    it('should fail for empty content', () => {
      const failures = FileContentAssertions.isNotPlaintext('', 'src/service.ts');
      expect(failures).to.have.length.greaterThan(0);
      expect(failures[0]).to.include('empty');
    });

    it('should pass for code with leading comments', () => {
      const content = `// This file implements the contact service
// It provides methods for filtering contacts
export class ContactService {
  filter() { return []; }
}`;
      const failures = FileContentAssertions.isNotPlaintext(content, 'src/service.ts');
      expect(failures).to.deep.equal([]);
    });
  });

  describe('hasStructuralChanges()', () => {
    it('should pass when content differs from original', () => {
      const original = 'export class Service { get() { return null; } }';
      const modified = 'export class Service { get() { return []; } filter() { return []; } }';
      const failures = FileContentAssertions.hasStructuralChanges(modified, original);
      expect(failures).to.deep.equal([]);
    });

    it('should fail when content is identical to original', () => {
      const content = 'export class Service { get() { return null; } }';
      const failures = FileContentAssertions.hasStructuralChanges(content, content);
      expect(failures).to.have.length.greaterThan(0);
      expect(failures[0]).to.include('identical');
    });

    it('should fail when content differs only by whitespace', () => {
      const original = 'export class Service { get() { return null; } }';
      const modified = 'export  class  Service  {  get()  {  return  null;  }  }';
      const failures = FileContentAssertions.hasStructuralChanges(modified, original);
      expect(failures).to.have.length.greaterThan(0);
      expect(failures[0]).to.include('identical');
    });

    it('should fail when changes are trivial (< 1% diff)', () => {
      // Build a long string and change just 1 character in the middle
      const base = '  method() { return null; }\n'.repeat(50);
      const original = 'export class Service {\n' + base + '}';
      // Change one 'null' to 'nulx' — small but non-whitespace change
      const modified = 'export class Service {\n' + base.replace('null', 'nulx') + '}';
      const failures = FileContentAssertions.hasStructuralChanges(modified, original);
      expect(failures).to.have.length.greaterThan(0);
      expect(failures[0]).to.include('less than 1%');
    });

    it('should pass for meaningful changes', () => {
      const original = 'export class Service {\n  get() { return null; }\n}';
      const modified = `export class Service {
  get() { return []; }
  filter(criteria: string) {
    return this.data.filter(item => item.status === criteria);
  }
  sort(field: string) {
    return this.data.sort((a, b) => a[field] - b[field]);
  }
}`;
      const failures = FileContentAssertions.hasStructuralChanges(modified, original);
      expect(failures).to.deep.equal([]);
    });
  });

  describe('hasSyntaxMarkers()', () => {
    it('should pass for TypeScript with import/export', () => {
      const content = 'import { Injectable } from "@angular/core";\nexport class Service {}';
      const failures = FileContentAssertions.hasSyntaxMarkers(content, 'src/service.ts');
      expect(failures).to.deep.equal([]);
    });

    it('should pass for JavaScript with require/module.exports', () => {
      const content = 'const db = require("./db");\nmodule.exports = { get() {} };';
      const failures = FileContentAssertions.hasSyntaxMarkers(content, 'src/controller.js');
      expect(failures).to.deep.equal([]);
    });

    it('should pass for JSON starting with {', () => {
      const content = '{ "key": "value" }';
      const failures = FileContentAssertions.hasSyntaxMarkers(content, 'config.json');
      expect(failures).to.deep.equal([]);
    });

    it('should fail for .ts file without TypeScript syntax', () => {
      const content = 'This is just plain text without any code syntax markers at all.';
      const failures = FileContentAssertions.hasSyntaxMarkers(content, 'src/service.ts');
      expect(failures).to.have.length.greaterThan(0);
      expect(failures[0]).to.include('syntax markers');
    });

    it('should fail for .js file without JavaScript syntax', () => {
      const content = 'Just a description of what the file should do.';
      const failures = FileContentAssertions.hasSyntaxMarkers(content, 'src/controller.js');
      expect(failures).to.have.length.greaterThan(0);
    });

    it('should pass for unknown extension (skip check)', () => {
      const content = 'Any content here because we dont know the language.';
      const failures = FileContentAssertions.hasSyntaxMarkers(content, 'data.xyz');
      expect(failures).to.deep.equal([]);
    });

    it('should pass for shell script with #!/bin/bash', () => {
      const content = '#!/bin/bash\necho "hello"';
      const failures = FileContentAssertions.hasSyntaxMarkers(content, 'deploy.sh');
      expect(failures).to.deep.equal([]);
    });

    it('should pass for CSS with selectors', () => {
      const content = '.container { display: flex; }';
      const failures = FileContentAssertions.hasSyntaxMarkers(content, 'styles.css');
      expect(failures).to.deep.equal([]);
    });

    it('should pass for HTML with doctype', () => {
      const content = '<!DOCTYPE html>\n<html></html>';
      const failures = FileContentAssertions.hasSyntaxMarkers(content, 'index.html');
      expect(failures).to.deep.equal([]);
    });

    it('should pass for YAML with key-value', () => {
      const content = 'name: my-app\nversion: 1.0.0';
      const failures = FileContentAssertions.hasSyntaxMarkers(content, 'config.yml');
      expect(failures).to.deep.equal([]);
    });
  });
});
