/* eslint-disable @typescript-eslint/no-var-requires */
import { expect } from 'chai';
import sinon from 'sinon';
import { EventEmitter } from 'events';
import { ClaudeCliPhase } from '../../../../../src/layers/code-gen/modules/claude-code-cli/cli-driver';

const proxyquire = require('proxyquire').noCallThru();

const buildFakeProc = (resultJson: string) => {
  const fakeStdout = new EventEmitter();
  const fakeStderr = new EventEmitter();
  const fakeProc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: { end: (chunk?: string) => void };
    kill: () => void;
  };
  fakeProc.stdout = fakeStdout;
  fakeProc.stderr = fakeStderr;
  fakeProc.stdin = { end: () => undefined };
  fakeProc.kill = () => undefined;
  setImmediate(() => {
    fakeStdout.emit('data', resultJson);
    fakeProc.emit('close', 0);
  });
  return fakeProc;
};

const standardResult = JSON.stringify({
  type: 'result',
  subtype: 'success',
  result: 'ok',
  session_id: 'x',
  total_cost_usd: 0,
  duration_ms: 1,
  num_turns: 1,
  is_error: false,
});

describe('cli-driver (A.2a)', () => {
  it('builds plan-phase args with read-only tools', async () => {
    const spawnStub = sinon.stub().callsFake(() => buildFakeProc(standardResult));
    const driver = proxyquire('../../../../../src/layers/code-gen/modules/claude-code-cli/cli-driver', {
      'node:child_process': { spawn: spawnStub },
    });

    await driver.spawnClaudeCli('plan prompt', {
      cwd: '/tmp/cht-core',
      allowedTools: ['Read', 'Grep', 'Glob'],
      permissionMode: 'acceptEdits',
      phase: ClaudeCliPhase.Plan,
    });

    const args = spawnStub.firstCall.args[1] as string[];
    expect(args).to.include('-p');
    expect(args).to.include('--allowedTools');
    const allowIdx = args.indexOf('--allowedTools');
    expect(args[allowIdx + 1]).to.equal('Read,Grep,Glob');
    expect(args).to.include('--permission-mode');
    const modeIdx = args.indexOf('--permission-mode');
    expect(args[modeIdx + 1]).to.equal('acceptEdits');
  });

  it('builds execute-phase args with write tools', async () => {
    const spawnStub = sinon.stub().callsFake(() => buildFakeProc(standardResult));
    const driver = proxyquire('../../../../../src/layers/code-gen/modules/claude-code-cli/cli-driver', {
      'node:child_process': { spawn: spawnStub },
    });

    await driver.spawnClaudeCli('execute prompt', {
      cwd: '/tmp/cht-core',
      allowedTools: ['Read', 'Write', 'Edit', 'Grep', 'Glob'],
      permissionMode: 'acceptEdits',
      phase: ClaudeCliPhase.Execute,
    });

    const args = spawnStub.firstCall.args[1] as string[];
    const allowIdx = args.indexOf('--allowedTools');
    expect(args[allowIdx + 1]).to.equal('Read,Write,Edit,Grep,Glob');
  });

  it('does NOT include the prompt as an argv (stdin pipe instead)', async () => {
    let stdinReceived = '';
    const spawnStub = sinon.stub().callsFake(() => {
      const proc = buildFakeProc(standardResult);
      proc.stdin = { end: (chunk?: string) => { stdinReceived = chunk ?? ''; } };
      return proc;
    });
    const driver = proxyquire('../../../../../src/layers/code-gen/modules/claude-code-cli/cli-driver', {
      'node:child_process': { spawn: spawnStub },
    });

    await driver.spawnClaudeCli('A very long prompt that should go via stdin', {
      cwd: '/tmp/cht-core',
      allowedTools: ['Read'],
      permissionMode: 'acceptEdits',
      phase: ClaudeCliPhase.Plan,
    });

    const args = spawnStub.firstCall.args[1] as string[];
    expect(args).to.not.include('A very long prompt that should go via stdin');
    expect(stdinReceived).to.equal('A very long prompt that should go via stdin');
  });

  describe('parseCliResult (A.7 typed parser)', () => {
    const loadDriver = () => proxyquire('../../../../../src/layers/code-gen/modules/claude-code-cli/cli-driver', {
      'node:child_process': { spawn: sinon.stub() },
    });

    it('extracts is_error=true from a CLI result JSON', () => {
      const driver = loadDriver();
      const json = JSON.stringify({
        type: 'result',
        result: 'partial work',
        is_error: true,
        num_turns: 4,
        session_id: 'abc',
        total_cost_usd: 0.42,
      });
      const parsed = driver.parseCliResult(json);
      expect(parsed.result).to.equal('partial work');
      expect(parsed.isError).to.equal(true);
      expect(parsed.numTurns).to.equal(4);
      expect(parsed.sessionId).to.equal('abc');
      expect(parsed.cost).to.equal(0.42);
    });

    it('returns isError=false on a clean completion JSON', () => {
      const driver = loadDriver();
      const json = JSON.stringify({ type: 'result', result: 'hello', is_error: false, num_turns: 7 });
      const parsed = driver.parseCliResult(json);
      expect(parsed.result).to.equal('hello');
      expect(parsed.isError).to.equal(false);
      expect(parsed.numTurns).to.equal(7);
    });

    it('returns isError=true on empty stdout', () => {
      const driver = loadDriver();
      const parsed = driver.parseCliResult('');
      expect(parsed.result).to.equal('');
      expect(parsed.isError).to.equal(true);
      expect(parsed.numTurns).to.equal(0);
    });

    it('falls back to raw text when stdout is unparseable', () => {
      const driver = loadDriver();
      const parsed = driver.parseCliResult('not-json-at-all');
      expect(parsed.result).to.equal('not-json-at-all');
      expect(parsed.isError).to.equal(false);
    });

    it('reads the result message from an array transcript', () => {
      const driver = loadDriver();
      const stdout = JSON.stringify([
        { type: 'system', subtype: 'init' },
        { type: 'result', result: 'done', is_error: false, num_turns: 7, total_cost_usd: 1.5 },
      ]);
      const parsed = driver.parseCliResult(stdout);
      expect(parsed.result).to.equal('done');
      expect(parsed.numTurns).to.equal(7);
      expect(parsed.cost).to.equal(1.5);
    });

    it('reports the costliest model and summed usage from modelUsage', () => {
      const driver = loadDriver();
      const stdout = JSON.stringify([
        { type: 'system', subtype: 'init', model: 'claude-opus-5-5' },
        { type: 'result', result: 'done', num_turns: 3, total_cost_usd: 2.1, modelUsage: {
          'claude-haiku-4-5-20251001': { inputTokens: 100, outputTokens: 10, costUSD: 0.1 },
          'claude-opus-5-5': { inputTokens: 5, cacheReadInputTokens: 900, cacheCreationInputTokens: 95, outputTokens: 40, costUSD: 2 },
        } },
      ]);
      const parsed = driver.parseCliResult(stdout);
      expect(parsed.model).to.equal('claude-opus-5-5');
      expect(parsed.usage).to.deep.equal({ inputTokens: 1100, outputTokens: 50 });
    });

    it('returns isError=true for an array transcript with no result message', () => {
      const driver = loadDriver();
      const parsed = driver.parseCliResult(JSON.stringify([{ type: 'system', subtype: 'init' }]));
      expect(parsed.isError).to.equal(true);
    });

    it('handles plain non-result JSON via the fallback parser', () => {
      const driver = loadDriver();
      const json = JSON.stringify({ result: 'plain', is_error: false, num_turns: 2 });
      const parsed = driver.parseCliResult(json);
      expect(parsed.result).to.equal('plain');
      expect(parsed.numTurns).to.equal(2);
    });
  });
});
