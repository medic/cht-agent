import { expect } from 'chai';
import sinon from 'sinon';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  createDevelopmentInput,
  executeDevelopmentWorkflow,
  displayDevelopmentCompletion,
  resolveWriteTarget,
} from '../../src/workflows/development-workflow';
import {
  ResearchState,
  DevelopmentOptions,
  DevelopmentInput,
  DevelopmentState,
  DevelopmentWorkflowResult,
  IssueTemplate,
  OrchestrationPlan,
  ResearchFindings,
  ContextAnalysisResult,
  CodeContextFindings,
} from '../../src/types';

const options: DevelopmentOptions = { chtCorePath: '/tmp/cht-core', previewMode: false };

const issue = {
  issue: {
    title: 'Add contact filters',
    type: 'feature',
    priority: 'medium',
    description: 'Filter contacts by status.',
    technical_context: { domain: 'contacts', components: [] },
    requirements: ['Add filters'],
    acceptance_criteria: ['Filter works'],
    constraints: [],
  },
} as IssueTemplate;

const orchestrationPlan = {
  summary: '',
  keyFindings: [],
  proposedApproach: '',
  estimatedComplexity: 'medium',
  phases: [],
  riskFactors: [],
  estimatedEffort: '',
} as OrchestrationPlan;

const researchFindings = {
  documentationReferences: [],
  relevantExamples: [],
  suggestedApproaches: [],
  relatedDomains: [],
  confidence: 0.5,
  source: 'local-docs',
} as ResearchFindings;

const contextAnalysis = {} as ContextAnalysisResult;

const codeContextFindings: CodeContextFindings = {
  architectureInsights: [
    { component: 'ContactsService', description: 'CRUD for contacts', patterns: ['service'], dependencies: [] },
  ],
  moduleRelationships: [],
  diagrams: [],
  relevantRepos: ['cht-core'],
  warnings: [],
  confidence: 0.9,
  source: 'opendeepwiki',
};

const baseResearch = (overrides: Partial<ResearchState> = {}): ResearchState => ({
  messages: [],
  currentPhase: 'complete',
  errors: [],
  issue,
  orchestrationPlan,
  researchFindings,
  contextAnalysis,
  ...overrides,
});

describe('createDevelopmentInput codeContextFindings bridge (#63)', () => {
  it('forwards codeContextFindings from the research state into the development input', () => {
    const input = createDevelopmentInput(baseResearch({ codeContextFindings }), options);
    expect(input).to.not.equal(null);
    expect(input!.codeContextFindings).to.deep.equal(codeContextFindings);
  });

  it('leaves codeContextFindings undefined when the research phase produced none', () => {
    const input = createDevelopmentInput(baseResearch(), options);
    expect(input).to.not.equal(null);
    expect(input!.codeContextFindings).to.equal(undefined);
  });

  it('returns null when a required research field is missing (issue absent)', () => {
    const input = createDevelopmentInput(baseResearch({ issue: undefined }), options);
    expect(input).to.equal(null);
  });
});

// ---------------------------------------------------------------------------
// #134 A1 — layer-routed development write target
// ---------------------------------------------------------------------------

type Supervisor = Parameters<typeof executeDevelopmentWorkflow>[0];

const issueWithLayer = (layer?: 'cht-core' | 'cht-conf'): IssueTemplate => ({
  issue: {
    title: 'Fix danger_signs relevant',
    type: 'bug',
    priority: 'high',
    description: 'miscarriage should skip danger_signs',
    technical_context: {
      domain: 'forms-and-reports',
      components: [],
      ...(layer ? { layer } : {}),
    },
    requirements: ['gate danger_signs to yes'],
    acceptance_criteria: ['miscarriage skips the group'],
    constraints: [],
  },
} as IssueTemplate);

const makeInput = (issue: IssueTemplate, opts: DevelopmentOptions): DevelopmentInput => ({
  issue,
  orchestrationPlan,
  researchFindings,
  contextAnalysis,
  options: opts,
});

