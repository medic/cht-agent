/* eslint-disable @typescript-eslint/no-var-requires */
import { expect } from 'chai';
import sinon from 'sinon';
import * as util from 'node:util';

const proxyquire = require('proxyquire').noCallThru();

// workspace.ts uses promisify(execFile). Plain functions, when promisified,
// resolve with the FIRST non-error callback arg only. execFile's real
// promisified version returns { stdout, stderr } because Node attaches a
// custom [util.promisify.custom] override. We mirror that here so our stub
// resolves to { stdout, stderr } too.
const stubExecFile = (responses: Record<string, { stdout: string }>) => {
  const fn = (_cmd: string, _args: string[], _opts: object, cb: (err: Error | null, stdout: string, stderr: string) => void) => {
    cb(null, '', ''); // callback path (workspace.ts never uses it)
  };
  (fn as unknown as Record<symbol, unknown>)[util.promisify.custom] = (cmd: string, args: string[]) => {
    const key = `${cmd} ${args.join(' ')}`;
    for (const k of Object.keys(responses)) {
      if (key.startsWith(k)) return Promise.resolve({ stdout: responses[k].stdout, stderr: '' });
    }
    return Promise.resolve({ stdout: '', stderr: '' });
  };
  return fn;
};

const loadWorkspace = (responses: Record<string, { stdout: string }>) => {
  return proxyquire('../../../../../src/layers/code-gen/modules/claude-code-cli/workspace', {
    'node:child_process': { execFile: stubExecFile(responses) },
    'node:fs/promises': {
      readFile: sinon.stub().resolves('file contents'),
    },
  });
};

