/* eslint-disable @typescript-eslint/no-var-requires */
import { expect } from 'chai';
import sinon from 'sinon';
import { __resetShutdownForTests } from '../../../../../src/utils/shutdown';
import { CodeGenModuleInput } from '../../../../../src/layers/code-gen/interface';
import { CrossFileIssue } from '../../../../../src/types';
import { extractLlmDiscoveryIssues } from '../../../../../src/layers/code-gen/modules/claude-code-cli/index';
import * as realWorkspace from '../../../../../src/layers/code-gen/modules/claude-code-cli/workspace';
import { WorkspaceSafetyError, STASH_MARKER_PREFIX } from '../../../../../src/layers/code-gen/modules/claude-code-cli/workspace';

// Helper: proxyquire the orchestrator with cli-driver + workspace stubbed.
const proxyquire = require('proxyquire').noCallThru();


/**
 * The real workspace module with its git-touching entry points replaced, so the
 * pure exports (the safety error, the checklist builder) stay real.
 */
const workspaceStub = (stubs: Record<string, unknown>) => ({ ...realWorkspace, ...stubs });

const baseInput = (chtCorePath = '/tmp/cht-core-test'): CodeGenModuleInput => ({
  ticket: {
    issue: {
      title: 'Add contact search filters',
      type: 'feature',
      priority: 'medium',
      description: 'Allow filtering contacts by status.',
      technical_context: { domain: 'contacts', components: [] },
      requirements: ['filter by status'],
      acceptance_criteria: ['filter visible'],
      constraints: [],
    },
  },
  researchFindings: {
    documentationReferences: [],
    relevantExamples: [],
    suggestedApproaches: [],
    relatedDomains: [],
    confidence: 0.5,
    source: 'local-docs',
  },
  contextFiles: [],
  orchestrationPlan: {
    summary: '',
    keyFindings: [],
    recommendedApproach: '',
    estimatedComplexity: 'medium',
    phases: [],
    riskFactors: [],
    estimatedEffort: '',
  },
  targetDirectory: chtCorePath,
});

const planResultText = '=== PLAN ===\n1. CREATE src/a.ts - implement feature\n=== END PLAN ===\n';

