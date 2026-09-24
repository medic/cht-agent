/* eslint-disable @typescript-eslint/no-var-requires */
import { expect } from 'chai';
import sinon from 'sinon';
import * as util from 'node:util';
import { execFileSync } from 'node:child_process';

const proxyquire = require('proxyquire').noCallThru();

const WORKSPACE = '../../../../../src/layers/code-gen/modules/claude-code-cli/workspace';

type Answer = { stdout: string } | { error: Error };
type Script = Record<string, Answer | Answer[]>;

// workspace.ts uses promisify(execFile). Plain functions, when promisified,
// resolve with the FIRST non-error callback arg only. execFile's real
// promisified version returns { stdout, stderr } because Node attaches a
// custom [util.promisify.custom] override. We mirror that here so our stub
// resolves to { stdout, stderr } too.
//
// A call's `git <args>` is matched against the script keys by prefix, and the
// first key in insertion order wins, so a more specific key must come first. A
// key may map to a list: one entry per call, and the last entry repeats.
// Unknown calls resolve with '' and exit 0. Every call is recorded in `calls`.
const scriptedExecFile = (script: Script, calls: string[] = []) => {
  const used = new Map<string, number>();
  const fn = (_cmd: string, _args: string[], _opts: object, cb: (err: Error | null, stdout: string, stderr: string) => void) => {
    cb(null, '', ''); // callback path (workspace.ts never uses it)
  };
  (fn as unknown as Record<symbol, unknown>)[util.promisify.custom] = (cmd: string, args: string[]) => {
    const key = `${cmd} ${args.join(' ')}`;
    calls.push(key);
    const match = Object.keys(script).find(k => key.startsWith(k));
    if (match === undefined) return Promise.resolve({ stdout: '', stderr: '' });
    const answers = ([] as Answer[]).concat(script[match]);
    const n = used.get(match) ?? 0;
    used.set(match, n + 1);
    const answer = answers[Math.min(n, answers.length - 1)];
    if ('error' in answer) return Promise.reject(answer.error);
    return Promise.resolve({ stdout: answer.stdout, stderr: '' });
  };
  return fn;
};

const loadWorkspace = (script: Script, fsStubs: Record<string, unknown> = {}, calls: string[] = []) => {
  return proxyquire(WORKSPACE, {
    'node:child_process': { execFile: scriptedExecFile(script, calls) },
    'node:fs/promises': {
      readFile: sinon.stub().resolves('file contents'),
      ...fsStubs,
    },
  });
};

const NOW = 1700000000000;
const OUR_NAME = `cht-agent-claude-code-cli-${NOW}`;
const OUR_SHA = '1111111111111111111111111111111111111111';
const OTHER_SHA = '2222222222222222222222222222222222222222';

/** `git stash list -z --format=%gd%x00%H%x00%ct%x00%gs` output for these entries. */
const stashListZ = (...entries: Array<[ref: string, sha: string, message: string]>) =>
  entries.map(([ref, sha, message]) => `${ref}\0${sha}\0${NOW / 1000}\0${message}\0`).join('');

const OUR_ENTRY = stashListZ(['stash@{0}', OUR_SHA, `On main: ${OUR_NAME}`]);

/** The leftover check reads the list first (nothing of ours), then the creation check finds ours. */
const STASH_CREATED: Answer[] = [{ stdout: '' }, { stdout: OUR_ENTRY }];

const errno = (code: string) => Object.assign(new Error(code), { code });

/** fs stubs under which every path capture looks at is a regular file. */
const regularFiles = () => ({ lstat: sinon.stub().resolves({ isFile: () => true }) });

const SNAPSHOT = {
  headSha: 'abc1234',
  headRef: 'refs/heads/main',
  repoRoot: '/tmp/cht-core',
  stashSha: null as string | null,
  stashName: null as string | null,
  baselineUntracked: [] as string[] | undefined,
};

const WITH_STASH = { stashSha: OUR_SHA, stashName: OUR_NAME };

/**
 * A snapshot literal plus the git answers under which rollback's pre-checks
 * pass for it: the same toplevel, HEAD and branch, and our entry in the stash
 * list when the snapshot took a stash. `script` keys come first, so they win
 * over these defaults even when a default key is a prefix of theirs.
 */
const rollbackFixture = (overrides: Partial<typeof SNAPSHOT> = {}, script: Script = {}) => {
  const snapshot = { ...SNAPSHOT, ...overrides };
  const ourList = snapshot.stashSha
    ? stashListZ(['stash@{0}', snapshot.stashSha, `On main: ${snapshot.stashName}`])
    : '';
  const defaults: Script = {
    'git rev-parse --show-toplevel': { stdout: `${snapshot.repoRoot}\n` },
    'git rev-parse HEAD': { stdout: `${snapshot.headSha}\n` },
    'git symbolic-ref -q HEAD': { stdout: `${snapshot.headRef}\n` },
    'git stash list -z': { stdout: ourList },
    'git stash drop': { stdout: `Dropped stash@{0} (${snapshot.stashSha})\n` },
  };
  const merged: Script = { ...script };
  for (const [key, answer] of Object.entries(defaults)) {
    if (!(key in merged)) merged[key] = answer;
  }
  return { snapshot, script: merged };
};