describe('workspace.ts (A.2b)', () => {
  describe('snapshotChtCore', () => {
    it('captures HEAD SHA and null stash ref when working tree is clean', async () => {
      const ws = loadWorkspace({
        'git rev-parse HEAD': { stdout: 'abc1234deadbeef\n' },
        'git status --porcelain': { stdout: '' },
      });
      const snap = await ws.snapshotChtCore('/tmp/cht-core');
      expect(snap.headSha).to.equal('abc1234deadbeef');
      expect(snap.stashRef).to.equal(null);
    });

    it('stashes uncommitted work and captures the stash ref', async () => {
      const ws = loadWorkspace({
        'git rev-parse HEAD': { stdout: 'abc1234deadbeef\n' },
        'git status --porcelain': { stdout: ' M file.ts\n' },
        'git stash push': { stdout: 'Saved working directory and index state\n' },
        'git stash list': { stdout: 'stash@{0}\n' },
      });
      const snap = await ws.snapshotChtCore('/tmp/cht-core');
      expect(snap.stashRef).to.equal('stash@{0}');
    });

    it('refuses to run if cht-core has unmerged paths', async () => {
      const ws = loadWorkspace({
        'git rev-parse HEAD': { stdout: 'abc1234deadbeef\n' },
        'git status --porcelain': { stdout: 'UU conflict.ts\n' },
      });
      let threw = false;
      try {
        await ws.snapshotChtCore('/tmp/cht-core');
      } catch (err) {
        threw = true;
        expect((err as Error).message).to.match(/unmerged paths|refuse/i);
      }
      expect(threw).to.equal(true);
    });
  });

  describe('captureChtCoreDiff', () => {
    it('parses git diff --name-status A as create and M as modify', async () => {
      const ws = loadWorkspace({
        'git diff --name-status abc1234': { stdout: 'A\tsrc/new.ts\nM\tsrc/changed.ts\n' },
        'git ls-files --others --exclude-standard': { stdout: '' },
        'git show': { stdout: 'old content' },
      });
      const files = await ws.captureChtCoreDiff('/tmp/cht-core', 'abc1234');
      const create = files.find((f: { path: string }) => f.path === 'src/new.ts');
      const modify = files.find((f: { path: string }) => f.path === 'src/changed.ts');
      expect(create).to.exist;
      expect(create.originalContent).to.equal(undefined);
      expect(modify).to.exist;
      expect(modify.originalContent).to.equal('old content');
    });

    it('includes untracked files as create', async () => {
      const ws = loadWorkspace({
        'git diff --name-status abc1234': { stdout: '' },
        'git ls-files --others --exclude-standard': { stdout: 'src/untracked.ts\n' },
      });
      const files = await ws.captureChtCoreDiff('/tmp/cht-core', 'abc1234');
      expect(files.find((f: { path: string }) => f.path === 'src/untracked.ts')).to.exist;
    });

    it('skips deletes', async () => {
      const ws = loadWorkspace({
        'git diff --name-status abc1234': { stdout: 'D\tsrc/deleted.ts\nA\tsrc/new.ts\n' },
        'git ls-files --others --exclude-standard': { stdout: '' },
      });
      const files = await ws.captureChtCoreDiff('/tmp/cht-core', 'abc1234');
      expect(files.find((f: { path: string }) => f.path === 'src/deleted.ts')).to.not.exist;
      expect(files.find((f: { path: string }) => f.path === 'src/new.ts')).to.exist;
    });
  });

  describe('rollbackChtCore', () => {
    const trackingStub = (calls: string[]) => {
      const fn = (_cmd: string, _args: string[], _opts: object, cb: (e: Error | null, s: string, t: string) => void) => {
        cb(null, '', '');
      };
      (fn as unknown as Record<symbol, unknown>)[util.promisify.custom] = (cmd: string, args: string[]) => {
        calls.push(`${cmd} ${args.join(' ')}`);
        return Promise.resolve({ stdout: '', stderr: '' });
      };
      return fn;
    };

    it('always runs reset + clean; pops stash if present', async () => {
      const calls: string[] = [];
      const ws = proxyquire('../../../../../src/layers/code-gen/modules/claude-code-cli/workspace', {
        'node:child_process': { execFile: trackingStub(calls) },
        'node:fs/promises': { readFile: sinon.stub().resolves('') },
      });

      await ws.rollbackChtCore('/tmp/cht-core', { headSha: 'abc1234', stashRef: 'stash@{0}' });

      expect(calls.some(c => c.startsWith('git reset --hard abc1234'))).to.equal(true);
      expect(calls.some(c => c.startsWith('git clean -fd'))).to.equal(true);
      expect(calls.some(c => c.startsWith('git stash pop stash@{0}'))).to.equal(true);
    });

    it('skips stash pop when stashRef is null', async () => {
      const calls: string[] = [];
      const ws = proxyquire('../../../../../src/layers/code-gen/modules/claude-code-cli/workspace', {
        'node:child_process': { execFile: trackingStub(calls) },
        'node:fs/promises': { readFile: sinon.stub().resolves('') },
      });

      await ws.rollbackChtCore('/tmp/cht-core', { headSha: 'abc1234', stashRef: null });

      expect(calls.some(c => c.startsWith('git stash pop'))).to.equal(false);
    });
  });

  describe('verify-then-throw pattern (R14/R15)', () => {
    /**
     * Stub that supports both success ({ stdout }) and rejection ({ error })
     * per command-prefix key. Used to simulate git ops that exit non-zero
     * even when their side effect landed.
     */
    const stubWithErrors = (
      responses: Record<string, { stdout: string } | { error: Error }>,
    ) => {
      const fn = (_cmd: string, _args: string[], _opts: object, cb: (e: Error | null, s: string, t: string) => void) => cb(null, '', '');
      (fn as unknown as Record<symbol, unknown>)[util.promisify.custom] = (cmd: string, args: string[]) => {
        const key = `${cmd} ${args.join(' ')}`;
        for (const k of Object.keys(responses)) {
          if (key.startsWith(k)) {
            const r = responses[k];
            if ('error' in r) return Promise.reject(r.error);
            return Promise.resolve({ stdout: r.stdout, stderr: '' });
          }
        }
        return Promise.resolve({ stdout: '', stderr: '' });
      };
      return fn;
    };

    // Stub Date.now so the stash-name is deterministic across the test run.
    const FROZEN_NOW = 1700000000000;
    const EXPECTED_STASH_NAME = `cht-agent-claude-code-cli-${FROZEN_NOW}`;

    beforeEach(() => {
      sinon.stub(Date, 'now').returns(FROZEN_NOW);
    });

    afterEach(() => {
      sinon.restore();
    });

    it('A.4: stash push exits non-zero but stash was created → no throw', async () => {
      const ws = proxyquire('../../../../../src/layers/code-gen/modules/claude-code-cli/workspace', {
        'node:child_process': {
          execFile: stubWithErrors({
            'git rev-parse HEAD': { stdout: 'abc1234\n' },
            'git status --porcelain': { stdout: ' M file.ts\n' },
            'git stash push': { error: new Error('warning: could not remove file') },
            'git stash list -1 --format=%gs': { stdout: `On main: ${EXPECTED_STASH_NAME}\n` },
            'git stash list -1 --format=%gd': { stdout: 'stash@{0}\n' },
          }),
        },
        'node:fs/promises': { readFile: sinon.stub().resolves('') },
      });

      const snap = await ws.snapshotChtCore('/tmp/cht-core');
      expect(snap.headSha).to.equal('abc1234');
      expect(snap.stashRef).to.equal('stash@{0}');
      expect(snap.stashName).to.equal(EXPECTED_STASH_NAME);
    });

    it('A.4: stash push exits non-zero AND no stash was created → re-throws', async () => {
      const ws = proxyquire('../../../../../src/layers/code-gen/modules/claude-code-cli/workspace', {
        'node:child_process': {
          execFile: stubWithErrors({
            'git rev-parse HEAD': { stdout: 'abc1234\n' },
            'git status --porcelain': { stdout: ' M file.ts\n' },
            'git stash push': { error: new Error('fatal: stash failed') },
            // Verify returns a stash list that does NOT contain our marker.
            'git stash list -1 --format=%gs': { stdout: 'On main: someone-elses-stash\n' },
          }),
        },
        'node:fs/promises': { readFile: sinon.stub().resolves('') },
      });

      let threw = false;
      try {
        await ws.snapshotChtCore('/tmp/cht-core');
      } catch (err) {
        threw = true;
        expect((err as Error).message).to.match(/stash failed/);
      }
      expect(threw).to.equal(true);
    });

    it('A.5: reset --hard exits non-zero but HEAD matches → no warning', async () => {
      const ws = proxyquire('../../../../../src/layers/code-gen/modules/claude-code-cli/workspace', {
        'node:child_process': {
          execFile: stubWithErrors({
            'git reset --hard abc1234': { error: new Error('warning during reset') },
            'git rev-parse HEAD': { stdout: 'abc1234\n' }, // verify says reset landed
            'git status --porcelain': { stdout: '' },     // clean succeeded by default
          }),
        },
        'node:fs/promises': { readFile: sinon.stub().resolves('') },
      });

      // Should not throw and should not log a "during rollback failed" warning.
      const warnSpy = sinon.spy(console, 'warn');
      try {
        await ws.rollbackChtCore('/tmp/cht-core', { headSha: 'abc1234', stashRef: null, stashName: null });
      } finally {
        warnSpy.restore();
      }
      const failureWarn = warnSpy.getCalls().find(c => /reset --hard during rollback failed/.test(String(c.args[0])));
      expect(failureWarn).to.equal(undefined);
    });

    it('A.5: clean -fd exits non-zero but working tree is clean → no warning', async () => {
      const ws = proxyquire('../../../../../src/layers/code-gen/modules/claude-code-cli/workspace', {
        'node:child_process': {
          execFile: stubWithErrors({
            'git reset --hard': { stdout: '' },
            'git clean -fd': { error: new Error('warning: could not remove') },
            'git status --porcelain': { stdout: '' }, // verify says clean landed
          }),
        },
        'node:fs/promises': { readFile: sinon.stub().resolves('') },
      });

      const warnSpy = sinon.spy(console, 'warn');
      try {
        await ws.rollbackChtCore('/tmp/cht-core', { headSha: 'abc1234', stashRef: null, stashName: null });
      } finally {
        warnSpy.restore();
      }
      const failureWarn = warnSpy.getCalls().find(c => /clean -fd during rollback failed/.test(String(c.args[0])));
      expect(failureWarn).to.equal(undefined);
    });

    it('A.5: stash pop exits non-zero but stash was popped (by name) → no warning', async () => {
      const ws = proxyquire('../../../../../src/layers/code-gen/modules/claude-code-cli/workspace', {
        'node:child_process': {
          execFile: stubWithErrors({
            'git reset --hard': { stdout: '' },
            'git clean -fd': { stdout: '' },
            'git status --porcelain': { stdout: '' },
            'git stash pop': { error: new Error('warning during pop') },
            // verify uses --format=%gs (name) first; stash list is empty
            'git stash list --format=%gs': { stdout: '' },
          }),
        },
        'node:fs/promises': { readFile: sinon.stub().resolves('') },
      });

      const warnSpy = sinon.spy(console, 'warn');
      try {
        await ws.rollbackChtCore('/tmp/cht-core', {
          headSha: 'abc1234',
          stashRef: 'stash@{0}',
          stashName: 'cht-agent-claude-code-cli-1700000000000',
        });
      } finally {
        warnSpy.restore();
      }
      const failureWarn = warnSpy.getCalls().find(c => /stash pop stash@\{0\} failed/.test(String(c.args[0])));
      expect(failureWarn).to.equal(undefined);
    });

    it('A.14: returns typed RollbackResult with per-op outcomes', async () => {
      const ws = proxyquire('../../../../../src/layers/code-gen/modules/claude-code-cli/workspace', {
        'node:child_process': {
          execFile: stubWithErrors({
            'git reset --hard': { stdout: '' },
            'git clean -fd': { stdout: '' },
            'git stash pop': { stdout: '' },
            'git status --porcelain': { stdout: '' },
          }),
        },
        'node:fs/promises': { readFile: sinon.stub().resolves('') },
      });

      const result = await ws.rollbackChtCore('/tmp/cht-core', {
        headSha: 'abc1234',
        stashRef: 'stash@{0}',
        stashName: 'cht-agent-claude-code-cli-1700000000000',
      });
      expect(result.reset).to.equal('ok');
      expect(result.clean).to.equal('ok');
      expect(result.stashPop).to.equal('ok');
      expect(result.errors).to.deep.equal([]);
    });

    it('A.14: stashPop is "skipped" when there is no stashRef', async () => {
      const ws = proxyquire('../../../../../src/layers/code-gen/modules/claude-code-cli/workspace', {
        'node:child_process': {
          execFile: stubWithErrors({
            'git reset --hard': { stdout: '' },
            'git clean -fd': { stdout: '' },
            'git status --porcelain': { stdout: '' },
          }),
        },
        'node:fs/promises': { readFile: sinon.stub().resolves('') },
      });

      const result = await ws.rollbackChtCore('/tmp/cht-core', {
        headSha: 'abc1234',
        stashRef: null,
        stashName: null,
      });
      expect(result.stashPop).to.equal('skipped');
    });

    it('A.14: reset failure is captured in result.errors and result.reset', async () => {
      const ws = proxyquire('../../../../../src/layers/code-gen/modules/claude-code-cli/workspace', {
        'node:child_process': {
          execFile: stubWithErrors({
            'git reset --hard': { error: new Error('reset blew up') },
            // Verify says HEAD is NOT at the snapshot SHA, so reset is judged failed.
            'git rev-parse HEAD': { stdout: 'somethingelse\n' },
            'git clean -fd': { stdout: '' },
            'git status --porcelain': { stdout: '' },
          }),
        },
        'node:fs/promises': { readFile: sinon.stub().resolves('') },
      });

      const result = await ws.rollbackChtCore('/tmp/cht-core', {
        headSha: 'abc1234',
        stashRef: null,
        stashName: null,
      });
      expect(result.reset).to.equal('failed');
      expect(result.errors).to.have.length(1);
      expect(result.errors[0]).to.match(/^reset: /);
    });

    it('A.5: stash pop exits non-zero AND stash is still present → warns', async () => {
      const ws = proxyquire('../../../../../src/layers/code-gen/modules/claude-code-cli/workspace', {
        'node:child_process': {
          execFile: stubWithErrors({
            'git reset --hard': { stdout: '' },
            'git clean -fd': { stdout: '' },
            'git status --porcelain': { stdout: '' },
            'git stash pop': { error: new Error('conflict during pop') },
            // verify finds our marker name still in the list
            'git stash list --format=%gs': { stdout: 'On main: cht-agent-claude-code-cli-1700000000000\n' },
          }),
        },
        'node:fs/promises': { readFile: sinon.stub().resolves('') },
      });

      const warnSpy = sinon.spy(console, 'warn');
      try {
        await ws.rollbackChtCore('/tmp/cht-core', {
          headSha: 'abc1234',
          stashRef: 'stash@{0}',
          stashName: 'cht-agent-claude-code-cli-1700000000000',
        });
      } finally {
        warnSpy.restore();
      }
      const failureWarn = warnSpy.getCalls().find(c => /stash pop stash@\{0\} failed/.test(String(c.args[0])));
      expect(failureWarn).to.exist;
    });
  });
});
