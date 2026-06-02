import {
  IssueTemplate,
  OrchestrationPlan,
  ResearchFindings,
  CodeGenerationResult,
} from '../types';
import { TestGenModuleInput, TestType } from '../layers/test-gen/interface';
import { ContextFile } from '../layers/code-gen/interface';
import { readFromChtCore, listChtCoreDirectory } from '../utils/staging';

/**
 * Focused agent-level input for building a TestGenModuleInput. Carries only what
 * the Development Supervisor has on hand once code generation has completed.
 */
export interface TestGenerationInput {
  issue: IssueTemplate;
  researchFindings: ResearchFindings;
  orchestrationPlan: OrchestrationPlan;
  /** Generated source files; their `.files` become the layer's `generatedCode`. */
  codeGeneration: CodeGenerationResult;
  chtCorePath: string;
  /** Test types to request. Defaults to `['unit']` when omitted. */
  testTypes?: TestType[];
  /** Feedback from a previous iteration, surfaced as an external context file. */
  additionalContext?: string;
}

/**
 * Convert the agent-level input into a TestGenModuleInput for the test-gen layer.
 *
 * Mirrors code-generation-agent's `buildModuleInput`. Pure aside from the
 * `readFile`/`listDirectory` closures it binds (they read from cht-core on
 * demand). `codeGeneration.files` is the types-local GeneratedFile[], which is
 * exactly what `TestGenModuleInput.generatedCode` expects, so it passes through
 * unchanged. The supervisor wires this in a later iteration; for now it is
 * exported and unit-tested but not called by the (inert) test-generation node.
 */
export function buildTestGenModuleInput(input: TestGenerationInput): TestGenModuleInput {
  const contextFiles: ContextFile[] = [];
  if (input.additionalContext) {
    contextFiles.push({
      path: 'feedback/additional-context.md',
      content: input.additionalContext,
      source: 'external',
    });
  }

  return {
    ticket: input.issue,
    researchFindings: input.researchFindings,
    orchestrationPlan: input.orchestrationPlan,
    generatedCode: input.codeGeneration.files,
    contextFiles,
    testTypes: input.testTypes ?? ['unit'],
    targetDirectory: input.chtCorePath,
    readFile: (filePath: string) => readFromChtCore(filePath, input.chtCorePath),
    listDirectory: (dirPath: string) => listChtCoreDirectory(dirPath, input.chtCorePath),
  };
}
