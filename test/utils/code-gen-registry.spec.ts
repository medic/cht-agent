import { expect } from 'chai';
import { CodeGenModule } from '../../src/layers/code-gen/interface';
import {
  CodeGenModuleRegistry,
  createDefaultCodeGenRegistry,
} from '../../src/layers/code-gen/registry';
import { claudeApiCodeGenModule } from '../../src/layers/code-gen/modules/claude-api';
import { CodeGenModuleInput } from '../../src/layers/code-gen/interface';

describe('CodeGenModuleRegistry', () => {
  const makeModule = (name: string): CodeGenModule => ({
    name,
    version: '0.0.1',
    async generate() {
      return {
        files: [],
        explanation: 'noop',
      };
    },
  });

  it('should register and retrieve a module by name', () => {
    const registry = new CodeGenModuleRegistry();
    const module = makeModule('custom-module');

    registry.register(module);

    expect(registry.get('custom-module')).to.equal(module);
  });

  it('should resolve anthropic alias to claude-api', () => {
    const registry = createDefaultCodeGenRegistry();

    const active = registry.getActiveModule('anthropic');

    expect(active.name).to.equal('claude-api');
  });

  it('should throw with helpful message for unknown module', () => {
    const registry = createDefaultCodeGenRegistry();

    expect(() => registry.getActiveModule('unknown-provider')).to.throw(
      'No code generation module registered for provider "unknown-provider"'
    );
  });
});

describe('ClaudeApiCodeGenModule', () => {
  const input: CodeGenModuleInput = {
    ticket: {
      issue: {
        title: 'Add contact search filters',
        type: 'feature',
        priority: 'medium',
        description: 'Allow filtering contacts by program enrollment and status.',
        technical_context: {
          domain: 'contacts',
          components: ['webapp/modules/contacts', 'api/controllers/contacts'],
        },
        requirements: ['Add UI filters', 'Support API filtering'],
        acceptance_criteria: ['Users can filter by status'],
        constraints: ['Do not break existing search'],
      },
    },
    researchFindings: {
      documentationReferences: [
        {
          url: 'https://docs.communityhealthtoolkit.org/apps/features/contacts/',
          title: 'Managing Contacts',
          topics: ['contacts'],
        },
      ],
      relevantExamples: [],
      suggestedApproaches: ['Extend existing query builder'],
      relatedDomains: ['contacts'],
      confidence: 0.9,
      source: 'local-docs',
    },
    contextFiles: [
      {
        path: 'agent-memory/domains/contacts/overview.md',
        content: 'Contacts domain overview',
        source: 'agent-memory',
      },
    ],
    orchestrationPlan: {
      summary: 'Implement filters in API and webapp.',
      keyFindings: ['API already supports pagination'],
      proposedApproach: 'Add filter params and update contacts list UI.',
      estimatedComplexity: 'medium',
      phases: [
        {
          name: 'API Update',
          description: 'Introduce filter query params.',
          estimatedComplexity: 'medium',
          suggestedComponents: ['api/controllers/contacts'],
          dependencies: [],
        },
      ],
      riskFactors: ['Query performance risk'],
      estimatedEffort: '2 days',
    },
    targetDirectory: 'tmp/output/',
  };

  it('should generate a deterministic plan file', async () => {
    const output = await claudeApiCodeGenModule.generate(input);

    expect(output.files).to.have.length(1);
    expect(output.files[0].path).to.equal('tmp/output/IMPLEMENTATION_PLAN.md');
    expect(output.files[0].content).to.include('Generated Implementation Plan');
    expect(output.files[0].content).to.include('Add contact search filters');
    expect(output.explanation).to.include('implementation-plan artifact');
  });

  it('should default to documented model name', async () => {
    const output = await claudeApiCodeGenModule.generate(input);

    expect(output.modelUsed).to.equal('claude-sonnet-4-20250514');
  });

  it('should expose validate hook that returns a boolean', async () => {
    const valid = await claudeApiCodeGenModule.validate?.();

    expect(typeof valid).to.equal('boolean');
  });
});
