/* eslint-disable @typescript-eslint/no-var-requires */
import { expect } from 'chai';
import sinon from 'sinon';
import { EventEmitter } from 'events';
import { LLMProvider } from '../../../src/llm/types';

const proxyquire = require('proxyquire').noCallThru();

// Each createClaudeCLIProvider invocation registers two `process.once` signal
// handlers (SIGINT + SIGTERM) for in-flight subprocess cleanup. Spec files
// that exercise the factory many times exceed Node's default 10-listener cap
// and emit a noisy MaxListenersExceededWarning. Lifting the cap at test scope
// silences the noise without affecting production behavior.
process.setMaxListeners(0);

/** Build a fake ChildProcess that emits stdout JSON and closes with code 0. */
const buildFakeProc = (
  events: Array<{
    stdout?: string;
    stderr?: string;
    closeCode?: number | null;
    errorCode?: string;
    delay?: number;
  }>,
) => {
  const fakeStdout = new EventEmitter();
  const fakeStderr = new EventEmitter();
  let stdinReceived = '';
  const fakeProc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: { end: (chunk?: string) => void };
    kill: (signal: string) => void;
  };
  fakeProc.stdout = fakeStdout;
  fakeProc.stderr = fakeStderr;
  fakeProc.stdin = { end: (chunk?: string) => { stdinReceived = chunk ?? ''; } };
  let killed = false;
  fakeProc.kill = () => { killed = true; };
  setImmediate(() => {
    for (const ev of events) {
      const fire = () => {
        if (ev.stdout !== undefined) fakeStdout.emit('data', ev.stdout);
        if (ev.stderr !== undefined) fakeStderr.emit('data', ev.stderr);
        if (ev.errorCode) {
          const err = Object.assign(new Error(`spawn ${ev.errorCode}`), { code: ev.errorCode });
          fakeProc.emit('error', err);
        }
        if (ev.closeCode !== undefined) fakeProc.emit('close', ev.closeCode);
      };
      if (ev.delay) setTimeout(fire, ev.delay);
      else fire();
    }
  });
  return {
    proc: fakeProc,
    getStdin: () => stdinReceived,
    isKilled: () => killed,
  };
};

const cliResultJson = (overrides: Record<string, unknown> = {}): string =>
  JSON.stringify({
    type: 'result',
    subtype: 'success',
    result: 'ok',
    session_id: 'sess-1',
    total_cost_usd: 0.01,
    duration_ms: 100,
    num_turns: 1,
    is_error: false,
    ...overrides,
  });

interface SpawnLog {
  cmd: string;
  args: string[];
}

const loadProvider = (
  procEvents: Array<{
    stdout?: string;
    stderr?: string;
    closeCode?: number | null;
    errorCode?: string;
    delay?: number;
  }>,
): { provider: LLMProvider; spawnArgs: SpawnLog[]; getStdin: () => string } => {
  const spawnArgs: SpawnLog[] = [];
  let fakeWrap: ReturnType<typeof buildFakeProc>;
  const spawnStub = sinon.stub().callsFake((cmd: string, args: string[]) => {
    spawnArgs.push({ cmd, args });
    fakeWrap = buildFakeProc(procEvents);
    return fakeWrap.proc;
  });
  const mod = proxyquire('../../../src/llm/providers/claude-cli', {
    'node:child_process': { spawn: spawnStub },
  });
  return {
    provider: mod.createClaudeCLIProvider() as LLMProvider,
    spawnArgs,
    getStdin: () => fakeWrap.getStdin(),
  };
};

