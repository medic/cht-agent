/* eslint-disable @typescript-eslint/no-var-requires */
import { expect } from 'chai';
import sinon from 'sinon';

const proxyquire = require('proxyquire').noCallThru();

/**
 * The factory exports env-driven config readers + a dispatch function over the
 * discriminated LLMConfig union. Tests here exercise (a) the env-reader paths
 * and (b) the dispatch behavior — the latter via proxyquire so we never
 * actually construct a real Anthropic SDK client or spawn the CLI.
 */
const loadFactory = (overrides: {
  anthropic?: unknown;
  cli?: unknown;
} = {}) => {
  const stubs: Record<string, unknown> = {};
  if (overrides.anthropic) stubs['./providers/anthropic'] = overrides.anthropic;
  if (overrides.cli) stubs['./providers/claude-cli'] = overrides.cli;
  return proxyquire('../../src/llm/factory', stubs);
};

const ENV_KEYS = [
  'LLM_PROVIDER',
  'LLM_MODEL',
  'LLM_TEMPERATURE',
  'LLM_MAX_TOKENS',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'GEMINI_API_KEY',
  'CLAUDE_CLI_PATH',
  'CLAUDE_CLI_TIMEOUT',
  'CLAUDE_CLI_MAX_TURNS',
  'CLAUDE_CLI_SKIP_PERMISSIONS',
  'CHT_CORE_PATH',
] as const;

const snapshotEnv = (): Map<string, string | undefined> => {
  const snap = new Map<string, string | undefined>();
  for (const k of ENV_KEYS) snap.set(k, process.env[k]);
  return snap;
};

const restoreEnv = (snap: Map<string, string | undefined>): void => {
  for (const [k, v] of snap) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
};