/** Stub supervisor that records the workspace it was developed with and the write path. */
const recordingSupervisor = (record: { workspace?: string; writePath?: string }): Supervisor => ({
  async develop(input: DevelopmentInput): Promise<DevelopmentState> {
    record.workspace = input.options.chtCorePath;
    return {
      messages: [],
      issue: input.issue,
      orchestrationPlan,
      researchFindings,
      contextAnalysis,
      options: input.options,
      codeGeneration: {
        files: [{
          relativePath: 'forms/app/pregnancy_home_visit.xml',
          content: '<x/>',
          language: 'xml',
          type: 'source',
          description: 'fix',
          action: 'modify',
        }],
        summary: 'fix',
        implementedRequirements: [],
        pendingRequirements: [],
        notes: [],
        confidence: 0.9,
      },
      currentPhase: 'complete',
      errors: [],
      iterationCount: 1,
    };
  },
  async writeToChtCore(_state: DevelopmentState, targetPath: string): Promise<string[]> {
    record.writePath = targetPath;
    return ['forms/app/pregnancy_home_visit.xml'];
  },
} as unknown as Supervisor);

describe('resolveWriteTarget (#134 A1)', () => {
  const ENV_VARS = ['CHT_CONF_PATH', 'CHT_CORE_PATH'] as const;
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = {};
    ENV_VARS.forEach((name) => { savedEnv[name] = process.env[name]; });
  });
  afterEach(() => {
    ENV_VARS.forEach((name) => {
      if (savedEnv[name] === undefined) { delete process.env[name]; }
      else { process.env[name] = savedEnv[name]; }
    });
  });

  it('routes a cht-conf ticket to the CHT_CONF_PATH mount', () => {
    process.env.CHT_CONF_PATH = '/mounted/deployment-config';
    const input = makeInput(issueWithLayer('cht-conf'), { chtCorePath: '/tmp/cht-core', previewMode: false });
    const target = resolveWriteTarget(input);
    expect(target.repoPath).to.equal('/mounted/deployment-config');
    expect(target.toolchain).to.equal('cht-conf');
  });

  it('keeps a cht-core ticket on the chtCorePath working copy', () => {
    const input = makeInput(issueWithLayer('cht-core'), { chtCorePath: '/custom/cht-core', previewMode: false });
    const target = resolveWriteTarget(input);
    expect(target.repoPath).to.equal('/custom/cht-core');
    expect(target.toolchain).to.equal('cht-core');
  });

  it('keeps a ticket with no layer on the chtCorePath working copy (byte-identical default)', () => {
    const input = makeInput(issueWithLayer(undefined), { chtCorePath: '/custom/cht-core', previewMode: false });
    const target = resolveWriteTarget(input);
    expect(target.repoPath).to.equal('/custom/cht-core');
    expect(target.toolchain).to.equal('cht-core');
  });

  it('honours a pre-resolved developmentTarget passed through options (CLI path)', () => {
    // No CHT_CONF_PATH env: the pre-resolved target must be used verbatim, not re-resolved.
    delete process.env.CHT_CONF_PATH;
    const input = makeInput(issueWithLayer('cht-conf'), {
      chtCorePath: '/tmp/cht-core',
      previewMode: false,
      developmentTarget: { repoPath: '/pre/resolved', toolchain: 'cht-conf' },
    });
    const target = resolveWriteTarget(input);
    expect(target.repoPath).to.equal('/pre/resolved');
  });
});

