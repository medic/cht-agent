import { expect } from 'chai';
import { buildPlanPrompt, buildXlsformFixBrief } from '../../../../src/layers/code-gen/lib/prompts';
import { CodeGenModuleInput } from '../../../../src/layers/code-gen/interface';
import { FileManifest } from '../../../../src/layers/code-gen/lib/file-manifest';
import { CodeContextFindings } from '../../../../src/types';

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
    proposedApproach: '',
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

describe('buildPlanPrompt architecture insights (bridge #63)', () => {
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

  it('renders the architecture-insights section when findings are present', () => {
    const prompt = buildPlanPrompt(baseInput({ codeContextFindings: findings }), emptyManifest);
    expect(prompt).to.include('## Architecture insights (from cht-core wiki)');
    expect(prompt).to.include('ContactsService: CRUD for contacts');
    expect(prompt).to.include('Patterns: repository, service.');
    expect(prompt).to.include('Canonical config comparison: app_settings drifted from the canonical baseline');
  });

  it('omits the section when codeContextFindings is undefined', () => {
    const prompt = buildPlanPrompt(baseInput(), emptyManifest);
    expect(prompt).to.not.include('## Architecture insights (from cht-core wiki)');
  });
});

describe('buildPlanPrompt — cht-conf FORM fix variant (mission 05)', () => {
  const formInput = (): CodeGenModuleInput =>
    baseInput({
      ticket: {
        issue: {
          title: 'PNC keeps prompting danger signs after a miscarriage',
          type: 'bug',
          priority: 'high',
          description: 'The danger_signs group still shows for the miscarriage outcome.',
          technical_context: {
            domain: 'forms-and-reports',
            components: [],
            layer: 'cht-conf',
            configArtifact: 'form',
            artifactName: 'pregnancy_home_visit',
          },
          requirements: ['Hide danger_signs for miscarriage'],
          acceptance_criteria: ['danger_signs relevant is yes-only'],
          constraints: [],
        },
      },
    });

  it('emits a one-item CREATE plan for the descriptor and nothing else', () => {
    const prompt = buildPlanPrompt(formInput(), emptyManifest);
    expect(prompt).to.include('1. CREATE .cht-agent/xlsform-fix.json');
    expect(prompt).to.include('=== PLAN ===');
    expect(prompt).to.include('cht-conf configuration engineer');
    expect(prompt).to.include('do NOT edit the form files');
  });

  it('leaves a cht-core plan prompt unaffected (passthrough)', () => {
    const prompt = buildPlanPrompt(baseInput(), emptyManifest);
    expect(prompt).to.include('You are a CHT (Community Health Toolkit) developer');
    expect(prompt).to.not.include('.cht-agent/xlsform-fix.json');
  });

  it('appends the FEEDBACK section with the previous descriptor when a retry carries it (F3)', () => {
    const previous =
      '{"version":1,"form":"pregnancy_home_visit","edits":[],"expect":{"nodeset":"/data/danger_signs","relevant":"stale"},"rationale":"first try"}';
    const input: CodeGenModuleInput = {
      ...formInput(),
      contextFiles: [
        { path: 'feedback/additional-context.md', content: 'Converted bind still read the buggy gate.', source: 'external' },
        { path: '.cht-agent/xlsform-fix.json', content: previous, source: 'workspace' },
      ],
      failingFiles: [{ path: '.cht-agent/xlsform-fix.json', action: 'modify' }],
    };
    const prompt = buildPlanPrompt(input, emptyManifest);
    expect(prompt).to.include('=== FEEDBACK (previous attempt failed');
    expect(prompt).to.include('Converted bind still read the buggy gate.');
    expect(prompt).to.include(previous);
    expect(prompt).to.match(/do NOT repeat the previous content verbatim/i);
  });

  it('omits the FEEDBACK section from the plan prompt on a first attempt', () => {
    expect(buildPlanPrompt(formInput(), emptyManifest)).to.not.include('=== FEEDBACK');
  });
});

