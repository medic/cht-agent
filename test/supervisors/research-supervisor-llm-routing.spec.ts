/* eslint-disable @typescript-eslint/no-var-requires */
import { expect } from 'chai';
import sinon from 'sinon';
import { IssueTemplate, ResearchFindings, ContextAnalysisResult } from '../../src/types';

const proxyquire = require('proxyquire').noCallThru();

// Prompt-section markers the planner emits. Asserted as consts (rather than
// inline literals) to prove the built prompt reaches the provider intact.
const RESEARCH_FINDINGS_MARKER = '## Research Findings';
const YOUR_TASK_MARKER = '## Your Task';

/**
 * Load ResearchSupervisor with '@langchain/anthropic' and '../llm/structured-cli'
 * stubbed. Branch selection is driven by the stubbed isUsingCLIProvider (opts.cli),
 * so routing is deterministic and env-independent. The real @langchain/langgraph
 * and the three agent modules load fine and use no LLM, so they are left unstubbed.
 */
const loadSupervisor = (
  opts: { cli: boolean; chainResult?: unknown; chainError?: Error; apiContent?: unknown } = { cli: false }
) => {
  const ctorArgs: Array<Record<string, unknown>> = [];
  const invokeStub = sinon.stub().resolves({ content: opts.apiContent ?? 'API PLAN TEXT. '.repeat(30) });
  function FakeChatAnthropic(this: object, args: Record<string, unknown>) {
    ctorArgs.push(args);
    return Object.assign(this, { invoke: invokeStub });
  }
  const chainInvoke = opts.chainError
    ? sinon.stub().rejects(opts.chainError)
    : sinon.stub().resolves(opts.chainResult ?? { plan: 'CLI PLAN TEXT' });
  const createChain = sinon.stub().returns({ invoke: chainInvoke });
  const { ResearchSupervisor } = proxyquire('../../src/supervisors/research-supervisor', {
    '@langchain/anthropic': { ChatAnthropic: FakeChatAnthropic },
    '../llm/structured-cli': { isUsingCLIProvider: () => opts.cli, createStructuredCliChain: createChain },
  });
  return { ResearchSupervisor, ctorArgs, invokeStub, createChain, chainInvoke };
};

// Trimmed fixtures — only the fields the planner path (buildPlanPrompt +
// parsePlanResponse + deterministic helpers) actually reads.
const createTestIssue = (overrides: Partial<IssueTemplate['issue']> = {}): IssueTemplate => ({
  issue: {
    title: 'Test Issue',
    type: 'feature',
    priority: 'medium',
    description: 'Test description',
    technical_context: {
      domain: 'contacts',
      components: ['api/controllers/contacts', 'webapp/modules/contacts'],
    },
    requirements: ['Req 1', 'Req 2'],
    acceptance_criteria: ['Criterion 1'],
    constraints: ['Constraint 1'],
    ...overrides,
  },
});

const createResearchFindings = (overrides: Partial<ResearchFindings> = {}): ResearchFindings => ({
  documentationReferences: [],
  relevantExamples: [],
  suggestedApproaches: ['Approach 1'],
  relatedDomains: ['contacts'],
  confidence: 0.8,
  source: 'kapa-ai',
  ...overrides,
});

const createContextAnalysis = (overrides: Partial<ContextAnalysisResult> = {}): ContextAnalysisResult => ({
  similarContexts: [],
  reusablePatterns: [],
  relevantDesignDecisions: [],
  recommendations: ['Recommendation 1'],
  historicalSuccessRate: 0.8,
  relatedDomains: ['contacts'],
  ...overrides,
});

