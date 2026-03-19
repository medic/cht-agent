import { expect } from 'chai';
import {
  CodeGenModule,
  CodeGenModuleInput,
} from '../../../src/layers/code-gen/interface';
import {
  CodeGenModuleRegistry,
  createDefaultCodeGenRegistry,
} from '../../../src/layers/code-gen/registry';
import { claudeApiCodeGenModule } from '../../../src/layers/code-gen/modules/claude-api';

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

  it('should return undefined for unregistered module', () => {
    const registry = new CodeGenModuleRegistry();

    expect(registry.get('nonexistent')).to.be.undefined;
  });

  it('should list all registered module names', () => {
    const registry = new CodeGenModuleRegistry();
    registry.register(makeModule('mod-a'));
    registry.register(makeModule('mod-b'));

    expect(registry.list()).to.deep.equal(['mod-a', 'mod-b']);
  });

  it('should resolve anthropic alias to claude-api', () => {
    const registry = createDefaultCodeGenRegistry();

    const active = registry.getActiveModule('anthropic');

    expect(active.name).to.equal('claude-api');
  });

  it('should resolve claude-cli alias to claude-code-cli', () => {
    const registry = new CodeGenModuleRegistry();
    const module = makeModule('claude-code-cli');
    registry.register(module);

    const active = registry.getActiveModule('claude-cli');

    expect(active.name).to.equal('claude-code-cli');
  });

  it('should pass through unknown aliases as-is', () => {
    const registry = new CodeGenModuleRegistry();

    expect(registry.resolveProvider('some-provider')).to.equal('some-provider');
  });

  it('should fall back to LLM_PROVIDER env var when no argument given', () => {
    const originalEnv = process.env.LLM_PROVIDER;
    try {
      process.env.LLM_PROVIDER = 'claude-api';
      const registry = createDefaultCodeGenRegistry();

      const active = registry.getActiveModule();

      expect(active.name).to.equal('claude-api');
    } finally {
      if (originalEnv === undefined) {
        delete process.env.LLM_PROVIDER;
      } else {
        process.env.LLM_PROVIDER = originalEnv;
      }
    }
  });

  it('should fall back to claude-api when no argument and no env var', () => {
    const originalEnv = process.env.LLM_PROVIDER;
    try {
      delete process.env.LLM_PROVIDER;
      const registry = createDefaultCodeGenRegistry();

      const active = registry.getActiveModule();

      expect(active.name).to.equal('claude-api');
    } finally {
      if (originalEnv !== undefined) {
        process.env.LLM_PROVIDER = originalEnv;
      }
    }
  });

  it('should throw with helpful message for unknown module', () => {
    const registry = createDefaultCodeGenRegistry();

    expect(() => registry.getActiveModule('unknown-provider')).to.throw(
      'No code generation module registered for provider "unknown-provider"'
    );
  });

  it('should include registered module names in error message', () => {
    const registry = new CodeGenModuleRegistry();
    registry.register(makeModule('mod-a'));
    registry.register(makeModule('mod-b'));

    expect(() => registry.getActiveModule('bad')).to.throw('mod-a, mod-b');
  });

  it('should default registry include claude-api module', () => {
    const registry = createDefaultCodeGenRegistry();

    expect(registry.list()).to.include('claude-api');
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
      recommendedApproach: 'Add filter params and update contacts list UI.',
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

  it('should generate code scaffold files from orchestration phases', async () => {
    const output = await claudeApiCodeGenModule.generate(input);

    expect(output.files).to.have.length(1);
    expect(output.files[0].path).to.equal('tmp/output/api/src/controllers/contacts.js');
    expect(output.files[0].content).to.include('Add contact search filters');
    expect(output.files[0].purpose).to.include('API controller scaffold');
  });

  it('should include domain in generated file content', async () => {
    const output = await claudeApiCodeGenModule.generate(input);

    expect(output.files[0].content).to.include('contacts');
  });

  it('should generate webapp service for webapp components', async () => {
    const webappInput = {
      ...input,
      orchestrationPlan: {
        ...input.orchestrationPlan,
        phases: [{
          name: 'UI Update',
          description: 'Add filter UI.',
          estimatedComplexity: 'medium' as const,
          suggestedComponents: ['webapp/services/contacts-filter'],
          dependencies: [],
        }],
      },
    };

    const output = await claudeApiCodeGenModule.generate(webappInput);

    expect(output.files).to.have.length(1);
    expect(output.files[0].path).to.include('webapp/src/ts/services/');
    expect(output.files[0].content).to.include('@Injectable');
  });

  it('should generate files for multiple phases and components', async () => {
    const multiInput = {
      ...input,
      orchestrationPlan: {
        ...input.orchestrationPlan,
        phases: [
          {
            name: 'API',
            description: 'API work.',
            estimatedComplexity: 'medium' as const,
            suggestedComponents: ['api/controllers/contacts'],
            dependencies: [],
          },
          {
            name: 'UI',
            description: 'UI work.',
            estimatedComplexity: 'medium' as const,
            suggestedComponents: ['webapp/services/contacts-filter'],
            dependencies: [],
          },
        ],
      },
    };

    const output = await claudeApiCodeGenModule.generate(multiInput);

    expect(output.files).to.have.length(2);
    expect(output.files.some(f => f.path.includes('api/'))).to.be.true;
    expect(output.files.some(f => f.path.includes('webapp/'))).to.be.true;
  });

  it('should fall back to ticket components when phases have no suggested components', async () => {
    const emptyPhasesInput = {
      ...input,
      orchestrationPlan: { ...input.orchestrationPlan, phases: [] },
    };

    const output = await claudeApiCodeGenModule.generate(emptyPhasesInput);

    expect(output.files.length).to.be.greaterThan(0);
  });

  it('should strip trailing slash from target directory', async () => {
    const output = await claudeApiCodeGenModule.generate(input);

    expect(output.files[0].path).to.not.include('//');
  });

  it('should include file count in explanation', async () => {
    const output = await claudeApiCodeGenModule.generate(input);

    expect(output.explanation).to.include('1 scaffold file');
    expect(output.explanation).to.include('Add contact search filters');
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
