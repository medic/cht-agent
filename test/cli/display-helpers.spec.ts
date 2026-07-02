import { expect } from 'chai';
import * as sinon from 'sinon';
import { validateEnvironment } from '../../src/cli/display-helpers';

/**
 * validateEnvironment gates the research CLI. Its behavior is driven by env:
 * isUsingCLIProvider() reads process.env.LLM_PROVIDER at call time, so we drive
 * the guard's truth table purely through env vars — no module mocking needed.
 *
 * process.exit is stubbed as a no-op, which is safe here: nothing runs after the
 * process.exit(1) call inside validateEnvironment, so a stubbed (non-throwing)
 * exit simply lets the function return without side effects.
 */
describe('cli/display-helpers validateEnvironment', () => {
  let savedProvider: string | undefined;
  let savedApiKey: string | undefined;
  let exitStub: sinon.SinonStub;
  let errorStub: sinon.SinonStub;
  let logStub: sinon.SinonStub;

  beforeEach(() => {
    // Snapshot then clear both vars so ambient container env (LLM_PROVIDER /
    // ANTHROPIC_API_KEY) cannot leak into the guard's decision.
    savedProvider = process.env.LLM_PROVIDER;
    savedApiKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.LLM_PROVIDER;
    delete process.env.ANTHROPIC_API_KEY;
    exitStub = sinon.stub(process, 'exit');
    errorStub = sinon.stub(console, 'error');
    logStub = sinon.stub(console, 'log');
  });

  afterEach(() => {
    sinon.restore();
    if (savedProvider === undefined) delete process.env.LLM_PROVIDER;
    else process.env.LLM_PROVIDER = savedProvider;
    if (savedApiKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = savedApiKey;
  });

  it('exits 1 with an ANTHROPIC_API_KEY error when LLM_PROVIDER is unset and no key is set', () => {
    validateEnvironment();
    expect(exitStub.calledOnceWithExactly(1)).to.equal(true);
    expect(errorStub.firstCall.args[0]).to.include('ANTHROPIC_API_KEY');
  });

  it('does not exit when LLM_PROVIDER is unset and ANTHROPIC_API_KEY is set', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    validateEnvironment();
    expect(exitStub.called).to.equal(false);
  });

  it('does not exit and logs a claude-cli info line when LLM_PROVIDER=claude-cli and no key is set', () => {
    process.env.LLM_PROVIDER = 'claude-cli';
    validateEnvironment();
    expect(exitStub.called).to.equal(false);
    expect(logStub.firstCall.args[0]).to.include('claude-cli');
  });

  it('still exits 1 when LLM_PROVIDER=anthropic and no key is set (relaxation must not leak)', () => {
    process.env.LLM_PROVIDER = 'anthropic';
    validateEnvironment();
    expect(exitStub.calledOnceWithExactly(1)).to.equal(true);
  });

  it('does not exit when LLM_PROVIDER=claude-cli and ANTHROPIC_API_KEY is also set', () => {
    process.env.LLM_PROVIDER = 'claude-cli';
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    validateEnvironment();
    expect(exitStub.called).to.equal(false);
  });
});
