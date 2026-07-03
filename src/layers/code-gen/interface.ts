import { IssueTemplate, OrchestrationPlan, ResearchFindings, FailingFileRef, CrossFileIssue } from '../../types';

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
  /** Original file content for MODIFY files — enables diff generation upstream */
  originalContent?: string;
}

/**
 * Lightweight plan summary surfaced to callbacks. The module is free to use a richer internal shape.
 */
export interface PlanSummaryItem {
  action: string;
  filePath: string;
  rationale: string;
}

export interface CodeGenModuleInput {
  ticket: IssueTemplate;
  researchFindings: ResearchFindings;
  contextFiles: ReadonlyArray<ContextFile>;
  orchestrationPlan: OrchestrationPlan;
  targetDirectory: string;
  readFile?: (path: string) => Promise<string | null>;
  listDirectory?: (dirPath: string) => Promise<string[]>;
  directoryListing?: string;
  /** When set, only regenerate these files (selective regeneration on retry) */
  failingFiles?: ReadonlyArray<FailingFileRef>;

  // Optional lifecycle callbacks. The agent (or any wrapper) wires these to a tracker
  // such as Beads. Modules invoke them at the documented points. All callbacks are
  // best-effort; modules should not let callback failures break generation.
  onPlan?: (plan: ReadonlyArray<PlanSummaryItem>) => void | Promise<void>;
  onFileInProgress?: (filePath: string) => void | Promise<void>;
  onFileCompleted?: (file: GeneratedFile) => void | Promise<void>;
  onFileFailed?: (filePath: string, reasons: ReadonlyArray<string>) => void | Promise<void>;
  onAttemptFailure?: (filePath: string, attempt: number, reasons: ReadonlyArray<string>) => void | Promise<void>;
}

export interface CodeGenModuleOutput {
  files: GeneratedFile[];
  explanation: string;
  tokensUsed?: number;
  modelUsed?: string;
  /**
   * True when the module knows its output is incomplete (e.g., CLI hit
   * is_error or saturated max-turns). The agent surfaces this as a
   * `partial-completion` cross-file issue so the supervisor's refinement
   * loop triggers.
   */
  partialGeneration?: boolean;
  /** Human-readable reason associated with {@link partialGeneration}. */
  partialGenerationReason?: string;
  /**
   * Module-level cross-file issues (e.g., plan-adherence-missing,
   * plan-adherence-extra, plan-discovered-missing, compile-error). The agent
   * merges these into its own cross-file issue list so the supervisor's
   * refinement-loop trigger picks them up alongside static-validator issues.
   */
  crossFileIssues?: CrossFileIssue[];
  /**
   * True when the compile gate did not run (e.g., tsc unavailable, no
   * tsconfig discovered). The HC2 banner surfaces this so the user knows
   * the diff was approved without a compile verification.
   */
  compileGateSkipped?: boolean;
  /** Human-readable reason associated with {@link compileGateSkipped}. */
  compileGateSkipReason?: string;
}

export interface CodeGenModule {
  name: string;
  version: string;
  generate(input: CodeGenModuleInput): Promise<CodeGenModuleOutput>;
  validate?(): Promise<boolean>;
}