describe('executeDevelopmentWorkflow write routing (#134 A1)', () => {
  const ENV_VARS = ['CHT_CONF_PATH', 'CHT_CORE_PATH'] as const;
  let savedEnv: Record<string, string | undefined>;
  let tmpConf: string;

  beforeEach(() => {
    savedEnv = {};
    ENV_VARS.forEach((name) => { savedEnv[name] = process.env[name]; });
    tmpConf = fs.mkdtempSync(path.join(os.tmpdir(), 'cht-conf-mount-'));
  });
  afterEach(() => {
    ENV_VARS.forEach((name) => {
      if (savedEnv[name] === undefined) { delete process.env[name]; }
      else { process.env[name] = savedEnv[name]; }
    });
    fs.rmSync(tmpConf, { recursive: true, force: true });
  });

  it('writes a cht-conf ticket under CHT_CONF_PATH and develops in that workspace', async () => {
    process.env.CHT_CONF_PATH = tmpConf; // real dir, no placeholder marker
    const record: { workspace?: string; writePath?: string } = {};
    const supervisor = recordingSupervisor(record);
    const input = makeInput(issueWithLayer('cht-conf'), { chtCorePath: '/tmp/cht-core', previewMode: false });

    const result = await executeDevelopmentWorkflow(supervisor, input);

    expect(record.writePath).to.equal(tmpConf);
    expect(record.workspace).to.equal(tmpConf);
    expect(result.filesWritten).to.have.lengthOf(1);
    expect(result.approved).to.equal(true);
  });

  it('writes a cht-core ticket under CHT_CORE_PATH unchanged (byte-identical default)', async () => {
    const record: { workspace?: string; writePath?: string } = {};
    const supervisor = recordingSupervisor(record);
    const input = makeInput(issueWithLayer('cht-core'), { chtCorePath: '/custom/cht-core', previewMode: false });

    const result = await executeDevelopmentWorkflow(supervisor, input);

    expect(record.writePath).to.equal('/custom/cht-core');
    expect(record.workspace).to.equal('/custom/cht-core');
    expect(result.filesWritten).to.have.lengthOf(1);
  });
});

// ---------------------------------------------------------------------------
// Mission 05 F4 — exhaustion is a loud stop (no staging/write, failure result)
// ---------------------------------------------------------------------------

/**
 * Stub supervisor whose develop() returns an EXHAUSTED state (the F4 marker set)
 * and whose write/stage methods are spies so the test can assert they never run.
 */
const exhaustedSupervisor = (): {
  supervisor: Supervisor;
  writeToStaging: sinon.SinonStub;
  writeToChtCore: sinon.SinonStub;
} => {
  const writeToStaging = sinon.stub().resolves({ stagingPath: '/tmp/should-not-happen', writtenFiles: [] });
  const writeToChtCore = sinon.stub().resolves([]);
  const supervisor = {
    async develop(input: DevelopmentInput): Promise<DevelopmentState> {
      return {
        messages: [],
        issue: input.issue,
        orchestrationPlan,
        researchFindings,
        contextAnalysis,
        options: input.options,
        codeGeneration: {
          files: [{
            relativePath: '.cht-agent/xlsform-fix.json',
            content: '{ bad',
            language: 'json',
            type: 'config',
            description: 'descriptor',
            action: 'create',
          }],
          summary: 'attempted fix',
          implementedRequirements: [],
          pendingRequirements: [],
          notes: [],
          confidence: 0.9,
          crossFileIssues: [{ filePath: '.cht-agent/xlsform-fix.json', issueType: 'xlsform-apply-failed', description: 'descriptor is invalid' }],
        },
        currentPhase: 'validation',
        errors: [],
        iterationCount: 3,
        xlsformApplyExhausted: { iterations: 3, reason: 'descriptor is invalid: bad json' },
      };
    },
    writeToStaging,
    writeToChtCore,
  } as unknown as Supervisor;
  return { supervisor, writeToStaging, writeToChtCore };
};

