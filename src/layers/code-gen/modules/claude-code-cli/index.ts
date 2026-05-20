/**
 * claude-code-cli code generation module.
 *
 * Strategy: spawn the Claude Code CLI as a tool-using agent. The CLI uses native
 * Read/Write/Edit/Grep/Glob tools to plan and edit files in cht-core directly.
 *
 * Two-phase invocation:
 *   1. Plan phase (read-only tools) — produces the plan text, feeds HC1.
 *   2. Execute phase (full edit tools) — the CLI edits files in cht-core.
 *
 * After execute, we capture the diff against the pre-run HEAD, package it as
 * GeneratedFile[], and roll back cht-core. The captured files flow through the
 * existing staging path (HC2 preview, writeToChtCore on approval).
 *
 * Contrast with `claude-api`: claude-api builds text prompts, sends them to the
 * Anthropic SDK, parses the text response, and writes files itself. This module
 * delegates planning and file I/O to the CLI's tool use; the cht-agent is a
 * thin orchestrator.
 */

import {
  CodeGenModule,
  CodeGenModuleInput,
  CodeGenModuleOutput,
  PlanSummaryItem,
  GeneratedFile,
} from '../../interface';
import { CrossFileIssue } from '../../../../types';
import { compileCheck, CompileValidationResult } from '../../../../agents/compile-validator';
import { PlanItem, parsePlan } from '../../lib/plan';
import { buildPlanPrompt } from '../../lib/prompts';
import { buildFileManifest } from '../../lib/file-manifest';
import { buildExecutePrompt, buildRelaxedExecutePrompt } from './prompts';
import { spawnClaudeCli, parseCliResult, ClaudeCliPhase, DEFAULT_MAX_TURNS } from './cli-driver';
import {
  snapshotChtCore,
  captureChtCoreDiff,
  rollbackChtCore,
  ChtCoreSnapshot,
  RollbackResult,
} from './workspace';
import { validateClaudeCLI } from '../../../../llm';
import { readEnv } from '../../../../utils/env';
import { isShutdownRequested } from '../../../../utils/shutdown';

const PLAN_PHASE_TOOLS = ['Read', 'Grep', 'Glob'];
const EXECUTE_PHASE_TOOLS = ['Read', 'Write', 'Edit', 'Grep', 'Glob'];

export class ClaudeCodeCLICodeGenModule implements CodeGenModule {
  name = 'claude-code-cli';

  version = '1.0.0';

  /** Per-invocation cache for the CLI binary check. Reset at the top of generate(). */
  private cliValidationCache: boolean | null = null;

  async validate(): Promise<boolean> {
    if (this.cliValidationCache !== null) return this.cliValidationCache;
    const cliPath = readEnv('CLAUDE_CLI_PATH') || 'claude';
    const result = await validateClaudeCLI(cliPath);
    if (!result.valid) {
      console.log(`[claude-code-cli] CLI validation failed: ${result.error}`);
    }
    this.cliValidationCache = result.valid;
    return result.valid;
  }

  async generate(input: CodeGenModuleInput): Promise<CodeGenModuleOutput> {
    this.cliValidationCache = null;
    const chtCorePath = this.requireChtCorePath(input);
    console.log(`[claude-code-cli] Generating code for "${input.ticket.issue.title}"...`);

    if (isShutdownRequested()) return emptyResult(input, 'shutdown requested before snapshot');

    // Snapshot pre-run state so we can roll back after capture.
    const snapshot = await snapshotChtCore(chtCorePath);
    console.log(`[claude-code-cli] Snapshot: HEAD=${snapshot.headSha.substring(0, 7)} stash=${snapshot.stashRef ?? 'none'}`);

    // Explicit try/catch instead of try/finally with throw: rollback may fail
    // and need to surface its own error, but throwing from `finally` is unsafe
    // (it would mask any error from the work block). Manage both errors here.
    const work = await this.runWorkBlock(input, snapshot, chtCorePath);
    handleRollbackOutcome(await rollbackChtCore(chtCorePath, snapshot), snapshot, chtCorePath);

    if (work.error) throw work.error;
    return work.result!;
  }

  private requireChtCorePath(input: CodeGenModuleInput): string {
    if (!input.targetDirectory) {
      throw new Error('claude-code-cli requires input.targetDirectory (cht-core path).');
    }
    return input.targetDirectory;
  }

