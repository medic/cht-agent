import { expect } from 'chai';
import { TestContentAssertions, TestPlanSchema, RequirementsChecklistSchema } from '../../../src/layers/test-gen/schemas';

describe('TestContentAssertions', () => {
  describe('hasTestStructure', () => {
    it('should pass when describe and it blocks exist', () => {
      const content = `describe('MyService', () => { it('should work', () => { expect(true).to.be.true; }); });`;
      expect(TestContentAssertions.hasTestStructure(content)).to.deep.equal([]);
    });

    it('should fail when describe block is missing', () => {
      const content = `it('should work', () => { expect(true).to.be.true; });`;
      const failures = TestContentAssertions.hasTestStructure(content);
      expect(failures).to.have.length(1);
      expect(failures[0]).to.include('describe()');
    });

    it('should fail when it/test block is missing', () => {
      const content = `describe('MyService', () => { const x = 1; });`;
      const failures = TestContentAssertions.hasTestStructure(content);
      expect(failures).to.have.length(1);
      expect(failures[0]).to.include('it()');
    });

    it('should accept test() as alternative to it()', () => {
      const content = `describe('MyService', () => { test('should work', () => {}); });`;
      expect(TestContentAssertions.hasTestStructure(content)).to.deep.equal([]);
    });
  });

  describe('hasAssertions', () => {
    it('should pass when expect assertions exist', () => {
      const content = `expect(result).to.equal(42);`;
      expect(TestContentAssertions.hasAssertions(content)).to.deep.equal([]);
    });

    it('should pass when assert style is used', () => {
      const content = `assert.equal(result, 42);`;
      expect(TestContentAssertions.hasAssertions(content)).to.deep.equal([]);
    });

    it('should fail when no assertions exist', () => {
      const content = `const x = 1;\nconst y = 2;`;
      const failures = TestContentAssertions.hasAssertions(content);
      expect(failures).to.have.length(1);
      expect(failures[0]).to.include('no assertions');
    });
  });

  describe('hasProperImports', () => {
    it('should pass with import statement', () => {
      const content = `import { expect } from 'chai';`;
      expect(TestContentAssertions.hasProperImports(content, 'test.spec.ts')).to.deep.equal([]);
    });

    it('should pass with require statement', () => {
      const content = `const { expect } = require('chai');`;
      expect(TestContentAssertions.hasProperImports(content, 'test.spec.js')).to.deep.equal([]);
    });

    it('should fail when no imports exist', () => {
      const content = `describe('test', () => {});`;
      const failures = TestContentAssertions.hasProperImports(content, 'test.spec.ts');
      expect(failures).to.have.length(1);
      expect(failures[0]).to.include('no import');
    });
  });

  describe('isNotPlaintext', () => {
    it('should pass for code content', () => {
      const content = `import { expect } from 'chai';\ndescribe('test', () => {});`;
      expect(TestContentAssertions.isNotPlaintext(content)).to.deep.equal([]);
    });

    it('should fail for plaintext description', () => {
      const content = `This test file contains unit tests for the contacts module.\nIt should test all the main functions.`;
      const failures = TestContentAssertions.isNotPlaintext(content);
      expect(failures).to.have.length(1);
      expect(failures[0]).to.include('plaintext');
    });

    it('should fail for empty content', () => {
      const content = `// just a comment\n/* another comment */`;
      const failures = TestContentAssertions.isNotPlaintext(content);
      expect(failures).to.have.length(1);
      expect(failures[0]).to.include('empty');
    });
  });

  describe('validateTestFile', () => {
    it('should pass for a well-formed test file', () => {
      const content = [
        `import { expect } from 'chai';`,
        `import sinon from 'sinon';`,
        ``,
        `describe('ContactsService', () => {`,
        `  afterEach(() => sinon.restore());`,
        ``,
        `  it('should find contacts by phone', () => {`,
        `    expect(result).to.have.length(1);`,
        `  });`,
        `});`,
      ].join('\n');

      expect(TestContentAssertions.validateTestFile(content, 'contacts.spec.ts')).to.deep.equal([]);
    });

    it('should return multiple failures for a bad test file', () => {
      const content = `To test this module you need to check the contacts.`;
      const failures = TestContentAssertions.validateTestFile(content, 'test.spec.ts');
      expect(failures.length).to.be.greaterThan(1);
    });
  });
});

describe('TestPlanSchema', () => {
  it('should validate a correct plan', () => {
    const plan = {
      items: [{
        filePath: 'tests/unit/contacts.spec.js',
        testType: 'unit',
        targetSourceFile: 'api/src/controllers/contacts.js',
        description: 'Unit tests for contacts controller',
      }],
    };

    const result = TestPlanSchema.safeParse(plan);
    expect(result.success).to.be.true;
  });

  it('should reject a plan with invalid test file path', () => {
    const plan = {
      items: [{
        filePath: 'tests/unit/contacts.js',
        testType: 'unit',
        targetSourceFile: 'api/src/controllers/contacts.js',
        description: 'Unit tests for contacts controller',
      }],
    };

    const result = TestPlanSchema.safeParse(plan);
    expect(result.success).to.be.false;
  });

  it('should reject an empty plan', () => {
    const plan = { items: [] };

    const result = TestPlanSchema.safeParse(plan);
    expect(result.success).to.be.false;
  });
});

describe('RequirementsChecklistSchema', () => {
  it('should validate a correct checklist', () => {
    const checklist = {
      checklist: [{
        requirement: 'Support search by phone number',
        scenarios: [{
          name: 'should find contact by exact phone number',
          type: 'happy-path',
          description: 'Verifies exact match phone lookup',
        }],
      }],
    };

    const result = RequirementsChecklistSchema.safeParse(checklist);
    expect(result.success).to.be.true;
  });

  it('should reject a checklist with empty scenarios', () => {
    const checklist = {
      checklist: [{
        requirement: 'Support search',
        scenarios: [],
      }],
    };

    const result = RequirementsChecklistSchema.safeParse(checklist);
    expect(result.success).to.be.false;
  });
});
