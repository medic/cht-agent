import { expect } from 'chai';
import { startTrace, getLangfuse, observeGeneration, fromLangChain, resetLangfuseForTests } from '../../src/observability';

/**
 * Two layers: the disabled path runs the real SDK end to end, and the enabled
 * path swaps in a recording trace so we can assert what reaches Langfuse.
 */
describe('observability', () => {
  let original: string | undefined;

  beforeEach(() => {
    original = process.env.LANGFUSE_ENABLED;
    resetLangfuseForTests();
  });

  afterEach(() => {
    if (original === undefined) delete process.env.LANGFUSE_ENABLED;
    else process.env.LANGFUSE_ENABLED = original;
    resetLangfuseForTests();
  });

  describe('LANGFUSE_ENABLED=false', () => {
    it('runs the full trace lifecycle without throwing when disabled', async () => {
      process.env.LANGFUSE_ENABLED = 'false';
      const { trace } = startTrace({ name: 'test-workflow', sessionId: 'session-1', input: { id: 1 }, tags: ['test'] });

      const span = trace.span({ name: 'step', input: { x: 1 } });
      span.end({ output: { y: 2 } });
      trace.score({ name: 'outcome', value: 1 });
      trace.update({ output: { done: true } });

      expect(await observeGeneration(trace, { name: 'model', model: 'test-model', input: 'in' },
        async () => ({ parsed: { result: 'ok' } }))).to.deep.equal({ result: 'ok' });

      await getLangfuse().shutdownAsync();
    });
  });

  describe('observeGeneration', () => {
    type Ended = Record<string, unknown> | undefined;
    function recordingTrace() {
      const state: { started?: Record<string, unknown>; ended: Ended } = { ended: undefined };
      const trace = {
        generation: (opts: Record<string, unknown>) => {
          state.started = opts;
          return { end: (body: Record<string, unknown>) => { state.ended = body; } };
        },
      } as unknown as ReturnType<typeof startTrace>['trace'];
      return { trace, state };
    }

    it('sends usageDetails and the reported model for API-path results', async () => {
      const { trace, state } = recordingTrace();
      const out = await observeGeneration(trace, { name: 'triage-classify', model: 'configured', input: 'p' },
        async () => ({ parsed: { decision: 'skip' }, model: 'anthropic/claude-haiku-4.5', usage: { input: 10, output: 5, total: 15 } }));

      expect(out).to.deep.equal({ decision: 'skip' });
      expect(state.started).to.deep.equal({ name: 'triage-classify', model: 'configured', input: 'p' });
      expect(state.ended).to.deep.equal({
        output: { decision: 'skip' },
        model: 'anthropic/claude-haiku-4.5',
        usageDetails: { input: 10, output: 5, total: 15 },
        costDetails: undefined,
      });
    });

    it('sends costDetails.total for CLI-path results that report USD cost but no tokens', async () => {
      const { trace, state } = recordingTrace();
      await observeGeneration(trace, { name: 'distill-draft', model: 'claude-cli', input: 'p' },
        async () => ({ parsed: { ok: true }, model: 'claude-sonnet-4-5', costUsd: 0.042 }));

      expect(state.ended).to.deep.equal({
        output: { ok: true },
        model: 'claude-sonnet-4-5',
        usageDetails: undefined,
        costDetails: { total: 0.042 },
      });
    });

    it('ends the generation with level ERROR and rethrows when invoke fails', async () => {
      const { trace, state } = recordingTrace();
      let thrown: unknown;
      try {
        await observeGeneration(trace, { name: 'g', model: 'm', input: 'p' }, async () => { throw new Error('model down'); });
      } catch (e) { thrown = e; }

      expect((thrown as Error).message).to.equal('model down');
      expect(state.ended).to.deep.equal({ output: { error: 'model down' }, level: 'ERROR', statusMessage: 'model down' });
    });

    it('returns parsed output and skips Langfuse when no trace is given', async () => {
      expect(await observeGeneration(undefined, { name: 'g', model: 'm', input: 'p' }, async () => ({ parsed: 7 }))).to.equal(7);
    });
  });

  describe('fromLangChain', () => {
    it('maps usage_metadata and response_metadata.model_name', () => {
      expect(fromLangChain({
        raw: { usage_metadata: { input_tokens: 3, output_tokens: 4, total_tokens: 7 }, response_metadata: { model_name: 'gpt-x' } },
        parsed: { a: 1 },
      })).to.deep.equal({ parsed: { a: 1 }, model: 'gpt-x', usage: { input: 3, output: 4, total: 7 } });
    });

    it('leaves usage undefined when the provider reports none', () => {
      expect(fromLangChain({ raw: {}, parsed: 'x' })).to.deep.equal({ parsed: 'x', model: undefined, usage: undefined });
    });
  });
});