  private async runWorkBlock(
    input: CodeGenModuleInput,
    snapshot: ChtCoreSnapshot,
    chtCorePath: string,
  ): Promise<{ result?: CodeGenModuleOutput; error?: unknown }> {
    try {
      return { result: await this.runGeneration(input, snapshot, chtCorePath) };
    } catch (err) {
      return { error: err };
    }
  }

  /**
   * Run the plan + execute + capture + reconcile sequence. Extracted so the
   * surrounding `generate()` can perform rollback after a clean catch instead
   * of throwing from a `finally` block.
   */
  private async runGeneration(
    input: CodeGenModuleInput,
    snapshot: { headSha: string },
    chtCorePath: string,
  ): Promise<CodeGenModuleOutput> {
    if (isShutdownRequested()) return emptyResult(input, 'shutdown requested before plan');
    const plan = await this.runPlanPhase(input, chtCorePath);
    if (plan.length === 0) {
      console.warn('[claude-code-cli] Plan phase produced no items; skipping execute');
      return emptyResult(input, 'empty plan');
    }
    await this.surfacePlan(input, plan);

    if (isShutdownRequested()) return emptyResult(input, 'shutdown requested before execute');
    const executeResult = await this.runExecutePhase(input, plan, chtCorePath);
    const captureResult = await this.captureWithRelaxedRetry({
      input, plan, executeResult, snapshotSha: snapshot.headSha, chtCorePath,
    });
    const compileResult = await runCompileGate(chtCorePath);
    const moduleIssues = collectModuleIssues({
      plan,
      generatedFiles: captureResult.files,
      executeResultText: executeResult.resultText,
      compileIssues: compileResult.issues,
      executeNoOp: captureResult.executeNoOp,
    });
    return {
      files: captureResult.files,
      explanation: `Generated ${captureResult.files.length} file(s) via Claude Code CLI tool use for "${input.ticket.issue.title}".`,
      modelUsed: 'claude-cli',
      partialGeneration: executeResult.partialCompletion,
      partialGenerationReason: executeResult.reason,
      crossFileIssues: moduleIssues.length > 0 ? moduleIssues : undefined,
      compileGateSkipped: compileResult.skipped,
      compileGateSkipReason: compileResult.skipReason,
    };
  }

  private async surfacePlan(input: CodeGenModuleInput, plan: PlanItem[]): Promise<void> {
    // Surface the plan to the agent's optional tracker (Beads, etc.) and HC1.
    await fireCallback('onPlan', input.onPlan, plan as ReadonlyArray<PlanSummaryItem>);
    console.log(`[claude-code-cli] Plan (${plan.length} item(s)):`);
    for (const item of plan) {
      console.log(`[claude-code-cli]   ${item.action} ${item.filePath} — ${item.rationale}`);
    }
  }

  /**
   * Run the diff capture, and conditionally retry with the relaxed prompt
   * when STRICT execute produced zero edits on a non-empty plan and did not
   * partial-complete. The CLI explored but abstained; one extra LLM call with
   * relaxed rules typically converts exploration into a best-effort draft.
   */
  private async captureWithRelaxedRetry(
    opts: {
      input: CodeGenModuleInput;
      plan: PlanItem[];
      executeResult: { partialCompletion: boolean; reason?: string; resultText: string };
      snapshotSha: string;
      chtCorePath: string;
    },
  ): Promise<{ files: Awaited<ReturnType<typeof captureChtCoreDiff>>; executeNoOp: boolean }> {
    const { input, plan, executeResult, snapshotSha, chtCorePath } = opts;
    let files = await captureChtCoreDiff(chtCorePath, snapshotSha);
    console.log(`[claude-code-cli] Captured ${files.length} file change(s) from CLI session`);

    const shouldRetry =
      files.length === 0 &&
      plan.length > 0 &&
      !executeResult.partialCompletion &&
      !isShutdownRequested();
    if (!shouldRetry) return { files, executeNoOp: false };

    console.warn(
      '[claude-code-cli] Zero files captured on STRICT execute; attempting relaxed retry (R17)'
    );
    await this.runExecutePhase(input, plan, chtCorePath, buildRelaxedExecutePrompt);
    files = await captureChtCoreDiff(chtCorePath, snapshotSha);
    console.log(
      `[claude-code-cli] After relaxed retry: ${files.length} file change(s) captured`
    );
    if (files.length === 0) {
      console.warn(
        '[claude-code-cli] Relaxed retry also produced zero files; surfacing execute-no-op'
      );
      return { files, executeNoOp: true };
    }
    return { files, executeNoOp: false };
  }

