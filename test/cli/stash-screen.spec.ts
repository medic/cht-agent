/* eslint-disable @typescript-eslint/no-var-requires */
import { expect } from 'chai';
import sinon from 'sinon';
import { EventEmitter } from 'node:events';
import * as realWorkspace from '../../src/layers/code-gen/modules/claude-code-cli/workspace';
import {
  LeftoverStash,
  WorkspaceSafetyError,
  leftoverStashLines,
  reportSafetyError,
} from '../../src/layers/code-gen/modules/claude-code-cli/workspace';
import { __resetStashPolicyForTests, acceptSpareStash, getStashPolicy } from '../../src/utils/stash-policy';

const proxyquire = require('proxyquire').noCallThru();

const CHT = '/tmp/cht-core';
const FIRST: LeftoverStash = { name: 'cht-agent-claude-code-cli-1', sha: 'a'.repeat(40), createdAt: 1700000000, age: '2 days ago' };
const SECOND: LeftoverStash = { name: 'cht-agent-claude-code-cli-2', sha: 'b'.repeat(40), createdAt: 1700000000, age: '2 days ago' };
const NO_TERMINAL_LINE =
  'No terminal to ask on, so the run stops. To continue and leave the stash in place, set CHT_AGENT_IGNORE_LEAKED_STASH=true.';

/** The screen module with the leftover list, the `.git` check and (optionally) readline replaced. */
const loadScreen = (list: sinon.SinonStub, opts: { git?: boolean; readline?: unknown } = {}) =>
  proxyquire('../../src/cli/stash-screen', {
    'node:fs': { existsSync: sinon.stub().returns(opts.git ?? true) },
    '../layers/code-gen/modules/claude-code-cli/workspace': { ...realWorkspace, listLeftoverStashes: list },
    ...(opts.readline ? { 'node:readline/promises': opts.readline } : {}),
  });

