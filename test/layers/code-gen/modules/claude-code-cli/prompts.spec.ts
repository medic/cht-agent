import { expect } from 'chai';
import { buildExecutePrompt, buildRelaxedExecutePrompt } from '../../../../../src/layers/code-gen/modules/claude-code-cli/prompts';
import { CodeGenModuleInput } from '../../../../../src/layers/code-gen/interface';
import { PlanItem } from '../../../../../src/layers/code-gen/lib/plan';

const baseInput: CodeGenModuleInput = {
  ticket: {
    issue: {
      title: 'Add contact search filters',
      type: 'feature',
      priority: 'medium',
      description: 'Allow filtering by status.',
      technical_context: { domain: 'contacts', components: [] },
      requirements: ['Add UI filters'],
      acceptance_criteria: ['Filter visible'],
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
  targetDirectory: '/tmp/cht-core-test',
};

const plan: PlanItem[] = [
  { action: 'CREATE', filePath: 'src/a.ts', rationale: 'Implementation of feature A' },
  { action: 'MODIFY', filePath: 'src/b.ts', rationale: 'Update file B for feature' },
];

describe('buildRelaxedExecutePrompt (R17.1)', () => {
  it('uses the "Plan Adherence (GUIDANCE)" heading instead of "STRICT"', () => {
    const prompt = buildRelaxedExecutePrompt(baseInput, plan);
    expect(prompt).to.include('Plan Adherence (GUIDANCE)');
    expect(prompt).to.not.include('Plan Adherence (STRICT)');
  });

  it('retains the scope contract (do NOT add files outside the plan)', () => {
    const prompt = buildRelaxedExecutePrompt(baseInput, plan);
    expect(prompt).to.include('do NOT add files outside the plan');
  });

  it('lists the planned files and the JSON output block', () => {
    const prompt = buildRelaxedExecutePrompt(baseInput, plan);
    expect(prompt).to.include('1. CREATE src/a.ts');
    expect(prompt).to.include('2. MODIFY src/b.ts');
    expect(prompt).to.include('files_modified');
    expect(prompt).to.include('files_created');
  });

  it('signals the prior attempt produced no edits and asks for best-effort', () => {
    const prompt = buildRelaxedExecutePrompt(baseInput, plan);
    expect(prompt).to.match(/earlier attempt|did not write any edits/i);
    expect(prompt).to.match(/best.effort|best guess/i);
  });

  it('differs from buildExecutePrompt only in the Plan Adherence section', () => {
    // Sanity: same task/requirements/plan/output sections, different adherence section.
    const strict = buildExecutePrompt(baseInput, plan);
    const relaxed = buildRelaxedExecutePrompt(baseInput, plan);
    expect(strict).to.include('Plan Adherence (STRICT)');
    expect(relaxed).to.include('Plan Adherence (GUIDANCE)');
    // Both share the task heading
    expect(strict).to.include('## Task');
    expect(relaxed).to.include('## Task');
  });
});
