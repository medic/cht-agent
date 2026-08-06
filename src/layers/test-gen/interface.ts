import { IssueTemplate, OrchestrationPlan, ResearchFindings, GeneratedFile } from '../../types';
import { ContextFile, GeneratedFile as LayerGeneratedFile } from '../code-gen/interface';

export type TestType = 'unit' | 'integration' | 'e2e';

export interface TestScenario {
  requirement: string;
  scenarios: Array<{
    name: string;
    type: 'happy-path' | 'error' | 'edge-case' | 'boundary';
    description: string;
  }>;
}

export interface TestGenModuleInput {
  ticket: IssueTemplate;
  researchFindings: ResearchFindings;
  orchestrationPlan: OrchestrationPlan;
  generatedCode: GeneratedFile[];
  contextFiles: ContextFile[];
  testTypes: TestType[];
  targetDirectory: string;
  readFile?: (path: string) => Promise<string | null>;
  listDirectory?: (dirPath: string) => Promise<string[]>;
  /**
   * NOTE: neither `directoryListing` nor `existingTestExamples` is populated by
   * `buildTestGenModuleInput` — verified: nothing in src/ assigns them, so the
   * planner ran blind against a repo that already held ~94 specs. The module now
   * gathers its own inventory in `generate()` via the `listDirectory`/`readFile`
   * closures below (see layers/test-gen/lib/spec-inventory.ts). These two fields
   * remain honored when a caller does set them.
   */
  directoryListing?: string;
  /** Existing test patterns from the target codebase for style matching */
  existingTestExamples?: Array<{ path: string; content: string }>;
  /** Feedback from a previous iteration for refinement */
  additionalContext?: string;
}

export interface TestGenModuleOutput {
  files: LayerGeneratedFile[];
  explanation: string;
  tokensUsed?: number;
  modelUsed?: string;
  requirementsChecklist: TestScenario[];
  warnings?: string[];
}

export interface TestGenModule {
  name: string;
  version: string;
  generate(input: TestGenModuleInput): Promise<TestGenModuleOutput>;
  validate?(): Promise<boolean>;
}
