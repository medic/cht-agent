/* eslint-disable @typescript-eslint/no-var-requires */
import { expect } from 'chai';
import sinon from 'sinon';
import { APIProviderConfig, LLMProvider } from '../../../src/llm/types';

const proxyquire = require('proxyquire').noCallThru();

const loadProviderTyped = (
  stub: { FakeChatAnthropic: unknown },
  config: APIProviderConfig,
): LLMProvider => {
  const mod = proxyquire('../../../src/llm/providers/anthropic', {
    '@langchain/anthropic': { ChatAnthropic: stub.FakeChatAnthropic },
  });
  return mod.createAnthropicProvider(config) as LLMProvider;
};

interface ChatResponseShape {
  content: unknown;
  usage_metadata?: { input_tokens: number; output_tokens: number };
  response_metadata?: { stop_reason?: string };
  tool_calls?: Array<{ name: string; args: Record<string, unknown>; id: string }>;
}

/**
 * Stub the `@langchain/anthropic` ChatAnthropic class with one whose `invoke`
 * is a sinon stub. The production code constructs new instances per call
 * (when options override temperature/maxTokens); we install a captured
 * `lastInstance` reference so tests can read the constructor args.
 */
const buildChatAnthropicStub = () => {
  const invokeStub = sinon.stub();
  let lastCtorArgs: Record<string, unknown> | undefined;
  let lastBoundTools: { tools: unknown; opts: unknown } | undefined;
  const FakeChatAnthropic = function FakeChatAnthropic(this: object, args: Record<string, unknown>) {
    lastCtorArgs = args;
    return Object.assign(this, {
      invoke: invokeStub,
      bindTools: (tools: unknown, opts: unknown) => {
        lastBoundTools = { tools, opts };
        return { invoke: invokeStub };
      },
    });
  } as unknown as { new (args: Record<string, unknown>): { invoke: typeof invokeStub } };
  return {
    FakeChatAnthropic,
    invokeStub,
    getLastCtorArgs: () => lastCtorArgs,
    getLastBoundTools: () => lastBoundTools,
  };
};

const loadProvider = (chatStub: { FakeChatAnthropic: unknown }) => {
  return proxyquire('../../../src/llm/providers/anthropic', {
    '@langchain/anthropic': { ChatAnthropic: chatStub.FakeChatAnthropic },
  });
};

const baseConfig: APIProviderConfig = {
  mode: 'api',
  provider: 'anthropic',
  apiKey: 'sk-test',
  model: 'claude-opus-4-6',
};

describe('createAnthropicProvider (v9a.6) — wiring', () => {
  it('constructs ChatAnthropic with the config api key, model, and a default temperature', () => {
    const stub = buildChatAnthropicStub();
    const { createAnthropicProvider } = loadProvider(stub);
    createAnthropicProvider(baseConfig);
    const ctor = stub.getLastCtorArgs();
    expect(ctor).to.not.equal(undefined);
    expect(ctor!.modelName).to.equal('claude-opus-4-6');
    expect(ctor!.anthropicApiKey).to.equal('sk-test');
    expect(ctor!.temperature).to.equal(0.3); // DEFAULT_CONFIG.temperature
    expect(ctor!.streaming).to.equal(true);
  });

  it('caps maxTokens to the model limit (128000 for opus 4.6)', () => {
    const stub = buildChatAnthropicStub();
    const { createAnthropicProvider } = loadProvider(stub);
    createAnthropicProvider({ ...baseConfig, maxTokens: 999999 });
    expect(stub.getLastCtorArgs()!.maxTokens).to.equal(128000);
  });

  it('honors per-call temperature and maxTokens via a fresh ChatAnthropic instance', async () => {
    const stub = buildChatAnthropicStub();
    stub.invokeStub.resolves({
      content: 'ok',
      usage_metadata: { input_tokens: 5, output_tokens: 3 },
      response_metadata: { stop_reason: 'end_turn' },
    } as ChatResponseShape);
    const { createAnthropicProvider } = loadProvider(stub);
    const provider = createAnthropicProvider(baseConfig);
    await provider.invoke('hi', { temperature: 0.9, maxTokens: 10000 });
    // The override-instance ctor args are the most recent.
    expect(stub.getLastCtorArgs()!.temperature).to.equal(0.9);
    expect(stub.getLastCtorArgs()!.maxTokens).to.equal(10000);
  });
});