describe('llm/factory env-driven config readers', () => {
  let envSnapshot: Map<string, string | undefined>;

  beforeEach(() => {
    envSnapshot = snapshotEnv();
    // Clear all relevant env vars by default so each test sets only what it needs.
    for (const k of ENV_KEYS) delete process.env[k];
  });

  afterEach(() => restoreEnv(envSnapshot));

  describe('isUsingCLIProvider', () => {
    it('returns true when LLM_PROVIDER=claude-cli', () => {
      process.env.LLM_PROVIDER = 'claude-cli';
      const { isUsingCLIProvider } = loadFactory();
      expect(isUsingCLIProvider()).to.equal(true);
    });

    it('returns false when LLM_PROVIDER is anthropic / openai / unset', () => {
      const { isUsingCLIProvider } = loadFactory();
      process.env.LLM_PROVIDER = 'anthropic';
      expect(isUsingCLIProvider()).to.equal(false);
      process.env.LLM_PROVIDER = 'openai';
      expect(isUsingCLIProvider()).to.equal(false);
      delete process.env.LLM_PROVIDER;
      expect(isUsingCLIProvider()).to.equal(false);
    });
  });

  describe('getAPIConfigFromEnv', () => {
    it('returns the anthropic config when ANTHROPIC_API_KEY is set and LLM_PROVIDER defaults', () => {
      process.env.ANTHROPIC_API_KEY = 'sk-test';
      const { getAPIConfigFromEnv } = loadFactory();
      const config = getAPIConfigFromEnv();
      expect(config.mode).to.equal('api');
      expect(config.provider).to.equal('anthropic');
      expect(config.apiKey).to.equal('sk-test');
      // No LLM_MODEL set → falls back to DEFAULT_MODELS.anthropic
      expect(config.model).to.equal('claude-opus-4-6');
    });

    it('reads OPENAI_API_KEY when LLM_PROVIDER=openai', () => {
      process.env.LLM_PROVIDER = 'openai';
      process.env.OPENAI_API_KEY = 'sk-openai';
      const { getAPIConfigFromEnv } = loadFactory();
      const config = getAPIConfigFromEnv();
      expect(config.provider).to.equal('openai');
      expect(config.apiKey).to.equal('sk-openai');
      expect(config.model).to.equal('gpt-4-turbo-preview');
    });

    it('reads GEMINI_API_KEY when LLM_PROVIDER=gemini', () => {
      process.env.LLM_PROVIDER = 'gemini';
      process.env.GEMINI_API_KEY = 'sk-gem';
      const { getAPIConfigFromEnv } = loadFactory();
      const config = getAPIConfigFromEnv();
      expect(config.provider).to.equal('gemini');
      expect(config.apiKey).to.equal('sk-gem');
    });

    it('throws "API key not found" when the matching env var is missing', () => {
      process.env.LLM_PROVIDER = 'anthropic';
      // ANTHROPIC_API_KEY cleared in beforeEach.
      const { getAPIConfigFromEnv } = loadFactory();
      expect(() => getAPIConfigFromEnv()).to.throw(/API key not found/);
    });

    it('throws "Unsupported LLM provider" for an unknown LLM_PROVIDER value', () => {
      process.env.LLM_PROVIDER = 'mistral';
      const { getAPIConfigFromEnv } = loadFactory();
      expect(() => getAPIConfigFromEnv()).to.throw(/Unsupported LLM provider/);
    });

    it('throws a "not applicable in CLI mode" error when LLM_PROVIDER=claude-cli', () => {
      process.env.LLM_PROVIDER = 'claude-cli';
      const { getAPIConfigFromEnv } = loadFactory();
      expect(() => getAPIConfigFromEnv()).to.throw(/not applicable in CLI mode/);
    });

    it('respects LLM_MODEL override over the provider default', () => {
      process.env.ANTHROPIC_API_KEY = 'sk-test';
      process.env.LLM_MODEL = 'claude-haiku-4-5';
      const { getAPIConfigFromEnv } = loadFactory();
      expect(getAPIConfigFromEnv().model).to.equal('claude-haiku-4-5');
    });

    it('parses LLM_TEMPERATURE and LLM_MAX_TOKENS when set', () => {
      process.env.ANTHROPIC_API_KEY = 'sk-test';
      process.env.LLM_TEMPERATURE = '0.7';
      process.env.LLM_MAX_TOKENS = '4096';
      const { getAPIConfigFromEnv } = loadFactory();
      const config = getAPIConfigFromEnv();
      expect(config.temperature).to.equal(0.7);
      expect(config.maxTokens).to.equal(4096);
    });

    it('leaves temperature and maxTokens undefined when env vars are unset (lets the provider apply its defaults)', () => {
      process.env.ANTHROPIC_API_KEY = 'sk-test';
      const { getAPIConfigFromEnv } = loadFactory();
      const config = getAPIConfigFromEnv();
      expect(config.temperature).to.equal(undefined);
      expect(config.maxTokens).to.equal(undefined);
    });
  });

  describe('getCLIConfigFromEnv', () => {
    it('returns sensible defaults when no CLI env vars are set', () => {
      const { getCLIConfigFromEnv } = loadFactory();
      const config = getCLIConfigFromEnv();
      expect(config.mode).to.equal('cli');
      expect(config.provider).to.equal('claude-cli');
      expect(config.executablePath).to.equal('claude');
      expect(config.timeout).to.equal(600000);
      expect(config.maxTurns).to.equal(20);
      expect(config.skipPermissions).to.equal(true);
    });

    it('honors CLAUDE_CLI_PATH override', () => {
      process.env.CLAUDE_CLI_PATH = '/opt/claude/claude';
      const { getCLIConfigFromEnv } = loadFactory();
      expect(getCLIConfigFromEnv().executablePath).to.equal('/opt/claude/claude');
    });

    it('honors CHT_CORE_PATH for workingDirectory and falls back to cwd otherwise', () => {
      process.env.CHT_CORE_PATH = '/tmp/cht-core';
      const { getCLIConfigFromEnv } = loadFactory();
      expect(getCLIConfigFromEnv().workingDirectory).to.equal('/tmp/cht-core');

      delete process.env.CHT_CORE_PATH;
      const cwdConfig = getCLIConfigFromEnv();
      expect(cwdConfig.workingDirectory).to.equal(process.cwd());
    });

    it('parses CLAUDE_CLI_TIMEOUT and CLAUDE_CLI_MAX_TURNS', () => {
      process.env.CLAUDE_CLI_TIMEOUT = '120000';
      process.env.CLAUDE_CLI_MAX_TURNS = '50';
      const { getCLIConfigFromEnv } = loadFactory();
      const config = getCLIConfigFromEnv();
      expect(config.timeout).to.equal(120000);
      expect(config.maxTurns).to.equal(50);
    });

    it('disables skipPermissions only when CLAUDE_CLI_SKIP_PERMISSIONS is the literal string "false"', () => {
      process.env.CLAUDE_CLI_SKIP_PERMISSIONS = 'false';
      const { getCLIConfigFromEnv } = loadFactory();
      expect(getCLIConfigFromEnv().skipPermissions).to.equal(false);

      process.env.CLAUDE_CLI_SKIP_PERMISSIONS = 'true';
      expect(getCLIConfigFromEnv().skipPermissions).to.equal(true);

      delete process.env.CLAUDE_CLI_SKIP_PERMISSIONS;
      expect(getCLIConfigFromEnv().skipPermissions).to.equal(true);
    });
  });

  describe('getLLMConfigFromEnv', () => {
    it('returns the CLI config when LLM_PROVIDER=claude-cli', () => {
      process.env.LLM_PROVIDER = 'claude-cli';
      const { getLLMConfigFromEnv } = loadFactory();
      expect(getLLMConfigFromEnv().mode).to.equal('cli');
    });

    it('returns the API config when LLM_PROVIDER is unset', () => {
      process.env.ANTHROPIC_API_KEY = 'sk-test';
      const { getLLMConfigFromEnv } = loadFactory();
      expect(getLLMConfigFromEnv().mode).to.equal('api');
    });
  });
});