describe('buildXlsformFixBrief — artifact-aware paths (P1)', () => {
  const briefInput = (configArtifact: string, artifactName: string): CodeGenModuleInput =>
    baseInput({
      ticket: {
        issue: {
          title: 'Form bug',
          type: 'bug',
          priority: 'high',
          description: 'A form bind is wrong.',
          technical_context: {
            domain: 'forms-and-reports',
            components: [],
            layer: 'cht-conf',
            configArtifact: configArtifact as never,
            artifactName,
          },
          requirements: ['fix it'],
          acceptance_criteria: ['fixed'],
          constraints: [],
        },
      },
    });

  it('uses the forms/app layout and convert-app-forms for a `form` ticket', () => {
    const brief = buildXlsformFixBrief(briefInput('form', 'pregnancy_home_visit'));
    expect(brief).to.include('forms/app/pregnancy_home_visit.xlsx');
    expect(brief).to.include('forms/app/pregnancy_home_visit.xml');
    expect(brief).to.include('convert-app-forms');
    expect(brief).to.not.include('forms/contact/');
    expect(brief).to.not.include('convert-contact-forms');
  });

  it('uses the forms/contact layout and convert-contact-forms for a `contact-form` ticket', () => {
    const brief = buildXlsformFixBrief(briefInput('contact-form', 'e_household-create'));
    expect(brief).to.include('forms/contact/e_household-create.xlsx');
    expect(brief).to.include('forms/contact/e_household-create.xml');
    expect(brief).to.include('convert-contact-forms');
    expect(brief).to.not.include('forms/app/');
    // the "form" field in the descriptor example still carries the base name
    expect(brief).to.include('"form": "e_household-create"');
  });

  // P2: the brief must teach the generalized descriptor contract to the code-gen CLI.
  it('documents the P2 descriptor contract (attrs incl. null, set.clear, guardrail, legacy)', () => {
    const brief = buildXlsformFixBrief(briefInput('form', 'pregnancy_home_visit'));
    // attrs oracle with null-means-absent
    expect(brief).to.include('expect.attrs');
    expect(brief).to.match(/null.*must NOT carry|ABSENCE assertion/);
    expect(brief).to.include('"calculate": null');
    // set.clear:true
    expect(brief).to.match(/"clear": true/);
    expect(brief).to.match(/EXACTLY one of.*value.*clear/);
    // the calculate-type guardrail warning
    expect(brief).to.match(/GUARDRAIL/);
    expect(brief).to.match(/calculate-type row|type is `calculate`|calculation.*calculate/);
    // legacy relevant still accepted
    expect(brief).to.match(/[Ll]egacy.*relevant|relevant.*normalize/);
  });
});

describe('buildPlanPrompt — previous-plan carry-forward', () => {
  const prevPlan = [
    { action: 'MODIFY', filePath: 'tasks.js', rationale: 'fix resolvedIf sourceID' },
  ];

  it('omits the section entirely on iteration 1', () => {
    const prompt = buildPlanPrompt(baseInput(), emptyManifest);
    expect(prompt).to.not.contain("Previous Iteration's Plan");
  });

  // Without this anchor the planner re-derives the design each iteration and can
  // land on a different approach every round.
  it('renders the prior plan as a constraint when present', () => {
    const prompt = buildPlanPrompt(baseInput({ previousPlan: prevPlan }), emptyManifest);
    expect(prompt).to.contain("Previous Iteration's Plan");
    expect(prompt).to.contain('MODIFY tasks.js - fix resolvedIf sourceID');
    expect(prompt).to.contain('KEEP the same');
  });

  it('treats an empty prior plan as absent', () => {
    const prompt = buildPlanPrompt(baseInput({ previousPlan: [] }), emptyManifest);
    expect(prompt).to.not.contain("Previous Iteration's Plan");
  });
});

describe('buildPlanPrompt — compiled-artifact rule is layer-scoped', () => {
  const withLayer = (layer?: 'cht-conf' | 'cht-core') => {
    const input = baseInput();
    return {
      ...input,
      ticket: {
        issue: {
          ...input.ticket.issue,
          technical_context: { ...input.ticket.issue.technical_context, layer },
        },
      },
    } as CodeGenModuleInput;
  };

  it('tells cht-conf plans to leave app_settings.json alone', () => {
    const prompt = buildPlanPrompt(withLayer('cht-conf'), emptyManifest);
    expect(prompt).to.contain('Do NOT include app_settings.json as a plan item');
  });

  // cht-core legitimately hand-edits app_settings.json (permission additions).
  it('does not add the rule for cht-core', () => {
    const prompt = buildPlanPrompt(withLayer('cht-core'), emptyManifest);
    expect(prompt).to.not.contain('Do NOT include app_settings.json as a plan item');
  });
});
