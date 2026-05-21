/* eslint-disable @typescript-eslint/no-var-requires */
import { expect } from 'chai';
import sinon from 'sinon';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  displayContextAnalysis,
  displayIssueDetails,
  displayOrchestrationPlan,
  displayPlanPhases,
  displayResearchFindings,
  displayResults,
  renderCrossFileIssueBanner,
  renderCompileGateSkipBanner,
  validateEnvironment,
} from '../../src/cli/display-helpers';
import {
  ContextAnalysisResult,
  CrossFileIssue,
  IssueTemplate,
  OrchestrationPlan,
  ResearchFindings,
  ResearchState,
} from '../../src/types';

const proxyquire = require('proxyquire').noCallThru();

/**
 * Capture every console.log / console.error call as a single newline-joined
 * string so tests can use `.to.include('...')` against the full transcript.
 */
const captureConsole = () => {
  const logs: string[] = [];
  const errors: string[] = [];
  const logStub = sinon.stub(console, 'log').callsFake((...args: unknown[]) => {
    logs.push(args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
  });
  const errStub = sinon.stub(console, 'error').callsFake((...args: unknown[]) => {
    errors.push(args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
  });
  return {
    getLog: () => logs.join('\n'),
    getErrors: () => errors.join('\n'),
    restore: () => { logStub.restore(); errStub.restore(); },
  };
};

describe('renderCrossFileIssueBanner (H.4)', () => {
  it('returns empty string when there are no issues', () => {
    expect(renderCrossFileIssueBanner(undefined)).to.equal('');
    expect(renderCrossFileIssueBanner([])).to.equal('');
  });

  it('groups issues by issueType with per-kind headings', () => {
    const issues: CrossFileIssue[] = [
      { filePath: 'a.ts', issueType: 'compile-error', description: 'TS2304: foo' },
      { filePath: 'b.ts', issueType: 'compile-error', description: 'TS2339: bar' },
      { filePath: '(generation)', issueType: 'partial-completion', description: 'CLI hit cap' },
      { filePath: 'c.ts', issueType: 'plan-adherence-missing', description: 'not modified' },
      { filePath: 'd.ts', issueType: 'plan-adherence-extra', description: 'unplanned' },
      { filePath: '(LLM-flagged)', issueType: 'plan-discovered-missing', description: 'noted' },
    ];
    const banner = renderCrossFileIssueBanner(issues);
    expect(banner).to.include('UNRESOLVED ISSUES REMAIN AFTER REFINEMENT');
    expect(banner).to.include('TypeScript errors remain (2):');
    expect(banner).to.include('Generation ended before completing the plan (1):');
    expect(banner).to.include('Planned files were not modified (1):');
    expect(banner).to.include('Unplanned files were modified (1):');
    expect(banner).to.include('LLM flagged files it thinks are required but not in the approved plan (1):');
    expect(banner).to.include('a.ts: TS2304: foo');
    expect(banner).to.include('b.ts: TS2339: bar');
  });

  it('uses the description field when present and falls back to reason', () => {
    const issues: CrossFileIssue[] = [
      { filePath: 'a.ts', issueType: 'compile-error', description: 'via description' },
      { filePath: 'b.ts', issueType: 'compile-error', reason: 'via reason' },
      { filePath: 'c.ts', issueType: 'compile-error' },
    ];
    const banner = renderCrossFileIssueBanner(issues);
    expect(banner).to.include('a.ts: via description');
    expect(banner).to.include('b.ts: via reason');
    expect(banner).to.include('c.ts: (no detail)');
  });

  it('caps each group at 10 entries with a "+ N more" footer', () => {
    const issues: CrossFileIssue[] = Array.from({ length: 13 }, (_, i) => ({
      filePath: `f${i}.ts`,
      issueType: 'compile-error',
      description: `err ${i}`,
    }));
    const banner = renderCrossFileIssueBanner(issues);
    // 10 visible + 1 footer line
    expect(banner).to.include('f0.ts: err 0');
    expect(banner).to.include('f9.ts: err 9');
    expect(banner).not.to.include('f10.ts: err 10');
    expect(banner).to.include('and 3 more');
  });

  it('routes issues without a recognized issueType under "Other unresolved issues"', () => {
    // Static validators (regex, AST) emit reason/referencedIdentifier but no
    // issueType. Those should still surface, just under the fallback heading.
    const issues: CrossFileIssue[] = [
      { filePath: 'a.ts', referencedIdentifier: 'foo', expectedSource: 'b.ts', reason: 'identifier mismatch' },
    ];
    const banner = renderCrossFileIssueBanner(issues);
    expect(banner).to.include('Other unresolved issues (1):');
    expect(banner).to.include('a.ts: identifier mismatch');
  });
});

describe('renderCompileGateSkipBanner (H.4)', () => {
  it('renders the skip reason and remediation command', () => {
    const banner = renderCompileGateSkipBanner(
      'tsc not available in cht-core workspace',
      '/home/me/cht-core',
    );
    expect(banner).to.include('COMPILE GATE NOT RUN');
    expect(banner).to.include('tsc not available in cht-core workspace');
    expect(banner).to.include('cd /home/me/cht-core && npm install');
    expect(banner).to.include('You may still accept the diff');
  });
});

// ====== v9c.1 ======

const mkTicket = (overrides: Partial<IssueTemplate['issue']> = {}): IssueTemplate => ({
  issue: {
    title: 'Add contact filters',
    type: 'feature',
    priority: 'high',
    description: 'd',
    technical_context: { domain: 'contacts', components: ['webapp/contacts'] },
    requirements: ['r1'],
    acceptance_criteria: ['a1'],
    constraints: [],
    ...overrides,
  },
});

const mkResearchState = (overrides: Partial<ResearchState> = {}): ResearchState => ({
  messages: [],
  currentPhase: 'complete',
  errors: [],
  ...overrides,
});

const mkFindings = (overrides: Partial<ResearchFindings> = {}): ResearchFindings => ({
  documentationReferences: [],
  relevantExamples: [],
  suggestedApproaches: [],
  relatedDomains: ['contacts'],
  confidence: 0.85,
  source: 'kapa-ai',
  ...overrides,
});

const mkAnalysis = (overrides: Partial<ContextAnalysisResult> = {}): ContextAnalysisResult => ({
  similarContexts: [],
  reusablePatterns: [],
  relevantDesignDecisions: [],
  recommendations: [],
  historicalSuccessRate: 0.75,
  relatedDomains: ['contacts'],
  codeContext: null,
  ...overrides,
});

const mkPlan = (overrides: Partial<OrchestrationPlan> = {}): OrchestrationPlan => ({
  summary: 's',
  keyFindings: ['f1', 'f2'],
  recommendedApproach: 'do it',
  estimatedComplexity: 'medium',
  phases: [],
  riskFactors: [],
  estimatedEffort: '1 day',
  ...overrides,
});

describe('validateEnvironment (v9c.1)', () => {
  let originalKey: string | undefined;
  let exitStub: sinon.SinonStub;
  let cap: ReturnType<typeof captureConsole>;

  beforeEach(() => {
    originalKey = process.env.ANTHROPIC_API_KEY;
    // process.exit is stubbed so the test process does not terminate.
    exitStub = sinon.stub(process, 'exit') as unknown as sinon.SinonStub;
    cap = captureConsole();
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalKey;
    exitStub.restore();
    cap.restore();
  });

  it('does NOT exit when ANTHROPIC_API_KEY is set', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    validateEnvironment();
    expect(exitStub.called).to.equal(false);
  });

  it('prints an error + remediation and calls process.exit(1) when the key is missing', () => {
    delete process.env.ANTHROPIC_API_KEY;
    validateEnvironment();
    expect(exitStub.calledOnceWithExactly(1)).to.equal(true);
    expect(cap.getErrors()).to.match(/ANTHROPIC_API_KEY not found/);
    expect(cap.getLog()).to.include('.env file');
    expect(cap.getLog()).to.include('ANTHROPIC_API_KEY=your_api_key_here');
  });
});

describe('displayIssueDetails (v9c.1)', () => {
  let cap: ReturnType<typeof captureConsole>;

  beforeEach(() => { cap = captureConsole(); });
  afterEach(() => cap.restore());

  it('prints title, type, priority, domain, and components', () => {
    displayIssueDetails(mkTicket());
    const out = cap.getLog();
    expect(out).to.include('Title: Add contact filters');
    expect(out).to.include('Type: feature');
    expect(out).to.include('Priority: high');
    expect(out).to.include('Domain: contacts');
    expect(out).to.include('Components: webapp/contacts');
  });

  it('omits the components line when there are none', () => {
    displayIssueDetails(mkTicket({
      technical_context: { domain: 'contacts', components: [] },
    }));
    expect(cap.getLog()).to.not.include('Components:');
  });

  it('omits the domain line when domain is empty', () => {
    displayIssueDetails(mkTicket({
      technical_context: { domain: '' as IssueTemplate['issue']['technical_context']['domain'], components: [] },
    }));
    expect(cap.getLog()).to.not.include('Domain:');
  });
});

describe('displayResearchFindings (v9c.1)', () => {
  let cap: ReturnType<typeof captureConsole>;
  beforeEach(() => { cap = captureConsole(); });
  afterEach(() => cap.restore());

  it('is a silent no-op when result.researchFindings is undefined', () => {
    displayResearchFindings(mkResearchState());
    expect(cap.getLog()).to.equal('');
  });

  it('renders source, confidence percentage, and reference list', () => {
    displayResearchFindings(mkResearchState({
      researchFindings: mkFindings({
        confidence: 0.85,
        source: 'kapa-ai',
        documentationReferences: [
          { title: 'Forms guide', url: 'https://docs/forms', topics: ['forms'], relevantSections: ['Validation'] },
        ],
      }),
    }));
    const out = cap.getLog();
    expect(out).to.include('Source: kapa-ai');
    expect(out).to.include('Confidence: 85%');
    expect(out).to.include('Documentation References (1):');
    expect(out).to.include('Forms guide');
    expect(out).to.include('URL: https://docs/forms');
    expect(out).to.include('Topics: forms');
    expect(out).to.include('Sections: Validation');
  });

  it('omits the Sections line when relevantSections is empty', () => {
    displayResearchFindings(mkResearchState({
      researchFindings: mkFindings({
        documentationReferences: [{ title: 't', url: 'u', topics: ['x'] }],
      }),
    }));
    expect(cap.getLog()).to.not.include('Sections:');
  });

  it('renders the suggestedApproaches section when populated', () => {
    displayResearchFindings(mkResearchState({
      researchFindings: mkFindings({ suggestedApproaches: ['Approach A', 'Approach B'] }),
    }));
    const out = cap.getLog();
    expect(out).to.include('Suggested Approaches:');
    expect(out).to.include('1. Approach A');
    expect(out).to.include('2. Approach B');
  });
});

describe('displayContextAnalysis (v9c.1)', () => {
  let cap: ReturnType<typeof captureConsole>;
  beforeEach(() => { cap = captureConsole(); });
  afterEach(() => cap.restore());

  it('is a silent no-op when result.contextAnalysis is undefined', () => {
    displayContextAnalysis(mkResearchState());
    expect(cap.getLog()).to.equal('');
  });

  it('renders counts and historical success rate as a percentage', () => {
    displayContextAnalysis(mkResearchState({
      contextAnalysis: mkAnalysis({
        similarContexts: [
          {
            id: 'r1',
            timestamp: '2025-01-01',
            category: 'feature',
            domains: ['contacts'],
            phase: 'completed',
            task_id: 't1',
            summary: 's',
            tech_stack: [],
            components: {},
          },
        ],
        historicalSuccessRate: 0.92,
      }),
    }));
    const out = cap.getLog();
    expect(out).to.include('Similar Past Issues: 1');
    expect(out).to.include('Historical Success Rate: 92%');
  });

  it('shows "N/A" for historicalSuccessRate when null', () => {
    displayContextAnalysis(mkResearchState({
      contextAnalysis: mkAnalysis({ historicalSuccessRate: null }),
    }));
    expect(cap.getLog()).to.include('Historical Success Rate: N/A (no historical data)');
  });

  it('renders recommendations and reusable patterns when populated', () => {
    displayContextAnalysis(mkResearchState({
      contextAnalysis: mkAnalysis({
        recommendations: ['Reuse pattern X'],
        reusablePatterns: [{
          pattern: 'P1',
          description: 'desc',
          example: 'ex',
          domain: 'contacts',
          frequency: 3,
        }],
      }),
    }));
    const out = cap.getLog();
    expect(out).to.include('Recommendations:');
    expect(out).to.include('1. Reuse pattern X');
    expect(out).to.include('Reusable Patterns:');
    expect(out).to.include('1. P1 (used 3 times)');
  });
});

describe('displayPlanPhases (v9c.1)', () => {
  let cap: ReturnType<typeof captureConsole>;
  beforeEach(() => { cap = captureConsole(); });
  afterEach(() => cap.restore());

  it('renders each phase with name, complexity, description, and components', () => {
    displayPlanPhases(mkPlan({
      phases: [{
        name: 'API',
        description: 'wire up controller',
        estimatedComplexity: 'medium',
        suggestedComponents: ['api/controllers/contacts'],
        dependencies: [],
      }],
    }));
    const out = cap.getLog();
    expect(out).to.include('Implementation Phases (1):');
    expect(out).to.include('1. API [medium]');
    expect(out).to.include('wire up controller');
    expect(out).to.include('Components: api/controllers/contacts');
  });

  it('renders the Dependencies line when a phase has any', () => {
    displayPlanPhases(mkPlan({
      phases: [{
        name: 'UI',
        description: 'd',
        estimatedComplexity: 'medium',
        suggestedComponents: [],
        dependencies: ['API'],
      }],
    }));
    expect(cap.getLog()).to.include('Dependencies: API');
  });

  it('renders the Risk Factors section when populated', () => {
    displayPlanPhases(mkPlan({
      phases: [],
      riskFactors: ['breaking change in service contract'],
    }));
    const out = cap.getLog();
    expect(out).to.include('Risk Factors:');
    expect(out).to.include('1. breaking change in service contract');
  });
});

describe('displayOrchestrationPlan (v9c.1)', () => {
  let cap: ReturnType<typeof captureConsole>;
  beforeEach(() => { cap = captureConsole(); });
  afterEach(() => cap.restore());

  it('is a silent no-op when result.orchestrationPlan is undefined', () => {
    displayOrchestrationPlan(mkResearchState());
    expect(cap.getLog()).to.equal('');
  });

  it('renders complexity (UPPERCASE), effort, approach, and key findings', () => {
    displayOrchestrationPlan(mkResearchState({
      orchestrationPlan: mkPlan({
        estimatedComplexity: 'high',
        estimatedEffort: '3 days',
        recommendedApproach: 'extend ContactsService',
        keyFindings: ['finding 1', 'finding 2'],
      }),
    }));
    const out = cap.getLog();
    expect(out).to.include('Estimated Complexity: HIGH');
    expect(out).to.include('Estimated Effort: 3 days');
    expect(out).to.include('extend ContactsService');
    expect(out).to.include('1. finding 1');
    expect(out).to.include('2. finding 2');
  });
});

describe('displayResults (v9c.1)', () => {
  let cap: ReturnType<typeof captureConsole>;
  beforeEach(() => { cap = captureConsole(); });
  afterEach(() => cap.restore());

  it('renders the duration, phase, and zero-errors state', () => {
    displayResults(mkResearchState({ currentPhase: 'complete', errors: [] }), '12.34');
    const out = cap.getLog();
    expect(out).to.include('Duration: 12.34 seconds');
    expect(out).to.include('Phase: complete');
    expect(out).to.include('Errors: 0');
    expect(out).to.not.include('Errors encountered');
  });

  it('renders the "Errors encountered" section when result.errors is non-empty', () => {
    displayResults(mkResearchState({
      currentPhase: 'error',
      errors: ['doc search failed', 'plan failed'],
    }), '5.00');
    const out = cap.getLog();
    expect(out).to.include('Errors: 2');
    expect(out).to.include('Errors encountered');
    expect(out).to.include('- doc search failed');
    expect(out).to.include('- plan failed');
  });
});

describe('loadTicket (v9c.1)', () => {
  let scratchDir: string;
  let exitStub: sinon.SinonStub;
  let cap: ReturnType<typeof captureConsole>;

  beforeEach(() => {
    scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cht-agent-loadticket-test-'));
    exitStub = sinon.stub(process, 'exit') as unknown as sinon.SinonStub;
    cap = captureConsole();
  });

  afterEach(() => {
    fs.rmSync(scratchDir, { recursive: true, force: true });
    exitStub.restore();
    cap.restore();
  });

  it('returns the parsed ticket and logs success on a valid file', () => {
    const loadTicket = proxyquire('../../src/cli/display-helpers', {
      '../utils/ticket-parser': {
        parseTicketFile: () => mkTicket({ title: 'Parsed OK' }),
      },
    }).loadTicket;
    const ticket = loadTicket('whatever.md', ['hint']);
    expect(ticket.issue.title).to.equal('Parsed OK');
    expect(cap.getLog()).to.include('Ticket parsed successfully');
    expect(exitStub.called).to.equal(false);
  });

  it('calls process.exit(1), logs the parse error, and prints the help hints on parse failure', () => {
    const loadTicket = proxyquire('../../src/cli/display-helpers', {
      '../utils/ticket-parser': {
        parseTicketFile: () => { throw new Error('bad frontmatter'); },
      },
    }).loadTicket;

    loadTicket('bad.md', ['help line 1', 'help line 2']);

    expect(exitStub.calledOnceWithExactly(1)).to.equal(true);
    expect(cap.getErrors()).to.match(/Error parsing ticket file/);
    expect(cap.getErrors()).to.match(/bad frontmatter/);
    const out = cap.getLog();
    expect(out).to.include('Ticket file format:');
    expect(out).to.include('- help line 1');
    expect(out).to.include('- help line 2');
  });
});