  private async runPlanPhase(input: CodeGenModuleInput, cwd: string): Promise<PlanItem[]> {
    const manifest = buildFileManifest(input.contextFiles);
    const prompt = buildPlanPrompt(input, manifest);
    const stdout = await spawnClaudeCli(prompt, {
      cwd,
      allowedTools: PLAN_PHASE_TOOLS,
      permissionMode: 'acceptEdits',
      phase: ClaudeCliPhase.Plan,
    });
    const parsed = parseCliResult(stdout);
    if (parsed.isError) {
      console.warn(
        `[claude-code-cli] Plan phase reported is_error=true: ` +
        `${parsed.result.substring(0, 200)}`
      );
      return [];
    }
    return parsePlan(parsed.result);
  }

  private async runExecutePhase(
    input: CodeGenModuleInput,
    plan: PlanItem[],
    cwd: string,
    promptBuilder: (input: CodeGenModuleInput, plan: PlanItem[]) => string = buildExecutePrompt,
  ): Promise<{ partialCompletion: boolean; reason?: string; resultText: string }> {
    const prompt = promptBuilder(input, plan);
    const stdout = await spawnClaudeCli(prompt, {
      cwd,
      allowedTools: EXECUTE_PHASE_TOOLS,
      permissionMode: 'acceptEdits',
      phase: ClaudeCliPhase.Execute,
    });

    const parsed = parseCliResult(stdout);
    if (parsed.isError) {
      const reason = `is_error=true from CLI: ${parsed.result.substring(0, 200)}`;
      console.warn(`[claude-code-cli] Execute phase: ${reason}`);
      return { partialCompletion: true, reason, resultText: parsed.result };
    }
    if (parsed.numTurns >= DEFAULT_MAX_TURNS - 1) {
      const reason = `numTurns=${parsed.numTurns} reached max-turns cap (${DEFAULT_MAX_TURNS}); output likely incomplete`;
      console.warn(`[claude-code-cli] Execute phase: ${reason}`);
      return { partialCompletion: true, reason, resultText: parsed.result };
    }
    return { partialCompletion: false, resultText: parsed.result };
  }
}

async function fireCallback<Args extends unknown[]>(
  label: string,
  callback: ((...args: Args) => void | Promise<void>) | undefined,
  ...args: Args
): Promise<void> {
  if (!callback) return;
  try {
    await callback(...args);
  } catch (err) {
    console.log(`[claude-code-cli] Callback ${label} failed (non-fatal): ${err}`);
  }
}

function collectModuleIssues(args: {
  plan: PlanItem[];
  generatedFiles: GeneratedFile[];
  executeResultText: string;
  compileIssues: CrossFileIssue[];
  executeNoOp: boolean;
}): CrossFileIssue[] {
  const { plan, generatedFiles, executeResultText, compileIssues, executeNoOp } = args;
  const adherenceIssues = reconcilePlanAdherence(plan, generatedFiles);
  const discoveryIssues = extractLlmDiscoveryIssues(executeResultText, plan, generatedFiles);
  const moduleIssues = [...adherenceIssues, ...discoveryIssues, ...compileIssues];
  if (executeNoOp) {
    moduleIssues.push({
      filePath: '(execute)',
      issueType: 'execute-no-op',
      description:
        'The CLI explored the planned files but produced no edits, even after a relaxed retry. ' +
        'This is an abstain signal, not a code defect. Review the plan, augment context, or skip this ticket.',
      reason: 'CLI abstained after relaxed retry; refinement loop cannot help.',
    });
  }
  logModuleIssues(moduleIssues, adherenceIssues, discoveryIssues, compileIssues, executeNoOp);
  return moduleIssues;
}

function logModuleIssues(
  moduleIssues: CrossFileIssue[],
  adherenceIssues: CrossFileIssue[],
  discoveryIssues: CrossFileIssue[],
  compileIssues: CrossFileIssue[],
  executeNoOp: boolean,
): void {
  if (moduleIssues.length === 0) return;
  console.warn(
    `[claude-code-cli] Module issues: ${moduleIssues.length} ` +
    `(${adherenceIssues.length} adherence + ${discoveryIssues.length} discovery + ${compileIssues.length} compile` +
    `${executeNoOp ? ' + 1 execute-no-op' : ''})`
  );
  for (const issue of moduleIssues) {
    console.warn(`[claude-code-cli]   - ${issue.issueType}: ${issue.filePath}`);
  }
}

