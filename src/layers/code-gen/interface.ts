import { IssueTemplate, OrchestrationPlan, ResearchFindings } from '../../types';

export interface ContextFile {
  path: string;
  content: string;
  source?: 'agent-memory' | 'workspace' | 'external';
  metadata?: Record<string, string | number | boolean | string[] | number[]>;
}

export interface GeneratedFile {
  path: string;
  content: string;
  purpose?: string;
}

export interface CodeGenModuleInput {
  ticket: IssueTemplate;
  researchFindings: ResearchFindings;
  contextFiles: ContextFile[];
  orchestrationPlan: OrchestrationPlan;
  targetDirectory: string;
  readFile?: (path: string) => Promise<string | null>;
  listDirectory?: (dirPath: string) => Promise<string[]>;
  directoryListing?: string;
}

export interface CodeGenModuleOutput {
  files: GeneratedFile[];
  explanation: string;
  tokensUsed?: number;
  modelUsed?: string;
}

export interface CodeGenModule {
  name: string;
  version: string;
  generate(input: CodeGenModuleInput): Promise<CodeGenModuleOutput>;
  validate?(): Promise<boolean>;
}
