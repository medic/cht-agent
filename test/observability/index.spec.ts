import { expect } from 'chai';

// Use require for proxyquire to avoid ESM conflicts
const proxyquire = require('proxyquire').noCallThru();

/**
 * Load src/observability with stubbed Langfuse SDKs so the tests never contact
 * the network. `traceCalls` records every body passed to client.trace(), which
 * lets us assert the bug-fix invariant: traces are created WITHOUT an `id`
 * (Langfuse generates it) — entity identity lives in input/tags instead.
 */
function loadObservability(env: Record<string, string | undefined> = {}) {
  const traceCalls: unknown[] = [];
  const handlerCalls: unknown[] = [];
  let constructed = 0;

  const fakeTrace = {
    span: () => ({ end: () => {} }),
    score: () => {},
    update: () => {},
  };

  class FakeLangfuse {
    constructor(_opts: unknown) {
      constructed++;
    }

    trace(body: unknown) {
      traceCalls.push(body);
      return fakeTrace;
    }

    async flushAsync() {}
  }

  class FakeCallbackHandler {
    constructor(opts: unknown) {
      handlerCalls.push(opts);
    }
  }

  const originalEnv: Record<string, string | undefined> = {};
  for (const key of Object.keys(env)) {
    originalEnv[key] = process.env[key];
    if (env[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = env[key];
    }
  }

  const mod = proxyquire('../../src/observability', {
    // __esModule:true so TS esModuleInterop resolves `import Langfuse from 'langfuse'`
    // to FakeLangfuse rather than re-wrapping the stub object.
    langfuse: { __esModule: true, default: FakeLangfuse, '@noCallThru': true },
    'langfuse-langchain': { CallbackHandler: FakeCallbackHandler, '@noCallThru': true },
  });

  const restoreEnv = () => {
    for (const key of Object.keys(originalEnv)) {
      if (originalEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalEnv[key];
      }
    }
  };

  return { mod, traceCalls, handlerCalls, getConstructed: () => constructed, restoreEnv };
}

describe('observability', () => {
  describe('getLangfuse', () => {
    it('returns a lazy singleton — constructs the client at most once', () => {
      const { mod, getConstructed, restoreEnv } = loadObservability({ LANGFUSE_ENABLED: 'false' });
      try {
        const a = mod.getLangfuse();
        const b = mod.getLangfuse();
        expect(a).to.equal(b);
        expect(getConstructed()).to.equal(1);
      } finally {
        restoreEnv();
      }
    });
  });

  describe('startTrace', () => {
    it('returns a trace and handler usable as no-ops when tracing is disabled', () => {
      const { mod, restoreEnv } = loadObservability({ LANGFUSE_ENABLED: 'false' });
      try {
        const { trace, handler } = mod.startTrace({ name: 'memory-pipeline-pr' });
        expect(trace).to.exist;
        expect(handler).to.exist;
        // The returned trace must support the full surface the pipeline uses.
        const span = trace.span({ name: 'scrape' });
        expect(() => span.end({ output: {} })).to.not.throw();
        expect(() => trace.score({ name: 'distill-outcome', value: 1 })).to.not.throw();
        expect(() => trace.update({ output: {} })).to.not.throw();
      } finally {
        restoreEnv();
      }
    });

    it('never passes an id to trace() — Langfuse generates it (session-grouping invariant)', () => {
      const { mod, traceCalls, restoreEnv } = loadObservability({ LANGFUSE_ENABLED: 'false' });
      try {
        mod.startTrace({
          name: 'memory-pipeline-pr',
          sessionId: 'session-abc',
          input: { prNum: 42, repo: 'medic/cht-core' },
          tags: ['memory-pipeline', 'medic/cht-core'],
        });
        expect(traceCalls).to.have.lengthOf(1);
        const body = traceCalls[0] as Record<string, unknown>;
        expect(body).to.not.have.property('id');
        expect(body.name).to.equal('memory-pipeline-pr');
        expect(body.sessionId).to.equal('session-abc');
        expect(body.tags).to.deep.equal(['memory-pipeline', 'medic/cht-core']);
        expect(body.input).to.deep.equal({ prNum: 42, repo: 'medic/cht-core' });
      } finally {
        restoreEnv();
      }
    });

    it('roots the LangChain handler on the created trace', () => {
      const { mod, handlerCalls, restoreEnv } = loadObservability({ LANGFUSE_ENABLED: 'false' });
      try {
        mod.startTrace({ name: 'memory-pipeline-pr' });
        expect(handlerCalls).to.have.lengthOf(1);
        expect(handlerCalls[0]).to.have.property('root');
      } finally {
        restoreEnv();
      }
    });
  });
});
