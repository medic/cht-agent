import { expect } from 'chai';
import {
  CodeGenModule,
} from '../../../src/layers/code-gen/interface';
import {
  CodeGenModuleRegistry,
  createDefaultCodeGenRegistry,
} from '../../../src/layers/code-gen/registry';

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

  // Preserved from the integration base (register()'s duplicate-name guard;
  // S dropped the guard, but the merged registry keeps it).
  it('should throw when registering a module with a duplicate name', () => {
    const registry = new CodeGenModuleRegistry();
    registry.register(makeModule('mod-a'));

    expect(() => registry.register(makeModule('mod-a'))).to.throw(
      'Code generation module "mod-a" is already registered'
    );
  });

  it('should resolve anthropic alias to claude-api', () => {
    const registry = createDefaultCodeGenRegistry();

    const active = registry.getActiveModule('anthropic');

    expect(active.name).to.equal('claude-api');
  });

  it('should resolve claude-cli alias to claude-code-cli via default registry', () => {
    const registry = createDefaultCodeGenRegistry();

    const active = registry.getActiveModule('claude-cli');

    expect(active.name).to.equal('claude-code-cli');
    // claude-code-cli is now a real module (v5 A.2); we no longer assert it throws "not yet implemented".
    // The presence + correct name resolution is the production-meaningful part of the alias contract.
  });

  it('should register claude-code-cli stub in default registry', () => {
    const registry = createDefaultCodeGenRegistry();

    expect(registry.list()).to.include('claude-code-cli');
  });

  it('should register opencode stub in default registry', () => {
    const registry = createDefaultCodeGenRegistry();

    expect(registry.list()).to.include('opencode');
  });

  it('should throw a clear error when claude-code-cli generate is called without targetDirectory', async () => {
    const registry = createDefaultCodeGenRegistry();
    const module = registry.getActiveModule('claude-code-cli');
    let threw = false;
    try {
      await module.generate({} as never);
    } catch (err) {
      threw = true;
      // The real module (v5 A.2) requires targetDirectory; bare empty input should fail fast.
      expect((err as Error).message).to.match(/targetDirectory|cht-core/i);
    }
    expect(threw).to.equal(true);
  });

  it('should throw a not-yet-implemented error when generate is called on opencode stub', async () => {
    const registry = createDefaultCodeGenRegistry();
    const module = registry.getActiveModule('opencode');
    let threw = false;
    try {
      await module.generate({} as never);
    } catch (err) {
      threw = true;
      expect((err as Error).message).to.match(/not yet implemented/);
    }
    expect(threw).to.equal(true);
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

  it('should fall back to claude-code-cli when no argument and no env var (v6 G.1)', () => {
    const originalEnv = process.env.CODE_GEN_MODULE;
    try {
      delete process.env.CODE_GEN_MODULE;
      const registry = createDefaultCodeGenRegistry();

      const active = registry.getActiveModule();

      expect(active.name).to.equal('claude-code-cli');
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

  it('should construct claude-api without an LLM pass-through (v6 A.2)', () => {
    // v6 A.2 dropped the LLMProvider parameter from createDefaultCodeGenRegistry.
    // The agent no longer pipes its own LLM into claude-api; claude-api now lazily
    // builds its own Anthropic provider at generate() time. This test pins the
    // factory's no-arg signature so a future regression that re-adds the parameter
    // fails here.
    const registry = createDefaultCodeGenRegistry();
    const module = registry.getActiveModule('claude-api');
    expect(module.name).to.equal('claude-api');
    expect(module.version).to.equal('0.6.0');
  });

  // ── H1 (#63): registry resolution guarantees ──────────────────────────────

  it('should resolve the claude-cli alias to claude-code-cli via CODE_GEN_MODULE env (H1)', () => {
    const originalEnv = process.env.CODE_GEN_MODULE;
    try {
      process.env.CODE_GEN_MODULE = 'claude-cli';
      const registry = createDefaultCodeGenRegistry();

      const active = registry.getActiveModule();

      expect(active.name).to.equal('claude-code-cli');
    } finally {
      if (originalEnv === undefined) {
        delete process.env.CODE_GEN_MODULE;
      } else {
        process.env.CODE_GEN_MODULE = originalEnv;
      }
    }
  });

  it('should resolve the claude-cli alias to claude-code-cli via providerFromConfig (H1)', () => {
    const registry = createDefaultCodeGenRegistry();

    const active = registry.getActiveModule('claude-cli');

    expect(active.name).to.equal('claude-code-cli');
  });

  it('should name the requested provider, resolved name, and registered list on an unknown provider (H1)', () => {
    const registry = createDefaultCodeGenRegistry();

    // An unaliased unknown provider resolves to itself; the error names both.
    expect(() => registry.getActiveModule('gpt-9')).to.throw(/provider "gpt-9"/);
    expect(() => registry.getActiveModule('gpt-9')).to.throw(/resolved to "gpt-9"/);
    expect(() => registry.getActiveModule('gpt-9')).to.throw(/claude-api/);
    expect(() => registry.getActiveModule('gpt-9')).to.throw(/claude-code-cli/);
  });

  it('should report the resolved alias target when an aliased provider is unregistered (H1)', () => {
    // A registry that registers claude-api but NOT claude-code-cli: requesting
    // the claude-cli alias resolves to the unregistered target, and the error
    // must surface both the requested alias and what it resolved to.
    const registry = new CodeGenModuleRegistry();
    registry.register(makeModule('claude-api'));

    expect(() => registry.getActiveModule('claude-cli')).to.throw(
      /provider "claude-cli" \(resolved to "claude-code-cli"\)/
    );
  });

  it('validateAliases is a no-op on the default registry — every alias target is registered (H1)', () => {
    const registry = createDefaultCodeGenRegistry();

    expect(() => registry.validateAliases()).to.not.throw();
  });

  it('validateAliases reports a stranded alias when its target is not registered (H1)', () => {
    // Historical failure shape: only claude-api registered, so the claude-cli
    // alias -> claude-code-cli is stranded. The integrity path must flag it.
    const registry = new CodeGenModuleRegistry();
    registry.register(makeModule('claude-api'));

    expect(() => registry.validateAliases()).to.throw(/stranded provider alias/);
    expect(() => registry.validateAliases()).to.throw(/"claude-cli" -> "claude-code-cli"/);
    // claude-api is registered, so its alias is NOT reported as stranded.
    expect(() => registry.validateAliases()).to.not.throw(/"anthropic"/);
  });

  it('createDefaultCodeGenRegistry runs the integrity check without throwing (H1)', () => {
    // The production path validates its aliases at construction; a future module
    // rename that strands an alias would make this throw.
    expect(() => createDefaultCodeGenRegistry()).to.not.throw();
  });
});