describe('executeDevelopmentWorkflow exhaustion loud stop (mission 05 F4)', () => {
  const ENV_VARS = ['CHT_CONF_PATH', 'CHT_CORE_PATH'] as const;
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = {};
    ENV_VARS.forEach((name) => { savedEnv[name] = process.env[name]; });
  });
  afterEach(() => {
    ENV_VARS.forEach((name) => {
      if (savedEnv[name] === undefined) { delete process.env[name]; }
      else { process.env[name] = savedEnv[name]; }
    });
  });

  it('preview mode: stages nothing, writes nothing, and returns a failure result', async () => {
    const { supervisor, writeToStaging, writeToChtCore } = exhaustedSupervisor();
    const input = makeInput(issueWithLayer('cht-core'), { chtCorePath: '/custom/cht-core', previewMode: true });

    const result = await executeDevelopmentWorkflow(supervisor, input);

    expect(writeToStaging.called, 'must not write to staging on exhaustion').to.equal(false);
    expect(writeToChtCore.called, 'must not write to cht-core on exhaustion').to.equal(false);
    expect(result.approved, 'exhaustion is a failure').to.equal(false);
    expect(result.filesWritten).to.have.lengthOf(0);
    expect(result.result?.xlsformApplyExhausted).to.not.equal(undefined);
  });

  it('direct mode: writes nothing and returns a failure result (does not force-approve)', async () => {
    const { supervisor, writeToChtCore } = exhaustedSupervisor();
    const input = makeInput(issueWithLayer('cht-core'), { chtCorePath: '/custom/cht-core', previewMode: false });

    const result = await executeDevelopmentWorkflow(supervisor, input);

    expect(writeToChtCore.called, 'direct mode must not force-write on exhaustion').to.equal(false);
    expect(result.approved).to.equal(false);
    expect(result.filesWritten).to.have.lengthOf(0);
  });

  it('does not loop the HC2 retry: develop() is called exactly once on exhaustion', async () => {
    const { supervisor } = exhaustedSupervisor();
    const developSpy = sinon.spy(supervisor, 'develop' as keyof Supervisor);
    const input = makeInput(issueWithLayer('cht-core'), { chtCorePath: '/custom/cht-core', previewMode: true });

    await executeDevelopmentWorkflow(supervisor, input);

    expect((developSpy as sinon.SinonSpy).callCount).to.equal(1);
  });
});

describe('displayDevelopmentCompletion Target banner (mission 05 F4 cosmetic)', () => {
  let logSpy: sinon.SinonStub;

  beforeEach(() => { logSpy = sinon.stub(console, 'log'); });
  afterEach(() => { logSpy.restore(); });

  const loggedText = (): string => logSpy.getCalls().map((c) => String(c.args[0] ?? '')).join('\n');

  const mkResult = (state: Partial<DevelopmentState>): DevelopmentWorkflowResult => ({
    approved: true,
    iterationCount: 1,
    filesWritten: ['forms/app/pregnancy_home_visit.xml'],
    result: {
      messages: [],
      issue,
      orchestrationPlan,
      researchFindings,
      contextAnalysis,
      currentPhase: 'complete',
      errors: [],
      ...state,
    } as DevelopmentState,
  });

  it('reports the actual write target (the rewritten chtCorePath) for a cht-conf run', () => {
    // The workflow rewrites options.chtCorePath to the deployment config for a
    // cht-conf ticket; the returned state carries that. The banner must echo it,
    // not the caller-supplied cht-core working copy.
    const result = mkResult({ options: { chtCorePath: '/mounted/deployment-config', previewMode: true } });
    displayDevelopmentCompletion(result, { chtCorePath: '/workspace/cht-core', previewMode: true });
    const text = loggedText();
    expect(text).to.contain('Target: /mounted/deployment-config');
    expect(text).to.not.contain('Target: /workspace/cht-core');
  });

  it('reports chtCorePath unchanged for a cht-core run (byte-identical default)', () => {
    const result = mkResult({ options: { chtCorePath: '/workspace/cht-core', previewMode: true } });
    displayDevelopmentCompletion(result, { chtCorePath: '/workspace/cht-core', previewMode: true });
    expect(loggedText()).to.contain('Target: /workspace/cht-core');
  });
});