describe('stash-screen', () => {
  let errorSpy: sinon.SinonStub;
  let warnSpy: sinon.SinonStub;
  beforeEach(() => {
    errorSpy = sinon.stub(console, 'error');
    warnSpy = sinon.stub(console, 'warn');
  });
  afterEach(() => sinon.restore());

  const printed = (spy: sinon.SinonStub) => spy.getCalls().map(c => String(c.args[0]));
  const terminal = (ask: sinon.SinonStub) => ({ interactive: true, ask, env: {} });
  /** The check's result, or a failed assert that names why it threw. */
  const noThrow = <T>(p: Promise<T>): Promise<T> => p.catch((e: Error) => expect.fail(`the check threw: ${e.message}`));
  const headless = (value: string | undefined) => ({
    interactive: false, ask: sinon.stub(), env: { CHT_AGENT_IGNORE_LEAKED_STASH: value },
  });

  describe('runLeftoverCheck on a terminal', () => {
    it('asks again after "I restored it myself" while a leftover is left, naming only the ones left', async () => {
      const list = sinon.stub();
      list.onCall(0).resolves([FIRST, SECOND]);
      list.onCall(1).resolves([SECOND]);
      list.onCall(2).resolves([]);
      const ask = sinon.stub().resolves(0);
      const screen = loadScreen(list);
      expect(await screen.runLeftoverCheck(CHT, terminal(ask))).to.deep.equal([]);
      expect(list.callCount).to.equal(3);
      expect(ask.callCount).to.equal(2);
      const firstLine = leftoverStashLines(CHT, [FIRST, SECOND])[0];
      const secondLine = leftoverStashLines(CHT, [SECOND])[0];
      expect(printed(errorSpy).filter(l => l.includes('leftover cht-agent stash'))).to.deep.equal([
        `[cht-agent] ${firstLine}`,
        `[cht-agent] ${secondLine}`,
      ]);
    });

    it('asks with the three choices and gives the SHAs on "Continue anyway"', async () => {
      const ask = sinon.stub().resolves(1);
      const screen = loadScreen(sinon.stub().resolves([FIRST, SECOND]));
      expect(await screen.runLeftoverCheck(CHT, terminal(ask))).to.deep.equal([FIRST.sha, SECOND.sha]);
      expect(ask.firstCall.args).to.deep.equal(['What do you want to do?', [
        'I restored it myself, continue',
        'Continue anyway (the stash stays; this run never pops or drops it)',
        'Abort',
      ]]);
    });

    it('throws the shown error on Abort, printed once', async () => {
      const screen = loadScreen(sinon.stub().resolves([FIRST]));
      const err = await screen.runLeftoverCheck(CHT, terminal(sinon.stub().resolves(2))).catch((e: unknown) => e);
      expect(err).to.be.instanceOf(WorkspaceSafetyError);
      expect((err as WorkspaceSafetyError).kind).to.equal('precondition');
      const lines = leftoverStashLines(CHT, [FIRST]);
      expect((err as WorkspaceSafetyError).lines).to.deep.equal(lines);
      expect(printed(errorSpy)).to.deep.equal(lines.map(l => `[cht-agent] ${l}`));
      reportSafetyError(err, '[cht-agent]');
      expect(errorSpy.callCount).to.equal(lines.length);
    });

    it('reads a closed input or Ctrl-C (null) as Abort', async () => {
      const screen = loadScreen(sinon.stub().resolves([FIRST]));
      const err = await screen.runLeftoverCheck(CHT, terminal(sinon.stub().resolves(null))).catch((e: unknown) => e);
      expect((err as WorkspaceSafetyError).kind).to.equal('precondition');
    });

    it('ignores CHT_AGENT_IGNORE_LEAKED_STASH on a terminal', async () => {
      const ask = sinon.stub().resolves(2);
      const screen = loadScreen(sinon.stub().resolves([FIRST]));
      const io = { interactive: true, ask, env: { CHT_AGENT_IGNORE_LEAKED_STASH: 'true' } };
      const err = await screen.runLeftoverCheck(CHT, io).catch((e: unknown) => e);
      expect(ask.calledOnce).to.equal(true);
      expect((err as WorkspaceSafetyError).kind).to.equal('precondition');
    });
  });

  describe('runLeftoverCheck without a terminal', () => {
    for (const value of ['true', ' TRUE ']) {
      it(`continues and keeps the stash when CHT_AGENT_IGNORE_LEAKED_STASH is ${JSON.stringify(value)}`, async () => {
        const io = headless(value);
        const screen = loadScreen(sinon.stub().resolves([FIRST]));
        expect(await noThrow(screen.runLeftoverCheck(CHT, io))).to.deep.equal([FIRST.sha]);
        expect(io.ask.called).to.equal(false);
        expect(printed(warnSpy)).to.deep.equal([
          ...leftoverStashLines(CHT, [FIRST]).map(l => `[cht-agent] ${l}`),
          '[cht-agent] CHT_AGENT_IGNORE_LEAKED_STASH=true: continuing. The stash stays, and this run never pops or drops it.',
        ]);
      });
    }

    for (const value of [undefined, 'false', '1', 'yes', '']) {
      it(`stops, with the env line, when CHT_AGENT_IGNORE_LEAKED_STASH is ${JSON.stringify(value)}`, async () => {
        const io = headless(value);
        const screen = loadScreen(sinon.stub().resolves([FIRST]));
        const err = await screen.runLeftoverCheck(CHT, io).catch((e: unknown) => e) as WorkspaceSafetyError;
        expect(err.kind).to.equal('precondition');
        expect(err.lines).to.deep.equal([...leftoverStashLines(CHT, [FIRST]), NO_TERMINAL_LINE]);
        expect(io.ask.called).to.equal(false);
        expect(printed(errorSpy)).to.deep.equal([]);
        expect(printed(warnSpy)).to.deep.equal([]);
      });
    }
  });

  describe('runLeftoverCheck in any mode', () => {
    it('skips the check, with no git read, when the path is not a git checkout', async () => {
      const list = sinon.stub().resolves([FIRST]);
      const ask = sinon.stub();
      const screen = loadScreen(list, { git: false });
      expect(await noThrow(screen.runLeftoverCheck(CHT, terminal(ask)))).to.deep.equal([]);
      expect(list.called).to.equal(false);
      expect(ask.called).to.equal(false);
    });

    it('asks nothing, and stops nothing, when there is no leftover', async () => {
      const ask = sinon.stub();
      const screen = loadScreen(sinon.stub().resolves([]));
      expect(await screen.runLeftoverCheck(CHT, terminal(ask))).to.deep.equal([]);
      expect(await noThrow(screen.runLeftoverCheck(CHT, headless(undefined)))).to.deep.equal([]);
      expect(ask.called).to.equal(false);
    });

    it('warns once and goes on when the stash list cannot be read', async () => {
      const message = 'cht-agent could not read the stash list (fatal: bad config); nothing was changed.';
      const list = sinon.stub().rejects(new WorkspaceSafetyError('precondition', message, { lines: [message] }));
      const ask = sinon.stub();
      const screen = loadScreen(list);
      expect(await noThrow(screen.runLeftoverCheck(CHT, terminal(ask)))).to.deep.equal([]);
      expect(ask.called).to.equal(false);
      expect(printed(warnSpy)).to.deep.equal([
        `[cht-agent] ${message} The run goes on: cht-agent reads the stash list again before it stashes anything.`,
      ]);
    });
  });

  describe('prepareStashPolicy', () => {
    it('sets the SHAs that the operator chose to keep, the resolver and the spare hook', async () => {
      const screen = loadScreen(sinon.stub().resolves([FIRST]));
      try {
        await screen.prepareStashPolicy(CHT, terminal(sinon.stub().resolves(1)));
        const policy = getStashPolicy();
        expect(policy.acceptedLeftoverShas).to.deep.equal([FIRST.sha]);
        expect(policy.resolveStashFailure).to.be.a('function');
        expect(policy.onSpareStash).to.equal(acceptSpareStash);
      } finally {
        __resetStashPolicyForTests();
      }
    });

    it('sets no resolver without a terminal', async () => {
      const screen = loadScreen(sinon.stub().resolves([FIRST]));
      try {
        await screen.prepareStashPolicy(CHT, headless('true'));
        const policy = getStashPolicy();
        expect(policy.acceptedLeftoverShas).to.deep.equal([FIRST.sha]);
        expect(Object.keys(policy)).to.deep.equal(['acceptedLeftoverShas', 'onSpareStash']);
      } finally {
        __resetStashPolicyForTests();
      }
    });
  });

  describe('makeStashFailureResolver', () => {
    const FAILURE = { step: 'push' as const, lines: ['git stash could not save your work'], choices: ['handled', 'retry', 'abort'] as const };

    it("offers the failure's choices with their labels, and gives the chosen one", async () => {
      const ask = sinon.stub().resolves(1);
      const screen = loadScreen(sinon.stub());
      const resolve = screen.makeStashFailureResolver({ interactive: true, ask });
      expect(await resolve(FAILURE)).to.equal('retry');
      expect(ask.firstCall.args).to.deep.equal(['What do you want to do?', ['I handled it myself', 'Retry', 'Abort']]);
    });

    it('offers only the choices that the failure gives', async () => {
      const ask = sinon.stub().resolves(1);
      const screen = loadScreen(sinon.stub());
      const resolve = screen.makeStashFailureResolver({ interactive: true, ask });
      expect(await resolve({ ...FAILURE, choices: ['handled', 'abort'] })).to.equal('abort');
      expect(ask.firstCall.args[1]).to.deep.equal(['I handled it myself', 'Abort']);
    });

    it('reads a closed input or Ctrl-C (null) as Abort', async () => {
      const screen = loadScreen(sinon.stub());
      const resolve = screen.makeStashFailureResolver({ interactive: true, ask: sinon.stub().resolves(null) });
      expect(await resolve(FAILURE)).to.equal('abort');
    });

    it('gives no resolver without a terminal', () => {
      const screen = loadScreen(sinon.stub());
      expect(screen.makeStashFailureResolver({ interactive: false, ask: sinon.stub() })).to.equal(undefined);
    });
  });

  describe('askChoice', () => {
    let isTTY: PropertyDescriptor | undefined;
    beforeEach(() => { isTTY = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY'); });
    afterEach(() => {
      if (isTTY) Object.defineProperty(process.stdin, 'isTTY', isTTY);
      else delete (process.stdin as { isTTY?: boolean }).isTTY;
    });
    const setTerminal = (value: boolean | undefined) =>
      Object.defineProperty(process.stdin, 'isTTY', { value, configurable: true, writable: true });

    /** A readline interface whose question() answers come from `answers`, in order; the rest never settle. */
    class FakeInterface extends EventEmitter {
      prompts: string[] = [];

      closed = false;

      constructor(private readonly answers: Array<(rl: FakeInterface) => Promise<string>>) {
        super();
      }

      question(prompt: string): Promise<string> {
        this.prompts.push(prompt);
        const next = this.answers.shift();
        return next ? next(this) : new Promise<string>(() => undefined);
      }

      close(): void {
        if (this.closed) return;
        this.closed = true;
        this.emit('close');
      }
    }

    const withInterface = (rl: FakeInterface) => {
      const createInterface = sinon.stub().returns(rl);
      return { createInterface, screen: loadScreen(sinon.stub(), { readline: { createInterface } }) };
    };

    it('asks again until the answer is a listed number', async () => {
      setTerminal(true);
      const rl = new FakeInterface(['x', '0', '4', ' 3 '].map(a => () => Promise.resolve(a)));
      const { screen } = withInterface(rl);
      expect(await screen.askChoice('What do you want to do?', ['one', 'two', 'three'])).to.equal(2);
      expect(rl.prompts[0]).to.equal('What do you want to do?\n  1) one\n  2) two\n  3) three\nType 1 to 3: ');
      expect(rl.prompts.slice(1)).to.deep.equal(Array(3).fill('Please type a number from 1 to 3: '));
      expect(rl.closed).to.equal(true);
    });

    it('gives null when the input closes', async () => {
      setTerminal(true);
      const rl = new FakeInterface([self => {
        setImmediate(() => self.close());
        return new Promise<string>(() => undefined);
      }]);
      const { screen } = withInterface(rl);
      expect(await screen.askChoice('Q?', ['one'])).to.equal(null);
    });

    it('gives null on Ctrl-C, and closes the interface', async () => {
      setTerminal(true);
      const rl = new FakeInterface([self => {
        setImmediate(() => self.emit('SIGINT'));
        return new Promise<string>(() => undefined);
      }]);
      const { screen } = withInterface(rl);
      expect(await screen.askChoice('Q?', ['one'])).to.equal(null);
      expect(rl.closed).to.equal(true);
    });

    it('gives null when the question rejects (Ctrl-D on a terminal)', async () => {
      setTerminal(true);
      const rl = new FakeInterface([() => Promise.reject(Object.assign(new Error('aborted'), { code: 'ABORT_ERR' }))]);
      const { screen } = withInterface(rl);
      expect(await screen.askChoice('Q?', ['one'])).to.equal(null);
    });

    it('gives null without a terminal, and makes no interface', async () => {
      setTerminal(undefined);
      const { screen, createInterface } = withInterface(new FakeInterface([() => Promise.resolve('1')]));
      expect(await screen.askChoice('Q?', ['one'])).to.equal(null);
      expect(createInterface.called).to.equal(false);
    });
  });
});
