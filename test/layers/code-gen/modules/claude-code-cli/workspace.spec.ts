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
      expect(snap.stashRef).to.be.null;
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

    it('records the post-stash untracked baseline (#140)', async () => {
      const ws = loadWorkspace({
        'git rev-parse HEAD': { stdout: 'abc1234deadbeef\n' },
        'git status --porcelain': { stdout: ' M .gitignore\n' },
        'git stash push': { stdout: 'Saved working directory\n' },
        'git stash list': { stdout: 'stash@{0}\n' },
        // Stashing the .gitignore edit unmasked these pre-existing files.
        'git ls-files --others --exclude-standard': { stdout: '.aider.chat\0.aider.tags\0' },
      });
      const snap = await ws.snapshotChtCore('/tmp/cht-core');
      expect(snap.baselineUntracked).to.deep.equal(['.aider.chat', '.aider.tags']);
    });

    it('reads the baseline even on a clean tree (no stash taken)', async () => {
      const ws = loadWorkspace({
        'git rev-parse HEAD': { stdout: 'abc1234deadbeef\n' },
        'git status --porcelain': { stdout: '' },
        'git ls-files --others --exclude-standard': { stdout: 'ignored-by-committed-rules.log\0' },
      });
      const snap = await ws.snapshotChtCore('/tmp/cht-core');
      expect(snap.stashRef).to.be.null;
      expect(snap.baselineUntracked).to.deep.equal(['ignored-by-committed-rules.log']);
    });

    it('refuses to start when a previous run leaked a cht-agent stash (#140)', async () => {
      const ws = loadWorkspace({
        'git stash list --format=%gd %gs': {
          stdout: 'stash@{0} On main: cht-agent-claude-code-cli-1700000000000\n',
        },
        'git rev-parse HEAD': { stdout: 'abc1234deadbeef\n' },
        'git status --porcelain': { stdout: '' },
      });
      let threw = false;
      try {
        await ws.snapshotChtCore('/tmp/cht-core');
      } catch (err) {
        threw = true;
        const msg = (err as Error).message;
        expect(msg).to.match(/leftover cht-agent stash/i);
        expect(msg).to.include('git -C /tmp/cht-core stash pop stash@{0}'); // recovery command
      }
      expect(threw).to.equal(true);
    });

    it('proceeds past a leaked stash when CHT_AGENT_IGNORE_LEAKED_STASH=true', async () => {
      const prev = process.env.CHT_AGENT_IGNORE_LEAKED_STASH;
      process.env.CHT_AGENT_IGNORE_LEAKED_STASH = 'true';
      try {
        const ws = loadWorkspace({
          'git stash list --format=%gd %gs': {
            stdout: 'stash@{0} On main: cht-agent-claude-code-cli-1700000000000\n',
          },
          'git rev-parse HEAD': { stdout: 'abc1234deadbeef\n' },
          'git status --porcelain': { stdout: '' },
        });
        const snap = await ws.snapshotChtCore('/tmp/cht-core');
        expect(snap.headSha).to.equal('abc1234deadbeef');
      } finally {
        if (prev === undefined) delete process.env.CHT_AGENT_IGNORE_LEAKED_STASH;
        else process.env.CHT_AGENT_IGNORE_LEAKED_STASH = prev;
      }
    });

    it('ignores an unrelated third-party stash', async () => {
      const ws = loadWorkspace({
        'git stash list --format=%gd %gs': { stdout: 'stash@{0} On main: my own wip\n' },
        'git rev-parse HEAD': { stdout: 'abc1234deadbeef\n' },
        'git status --porcelain': { stdout: '' },
      });
      const snap = await ws.snapshotChtCore('/tmp/cht-core');
      expect(snap.headSha).to.equal('abc1234deadbeef');
    });

    it('warns when the stashed work includes a .gitignore edit (#140)', async () => {
      const ws = loadWorkspace({
        'git rev-parse HEAD': { stdout: 'abc1234deadbeef\n' },
        'git status --porcelain': { stdout: ' M .gitignore\n M src/a.ts\n' },
        'git stash push': { stdout: 'Saved\n' },
        'git stash list': { stdout: 'stash@{0}\n' },
      });
      const warnSpy = sinon.spy(console, 'warn');
      try {
        await ws.snapshotChtCore('/tmp/cht-core');
      } finally {
        warnSpy.restore();
      }
      const warned = warnSpy.getCalls().find(c => /ignore rules revert to HEAD/.test(String(c.args[0])));
      expect(warned).to.exist;
    });

    it('does not warn about ignore rules for ordinary edits', async () => {
      const ws = loadWorkspace({
        'git rev-parse HEAD': { stdout: 'abc1234deadbeef\n' },
        'git status --porcelain': { stdout: ' M src/a.ts\n' },
        'git stash push': { stdout: 'Saved\n' },
        'git stash list': { stdout: 'stash@{0}\n' },
      });
      const warnSpy = sinon.spy(console, 'warn');
      try {
        await ws.snapshotChtCore('/tmp/cht-core');
      } finally {
        warnSpy.restore();
      }
      const warned = warnSpy.getCalls().find(c => /ignore rules revert to HEAD/.test(String(c.args[0])));
      expect(warned).to.be.undefined;
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
        'git diff --name-status -z abc1234': { stdout: 'A\0src/new.ts\0M\0src/changed.ts\0' },
        'git ls-files --others --exclude-standard': { stdout: '' },
        'git show': { stdout: 'old content' },
      });
      const files = await ws.captureChtCoreDiff('/tmp/cht-core', 'abc1234', []);
      const create = files.find((f: { path: string }) => f.path === 'src/new.ts');
      const modify = files.find((f: { path: string }) => f.path === 'src/changed.ts');
      expect(create).to.exist;
      expect(create.originalContent).to.be.undefined;
      expect(modify).to.exist;
      expect(modify.originalContent).to.equal('old content');
    });

    it('includes untracked files as create', async () => {
      const ws = loadWorkspace({
        'git diff --name-status -z abc1234': { stdout: '' },
        'git ls-files --others --exclude-standard': { stdout: 'src/untracked.ts\0' },
      });
      const files = await ws.captureChtCoreDiff('/tmp/cht-core', 'abc1234', []);
      expect(files.find((f: { path: string }) => f.path === 'src/untracked.ts')).to.exist;
    });

    it('excludes baseline untracked files and keeps CLI-created ones (#140)', async () => {
      const ws = loadWorkspace({
        'git diff --name-status -z abc1234': { stdout: '' },
        'git ls-files --others --exclude-standard': {
          stdout: '.aider.chat\0.aider.tags\0operator-notes.md\0src/cli-made.ts\0',
        },
      });
      const files = await ws.captureChtCoreDiff('/tmp/cht-core', 'abc1234', [
        '.aider.chat',
        '.aider.tags',
        'operator-notes.md',
      ]);
      expect(files.map((f: { path: string }) => f.path)).to.deep.equal(['src/cli-made.ts']);
    });

    it('stays in phase on a rename entry, which carries two paths (#140 F-2)', async () => {
      // -z renames emit STATUS\0OLD\0NEW\0; consuming only one path would treat
      // the old path as the next status and desynchronize the whole stream.
      const ws = loadWorkspace({
        'git diff --name-status -z abc1234': {
          stdout: 'R100\0src/old.ts\0src/new.ts\0M\0src/after.ts\0',
        },
        'git ls-files --others --exclude-standard': { stdout: '' },
        'git show': { stdout: 'old content' },
      });
      const files = await ws.captureChtCoreDiff('/tmp/cht-core', 'abc1234', []);
      // NEW path kept for the rename, and the following entry still parses.
      expect(files.map((f: { path: string }) => f.path)).to.deep.equal(['src/new.ts', 'src/after.ts']);
    });

    it('skips deletes', async () => {
      const ws = loadWorkspace({
        'git diff --name-status -z abc1234': { stdout: 'D\0src/deleted.ts\0A\0src/new.ts\0' },
        'git ls-files --others --exclude-standard': { stdout: '' },
      });
      const files = await ws.captureChtCoreDiff('/tmp/cht-core', 'abc1234', []);
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

    /** trackingStub with per-prefix stdout, so `ls-files` can produce a delta. */
    const trackingStubWith = (calls: string[], responses: Record<string, string>) => {
      const fn = (_cmd: string, _args: string[], _opts: object, cb: (e: Error | null, s: string, t: string) => void) => {
        cb(null, '', '');
      };
      (fn as unknown as Record<symbol, unknown>)[util.promisify.custom] = (cmd: string, args: string[]) => {
        const key = `${cmd} ${args.join(' ')}`;
        calls.push(key);
        for (const k of Object.keys(responses)) {
          if (key.startsWith(k)) return Promise.resolve({ stdout: responses[k], stderr: '' });
        }
        return Promise.resolve({ stdout: '', stderr: '' });
      };
      return fn;
    };

    it('always runs reset; pops stash if present', async () => {
      const calls: string[] = [];
      const ws = proxyquire('../../../../../src/layers/code-gen/modules/claude-code-cli/workspace', {
        'node:child_process': { execFile: trackingStub(calls) },
        'node:fs/promises': { readFile: sinon.stub().resolves('') },
      });

      await ws.rollbackChtCore('/tmp/cht-core', { headSha: 'abc1234', stashRef: 'stash@{0}', baselineUntracked: [] });

      expect(calls.some(c => c.startsWith('git reset --hard abc1234'))).to.equal(true);
      expect(calls.some(c => c.startsWith('git stash pop stash@{0}'))).to.equal(true);
    });

    it('cleans ONLY session-created paths, sparing the baseline (#140)', async () => {
      const calls: string[] = [];
      const ws = proxyquire('../../../../../src/layers/code-gen/modules/claude-code-cli/workspace', {
        'node:child_process': {
          execFile: trackingStubWith(calls, {
            'git ls-files --others --exclude-standard': '.aider.chat\0src/cli-made.ts\0',
          }),
        },
        'node:fs/promises': { readFile: sinon.stub().resolves('') },
      });

      await ws.rollbackChtCore('/tmp/cht-core', {
        headSha: 'abc1234',
        stashRef: null,
        stashName: null,
        baselineUntracked: ['.aider.chat'],
      });

      const cleanCall = calls.find(c => c.startsWith('git clean'));
      // :(literal) so a metachar in a session filename cannot fnmatch-delete an
      // operator file (#140 F-1).
      expect(cleanCall).to.equal('git clean -fd -- :(literal)src/cli-made.ts');
      expect(cleanCall).to.not.include('.aider.chat'); // operator's file spared
    });

    it('skips the clean entirely when the delta is empty (no blanket clean) (#140)', async () => {
      const calls: string[] = [];
      const ws = proxyquire('../../../../../src/layers/code-gen/modules/claude-code-cli/workspace', {
        'node:child_process': {
          execFile: trackingStubWith(calls, {
            // Everything untracked is the operator's; nothing of ours to remove.
            'git ls-files --others --exclude-standard': '.aider.chat\0operator-notes.md\0',
          }),
        },
        'node:fs/promises': { readFile: sinon.stub().resolves('') },
      });

      const result = await ws.rollbackChtCore('/tmp/cht-core', {
        headSha: 'abc1234',
        stashRef: null,
        stashName: null,
        baselineUntracked: ['.aider.chat', 'operator-notes.md'],
      });

      expect(calls.some(c => c.startsWith('git clean'))).to.equal(false);
      expect(result.clean).to.equal('ok');
    });

    it('skips stash pop when stashRef is null', async () => {
      const calls: string[] = [];
      const ws = proxyquire('../../../../../src/layers/code-gen/modules/claude-code-cli/workspace', {
        'node:child_process': { execFile: trackingStub(calls) },
        'node:fs/promises': { readFile: sinon.stub().resolves('') },
      });

      await ws.rollbackChtCore('/tmp/cht-core', { headSha: 'abc1234', stashRef: null, baselineUntracked: [] });

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
            // verify (tree diff vs the snapshot) says the reset landed
            'git diff --quiet abc1234': { stdout: '' },
            'git status --porcelain': { stdout: '' },     // clean succeeded by default
          }),
        },
        'node:fs/promises': { readFile: sinon.stub().resolves('') },
      });

      // Should not throw and should not log a "during rollback failed" warning.
      const warnSpy = sinon.spy(console, 'warn');
      try {
        await ws.rollbackChtCore('/tmp/cht-core', { headSha: 'abc1234', stashRef: null, stashName: null, baselineUntracked: [] });
      } finally {
        warnSpy.restore();
      }
      const failureWarn = warnSpy.getCalls().find(c => /reset --hard during rollback failed/.test(String(c.args[0])));
      expect(failureWarn).to.be.undefined;
    });

    it('M1: reset failure is reported when the tree does NOT match the snapshot (#140)', async () => {
      // v1 verified `rev-parse HEAD === snapshot.headSha`, which nothing in a
      // session can falsify, so a real reset failure verified as success and the
      // session's edits silently stayed in the operator's tree.
      const ws = proxyquire('../../../../../src/layers/code-gen/modules/claude-code-cli/workspace', {
        'node:child_process': {
          execFile: stubWithErrors({
            'git reset --hard': { error: new Error('fatal: Unable to create index.lock') },
            'git rev-parse HEAD': { stdout: 'abc1234\n' },      // v1's check would say "ok"
            'git diff --quiet abc1234': { error: new Error('tree still differs') },
          }),
        },
        'node:fs/promises': { readFile: sinon.stub().resolves('') },
      });

      const result = await ws.rollbackChtCore('/tmp/cht-core', {
        headSha: 'abc1234', stashRef: null, stashName: null, baselineUntracked: [],
      });
      expect(result.reset).to.equal('failed');
      expect(result.errors[0]).to.match(/^reset: /);
    });

    it('F-4: a baseline-less snapshot throws instead of blanket-cleaning (#140)', async () => {
      const calls: string[] = [];
      const fn = (_c: string, _a: string[], _o: object, cb: (e: Error | null, s: string, t: string) => void) => cb(null, '', '');
      (fn as unknown as Record<symbol, unknown>)[util.promisify.custom] = (cmd: string, args: string[]) => {
        calls.push(`${cmd} ${args.join(' ')}`);
        if (`${cmd} ${args.join(' ')}`.startsWith('git ls-files')) {
          return Promise.resolve({ stdout: 'operator-file.txt\0', stderr: '' });
        }
        return Promise.resolve({ stdout: '', stderr: '' });
      };
      const ws = proxyquire('../../../../../src/layers/code-gen/modules/claude-code-cli/workspace', {
        'node:child_process': { execFile: fn },
        'node:fs/promises': { readFile: sinon.stub().resolves('') },
      });

      // An untyped caller (or a stale spec literal) omitting the baseline.
      const result = await ws.rollbackChtCore('/tmp/cht-core', {
        headSha: 'abc1234', stashRef: null, stashName: null,
      });

      expect(result.clean).to.equal('failed');
      expect(result.errors.join(' ')).to.match(/baselineUntracked is missing or not an array/);
      expect(calls.some(c => c.startsWith('git clean'))).to.equal(false); // nothing deleted
    });

    it('M2: a non-ENOENT stat error counts as NOT removed → clean failed (#140)', async () => {
      const ws = proxyquire('../../../../../src/layers/code-gen/modules/claude-code-cli/workspace', {
        'node:child_process': {
          execFile: stubWithErrors({
            'git reset --hard': { stdout: '' },
            'git ls-files --others --exclude-standard': { stdout: 'src/cli-made.ts\0' },
            'git clean -fd': { error: new Error('permission denied') },
          }),
        },
        'node:fs/promises': {
          readFile: sinon.stub().resolves(''),
          // v1 caught every error as "removed"; EACCES means the clean did NOT work.
          lstat: sinon.stub().rejects(Object.assign(new Error('EACCES'), { code: 'EACCES' })),
        },
      });

      const result = await ws.rollbackChtCore('/tmp/cht-core', {
        headSha: 'abc1234', stashRef: null, stashName: null, baselineUntracked: [],
      });
      expect(result.clean).to.equal('failed');
    });

    it('A.5: clean exits non-zero but the delta paths are gone → no warning', async () => {
      const ws = proxyquire('../../../../../src/layers/code-gen/modules/claude-code-cli/workspace', {
        'node:child_process': {
          execFile: stubWithErrors({
            'git reset --hard': { stdout: '' },
            'git ls-files --others --exclude-standard': { stdout: 'src/cli-made.ts\0' },
            'git clean -fd': { error: new Error('warning: could not remove') },
          }),
        },
        'node:fs/promises': {
          readFile: sinon.stub().resolves(''),
          // Verifier asserts removal: ENOENT means the file is gone.
          lstat: sinon.stub().rejects(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })),
        },
      });

      const warnSpy = sinon.spy(console, 'warn');
      let result;
      try {
        result = await ws.rollbackChtCore('/tmp/cht-core', {
          headSha: 'abc1234', stashRef: null, stashName: null, baselineUntracked: [],
        });
      } finally {
        warnSpy.restore();
      }
      const failureWarn = warnSpy.getCalls().find(c => /clean -fd during rollback failed/.test(String(c.args[0])));
      expect(failureWarn).to.be.undefined;
      expect(result.clean).to.equal('ok');
    });

    it('A.5: clean does NOT report failure just because the tree is legitimately dirty (#140)', async () => {
      // The operator's own untracked files survive rollback by design, so the old
      // "status --porcelain is empty" verifier would have misreported a failure.
      const ws = proxyquire('../../../../../src/layers/code-gen/modules/claude-code-cli/workspace', {
        'node:child_process': {
          execFile: stubWithErrors({
            'git reset --hard': { stdout: '' },
            'git ls-files --others --exclude-standard': { stdout: '.aider.chat\0src/cli-made.ts\0' },
            'git clean -fd': { error: new Error('warning: could not remove') },
            'git status --porcelain': { stdout: '?? .aider.chat\n' }, // still dirty, legitimately
          }),
        },
        'node:fs/promises': {
          readFile: sinon.stub().resolves(''),
          lstat: sinon.stub().rejects(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })),
        },
      });

      const result = await ws.rollbackChtCore('/tmp/cht-core', {
        headSha: 'abc1234', stashRef: null, stashName: null, baselineUntracked: ['.aider.chat'],
      });
      expect(result.clean).to.equal('ok');
      expect(result.errors).to.deep.equal([]);
    });

    it('A.5: clean reports failure when a delta path still exists', async () => {
      const ws = proxyquire('../../../../../src/layers/code-gen/modules/claude-code-cli/workspace', {
        'node:child_process': {
          execFile: stubWithErrors({
            'git reset --hard': { stdout: '' },
            'git ls-files --others --exclude-standard': { stdout: 'src/cli-made.ts\0' },
            'git clean -fd': { error: new Error('permission denied') },
          }),
        },
        'node:fs/promises': {
          readFile: sinon.stub().resolves(''),
          lstat: sinon.stub().resolves({}), // file is still there
        },
      });

      const result = await ws.rollbackChtCore('/tmp/cht-core', {
        headSha: 'abc1234', stashRef: null, stashName: null, baselineUntracked: [],
      });
      expect(result.clean).to.equal('failed');
      expect(result.errors[0]).to.match(/^clean: /);
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
          baselineUntracked: [],
        });
      } finally {
        warnSpy.restore();
      }
      const failureWarn = warnSpy.getCalls().find(c => /stash pop stash@\{0\} failed/.test(String(c.args[0])));
      expect(failureWarn).to.be.undefined;
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
        baselineUntracked: [],
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
        baselineUntracked: [],
      });
      expect(result.stashPop).to.equal('skipped');
    });

    it('A.14: reset failure is captured in result.errors and result.reset', async () => {
      const ws = proxyquire('../../../../../src/layers/code-gen/modules/claude-code-cli/workspace', {
        'node:child_process': {
          execFile: stubWithErrors({
            'git reset --hard': { error: new Error('reset blew up') },
            // Verify says the tree still differs from the snapshot, so reset is judged failed.
            'git diff --quiet abc1234': { error: new Error('tree still differs') },
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
        baselineUntracked: [],
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
          baselineUntracked: [],
        });
      } finally {
        warnSpy.restore();
      }
      const failureWarn = warnSpy.getCalls().find(c => /stash pop stash@\{0\} failed/.test(String(c.args[0])));
      expect(failureWarn).to.exist;
    });
  });
});
