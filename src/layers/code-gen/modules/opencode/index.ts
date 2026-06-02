import { CodeGenModule, CodeGenModuleInput, CodeGenModuleOutput } from '../../interface';

export class OpenCodeCodeGenModule implements CodeGenModule {
  name = 'opencode';

  version = '0.0.0';

  async generate(_input: CodeGenModuleInput): Promise<CodeGenModuleOutput> {
    throw new Error('opencode module is not yet implemented.');
  }

  async validate(): Promise<boolean> {
    return false;
  }
}

export function createOpenCodeCodeGenModule(): OpenCodeCodeGenModule {
  return new OpenCodeCodeGenModule();
}