describe('workspace.ts (A.2b)', () => {
  describe('snapshotChtCore', () => {
    // The stash name must be predictable in tests that stash successfully.
    beforeEach(() => sinon.stub(Date, 'now').returns(NOW));
    afterEach(() => sinon.restore());

    it('captures HEAD, branch, toplevel and a null stash when the working tree is clean', async () => {
      const ws = loadWorkspace({
        'git rev-parse --show-toplevel': { stdout: '/tmp/cht-core\n' },
        'git rev-parse HEAD': { stdout: 'abc1234deadbeef\n' },
        'git symbolic-ref -q HEAD': { stdout: 'refs/heads/main\n' },
        'git status --porcelain': { stdout: '' },
      });
      const snap = await ws.snapshotChtCore('/tmp/cht-core');
      expect(snap.headSha).to.equal('abc1234deadbeef');
      expect(snap.headRef).to.equal('refs/heads/main');
      expect(snap.repoRoot).to.equal('/tmp/cht-core');
      expect(snap.stashSha).to.be.null;
    });

    it('records a null branch for a detached HEAD', async () => {
      const ws = loadWorkspace({
        'git rev-parse HEAD': { stdout: 'abc1234deadbeef\n' },
        'git symbolic-ref -q HEAD': { error: Object.assign(new Error('not a symbolic ref'), { code: 1 }) },
        'git status --porcelain': { stdout: '' },
      });
      const snap = await ws.snapshotChtCore('/tmp/cht-core');
      expect(snap.headRef).to.be.null;
    });

    it('stashes uncommitted work and records our stash commit SHA', async () => {
      const ws = loadWorkspace({
        'git rev-parse HEAD': { stdout: 'abc1234deadbeef\n' },
        // The post-push check: the stash left no tracked change.
        'git status --porcelain=v1': { stdout: '' },
        'git status --porcelain': { stdout: ' M file.ts\n' },
        'git stash push': { stdout: 'Saved working directory and index state\n' },
        'git stash list -z': STASH_CREATED,
      });
      const snap = await ws.snapshotChtCore('/tmp/cht-core');
      expect(snap.stashSha).to.equal(OUR_SHA);
      expect(snap.stashName).to.equal(OUR_NAME);
    });

    it('finds our entry below a newer stash and ignores a decoy that only mentions the name', async () => {
      const ws = loadWorkspace({
        'git rev-parse HEAD': { stdout: 'abc1234deadbeef\n' },
        // The post-push check: the stash left no tracked change.
        'git status --porcelain=v1': { stdout: '' },
        'git status --porcelain': { stdout: ' M file.ts\n' },
        'git stash push': { stdout: 'Saved\n' },
        'git stash list -z': [{ stdout: '' }, {
          stdout: stashListZ(
            ['stash@{0}', OTHER_SHA, `On main: ${OUR_NAME} crash note`],
            ['stash@{1}', OUR_SHA, `On main: ${OUR_NAME}`],
          ),
        }],
      });
      const snap = await ws.snapshotChtCore('/tmp/cht-core');
      expect(snap.stashSha).to.equal(OUR_SHA);
    });

    it('records the post-stash untracked baseline (#140)', async () => {
      const ws = loadWorkspace({
        'git rev-parse HEAD': { stdout: 'abc1234deadbeef\n' },
        // The post-push check: the stash left no tracked change.
        'git status --porcelain=v1': { stdout: '' },
        'git status --porcelain': { stdout: ' M .gitignore\n' },
        'git stash push': { stdout: 'Saved working directory\n' },
        'git stash list -z': STASH_CREATED,
        // Stashing the .gitignore edit unmasked these pre-existing files: absent
        // from the pre-push listing, present in the post-stash baseline.
        'git ls-files --others --exclude-standard': [{ stdout: '' }, { stdout: '.aider.chat\0.aider.tags\0' }],
      });
      const snap = await ws.snapshotChtCore('/tmp/cht-core');
      expect(snap.baselineUntracked).to.deep.equal(['.aider.chat', '.aider.tags']);
    });

    it('adds what was ignored at snapshot to the baseline, minus dirs that only hold ignored content', async () => {
      const calls: string[] = [];
      const ws = loadWorkspace({
        'git rev-parse HEAD': { stdout: 'abc1234deadbeef\n' },
        'git status --porcelain': { stdout: '' },
        'git ls-files --others --exclude-standard': { stdout: 'notes.md\0' },
        // sub/ is not ignored itself: git lists it because it holds only ignored content.
        'git ls-files --others --ignored --exclude-standard --directory': {
          stdout: 'node_modules/\0sub/\0sub/node_modules/\0.env\0cache/\0cache/.gitignore\0cache/data.bin\0',
        },
      }, {}, calls);
      const snap = await ws.snapshotChtCore('/tmp/cht-core');
      expect(snap.baselineUntracked).to.deep.equal([
        'notes.md', 'node_modules/', 'sub/node_modules/', '.env', 'cache/.gitignore', 'cache/data.bin',
      ]);
    });

    it('reads the baseline even on a clean tree (no stash taken)', async () => {
      const ws = loadWorkspace({
        'git rev-parse HEAD': { stdout: 'abc1234deadbeef\n' },
        'git status --porcelain': { stdout: '' },
        'git ls-files --others --exclude-standard': { stdout: 'ignored-by-committed-rules.log\0' },
      });
      const snap = await ws.snapshotChtCore('/tmp/cht-core');
      expect(snap.stashSha).to.be.null;
      expect(snap.baselineUntracked).to.deep.equal(['ignored-by-committed-rules.log']);
    });

    it('refuses to start when a previous run leaked a cht-agent stash (#140)', async () => {
      const ws = loadWorkspace({
        'git stash list -z': { stdout: OUR_ENTRY },
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
        // Lookup by exact name, then restore the ref that line starts with: not
        // `stash pop <name>` (not a valid ref) and not a concrete stash@{N} (goes
        // stale as soon as anything else is stashed).
        expect(msg).to.include(
          `git -C '/tmp/cht-core' stash list --format='%gd  %cr  %gs' | grep -E ': ${OUR_NAME}$'`,
        );
        expect(msg).to.include("git -C '/tmp/cht-core' stash pop --index <the stash ref at the start of that line>");
        expect(msg).to.not.match(/stash@\{\d+\}/);
        // The stash may belong to a live run on this checkout.
        expect(msg).to.not.match(/interrupted run/);
      }
      expect(threw).to.equal(true);
    });

    it('proceeds past a leaked stash when CHT_AGENT_IGNORE_LEAKED_STASH=true', async () => {
      const prev = process.env.CHT_AGENT_IGNORE_LEAKED_STASH;
      process.env.CHT_AGENT_IGNORE_LEAKED_STASH = 'true';
      try {
        const ws = loadWorkspace({
          'git stash list -z': { stdout: OUR_ENTRY },
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
        'git stash list -z': { stdout: stashListZ(['stash@{0}', OTHER_SHA, 'On main: my own wip']) },
        'git rev-parse HEAD': { stdout: 'abc1234deadbeef\n' },
        'git status --porcelain': { stdout: '' },
      });
      const snap = await ws.snapshotChtCore('/tmp/cht-core');
      expect(snap.headSha).to.equal('abc1234deadbeef');
    });

    it('does not false-positive on a user stash that merely mentions the marker (#140 F-7)', async () => {
      const ws = loadWorkspace({
        'git stash list -z': {
          stdout: stashListZ(['stash@{0}', OTHER_SHA, `On main: wip after ${OUR_NAME} crashed`]),
        },
        'git rev-parse HEAD': { stdout: 'abc1234deadbeef\n' },
        'git status --porcelain': { stdout: '' },
      });
      // Marker is present but not in terminal position: this is the user's stash.
      const snap = await ws.snapshotChtCore('/tmp/cht-core');
      expect(snap.headSha).to.equal('abc1234deadbeef');
    });

    it('reports EVERY leaked stash, not just the first line (#140 F-7)', async () => {
      const ws = loadWorkspace({
        'git stash list -z': {
          stdout: stashListZ(
            ['stash@{0}', OTHER_SHA, 'On main: my own wip'],
            ['stash@{1}', OUR_SHA, 'On main: cht-agent-claude-code-cli-1700000000001'],
            ['stash@{2}', '3333333333333333333333333333333333333333', 'On main: cht-agent-claude-code-cli-1700000000000'],
          ),
        },
        'git rev-parse HEAD': { stdout: 'abc1234deadbeef\n' },
        'git status --porcelain': { stdout: '' },
      });
      let msg = '';
      try {
        await ws.snapshotChtCore('/tmp/cht-core');
      } catch (err) {
        msg = (err as Error).message;
      }
      // A real leak can sit under a user stash; naming only the first sends the
      // operator to the wrong entry. Each one gets its own lookup.
      expect(msg).to.include("grep -E ': cht-agent-claude-code-cli-1700000000001$'");
      expect(msg).to.include("grep -E ': cht-agent-claude-code-cli-1700000000000$'");
      expect(msg).to.include('created 2023-11-14T22:13:20.000Z');
      expect(msg).to.not.include('my own wip');
      expect(msg).to.not.match(/stash@\{\d+\}/);
    });

    it('accepts the flag with stray casing and whitespace (#140 M6)', async () => {
      const prev = process.env.CHT_AGENT_IGNORE_LEAKED_STASH;
      process.env.CHT_AGENT_IGNORE_LEAKED_STASH = ' TRUE ';
      try {
        const ws = loadWorkspace({
          'git stash list -z': { stdout: OUR_ENTRY },
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

    it('stops when a zero-exit stash push saved nothing, naming what it did not save (#140 M3)', async () => {
      const ws = loadWorkspace({
        'git rev-parse HEAD': { stdout: 'abc1234deadbeef\n' },
        'git status --porcelain=v1': { stdout: ' M sub\0' }, // a dirty submodule
        'git status --porcelain': { stdout: ' M sub\n' },
        'git stash push': { stdout: 'No local changes to save\n' }, // exits 0, saved nothing
        // The only entry is somebody else's stash, NOT ours.
        'git stash list -z': { stdout: stashListZ(['stash@{0}', OTHER_SHA, 'On main: someone elses wip']) },
      });
      let thrown: unknown;
      try {
        await ws.snapshotChtCore('/tmp/cht-core');
      } catch (err) {
        thrown = err;
      }
      // Must not adopt a third-party stash that rollback would then restore,
      // and must not run on unstashed operator work either.
      expect((thrown as { kind: string }).kind).to.equal('stash');
      const lines = (thrown as { lines: string[] }).lines.join('\n');
      expect(lines).to.include('nothing was stashed and your tree is unchanged');
      expect(lines).to.include('"sub"');
    });

    it('refuses a path below the repo toplevel before it changes anything', async () => {
      const calls: string[] = [];
      const ws = loadWorkspace({
        'git rev-parse --show-prefix': { stdout: 'webapp/\n' },
        // The post-push check: the stash left no tracked change.
        'git status --porcelain=v1': { stdout: '' },
        'git status --porcelain': { stdout: ' M file.ts\n' },
      }, {}, calls);
      let thrown: unknown;
      try {
        await ws.snapshotChtCore('/tmp/cht-core/webapp');
      } catch (err) {
        thrown = err;
      }
      expect(thrown).to.be.instanceOf(ws.WorkspaceSafetyError);
      expect((thrown as { kind: string }).kind).to.equal('precondition');
      expect((thrown as Error).message).to.include('subdirectory webapp/');
      expect(calls.some(c => c.startsWith('git stash push'))).to.equal(false);
    });

    it('refuses to run while a merge, cherry-pick, revert or rebase is in progress', async () => {
      const calls: string[] = [];
      const ws = loadWorkspace({
        'git rev-parse --path-format=absolute': {
          stdout: '/tmp/cht-core/.git/MERGE_HEAD\n/tmp/cht-core/.git/CHERRY_PICK_HEAD\n/tmp/cht-core/.git/rebase-merge\n',
        },
        'git status --porcelain': { stdout: '' },
      }, {
        lstat: sinon.stub().callsFake(async (p: string) => {
          if (p.endsWith('MERGE_HEAD')) return {};
          throw errno('ENOENT');
        }),
      }, calls);
      let thrown: unknown;
      try {
        await ws.snapshotChtCore('/tmp/cht-core');
      } catch (err) {
        thrown = err;
      }
      expect((thrown as { kind: string }).kind).to.equal('precondition');
      expect((thrown as Error).message).to.include('(MERGE_HEAD)');
      const markerCall = calls.find(c => c.startsWith('git rev-parse --path-format=absolute'));
      for (const marker of ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply', 'sequencer']) {
        expect(markerCall).to.include(`--git-path ${marker}`);
      }
      expect(markerCall).to.not.include('AUTO_MERGE');
    });

    it('warns when the stashed work includes a .gitignore edit (#140)', async () => {
      const ws = loadWorkspace({
        'git rev-parse HEAD': { stdout: 'abc1234deadbeef\n' },
        // The post-push check: the stash left no tracked change.
        'git status --porcelain=v1': { stdout: '' },
        'git status --porcelain': { stdout: ' M .gitignore\n M src/a.ts\n' },
        'git stash push': { stdout: 'Saved\n' },
        'git stash list -z': STASH_CREATED,
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

    it('warns for a renamed-away .gitignore and a C-quoted path (#140 F-6)', async () => {
      const ws = loadWorkspace({
        'git rev-parse HEAD': { stdout: 'abc1234deadbeef\n' },
        // Rename AWAY from .gitignore (old side), and a quoted non-ASCII dir.
        // The post-push check: the stash left no tracked change.
        'git status --porcelain=v1': { stdout: '' },
        'git status --porcelain': { stdout: 'R  .gitignore -> .gitignore.bak\n' },
        'git stash push': { stdout: 'Saved\n' },
        'git stash list -z': STASH_CREATED,
      });
      const warnSpy = sinon.spy(console, 'warn');
      try {
        await ws.snapshotChtCore('/tmp/cht-core');
      } finally {
        warnSpy.restore();
      }
      expect(warnSpy.getCalls().find(c => /ignore rules revert to HEAD/.test(String(c.args[0])))).to.exist;
    });

    it('warns for a C-quoted nested .gitignore path (#140 F-6)', async () => {
      const ws = loadWorkspace({
        'git rev-parse HEAD': { stdout: 'abc1234deadbeef\n' },
        // The post-push check: the stash left no tracked change.
        'git status --porcelain=v1': { stdout: '' },
        'git status --porcelain': { stdout: ' M "caf\\303\\251/.gitignore"\n' },
        'git stash push': { stdout: 'Saved\n' },
        'git stash list -z': STASH_CREATED,
      });
      const warnSpy = sinon.spy(console, 'warn');
      try {
        await ws.snapshotChtCore('/tmp/cht-core');
      } finally {
        warnSpy.restore();
      }
      expect(warnSpy.getCalls().find(c => /ignore rules revert to HEAD/.test(String(c.args[0])))).to.exist;
    });

    it('warns without promising the CLI cannot touch the unmasked files (#140 C-3)', async () => {
      const ws = loadWorkspace({
        'git rev-parse HEAD': { stdout: 'abc1234deadbeef\n' },
        // The post-push check: the stash left no tracked change.
        'git status --porcelain=v1': { stdout: '' },
        'git status --porcelain': { stdout: ' M .gitignore\n' },
        'git stash push': { stdout: 'Saved\n' },
        'git stash list -z': STASH_CREATED,
      });
      const warnSpy = sinon.spy(console, 'warn');
      try {
        await ws.snapshotChtCore('/tmp/cht-core');
      } finally {
        warnSpy.restore();
      }
      const msg = String(warnSpy.getCalls().find(c => /ignore rules revert/.test(String(c.args[0])))?.args[0]);
      // v1 said the files "will be left untouched", which is false of the CLI.
      expect(msg).to.not.match(/left untouched/);
      expect(msg).to.match(/CLI can still read, overwrite, or delete them/);
    });

    it('does not warn about ignore rules for ordinary edits', async () => {
      const ws = loadWorkspace({
        'git rev-parse HEAD': { stdout: 'abc1234deadbeef\n' },
        // The post-push check: the stash left no tracked change.
        'git status --porcelain=v1': { stdout: '' },
        'git status --porcelain': { stdout: ' M src/a.ts\n' },
        'git stash push': { stdout: 'Saved\n' },
        'git stash list -z': STASH_CREATED,
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
        'git rev-parse HEAD': { stdout: 'abc1234\n' },
        'git diff --name-status -z abc1234': { stdout: 'A\0src/new.ts\0M\0src/changed.ts\0' },
        'git ls-files --others --exclude-standard': { stdout: '' },
        'git show': { stdout: 'old content' },
      }, regularFiles());
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
        'git rev-parse HEAD': { stdout: 'abc1234\n' },
        'git diff --name-status -z abc1234': { stdout: '' },
        'git ls-files --others --exclude-standard': { stdout: 'src/untracked.ts\0' },
      }, regularFiles());
      const files = await ws.captureChtCoreDiff('/tmp/cht-core', 'abc1234', []);
      expect(files.find((f: { path: string }) => f.path === 'src/untracked.ts')).to.exist;
    });

    it('excludes baseline untracked files and keeps CLI-created ones (#140)', async () => {
      const ws = loadWorkspace({
        'git rev-parse HEAD': { stdout: 'abc1234\n' },
        'git diff --name-status -z abc1234': { stdout: '' },
        'git ls-files --others --exclude-standard': {
          stdout: '.aider.chat\0.aider.tags\0operator-notes.md\0src/cli-made.ts\0',
        },
      }, regularFiles());
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
        'git rev-parse HEAD': { stdout: 'abc1234\n' },
        'git diff --name-status -z abc1234': {
          stdout: 'R100\0src/old.ts\0src/new.ts\0M\0src/after.ts\0',
        },
        'git ls-files --others --exclude-standard': { stdout: '' },
        'git show': { stdout: 'old content' },
      }, regularFiles());
      const files = await ws.captureChtCoreDiff('/tmp/cht-core', 'abc1234', []);
      // NEW path kept for the rename, and the following entry still parses.
      expect(files.map((f: { path: string }) => f.path)).to.deep.equal(['src/new.ts', 'src/after.ts']);
    });

    it('V3-1: a non-array baseline throws instead of misattributing operator files (#140)', async () => {
      // Symmetry with the clean path's guard. Without it, `new Set(undefined)` is
      // empty, so every pre-existing untracked file is reported as a session
      // CREATE and offered for approval into cht-core (silent RC-1 misattribution).
      const ws = loadWorkspace({
        'git rev-parse HEAD': { stdout: 'abc1234\n' },
        'git diff --name-status -z abc1234': { stdout: '' },
        'git ls-files --others --exclude-standard': { stdout: '.aider.chat\0operator-notes.md\0' },
      }, regularFiles());

      for (const bad of [undefined, null, 'operator-notes.md']) {
        let threw = false;
        try {
          await ws.captureChtCoreDiff('/tmp/cht-core', 'abc1234', bad);
        } catch (err) {
          threw = true;
          expect((err as Error).message).to.match(/baselineUntracked is missing or not an array/);
          expect((err as Error).message).to.include('captureChtCoreDiff');
        }
        expect(threw, `expected a throw for baseline ${JSON.stringify(bad)}`).to.equal(true);
      }
    });

    it('refuses to capture when HEAD moved, before it reads any file', async () => {
      const calls: string[] = [];
      const ws = loadWorkspace({
        'git rev-parse HEAD': { stdout: 'fedcba9\n' },
        'git diff --name-status -z abc1234': { stdout: 'A\0op-commit.ts\0' },
      }, regularFiles(), calls);
      let thrown: unknown;
      try {
        await ws.captureChtCoreDiff('/tmp/cht-core', 'abc1234', []);
      } catch (err) {
        thrown = err;
      }
      expect((thrown as { kind: string }).kind).to.equal('drift');
      expect((thrown as Error).message).to.include('HEAD moved from abc1234 to fedcba9');
      expect(calls.some(c => c.startsWith('git diff'))).to.equal(false);
    });

    it('reports a file too large for git show instead of parsing truncated output', async () => {
      const ws = loadWorkspace({
        'git rev-parse HEAD': { stdout: 'abc1234\n' },
        'git diff --name-status -z abc1234': { stdout: 'M\0src/huge.json\0' },
        'git show': {
          error: Object.assign(new RangeError('stdout maxBuffer length exceeded'), {
            code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',
            stdout: 'truncated',
          }),
        },
      }, regularFiles());

      const warnSpy = sinon.spy(console, 'warn');
      let files;
      try {
        files = await ws.captureChtCoreDiff('/tmp/cht-core', 'abc1234', []);
      } finally {
        warnSpy.restore();
      }
      expect(files).to.have.length(1);
      expect(files[0].originalContent).to.be.undefined;
      const warned = warnSpy.getCalls().map(c => String(c.args[0])).join('\n');
      expect(warned).to.include('src/huge.json is too large to read; original content omitted');
    });

    it('treats a path under an ignored-at-snapshot dir as the operator\'s', async () => {
      const ws = loadWorkspace({
        'git rev-parse HEAD': { stdout: 'abc1234\n' },
        'git diff --name-status -z abc1234': { stdout: '' },
        'git ls-files --others --exclude-standard': {
          stdout: 'webapp/node_modules/x/index.js\0webapp/.gitignore\0node_modules2/y.js\0',
        },
      }, regularFiles());
      const files = await ws.captureChtCoreDiff('/tmp/cht-core', 'abc1234', ['webapp/node_modules/', 'node_modules/']);
      // Only an entry that ends in / is a prefix, and only for its own subtree.
      expect(files.map((f: { path: string }) => f.path)).to.deep.equal(['webapp/.gitignore', 'node_modules2/y.js']);
    });

    it('never reads through a symlink or a non-file path', async () => {
      const readFile = sinon.stub().resolves('TARGET CONTENT');
      const ws = loadWorkspace({
        'git rev-parse HEAD': { stdout: 'abc1234\n' },
        'git diff --name-status -z abc1234': { stdout: 'T\0tracked.txt\0' },
        'git ls-files --others --exclude-standard': { stdout: 'link.txt\0' },
      }, { readFile, lstat: sinon.stub().resolves({ isFile: () => false }) });
      const warnSpy = sinon.spy(console, 'warn');
      let files;
      try {
        files = await ws.captureChtCoreDiff('/tmp/cht-core', 'abc1234', []);
      } finally {
        warnSpy.restore();
      }
      expect(files).to.deep.equal([]);
      expect(readFile.called).to.equal(false);
      const warned = warnSpy.getCalls().map(c => String(c.args[0])).join('\n');
      expect(warned).to.include('Not captured: link.txt is not a regular file');
      expect(warned).to.include('Not captured: tracked.txt is not a regular file');
    });

    it('skips deletes', async () => {
      const ws = loadWorkspace({
        'git rev-parse HEAD': { stdout: 'abc1234\n' },
        'git diff --name-status -z abc1234': { stdout: 'D\0src/deleted.ts\0A\0src/new.ts\0' },
        'git ls-files --others --exclude-standard': { stdout: '' },
      }, regularFiles());
      const files = await ws.captureChtCoreDiff('/tmp/cht-core', 'abc1234', []);
      expect(files.find((f: { path: string }) => f.path === 'src/deleted.ts')).to.not.exist;
      expect(files.find((f: { path: string }) => f.path === 'src/new.ts')).to.exist;
    });
  });

  describe('rollbackChtCore', () => {
    it('always runs reset; restores our stash by its SHA and drops exactly that entry', async () => {
      const calls: string[] = [];
      const { snapshot, script } = rollbackFixture(WITH_STASH);
      const ws = loadWorkspace(script, {}, calls);

      const result = await ws.rollbackChtCore('/tmp/cht-core', snapshot);

      expect(calls).to.include('git reset --hard abc1234');
      expect(calls).to.include(`git stash apply --index ${OUR_SHA}`);
      expect(calls).to.include('git stash drop stash@{0}');
      expect(calls.some(c => c.startsWith('git stash pop'))).to.equal(false);
      expect(result.stashPop).to.equal('ok');
    });

    it('drops our entry by its SHA even after another stash pushed it down', async () => {
      const calls: string[] = [];
      const { snapshot, script } = rollbackFixture(WITH_STASH, {
        'git stash list -z': {
          stdout: stashListZ(['stash@{0}', OTHER_SHA, 'On main: operator wip'], ['stash@{1}', OUR_SHA, `On main: ${OUR_NAME}`]),
        },
        'git stash drop': { stdout: `Dropped stash@{1} (${OUR_SHA})\n` },
      });
      const ws = loadWorkspace(script, {}, calls);

      await ws.rollbackChtCore('/tmp/cht-core', snapshot);

      expect(calls).to.include('git stash drop stash@{1}');
      expect(calls.some(c => c.startsWith('git stash drop stash@{0}'))).to.equal(false);
    });

    it('puts back an entry that a moved list made the drop take, then drops ours', async () => {
      const calls: string[] = [];
      const { snapshot, script } = rollbackFixture(WITH_STASH, {
        'git stash list -z': [
          { stdout: OUR_ENTRY }, // pre-check
          // First drop lookup: ours is stash@{0}, but an operator push lands
          // before the drop, so `drop stash@{0}` takes the operator's entry.
          { stdout: stashListZ(['stash@{0}', OUR_SHA, `On main: ${OUR_NAME}`], ['stash@{1}', OTHER_SHA, 'On main: operator wip']) },
          // Second lookup, after the put-back.
          { stdout: stashListZ(['stash@{0}', OTHER_SHA, 'On main: operator wip'], ['stash@{1}', OUR_SHA, `On main: ${OUR_NAME}`]) },
        ],
        'git stash drop stash@{0}': { stdout: `Dropped stash@{0} (${OTHER_SHA})\n` },
        'git stash drop stash@{1}': { stdout: `Dropped stash@{1} (${OUR_SHA})\n` },
      });
      const ws = loadWorkspace(script, {}, calls);

      const result = await ws.rollbackChtCore('/tmp/cht-core', snapshot);

      expect(calls).to.include(`git stash store -m On main: operator wip ${OTHER_SHA}`);
      expect(calls).to.include('git stash drop stash@{1}');
      expect(result.stashPop).to.equal('ok');
    });

    it('reports a spare copy, and no drop command, when our entry cannot be dropped', async () => {
      const { snapshot, script } = rollbackFixture(WITH_STASH, {
        'git stash drop': { error: new Error('fatal: cannot lock ref') },
      });
      const ws = loadWorkspace(script);
      const warnSpy = sinon.spy(console, 'warn');
      let result;
      try {
        result = await ws.rollbackChtCore('/tmp/cht-core', snapshot);
      } finally {
        warnSpy.restore();
      }
      const warned = warnSpy.getCalls().map(c => String(c.args[0])).join('\n');
      expect(result.stashPop).to.equal('ok');
      expect(warned).to.include(`Your work is restored; the stash entry ${OUR_NAME} is a spare copy`);
      expect(warned).to.not.include('stash drop');
    });

    it('cleans ONLY session-created paths, sparing the baseline (#140)', async () => {
      const calls: string[] = [];
      const { snapshot, script } = rollbackFixture({ baselineUntracked: ['.aider.chat'] }, {
        'git ls-files --others --exclude-standard': { stdout: '.aider.chat\0src/cli-made.ts\0' },
      });
      const ws = loadWorkspace(script, {}, calls);

      await ws.rollbackChtCore('/tmp/cht-core', snapshot);

      const cleanCall = calls.find(c => c.startsWith('git clean'));
      // :(literal) so a metachar in a session filename cannot fnmatch-delete an
      // operator file (#140 F-1).
      expect(cleanCall).to.equal('git clean -fd -- :(literal)src/cli-made.ts');
      expect(cleanCall).to.not.include('.aider.chat'); // operator's file spared
    });

    it('skips the clean entirely when the delta is empty (no blanket clean) (#140)', async () => {
      const calls: string[] = [];
      const { snapshot, script } = rollbackFixture({ baselineUntracked: ['.aider.chat', 'operator-notes.md'] }, {
        // Everything untracked is the operator's; nothing of ours to remove.
        'git ls-files --others --exclude-standard': { stdout: '.aider.chat\0operator-notes.md\0' },
      });
      const ws = loadWorkspace(script, {}, calls);

      const result = await ws.rollbackChtCore('/tmp/cht-core', snapshot);

      expect(calls.some(c => c.startsWith('git clean'))).to.equal(false);
      expect(result.clean).to.equal('ok');
    });

    it('skips the stash restore when the snapshot took no stash', async () => {
      const calls: string[] = [];
      const { snapshot, script } = rollbackFixture();
      const ws = loadWorkspace(script, {}, calls);

      await ws.rollbackChtCore('/tmp/cht-core', snapshot);

      expect(calls.some(c => c.startsWith('git stash apply'))).to.equal(false);
    });

    describe('pre-checks (nothing is changed when one fails)', () => {
      const expectDrift = async (
        ws: { rollbackChtCore: (p: string, s: unknown) => Promise<unknown> },
        snapshot: unknown,
        calls: string[],
        text: string,
      ) => {
        let thrown: unknown;
        try {
          await ws.rollbackChtCore('/tmp/cht-core', snapshot);
        } catch (err) {
          thrown = err;
        }
        expect((thrown as { kind: string }).kind).to.equal('drift');
        expect((thrown as { lines: string[] }).lines.join('\n')).to.include(text);
        for (const destructive of ['git reset', 'git clean', 'git stash apply', 'git stash drop']) {
          expect(calls.some(c => c.startsWith(destructive)), destructive).to.equal(false);
        }
      };

      it('refuses a second rollback of the same snapshot', async () => {
        const calls: string[] = [];
        const { snapshot, script } = rollbackFixture();
        const ws = loadWorkspace(script, {}, calls);
        await ws.rollbackChtCore('/tmp/cht-core', snapshot);
        calls.length = 0;
        await expectDrift(ws, snapshot, calls, 'already rolled back; nothing was changed');
        expect(calls).to.deep.equal([]); // no repo reads either
      });

      it('refuses a snapshot of another repo', async () => {
        const calls: string[] = [];
        const { snapshot, script } = rollbackFixture({}, {
          'git rev-parse --show-toplevel': { stdout: '/tmp/other-repo\n' },
        });
        const ws = loadWorkspace(script, {}, calls);
        await expectDrift(ws, snapshot, calls, 'This snapshot belongs to /tmp/cht-core, not /tmp/other-repo');
      });

      it('refuses when HEAD moved, and does not offer a reset', async () => {
        const calls: string[] = [];
        const { snapshot, script } = rollbackFixture(WITH_STASH, {
          'git rev-parse HEAD': { stdout: 'fedcba9\n' },
          'git diff --name-only -z HEAD': { stdout: 'op-commit.ts\0' },
        });
        const ws = loadWorkspace(script, {}, calls);
        await expectDrift(ws, snapshot, calls, 'HEAD moved from abc1234 to fedcba9');
      });

      it('refuses when the branch changed at the same SHA', async () => {
        const calls: string[] = [];
        const { snapshot, script } = rollbackFixture({}, {
          'git symbolic-ref -q HEAD': { stdout: 'refs/heads/twin\n' },
        });
        const ws = loadWorkspace(script, {}, calls);
        await expectDrift(ws, snapshot, calls, 'The branch changed from refs/heads/main to refs/heads/twin');
      });

      it('refuses when our stash is no longer listed', async () => {
        const calls: string[] = [];
        const { snapshot, script } = rollbackFixture(WITH_STASH, {
          'git stash list -z': { stdout: stashListZ(['stash@{0}', OTHER_SHA, 'On main: operator wip']) },
        });
        const ws = loadWorkspace(script, {}, calls);
        await expectDrift(ws, snapshot, calls, `Stash ${OUR_NAME} is no longer in the stash list`);
      });

      it('refuses when a pre-check read fails, and lets a later call through', async () => {
        const calls: string[] = [];
        const { snapshot, script } = rollbackFixture({}, {
          'git rev-parse --show-toplevel': [{ error: new Error('fatal: not a git repository') }, { stdout: '/tmp/cht-core\n' }],
        });
        const ws = loadWorkspace(script, {}, calls);
        await expectDrift(ws, snapshot, calls, 'could not read the repo state before rollback');
        // A refused call does not use up the snapshot.
        const result = await ws.rollbackChtCore('/tmp/cht-core', snapshot);
        expect(result.reset).to.equal('ok');
      });
    });
  });

  describe('buildRecoveryChecklist', () => {
    it('prints each session path inside a command as one safely quoted shell word', () => {
      const ws = loadWorkspace({});
      const weird = "it's a\nname; touch pwned.ts";
      const lines: string[] = ws.buildRecoveryChecklist(
        "/tmp/cht core's",
        SNAPSHOT,
        { reset: 'failed', clean: 'skipped', stashPop: 'skipped', errors: ['reset: boom'], survivors: [weird, 'plain.ts'] },
      );
      const clean = lines.find(l => l.includes('clean -fd --'));
      expect(clean).to.exist;
      // Let a real shell split the printed words; each path must come back whole.
      const words = String(clean).slice(String(clean).indexOf('git -C ') + 'git '.length);
      const argv = execFileSync('sh', ['-c', `printf '%s\\0' ${words}`], { encoding: 'utf8' }).split('\0');
      expect(argv).to.deep.equal([
        '-C', "/tmp/cht core's", 'clean', '-fd', '--', `:(literal)${weird}`, ':(literal)plain.ts', '',
      ]);
    });

    it('gives the restore-failure order and names the dirs that block it', () => {
      const ws = loadWorkspace({});
      const lines: string[] = ws.buildRecoveryChecklist('/tmp/cht-core', { ...SNAPSHOT, ...WITH_STASH }, {
        reset: 'ok', clean: 'ok', stashPop: 'failed',
        errors: ["stash apply: error: unable to unlink old 'ro/f.txt': Permission denied"],
        popResidue: ['ro/new.txt'], popBlockers: ['ro/f.txt'], unwritableDirs: ['ro'],
      });
      const text = lines.join('\n');
      expect(text).to.include(`Your work is still in stash ${OUR_NAME}`);
      expect(text).to.include('"ro/f.txt"');
      expect(text).to.match(/"ro" \(Permission denied\)\. Fix the permissions/);
      const resetAt = text.indexOf('reset --hard abc1234');
      const removeAt = text.indexOf("clean -fd -- ':(literal)ro/new.txt'");
      const restoreAt = text.indexOf('stash pop --index');
      expect(resetAt).to.be.greaterThan(-1);
      expect(removeAt).to.be.greaterThan(resetAt);
      expect(restoreAt).to.be.greaterThan(removeAt);
      expect(text).to.include('without --index');
      expect(text).to.not.match(/stash@\{\d+\}/);
      expect(text).to.not.include('stash drop');
    });
  });

  describe('verify-then-throw pattern (R14/R15)', () => {
    // Stub Date.now so the stash-name is deterministic across the test run.
    beforeEach(() => {
      sinon.stub(Date, 'now').returns(NOW);
    });

    afterEach(() => {
      sinon.restore();
    });

    it('A.4: stash push exits non-zero but stash was created → no throw', async () => {
      const ws = loadWorkspace({
        'git rev-parse HEAD': { stdout: 'abc1234\n' },
        // The post-push check: the stash left no tracked change.
        'git status --porcelain=v1': { stdout: '' },
        'git status --porcelain': { stdout: ' M file.ts\n' },
        'git stash push': { error: new Error('warning: could not remove file') },
        'git stash list -z': STASH_CREATED,
      });

      const snap = await ws.snapshotChtCore('/tmp/cht-core');
      expect(snap.headSha).to.equal('abc1234');
      expect(snap.stashSha).to.equal(OUR_SHA);
      expect(snap.stashName).to.equal(OUR_NAME);
    });

    it('A.4: stash push exits non-zero AND no stash was created → re-throws', async () => {
      const ws = loadWorkspace({
        'git rev-parse HEAD': { stdout: 'abc1234\n' },
        // The post-push check: the stash left no tracked change.
        'git status --porcelain=v1': { stdout: '' },
        'git status --porcelain': { stdout: ' M file.ts\n' },
        'git stash push': { error: new Error('fatal: stash failed') },
        // Verify returns a stash list that does NOT contain our marker.
        'git stash list -z': { stdout: stashListZ(['stash@{0}', OTHER_SHA, 'On main: someone-elses-stash']) },
      });

      let threw = false;
      try {
        await ws.snapshotChtCore('/tmp/cht-core');
      } catch (err) {
        threw = true;
        expect((err as { kind: string }).kind).to.equal('stash');
        expect((err as Error).message).to.match(/stash failed/);
        expect((err as Error).message).to.include('nothing was stashed and your tree is unchanged');
      }
      expect(threw).to.equal(true);
    });

    it('puts the work back and stops when a read after the stash fails', async () => {
      const listingError = new Error('fatal: ls-files blew up');
      const calls: string[] = [];
      const ws = loadWorkspace({
        'git rev-parse HEAD': { stdout: 'abc1234\n' },
        'git status --porcelain=v1': { stdout: '' },
        'git status --porcelain': { stdout: ' M file.ts\n' },
        'git stash push': { stdout: 'Saved\n' },
        'git stash list -z': STASH_CREATED,
        'git stash drop': { stdout: `Dropped stash@{0} (${OUR_SHA})\n` },
        'git ls-files --others --ignored': { error: listingError },
      }, {}, calls);

      let thrown: unknown;
      try {
        await ws.snapshotChtCore('/tmp/cht-core');
      } catch (err) {
        thrown = err;
      }
      expect((thrown as { kind: string }).kind).to.equal('precondition');
      expect((thrown as Error).cause).to.equal(listingError);
      expect((thrown as Error).message).to.include('put your work back');
      expect(calls).to.include('git stash drop stash@{0}');
    });

    it('keeps the stash and names the paths when the undo cannot restore them', async () => {
      const calls: string[] = [];
      const ws = loadWorkspace({
        'git rev-parse HEAD': { stdout: 'abc1234\n' },
        // The push left a tracked change: the stash did not clean the tree.
        'git status --porcelain=v1': { stdout: ' M rt/t.txt\0' },
        'git status --porcelain': { stdout: ' M rt/t.txt\n' },
        'git stash push': { error: Object.assign(new Error('Command failed'), {
          stderr: "error: unable to unlink old 'rt/t.txt': Permission denied\n",
        }) },
        'git stash list -z': STASH_CREATED,
        [`git diff --name-only --no-renames -z ${OUR_SHA}`]: { stdout: 'rt/t.txt\0' },
        'git restore': { error: new Error('error: unable to unlink old rt/t.txt') },
      }, {}, calls);

      let thrown: unknown;
      try {
        await ws.snapshotChtCore('/tmp/cht-core');
      } catch (err) {
        thrown = err;
      }
      expect((thrown as { kind: string }).kind).to.equal('stash');
      const lines = (thrown as { lines: string[] }).lines.join('\n');
      expect(lines).to.include(`Your work is still in stash ${OUR_NAME}`);
      expect(lines).to.include('the restore failed: error: unable to unlink old rt/t.txt');
      expect(lines).to.include('The rest of your work is already back');
      expect(lines.indexOf('reset --hard abc1234')).to.be.lessThan(lines.indexOf('stash pop --index'));
      expect(calls.some(c => c.startsWith('git stash drop'))).to.equal(false);
    });

    it('A.5: reset --hard exits non-zero but HEAD matches → no warning', async () => {
      const { snapshot, script } = rollbackFixture({}, {
        'git reset --hard abc1234': { error: new Error('warning during reset') },
        // verify (tree diff vs the snapshot) says the reset landed
        'git diff --quiet abc1234': { stdout: '' },
      });
      const ws = loadWorkspace(script);

      // Should not throw and should not log a "during rollback failed" warning.
      const warnSpy = sinon.spy(console, 'warn');
      try {
        await ws.rollbackChtCore('/tmp/cht-core', snapshot);
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
      const { snapshot, script } = rollbackFixture({}, {
        'git reset --hard': { error: new Error('fatal: Unable to create index.lock') },
        'git diff --quiet abc1234': { error: new Error('tree still differs') },
      });
      const ws = loadWorkspace(script);

      const result = await ws.rollbackChtCore('/tmp/cht-core', snapshot);
      expect(result.reset).to.equal('failed');
      expect(result.errors[0]).to.match(/^reset: /);
    });

    it('skips the clean and the restore after a failed reset, and records what is left', async () => {
      const calls: string[] = [];
      const { snapshot, script } = rollbackFixture(WITH_STASH, {
        'git reset --hard': { error: Object.assign(new Error('Command failed: git reset --hard abc1234'), {
          stderr: "error: unable to unlink old 'rt/t.txt': Permission denied\n",
        }) },
        'git diff --quiet abc1234': { error: new Error('tree still differs') },
        'git diff --name-only -z abc1234': { stdout: 'rt/t.txt\0' },
        'git ls-files --others --exclude-standard': { stdout: 'session-new.ts\0' },
      });
      const ws = loadWorkspace(script, {}, calls);

      const result = await ws.rollbackChtCore('/tmp/cht-core', snapshot);

      expect(result).to.include({ reset: 'failed', clean: 'skipped', stashPop: 'skipped' });
      expect(result.sessionEdits).to.deep.equal(['rt/t.txt']);
      expect(result.survivors).to.deep.equal(['session-new.ts']);
      // git's own words, not node's "Command failed: <argv>" line.
      expect(result.errors[0]).to.equal("reset: error: unable to unlink old 'rt/t.txt': Permission denied");
      expect(calls.some(c => c.startsWith('git clean'))).to.equal(false);
      expect(calls.some(c => c.startsWith('git stash apply'))).to.equal(false);
    });

    it('F-4: a baseline-less snapshot throws instead of blanket-cleaning (#140)', async () => {
      const calls: string[] = [];
      // An untyped caller (or a stale spec literal) omitting the baseline.
      const { snapshot, script } = rollbackFixture({ baselineUntracked: undefined }, {
        'git ls-files': { stdout: 'operator-file.txt\0' },
      });
      const ws = loadWorkspace(script, {}, calls);

      const result = await ws.rollbackChtCore('/tmp/cht-core', snapshot);

      expect(result.clean).to.equal('failed');
      expect(result.errors.join(' ')).to.match(/baselineUntracked is missing or not an array/);
      expect(calls.some(c => c.startsWith('git clean'))).to.equal(false); // nothing deleted
    });

    it('M5: a failing chunk does not stop later chunks from being cleaned (#140)', async () => {
      // >1000 delta paths means >1 `git clean` invocation. Aborting on the first
      // failure would leave every later chunk's session file on disk.
      const paths = Array.from({ length: 1500 }, (_, i) => `session/f${i}.ts`);
      const calls: string[] = [];
      const { snapshot, script } = rollbackFixture({}, {
        'git ls-files': { stdout: paths.join('\0') + '\0' },
        // Fail the FIRST chunk only.
        'git clean': [{ error: new Error('chunk 1 blew up') }, { stdout: '' }],
      });
      const ws = loadWorkspace(script, {
        lstat: sinon.stub().resolves({}), // chunk 1's paths still present -> genuinely failed
      }, calls);

      const result = await ws.rollbackChtCore('/tmp/cht-core', snapshot);

      expect(calls.filter(c => c.startsWith('git clean'))).to.have.length(2); // second chunk still attempted
      expect(result.clean).to.equal('failed');       // and the failure is reported
      expect(result.errors.join(' ')).to.match(/chunk 1 blew up/);
    });

    it('M2: a non-ENOENT stat error counts as NOT removed → clean failed (#140)', async () => {
      const { snapshot, script } = rollbackFixture({}, {
        'git ls-files --others --exclude-standard': { stdout: 'src/cli-made.ts\0' },
        'git clean -fd': { error: new Error('permission denied') },
      });
      const ws = loadWorkspace(script, {
        // v1 caught every error as "removed"; EACCES means the clean did NOT work.
        lstat: sinon.stub().rejects(errno('EACCES')),
      });

      const result = await ws.rollbackChtCore('/tmp/cht-core', snapshot);
      expect(result.clean).to.equal('failed');
    });

    it('A.5: clean exits non-zero but the delta paths are gone → no warning', async () => {
      const { snapshot, script } = rollbackFixture({}, {
        'git ls-files --others --exclude-standard': { stdout: 'src/cli-made.ts\0' },
        'git clean -fd': { error: new Error('warning: could not remove') },
      });
      const ws = loadWorkspace(script, {
        // Verifier asserts removal: ENOENT means the file is gone.
        lstat: sinon.stub().rejects(errno('ENOENT')),
      });

      const warnSpy = sinon.spy(console, 'warn');
      let result;
      try {
        result = await ws.rollbackChtCore('/tmp/cht-core', snapshot);
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
      const { snapshot, script } = rollbackFixture({ baselineUntracked: ['.aider.chat'] }, {
        'git ls-files --others --exclude-standard': { stdout: '.aider.chat\0src/cli-made.ts\0' },
        'git clean -fd': { error: new Error('warning: could not remove') },
        'git status --porcelain': { stdout: '?? .aider.chat\n' }, // still dirty, legitimately
      });
      const ws = loadWorkspace(script, {
        lstat: sinon.stub().rejects(errno('ENOENT')),
      });

      const result = await ws.rollbackChtCore('/tmp/cht-core', snapshot);
      expect(result.clean).to.equal('ok');
      expect(result.errors).to.deep.equal([]);
    });

    it('A.5: clean reports failure when a delta path still exists', async () => {
      const { snapshot, script } = rollbackFixture({}, {
        'git ls-files --others --exclude-standard': { stdout: 'src/cli-made.ts\0' },
        'git clean -fd': { error: new Error('permission denied') },
      });
      const ws = loadWorkspace(script, {
        lstat: sinon.stub().resolves({}), // file is still there
      });

      const result = await ws.rollbackChtCore('/tmp/cht-core', snapshot);
      expect(result.clean).to.equal('failed');
      expect(result.errors[0]).to.match(/^clean: /);
    });

    it('a failed restore keeps our entry and records what blocks a manual one', async () => {
      const calls: string[] = [];
      const { snapshot, script } = rollbackFixture(WITH_STASH, {
        'git stash apply': { error: Object.assign(new Error('Command failed'), {
          stderr: "error: unable to unlink old 'ro/f.txt': Permission denied\nIndex was not unstashed.\n",
        }) },
        'git ls-files --others --exclude-standard': { stdout: 'ro/new.txt\0' },
        'git diff --name-only --no-renames -z': { stdout: 'ro/f.txt\0' },
        'git rev-parse -q --verify': { error: new Error('no third parent') },
      });
      const ws = loadWorkspace(script, {
        lstat: sinon.stub().resolves({}),
        access: sinon.stub().rejects(errno('EACCES')),
      }, calls);

      const warnSpy = sinon.spy(console, 'warn');
      let result;
      try {
        result = await ws.rollbackChtCore('/tmp/cht-core', snapshot);
      } finally {
        warnSpy.restore();
      }

      expect(result.stashPop).to.equal('failed');
      expect(result.errors[0]).to.match(/^stash apply: error: unable to unlink old/);
      expect(result.popResidue).to.deep.equal(['ro/new.txt']);
      expect(result.popBlockers).to.deep.equal(['ro/f.txt']);
      expect(result.unwritableDirs).to.deep.equal(['ro']);
      expect(calls.some(c => c.startsWith('git stash drop'))).to.equal(false); // entry untouched
      const warned = warnSpy.getCalls().map(c => String(c.args[0])).join('\n');
      expect(warned).to.include(`Your work is still in stash ${OUR_NAME}`);
      expect(warned).to.not.match(/stash@\{\d+\}/);
    });

    it('A.14: returns typed RollbackResult with per-op outcomes', async () => {
      const { snapshot, script } = rollbackFixture(WITH_STASH);
      const ws = loadWorkspace(script);

      const result = await ws.rollbackChtCore('/tmp/cht-core', snapshot);
      expect(result.reset).to.equal('ok');
      expect(result.clean).to.equal('ok');
      expect(result.stashPop).to.equal('ok');
      expect(result.errors).to.deep.equal([]);
    });

    it('A.14: stashPop is "skipped" when there is no stash', async () => {
      const { snapshot, script } = rollbackFixture();
      const ws = loadWorkspace(script);

      const result = await ws.rollbackChtCore('/tmp/cht-core', snapshot);
      expect(result.stashPop).to.equal('skipped');
    });

    it('A.14: reset failure is captured in result.errors and result.reset', async () => {
      const { snapshot, script } = rollbackFixture({}, {
        'git reset --hard': { error: new Error('reset blew up') },
        // Verify says the tree still differs from the snapshot, so reset is judged failed.
        'git diff --quiet abc1234': { error: new Error('tree still differs') },
      });
      const ws = loadWorkspace(script);

      const result = await ws.rollbackChtCore('/tmp/cht-core', snapshot);
      expect(result.reset).to.equal('failed');
      expect(result.errors).to.have.length(1);
      expect(result.errors[0]).to.match(/^reset: /);
    });
  });
});
