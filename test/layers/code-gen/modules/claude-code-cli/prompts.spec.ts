import { expect } from 'chai';
import { buildExecutePrompt, buildRelaxedExecutePrompt } from '../../../../../src/layers/code-gen/modules/claude-code-cli/prompts';
import { CodeGenModuleInput } from '../../../../../src/layers/code-gen/interface';
import { PlanItem } from '../../../../../src/layers/code-gen/lib/plan';
import { CodeContextFindings } from '../../../../../src/types';

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
    proposedApproach: '',
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

describe('claude-code-cli prompts architecture insights (bridge #63)', () => {
  const findings: CodeContextFindings = {
    architectureInsights: [
      {
        component: 'ContactsService',
        description: 'CRUD for contacts',
        patterns: ['repository', 'service'],
        dependencies: [],
      },
    ],
    moduleRelationships: [],
    diagrams: [],
    relevantRepos: ['cht-core'],
    warnings: [],
    confidence: 0.9,
    source: 'opendeepwiki',
    canonicalDiff: {
      artifact: 'app-settings',
      status: 'differs',
      summary: 'app_settings drifted from the canonical baseline',
    },
  };

  const withFindings: CodeGenModuleInput = { ...baseInput, codeContextFindings: findings };

  it('buildExecutePrompt renders the section when findings are present', () => {
    const prompt = buildExecutePrompt(withFindings, plan);
    expect(prompt).to.include('## Architecture insights (from cht-core wiki)');
    expect(prompt).to.include('ContactsService: CRUD for contacts');
    expect(prompt).to.include('Patterns: repository, service.');
    expect(prompt).to.include('Canonical config comparison: app_settings drifted from the canonical baseline');
  });

  it('buildRelaxedExecutePrompt renders the section when findings are present', () => {
    const prompt = buildRelaxedExecutePrompt(withFindings, plan);
    expect(prompt).to.include('## Architecture insights (from cht-core wiki)');
    expect(prompt).to.include('ContactsService: CRUD for contacts');
  });

  it('omits the section when codeContextFindings is undefined', () => {
    expect(buildExecutePrompt(baseInput, plan)).to.not.include('## Architecture insights (from cht-core wiki)');
    expect(buildRelaxedExecutePrompt(baseInput, plan)).to.not.include('## Architecture insights (from cht-core wiki)');
  });
});

describe('buildExecutePrompt — cht-conf FORM fix variant (mission 05)', () => {
  const formInput: CodeGenModuleInput = {
    ...baseInput,
    ticket: {
      issue: {
        ...baseInput.ticket.issue,
        technical_context: {
          domain: 'forms-and-reports',
          components: [],
          layer: 'cht-conf',
          configArtifact: 'form',
          artifactName: 'pregnancy_home_visit',
        },
      },
    },
  };

  it('instructs writing ONLY the descriptor and never editing the form files', () => {
    const prompt = buildExecutePrompt(formInput, plan);
    expect(prompt).to.include('.cht-agent/xlsform-fix.json');
    expect(prompt).to.include('do NOT edit the form files');
    expect(prompt).to.match(/must NOT edit any .*\.xlsx/i);
    expect(prompt).to.include('forms/app/pregnancy_home_visit.xlsx');
  });

  it('frames the workspace as a cht-conf config project, not cht-core', () => {
    const prompt = buildExecutePrompt(formInput, plan);
    expect(prompt).to.include('cht-conf CONFIG project');
    expect(prompt).to.not.include('inside the cht-core workspace');
  });

  it('embeds the descriptor schema and declares the file in files_created', () => {
    const prompt = buildExecutePrompt(formInput, plan);
    expect(prompt).to.include('"version": 1');
    expect(prompt).to.include('"expect"');
    expect(prompt).to.include('siblingsUnchanged');
    expect(prompt).to.include('"files_created": [".cht-agent/xlsform-fix.json"]');
  });

  it('the relaxed variant also routes to the descriptor prompt', () => {
    const prompt = buildRelaxedExecutePrompt(formInput, plan);
    expect(prompt).to.include('.cht-agent/xlsform-fix.json');
    expect(prompt).to.include('do NOT edit the form files');
  });

  it('leaves a cht-core ticket byte-identical (passthrough)', () => {
    expect(buildExecutePrompt(baseInput, plan)).to.include('inside the cht-core workspace');
    expect(buildExecutePrompt(baseInput, plan)).to.not.include('.cht-agent/xlsform-fix.json');
  });
});

