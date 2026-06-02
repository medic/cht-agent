import { expect } from 'chai';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  buildTestGenModuleInput,
  TestGenerationInput,
} from '../../src/agents/test-generation-agent';
import { CodeGenerationResult, GeneratedFile } from '../../src/types';

const mkFile = (relativePath: string): GeneratedFile => ({
  relativePath,
  content: `// ${relativePath}\n`,
  language: 'typescript',
  type: 'source',
  description: 'x',
  action: 'create',
});

const mkCodeGen = (files: GeneratedFile[]): CodeGenerationResult => ({
  files,
  summary: '',
  implementedRequirements: [],
  pendingRequirements: [],
  notes: [],
  confidence: 0.9,
});

const baseInput = (overrides: Partial<TestGenerationInput> = {}): TestGenerationInput => ({
  issue: {
    issue: {
      title: 'List numbering',
      type: 'feature',
      priority: 'medium',
      description: 'd',
      technical_context: { domain: 'contacts', components: [] },
      requirements: ['r1'],
      acceptance_criteria: ['a1'],
      constraints: [],
    },
  },
  researchFindings: {
    documentationReferences: [],
    relevantExamples: [],
    suggestedApproaches: [],
    relatedDomains: [],
    confidence: 0.5,
    source: 'local-docs',
  },
  orchestrationPlan: {
    summary: '',
    keyFindings: [],
    recommendedApproach: '',
    estimatedComplexity: 'medium',
    phases: [],
    riskFactors: [],
    estimatedEffort: '',
  },
  codeGeneration: mkCodeGen([mkFile('src/a.ts')]),
  chtCorePath: '/tmp/cht-core',
  ...overrides,
});

describe('buildTestGenModuleInput', () => {
  it('maps every field to the TestGenModuleInput shape', () => {
    const input = baseInput();
    const out = buildTestGenModuleInput(input);

    expect(out.ticket).to.equal(input.issue);
    expect(out.researchFindings).to.equal(input.researchFindings);
    expect(out.orchestrationPlan).to.equal(input.orchestrationPlan);
    expect(out.targetDirectory).to.equal('/tmp/cht-core');
  });

  it('passes generatedCode through unchanged (no conversion on the way in)', () => {
    const files = [mkFile('src/a.ts'), mkFile('src/b.ts')];
    const out = buildTestGenModuleInput(baseInput({ codeGeneration: mkCodeGen(files) }));

    expect(out.generatedCode).to.equal(files);
  });

  it("defaults testTypes to ['unit'] when absent", () => {
    expect(buildTestGenModuleInput(baseInput()).testTypes).to.deep.equal(['unit']);
  });

  it('respects an explicit testTypes value', () => {
    const out = buildTestGenModuleInput(baseInput({ testTypes: ['integration', 'e2e'] }));
    expect(out.testTypes).to.deep.equal(['integration', 'e2e']);
  });

  it('builds an external feedback contextFile only when additionalContext is set', () => {
    expect(buildTestGenModuleInput(baseInput()).contextFiles).to.deep.equal([]);

    const out = buildTestGenModuleInput(baseInput({ additionalContext: 'fix the off-by-one' }));
    expect(out.contextFiles).to.have.length(1);
    expect(out.contextFiles[0]).to.deep.equal({
      path: 'feedback/additional-context.md',
      content: 'fix the off-by-one',
      source: 'external',
    });
  });

  it('binds readFile/listDirectory as closures over chtCorePath', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-adapter-'));
    try {
      fs.writeFileSync(path.join(dir, 'hello.ts'), 'export const x = 1;\n', 'utf-8');
      const out = buildTestGenModuleInput(baseInput({ chtCorePath: dir }));

      expect(out.readFile).to.be.a('function');
      expect(out.listDirectory).to.be.a('function');
      expect(await out.readFile?.('hello.ts')).to.equal('export const x = 1;\n');
      expect(await out.readFile?.('nope.ts')).to.equal(null);
      expect(await out.listDirectory?.('.')).to.include('hello.ts');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
