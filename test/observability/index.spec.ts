/* eslint-disable @typescript-eslint/no-var-requires */
import { expect } from 'chai';
import { LangfuseSpanProcessor, type LangfuseSpanProcessorParams } from '@langfuse/otel';
import { InMemorySpanExporter, type ReadableSpan } from '@opentelemetry/sdk-trace-base';
import type * as Observability from '../../src/observability';

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
      shutdown = async () => { clientShutdowns++; };
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

    it('returns parsed output and skips Langfuse when no root is given', async () => {
      expect(await mod.observeGeneration(undefined, { name: 'g', model: 'm', input: 'p' }, async () => ({ parsed: 7 }))).to.equal(7);
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
