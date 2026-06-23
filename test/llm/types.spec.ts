import { expect } from 'chai';
import {
  capMaxTokens,
  DEFAULT_CONFIG,
  getConfiguredModel,
  getMaxOutputTokens,
  MODEL_MAX_OUTPUT_TOKENS,
} from '../../src/llm/types';

describe('getMaxOutputTokens', () => {
  it('returns the documented Opus 4.6 limit of 128000', () => {
    expect(getMaxOutputTokens('claude-opus-4-6')).to.equal(128000);
  });

  it('returns 64000 for Sonnet 4.6 (matches the runtime cap behavior)', () => {
    expect(getMaxOutputTokens('claude-sonnet-4-6')).to.equal(64000);
  });

  it('returns 32000 for the older Opus 4.1 family', () => {
    expect(getMaxOutputTokens('claude-opus-4-1')).to.equal(32000);
    expect(getMaxOutputTokens('claude-opus-4-1-20250805')).to.equal(32000);
  });

  it('falls back to DEFAULT_CONFIG.maxTokens for an unknown model id', () => {
    expect(getMaxOutputTokens('totally-made-up-model')).to.equal(DEFAULT_CONFIG.maxTokens);
  });

  it('covers every key in MODEL_MAX_OUTPUT_TOKENS without throwing', () => {
    // Sanity guard: the table is exposed publicly, so iterating it should
    // never throw and every value should be a positive integer.
    for (const [model, expected] of Object.entries(MODEL_MAX_OUTPUT_TOKENS)) {
      const actual = getMaxOutputTokens(model);
      expect(actual).to.equal(expected);
      expect(actual).to.be.greaterThan(0);
    }
  });
});

describe('capMaxTokens', () => {
  it('returns the requested value when it is below the model limit', () => {
    // Opus 4.6 supports 128000; requesting 10000 should pass through.
    expect(capMaxTokens('claude-opus-4-6', 10000)).to.equal(10000);
  });

  it('clamps to the model limit when the request exceeds it', () => {
    // Sonnet 4.6 caps at 64000; a 200000-token request should clamp to 64000.
    expect(capMaxTokens('claude-sonnet-4-6', 200000)).to.equal(64000);
  });

  it('returns the request value when it equals the model limit exactly', () => {
    expect(capMaxTokens('claude-opus-4-1', 32000)).to.equal(32000);
  });

  it('uses the default fallback limit when the model id is unknown', () => {
    // Unknown model gets DEFAULT_CONFIG.maxTokens as its limit; requesting
    // more than that clamps to the default.
    const requested = DEFAULT_CONFIG.maxTokens + 100000;
    expect(capMaxTokens('made-up-model', requested)).to.equal(DEFAULT_CONFIG.maxTokens);
  });
});

describe('getConfiguredModel', () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env.LLM_MODEL;
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.LLM_MODEL;
    else process.env.LLM_MODEL = originalEnv;
  });

  it('returns the anthropic default when LLM_MODEL is unset and no provider is passed', () => {
    delete process.env.LLM_MODEL;
    expect(getConfiguredModel()).to.equal('claude-opus-4-6');
  });

  it('returns the provider-specific default when LLM_MODEL is unset and an explicit provider is passed', () => {
    delete process.env.LLM_MODEL;
    expect(getConfiguredModel('openai')).to.equal('gpt-4-turbo-preview');
    expect(getConfiguredModel('gemini')).to.equal('gemini-pro');
  });

  it('returns the env value when LLM_MODEL is set to a non-empty string', () => {
    process.env.LLM_MODEL = 'claude-haiku-4-5';
    expect(getConfiguredModel()).to.equal('claude-haiku-4-5');
  });

  it('trims surrounding whitespace from the env value', () => {
    process.env.LLM_MODEL = '  claude-sonnet-4-6  ';
    expect(getConfiguredModel()).to.equal('claude-sonnet-4-6');
  });

  it('falls back to the provider default when LLM_MODEL is empty or whitespace-only', () => {
    process.env.LLM_MODEL = '   ';
    expect(getConfiguredModel('anthropic')).to.equal('claude-opus-4-6');
  });

  it('lets the env value override the provider default (env wins over arg)', () => {
    process.env.LLM_MODEL = 'gpt-5-experimental';
    // Even though provider=anthropic suggests claude-opus-4-6, the env wins.
    expect(getConfiguredModel('anthropic')).to.equal('gpt-5-experimental');
  });
});
