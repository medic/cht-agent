import { expect } from 'chai';
import { z } from 'zod';
import type { InvokeOptions } from '../../src/llm/types';

const proxyquire = require('proxyquire').noCallThru();

interface RecordedCall {
  prompt: string;
  options?: InvokeOptions;
}

/**
 * Load structured-cli with a fake factory whose provider records the
 * invokeForJSON call and returns `response`.
 */
function loadAdapter(response: unknown, calls: RecordedCall[]) {
  const fakeProvider = {
    invokeForJSON: async <T>(prompt: string, options?: InvokeOptions): Promise<T> => {
      calls.push({ prompt, options });
      return response as T;
    },
  };

  return proxyquire('../../src/llm/structured-cli', {
    './factory': {
      createLLMProviderFromEnv: () => fakeProvider,
      isUsingCLIProvider: () => true,
    },
  });
}

const schema = z.object({
  decision: z.enum(['distill', 'skip', 'flag-for-human']),
  reason: z.string().min(1),
});

const SHAPE = '{"decision": "distill" | "skip" | "flag-for-human", "reason": "<short explanation>"}';

describe('createStructuredCliChain', () => {
  it('should return the schema-parsed object from invokeForJSON', async () => {
    const calls: RecordedCall[] = [];
    const { createStructuredCliChain } = loadAdapter({ decision: 'distill', reason: 'looks substantive' }, calls);

    const chain = createStructuredCliChain(schema, SHAPE);
    const result = await chain.invoke('Classify this PR.');

    expect(result.parsed).to.deep.equal({ decision: 'distill', reason: 'looks substantive' });
    expect(calls).to.have.length(1);
  });

  it('should append the JSON shape to the prompt', async () => {
    const calls: RecordedCall[] = [];
    const { createStructuredCliChain } = loadAdapter({ decision: 'skip', reason: 'trivial' }, calls);

    await createStructuredCliChain(schema, SHAPE).invoke('Classify this PR.');

    expect(calls[0].prompt).to.include('Classify this PR.');
    expect(calls[0].prompt).to.include(SHAPE);
  });

  it('should force one-shot text-only invocation (disableTools, maxTurns 1)', async () => {
    const calls: RecordedCall[] = [];
    const { createStructuredCliChain } = loadAdapter({ decision: 'skip', reason: 'trivial' }, calls);

    await createStructuredCliChain(schema, SHAPE).invoke('Classify this PR.');

    expect(calls[0].options?.disableTools).to.equal(true);
    expect(calls[0].options?.maxTurns).to.equal(1);
  });

  it('should carry model and cost from invokeForJSONWithResponse when the provider offers it', async () => {
    const fakeProvider = {
      invokeForJSON: async () => { throw new Error('should not be called'); },
      invokeForJSONWithResponse: async () => ({
        parsed: { decision: 'skip', reason: 'trivial' },
        response: { content: '{}', model: 'claude-sonnet-4-5', costUsd: 0.0123 },
      }),
    };
    const { createStructuredCliChain } = proxyquire('../../src/llm/structured-cli', {
      './factory': { createLLMProviderFromEnv: () => fakeProvider, isUsingCLIProvider: () => true },
    });

    const result = await createStructuredCliChain(schema, SHAPE).invoke('Classify this PR.');

    expect(result).to.deep.equal({ parsed: { decision: 'skip', reason: 'trivial' }, model: 'claude-sonnet-4-5', costUsd: 0.0123 });
  });

  it('should throw when the response does not satisfy the schema', async () => {
    const calls: RecordedCall[] = [];
    const { createStructuredCliChain } = loadAdapter({ decision: 'maybe', reason: '' }, calls);

    try {
      await createStructuredCliChain(schema, SHAPE).invoke('Classify this PR.');
      expect.fail('expected a zod validation error');
    } catch (e) {
      expect((e as Error).message).to.not.equal('expected a zod validation error');
      expect(calls).to.have.length(1);
    }
  });
});
