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
import { buildExecutePrompt, buildRelaxedExecutePrompt, withResumeRollbackNotice } from './prompts';
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
import { isCompiledArtifact } from '../../../../utils/compiled-settings';

const PLAN_PHASE_TOOLS = ['Read', 'Grep', 'Glob'];
const EXECUTE_PHASE_TOOLS = ['Read', 'Write', 'Edit', 'Grep', 'Glob'];

export class ClaudeCodeCLICodeGenModule implements CodeGenModule {
  name = 'claude-code-cli';

  version = '1.0.0';

  /** Per-invocation cache for the CLI binary check. Reset at the top of generate(). */
  private cliValidationCache: boolean | null = null;

  /**
   * F8 (session-resume retries): the session id of the most recent execute
   * phase, remembered ACROSS generate() calls within one supervisor run. The
   * registry holds a single module instance for the life of a DevelopmentSupervisor,
   * so instance state is the cleanest seam for carrying the session forward
   * (documented alternative — threading through input/output — would touch the
   * CodeGenModuleInput/Output contract and every module). Cleared when the
   * ticket identity changes (see {@link lastExecuteTicketKey}) so a new ticket
   * never resumes a stale session — even a first attempt that already carries
   * feedback (a genuine first generation with `additionalContext`, which
   * isRetryInput cannot distinguish from a same-ticket refinement). Same-ticket
   * retries (failingFiles/feedback present) resume it.
   */
  private lastExecuteSessionId: string | null = null;

  /**
   * F8: the ticket identity the remembered {@link lastExecuteSessionId} belongs
   * to. Keying the reset to the ticket (rather than to isRetryInput) enforces the
   * real invariant — "a session is only ever resumed by the ticket that created
   * it" — for every input shape, including a second ticket's first generate()
   * call that carries additionalContext. Set alongside the session id.
   */
  private lastExecuteTicketKey: string | null = null;

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
    // F8: a session is only ever resumed by the ticket that created it. When the
    // ticket identity changes, forget the remembered session — this is the real
    // invariant, and (unlike keying off isRetryInput) it holds even for a NEW
    // ticket's first generate() call that already carries feedback/additionalContext.
    // Same-ticket retries keep the recorded session so runExecuteWithOptionalResume
    // can resume it below.
    const ticketKey = ticketIdentity(input);
    if (ticketKey !== this.lastExecuteTicketKey) {
      this.lastExecuteSessionId = null;
      this.lastExecuteTicketKey = ticketKey;
    }
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
    const executeResult = await this.runExecuteWithOptionalResume(input, plan, chtCorePath);
    this.lastExecuteSessionId = executeResult.sessionId ?? this.lastExecuteSessionId;
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
      plan: plan as PlanSummaryItem[],
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
    await this.runExecutePhase(input, plan, chtCorePath, { promptBuilder: buildRelaxedExecutePrompt });
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

  /**
   * F8: run the execute phase, resuming the prior CLI session on a retry that
   * carries failure feedback. On a retry with a remembered session id, resume
   * it (prepending the rollback notice so the agent recreates the corrected file
   * rather than assuming its wiped edits persist). The resume can fail two ways
   * — both fall back ONCE to a fresh-session execute (which still carries the
   * failure feedback via buildRetryFeedbackSection, so no context is lost):
   *   (a) the resumed spawn RESOLVES with is_error=true in the CLI JSON; or
   *   (b) the resumed spawn REJECTS (spawnClaudeCli throws). The real CLI signals
   *       an unknown/expired session with exit code 1 + empty stdout, which
   *       cli-driver turns into a rejection — this is in fact the PRIMARY
   *       resume-failure trigger, so it MUST route to the fallback rather than
   *       aborting the whole generation.
   * A first (non-retry) generation or a retry with no remembered session runs
   * fresh with the pre-F8 argv shape.
   */
  private async runExecuteWithOptionalResume(
    input: CodeGenModuleInput,
    plan: PlanItem[],
    cwd: string,
  ): Promise<ExecutePhaseResult> {
    const resumeId = isRetryInput(input) ? this.lastExecuteSessionId : null;
    if (!resumeId) {
      return this.runExecutePhase(input, plan, cwd);
    }
    console.log(`[claude-code-cli] Retry: resuming execute session ${resumeId}`);
    let resumed: ExecutePhaseResult;
    try {
      resumed = await this.runExecutePhase(input, plan, cwd, {
        resumeSessionId: resumeId,
        resumed: true,
      });
    } catch (err) {
      // Unknown/expired session: the CLI exits nonzero with empty stdout and
      // cli-driver rejects. Treat exactly like is_error — fall back once.
      console.warn(
        `[claude-code-cli] Resume of session ${resumeId} threw (${err instanceof Error ? err.message : String(err)}); ` +
          'falling back once to a fresh execute session (feedback still carried).',
      );
      return this.runExecutePhase(input, plan, cwd);
    }
    if (!resumed.isError) return resumed;
    console.warn(
      `[claude-code-cli] Resume of session ${resumeId} failed (is_error); ` +
        'falling back once to a fresh execute session (feedback still carried).',
    );
    return this.runExecutePhase(input, plan, cwd);
  }

