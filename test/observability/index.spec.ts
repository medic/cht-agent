/* eslint-disable @typescript-eslint/no-var-requires */
import { expect } from 'chai';
import { LangfuseSpanProcessor, type LangfuseSpanProcessorParams } from '@langfuse/otel';
import { InMemorySpanExporter, type ReadableSpan } from '@opentelemetry/sdk-trace-base';
import type * as Observability from '../../src/observability';
import { ResearchSupervisor } from '../../src/supervisors/research-supervisor';
import type { LLMProvider } from '../../src/llm';
import type { IssueTemplate } from '../../src/types';

const proxyquire = require('proxyquire');

/** Enabled path swaps the OTLP exporter for an in-memory one to assert exactly what reaches Langfuse. */
describe('observability', () => {
  let original: string | undefined;
  let mod: typeof Observability;
  let exporter: InMemorySpanExporter;
  let processors: LangfuseSpanProcessor[];
  let processorParams: LangfuseSpanProcessorParams[];
  let scores: Array<{ otelSpan: unknown; data: Record<string, unknown> }>;
  let clientShutdowns: number;
  let clientShutdownError: Error | undefined;

  function loadWithInMemoryExporter(): typeof Observability {
    class RecordingProcessor extends LangfuseSpanProcessor {
      constructor(params: LangfuseSpanProcessorParams) {
        processorParams.push(params);
        super({ ...params, exporter });
        processors.push(this);
      }
    }
    class FakeClient {
      score = { trace: (obs: { otelSpan: unknown }, data: Record<string, unknown>) => { scores.push({ otelSpan: obs.otelSpan, data }); } };
      shutdown = async () => { clientShutdowns++; if (clientShutdownError) throw clientShutdownError; };
    }
    return proxyquire('../../src/observability', {
      '@langfuse/otel': { LangfuseSpanProcessor: RecordingProcessor },
      '@langfuse/client': { LangfuseClient: FakeClient },
    });
  }

  beforeEach(() => {
    original = process.env.LANGFUSE_ENABLED;
    exporter = new InMemorySpanExporter();
    processors = [];
    processorParams = [];
    scores = [];
    clientShutdowns = 0;
    clientShutdownError = undefined;
    mod = loadWithInMemoryExporter();
  });

  afterEach(async () => {
    await mod.resetLangfuseForTests();
    if (original === undefined) delete process.env.LANGFUSE_ENABLED;
    else process.env.LANGFUSE_ENABLED = original;
  });

  function attr(span: ReadableSpan, key: string): unknown {
    return span.attributes[key];
  }

  /** InMemorySpanExporter clears its buffer on shutdown, so read exported spans after a flush instead. */
  async function exportedSpans(): Promise<ReadableSpan[]> {
    await Promise.all(processors.map((p) => p.forceFlush()));
    return exporter.getFinishedSpans();
  }

  describe('LANGFUSE_ENABLED=false', () => {
    it('runs the full trace lifecycle without throwing and exports nothing', async () => {
      process.env.LANGFUSE_ENABLED = 'false';
      await mod.withTrace({ name: 'test-workflow', sessionId: 'session-1', input: { id: 1 }, tags: ['test'] }, async (root) => {
        root.startObservation('step', { input: { x: 1 } }).update({ output: { y: 2 } }).end();
        mod.scoreTrace(root, { name: 'outcome', value: 1 });
        root.update({ output: { done: true } });
        expect(await mod.observeGeneration(root, { name: 'model', model: 'test-model', input: 'in' },
          async () => ({ parsed: { result: 'ok' } }))).to.deep.equal({ result: 'ok' });
      });
      await mod.shutdownLangfuse();

      expect(processorParams).to.have.length(0);
      expect(scores).to.have.length(0);
      expect(exporter.getFinishedSpans()).to.have.length(0);
    });
  });

  describe('enabled', () => {
    beforeEach(() => { process.env.LANGFUSE_ENABLED = 'true'; });

    it('configures the span processor with a bounded request timeout', async () => {
      await mod.withTrace({ name: 't' }, async () => {});
      expect(processorParams).to.deep.equal([{ timeout: 3 }]);
    });

    it('puts input/output on the root observation and propagates session, tags, and metadata to every child', async () => {
      await mod.withTrace(
        { name: 'memory-pipeline-pr', sessionId: 'run-1', input: { prNum: 42 }, tags: ['memory-pipeline', 'medic/cht-core'], metadata: { prNum: '42' } },
        async (root) => {
          root.startObservation('scrape', { input: { prNum: 42 } }).update({ output: { fileCount: 3 } }).end();
          await mod.observeGeneration(root, { name: 'triage-classify', model: 'configured', input: 'p' },
            async () => ({ parsed: { decision: 'skip' }, model: 'anthropic/claude-haiku-4.5', usage: { input: 10, output: 5, total: 15 } }));
          root.update({ output: { decision: 'skip' } });
        }
      );
      const spans = await exportedSpans();
      const root = spans.find((s) => s.name === 'memory-pipeline-pr')!;
      const scrape = spans.find((s) => s.name === 'scrape')!;
      const generation = spans.find((s) => s.name === 'triage-classify')!;
      expect(spans).to.have.length(3);

      expect(root.parentSpanContext).to.be.undefined;
      expect(attr(root, 'langfuse.observation.input')).to.equal(JSON.stringify({ prNum: 42 }));
      expect(attr(root, 'langfuse.observation.output')).to.equal(JSON.stringify({ decision: 'skip' }));
      expect(attr(root, 'langfuse.trace.name')).to.equal('memory-pipeline-pr');

      for (const span of [root, scrape, generation]) {
        expect(span.spanContext().traceId, span.name).to.equal(root.spanContext().traceId);
        expect(attr(span, 'session.id'), span.name).to.equal('run-1');
        expect(attr(span, 'langfuse.trace.tags'), span.name).to.deep.equal(['memory-pipeline', 'medic/cht-core']);
        expect(attr(span, 'langfuse.trace.metadata.prNum'), span.name).to.equal('42');
      }
      expect(scrape.parentSpanContext?.spanId).to.equal(root.spanContext().spanId);
      expect(generation.parentSpanContext?.spanId).to.equal(root.spanContext().spanId);
    });

    it('records model, usageDetails, and costDetails on generations', async () => {
      await mod.withTrace({ name: 't' }, async (root) => {
        await mod.observeGeneration(root, { name: 'api-gen', model: 'configured', input: 'p' },
          async () => ({ parsed: { a: 1 }, model: 'anthropic/claude-haiku-4.5', usage: { input: 10, output: 5, total: 15 } }));
        await mod.observeGeneration(root, { name: 'cli-gen', model: 'claude-cli', input: 'p' },
          async () => ({ parsed: { ok: true }, model: 'claude-sonnet-4-5', costUsd: 0.042 }));
      });
      const spans = await exportedSpans();
      const api = spans.find((s) => s.name === 'api-gen')!;
      const cli = spans.find((s) => s.name === 'cli-gen')!;
      expect(attr(api, 'langfuse.observation.type')).to.equal('generation');
      expect(attr(api, 'langfuse.observation.model.name')).to.equal('anthropic/claude-haiku-4.5');
      expect(attr(api, 'langfuse.observation.usage_details')).to.equal(JSON.stringify({ input: 10, output: 5, total: 15 }));
      expect(attr(api, 'langfuse.observation.cost_details')).to.be.undefined;
      expect(attr(api, 'langfuse.observation.output')).to.equal(JSON.stringify({ a: 1 }));
      expect(attr(cli, 'langfuse.observation.model.name')).to.equal('claude-sonnet-4-5');
      expect(attr(cli, 'langfuse.observation.usage_details')).to.be.undefined;
      expect(attr(cli, 'langfuse.observation.cost_details')).to.equal(JSON.stringify({ total: 0.042 }));
    });

    it('nests observeActiveGeneration under the active step and records model, usage, and cost', async () => {
      await mod.withTrace({ name: 'dev-run' }, () =>
        mod.observeStep({ name: 'generate-code', asType: 'agent' }, () =>
          mod.observeActiveGeneration({ name: 'code-gen-plan', model: 'claude-cli', input: 'p', output: (r: { text: string }) => r.text },
            async () => ({ parsed: { text: 'plan' }, model: 'claude-opus-5-5', usage: { input: 900, output: 40, total: 940 }, costUsd: 0.6 }))));
      const spans = await exportedSpans();
      const step = spans.find((s) => s.name === 'generate-code')!;
      const generation = spans.find((s) => s.name === 'code-gen-plan')!;
      expect(generation.parentSpanContext?.spanId).to.equal(step.spanContext().spanId);
      expect(attr(generation, 'langfuse.observation.type')).to.equal('generation');
      expect(attr(generation, 'langfuse.observation.model.name')).to.equal('claude-opus-5-5');
      expect(attr(generation, 'langfuse.observation.usage_details')).to.equal(JSON.stringify({ input: 900, output: 40, total: 940 }));
      expect(attr(generation, 'langfuse.observation.cost_details')).to.equal(JSON.stringify({ total: 0.6 }));
      expect(attr(generation, 'langfuse.observation.output')).to.equal('plan');
    });

    it('marks an observeActiveGeneration ERROR when failure() reports one, and fails the root', async () => {
      const result = await mod.withTrace({ name: 'dev-run' }, () =>
        mod.observeActiveGeneration({ name: 'code-gen-execute', model: 'claude-cli', input: 'p', failure: (r: { isError: boolean }) => (r.isError ? 'max turns' : undefined) },
          async () => ({ parsed: { isError: true } })));
      const spans = await exportedSpans();
      const generation = spans.find((s) => s.name === 'code-gen-execute')!;
      const root = spans.find((s) => s.name === 'dev-run')!;
      expect(result).to.deep.equal({ isError: true });
      expect(attr(generation, 'langfuse.observation.level')).to.equal('ERROR');
      expect(attr(generation, 'langfuse.observation.status_message')).to.equal('max turns');
      expect(attr(root, 'langfuse.observation.level')).to.equal('ERROR');
    });

    it('records nothing from observeActiveGeneration outside a trace', async () => {
      await mod.withTrace({ name: 'warm-up' }, async () => {});
      const result = await mod.observeActiveGeneration({ name: 'orphan', model: 'm', input: 'p' }, async () => ({ parsed: 7 }));
      expect(result).to.equal(7);
      expect((await exportedSpans()).map((s) => s.name)).to.deep.equal(['warm-up']);
    });

    it('ends a failed generation with level ERROR and rethrows', async () => {
      let thrown: unknown;
      await mod.withTrace({ name: 't' }, async (root) => {
        try {
          await mod.observeGeneration(root, { name: 'g', model: 'm', input: 'p' }, async () => { throw new Error('model down'); });
        } catch (e) { thrown = e; }
      });
      const generation = (await exportedSpans()).find((s) => s.name === 'g')!;
      expect((thrown as Error).message).to.equal('model down');
      expect(attr(generation, 'langfuse.observation.level')).to.equal('ERROR');
      expect(attr(generation, 'langfuse.observation.status_message')).to.equal('model down');
      expect(attr(generation, 'langfuse.observation.output')).to.equal(JSON.stringify({ error: 'model down' }));
    });

    it('records a thrown error on the root observation, still ends it, and rethrows', async () => {
      let thrown: unknown;
      try {
        await mod.withTrace({ name: 'failing' }, async () => { throw new Error('gh exploded'); });
      } catch (e) { thrown = e; }
      const root = (await exportedSpans()).find((s) => s.name === 'failing')!;
      expect((thrown as Error).message).to.equal('gh exploded');
      expect(root.ended).to.equal(true);
      expect(attr(root, 'langfuse.observation.level')).to.equal('ERROR');
      expect(attr(root, 'langfuse.observation.output')).to.equal(JSON.stringify({ error: 'gh exploded' }));
    });

    it('scores the trace via the client using the root span context', async () => {
      let rootSpan: unknown;
      await mod.withTrace({ name: 't' }, async (root) => {
        rootSpan = root.otelSpan;
        mod.scoreTrace(root, { name: 'distill-outcome', value: 1 });
      });
      expect(scores).to.deep.equal([{ otelSpan: rootSpan, data: { name: 'distill-outcome', value: 1 } }]);
    });

    it('shuts the span processor and the client down once', async () => {
      await mod.withTrace({ name: 't' }, async () => {});
      expect(await exportedSpans()).to.have.length(1);
      await mod.shutdownLangfuse();
      expect(clientShutdowns).to.equal(1);
      await mod.shutdownLangfuse();
      expect(clientShutdowns).to.equal(2);
    });

    it('nests observeStep spans under the active observation across a LangGraph run', async () => {
      const { StateGraph, Annotation, START, END } = require('@langchain/langgraph');
      const State = Annotation.Root({ n: Annotation({ reducer: (_: number, u: number) => u, default: () => 0 }) });
      const graph = new StateGraph(State)
        .addNode('plan', (state: { n: number }) => mod.observeStep({ name: 'plan', asType: 'chain' }, async (step) => {
          await mod.observeGeneration(step, { name: 'plan-llm', model: 'm', input: 'p' }, async () => ({ parsed: 1 }));
          return { n: state.n + 1 };
        }))
        .addEdge(START, 'plan')
        .addEdge('plan', END)
        .compile();

      await mod.withTrace({ name: 'research-run' }, () =>
        mod.observeStep({ name: 'research', asType: 'agent' }, () => graph.invoke({ n: 0 })));

      const spans = await exportedSpans();
      const byName = (name: string) => spans.find((s) => s.name === name)!;
      const chain = ['research-run', 'research', 'plan', 'plan-llm'].map(byName);
      for (let i = 1; i < chain.length; i++) {
        expect(chain[i].parentSpanContext?.spanId, chain[i].name).to.equal(chain[i - 1].spanContext().spanId);
        expect(chain[i].spanContext().traceId).to.equal(chain[0].spanContext().traceId);
      }
      expect(attr(byName('research'), 'langfuse.observation.type')).to.equal('agent');
      expect(attr(byName('plan'), 'langfuse.observation.output')).to.equal(JSON.stringify({ n: 1 }));
    });

    it('marks a step ERROR when failure() reports one without the step throwing', async () => {
      await mod.withTrace({ name: 't' }, () =>
        mod.observeStep({ name: 'node', output: () => undefined, failure: () => 'docs search failed' }, async () => ({})));
      const node = (await exportedSpans()).find((s) => s.name === 'node')!;
      expect(attr(node, 'langfuse.observation.level')).to.equal('ERROR');
      expect(attr(node, 'langfuse.observation.status_message')).to.equal('docs search failed');
      expect(attr(node, 'langfuse.observation.output')).to.be.undefined;
    });

    it('observeNode summarizes the node update and marks ERROR when it carries errors', async () => {
      const node = mod.observeNode({ name: 'documentation-search', asType: 'retriever', output: () => ({ refs: 0 }) },
        async (state: { q: string }) => ({ currentPhase: 'doc-search', errors: [`search failed for ${state.q}`], messages: [{ content: 'nothing found' }] }));
      await mod.withTrace({ name: 't' }, () => node({ q: 'forms' }));
      const span = (await exportedSpans()).find((s) => s.name === 'documentation-search')!;
      expect(attr(span, 'langfuse.observation.type')).to.equal('retriever');
      expect(attr(span, 'langfuse.observation.level')).to.equal('ERROR');
      expect(attr(span, 'langfuse.observation.status_message')).to.equal('search failed for forms');
      expect(JSON.parse(attr(span, 'langfuse.observation.output') as string)).to.deep.equal(
        { phase: 'doc-search', summary: 'nothing found', errors: ['search failed for forms'], refs: 0 });
    });

    describe('supervisor instrumentation', () => {
      const issue: IssueTemplate = {
        issue: {
          title: 'Add filters', type: 'feature', priority: 'medium', description: 'Add contact filters',
          technical_context: { domain: 'contacts', components: [] },
          requirements: ['r1'], acceptance_criteria: ['a1'], constraints: [],
        },
      };
      const llm = (overrides: Partial<LLMProvider>): LLMProvider => ({
        providerType: 'anthropic', honorsCustomTools: false, modelName: 'test-model',
        invoke: async () => ({ content: '', model: 'test-model' }),
        invokeWithMessages: async () => ({ content: '', model: 'test-model' }),
        invokeForJSON: async <T>(): Promise<T> => { throw new Error('invokeForJSONWithResponse should be preferred'); },
        ...overrides,
      });
      const spanTree = async () => {
        const spans = await exportedSpans();
        const byName = (name: string) => spans.find((s) => s.name === name)!;
        const parentOf = (name: string) => spans.find((s) => s.spanContext().spanId === byName(name).parentSpanContext?.spanId)?.name;
        return { byName, parentOf };
      };

      it('traces the development graph down to the validation generation with its token usage', async () => {
        class FakeCodeGenAgent {
          generate = async () => ({
            files: [{ relativePath: 'src/a.ts', content: 'export const a = 1;', language: 'typescript', type: 'source', description: '', action: 'create' }],
            summary: 's', implementedRequirements: [], pendingRequirements: [], notes: [], confidence: 0.9,
          });
        }
        const { DevelopmentSupervisor } = proxyquire('../../src/supervisors/development-supervisor', {
          '../agents/code-generation-agent': { CodeGenerationAgent: FakeCodeGenAgent },
        });
        const validation = { requirementsMet: [], acceptanceCriteriaPassed: [], overallScore: 90, recommendations: [] };
        const supervisor = new DevelopmentSupervisor({ llmProvider: llm({
          invokeForJSONWithResponse: async <T>() => ({ parsed: validation as T, response: { content: '', model: 'test-model', usage: { inputTokens: 10, outputTokens: 5 } } }),
        }) });

        await mod.withTrace({ name: 't' }, () => supervisor.develop({
          issue,
          orchestrationPlan: { summary: '', keyFindings: [], recommendedApproach: '', estimatedComplexity: 'medium', phases: [], riskFactors: [], estimatedEffort: '' },
          researchFindings: { documentationReferences: [], relevantExamples: [], suggestedApproaches: [], relatedDomains: [], confidence: 0.5, source: 'local-docs' },
          contextAnalysis: { similarContexts: [], reusablePatterns: [], relevantDesignDecisions: [], recommendations: [], historicalSuccessRate: null, relatedDomains: [], codeContext: null },
          options: { chtCorePath: '/tmp/cht-core', previewMode: true },
        }));

        const { byName, parentOf } = await spanTree();
        expect(parentOf('development')).to.equal('t');
        expect(parentOf('generate-code')).to.equal('development');
        expect(parentOf('validate-implementation')).to.equal('development');
        expect(parentOf('implementation-validation')).to.equal('validate-implementation');
        expect(attr(byName('generate-code'), 'langfuse.observation.input')).to.equal(JSON.stringify({ iteration: 1 }));
        expect(JSON.parse(attr(byName('generate-code'), 'langfuse.observation.output') as string).files).to.deep.equal(['create src/a.ts']);
        expect(JSON.parse(attr(byName('validate-implementation'), 'langfuse.observation.output') as string).score).to.equal(90);
        expect(attr(byName('implementation-validation'), 'langfuse.observation.usage_details')).to.equal(JSON.stringify({ input: 10, output: 5, total: 15 }));
      });

      it('traces the research graph down to the plan generation with its token usage', async () => {
        const supervisor = new ResearchSupervisor({ useMockMCP: true, llmProvider: llm({
          invoke: async () => ({ content: '### IMPLEMENTATION APPROACH\nDo it.', model: 'test-model', usage: { inputTokens: 40, outputTokens: 8 } }),
        }) });

        await mod.withTrace({ name: 't' }, () => supervisor.research(issue));

        const { byName, parentOf } = await spanTree();
        expect(parentOf('research')).to.equal('t');
        for (const node of ['documentation-search', 'code-context-search', 'context-analysis', 'generate-plan']) {
          expect(parentOf(node), node).to.equal('research');
        }
        expect(parentOf('orchestration-plan')).to.equal('generate-plan');
        expect(attr(byName('orchestration-plan'), 'langfuse.observation.usage_details')).to.equal(JSON.stringify({ input: 40, output: 8, total: 48 }));
        expect(attr(byName('research'), 'langfuse.observation.level')).to.not.equal('ERROR');
        expect(attr(byName('t'), 'langfuse.observation.level')).to.not.equal('ERROR');
        expect(attr(byName('documentation-search'), 'langfuse.observation.input')).to.equal(
          JSON.stringify({ title: 'Add filters', domain: 'contacts', components: [] }));
      });
    });

    it('resolves shutdown when Langfuse is unreachable so tracing never fails the run', async () => {
      await mod.withTrace({ name: 't' }, async () => {});
      clientShutdownError = new Error('connect ECONNREFUSED 127.0.0.1:9');
      await mod.shutdownLangfuse();
      expect(clientShutdowns).to.equal(1);
    });

    it('marks the root ERROR when a nested step reports failure without throwing', async () => {
      await mod.withTrace({ name: 'root' }, () =>
        mod.observeStep({ name: 'node', output: () => undefined, failure: () => 'docs search failed' }, async () => ({})));
      const root = (await exportedSpans()).find((s) => s.name === 'root')!;
      expect(attr(root, 'langfuse.observation.level')).to.equal('ERROR');
      expect(attr(root, 'langfuse.observation.status_message')).to.equal('docs search failed');
    });

    it('leaves the root DEFAULT when every step succeeds, and scopes failures to their own trace', async () => {
      await mod.withTrace({ name: 'failing-run' }, () =>
        mod.observeStep({ name: 'bad', output: () => undefined, failure: () => 'x' }, async () => ({})));
      await mod.withTrace({ name: 'clean-run' }, () => mod.observeStep({ name: 'ok' }, async () => ({ fine: true })));
      const clean = (await exportedSpans()).find((s) => s.name === 'clean-run')!;
      expect(attr(clean, 'langfuse.observation.level')).to.be.undefined;
    });

    it('marks an empty generation ERROR and its root too, but still returns the output unchanged', async () => {
      let returned: unknown;
      await mod.withTrace({ name: 'root' }, async (root) => {
        returned = await mod.observeGeneration(root, { name: 'plan', model: 'claude-cli', input: 'p' }, async () => ({ parsed: '  ' }));
      });
      const spans = await exportedSpans();
      const plan = spans.find((s) => s.name === 'plan')!;
      expect(returned).to.equal('  ');
      expect(attr(plan, 'langfuse.observation.level')).to.equal('ERROR');
      expect(attr(plan, 'langfuse.observation.status_message')).to.equal('model returned empty output');
      expect(attr(spans.find((s) => s.name === 'root')!, 'langfuse.observation.level')).to.equal('ERROR');
    });

    it('returns parsed output and skips Langfuse when no root is given', async () => {
      expect(await mod.observeGeneration(undefined, { name: 'g', model: 'm', input: 'p' }, async () => ({ parsed: 7 }))).to.equal(7);
    });
  });

  describe('fromLLMResponse', () => {
    it('maps provider usage to Langfuse usage keys with a computed total and keeps cost', () => {
      expect(mod.fromLLMResponse({ model: 'claude-x', usage: { inputTokens: 100, outputTokens: 20 }, costUsd: 0.01 }, 'plan')).to.deep.equal(
        { parsed: 'plan', model: 'claude-x', usage: { input: 100, output: 20, total: 120 }, costUsd: 0.01 });
    });

    it('leaves usage undefined when the provider reported none', () => {
      expect(mod.fromLLMResponse({ model: 'claude-cli' }, 1).usage).to.be.undefined;
    });
  });

  describe('fromLangChain', () => {
    it('maps usage_metadata and response_metadata.model_name', () => {
      expect(mod.fromLangChain({
        raw: { usage_metadata: { input_tokens: 3, output_tokens: 4, total_tokens: 7 }, response_metadata: { model_name: 'gpt-x' } },
        parsed: { a: 1 },
      })).to.deep.equal({ parsed: { a: 1 }, model: 'gpt-x', usage: { input: 3, output: 4, total: 7 } });
    });

    it('drops usage keys the provider left undefined so usageDetails stays numeric', () => {
      expect(mod.fromLangChain({ raw: { usage_metadata: { input_tokens: 3 } }, parsed: 'x' }).usage).to.deep.equal({ input: 3 });
    });

    it('leaves usage undefined when the provider reports none', () => {
      expect(mod.fromLangChain({ raw: {}, parsed: 'x' })).to.deep.equal({ parsed: 'x', model: undefined, usage: undefined });
    });

    it('throws when parsed is null, so a schema mismatch surfaces instead of silently returning null', () => {
      expect(() => mod.fromLangChain({ raw: {}, parsed: null })).to.throw(/did not match the schema/);
    });
  });
});
