import { expect } from 'chai';
import {
  CodeGenModule,
} from '../../../src/layers/code-gen/interface';
import {
  CodeGenModuleRegistry,
  createDefaultCodeGenRegistry,
} from '../../../src/layers/code-gen/registry';
import { LLMProvider, LLMResponse, LLMMessage, InvokeOptions } from '../../../src/llm';

describe('CodeGenModuleRegistry', () => {
  const makeModule = (name: string): CodeGenModule => ({
    name,
    version: '0.0.1',
    async generate() {
      return {
        files: [],
        explanation: 'noop',
      };
    },
  });

  it('should register and retrieve a module by name', () => {
    const registry = new CodeGenModuleRegistry();
    const module = makeModule('custom-module');

    registry.register(module);

    expect(registry.get('custom-module')).to.equal(module);
  });

  it('should return undefined for unregistered module', () => {
    const registry = new CodeGenModuleRegistry();

    expect(registry.get('nonexistent')).to.be.undefined;
  });

  it('should list all registered module names', () => {
    const registry = new CodeGenModuleRegistry();
    registry.register(makeModule('mod-a'));
    registry.register(makeModule('mod-b'));

    expect(registry.list()).to.deep.equal(['mod-a', 'mod-b']);
  });

  it('should resolve anthropic alias to claude-api', () => {
    const registry = createDefaultCodeGenRegistry();

    const active = registry.getActiveModule('anthropic');

    expect(active.name).to.equal('claude-api');
  });

  it('should resolve claude-cli alias to claude-code-cli', () => {
    const registry = new CodeGenModuleRegistry();
    const module = makeModule('claude-code-cli');
    registry.register(module);

    const active = registry.getActiveModule('claude-cli');

    expect(active.name).to.equal('claude-code-cli');
  });

  it('should pass through unknown aliases as-is', () => {
    const registry = new CodeGenModuleRegistry();

    expect(registry.resolveProvider('some-provider')).to.equal('some-provider');
  });

  it('should fall back to CODE_GEN_MODULE env var when no argument given', () => {
    const originalEnv = process.env.CODE_GEN_MODULE;
    try {
      process.env.CODE_GEN_MODULE = 'claude-api';
      const registry = createDefaultCodeGenRegistry();

      const active = registry.getActiveModule();

      expect(active.name).to.equal('claude-api');
    } finally {
      if (originalEnv === undefined) {
        delete process.env.CODE_GEN_MODULE;
      } else {
        process.env.CODE_GEN_MODULE = originalEnv;
      }
    }
  });

  it('should fall back to claude-api when no argument and no env var', () => {
    const originalEnv = process.env.CODE_GEN_MODULE;
    try {
      delete process.env.CODE_GEN_MODULE;
      const registry = createDefaultCodeGenRegistry();

      const active = registry.getActiveModule();

      expect(active.name).to.equal('claude-api');
    } finally {
      if (originalEnv !== undefined) {
        process.env.CODE_GEN_MODULE = originalEnv;
      }
    }
  });

  it('should throw with helpful message for unknown module', () => {
    const registry = createDefaultCodeGenRegistry();

    expect(() => registry.getActiveModule('unknown-provider')).to.throw(
      'No code generation module registered for provider "unknown-provider"'
    );
  });

  it('should include registered module names in error message', () => {
    const registry = new CodeGenModuleRegistry();
    registry.register(makeModule('mod-a'));
    registry.register(makeModule('mod-b'));

    expect(() => registry.getActiveModule('bad')).to.throw('mod-a, mod-b');
  });

  it('should default registry include claude-api module', () => {
    const registry = createDefaultCodeGenRegistry();

    expect(registry.list()).to.include('claude-api');
  });

  it('should pass LLM provider through to module via factory', () => {
    const mockProvider: LLMProvider = {
      providerType: 'anthropic',
      modelName: 'test-model',
      async invoke(): Promise<LLMResponse> {
        return { content: '{}', model: 'test-model' };
      },
      async invokeWithMessages(_messages: LLMMessage[], _options?: InvokeOptions): Promise<LLMResponse> {
        return { content: '{}', model: 'test-model' };
      },
      async invokeForJSON<T>(): Promise<T> {
        return {} as T;
      },
    };

    const registry = createDefaultCodeGenRegistry(mockProvider);

    const module = registry.getActiveModule('claude-api');
    expect(module.name).to.equal('claude-api');
    expect(module.version).to.equal('0.6.0');
  });
});
