import { TestGenModule } from './interface';
import { createClaudeApiTestGenModule } from './modules/claude-api';
import { LLMProvider } from '../../llm';
import { readEnv } from '../../utils/env';

const PROVIDER_ALIAS_MAP: Record<string, string> = {
  anthropic: 'claude-api',
  'claude-cli': 'claude-code-cli',
};

export class TestGenModuleRegistry {
  private readonly modules = new Map<string, TestGenModule>();

  register(module: TestGenModule): void {
    if (this.modules.has(module.name)) {
      throw new Error(
        `Test generation module "${module.name}" is already registered. Use a unique name for each module.`
      );
    }
    this.modules.set(module.name, module);
  }

  get(moduleName: string): TestGenModule | undefined {
    return this.modules.get(moduleName);
  }

  list(): string[] {
    return Array.from(this.modules.keys());
  }

  resolveProvider(provider: string): string {
    return PROVIDER_ALIAS_MAP[provider] || provider;
  }

  getActiveModule(providerFromConfig?: string): TestGenModule {
    const requestedProvider = providerFromConfig || readEnv('TEST_GEN_MODULE') || 'claude-api';
    const moduleName = this.resolveProvider(requestedProvider);
    const module = this.get(moduleName);

    if (!module) {
      const available = this.list();
      throw new Error(
        `No test generation module registered for provider "${requestedProvider}" (resolved to "${moduleName}"). Registered modules: ${available.join(', ') || 'none'}`
      );
    }

    return module;
  }
}

export function createDefaultTestGenRegistry(llmProvider?: LLMProvider): TestGenModuleRegistry {
  const registry = new TestGenModuleRegistry();

  registry.register(createClaudeApiTestGenModule(llmProvider));

  return registry;
}