function emptyResult(input: CodeGenModuleInput, reason: string): CodeGenModuleOutput {
  return {
    files: [],
    explanation: `Generation aborted (${reason}) for "${input.ticket.issue.title}".`,
    modelUsed: 'claude-cli',
  };
}

/**
 * Inspect the rollback result and surface failures.
 *  - reset failed → emit recovery checklist + throw (cht-core may have leftover edits).
 *  - clean / stashPop failed → log warnings; do not throw.
 *  - all ok → silent.
 */
function handleRollbackOutcome(
  rollback: RollbackResult,
  snapshot: ChtCoreSnapshot,
  chtCorePath: string,
): void {
  const anyFailed =
    rollback.reset === 'failed' ||
    rollback.clean === 'failed' ||
    rollback.stashPop === 'failed';
  if (!anyFailed) return;

  console.error('[claude-code-cli] ROLLBACK INCOMPLETE; cht-core may be in an unexpected state:');
  for (const e of rollback.errors) console.error(`[claude-code-cli]   - ${e}`);

  if (rollback.reset === 'failed') {
    emitRecoveryChecklist(snapshot, chtCorePath);
    throw new Error(
      `claude-code-cli rollback failed: ${rollback.errors.join('; ')}. ` +
      `Inspect cht-core working tree before retrying.`
    );
  }
}

function emitRecoveryChecklist(snapshot: ChtCoreSnapshot, chtCorePath: string): void {
  const recoveryLines: string[] = [
    '',
    '[claude-code-cli] To recover manually:',
    `[claude-code-cli]   1. cd ${chtCorePath}`,
    '[claude-code-cli]   2. git status                            # see what is modified',
    '[claude-code-cli]   3. git diff                              # inspect changes',
    `[claude-code-cli]   4. git reset --hard ${snapshot.headSha}   # DESTRUCTIVE; discards working-tree changes`,
    '[claude-code-cli]   5. git stash list                        # check for orphan stashes',
  ];
  if (snapshot.stashRef) {
    recoveryLines.push(
      `[claude-code-cli]   6. git stash pop ${snapshot.stashRef}          # restore stashed pre-run state`
    );
  }
  recoveryLines.push('[claude-code-cli]   7. Re-run the agent only after the working tree is clean.');
  for (const line of recoveryLines) console.error(line);
}

/**
 * H.1/H.2 compile-gate wrapper. Runs {@link compileCheck} with structured
 * logging for the skip and pass/fail cases. Always returns a result; the
 * helper never throws (compile gate failures should not block the run).
 */