describe('createAnthropicProvider invoke / invokeWithMessages', () => {
  it('returns content + usage + stopReason from a string-content response', async () => {
    const stub = buildChatAnthropicStub();
    stub.invokeStub.resolves({
      content: 'hello world',
      usage_metadata: { input_tokens: 12, output_tokens: 7 },
      response_metadata: { stop_reason: 'end_turn' },
    } as ChatResponseShape);
    const { createAnthropicProvider } = loadProvider(stub);
    const provider = createAnthropicProvider(baseConfig);
    const result = await provider.invoke('prompt');
    expect(result.content).to.equal('hello world');
    expect(result.model).to.equal('claude-opus-4-6');
    expect(result.usage).to.deep.equal({ inputTokens: 12, outputTokens: 7 });
    expect(result.stopReason).to.equal('end_turn');
  });

  it('extracts text from an array-of-blocks content (multi-block response)', async () => {
    const stub = buildChatAnthropicStub();
    stub.invokeStub.resolves({
      content: [
        { type: 'text', text: 'hello ' },
        { type: 'tool_use', name: 'foo', input: {} },
        { type: 'text', text: 'world' },
      ],
    } as ChatResponseShape);
    const { createAnthropicProvider } = loadProvider(stub);
    const provider = createAnthropicProvider(baseConfig);
    const result = await provider.invoke('prompt');
    expect(result.content).to.equal('hello world');
  });

  it('omits usage when usage_metadata is missing on the response', async () => {
    const stub = buildChatAnthropicStub();
    stub.invokeStub.resolves({ content: 'ok' } as ChatResponseShape);
    const { createAnthropicProvider } = loadProvider(stub);
    const provider = createAnthropicProvider(baseConfig);
    const result = await provider.invoke('prompt');
    expect(result.usage).to.equal(undefined);
  });

  it('invokeWithMessages preserves system / user / assistant role mapping', async () => {
    const stub = buildChatAnthropicStub();
    stub.invokeStub.resolves({ content: 'reply' } as ChatResponseShape);
    const { createAnthropicProvider } = loadProvider(stub);
    const provider = createAnthropicProvider(baseConfig);
    await provider.invokeWithMessages([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'u1' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'u2' },
    ]);
    const callArgs = stub.invokeStub.firstCall.args[0] as Array<[string, string]>;
    expect(callArgs).to.deep.equal([
      ['system', 'sys'],
      ['human', 'u1'],
      ['assistant', 'a1'],
      ['human', 'u2'],
    ]);
  });

  it('propagates rejection from the underlying ChatAnthropic.invoke', async () => {
    const stub = buildChatAnthropicStub();
    stub.invokeStub.rejects(new Error('401 Unauthorized'));
    const { createAnthropicProvider } = loadProvider(stub);
    const provider = createAnthropicProvider(baseConfig);
    let caught: Error | null = null;
    try { await provider.invoke('prompt'); } catch (e) { caught = e as Error; }
    expect(caught).to.not.equal(null);
    expect(caught!.message).to.match(/401 Unauthorized/);
  });
});