describe('ClaudeCodeCLICodeGenModule (A.2d orchestrator)', () => {
  afterEach(() => {
    __resetShutdownForTests();
    sinon.restore();
  });

  it('runs plan + execute and captures the diff (happy path)', async () => {
    const spawnStub = sinon.stub()
      .onFirstCall().resolves(planResultText) // plan phase
      .onSecondCall().resolves('execute ok');  // execute phase
    const baseline = ['.aider.chat', 'node_modules/'];
    const snapshotStub = sinon.stub().resolves({ headSha: 'abc1234', stashSha: null, baselineUntracked: baseline });
    const captureStub = sinon.stub().resolves([
      { path: 'src/a.ts', content: 'export const a = 1;\n', purpose: 'CLI-created file' },
    ]);
    const rollbackStub = sinon.stub().resolves({ reset: 'ok', clean: 'ok', stashPop: 'skipped', errors: [] });

    const { ClaudeCodeCLICodeGenModule } = proxyquire('../../../../../src/layers/code-gen/modules/claude-code-cli/index', {
      './cli-driver': {
        spawnClaudeCli: spawnStub,
        parseCliResult: (s: string) => ({ result: s, isError: false, numTurns: 1 }),
        ClaudeCliPhase: { Plan: 'plan', Execute: 'execute' },
      },
      './workspace': workspaceStub({
        snapshotChtCore: snapshotStub,
        captureChtCoreDiff: captureStub,
        rollbackChtCore: rollbackStub,
      }),
    });

    const module = new ClaudeCodeCLICodeGenModule();
    const result = await module.generate(baseInput());

    expect(spawnStub.callCount).to.equal(2);
    expect(snapshotStub.callCount).to.equal(1);
    expect(captureStub.callCount).to.equal(1);
    expect(rollbackStub.callCount).to.equal(1); // always rolls back
    expect(result.files).to.have.length(1);
    expect(result.files[0].path).to.equal('src/a.ts');
    // The snapshot's own baseline, or capture would claim the operator's files.
    expect(captureStub.firstCall.args).to.deep.equal(['/tmp/cht-core-test', 'abc1234', baseline]);
  });

  it('returns empty result and rolls back when shutdown is requested after snapshot but before plan', async () => {
    const spawnStub = sinon.stub();
    const snapshotStub = sinon.stub().resolves({ headSha: 'abc1234', stashRef: null, baselineUntracked: [] });
    const captureStub = sinon.stub();
    const rollbackStub = sinon.stub().resolves({ reset: 'ok', clean: 'ok', stashPop: 'skipped', errors: [] });
    // First check (before snapshot) returns false so we proceed; second check
    // (inside the try, before the plan phase) returns true so we bail early.
    const shutdownStub = sinon.stub();
    shutdownStub.onFirstCall().returns(false);
    shutdownStub.returns(true);

    const { ClaudeCodeCLICodeGenModule } = proxyquire('../../../../../src/layers/code-gen/modules/claude-code-cli/index', {
      './cli-driver': { spawnClaudeCli: spawnStub, parseCliResult: (s: string) => ({ result: s, isError: false, numTurns: 1 }), ClaudeCliPhase: { Plan: 'plan', Execute: 'execute' } },
      './workspace': workspaceStub({ snapshotChtCore: snapshotStub, captureChtCoreDiff: captureStub, rollbackChtCore: rollbackStub }),
      '../../../../utils/shutdown': {
        isShutdownRequested: shutdownStub,
      },
    });

    const module = new ClaudeCodeCLICodeGenModule();
    const result = await module.generate(baseInput());

    expect(result.files).to.have.length(0);
    expect(spawnStub.callCount).to.equal(0);
    expect(rollbackStub.callCount).to.equal(1); // still rolls back the snapshot
  });

  it('always rolls back even if execute phase throws', async () => {
    const spawnStub = sinon.stub()
      .onFirstCall().resolves(planResultText)
      .onSecondCall().rejects(new Error('CLI crashed'));
    const snapshotStub = sinon.stub().resolves({ headSha: 'abc1234', stashRef: null, baselineUntracked: [] });
    const captureStub = sinon.stub();
    const rollbackStub = sinon.stub().resolves({ reset: 'ok', clean: 'ok', stashPop: 'skipped', errors: [] });

    const { ClaudeCodeCLICodeGenModule } = proxyquire('../../../../../src/layers/code-gen/modules/claude-code-cli/index', {
      './cli-driver': { spawnClaudeCli: spawnStub, parseCliResult: (s: string) => ({ result: s, isError: false, numTurns: 1 }), ClaudeCliPhase: { Plan: 'plan', Execute: 'execute' } },
      './workspace': workspaceStub({ snapshotChtCore: snapshotStub, captureChtCoreDiff: captureStub, rollbackChtCore: rollbackStub }),
    });

    const module = new ClaudeCodeCLICodeGenModule();
    let threw = false;
    try {
      await module.generate(baseInput());
    } catch {
      threw = true;
    }
    expect(threw).to.equal(true);
    expect(rollbackStub.callCount).to.equal(1);
    expect(captureStub.callCount).to.equal(0); // never reached capture
  });

  it('rejects when targetDirectory is missing', async () => {
    const { ClaudeCodeCLICodeGenModule } = proxyquire('../../../../../src/layers/code-gen/modules/claude-code-cli/index', {
      './cli-driver': { spawnClaudeCli: sinon.stub(), parseCliResult: (s: string) => ({ result: s, isError: false, numTurns: 1 }), ClaudeCliPhase: { Plan: 'plan', Execute: 'execute' } },
      './workspace': workspaceStub({ snapshotChtCore: sinon.stub(), captureChtCoreDiff: sinon.stub(), rollbackChtCore: sinon.stub() }),
    });

    const module = new ClaudeCodeCLICodeGenModule();
    const input = baseInput();
    delete (input as { targetDirectory?: string }).targetDirectory;

    let threw = false;
    try {
      await module.generate(input);
    } catch (err) {
      threw = true;
      expect((err as Error).message).to.match(/targetDirectory|cht-core/i);
    }
    expect(threw).to.equal(true);
  });

  it('returns empty result when plan phase parses to no items', async () => {
    const emptyPlan = '=== PLAN ===\n=== END PLAN ===\n';
    const spawnStub = sinon.stub().resolves(emptyPlan);
    const snapshotStub = sinon.stub().resolves({ headSha: 'abc1234', stashRef: null, baselineUntracked: [] });
    const captureStub = sinon.stub();
    const rollbackStub = sinon.stub().resolves({ reset: 'ok', clean: 'ok', stashPop: 'skipped', errors: [] });

    const { ClaudeCodeCLICodeGenModule } = proxyquire('../../../../../src/layers/code-gen/modules/claude-code-cli/index', {
      './cli-driver': { spawnClaudeCli: spawnStub, parseCliResult: (s: string) => ({ result: s, isError: false, numTurns: 1 }), ClaudeCliPhase: { Plan: 'plan', Execute: 'execute' } },
      './workspace': workspaceStub({ snapshotChtCore: snapshotStub, captureChtCoreDiff: captureStub, rollbackChtCore: rollbackStub }),
    });

    const module = new ClaudeCodeCLICodeGenModule();
    const result = await module.generate(baseInput());

    expect(result.files).to.have.length(0);
    expect(spawnStub.callCount).to.equal(1); // only plan phase
    expect(captureStub.callCount).to.equal(0);
    expect(rollbackStub.callCount).to.equal(1);
  });

  describe('V3 typed RollbackResult surface (A.14)', () => {
    it('throws a halt error with an outcome-based checklist when the rollback reset failed', async () => {
      const spawnStub = sinon.stub()
        .onFirstCall().resolves('plan stdout')
        .onSecondCall().resolves('execute stdout');
      const snapshotStub = sinon.stub().resolves({
        headSha: 'abc1234',
        stashSha: '1111111111111111111111111111111111111111',
        stashName: `${STASH_MARKER_PREFIX}1700000000000`,
        baselineUntracked: [],
      });
      const captureStub = sinon.stub().resolves([]);
      const rollbackStub = sinon.stub().resolves({
        reset: 'failed',
        clean: 'skipped',
        stashPop: 'skipped',
        errors: ['reset: error: unable to unlink old \'rt/t.txt\': Permission denied'],
        sessionEdits: ['rt/t.txt'],
        survivors: ['src/a.ts'],
      });

      const parseStub = sinon.stub();
      parseStub.onFirstCall().returns({ result: planResultText, isError: false, numTurns: 5 });
      parseStub.onSecondCall().returns({ result: 'execute output', isError: false, numTurns: 20 });

      const { ClaudeCodeCLICodeGenModule } = proxyquire('../../../../../src/layers/code-gen/modules/claude-code-cli/index', {
        './cli-driver': {
          spawnClaudeCli: spawnStub,
          parseCliResult: parseStub,
          ClaudeCliPhase: { Plan: 'plan', Execute: 'execute' },
          DEFAULT_MAX_TURNS: 150,
        },
        './workspace': workspaceStub({
          snapshotChtCore: snapshotStub,
          captureChtCoreDiff: captureStub,
          rollbackChtCore: rollbackStub,
        }),
      });

      const errorSpy = sinon.spy(console, 'error');
      const module = new ClaudeCodeCLICodeGenModule();
      let thrown: unknown;
      try {
        await module.generate(baseInput());
      } catch (err) {
        thrown = err;
      } finally {
        errorSpy.restore();
      }
      expect(thrown).to.be.instanceOf(WorkspaceSafetyError);
      expect((thrown as { kind: string }).kind).to.equal('reset');
      expect((thrown as Error).message).to.match(/rollback failed/);

      const errorOutput = errorSpy.getCalls().map(c => String(c.args[0])).join('\n');
      expect(errorOutput).to.include(`still in stash ${STASH_MARKER_PREFIX}1700000000000`);
      expect(errorOutput).to.include('Permission denied');
      expect(errorOutput).to.include("reset --hard abc1234");
      expect(errorOutput).to.include("clean -fd -- ':(literal)src/a.ts'");
      expect(errorOutput.indexOf('reset --hard abc1234')).to.be.lessThan(errorOutput.indexOf('stash list'));
      expect(errorOutput).to.not.match(/stash@\{\d+\}/);
      expect(errorOutput).to.not.include('stash drop');
    });

    it('keeps the work error as the cause when the rollback after it fails', async () => {
      const workError = new Error('CLI crashed mid-execute');
      const spawnStub = sinon.stub()
        .onFirstCall().resolves(planResultText)
        .onSecondCall().rejects(workError);
      const rollbackStub = sinon.stub().resolves({
        reset: 'failed', clean: 'skipped', stashPop: 'skipped', errors: ['reset: fatal: index.lock exists'],
      });

      const { ClaudeCodeCLICodeGenModule } = proxyquire('../../../../../src/layers/code-gen/modules/claude-code-cli/index', {
        './cli-driver': { spawnClaudeCli: spawnStub, parseCliResult: (s: string) => ({ result: s, isError: false, numTurns: 1 }), ClaudeCliPhase: { Plan: 'plan', Execute: 'execute' } },
        './workspace': workspaceStub({
          snapshotChtCore: sinon.stub().resolves({ headSha: 'abc1234', stashRef: null, stashName: null, baselineUntracked: [] }),
          captureChtCoreDiff: sinon.stub(),
          rollbackChtCore: rollbackStub,
        }),
      });
      sinon.stub(console, 'error');

      let thrown: unknown;
      try {
        await new ClaudeCodeCLICodeGenModule().generate(baseInput());
      } catch (err) {
        thrown = err;
      }
      expect(thrown).to.be.instanceOf(WorkspaceSafetyError);
      expect((thrown as Error).cause).to.equal(workError);
    });

    /** A module whose rollback resolves `rollback`; capture returns one file, so no relaxed retry. */
    const wireRollbackOutcome = (rollback: Record<string, unknown>) => {
      const spawnStub = sinon.stub()
        .onFirstCall().resolves('plan stdout')
        .onSecondCall().resolves('execute stdout');
      const parseStub = sinon.stub();
      parseStub.onFirstCall().returns({ result: planResultText, isError: false, numTurns: 5 });
      parseStub.onSecondCall().returns({ result: 'execute output', isError: false, numTurns: 20 });
      const { ClaudeCodeCLICodeGenModule } = proxyquire('../../../../../src/layers/code-gen/modules/claude-code-cli/index', {
        './cli-driver': {
          spawnClaudeCli: spawnStub,
          parseCliResult: parseStub,
          ClaudeCliPhase: { Plan: 'plan', Execute: 'execute' },
          DEFAULT_MAX_TURNS: 150,
        },
        './workspace': workspaceStub({
          snapshotChtCore: sinon.stub().resolves({
            headSha: 'abc1234',
            stashSha: '1111111111111111111111111111111111111111',
            stashName: `${STASH_MARKER_PREFIX}1700000000000`,
            baselineUntracked: [],
          }),
          captureChtCoreDiff: sinon.stub().resolves([{ path: 'src/a.ts', content: 'x' }]),
          rollbackChtCore: sinon.stub().resolves(rollback),
        }),
      });
      return new ClaudeCodeCLICodeGenModule();
    };

    it('warns but does NOT throw when only the clean failed', async () => {
      const module = wireRollbackOutcome({
        reset: 'ok', clean: 'failed', stashPop: 'ok', errors: ['clean: boom'],
      });
      sinon.stub(console, 'error');
      const result = await module.generate(baseInput());
      expect(result.files).to.have.length(1);
    });

    it('adds the session files the rollback could not remove to the module warnings', async () => {
      const module = wireRollbackOutcome({
        reset: 'ok', clean: 'failed', stashPop: 'ok', errors: ['clean: these session files are still on disk: "nr/"'],
        survivors: ['nr/'],
      });
      sinon.stub(console, 'error');
      const result = await module.generate(baseInput());
      expect(result.files).to.have.length(1);
      expect(result.warnings).to.have.length(1);
      expect(result.warnings![0]).to.include('Rollback could not remove these session files');
      expect(result.warnings![0]).to.include('"nr/"');
    });

    it('throws a stash halt error with the restore steps when the stash restore failed', async () => {
      const module = wireRollbackOutcome({
        reset: 'ok', clean: 'ok', stashPop: 'failed',
        errors: ["stash apply: error: unable to unlink old 'ro/f.txt': Permission denied"],
        popBlockers: ['ro/f.txt'], unwritableDirs: ['ro'],
      });
      const errorSpy = sinon.stub(console, 'error');
      let thrown: unknown;
      try {
        await module.generate(baseInput());
      } catch (err) {
        thrown = err;
      }
      expect(thrown).to.be.instanceOf(WorkspaceSafetyError);
      expect((thrown as { kind: string }).kind).to.equal('stash');
      const output = errorSpy.getCalls().map(c => String(c.args[0])).join('\n');
      expect(output).to.include('[claude-code-cli] Rollback could not restore your work');
      expect(output).to.match(/Fix the permissions/);
      expect(output).to.not.match(/stash@\{\d+\}/);
    });

    it('prints a snapshot refusal once, with its own prefix, and rethrows it', async () => {
      const refusal = new WorkspaceSafetyError('precondition', 'in the middle of a merge', {
        lines: ['cht-core is in the middle of a git operation (MERGE_HEAD)'],
      });
      const { ClaudeCodeCLICodeGenModule } = proxyquire('../../../../../src/layers/code-gen/modules/claude-code-cli/index', {
        './cli-driver': { spawnClaudeCli: sinon.stub(), parseCliResult: sinon.stub(), ClaudeCliPhase: { Plan: 'plan', Execute: 'execute' } },
        './workspace': workspaceStub({
          snapshotChtCore: sinon.stub().rejects(refusal),
          captureChtCoreDiff: sinon.stub(),
          rollbackChtCore: sinon.stub(),
        }),
      });
      const errorSpy = sinon.stub(console, 'error');
      let thrown: unknown;
      try {
        await new ClaudeCodeCLICodeGenModule().generate(baseInput());
      } catch (err) {
        thrown = err;
      }
      expect(thrown).to.equal(refusal);
      const printed = errorSpy.getCalls().map(c => String(c.args[0]));
      expect(printed).to.deep.equal(['[claude-code-cli] cht-core is in the middle of a git operation (MERGE_HEAD)']);
    });

    it('prints both drift reports when capture and rollback see a moved HEAD', async () => {
      const captureDrift = new WorkspaceSafetyError('drift', 'HEAD moved', { lines: ['capture: HEAD moved'] });
      const rollbackDrift = new WorkspaceSafetyError('drift', 'HEAD moved', { lines: ['rollback: HEAD moved'] });
      const spawnStub = sinon.stub()
        .onFirstCall().resolves(planResultText)
        .onSecondCall().resolves('execute stdout');
      const { ClaudeCodeCLICodeGenModule } = proxyquire('../../../../../src/layers/code-gen/modules/claude-code-cli/index', {
        './cli-driver': { spawnClaudeCli: spawnStub, parseCliResult: (s: string) => ({ result: s, isError: false, numTurns: 1 }), ClaudeCliPhase: { Plan: 'plan', Execute: 'execute' } },
        './workspace': workspaceStub({
          snapshotChtCore: sinon.stub().resolves({ headSha: 'abc1234', stashSha: null, stashName: null, baselineUntracked: [] }),
          captureChtCoreDiff: sinon.stub().rejects(captureDrift),
          rollbackChtCore: sinon.stub().rejects(rollbackDrift),
        }),
      });
      const errorSpy = sinon.stub(console, 'error');
      let thrown: unknown;
      try {
        await new ClaudeCodeCLICodeGenModule().generate(baseInput());
      } catch (err) {
        thrown = err;
      }
      expect(thrown).to.equal(rollbackDrift);
      expect((thrown as Error).cause).to.equal(captureDrift);
      const printed = errorSpy.getCalls().map(c => String(c.args[0]));
      expect(printed).to.include('[claude-code-cli] capture: HEAD moved');
      expect(printed).to.include('[claude-code-cli] rollback: HEAD moved');
    });
  });

  describe('R17 relaxed-retry on zero-files abstain (v7)', () => {
    const planResult = '=== PLAN ===\n1. CREATE src/a.ts - implement\n=== END PLAN ===\n';

    const retryBaseline = ['operator-notes.md', 'cache/'];

    const wireRetryHarness = (
      captureResults: Array<Array<{ path: string; content: string }>>,
      executeParse = { result: 'execute stdout', isError: false, numTurns: 20 },
    ) => {
      const spawnStub = sinon.stub().resolves('cli stdout');
      const snapshotStub = sinon.stub().resolves({ headSha: 'abc1234', stashSha: null, baselineUntracked: retryBaseline });
      const captureStub = sinon.stub();
      captureResults.forEach((files, i) => captureStub.onCall(i).resolves(files));
      const rollbackStub = sinon.stub().resolves({ reset: 'ok', clean: 'ok', stashPop: 'skipped', errors: [] });

      const parseStub = sinon.stub();
      parseStub.onFirstCall().returns({ result: planResult, isError: false, numTurns: 5 });
      parseStub.returns(executeParse); // execute + any retry call

      const { ClaudeCodeCLICodeGenModule } = proxyquire('../../../../../src/layers/code-gen/modules/claude-code-cli/index', {
        './cli-driver': {
          spawnClaudeCli: spawnStub,
          parseCliResult: parseStub,
          ClaudeCliPhase: { Plan: 'plan', Execute: 'execute' },
          DEFAULT_MAX_TURNS: 150,
        },
        './workspace': workspaceStub({
          snapshotChtCore: snapshotStub,
          captureChtCoreDiff: captureStub,
          rollbackChtCore: rollbackStub,
        }),
      });
      return { module: new ClaudeCodeCLICodeGenModule(), spawnStub, captureStub, parseStub };
    };

    it('retries with the relaxed prompt and uses its capture when STRICT produced zero files', async () => {
      const { module, spawnStub, captureStub } = wireRetryHarness([
        [], // STRICT capture: zero
        [{ path: 'src/a.ts', content: 'export const a = 1;\n' }], // retry capture: one file
      ]);
      const result = await module.generate(baseInput());

      // 1 plan call + 1 STRICT execute + 1 relaxed retry = 3 spawn calls
      expect(spawnStub.callCount).to.equal(3);
      expect(captureStub.callCount).to.equal(2);
      // Both captures, strict and relaxed, get the snapshot's baseline.
      for (const call of captureStub.getCalls()) {
        expect(call.args).to.deep.equal(['/tmp/cht-core-test', 'abc1234', retryBaseline]);
      }
      expect(result.files).to.have.length(1);
      expect(result.files[0].path).to.equal('src/a.ts');
      const issues: CrossFileIssue[] = result.crossFileIssues ?? [];
      expect(issues.find(i => i.issueType === 'execute-no-op')).to.be.undefined;
    });

    it('produces execute-no-op when both STRICT and the relaxed retry capture zero files', async () => {
      const { module, spawnStub, captureStub } = wireRetryHarness([[], []]);
      const result = await module.generate(baseInput());

      expect(spawnStub.callCount).to.equal(3); // plan + strict + relaxed
      expect(captureStub.callCount).to.equal(2);
      const issues: CrossFileIssue[] = result.crossFileIssues ?? [];
      const noOp = issues.find(i => i.issueType === 'execute-no-op');
      expect(noOp).to.exist;
      expect(noOp!.filePath).to.equal('(execute)');
      expect(noOp!.description).to.match(/abstain/i);
    });

    it('does NOT retry when the plan is empty (existing short-circuit fires first)', async () => {
      const emptyPlan = '=== PLAN ===\n=== END PLAN ===\n';
      const spawnStub = sinon.stub().resolves('cli stdout');
      const snapshotStub = sinon.stub().resolves({ headSha: 'abc1234', stashRef: null, baselineUntracked: [] });
      const captureStub = sinon.stub();
      const rollbackStub = sinon.stub().resolves({ reset: 'ok', clean: 'ok', stashPop: 'skipped', errors: [] });

      const parseStub = sinon.stub().returns({ result: emptyPlan, isError: false, numTurns: 1 });

      const { ClaudeCodeCLICodeGenModule } = proxyquire('../../../../../src/layers/code-gen/modules/claude-code-cli/index', {
        './cli-driver': {
          spawnClaudeCli: spawnStub,
          parseCliResult: parseStub,
          ClaudeCliPhase: { Plan: 'plan', Execute: 'execute' },
          DEFAULT_MAX_TURNS: 150,
        },
        './workspace': workspaceStub({ snapshotChtCore: snapshotStub, captureChtCoreDiff: captureStub, rollbackChtCore: rollbackStub }),
      });

      const module = new ClaudeCodeCLICodeGenModule();
      await module.generate(baseInput());

      // Only plan phase ran; empty-plan short-circuit prevents execute + retry.
      expect(spawnStub.callCount).to.equal(1);
      expect(captureStub.callCount).to.equal(0);
    });

    it('does NOT retry when the execute phase reported partial completion', async () => {
      // partialCompletion=true means is_error or maxTurns saturation; retry won't help.
      const { module, spawnStub, captureStub } = wireRetryHarness(
        [[]],
        { result: 'partial', isError: true, numTurns: 7 },
      );
      await module.generate(baseInput());

      // plan + execute (no retry).
      expect(spawnStub.callCount).to.equal(2);
      expect(captureStub.callCount).to.equal(1);
    });
  });

  describe('A.15 LLM discovery extraction', () => {
    const multiPlanText = [
      '=== PLAN ===',
      '1. CREATE src/a.ts - implement A',
      '2. MODIFY src/b.ts - update B',
      '=== END PLAN ===',
    ].join('\n');

    /**
     * Wire the orchestrator with a programmable execute resultText so we can
     * test the LLM-discovery extraction against different summary blocks.
     */
    const wireModuleWithExecuteResult = (
      capturedFiles: { path: string; content: string }[],
      executeResultText: string,
    ) => {
      const spawnStub = sinon.stub()
        .onFirstCall().resolves('plan stdout')
        .onSecondCall().resolves('execute stdout');
      const snapshotStub = sinon.stub().resolves({ headSha: 'abc1234', stashRef: null, baselineUntracked: [] });
      const captureStub = sinon.stub().resolves(capturedFiles);
      const rollbackStub = sinon.stub().resolves({ reset: 'ok', clean: 'ok', stashPop: 'skipped', errors: [] });

      const parseStub = sinon.stub();
      parseStub.onFirstCall().returns({ result: multiPlanText, isError: false, numTurns: 5 });
      parseStub.onSecondCall().returns({ result: executeResultText, isError: false, numTurns: 20 });

      const { ClaudeCodeCLICodeGenModule } = proxyquire('../../../../../src/layers/code-gen/modules/claude-code-cli/index', {
        './cli-driver': {
          spawnClaudeCli: spawnStub,
          parseCliResult: parseStub,
          ClaudeCliPhase: { Plan: 'plan', Execute: 'execute' },
          DEFAULT_MAX_TURNS: 150,
        },
        './workspace': workspaceStub({
          snapshotChtCore: snapshotStub,
          captureChtCoreDiff: captureStub,
          rollbackChtCore: rollbackStub,
        }),
      });
      return new ClaudeCodeCLICodeGenModule();
    };

    it('flags prose-hint discoveries from the LLM summary as plan-discovered-missing', async () => {
      const resultText = [
        'Edits done.',
        '',
        '```json',
        '{',
        '  "files_modified": ["src/a.ts", "src/b.ts"],',
        '  "files_created": [],',
        '  "summary": "I implemented the feature, but I discovered that src/d.ts would also need updating; I did NOT touch it."',
        '}',
        '```',
      ].join('\n');

      const module = wireModuleWithExecuteResult(
        [{ path: 'src/a.ts', content: 'x' }, { path: 'src/b.ts', content: 'y' }],
        resultText,
      );
      const result = await module.generate(baseInput());

      const issues: CrossFileIssue[] = result.crossFileIssues ?? [];
      const discovery = issues.find(i => i.issueType === 'plan-discovered-missing' && i.filePath === '(LLM-flagged)');
      expect(discovery).to.exist;
      expect(discovery!.description).to.match(/would also need/);
    });

    it('flags declared-but-uncaptured-and-unplanned paths as plan-discovered-missing', async () => {
      // The LLM claims it modified src/d.ts (not in plan), but git diff did
      // not capture it. That mismatch becomes a plan-discovered-missing entry.
      const resultText = [
        '```json',
        '{',
        '  "files_modified": ["src/a.ts", "src/b.ts", "src/d.ts"],',
        '  "files_created": [],',
        '  "summary": "Implemented per plan."',
        '}',
        '```',
      ].join('\n');

      const module = wireModuleWithExecuteResult(
        [{ path: 'src/a.ts', content: 'x' }, { path: 'src/b.ts', content: 'y' }],
        resultText,
      );
      const result = await module.generate(baseInput());

      const issues: CrossFileIssue[] = result.crossFileIssues ?? [];
      const declared = issues.find(i => i.issueType === 'plan-discovered-missing' && i.filePath === 'src/d.ts');
      expect(declared).to.exist;
      expect(declared!.description).to.match(/git diff did not capture/);
    });

    it('does NOT flag declared paths that ARE in the plan (no false positive)', async () => {
      // LLM declares modifying src/a.ts — and it IS in the plan AND captured.
      const resultText = [
        '```json',
        '{',
        '  "files_modified": ["src/a.ts", "src/b.ts"],',
        '  "files_created": [],',
        '  "summary": "Done."',
        '}',
        '```',
      ].join('\n');

      const module = wireModuleWithExecuteResult(
        [{ path: 'src/a.ts', content: 'x' }, { path: 'src/b.ts', content: 'y' }],
        resultText,
      );
      const result = await module.generate(baseInput());

      const issues: CrossFileIssue[] = result.crossFileIssues ?? [];
      expect(issues.filter(i => i.issueType === 'plan-discovered-missing')).to.have.length(0);
    });

    it('does NOT flag prose summaries that lack the discovery hint regex', async () => {
      const resultText = [
        '```json',
        '{',
        '  "files_modified": ["src/a.ts", "src/b.ts"],',
        '  "files_created": [],',
        '  "summary": "Plain summary without any hint phrases."',
        '}',
        '```',
      ].join('\n');

      const module = wireModuleWithExecuteResult(
        [{ path: 'src/a.ts', content: 'x' }, { path: 'src/b.ts', content: 'y' }],
        resultText,
      );
      const result = await module.generate(baseInput());

      const issues: CrossFileIssue[] = result.crossFileIssues ?? [];
      expect(issues.filter(i => i.filePath === '(LLM-flagged)')).to.have.length(0);
    });

    it('silently degrades when the CLI did not emit a JSON summary block', async () => {
      // Only prose, no JSON. extraction returns null and contributes no issues.
      const module = wireModuleWithExecuteResult(
        [{ path: 'src/a.ts', content: 'x' }, { path: 'src/b.ts', content: 'y' }],
        'All done. I implemented both files.',
      );
      const result = await module.generate(baseInput());

      const issues: CrossFileIssue[] = result.crossFileIssues ?? [];
      expect(issues.filter(i => i.issueType === 'plan-discovered-missing')).to.have.length(0);
    });

    it('parses a whitespace-heavy ```json fence in linear time (S8786)', () => {
      // Cubic on the old `\`\`\`json\s*([\s\S]+?)\s*\`\`\``; the surrounding `\s*`
      // overlapped the whitespace-matching `[\s\S]+?`. Unterminated fence + a long
      // whitespace run is the trigger.
      const pathological = '```json' + ' '.repeat(20000); // no closing fence
      const start = process.hrtime.bigint();
      const issues = extractLlmDiscoveryIssues(pathological, [], []);
      const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
      expect(issues).to.deep.equal([]);
      expect(elapsedMs).to.be.below(100);
    });

    it('still parses a bare {...} summary via the fallback after dropping the lookahead', () => {
      // No ```json fence, so extraction uses the `{...}` fallback. Dropping the
      // redundant `(?![\s\S]*\})` lookahead must not change what it extracts.
      const resultText = [
        'All done. Here is the summary:',
        '{"files_modified": [], "files_created": [], "summary": "I discovered src/z.ts would also need updating."}',
      ].join('\n');
      const issues = extractLlmDiscoveryIssues(resultText, [], []);
      const discovery = issues.find(i => /would also need/.test(i.description ?? ''));
      expect(discovery, 'fallback should parse the bare {...} block and surface the hint').to.exist;
    });
  });

  describe('V1 plan-adherence reconciliation (A.12)', () => {
    /**
     * Multi-item plan so the tests can demonstrate missing/extra independently
     * of each other.
     */
    const multiPlanText = [
      '=== PLAN ===',
      '1. CREATE src/a.ts - implement A',
      '2. MODIFY src/b.ts - update B',
      '=== END PLAN ===',
    ].join('\n');

    const wireModule = (capturedFiles: { path: string; content: string }[]) => {
      const spawnStub = sinon.stub()
        .onFirstCall().resolves('plan stdout')
        .onSecondCall().resolves('execute stdout');
      const snapshotStub = sinon.stub().resolves({ headSha: 'abc1234', stashRef: null, baselineUntracked: [] });
      const captureStub = sinon.stub().resolves(capturedFiles);
      const rollbackStub = sinon.stub().resolves({ reset: 'ok', clean: 'ok', stashPop: 'skipped', errors: [] });

      const parseStub = sinon.stub();
      parseStub.onFirstCall().returns({ result: multiPlanText, isError: false, numTurns: 5 });
      parseStub.onSecondCall().returns({ result: 'execute output', isError: false, numTurns: 20 });

      const { ClaudeCodeCLICodeGenModule } = proxyquire('../../../../../src/layers/code-gen/modules/claude-code-cli/index', {
        './cli-driver': {
          spawnClaudeCli: spawnStub,
          parseCliResult: parseStub,
          ClaudeCliPhase: { Plan: 'plan', Execute: 'execute' },
          DEFAULT_MAX_TURNS: 150,
        },
        './workspace': workspaceStub({
          snapshotChtCore: snapshotStub,
          captureChtCoreDiff: captureStub,
          rollbackChtCore: rollbackStub,
        }),
      });
      return new ClaudeCodeCLICodeGenModule();
    };

    it('flags planned-but-not-modified files as plan-adherence-missing', async () => {
      // CLI only modified src/a.ts; src/b.ts (planned MODIFY) was skipped.
      const module = wireModule([{ path: 'src/a.ts', content: 'export const a = 1;\n' }]);
      const result = await module.generate(baseInput());

      const issues: CrossFileIssue[] = result.crossFileIssues ?? [];
      const missing = issues.find(i => i.issueType === 'plan-adherence-missing' && i.filePath === 'src/b.ts');
      expect(missing).to.exist;
      const extra = issues.filter(i => i.issueType === 'plan-adherence-extra');
      expect(extra).to.have.length(0);
    });

    it('flags unplanned modifications as plan-adherence-extra', async () => {
      // CLI modified everything the plan asked for AND an unplanned src/c.ts.
      const module = wireModule([
        { path: 'src/a.ts', content: 'export const a = 1;\n' },
        { path: 'src/b.ts', content: 'export const b = 2;\n' },
        { path: 'src/c.ts', content: 'export const c = 3;\n' },
      ]);
      const result = await module.generate(baseInput());

      const issues: CrossFileIssue[] = result.crossFileIssues ?? [];
      const extra = issues.find(i => i.issueType === 'plan-adherence-extra' && i.filePath === 'src/c.ts');
      expect(extra).to.exist;
      const missing = issues.filter(i => i.issueType === 'plan-adherence-missing');
      expect(missing).to.have.length(0);
    });

    it('produces no adherence issues when the capture exactly matches the plan', async () => {
      const module = wireModule([
        { path: 'src/a.ts', content: 'export const a = 1;\n' },
        { path: 'src/b.ts', content: 'export const b = 2;\n' },
      ]);
      const result = await module.generate(baseInput());

      const issues: CrossFileIssue[] = result.crossFileIssues ?? [];
      expect(issues.filter(i => i.issueType?.startsWith('plan-adherence-'))).to.have.length(0);
    });
  });

  describe('R16 partial-completion detection (A.9)', () => {
    it('sets partialGeneration=true when execute phase returns is_error', async () => {
      const spawnStub = sinon.stub()
        .onFirstCall().resolves('plan stdout')
        .onSecondCall().resolves('execute stdout');
      const snapshotStub = sinon.stub().resolves({ headSha: 'abc1234', stashRef: null, baselineUntracked: [] });
      const captureStub = sinon.stub().resolves([]);
      const rollbackStub = sinon.stub().resolves({ reset: 'ok', clean: 'ok', stashPop: 'skipped', errors: [] });

      // parseCliResult returns isError=false for plan, isError=true for execute.
      const parseStub = sinon.stub();
      parseStub.onFirstCall().returns({ result: planResultText, isError: false, numTurns: 5 });
      parseStub.onSecondCall().returns({ result: 'CLI error message', isError: true, numTurns: 3 });

      const { ClaudeCodeCLICodeGenModule } = proxyquire('../../../../../src/layers/code-gen/modules/claude-code-cli/index', {
        './cli-driver': {
          spawnClaudeCli: spawnStub,
          parseCliResult: parseStub,
          ClaudeCliPhase: { Plan: 'plan', Execute: 'execute' },
          DEFAULT_MAX_TURNS: 150,
        },
        './workspace': workspaceStub({
          snapshotChtCore: snapshotStub,
          captureChtCoreDiff: captureStub,
          rollbackChtCore: rollbackStub,
        }),
      });

      const module = new ClaudeCodeCLICodeGenModule();
      const result = await module.generate(baseInput());

      expect(result.partialGeneration).to.equal(true);
      expect(result.partialGenerationReason).to.match(/is_error=true/);
      expect(rollbackStub.callCount).to.equal(1);
    });

    it('sets partialGeneration=true when numTurns reaches the cap', async () => {
      const spawnStub = sinon.stub()
        .onFirstCall().resolves('plan stdout')
        .onSecondCall().resolves('execute stdout');
      const snapshotStub = sinon.stub().resolves({ headSha: 'abc1234', stashRef: null, baselineUntracked: [] });
      const captureStub = sinon.stub().resolves([]);
      const rollbackStub = sinon.stub().resolves({ reset: 'ok', clean: 'ok', stashPop: 'skipped', errors: [] });

      const parseStub = sinon.stub();
      parseStub.onFirstCall().returns({ result: planResultText, isError: false, numTurns: 5 });
      // numTurns at cap-1 (149 for cap=150) triggers the saturation branch.
      parseStub.onSecondCall().returns({ result: 'execute output', isError: false, numTurns: 149 });

      const { ClaudeCodeCLICodeGenModule } = proxyquire('../../../../../src/layers/code-gen/modules/claude-code-cli/index', {
        './cli-driver': {
          spawnClaudeCli: spawnStub,
          parseCliResult: parseStub,
          ClaudeCliPhase: { Plan: 'plan', Execute: 'execute' },
          DEFAULT_MAX_TURNS: 150,
        },
        './workspace': workspaceStub({
          snapshotChtCore: snapshotStub,
          captureChtCoreDiff: captureStub,
          rollbackChtCore: rollbackStub,
        }),
      });

      const module = new ClaudeCodeCLICodeGenModule();
      const result = await module.generate(baseInput());

      expect(result.partialGeneration).to.equal(true);
      expect(result.partialGenerationReason).to.match(/numTurns=149/);
      expect(result.partialGenerationReason).to.match(/max-turns cap/);
    });

    it('leaves partialGeneration undefined on clean completion', async () => {
      const spawnStub = sinon.stub()
        .onFirstCall().resolves('plan stdout')
        .onSecondCall().resolves('execute stdout');
      const snapshotStub = sinon.stub().resolves({ headSha: 'abc1234', stashRef: null, baselineUntracked: [] });
      // Return at least one file so the R17 relaxed retry does NOT fire — this
      // test is about partialGeneration, not the retry path.
      const captureStub = sinon.stub().resolves([{ path: 'src/a.ts', content: 'x' }]);
      const rollbackStub = sinon.stub().resolves({ reset: 'ok', clean: 'ok', stashPop: 'skipped', errors: [] });

      const parseStub = sinon.stub();
      parseStub.onFirstCall().returns({ result: planResultText, isError: false, numTurns: 5 });
      parseStub.onSecondCall().returns({ result: 'execute output', isError: false, numTurns: 50 });

      const { ClaudeCodeCLICodeGenModule } = proxyquire('../../../../../src/layers/code-gen/modules/claude-code-cli/index', {
        './cli-driver': {
          spawnClaudeCli: spawnStub,
          parseCliResult: parseStub,
          ClaudeCliPhase: { Plan: 'plan', Execute: 'execute' },
          DEFAULT_MAX_TURNS: 150,
        },
        './workspace': workspaceStub({
          snapshotChtCore: snapshotStub,
          captureChtCoreDiff: captureStub,
          rollbackChtCore: rollbackStub,
        }),
      });

      const module = new ClaudeCodeCLICodeGenModule();
      const result = await module.generate(baseInput());

      expect(result.partialGeneration).to.equal(false);
      expect(result.partialGenerationReason).to.be.undefined;
    });
  });
});