  private async runExecutePhase(
    input: CodeGenModuleInput,
    plan: PlanItem[],
    cwd: string,
    opts: {
      promptBuilder?: (input: CodeGenModuleInput, plan: PlanItem[]) => string;
      resumeSessionId?: string;
      resumed?: boolean;
    } = {},
  ): Promise<ExecutePhaseResult> {
    const promptBuilder = opts.promptBuilder ?? buildExecutePrompt;
    const base = promptBuilder(input, plan);
    const prompt = opts.resumed ? withResumeRollbackNotice(base) : base;
    const stdout = await spawnClaudeCli(prompt, {
      cwd,
      allowedTools: EXECUTE_PHASE_TOOLS,
      permissionMode: 'acceptEdits',
      phase: ClaudeCliPhase.Execute,
      ...(opts.resumeSessionId ? { resumeSessionId: opts.resumeSessionId } : {}),
    });

    const parsed = parseCliResult(stdout);
    if (parsed.isError) {
      const reason = `is_error=true from CLI: ${parsed.result.substring(0, 200)}`;
      console.warn(`[claude-code-cli] Execute phase: ${reason}`);
      return { partialCompletion: true, reason, resultText: parsed.result, isError: true, sessionId: parsed.sessionId };
    }
    if (parsed.numTurns >= DEFAULT_MAX_TURNS - 1) {
      const reason = `numTurns=${parsed.numTurns} reached max-turns cap (${DEFAULT_MAX_TURNS}); output likely incomplete`;
      console.warn(`[claude-code-cli] Execute phase: ${reason}`);
      return { partialCompletion: true, reason, resultText: parsed.result, isError: false, sessionId: parsed.sessionId };
    }
    return { partialCompletion: false, resultText: parsed.result, isError: false, sessionId: parsed.sessionId };
  }
}

interface ExecutePhaseResult {
  partialCompletion: boolean;
  reason?: string;
  resultText: string;
  isError: boolean;
  /** Session id from the CLI transcript; remembered for a resumed retry (F8). */
  sessionId?: string;
}

/**
 * F8: true when this generation is a retry — the supervisor's refinement loop
 * re-entered code generation with failure signals. Two signals mark a retry
 * (either suffices): `failingFiles` (selective regeneration targets) or the
 * `feedback/additional-context.md` external context file the agent packs from
 * `additionalContext`. On a first attempt neither is present.
 */
function isRetryInput(input: CodeGenModuleInput): boolean {
  if ((input.failingFiles?.length ?? 0) > 0) return true;
  return input.contextFiles.some((f) => f.source === 'external' && f.content.trim().length > 0);
}

/**
 * F8: a stable-enough identity for the ticket a generation belongs to, used only
 * to decide whether a remembered execute session may be resumed. The refinement
 * loop re-enters generate() with the SAME ticket object (title/type/description
 * unchanged) across retries, so keying on those fields groups a ticket's
 * attempts together while distinguishing a genuinely different ticket. This is a
 * cache key, not a security boundary; a collision only risks resuming a session,
 * which the CLI itself rejects if the id is unknown (→ fresh fallback).
 */
function ticketIdentity(input: CodeGenModuleInput): string {
  const issue = input.ticket.issue;
  return [issue.title, issue.type, issue.description].join('\n');
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
  logModuleIssues({ moduleIssues, adherenceIssues, discoveryIssues, compileIssues, executeNoOp });
  return moduleIssues;
}

function logModuleIssues(args: {
  moduleIssues: CrossFileIssue[];
  adherenceIssues: CrossFileIssue[];
  discoveryIssues: CrossFileIssue[];
  compileIssues: CrossFileIssue[];
  executeNoOp: boolean;
}): void {
  const { moduleIssues, adherenceIssues, discoveryIssues, compileIssues, executeNoOp } = args;
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
 *
 * Compiled artifacts (app_settings.json) are exempt from the `missing` check.
 * The plan phase reads the repo and correctly concludes they must be
 * regenerated, but the execute phase has no Bash (EXECUTE_PHASE_TOOLS) so it
 * cannot run `compile-app-settings`, and hand-editing a minified webpack bundle
 * is not an option. Flagging that gap produced an unwinnable refinement loop:
 * replan, re-execute, same issue, until max iterations. The artifact is
 * regenerated for real by the QA compile, so nothing is lost by not demanding
 * it here. `extra` still applies — an unplanned write to a build artifact is
 * genuine drift worth surfacing.
 */
export function reconcilePlanAdherence(
  plan: PlanItem[],
  generatedFiles: ReadonlyArray<{ path: string }>,
): CrossFileIssue[] {
  const planPaths = new Set(plan.map(p => p.filePath));
  const generatedPaths = new Set(generatedFiles.map(f => f.path));

  const missing = [...planPaths].filter(
    p => !generatedPaths.has(p) && !isCompiledArtifact(p),
  );
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