describe('llm/factory createLLMProvider dispatch', () => {
  let envSnapshot: Map<string, string | undefined>;

  beforeEach(() => {
    envSnapshot = snapshotEnv();
    for (const k of ENV_KEYS) delete process.env[k];
  });

  afterEach(() => restoreEnv(envSnapshot));

  it('dispatches to createAnthropicProvider for mode=api provider=anthropic', () => {
    const anthropicStub = sinon.stub().returns({ providerType: 'anthropic', modelName: 'm' });
    const cliStub = sinon.stub();
    const { createLLMProvider } = loadFactory({
      anthropic: { createAnthropicProvider: anthropicStub },
      cli: { createClaudeCLIProvider: cliStub },
    });
    createLLMProvider({
      mode: 'api',
      provider: 'anthropic',
      apiKey: 'sk-test',
      model: 'claude-opus-4-6',
    });
    expect(anthropicStub.calledOnce).to.equal(true);
    expect(anthropicStub.firstCall.args[0]).to.deep.include({
      provider: 'anthropic',
      apiKey: 'sk-test',
    });
    expect(cliStub.called).to.equal(false);
  });

  it('dispatches to createClaudeCLIProvider for mode=cli', () => {
    const anthropicStub = sinon.stub();
    const cliStub = sinon.stub().returns({ providerType: 'anthropic', modelName: 'claude-cli' });
    const { createLLMProvider } = loadFactory({
      anthropic: { createAnthropicProvider: anthropicStub },
      cli: { createClaudeCLIProvider: cliStub },
    });
    createLLMProvider({
      mode: 'cli',
      provider: 'claude-cli',
      executablePath: 'claude',
      workingDirectory: '/tmp',
      timeout: 600000,
      maxTurns: 20,
      model: 'claude-cli',
    });
    expect(cliStub.calledOnce).to.equal(true);
    expect(cliStub.firstCall.args[0]).to.deep.include({
      provider: 'claude-cli',
      executablePath: 'claude',
    });
    expect(anthropicStub.called).to.equal(false);
  });

  it('throws "OpenAI provider not yet implemented" for mode=api provider=openai', () => {
    const { createLLMProvider } = loadFactory();
    expect(() => createLLMProvider({
      mode: 'api',
      provider: 'openai',
      apiKey: 'sk-test',
      model: 'gpt-4-turbo-preview',
    })).to.throw(/OpenAI provider not yet implemented/);
  });

  it('throws "Gemini provider not yet implemented" for mode=api provider=gemini', () => {
    const { createLLMProvider } = loadFactory();
    expect(() => createLLMProvider({
      mode: 'api',
      provider: 'gemini',
      apiKey: 'sk-test',
      model: 'gemini-pro',
    })).to.throw(/Gemini provider not yet implemented/);
  });
});

describe('llm/factory env-driven entry points', () => {
  let envSnapshot: Map<string, string | undefined>;

  beforeEach(() => {
    envSnapshot = snapshotEnv();
    for (const k of ENV_KEYS) delete process.env[k];
  });

  afterEach(() => restoreEnv(envSnapshot));

  it('createLLMProviderFromEnv routes to the CLI builder when LLM_PROVIDER=claude-cli', () => {
    process.env.LLM_PROVIDER = 'claude-cli';
    const cliReturn = { providerType: 'anthropic', modelName: 'claude-cli' } as const;
    const cliStub = sinon.stub().returns(cliReturn);
    const { createLLMProviderFromEnv } = loadFactory({
      cli: { createClaudeCLIProvider: cliStub },
      anthropic: { createAnthropicProvider: sinon.stub() },
    });
    const result = createLLMProviderFromEnv();
    expect(result).to.equal(cliReturn);
    expect(cliStub.calledOnce).to.equal(true);
    expect(cliStub.firstCall.args[0].mode).to.equal('cli');
  });

  it('createLLMProviderFromEnv routes to the Anthropic builder by default with the API key', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    const anthropicReturn = { providerType: 'anthropic', modelName: 'claude-opus-4-6' } as const;
    const anthropicStub = sinon.stub().returns(anthropicReturn);
    const { createLLMProviderFromEnv } = loadFactory({
      anthropic: { createAnthropicProvider: anthropicStub },
      cli: { createClaudeCLIProvider: sinon.stub() },
    });
    const result = createLLMProviderFromEnv();
    expect(result).to.equal(anthropicReturn);
    expect(anthropicStub.firstCall.args[0].apiKey).to.equal('sk-test');
  });

  it('createLLMProviderWithOptions overrides env config with the provided options', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-env';
    const anthropicStub = sinon.stub().returns({ providerType: 'anthropic', modelName: 'm' });
    const { createLLMProviderWithOptions } = loadFactory({
      anthropic: { createAnthropicProvider: anthropicStub },
      cli: { createClaudeCLIProvider: sinon.stub() },
    });
    createLLMProviderWithOptions({ model: 'claude-haiku-4-5', apiKey: 'sk-override' });
    expect(anthropicStub.firstCall.args[0]).to.deep.include({
      model: 'claude-haiku-4-5',
      apiKey: 'sk-override',
    });
  });

  it('createLLMProviderWithOptions throws when LLM_PROVIDER=claude-cli (CLI mode is not supported by this path)', () => {
    process.env.LLM_PROVIDER = 'claude-cli';
    const { createLLMProviderWithOptions } = loadFactory();
    expect(() => createLLMProviderWithOptions()).to.throw(/not applicable in CLI mode/);
  });
});
