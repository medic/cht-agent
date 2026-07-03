import { CodeGenModule } from './interface';
import { createClaudeApiCodeGenModule } from './modules/claude-api';
import { createClaudeCodeCLICodeGenModule } from './modules/claude-code-cli';
import { createOpenCodeCodeGenModule } from './modules/opencode';
import { readEnv } from '../../utils/env';

const PROVIDER_ALIAS_MAP: Record<string, string> = {
  anthropic: 'claude-api',
  'claude-cli': 'claude-code-cli',
};

export class CodeGenModuleRegistry {
  private readonly modules = new Map<string, CodeGenModule>();

  register(module: CodeGenModule): void {
    if (this.modules.has(module.name)) {
      throw new Error(
        `Code generation module "${module.name}" is already registered. Use a unique name for each module.`
      );
    }
    this.modules.set(module.name, module);
  }

  get(moduleName: string): CodeGenModule | undefined {
    return this.modules.get(moduleName);
  }

  list(): string[] {
    return Array.from(this.modules.keys());
  }

  resolveProvider(provider: string): string {
    return PROVIDER_ALIAS_MAP[provider] || provider;
  }

  /**
   * Registry-integrity check (H1, #63): every PROVIDER_ALIAS_MAP target must be
   * a registered module. A silent strand — an alias whose target was renamed or
   * never registered — is the historical failure: on main only `claude-api` was
   * registered, so the `claude-cli` alias pointed at an unregistered
   * `claude-code-cli` and only blew up on the first request that happened to use
   * it. Validating up front makes that class of bug impossible to hit silently:
   * a future rename throws here (at registry construction) instead.
   *
   * Throws an Error naming each stranded alias, its target, and the registered
   * modules. No-op when every alias target is registered.
   */
  validateAliases(): void {
    const registered = this.list();
    const stranded = Object.entries(PROVIDER_ALIAS_MAP)
      .filter(([, target]) => !this.modules.has(target))
      .map(([alias, target]) => `"${alias}" -> "${target}"`);
    if (stranded.length > 0) {
      throw new Error(
        `Code generation registry has stranded provider alias(es): ${stranded.join(', ')}. ` +
          `Each alias target must resolve to a registered module. Registered modules: ${registered.join(', ') || 'none'}`
      );
    }
  }

  getActiveModule(providerFromConfig?: string): CodeGenModule {
    const requestedProvider = providerFromConfig || readEnv('CODE_GEN_MODULE') || 'claude-code-cli';
    const moduleName = this.resolveProvider(requestedProvider);
    const module = this.get(moduleName);

    if (!module) {
      const available = this.list();
      throw new Error(
        `No code generation module registered for provider "${requestedProvider}" (resolved to "${moduleName}"). Registered modules: ${available.join(', ') || 'none'}`
      );
    }

    return module;
  }
}

export function createDefaultCodeGenRegistry(): CodeGenModuleRegistry {
  const registry = new CodeGenModuleRegistry();

  registry.register(createClaudeApiCodeGenModule());
  registry.register(createClaudeCodeCLICodeGenModule());
  registry.register(createOpenCodeCodeGenModule());

  // H1 (#63): fail loudly at construction if any alias target is unregistered,
  // so a future module rename can't silently strand an alias until the first
  // request that uses it.
  registry.validateAliases();

  return registry;
}