describe('execute prompts — retry FEEDBACK section (F3)', () => {
  const formInput: CodeGenModuleInput = {
    ...baseInput,
    ticket: {
      issue: {
        ...baseInput.ticket.issue,
        technical_context: {
          domain: 'forms-and-reports',
          components: [],
          layer: 'cht-conf',
          configArtifact: 'form',
          artifactName: 'pregnancy_home_visit',
        },
      },
    },
  };

  const PREVIOUS_DESCRIPTOR =
    '{"version":1,"form":"pregnancy_home_visit","edits":[],"expect":{"nodeset":"/data/danger_signs","relevant":"stale"},"rationale":"first try"}';

  // A retry input carries the failure reason as an external context file and the
  // failing descriptor as a workspace context file keyed by its path (mirrors
  // code-generation-agent.buildModuleInput).
  const withFeedback = (input: CodeGenModuleInput): CodeGenModuleInput => ({
    ...input,
    contextFiles: [
      { path: 'feedback/additional-context.md', content: 'Converted relevant was "stale", expected yes-only gate.', source: 'external' },
      { path: '.cht-agent/xlsform-fix.json', content: PREVIOUS_DESCRIPTOR, source: 'workspace' },
    ],
    failingFiles: [{ path: '.cht-agent/xlsform-fix.json', action: 'modify' }],
  });

  it('appends the FEEDBACK section with failure reason and previous file content (generic execute)', () => {
    const prompt = buildExecutePrompt(withFeedback(baseInput), plan);
    expect(prompt).to.include('=== FEEDBACK (previous attempt failed');
    expect(prompt).to.include('Converted relevant was "stale", expected yes-only gate.');
    expect(prompt).to.include('Previous content of .cht-agent/xlsform-fix.json (modify)');
    expect(prompt).to.include(PREVIOUS_DESCRIPTOR);
    expect(prompt).to.match(/do NOT repeat the previous content verbatim/i);
    expect(prompt).to.include('=== END FEEDBACK ===');
  });

  it('appends the FEEDBACK section to the relaxed execute prompt too', () => {
    const prompt = buildRelaxedExecutePrompt(withFeedback(baseInput), plan);
    expect(prompt).to.include('=== FEEDBACK (previous attempt failed');
    expect(prompt).to.include(PREVIOUS_DESCRIPTOR);
  });

  it('appends the FEEDBACK section to the cht-conf FORM fix execute prompt', () => {
    const prompt = buildExecutePrompt(withFeedback(formInput), plan);
    expect(prompt).to.include('=== FEEDBACK (previous attempt failed');
    expect(prompt).to.include('Converted relevant was "stale", expected yes-only gate.');
    expect(prompt).to.include(PREVIOUS_DESCRIPTOR);
    // still the descriptor-only prompt, not clobbered
    expect(prompt).to.include('.cht-agent/xlsform-fix.json');
  });

  it('omits the FEEDBACK section entirely when no feedback is carried', () => {
    expect(buildExecutePrompt(baseInput, plan)).to.not.include('=== FEEDBACK');
    expect(buildRelaxedExecutePrompt(baseInput, plan)).to.not.include('=== FEEDBACK');
    expect(buildExecutePrompt(formInput, plan)).to.not.include('=== FEEDBACK');
  });

  it('still lists failing files (path + action) when their content was not carried', () => {
    const input: CodeGenModuleInput = {
      ...baseInput,
      contextFiles: [
        { path: 'feedback/additional-context.md', content: 'compile error', source: 'external' },
      ],
      failingFiles: [{ path: 'src/a.ts', action: 'modify' }],
    };
    const prompt = buildExecutePrompt(input, plan);
    expect(prompt).to.include('Previous content of src/a.ts (modify)');
    expect(prompt).to.include('(previous content not carried in context)');
  });
});