describe('createClaudeCLIProvider (v9a.7) — spawn-arg construction', () => {
  it('passes -p / --output-format json / --max-turns and the prompt via stdin (R4 lesson)', async () => {
    const { provider, spawnArgs, getStdin } = loadProvider([
      { stdout: cliResultJson({ result: 'hello' }), closeCode: 0 },
    ]);
    await provider.invoke('a long prompt that must not be in argv');
    expect(spawnArgs).to.have.length(1);
    expect(spawnArgs[0].cmd).to.equal('claude');
    expect(spawnArgs[0].args).to.include('-p');
    expect(spawnArgs[0].args).to.include('--output-format');
    expect(spawnArgs[0].args[spawnArgs[0].args.indexOf('--output-format') + 1]).to.equal('json');
    expect(spawnArgs[0].args).to.include('--max-turns');
    expect(spawnArgs[0].args).to.not.include('a long prompt that must not be in argv');
    expect(getStdin()).to.equal('a long prompt that must not be in argv');
  });

  it('includes --dangerously-skip-permissions by default', async () => {
    const { provider, spawnArgs } = loadProvider([
      { stdout: cliResultJson(), closeCode: 0 },
    ]);
    await provider.invoke('p');
    expect(spawnArgs[0].args).to.include('--dangerously-skip-permissions');
  });

  it('serializes --disallowedTools when options.disableTools=true', async () => {
    const { provider, spawnArgs } = loadProvider([
      { stdout: cliResultJson(), closeCode: 0 },
    ]);
    await provider.invoke('p', { disableTools: true });
    const idx = spawnArgs[0].args.indexOf('--disallowedTools');
    expect(idx).to.be.greaterThan(-1);
    const list = spawnArgs[0].args[idx + 1];
    expect(list).to.include('Bash');
    expect(list).to.include('Write');
    expect(list).to.include('Read');
  });

  it('honors per-invoke maxTurns override', async () => {
    const { provider, spawnArgs } = loadProvider([
      { stdout: cliResultJson(), closeCode: 0 },
    ]);
    await provider.invoke('p', { maxTurns: 75 });
    const idx = spawnArgs[0].args.indexOf('--max-turns');
    expect(spawnArgs[0].args[idx + 1]).to.equal('75');
  });
});

describe('createClaudeCLIProvider (v9a.7) — response handling', () => {
  it('returns content + model + end_turn stop reason on a successful invoke', async () => {
    const { provider } = loadProvider([
      { stdout: cliResultJson({ result: 'the answer' }), closeCode: 0 },
    ]);
    const result = await provider.invoke('p');
    expect(result.content).to.equal('the answer');
    expect(result.model).to.equal('claude-cli');
    expect(result.stopReason).to.equal('end_turn');
  });

  it('throws "Claude CLI error: <result>" when the JSON has is_error=true', async () => {
    const { provider } = loadProvider([
      { stdout: cliResultJson({ result: 'auth failed', is_error: true, subtype: 'error' }), closeCode: 0 },
    ]);
    let caught: Error | null = null;
    try { await provider.invoke('p'); } catch (e) { caught = e as Error; }
    expect(caught).to.not.equal(null);
    expect(caught!.message).to.match(/Claude CLI error: auth failed/);
  });

  it('falls back to treating non-JSON stdout as the result content', async () => {
    const { provider } = loadProvider([
      { stdout: 'plain text completion', closeCode: 0 },
    ]);
    const result = await provider.invoke('p');
    expect(result.content).to.equal('plain text completion');
  });

  it('extracts the result JSON even when stdout has noise before/after the JSON block', async () => {
    const { provider } = loadProvider([
      {
        stdout: `prefix log\n${cliResultJson({ result: 'extracted' })}\nsome suffix`,
        closeCode: 0,
      },
    ]);
    const result = await provider.invoke('p');
    expect(result.content).to.equal('extracted');
  });

  it('rejects with ENOENT-typed message when spawn fires error with code=ENOENT', async () => {
    const { provider } = loadProvider([
      { errorCode: 'ENOENT' },
    ]);
    let caught: Error | null = null;
    try { await provider.invoke('p'); } catch (e) { caught = e as Error; }
    expect(caught).to.not.equal(null);
    expect(caught!.message).to.match(/Claude Code CLI not found/);
    expect(caught!.message).to.match(/@anthropic-ai\/claude-code/);
  });

  it('rejects with EACCES-typed message when spawn fires error with code=EACCES', async () => {
    const { provider } = loadProvider([
      { errorCode: 'EACCES' },
    ]);
    let caught: Error | null = null;
    try { await provider.invoke('p'); } catch (e) { caught = e as Error; }
    expect(caught).to.not.equal(null);
    expect(caught!.message).to.match(/Permission denied/);
  });

  it('rejects when CLI exits non-zero with no stdout', async () => {
    const { provider } = loadProvider([
      { stderr: 'boom', closeCode: 1 },
    ]);
    let caught: Error | null = null;
    try { await provider.invoke('p'); } catch (e) { caught = e as Error; }
    expect(caught).to.not.equal(null);
    expect(caught!.message).to.match(/exited with code 1/);
    expect(caught!.message).to.match(/boom/);
  });
});