describe('ResearchSupervisor - LLM provider routing', () => {
  // This container exports an ambient LLM_PROVIDER / ANTHROPIC_MODEL and may
  // have ANTHROPIC_API_KEY set. Routing is stub-driven so env can't flip a
  // branch, but one test sets the key, so snapshot -> delete -> restore both.
  let savedProvider: string | undefined;
  let savedKey: string | undefined;

  beforeEach(() => {
    savedProvider = process.env.LLM_PROVIDER;
    savedKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.LLM_PROVIDER;
    delete process.env.ANTHROPIC_API_KEY;
  });

  afterEach(() => {
    if (savedProvider !== undefined) process.env.LLM_PROVIDER = savedProvider;
    else delete process.env.LLM_PROVIDER;
    if (savedKey !== undefined) process.env.ANTHROPIC_API_KEY = savedKey;
    else delete process.env.ANTHROPIC_API_KEY;
  });

  describe('CLI mode (LLM_PROVIDER=claude-cli)', () => {
    it('never constructs ChatAnthropic even when an API key is present, and builds the CLI chain', () => {
      process.env.ANTHROPIC_API_KEY = 'sk-present';
      const { ResearchSupervisor, ctorArgs, createChain } = loadSupervisor({ cli: true });

      new ResearchSupervisor({ useMockMCP: true });

      expect(ctorArgs.length).to.equal(0);
      expect(createChain.calledOnce).to.equal(true);
    });

    it('passes a "plan" JSON shape and a schema that validates the plan envelope', () => {
      const { ResearchSupervisor, createChain } = loadSupervisor({ cli: true });
      new ResearchSupervisor({ useMockMCP: true });

      const shape = createChain.firstCall.args[1];
      expect(shape).to.include('"plan"');

      const schema = createChain.firstCall.args[0];
      expect(schema.parse({ plan: 'x' })).to.deep.equal({ plan: 'x' });
      expect(() => schema.parse({})).to.throw();
    });

    it('routes generateOrchestrationPlan through the CLI chain, not ChatAnthropic', async () => {
      const { ResearchSupervisor, invokeStub, chainInvoke } = loadSupervisor({ cli: true });
      const supervisor = new ResearchSupervisor({ useMockMCP: true });

      const plan = await (supervisor as any).generateOrchestrationPlan(
        createTestIssue(),
        createResearchFindings(),
        createContextAnalysis(),
        undefined
      );

      expect(plan.summary).to.equal('CLI PLAN TEXT' + '...');
      expect(invokeStub.called).to.equal(false);
      expect(chainInvoke.calledOnce).to.equal(true);
    });

    it('forwards the fully built planner prompt to the CLI chain', async () => {
      const { ResearchSupervisor, chainInvoke } = loadSupervisor({ cli: true });
      const supervisor = new ResearchSupervisor({ useMockMCP: true });
      const issue = createTestIssue();

      await (supervisor as any).generateOrchestrationPlan(
        issue,
        createResearchFindings(),
        createContextAnalysis(),
        undefined
      );

      const prompt = chainInvoke.firstCall.args[0];
      expect(prompt).to.include(issue.issue.title);
      expect(prompt).to.include(RESEARCH_FINDINGS_MARKER);
      expect(prompt).to.include(YOUR_TASK_MARKER);
    });

    it('produces a plan identical to API mode except for the summary field', async () => {
      const issue = createTestIssue();
      const findings = createResearchFindings();
      const analysis = createContextAnalysis();

      const cli = loadSupervisor({ cli: true });
      const api = loadSupervisor({ cli: false });
      const cliSupervisor = new cli.ResearchSupervisor({ useMockMCP: true });
      const apiSupervisor = new api.ResearchSupervisor({ useMockMCP: true });

      const cliPlan = await (cliSupervisor as any).generateOrchestrationPlan(issue, findings, analysis, undefined);
      const apiPlan = await (apiSupervisor as any).generateOrchestrationPlan(issue, findings, analysis, undefined);

      expect(cliPlan.keyFindings).to.deep.equal(apiPlan.keyFindings);
      expect(cliPlan.proposedApproach).to.equal(apiPlan.proposedApproach);
      expect(cliPlan.estimatedComplexity).to.equal(apiPlan.estimatedComplexity);
      expect(cliPlan.phases).to.have.lengthOf(4);
      expect(cliPlan.phases).to.deep.equal(apiPlan.phases);
      expect(cliPlan.riskFactors).to.deep.equal(apiPlan.riskFactors);
      expect(cliPlan.estimatedEffort).to.equal(apiPlan.estimatedEffort);
      expect(cliPlan.summary).to.not.equal(apiPlan.summary);
    });

    it('propagates a CLI chain rejection as a plan-generation error node result', async () => {
      const { ResearchSupervisor } = loadSupervisor({ cli: true, chainError: new Error('zod: invalid plan') });
      const supervisor = new ResearchSupervisor({ useMockMCP: true });

      const result = await (supervisor as any).generatePlanNode({
        currentPhase: 'plan-generation',
        issue: createTestIssue(),
        researchFindings: createResearchFindings(),
        contextAnalysis: createContextAnalysis(),
        codeContextFindings: undefined,
        messages: [],
        errors: [],
        orchestrationPlan: undefined,
      });

      expect(result.errors).to.deep.equal(['Plan generation failed: zod: invalid plan']);
      expect(result.currentPhase).to.equal('error');
    });
  });

  describe('API mode default (LLM_PROVIDER unset) — no regression', () => {
    it('constructs ChatAnthropic with the default model and temperature, and builds no CLI chain', () => {
      const { ResearchSupervisor, ctorArgs, createChain } = loadSupervisor({ cli: false });
      new ResearchSupervisor({ useMockMCP: true });

      expect(ctorArgs[0]).to.deep.include({ model: 'claude-sonnet-4-20250514', temperature: 0.3 });
      expect(createChain.called).to.equal(false);
    });

    it('honors an explicit modelName override while keeping temperature 0.3', () => {
      const { ResearchSupervisor, ctorArgs } = loadSupervisor({ cli: false });
      new ResearchSupervisor({ modelName: 'claude-haiku-4-5', useMockMCP: true });

      expect(ctorArgs[0].model).to.equal('claude-haiku-4-5');
      expect(ctorArgs[0].temperature).to.equal(0.3);
    });

    it('still generates plans via ChatAnthropic.invoke with the 300-char summary truncation', async () => {
      const longApiContent = 'A'.repeat(400);
      const { ResearchSupervisor, invokeStub, chainInvoke } = loadSupervisor({
        cli: false,
        apiContent: longApiContent,
      });
      const supervisor = new ResearchSupervisor({ useMockMCP: true });

      const plan = await (supervisor as any).generateOrchestrationPlan(
        createTestIssue(),
        createResearchFindings(),
        createContextAnalysis(),
        undefined
      );

      expect(plan.summary).to.equal(longApiContent.substring(0, 300) + '...');
      expect(chainInvoke.called).to.equal(false);
      expect(invokeStub.firstCall.args[0]).to.include(YOUR_TASK_MARKER);
    });

    it('coerces non-string ChatAnthropic content via JSON.stringify unchanged', async () => {
      const structuredContent = [{ type: 'text', text: 'x' }];
      const { ResearchSupervisor } = loadSupervisor({ cli: false, apiContent: structuredContent });
      const supervisor = new ResearchSupervisor({ useMockMCP: true });

      const plan = await (supervisor as any).generateOrchestrationPlan(
        createTestIssue(),
        createResearchFindings(),
        createContextAnalysis(),
        undefined
      );

      const jsonPrefix = JSON.stringify(structuredContent);
      expect(plan.summary.startsWith(jsonPrefix)).to.equal(true);
      expect(plan.summary.endsWith('...')).to.equal(true);
    });
  });
});
