import { CodeGenModule } from './interface';
import { claudeApiCodeGenModule } from './modules/claude-api';
import { readEnv } from '../../utils/env';

const PROVIDER_ALIAS_MAP: Record<string, string> = {
  anthropic: 'claude-api',
  'claude-cli': 'claude-code-cli',
};

export class CodeGenModuleRegistry {
  private readonly modules = new Map<string, CodeGenModule>();

  register(module: CodeGenModule): void {
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

  getActiveModule(providerFromConfig?: string): CodeGenModule {
    const requestedProvider = providerFromConfig || readEnv('LLM_PROVIDER') || 'claude-api';
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

  registry.register(claudeApiCodeGenModule);

  return registry;
}
