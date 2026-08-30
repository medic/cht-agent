import { expect } from 'chai';
import { ClaudeApiTestGenModule, siblingSpecPath } from '../../../src/layers/test-gen/modules/claude-api';

describe('siblingSpecPath (F-A)', () => {
  it('inserts .additional before the .spec segment, same directory', () => {
    expect(siblingSpecPath('api/tests/messaging.spec.js')).to.equal('api/tests/messaging.additional.spec.js');
  });

  it('handles .test.<ext> too', () => {
    expect(siblingSpecPath('webapp/src/foo.test.ts')).to.equal('webapp/src/foo.additional.test.ts');
  });

  it('bumps a counter when a numbered sibling is requested', () => {
    expect(siblingSpecPath('a/b/c.spec.js', 2)).to.equal('a/b/c.additional.2.spec.js');
  });

  it('takes the LAST .spec segment and keeps the directory', () => {
    expect(siblingSpecPath('a.spec.dir/x.spec.js')).to.equal('a.spec.dir/x.additional.spec.js');
  });

  it('falls back to inserting before the final extension when no .spec/.test segment', () => {
    expect(siblingSpecPath('weird/name.js')).to.equal('weird/name.additional.js');
  });
});

describe('ClaudeApiTestGenModule', () => {
  const module = new ClaudeApiTestGenModule();

  describe('parseTestPlan()', () => {
    it('should parse a well-formed test plan', () => {
      const raw = `=== TEST PLAN ===
1. unit tests/unit/controllers/contacts.spec.js → api/src/controllers/contacts.js - Unit tests for contact search
2. integration tests/integration/contacts-search.spec.js → api/src/controllers/contacts.js - Integration test with CouchDB
=== END TEST PLAN ===`;

      const plan = module.parseTestPlan(raw);

      expect(plan).to.have.length(2);
      expect(plan[0]).to.deep.equal({
        testType: 'unit',
        filePath: 'tests/unit/controllers/contacts.spec.js',
        targetSourceFile: 'api/src/controllers/contacts.js',
        description: 'Unit tests for contact search',
      });
      expect(plan[1].testType).to.equal('integration');
    });

    it('should handle e2e test type', () => {
      const raw = `=== TEST PLAN ===
1. e2e tests/e2e/contacts-workflow.spec.js → webapp/src/ts/modules/contacts/contacts.component.ts - E2E workflow test
=== END TEST PLAN ===`;

      const plan = module.parseTestPlan(raw);

      expect(plan).to.have.length(1);
      expect(plan[0].testType).to.equal('e2e');
    });

    it('should strip backticks from file paths', () => {
      const raw = `=== TEST PLAN ===
1. unit \`tests/unit/service.spec.js\` → \`api/src/services/service.js\` - Unit tests
=== END TEST PLAN ===`;

      const plan = module.parseTestPlan(raw);

      expect(plan).to.have.length(1);
      expect(plan[0].filePath).to.equal('tests/unit/service.spec.js');
      expect(plan[0].targetSourceFile).to.equal('api/src/services/service.js');
    });

    it('should return empty array for unparseable content', () => {
      const raw = `Here is my plan:\n- Create some tests\n- Run them`;

      const plan = module.parseTestPlan(raw);

      expect(plan).to.deep.equal([]);
    });

    it('should handle plan without delimiters', () => {
      const raw = `1. unit tests/unit/auth.spec.js → api/src/auth.js - Auth tests`;

      const plan = module.parseTestPlan(raw);

      expect(plan).to.have.length(1);
      expect(plan[0].filePath).to.equal('tests/unit/auth.spec.js');
    });

    it('should handle em dash separator', () => {
      const raw = `=== TEST PLAN ===
1. unit tests/unit/contacts.spec.js → api/src/contacts.js — Contact lookup tests
=== END TEST PLAN ===`;

      const plan = module.parseTestPlan(raw);

      expect(plan).to.have.length(1);
      expect(plan[0].description).to.equal('Contact lookup tests');
    });
  });

  describe('parseRequirementsChecklist()', () => {
    it('should parse valid JSON checklist', () => {
      const raw = `{
        "checklist": [
          {
            "requirement": "Search contacts by phone",
            "scenarios": [
              {
                "name": "should find contact by exact phone",
                "type": "happy-path",
                "description": "Tests exact phone match"
              }
            ]
          }
        ]
      }`;

      const checklist = module.parseRequirementsChecklist(raw);

      expect(checklist).to.have.length(1);
      expect(checklist[0].requirement).to.equal('Search contacts by phone');
      expect(checklist[0].scenarios).to.have.length(1);
      expect(checklist[0].scenarios[0].type).to.equal('happy-path');
    });

    it('should extract JSON from surrounding text', () => {
      const raw = `Here is the checklist:\n{"checklist": [{"requirement": "Test req", "scenarios": [{"name": "test", "type": "happy-path", "description": "desc"}]}]}\nDone.`;

      const checklist = module.parseRequirementsChecklist(raw);

      expect(checklist).to.have.length(1);
    });

    it('should return empty array for invalid JSON', () => {
      const raw = `This is not JSON at all.`;

      const checklist = module.parseRequirementsChecklist(raw);

      expect(checklist).to.deep.equal([]);
    });

    it('should return empty array for JSON without checklist field', () => {
      const raw = `{"data": []}`;

      const checklist = module.parseRequirementsChecklist(raw);

      expect(checklist).to.deep.equal([]);
    });

    it('parses valid JSON even when trailing prose contains a brace (M8)', () => {
      // The old greedy /\{[\s\S]*\}/ anchored to the LAST `}` (the one in "{}"),
      // over-captured, and JSON.parse threw -> silent []. The balanced scan stops
      // at the object's own close.
      const raw = `{"checklist": [{"requirement": "R", "scenarios": [{"name": "n", "type": "happy-path", "description": "d"}]}]}\nNote: use {} for an empty object.`;

      const checklist = module.parseRequirementsChecklist(raw);

      expect(checklist).to.have.length(1);
      expect(checklist[0].requirement).to.equal('R');
    });

    it('captures a deeply nested checklist fully, not truncated at the first } (M8)', () => {
      const raw = `prefix {"checklist": [{"requirement": "R", "scenarios": [{"name": "n", "type": "edge-case", "description": "d"}]}]} suffix`;

      const checklist = module.parseRequirementsChecklist(raw);

      expect(checklist).to.have.length(1);
      expect(checklist[0].scenarios[0].type).to.equal('edge-case');
    });

    it('returns [] for a checklist with an invalid scenario type (schema is authoritative, M1)', () => {
      // Old code fell through to returning the raw (unvalidated) checklist here.
      const raw = `{"checklist": [{"requirement": "R", "scenarios": [{"name": "n", "type": "not-a-type", "description": "d"}]}]}`;

      expect(module.parseRequirementsChecklist(raw)).to.deep.equal([]);
    });
  });

  describe('buildTestPlanPrompt()', () => {
    const baseInput = {
      ticket: {
        issue: {
          title: 'Add contact search filters',
          type: 'feature' as const,
          priority: 'medium' as const,
          description: 'Allow filtering contacts',
          technical_context: {
            domain: 'contacts' as const,
            components: ['api/controllers/contacts'],
          },
          requirements: ['Search by phone', 'Search by name'],
          acceptance_criteria: ['Returns matching contacts'],
          constraints: [],
        },
      },
      researchFindings: {
        documentationReferences: [],
        relevantExamples: [],
        suggestedApproaches: [],
        relatedDomains: [],
        confidence: 0.9,
        source: 'local-docs' as const,
      },
      orchestrationPlan: {
        summary: 'Add filters',
        keyFindings: [],
        proposedApproach: 'Extend API',
        recommendedApproach: 'Extend the existing contacts API with filter query parameters',
        estimatedComplexity: 'medium' as const,
        phases: [{
          name: 'API',
          description: 'Add filter params',
          estimatedComplexity: 'medium' as const,
          suggestedComponents: ['api/controllers/contacts'],
          dependencies: [],
        }],
        riskFactors: [],
        estimatedEffort: '2 days',
      },
      generatedCode: [{
        relativePath: 'api/src/controllers/contacts.js',
        content: 'module.exports = {};',
        language: 'javascript' as const,
        type: 'source' as const,
        description: 'Contacts controller',
        action: 'modify' as const,
      }],
      contextFiles: [],
      testTypes: ['unit' as const, 'integration' as const],
      targetDirectory: 'tmp/',
    };

    it('should include issue details in prompt', () => {
      const prompt = module.buildTestPlanPrompt(baseInput);

      expect(prompt).to.include('Add contact search filters');
      expect(prompt).to.include('contacts');
      expect(prompt).to.include('Search by phone');
    });

    it('should include source file summary', () => {
      const prompt = module.buildTestPlanPrompt(baseInput);

      expect(prompt).to.include('api/src/controllers/contacts.js');
    });

    it('should include requested test types', () => {
      const prompt = module.buildTestPlanPrompt(baseInput);

      expect(prompt).to.include('unit, integration');
    });

    it('should include CHT test conventions', () => {
      const prompt = module.buildTestPlanPrompt(baseInput);

      expect(prompt).to.include('Mocha');
      expect(prompt).to.include('Chai');
      expect(prompt).to.include('sinon.restore()');
    });

    it('should include existing test patterns when provided', () => {
      const input = {
        ...baseInput,
        existingTestExamples: [{
          path: 'tests/unit/contacts.spec.js',
          content: 'describe("contacts", () => { it("works", () => {}); });',
        }],
      };

      const prompt = module.buildTestPlanPrompt(input);

      expect(prompt).to.include('Existing Test Patterns');
      expect(prompt).to.include('tests/unit/contacts.spec.js');
    });

    it('should include feedback when provided', () => {
      const input = {
        ...baseInput,
        additionalContext: 'Previous tests missed error cases',
      };

      const prompt = module.buildTestPlanPrompt(input);

      expect(prompt).to.include('Previous tests missed error cases');
    });

    it('should include plan format instructions', () => {
      const prompt = module.buildTestPlanPrompt(baseInput);

      expect(prompt).to.include('=== TEST PLAN ===');
      expect(prompt).to.include('=== END TEST PLAN ===');
    });
  });

  describe('validate()', () => {
    it('should return a boolean', async () => {
      const result = await module.validate?.();
      expect(typeof result).to.equal('boolean');
    });
  });
});
