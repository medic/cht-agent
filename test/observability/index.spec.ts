import { expect } from 'chai';
import { startTrace, getLangfuse } from '../../src/observability';

/**
 * Exercises the real Langfuse SDK with LANGFUSE_ENABLED=false (the default in
 * tests/CI). The run-pipeline spec stubs the whole module out, so this is the
 * only place the disabled no-op path actually executes end to end.
 */
describe('observability (LANGFUSE_ENABLED=false)', () => {
  let original: string | undefined;

  beforeEach(() => {
    original = process.env.LANGFUSE_ENABLED;
    process.env.LANGFUSE_ENABLED = 'false';
  });

  afterEach(() => {
    if (original === undefined) delete process.env.LANGFUSE_ENABLED;
    else process.env.LANGFUSE_ENABLED = original;
  });

  it('runs the full trace lifecycle without throwing when disabled', async () => {
    const { trace, handler } = startTrace({
      name: 'test-workflow',
      sessionId: 'session-1',
      input: { id: 1 },
      tags: ['test'],
      metadata: { id: 1 },
    });

    expect(handler).to.exist;

    const span = trace.span({ name: 'step', input: { x: 1 } });
    span.end({ output: { y: 2 } });
    trace.score({ name: 'outcome', value: 1 });
    trace.update({ output: { done: true } });

    await getLangfuse().flushAsync(); // must not throw or hang
  });
});