describe('createClaudeCLIProvider (v9a.7) — invokeWithMessages / invokeForJSON', () => {
  it('invokeWithMessages flattens role-tagged messages into a single prompt and trails with [Assistant]:', async () => {
    const { provider, getStdin } = loadProvider([
      { stdout: cliResultJson({ result: 'ok' }), closeCode: 0 },
    ]);
    await provider.invokeWithMessages([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'u1' },
      { role: 'assistant', content: 'a1' },
    ]);
    expect(getStdin()).to.include('[System]: sys');
    expect(getStdin()).to.include('[User]: u1');
    expect(getStdin()).to.include('[Assistant]: a1');
    // Trailing prompt slot for the next assistant turn.
    expect(getStdin()).to.match(/\[Assistant\]:\s*$/);
  });

  it('invokeForJSON parses a JSON-only response', async () => {
    const { provider } = loadProvider([
      { stdout: cliResultJson({ result: '{"answer": 42}' }), closeCode: 0 },
    ]);
    const result = await provider.invokeForJSON<{ answer: number }>('p');
    expect(result.answer).to.equal(42);
  });

  it('invokeForJSON strips ```json fences before parsing', async () => {
    const { provider } = loadProvider([
      { stdout: cliResultJson({ result: '```json\n{"k":"v"}\n```' }), closeCode: 0 },
    ]);
    const result = await provider.invokeForJSON<{ k: string }>('p');
    expect(result.k).to.equal('v');
  });

  it('invokeForJSON throws when result is empty', async () => {
    const { provider } = loadProvider([
      { stdout: cliResultJson({ result: '' }), closeCode: 0 },
    ]);
    let caught: Error | null = null;
    try { await provider.invokeForJSON<unknown>('p'); } catch (e) { caught = e as Error; }
    expect(caught).to.not.equal(null);
    expect(caught!.message).to.match(/empty response/);
  });

  it('invokeForJSON throws when no JSON object is found in the response', async () => {
    const { provider } = loadProvider([
      { stdout: cliResultJson({ result: 'just plain prose' }), closeCode: 0 },
    ]);
    let caught: Error | null = null;
    try { await provider.invokeForJSON<unknown>('p'); } catch (e) { caught = e as Error; }
    expect(caught).to.not.equal(null);
    expect(caught!.message).to.match(/did not contain valid JSON/);
  });

  it('invokeForJSON strips trailing commas before parsing', async () => {
    const { provider } = loadProvider([
      { stdout: cliResultJson({ result: '{"a":1, "b":[1,2,],}' }), closeCode: 0 },
    ]);
    const result = await provider.invokeForJSON<{ a: number; b: number[] }>('p');
    expect(result.a).to.equal(1);
    expect(result.b).to.deep.equal([1, 2]);
  });
});

describe('validateClaudeCLI (v9a.7)', () => {
  /** validateClaudeCLI uses spawn directly; can't reuse the loader. */
  const loadValidate = (events: Array<{ stdout?: string; closeCode?: number | null; errorCode?: string }>) => {
    const spawnStub = sinon.stub().callsFake(() => buildFakeProc(events).proc);
    return proxyquire('../../../src/llm/providers/claude-cli', {
      'node:child_process': { spawn: spawnStub },
    });
  };

  it('returns {valid: true, version} when --version exits 0', async () => {
    const mod = loadValidate([{ stdout: 'claude-code 1.2.3\n', closeCode: 0 }]);
    const result = await mod.validateClaudeCLI();
    expect(result.valid).to.equal(true);
    expect(result.version).to.equal('claude-code 1.2.3');
  });

  it('returns {valid: false, error} when --version exits non-zero', async () => {
    const mod = loadValidate([{ closeCode: 2 }]);
    const result = await mod.validateClaudeCLI();
    expect(result.valid).to.equal(false);
    expect(result.error).to.match(/exited with code 2/);
  });

  it('returns {valid: false, error} when spawn fires an error event (binary not on PATH)', async () => {
    const mod = loadValidate([{ errorCode: 'ENOENT' }]);
    const result = await mod.validateClaudeCLI('/missing/path/to/claude');
    expect(result.valid).to.equal(false);
    expect(result.error).to.match(/CLI not found at/);
  });
});