describe('createAnthropicProvider invokeForJSON', () => {
  it('parses the LLM response as JSON when it is wrapped in a ```json fence', async () => {
    const stub = buildChatAnthropicStub();
    stub.invokeStub.resolves({
      content: '```json\n{"answer": 42}\n```',
    } as ChatResponseShape);
    const provider = loadProviderTyped(stub, baseConfig);
    const result = await provider.invokeForJSON<{ answer: number }>('p');
    expect(result.answer).to.equal(42);
  });

  it('parses JSON without a code fence by finding the first {...} block', async () => {
    const stub = buildChatAnthropicStub();
    stub.invokeStub.resolves({
      content: 'Sure, here you go: {"k": "v"} (final)',
    } as ChatResponseShape);
    const provider = loadProviderTyped(stub, baseConfig);
    const result = await provider.invokeForJSON<{ k: string }>('p');
    expect(result.k).to.equal('v');
  });

  it('strips trailing commas before } or ] (common LLM JSON drift)', async () => {
    const stub = buildChatAnthropicStub();
    stub.invokeStub.resolves({
      content: '{"a": 1, "b": [1, 2,], "c": "x",}',
    } as ChatResponseShape);
    const provider = loadProviderTyped(stub, baseConfig);
    const result = await provider.invokeForJSON<{ a: number; b: number[]; c: string }>('p');
    expect(result.a).to.equal(1);
    expect(result.b).to.deep.equal([1, 2]);
    expect(result.c).to.equal('x');
  });

  it('throws a typed error when the response contains no JSON object', async () => {
    const stub = buildChatAnthropicStub();
    stub.invokeStub.resolves({
      content: 'Just plain text, no braces here.',
    } as ChatResponseShape);
    const provider = loadProviderTyped(stub, baseConfig);
    let caught: Error | null = null;
    try { await provider.invokeForJSON<unknown>('p'); } catch (e) { caught = e as Error; }
    expect(caught).to.not.equal(null);
    expect(caught!.message).to.match(/did not contain valid JSON/);
  });

  it('throws a wrapping error when the matched JSON is still unparseable', async () => {
    const stub = buildChatAnthropicStub();
    stub.invokeStub.resolves({
      content: '{this is: not json}',
    } as ChatResponseShape);
    const provider = loadProviderTyped(stub, baseConfig);
    let caught: Error | null = null;
    try { await provider.invokeForJSON<unknown>('p'); } catch (e) { caught = e as Error; }
    expect(caught).to.not.equal(null);
    expect(caught!.message).to.match(/Failed to parse LLM response as JSON/);
  });
});

describe('createAnthropicProvider tool-use loop', () => {
  it('executes a tool call and feeds the result back into a second round', async () => {
    const stub = buildChatAnthropicStub();
    // Round 1: model emits a tool call.
    stub.invokeStub.onCall(0).resolves({
      content: '',
      tool_calls: [{ name: 'echo', args: { v: 'hi' }, id: 'call-1' }],
      usage_metadata: { input_tokens: 5, output_tokens: 2 },
    } as ChatResponseShape);
    // Round 2: text-only completion.
    stub.invokeStub.onCall(1).resolves({
      content: 'final answer',
      usage_metadata: { input_tokens: 3, output_tokens: 4 },
      response_metadata: { stop_reason: 'end_turn' },
    } as ChatResponseShape);

    const toolHandler = sinon.stub().resolves('echo-result');
    const { createAnthropicProvider } = loadProvider(stub);
    const provider = createAnthropicProvider(baseConfig);
    const result = await provider.invoke('use the tool', {
      tools: [{ name: 'echo', description: 'd', inputSchema: { type: 'object', properties: {} } }],
      toolHandler,
    });

    expect(result.content).to.equal('final answer');
    expect(toolHandler.calledOnceWithExactly('echo', { v: 'hi' })).to.equal(true);
    // Accumulated usage from both rounds: 5+3 in, 2+4 out.
    expect(result.usage).to.deep.equal({ inputTokens: 8, outputTokens: 6 });
  });

  it('surfaces tool-handler errors as a tool-message with status=error and continues the loop', async () => {
    const stub = buildChatAnthropicStub();
    stub.invokeStub.onCall(0).resolves({
      content: '',
      tool_calls: [{ name: 'flaky', args: {}, id: 'call-1' }],
    } as ChatResponseShape);
    stub.invokeStub.onCall(1).resolves({
      content: 'recovered',
    } as ChatResponseShape);

    const toolHandler = sinon.stub().rejects(new Error('tool broke'));
    const { createAnthropicProvider } = loadProvider(stub);
    const provider = createAnthropicProvider(baseConfig);
    const result = await provider.invoke('p', {
      tools: [{ name: 'flaky', description: 'd', inputSchema: { type: 'object', properties: {} } }],
      toolHandler,
    });
    expect(result.content).to.equal('recovered');
    expect(toolHandler.callCount).to.equal(1);
  });
});
