import {
  CodeGenModule,
  CodeGenModuleInput,
  CodeGenModuleOutput,
  GeneratedFile,
} from '../../interface';
import { readEnv } from '../../../../utils/env';

export class ClaudeApiCodeGenModule implements CodeGenModule {
  name = 'claude-api';

  version = '0.1.0';

  async generate(input: CodeGenModuleInput): Promise<CodeGenModuleOutput> {
    const targetDir = input.targetDirectory.replace(/\/$/, '');
    const files = this.buildScaffoldFiles(input, targetDir);

    return {
      files,
      explanation:
        `Generated ${files.length} scaffold file(s) for "${input.ticket.issue.title}" ` +
        `targeting the ${input.ticket.issue.technical_context.domain} domain.`,
      modelUsed: readEnv('ANTHROPIC_MODEL') || 'claude-sonnet-4-20250514',
    };
  }

  async validate(): Promise<boolean> {
    return Boolean(readEnv('ANTHROPIC_API_KEY'));
  }

  private buildScaffoldFiles(input: CodeGenModuleInput, targetDir: string): GeneratedFile[] {
    const files: GeneratedFile[] = [];
    const { ticket, orchestrationPlan } = input;
    const domain = ticket.issue.technical_context.domain;
    const components = ticket.issue.technical_context.components;

    for (const phase of orchestrationPlan.phases) {
      for (const component of phase.suggestedComponents) {
        const file = this.buildComponentFile(component, ticket.issue.title, domain, targetDir);
        if (file) {
          files.push(file);
        }
      }
    }

    // If no phases produced files, generate one from the first listed component
    if (files.length === 0 && components.length > 0) {
      const file = this.buildComponentFile(components[0], ticket.issue.title, domain, targetDir);
      if (file) {
        files.push(file);
      }
    }

    return files;
  }

  private buildComponentFile(
    component: string,
    title: string,
    domain: string,
    targetDir: string
  ): GeneratedFile | null {
    const moduleName = this.extractModuleName(component);
    if (!moduleName) {
      return null;
    }

    const isWebapp = component.includes('webapp');
    const isApi = component.includes('api');

    if (isWebapp) {
      return this.buildWebappServiceFile(moduleName, title, domain, targetDir);
    }

    if (isApi) {
      return this.buildApiControllerFile(moduleName, title, domain, targetDir);
    }

    return this.buildGenericServiceFile(moduleName, title, domain, targetDir);
  }

  private buildWebappServiceFile(
    moduleName: string,
    title: string,
    domain: string,
    targetDir: string
  ): GeneratedFile {
    const className = this.toPascalCase(moduleName) + 'Service';
    const content = [
      `import { Injectable } from '@angular/core';`,
      ``,
      `/**`,
      ` * ${title}`,
      ` * Domain: ${domain}`,
      ` */`,
      `@Injectable({ providedIn: 'root' })`,
      `export class ${className} {`,
      `  constructor() {}`,
      ``,
      `  async execute(): Promise<void> {`,
      `    // TODO: implement`,
      `  }`,
      `}`,
      ``,
    ].join('\n');

    return {
      path: `${targetDir}/webapp/src/ts/services/${moduleName}.service.ts`,
      content,
      purpose: `Angular service scaffold for ${title}`,
    };
  }

  private buildApiControllerFile(
    moduleName: string,
    title: string,
    domain: string,
    targetDir: string
  ): GeneratedFile {
    const content = [
      `/**`,
      ` * ${title}`,
      ` * Domain: ${domain}`,
      ` */`,
      ``,
      `module.exports = {`,
      `  async get(req, res) {`,
      `    // TODO: implement`,
      `    res.json({ ok: true });`,
      `  },`,
      `};`,
      ``,
    ].join('\n');

    return {
      path: `${targetDir}/api/src/controllers/${moduleName}.js`,
      content,
      purpose: `API controller scaffold for ${title}`,
    };
  }

  private buildGenericServiceFile(
    moduleName: string,
    title: string,
    domain: string,
    targetDir: string
  ): GeneratedFile {
    const content = [
      `/**`,
      ` * ${title}`,
      ` * Domain: ${domain}`,
      ` */`,
      ``,
      `module.exports = {`,
      `  async execute() {`,
      `    // TODO: implement`,
      `    return { ok: true };`,
      `  },`,
      `};`,
      ``,
    ].join('\n');

    return {
      path: `${targetDir}/src/services/${moduleName}.js`,
      content,
      purpose: `Service scaffold for ${title}`,
    };
  }

  private extractModuleName(component: string): string | null {
    const parts = component.split('/');
    const last = parts[parts.length - 1];
    if (!last || last.length === 0) {
      return null;
    }
    return last.replace(/\s+/g, '-').toLowerCase();
  }

  private toPascalCase(str: string): string {
    return str
      .split('-')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join('');
  }
}

export const claudeApiCodeGenModule = new ClaudeApiCodeGenModule();
