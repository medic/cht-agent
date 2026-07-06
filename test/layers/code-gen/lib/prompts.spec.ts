import { expect } from 'chai';
import { buildPlanPrompt } from '../../../../src/layers/code-gen/lib/prompts';
import { CodeGenModuleInput } from '../../../../src/layers/code-gen/interface';
import { FileManifest } from '../../../../src/layers/code-gen/lib/file-manifest';

const baseInput = (overrides: Partial<CodeGenModuleInput> = {}): CodeGenModuleInput => ({
  ticket: {
    issue: {
      title: 'Test ticket',
      type: 'feature',
      priority: 'medium',
      description: 'Test description',
      technical_context: { domain: 'contacts', components: [] },
      requirements: ['Do the thing'],
      acceptance_criteria: ['Thing is done'],
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
  contextFiles: [],
  orchestrationPlan: {
    summary: '',
    keyFindings: [],
    recommendedApproach: '',
    estimatedComplexity: 'medium',
    phases: [],
    riskFactors: [],
    estimatedEffort: '',
  },
  targetDirectory: '/tmp/cht-core',
  ...overrides,
});

const emptyManifest: FileManifest = { existingFiles: [], allowedDirectories: [] };

describe('buildPlanPrompt R4(b) context-size cap', () => {
  it('caps existingCodeContext at the 64 KiB byte budget', () => {
    // 20 contextFiles of 4 KiB each = 80 KiB total. The 64 KiB cap should fit ~16 of them.
    const contextFiles = Array.from({ length: 20 }, (_, i) => ({
      path: `webapp/src/ts/services/svc-${i}.ts`,
      content: 'X'.repeat(4 * 1024),
      source: 'workspace' as const,
    }));
    const input = baseInput({ contextFiles });
    const prompt = buildPlanPrompt(input, emptyManifest);
    // The cap is on the body of existingCodeContext alone; the full prompt has
    // additional chrome (manifest, instructions, etc.). Stay generous: under 100 KiB total.
    expect(prompt.length).to.be.lessThan(100 * 1024);
    expect(prompt).to.match(/\[NOTE: \d+ file\(s\) omitted to fit a 64 KiB context budget/);
  });

  it('does not truncate when contextFiles fit within the budget', () => {
    // 5 files × 4 KiB = 20 KiB total, well under 64 KiB.
    const contextFiles = Array.from({ length: 5 }, (_, i) => ({
      path: `webapp/src/ts/services/svc-${i}.ts`,
      content: 'X'.repeat(4 * 1024),
      source: 'workspace' as const,
    }));
    const input = baseInput({ contextFiles });
    const prompt = buildPlanPrompt(input, emptyManifest);
    expect(prompt).to.not.include('[NOTE:');
  });

  it('skips non-workspace files when computing the cap', () => {
    // 20 agent-memory files of 4 KiB each. None are workspace, so existingCodeContext stays empty.
    const contextFiles = Array.from({ length: 20 }, (_, i) => ({
      path: `agent-memory/svc-${i}.md`,
      content: 'X'.repeat(4 * 1024),
      source: 'agent-memory' as const,
    }));
    const input = baseInput({ contextFiles });
    const prompt = buildPlanPrompt(input, emptyManifest);
    expect(prompt).to.not.include('[NOTE:');
  });
});