async function runCompileGate(chtCorePath: string): Promise<CompileValidationResult> {
  try {
    const result = await compileCheck(chtCorePath);
    logCompileGateResult(result);
    return result;
  } catch (err) {
    console.warn(`[claude-code-cli] Compile gate raised an unexpected error: ${err}; treating as skipped.`);
    return {
      passed: true,
      issues: [],
      skipped: true,
      skipReason: `Compile gate raised an unexpected error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

function logCompileGateResult(result: CompileValidationResult): void {
  if (result.skipped) {
    console.warn(`[claude-code-cli] Compile gate skipped: ${result.skipReason}`);
    return;
  }
  const tsconfigsCount = result.tsconfigsRun?.length ?? 0;
  if (result.passed) {
    console.log(`[claude-code-cli] Compile gate passed (${tsconfigsCount} tsconfig(s)).`);
    return;
  }
  console.warn(
    `[claude-code-cli] Compile gate FAILED: ${result.issues.length} error(s) across ${tsconfigsCount} tsconfig(s).`
  );
}

/**
 * A.15 LLM signal extraction. The execute prompt requires the CLI to emit a
 * JSON summary block on its final line; this function parses it and surfaces
 * two flavors of `plan-discovered-missing` cross-file issues:
 *
 *  1. The LLM's `summary` text mentions a discovered-but-not-added file
 *     (heuristic regex over the prose).
 *  2. `files_modified` or `files_created` declare a path that git diff did
 *     not capture AND was not in the approved plan (a claim/diff mismatch
 *     the user should see at HC2).
 *
 * Best-effort. If the CLI did not follow the JSON format, the signal is lost.
 * False negatives are acceptable; false positives would push noise into HC2.
 */
interface ExecuteSummaryBlock {
  files_modified?: string[];
  files_created?: string[];
  summary?: string;
}

function extractSummaryBlock(resultText: string): ExecuteSummaryBlock | null {
  if (!resultText) return null;
  // Prefer the fenced JSON code block (the format the execute prompt requires).
  const fenced = tryParseJsonBlock(/```json\s*([\s\S]+?)\s*```/, resultText, 1);
  if (fenced) return fenced;
  // Fall back to the last `{...}` block. Greedy-from-the-end via lookahead.
  return tryParseJsonBlock(/\{[\s\S]*\}(?![\s\S]*\})/, resultText, 0);
}

function tryParseJsonBlock(re: RegExp, text: string, group: number): ExecuteSummaryBlock | null {
  const match = re.exec(text);
  if (!match) return null;
  try {
    return JSON.parse(match[group]) as ExecuteSummaryBlock;
  } catch {
    return null;
  }
}

const DISCOVERY_HINT_RE = /\b(discovered|would also need|would need|missing from( the)? plan|should also (modify|create))\b/i;

export function extractLlmDiscoveryIssues(
  resultText: string,
  plan: PlanItem[],
  generatedFiles: ReadonlyArray<{ path: string }>,
): CrossFileIssue[] {
  const summary = extractSummaryBlock(resultText);
  if (!summary) return [];
  const planPaths = new Set(plan.map(p => p.filePath));
  const capturedPaths = new Set(generatedFiles.map(f => f.path));
  return [
    ...buildProseDiscoveryIssue(summary.summary),
    ...buildDeclaredPathIssues(summary, planPaths, capturedPaths),
  ];
}

function buildProseDiscoveryIssue(summaryText?: string): CrossFileIssue[] {
  if (!summaryText || !DISCOVERY_HINT_RE.test(summaryText)) return [];
  const description = `LLM noted in execute summary: "${summaryText.substring(0, 300)}"`;
  return [{
    filePath: '(LLM-flagged)',
    issueType: 'plan-discovered-missing',
    description,
    reason: description,
  }];
}

function buildDeclaredPathIssues(
  summary: ExecuteSummaryBlock,
  planPaths: Set<string>,
  capturedPaths: Set<string>,
): CrossFileIssue[] {
  const declaredPaths = new Set([
    ...(summary.files_modified ?? []),
    ...(summary.files_created ?? []),
  ]);
  const issues: CrossFileIssue[] = [];
  for (const declared of declaredPaths) {
    if (!capturedPaths.has(declared) && !planPaths.has(declared)) {
      const description =
        `LLM declared modifying "${declared}" in its summary but git diff did not ` +
        `capture it, and the file is not in the approved plan.`;
      issues.push({
        filePath: declared,
        issueType: 'plan-discovered-missing',
        description,
        reason: description,
      });
    }
  }

  return issues;
}

/**
 * V1 (A.12) post-execute reconciliation. The CLI is told via the execute prompt
 * to stay within the approved plan; this function flags any drift so the user
 * sees it at HC2 instead of silently accepting a diff that doesn't match HC1.
 *
 *  - `plan-adherence-missing`: planned file was not touched in cht-core.
 *  - `plan-adherence-extra`: cht-core file was touched but was not in the plan.
 */
export function reconcilePlanAdherence(
  plan: PlanItem[],
  generatedFiles: ReadonlyArray<{ path: string }>,
): CrossFileIssue[] {
  const planPaths = new Set(plan.map(p => p.filePath));
  const generatedPaths = new Set(generatedFiles.map(f => f.path));

  const missing = [...planPaths].filter(p => !generatedPaths.has(p));
  const extra = [...generatedPaths].filter(p => !planPaths.has(p));

  const issues: CrossFileIssue[] = [];
  for (const p of missing) {
    issues.push({
      filePath: p,
      issueType: 'plan-adherence-missing',
      description: `Plan item "${p}" was approved at HC1 but the CLI did not modify it.`,
      reason: `Plan item "${p}" was approved at HC1 but the CLI did not modify it.`,
    });
  }
  for (const p of extra) {
    issues.push({
      filePath: p,
      issueType: 'plan-adherence-extra',
      description: `CLI modified "${p}" but it was not in the HC1-approved plan.`,
      reason: `CLI modified "${p}" but it was not in the HC1-approved plan.`,
    });
  }
  return issues;
}

export function createClaudeCodeCLICodeGenModule(): ClaudeCodeCLICodeGenModule {
  return new ClaudeCodeCLICodeGenModule();
}
