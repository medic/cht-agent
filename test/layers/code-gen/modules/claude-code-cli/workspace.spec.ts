/* eslint-disable @typescript-eslint/no-var-requires */
import { expect } from 'chai';
import sinon from 'sinon';
import * as util from 'node:util';
import { execFileSync } from 'node:child_process';
import { STASH_MARKER_PREFIX, buildLeakedStashLine } from '../../../../../src/layers/code-gen/modules/claude-code-cli/workspace';

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
const scriptedExecFile = (script: Script, calls: string[] = [], options: Array<{ env?: NodeJS.ProcessEnv }> = []) => {
  const used = new Map<string, number>();
  const fn = (_cmd: string, _args: string[], _opts: object, cb: (err: Error | null, stdout: string, stderr: string) => void) => {
    cb(null, '', ''); // callback path (workspace.ts never uses it)
  };
  (fn as unknown as Record<symbol, unknown>)[util.promisify.custom] = (cmd: string, args: string[], opts: { env?: NodeJS.ProcessEnv }) => {
    const key = `${cmd} ${args.join(' ')}`;
    calls.push(key);
    options.push(opts);
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

const loadWorkspace = (
  script: Script,
  fsStubs: Record<string, unknown> = {},
  calls: string[] = [],
  options: Array<{ env?: NodeJS.ProcessEnv }> = [],
) => {
  return proxyquire(WORKSPACE, {
    'node:child_process': { execFile: scriptedExecFile(script, calls, options) },
    'node:fs/promises': {
      readFile: sinon.stub().resolves('file contents'),
      ...fsStubs,
    },
  });
};

const NOW = 1700000000000;
const OUR_NAME = `${STASH_MARKER_PREFIX}${NOW}`;
const OUR_SHA = '1111111111111111111111111111111111111111';
const OTHER_SHA = '2222222222222222222222222222222222222222';

/** `git stash list -z --format=%gd%x00%H%x00%ct%x00%gs` output for these entries. */
const stashListZ = (...entries: Array<[ref: string, sha: string, message: string]>) =>
  entries.map(([ref, sha, message]) => `${ref}\0${sha}\0${NOW / 1000}\0${message}\0`).join('');

const OUR_ENTRY = stashListZ(['stash@{0}', OUR_SHA, `On main: ${OUR_NAME}`]);

/** The leftover check reads the list first (nothing of ours), then the creation check finds ours. */
const STASH_CREATED: Answer[] = [{ stdout: '' }, { stdout: OUR_ENTRY }];

const errno = (code: string) => Object.assign(new Error(code), { code });

/**
 * The test's own keys, first and unchanged, then each default the test does not
 * set. (An object spread would keep the order but let a default override.)
 */
const withDefaults = (script: Script, defaults: Script): Script => {
  const merged: Script = { ...script };
  for (const [key, answer] of Object.entries(defaults)) {
    if (!(key in merged)) merged[key] = answer;
  }
  return merged;
};

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
  return {
    snapshot,
    script: withDefaults(script, {
      'git rev-parse --show-toplevel': { stdout: `${snapshot.repoRoot}\n` },
      'git rev-parse HEAD': { stdout: `${snapshot.headSha}\n` },
      'git symbolic-ref -q HEAD': { stdout: `${snapshot.headRef}\n` },
      'git stash list -z': { stdout: ourList },
      'git stash drop': { stdout: `Dropped stash@{0} (${snapshot.stashSha})\n` },
    }),
  };
};

describe('workspace.ts', () => {
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

    it('records the untracked files the listing reports as the baseline', async () => {
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

    it('reads the baseline when status hides untracked files (status.showUntrackedFiles=no)', async () => {
      const ws = loadWorkspace({
        'git rev-parse HEAD': { stdout: 'abc1234deadbeef\n' },
        // With status.showUntrackedFiles=no the tree looks clean, so no stash is
        // taken, but the operator's untracked file is there all the same.
        'git status --porcelain': { stdout: '' },
        'git ls-files --others --exclude-standard': { stdout: 'operator-notes.md\0' },
      });
      const snap = await ws.snapshotChtCore('/tmp/cht-core');
      expect(snap.stashSha).to.be.null;
      expect(snap.baselineUntracked).to.deep.equal(['operator-notes.md']);
    });

    it('refuses to start when a previous run leaked a cht-agent stash', async () => {
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
        const msg = (err as { lines: string[] }).lines.join('\n');
        expect(msg).to.match(/leftover cht-agent stash/i);
        // Lookup by exact name, then restore the ref that line starts with: not
        // `stash pop <name>` (not a valid ref) and not a concrete stash@{N} (goes
        // stale as soon as anything else is stashed).
        expect(msg).to.include(
          `git -C '/tmp/cht-core' stash list --format='%gd  %cr  %gs' | grep -E ': ${OUR_NAME}$'`,
        );
        // The lookup and the restore are separate lines, and each runs as copied.
        const lines = msg.split('\n');
        const find = lines.find(l => l.startsWith('Find the stash: '));
        const restore = lines.find(l => l.startsWith('Restore it: '));
        expect(find).to.equal(`Find the stash: git -C '/tmp/cht-core' stash list --format='%gd  %cr  %gs' | grep -E ': ${OUR_NAME}$'`);
        expect(restore).to.include("git -C '/tmp/cht-core' stash pop --index \"$ref\"");
        expect(restore).to.not.include('<');
        expect(msg).to.not.match(/stash@\{\d+\}/);
        // The stash may belong to a live run on this checkout.
        expect(msg).to.not.match(/interrupted run/);
      }
      expect(threw).to.equal(true);
    });

    it('does not read CHT_AGENT_IGNORE_LEAKED_STASH', async () => {
      const prev = process.env.CHT_AGENT_IGNORE_LEAKED_STASH;
      process.env.CHT_AGENT_IGNORE_LEAKED_STASH = 'true';
      try {
        const ws = loadWorkspace({
          'git stash list -z': { stdout: OUR_ENTRY },
          'git rev-parse HEAD': { stdout: 'abc1234deadbeef\n' },
          'git status --porcelain': { stdout: '' },
        });
        const err = await ws.snapshotChtCore('/tmp/cht-core').catch((e: unknown) => e) as {
          kind?: string; lines?: string[];
        };
        expect(err.kind).to.equal('precondition');
        expect(err.lines?.at(-1)).to.equal(
          'Or run npm run dev:run or npm run full again: their start check lets you continue and leave the stash in place.',
        );
      } finally {
        if (prev === undefined) delete process.env.CHT_AGENT_IGNORE_LEAKED_STASH;
        else process.env.CHT_AGENT_IGNORE_LEAKED_STASH = prev;
      }
    });

    it('proceeds past a leftover stash whose SHA the caller accepted', async () => {
      const ws = loadWorkspace({
        'git stash list -z': { stdout: OUR_ENTRY },
        'git rev-parse HEAD': { stdout: 'abc1234deadbeef\n' },
        'git status --porcelain': { stdout: '' },
      });
      const snap = await ws.snapshotChtCore('/tmp/cht-core', { acceptedLeftoverShas: [OUR_SHA] })
        .catch((err: Error) => expect.fail(`the snapshot refused: ${err.message}`));
      expect(snap.headSha).to.equal('abc1234deadbeef');
    });

    it('still refuses a leftover that the caller did not accept, naming only that one', async () => {
      const ws = loadWorkspace({
        'git stash list -z': {
          stdout: stashListZ(
            ['stash@{0}', OUR_SHA, `On main: ${STASH_MARKER_PREFIX}1700000000001`],
            ['stash@{1}', OTHER_SHA, `On main: ${STASH_MARKER_PREFIX}1700000000000`],
          ),
        },
        'git rev-parse HEAD': { stdout: 'abc1234deadbeef\n' },
        'git status --porcelain': { stdout: '' },
      });
      const err = await ws.snapshotChtCore('/tmp/cht-core', { acceptedLeftoverShas: [OUR_SHA] })
        .catch((e: unknown) => e) as { kind?: string; lines?: string[] };
      expect(err.kind).to.equal('precondition');
      const text = (err.lines ?? []).join('\n');
      expect(text).to.include('has 1 leftover cht-agent stash(es)');
      expect(text).to.include(`grep -E ': ${STASH_MARKER_PREFIX}1700000000000$'`);
      expect(text).to.not.include(`${STASH_MARKER_PREFIX}1700000000001`);
    });

    describe('the leftover list and its lines', () => {
      const nowSeconds = NOW / 1000;
      const rawEntry = (ref: string, sha: string, createdAt: number, message: string) =>
        `${ref}\0${sha}\0${createdAt}\0${message}\0`;

      it('lists every leftover with its SHA, time and age, and skips user stashes that mention the marker', async () => {
        const ws = loadWorkspace({
          'git stash list -z': {
            stdout: [
              rawEntry('stash@{0}', OUR_SHA, nowSeconds - 30, `On main: ${STASH_MARKER_PREFIX}1`),
              rawEntry('stash@{1}', OTHER_SHA, nowSeconds, `On main: wip after ${STASH_MARKER_PREFIX}1700000000000 crash`),
              rawEntry('stash@{2}', '3'.repeat(40), nowSeconds - 60, `On main: ${STASH_MARKER_PREFIX}2`),
              rawEntry('stash@{3}', '4'.repeat(40), nowSeconds - 2 * 3600, `On main: ${STASH_MARKER_PREFIX}3`),
              rawEntry('stash@{4}', '5'.repeat(40), nowSeconds - 5 * 86400, `On main: ${STASH_MARKER_PREFIX}4`),
            ].join(''),
          },
        });
        expect(await ws.listLeftoverStashes('/tmp/cht-core')).to.deep.equal([
          { name: `${STASH_MARKER_PREFIX}1`, sha: OUR_SHA, createdAt: nowSeconds - 30, age: 'less than a minute ago' },
          { name: `${STASH_MARKER_PREFIX}2`, sha: '3'.repeat(40), createdAt: nowSeconds - 60, age: '1 minute ago' },
          { name: `${STASH_MARKER_PREFIX}3`, sha: '4'.repeat(40), createdAt: nowSeconds - 2 * 3600, age: '2 hours ago' },
          { name: `${STASH_MARKER_PREFIX}4`, sha: '5'.repeat(40), createdAt: nowSeconds - 5 * 86400, age: '5 days ago' },
        ]);
      });

      it('reads the stash list once', async () => {
        const calls: string[] = [];
        const ws = loadWorkspace({ 'git stash list -z': { stdout: OUR_ENTRY } }, {}, calls);
        await ws.listLeftoverStashes('/tmp/cht-core');
        expect(calls.filter(c => c.startsWith('git stash list'))).to.have.length(1);
      });

      it('refuses as precondition when the stash list cannot be read', async () => {
        const failure = Object.assign(new Error('Command failed: git stash list\nfatal: bad config'), {
          code: 128, stderr: 'fatal: bad config',
        });
        const ws = loadWorkspace({ 'git stash list -z': { error: failure } });
        const err = await ws.listLeftoverStashes('/tmp/cht-core').catch((e: unknown) => e) as {
          kind?: string; message: string; cause?: unknown;
        };
        expect(err.kind).to.equal('precondition');
        expect(err.message).to.equal('cht-agent could not read the stash list (fatal: bad config); nothing was changed.');
        expect(err.cause).to.equal(failure);
      });

      it('gives the refusal lines with the age and the commands, and no action line', () => {
        const ws = loadWorkspace({});
        const lines: string[] = ws.leftoverStashLines('/tmp/cht-core', [
          { name: OUR_NAME, sha: OUR_SHA, createdAt: nowSeconds, age: 'less than a minute ago' },
        ]);
        expect(lines).to.have.length(4);
        expect(lines[0]).to.equal(
          `cht-core at /tmp/cht-core has 1 leftover cht-agent stash(es) that no run restored: ${OUR_NAME} ` +
            '(created 2023-11-14T22:13:20.000Z, less than a minute ago). It may hold your uncommitted work, or ' +
            'belong to another cht-agent run that is still active here.',
        );
        expect(lines[1]).to.match(/^Find the stash: /);
        expect(lines[2]).to.match(/^Restore it: /);
        expect(lines[3]).to.equal('If git says "conflicts in index", run the restore again without --index.');
      });
    });

    it('builds the leftover-stash pattern from the marker, matching it literally', () => {
      const pattern = buildLeakedStashLine('x.y+');
      expect(pattern.test('On main: x.y+123')).to.equal(true);
      expect(pattern.test('On main: xzy+123')).to.equal(false);
      expect(pattern.test('On main: x.y+123 crash note')).to.equal(false);
    });

    it('does not warn about ignore rules for an untracked name that merely holds " -> "', async () => {
      const ws = loadWorkspace({
        'git rev-parse HEAD': { stdout: 'abc1234deadbeef\n' },
        'git status --porcelain=v1': { stdout: '' },
        'git status --porcelain': { stdout: '?? "a -> .gitignore -> b"\n' },
        'git stash push': { stdout: 'Saved\n' },
        'git stash list -z': STASH_CREATED,
      });
      const warnSpy = sinon.spy(console, 'warn');
      try {
        await ws.snapshotChtCore('/tmp/cht-core');
      } finally {
        warnSpy.restore();
      }
      expect(warnSpy.getCalls().find(c => /ignore rules revert to HEAD/.test(String(c.args[0])))).to.be.undefined;
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

    it('does not false-positive on a user stash that merely mentions the marker', async () => {
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

    it('reports EVERY leaked stash, not just the first line', async () => {
      const ws = loadWorkspace({
        'git stash list -z': {
          stdout: stashListZ(
            ['stash@{0}', OTHER_SHA, 'On main: my own wip'],
            ['stash@{1}', OUR_SHA, `On main: ${STASH_MARKER_PREFIX}1700000000001`],
            ['stash@{2}', '3333333333333333333333333333333333333333', `On main: ${STASH_MARKER_PREFIX}1700000000000`],
          ),
        },
        'git rev-parse HEAD': { stdout: 'abc1234deadbeef\n' },
        'git status --porcelain': { stdout: '' },
      });
      let msg = '';
      try {
        await ws.snapshotChtCore('/tmp/cht-core');
      } catch (err) {
        msg = (err as { lines: string[] }).lines.join('\n');
      }
      // A real leak can sit under a user stash; naming only the first sends the
      // operator to the wrong entry. Each one gets its own lookup.
      expect(msg).to.include(`grep -E ': ${STASH_MARKER_PREFIX}1700000000001$'`);
      expect(msg).to.include(`grep -E ': ${STASH_MARKER_PREFIX}1700000000000$'`);
      expect(msg).to.include('created 2023-11-14T22:13:20.000Z');
      expect(msg).to.not.include('my own wip');
      expect(msg).to.not.match(/stash@\{\d+\}/);
    });

    it('stops when a zero-exit stash push saved nothing, naming what it did not save', async () => {
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

    it('warns when the stashed work includes a .gitignore edit', async () => {
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

    it('warns for a renamed-away .gitignore and a C-quoted path', async () => {
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

    it('warns for a C-quoted nested .gitignore path', async () => {
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

    it('warns without promising the CLI cannot touch the unmasked files', async () => {
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
      // An earlier text said the files "will be left untouched", which is false of the CLI.
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

    it('refuses, before the push, the paths that git stash cannot put back', async () => {
      const calls: string[] = [];
      const ws = loadWorkspace({
        'git rev-parse HEAD': { stdout: 'abc1234deadbeef\n' },
        // An index-only delete, a rename whose source is back, and a plain modify.
        'git status -z --porcelain': { stdout: 'D  d.txt\0R  b.txt\0a.txt\0 M c.txt\0' },
        'git status --porcelain': { stdout: 'D  d.txt\n' },
      }, {
        lstat: sinon.stub().callsFake(async (p: string) => {
          if (p.endsWith('/d.txt') || p.endsWith('/a.txt')) return { isDirectory: () => false, isSymbolicLink: () => false, isFile: () => true };
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
      const lines = (thrown as { lines: string[] }).lines;
      expect(lines.filter(l => l.startsWith('  - '))).to.have.length(2);
      expect(lines.join('\n')).to.include(`restore --staged -- ':(literal)d.txt'`);
      expect(lines.join('\n')).to.include('"a.txt" is the source of a staged rename');
      expect(calls.some(c => c.startsWith('git stash push'))).to.equal(false);
    });

    it('reads an intent-to-add rename (" R") as two real paths', async () => {
      const ws = loadWorkspace({
        'git rev-parse HEAD': { stdout: 'abc1234deadbeef\n' },
        // The push left an intent-to-add rename: the Y column holds the R.
        'git status --porcelain=v1 -z --untracked-files=no': { stdout: ' R new.txt\0old.txt\0' },
        'git status --porcelain': { stdout: ' R old.txt -> new.txt\n' },
        'git stash push': { stdout: 'Saved\n' },
        'git stash list -z': STASH_CREATED,
        'git stash drop': { stdout: `Dropped stash@{0} (${OUR_SHA})\n` },
      });
      let thrown: unknown;
      try {
        await ws.snapshotChtCore('/tmp/cht-core');
      } catch (err) {
        thrown = err;
      }
      const listed = (thrown as { lines: string[] }).lines.filter(l => l.startsWith('  - '));
      expect(listed).to.deep.equal(['  - "new.txt"', '  - "old.txt"']);
    });

    describe('what sits where a tracked path was', () => {
      /** lstat answers by path; every path not named is gone. */
      const lstatBy = (entries: Record<string, 'file' | 'dir' | 'symlink' | 'fifo'>) => sinon.stub().callsFake(async (p: string) => {
        const type = entries[p];
        if (!type) throw errno('ENOENT');
        return {
          isFile: () => type === 'file',
          isDirectory: () => type === 'dir',
          isSymbolicLink: () => type === 'symlink',
          isFIFO: () => type === 'fifo',
        };
      });

      /** A snapshot of this status; its rejection (if any) and the git calls. */
      const snapshotWith = async (statusZ: string, lstat: sinon.SinonStub, untracked = '') => {
        const calls: string[] = [];
        const ws = loadWorkspace({
          'git rev-parse HEAD': { stdout: 'abc1234deadbeef\n' },
          'git status -z --porcelain': { stdout: statusZ },
          'git status --porcelain=v1': { stdout: '' },
          'git status --porcelain': { stdout: ' D x\n' },
          'git stash push': { stdout: 'Saved\n' },
          'git stash list -z': STASH_CREATED,
          'git ls-files --others --exclude-standard -z': [{ stdout: untracked }, { stdout: '' }],
        }, { lstat }, calls);
        let thrown: { kind?: string; lines?: string[] } | undefined;
        const snap = await ws.snapshotChtCore('/tmp/cht-core').catch((err: { kind?: string; lines?: string[] }) => {
          thrown = err;
          return undefined;
        });
        return { snap, thrown, text: (thrown?.lines ?? []).join('\n'), calls };
      };

      it('refuses an ignored file where a tracked directory was', async () => {
        const { thrown, text, calls } = await snapshotWith(' D d/b.txt\0', lstatBy({ '/tmp/cht-core/d': 'file' }));
        expect(thrown?.kind).to.equal('precondition');
        expect(text).to.include('"d" is an ignored file where the tracked directory of "d/b.txt" was');
        expect(text).to.include('Move "d" away.');
        expect(calls.some(c => c.startsWith('git stash push'))).to.equal(false);
      });

      it('does not refuse an untracked file where a tracked directory was', async () => {
        // The push saves the untracked `d`, and its reset puts the tracked dir back.
        const types: Array<'file' | 'dir'> = ['file', 'dir'];
        const lstat = sinon.stub().callsFake(async (p: string) => {
          if (p !== '/tmp/cht-core/d') throw errno('ENOENT');
          const type = types.shift() ?? 'dir';
          return { isFile: () => type === 'file', isDirectory: () => type === 'dir', isSymbolicLink: () => false };
        });
        const { thrown, calls } = await snapshotWith(' D d/b.txt\0', lstat, 'd\0');
        expect(thrown?.kind).to.not.equal('precondition');
        expect(calls.some(c => c.startsWith('git stash push'))).to.equal(true);
      });

      it('does not refuse a staged file where a tracked directory was', async () => {
        const { thrown, calls } = await snapshotWith('A  d\0D  d/b.txt\0', lstatBy({ '/tmp/cht-core/d': 'file' }));
        expect(thrown?.kind).to.not.equal('precondition');
        expect(calls.some(c => c.startsWith('git stash push'))).to.equal(true);
      });

      it('names the type of a special file where a tracked directory was', async () => {
        const { thrown, text } = await snapshotWith(' D d/b.txt\0', lstatBy({ '/tmp/cht-core/d': 'fifo' }));
        expect(thrown?.kind).to.equal('precondition');
        expect(text).to.include('"d", a directory above "d/b.txt", is now a FIFO, and git stash cannot save a FIFO. Move it away.');
      });

      it('refuses when a directory above a deleted path cannot be checked', async () => {
        const lstat = sinon.stub().callsFake(async (p: string) => {
          throw errno(p === '/tmp/cht-core/d' ? 'EACCES' : 'ENOENT');
        });
        const { thrown, calls } = await snapshotWith(' D d/b.txt\0', lstat);
        expect(thrown?.kind).to.equal('precondition');
        expect(thrown?.lines).to.deep.equal([
          'cht-agent cannot check "d" (EACCES), so it cannot tell what git stash would do there; nothing was changed.',
        ]);
        expect(calls.some(c => c.startsWith('git stash push'))).to.equal(false);
      });

      it('names the symbolic link above a worktree delete, with no index-delete text', async () => {
        // lstat of `p/n.txt` follows the link `p` to a real file.
        const lstat = lstatBy({ '/tmp/cht-core/p': 'symlink', '/tmp/cht-core/p/n.txt': 'file' });
        const { thrown, text } = await snapshotWith(' D p/n.txt\0', lstat);
        expect(thrown?.kind).to.equal('precondition');
        expect(text).to.include('"p", a directory above "p/n.txt", is now a symbolic link');
        expect(text).to.include('Move "p" away.');
        expect(text).to.not.include('deleted in the index');
      });

      it('refuses a staged add whose file is deleted, and prints a restore, not an unstage', async () => {
        const { thrown, text, calls } = await snapshotWith('AD n.txt\0', lstatBy({}));
        expect(thrown?.kind).to.equal('precondition');
        expect(text).to.include('"n.txt" is staged but deleted from the working tree');
        expect(text).to.include("put the file back with: git -C '/tmp/cht-core' restore -- ':(literal)n.txt'");
        expect(text).to.not.include('--staged');
        expect(calls.some(c => c.startsWith('git stash push'))).to.equal(false);
      });

      it('refuses the target of a staged rename or copy whose file is deleted', async () => {
        const { thrown } = await snapshotWith('RD b.txt\0a.txt\0CD c.txt\0a.txt\0', lstatBy({}));
        expect(thrown?.kind).to.equal('precondition');
        const listed = (thrown?.lines ?? []).filter(l => l.startsWith('  - '));
        expect(listed).to.have.length(2);
        expect(listed[0]).to.include('"b.txt" is staged but deleted from the working tree');
        expect(listed[1]).to.include('"c.txt" is staged but deleted from the working tree');
      });

      it('prints no restore command when something is in the way of the staged file', async () => {
        const lstat = lstatBy({ '/tmp/cht-core/p': 'file', '/tmp/cht-core/m.txt': 'dir' });
        const { thrown, text } = await snapshotWith('AD p/n.txt\0AD m.txt\0', lstat);
        expect(thrown?.kind).to.equal('precondition');
        expect(text).to.include('the file "p" is where its directory was, so git stash cannot put it back. Move "p" away.');
        expect(text).to.include('a directory is at its path now, so git stash cannot put it back. Move that directory away.');
        expect(text).to.not.include('restore');
      });

      it('does not refuse a staged modify whose file is deleted (MD round-trips)', async () => {
        const { thrown, calls } = await snapshotWith('MD m.txt\0', lstatBy({}));
        expect(thrown?.kind).to.not.equal('precondition');
        expect(calls.some(c => c.startsWith('git stash push'))).to.equal(true);
      });

      it('says "directory" for a rename source that is now a directory', async () => {
        const { thrown, text } = await snapshotWith('R  b.txt\0a.txt\0', lstatBy({ '/tmp/cht-core/a.txt': 'dir' }));
        expect(thrown?.kind).to.equal('precondition');
        expect(text).to.include(
          '"a.txt" is the source of a staged rename, and a directory at that path is on disk again. ' +
            'Commit the rename, or move that directory away.',
        );
      });
    });

    it('does not count a pre-push untracked file as left behind when its path is now a directory', async () => {
      const calls: string[] = [];
      const ws = loadWorkspace({
        'git rev-parse HEAD': { stdout: 'abc1234deadbeef\n' },
        'git status --porcelain=v1': { stdout: '' },
        'git status --porcelain': { stdout: ' D d/b.txt\n?? d\n' },
        'git stash push': { stdout: 'Saved\n' },
        'git stash list -z': STASH_CREATED,
        // Before the push `d` is an untracked file; the push's reset puts the tracked dir `d/` back.
        'git ls-files --others --exclude-standard -z': [{ stdout: 'd\0' }, { stdout: '' }],
      }, {
        lstat: sinon.stub().callsFake(async (p: string) => {
          if (p === '/tmp/cht-core/d') return { isDirectory: () => true };
          throw errno('ENOENT');
        }),
      }, calls);
      let thrown: unknown;
      const snap = await ws.snapshotChtCore('/tmp/cht-core').catch((err: unknown) => {
        thrown = err;
        return undefined;
      });
      expect(thrown).to.be.undefined;
      expect(snap?.stashSha).to.equal(OUR_SHA);
      expect(calls.some(c => c.startsWith('git restore'))).to.equal(false);
    });

    describe('the choices at a failed stash push', () => {
      const TRAILER = 'Choose Retry after you fix the cause above, "I handled it myself" after you dealt with it ' +
        'another way, or Abort to stop the run.';
      const indexLock = () => Object.assign(new Error('Command failed: git stash push\nfatal: index.lock exists'), {
        code: 128, stderr: "fatal: Unable to create '/tmp/cht-core/.git/index.lock': File exists.",
      });
      const readFailure = () => Object.assign(new Error('Command failed: git x\nfatal: injected read failure'), {
        code: 128, stderr: 'fatal: injected read failure',
      });
      const OTHER_LEFTOVER = `${STASH_MARKER_PREFIX}1600000000000`;
      const OURS_AND_OTHER = stashListZ(
        ['stash@{0}', OUR_SHA, `On main: ${OUR_NAME}`], ['stash@{1}', OTHER_SHA, `On main: ${OTHER_LEFTOVER}`],
      );
      const BASE: Script = {
        'git rev-parse HEAD': { stdout: 'abc1234deadbeef\n' },
        'git status --porcelain=v1': { stdout: '' },
        'git status --porcelain': { stdout: ' M x.ts\n' },
        'git stash push': { stdout: 'Saved\n' },
        'git stash drop': { stdout: `Dropped stash@{0} (${OUR_SHA})\n` },
      };
      /** A push that saves nothing once (an index.lock), then works. */
      const FP1_ONCE: Script = {
        'git stash push': [{ error: indexLock() }, { stdout: 'Saved\n' }],
        // The leftover check and the lookup (nothing), then both again (ours).
        'git stash list -z': [{ stdout: '' }, { stdout: '' }, { stdout: '' }, { stdout: OUR_ENTRY }],
      };

      /** A resolver that answers in order (then Abort) and marks each call in `calls`. */
      const scriptedResolver = (answers: string[], calls: string[] = []) => {
        const seen: Array<{ step: string; lines: readonly string[]; choices: readonly string[] }> = [];
        const resolve = sinon.stub().callsFake(async (failure: { step: string; lines: readonly string[]; choices: readonly string[] }) => {
          seen.push(failure);
          calls.push('RESOLVER');
          return answers.shift() ?? 'abort';
        });
        return { resolve, seen };
      };

      /** Run the snapshot; console output is captured, and the outcome is the snapshot or the error. */
      const snapshotWith = async (script: Script, options: Record<string, unknown>, calls: string[] = []) => {
        const ws = loadWorkspace(withDefaults(script, BASE), {}, calls);
        const errorSpy = sinon.stub(console, 'error');
        const warnSpy = sinon.stub(console, 'warn');
        const logSpy = sinon.stub(console, 'log');
        const outcome = await ws.snapshotChtCore('/tmp/cht-core', options).then(
          (snapshot: { stashSha: string | null; prePushUntracked?: string[] }) => ({ snapshot, error: undefined }),
          (error: { kind?: string; lines?: string[]; message?: string }) => ({ snapshot: undefined, error }),
        );
        // Only these: the describe's Date.now stub must stay for a second snapshot.
        for (const spy of [errorSpy, warnSpy, logSpy]) spy.restore();
        return {
          ws,
          outcome,
          printed: errorSpy.getCalls().map(c => String(c.args[0])),
          warned: warnSpy.getCalls().map(c => String(c.args[0])),
        };
      };

      it('runs the snapshot again after Retry at a push that saved nothing', async () => {
        const calls: string[] = [];
        const { resolve, seen } = scriptedResolver(['retry'], calls);
        const { outcome, printed } = await snapshotWith(FP1_ONCE, { resolveStashFailure: resolve }, calls);
        expect(resolve.calledOnce).to.equal(true);
        expect(seen[0].step).to.equal('push');
        expect(seen[0].choices).to.deep.equal(['handled', 'retry', 'abort']);
        expect(seen[0].lines[0]).to.include('nothing was stashed and your tree is unchanged');
        expect(outcome.snapshot?.stashSha).to.equal(OUR_SHA);
        expect(calls.filter(c => c.startsWith('git stash push'))).to.have.length(2);
        expect(printed.at(-1)).to.equal(`[claude-code-cli] ${TRAILER}`);
      });

      it('throws the push error on Abort, marked, with the headless lines printed once and the trailer', async () => {
        const script: Script = { 'git stash push': { error: indexLock() }, 'git stash list -z': { stdout: '' } };
        const headless = await snapshotWith(script, {});
        const { resolve } = scriptedResolver(['abort']);
        const { ws, outcome, printed } = await snapshotWith(script, { resolveStashFailure: resolve });
        expect(resolve.calledOnce).to.equal(true);
        const err = outcome.error as { kind?: string; lines?: string[] };
        expect(err.kind).to.equal('stash');
        expect(err.lines).to.deep.equal(headless.outcome.error?.lines);
        expect(ws.isOperatorAbort(err)).to.equal(true);
        expect(ws.isOperatorAbort(headless.outcome.error)).to.equal(false);
        expect(printed).to.deep.equal([
          ...(err.lines ?? []).map(l => `[claude-code-cli] ${l}`),
          `[claude-code-cli] ${TRAILER}`,
        ]);
        const errorSpy = sinon.stub(console, 'error');
        ws.reportSafetyError(err, '[claude-code-cli]');
        expect(errorSpy.called).to.equal(false);
      });

      it('puts the work back before it asks at a partial push, then runs the snapshot again on "handled"', async () => {
        const calls: string[] = [];
        const { resolve } = scriptedResolver(['handled'], calls);
        const { outcome } = await snapshotWith({
          'git status --porcelain=v1 -z --untracked-files=no': [{ stdout: ' M x.ts\0' }, { stdout: '' }],
          [`git diff --name-only --no-renames -z ${OUR_SHA} --`]: [{ stdout: 'x.ts\0' }, { stdout: '' }],
          // The leftover check, the lookup, the undo's drop; then the re-run's leftover check and lookup.
          'git stash list -z': [
            { stdout: '' }, { stdout: OUR_ENTRY }, { stdout: OUR_ENTRY }, { stdout: '' }, { stdout: OUR_ENTRY },
          ],
        }, { resolveStashFailure: resolve }, calls);
        expect(resolve.calledOnce).to.equal(true);
        const restoreAt = calls.findIndex(c => c.startsWith(`git restore --source=${OUR_SHA} --worktree`));
        expect(restoreAt).to.be.greaterThan(-1);
        expect(restoreAt).to.be.lessThan(calls.indexOf('RESOLVER'));
        expect(calls.filter(c => c.startsWith('git stash push'))).to.have.length(2);
        expect(outcome.snapshot?.stashSha).to.equal(OUR_SHA);
      });

      for (const [label, postPushRead] of [
        ['a partial push', { stdout: ' M x.ts\0' }],
        ['a failed read after the push', { error: readFailure() }],
      ] as Array<[string, Answer]>) {
        it(`skips our spare copy on the re-run after ${label}, tells the caller, and still refuses another leftover`, async () => {
          const spares: string[] = [];
          const { resolve } = scriptedResolver(['retry']);
          const { outcome } = await snapshotWith({
            'git status --porcelain=v1 -z --untracked-files=no': postPushRead,
            'git stash drop': { error: new Error('fatal: cannot lock ref') },
            // The leftover check, the lookup, the undo's drop; then the re-run's leftover check.
            'git stash list -z': [{ stdout: '' }, { stdout: OUR_ENTRY }, { stdout: OUR_ENTRY }, { stdout: OURS_AND_OTHER }],
          }, { resolveStashFailure: resolve, onSpareStash: (sha: string) => spares.push(sha) });
          expect(resolve.calledOnce).to.equal(true);
          expect(spares).to.deep.equal([OUR_SHA]);
          expect(outcome.error?.kind).to.equal('precondition');
          const text = (outcome.error?.lines ?? []).join('\n');
          expect(text).to.include('has 1 leftover cht-agent stash(es)');
          expect(text).to.include(OTHER_LEFTOVER);
          expect(text).to.not.include(OUR_NAME);
        });
      }

      it('runs the snapshot again after Retry at a failed read after the push', async () => {
        const { resolve, seen } = scriptedResolver(['retry']);
        const { outcome } = await snapshotWith({
          'git status --porcelain=v1 -z --untracked-files=no': [{ error: readFailure() }, { stdout: '' }],
          'git stash list -z': [
            { stdout: '' }, { stdout: OUR_ENTRY }, { stdout: OUR_ENTRY }, { stdout: '' }, { stdout: OUR_ENTRY },
          ],
        }, { resolveStashFailure: resolve });
        expect(resolve.calledOnce).to.equal(true);
        expect(seen[0].lines).to.deep.equal([
          'The snapshot failed after the stash (fatal: injected read failure); cht-agent put your work back, so ' +
            'nothing was changed.',
        ]);
        expect(outcome.snapshot?.stashSha).to.equal(OUR_SHA);
      });

      it('throws the precondition error marked on Abort at a failed read after the push', async () => {
        const { resolve } = scriptedResolver(['abort']);
        const { ws, outcome } = await snapshotWith({
          'git status --porcelain=v1 -z --untracked-files=no': { error: readFailure() },
          'git stash list -z': [{ stdout: '' }, { stdout: OUR_ENTRY }, { stdout: OUR_ENTRY }],
        }, { resolveStashFailure: resolve });
        expect(resolve.calledOnce).to.equal(true);
        expect(outcome.error?.kind).to.equal('precondition');
        expect(ws.isOperatorAbort(outcome.error)).to.equal(true);
      });

      for (const [label, resolve] of [
        ['rejects', () => sinon.stub().rejects(new Error('the terminal went away'))],
        ["answers 'x'", () => sinon.stub().resolves('x')],
      ] as Array<[string, () => sinon.SinonStub]>) {
        it(`gives the push error, marked, when the resolver ${label}`, async () => {
          const stub = resolve();
          const script: Script = { 'git stash push': { error: indexLock() }, 'git stash list -z': { stdout: '' } };
          const { ws, outcome } = await snapshotWith(script, { resolveStashFailure: stub });
          expect(stub.calledOnce).to.equal(true);
          expect(outcome.error).to.be.instanceOf(ws.WorkspaceSafetyError);
          expect(outcome.error?.kind).to.equal('stash');
          expect(ws.isOperatorAbort(outcome.error)).to.equal(true);
        });
      }

      it('prints nothing and asks nothing at a failed push without a resolver', async () => {
        const script: Script = { 'git stash push': { error: indexLock() }, 'git stash list -z': { stdout: '' } };
        const { outcome, printed } = await snapshotWith(script, {});
        expect(outcome.error?.kind).to.equal('stash');
        expect(printed).to.deep.equal([]);
      });

      it('lets a later snapshot of the run skip the spare copy that an earlier one proved', async () => {
        const accepted: string[] = [];
        const { resolve } = scriptedResolver(['retry']);
        const first = await snapshotWith({
          // The longer key first: the first key that the argv starts with answers.
          'git status --porcelain=v1 -z --untracked-files=no': { stdout: ' M x.ts\0' },
          'git status --porcelain': [{ stdout: ' M x.ts\n' }, { stdout: '' }],
          'git stash drop': { error: new Error('fatal: cannot lock ref') },
          // The leftover check, the lookup, the undo's drop; then the re-run's check sees only our spare.
          'git stash list -z': [{ stdout: '' }, { stdout: OUR_ENTRY }, { stdout: OUR_ENTRY }, { stdout: OUR_ENTRY }],
        }, { resolveStashFailure: resolve, acceptedLeftoverShas: accepted, onSpareStash: (sha: string) => accepted.push(sha) });
        expect(resolve.calledOnce).to.equal(true);
        expect(first.outcome.snapshot?.stashSha).to.equal(null);
        const second = await snapshotWith({
          'git status --porcelain': { stdout: '' },
          'git stash list -z': { stdout: OUR_ENTRY },
        }, { acceptedLeftoverShas: accepted });
        expect(second.outcome.error).to.be.undefined;
        expect(second.outcome.snapshot?.stashSha).to.equal(null);
      });

      it('gives the pre-push listing on the snapshot only when it took a stash', async () => {
        const clean = await snapshotWith({ 'git status --porcelain': { stdout: '' } }, {});
        expect(clean.outcome.snapshot).to.not.have.property('prePushUntracked');
        const dirty = await snapshotWith({
          'git stash list -z': STASH_CREATED,
          // A nested repo: the push never takes it, so the post-push check does not look at it on disk.
          'git ls-files --others --exclude-standard -z': [{ stdout: 'nr/\0' }, { stdout: '' }],
        }, {});
        expect(dirty.outcome.snapshot?.prePushUntracked).to.deep.equal(['nr/']);
      });

      describe('at a failed undo or an unreadable list', () => {
        const RESTORE_TRAILER = 'Choose "I handled it myself" after you ran the steps above, or Abort to stop the run. ' +
          'The steps above still apply after Abort.';
        const CACHED = `git diff --cached --name-only --no-renames --ignore-submodules=all -z ${OUR_SHA}^2`;
        /** A partial push whose undo leaves `a.txt` differing in the index; `recheck` answers the check after "handled". */
        const failedUndo = (recheck: string, list: Answer[], rest: Script = {}): Script => ({
          ...rest,
          'git status --porcelain=v1 -z --untracked-files=no': [{ stdout: ' M x.ts\0' }, { stdout: '' }],
          [CACHED]: [{ stdout: 'a.txt\0' }, { stdout: recheck }],
          'git stash list -z': list,
        });
        const listFailure = () => Object.assign(new Error('Command failed: git stash list\nfatal: bad index'), {
          code: 128, stderr: 'fatal: bad index',
        });

        it('drops our entry and runs the snapshot again when "handled" finds the work back and the entry listed', async () => {
          const calls: string[] = [];
          const { resolve, seen } = scriptedResolver(['handled'], calls);
          const { outcome, printed } = await snapshotWith(failedUndo('', [
            // The check and lookup; the recheck (listed); the drop; then the re-run's check and lookup.
            { stdout: '' }, { stdout: OUR_ENTRY }, { stdout: OUR_ENTRY }, { stdout: OUR_ENTRY }, { stdout: '' }, { stdout: OUR_ENTRY },
          ]), { resolveStashFailure: resolve }, calls);
          expect(resolve.calledOnce).to.equal(true);
          expect(seen[0].step).to.equal('undo');
          expect(seen[0].choices).to.deep.equal(['handled', 'abort']);
          expect(printed.at(-1)).to.equal(`[claude-code-cli] ${RESTORE_TRAILER}`);
          expect(calls.filter(c => c === 'git stash drop stash@{0}')).to.have.length(1);
          expect(outcome.snapshot?.stashSha).to.equal(OUR_SHA);
        });

        it('shows a fresh screen with the paths that still differ, then throws that one on Abort', async () => {
          const { resolve, seen } = scriptedResolver(['handled', 'abort']);
          const { ws, outcome, printed } = await snapshotWith(failedUndo('b.txt\0', [
            { stdout: '' }, { stdout: OUR_ENTRY }, { stdout: OUR_ENTRY },
          ]), { resolveStashFailure: resolve });
          expect(resolve.calledTwice).to.equal(true);
          expect(seen[1].lines).to.include('  - "b.txt"');
          expect(seen[1].lines).to.not.include('  - "a.txt"');
          expect(outcome.error?.lines).to.deep.equal(seen[1].lines);
          expect(ws.isOperatorAbort(outcome.error)).to.equal(true);
          expect(printed.filter(l => l === '[claude-code-cli]   - "b.txt"')).to.have.length(1);
        });

        it('runs the snapshot again, with no drop, when "handled" finds the work back and the entry gone', async () => {
          const calls: string[] = [];
          const { resolve } = scriptedResolver(['handled'], calls);
          const { outcome } = await snapshotWith(failedUndo('', [
            { stdout: '' }, { stdout: OUR_ENTRY }, { stdout: '' }, { stdout: '' }, { stdout: OUR_ENTRY },
          ]), { resolveStashFailure: resolve }, calls);
          expect(resolve.calledOnce).to.equal(true);
          expect(calls.some(c => c.startsWith('git stash drop'))).to.equal(false);
          expect(outcome.snapshot?.stashSha).to.equal(OUR_SHA);
        });

        it('warns with the commit of our entry, and runs the snapshot again, when the entry is gone and the tree differs', async () => {
          const { resolve } = scriptedResolver(['handled']);
          const { outcome, warned } = await snapshotWith(failedUndo('a.txt\0', [
            { stdout: '' }, { stdout: OUR_ENTRY }, { stdout: '' }, { stdout: '' }, { stdout: OUR_ENTRY },
          ]), { resolveStashFailure: resolve });
          expect(resolve.calledOnce).to.equal(true);
          expect(warned).to.include(
            `[claude-code-cli] Stash ${OUR_NAME} is no longer in the stash list, and these paths do not match it: "a.txt". ` +
              `Its commit is ${OUR_SHA}. If you still need it: git -C '/tmp/cht-core' stash apply --index ${OUR_SHA}`,
          );
          expect(outcome.snapshot?.stashSha).to.equal(OUR_SHA);
        });

        it('prints no reset step when HEAD moved while the screen waited', async () => {
          const { resolve, seen } = scriptedResolver(['handled', 'abort']);
          const { outcome } = await snapshotWith(failedUndo('b.txt\0', [
            { stdout: '' }, { stdout: OUR_ENTRY }, { stdout: OUR_ENTRY },
          ], { 'git rev-parse HEAD': [{ stdout: 'abc1234deadbeef\n' }, { stdout: 'fedcba9876543210\n' }] }),
          { resolveStashFailure: resolve });
          expect(resolve.calledTwice).to.equal(true);
          expect(seen[0].lines.some(l => l.includes('reset --hard'))).to.equal(true);
          expect(seen[1].lines[0]).to.equal(
            'HEAD is at fedcba9876543210 on a detached HEAD now, not abc1234deadbeef on a detached HEAD, so ' +
              'cht-agent did not put your work back over it.',
          );
          expect(seen[1].lines.some(l => l.includes('reset --hard'))).to.equal(false);
          expect(seen[1].lines.some(l => l.startsWith('Restore it: '))).to.equal(true);
          expect(outcome.error?.lines).to.deep.equal(seen[1].lines);
        });

        it('undoes from our entry, then runs the snapshot again, when "handled" finds it after an unreadable list', async () => {
          const calls: string[] = [];
          const { resolve, seen } = scriptedResolver(['handled'], calls);
          const { outcome } = await snapshotWith({
            // The check; the lookup and its re-read fail; the handled read finds ours; the drop; the re-run.
            'git stash list -z': [
              { stdout: '' }, { error: listFailure() }, { error: listFailure() }, { stdout: OUR_ENTRY },
              { stdout: OUR_ENTRY }, { stdout: '' }, { stdout: OUR_ENTRY },
            ],
          }, { resolveStashFailure: resolve }, calls);
          expect(resolve.calledOnce).to.equal(true);
          expect(seen[0].step).to.equal('push');
          expect(seen[0].choices).to.deep.equal(['handled', 'abort']);
          expect(calls.filter(c => c === 'git stash drop stash@{0}')).to.have.length(1);
          expect(outcome.snapshot?.stashSha).to.equal(OUR_SHA);
        });

        it('runs the snapshot again when "handled" does not find our entry after an unreadable list', async () => {
          const calls: string[] = [];
          const { resolve } = scriptedResolver(['handled'], calls);
          const { outcome } = await snapshotWith({
            'git stash list -z': [
              { stdout: '' }, { error: listFailure() }, { error: listFailure() }, { stdout: '' }, { stdout: '' }, { stdout: OUR_ENTRY },
            ],
          }, { resolveStashFailure: resolve }, calls);
          expect(resolve.calledOnce).to.equal(true);
          expect(calls.some(c => c.startsWith('git stash drop'))).to.equal(false);
          expect(outcome.snapshot?.stashSha).to.equal(OUR_SHA);
        });
      });
    });

    describe('assume-unchanged entries', () => {
      const snapshotWithFlags = async (lsFilesV: string) => {
        const calls: string[] = [];
        const ws = loadWorkspace({
          'git rev-parse HEAD': { stdout: 'abc1234deadbeef\n' },
          'git status --porcelain': { stdout: '' },
          'git ls-files -v -z': { stdout: lsFilesV },
        }, {}, calls);
        let thrown: { kind?: string; lines?: string[] } | undefined;
        const snap = await ws.snapshotChtCore('/tmp/cht-core').catch((err: { kind?: string; lines?: string[] }) => {
          thrown = err;
          return undefined;
        });
        return { snap, thrown, calls };
      };

      it('refuses an assume-unchanged entry, even on a tree that looks clean, and names the way out', async () => {
        const { thrown, calls } = await snapshotWithFlags('H a.txt\0h cfg\0');
        expect(thrown?.kind).to.equal('precondition');
        expect(thrown?.lines).to.deep.equal([
          'git stash cannot save edits to files marked assume-unchanged, so cht-agent did not stash anything. ' +
            'Nothing was changed.',
          `  - "cfg" is marked assume-unchanged. Clear the flag with: git -C '/tmp/cht-core' update-index ` +
            "--no-assume-unchanged -- 'cfg'",
          'Then run again.',
        ]);
        expect(calls.some(c => c.startsWith('git stash push'))).to.equal(false);
      });

      it('does not refuse an entry that is not assume-unchanged', async () => {
        const { snap, thrown } = await snapshotWithFlags('H cfg\0S local.cfg\0');
        expect(thrown).to.be.undefined;
        expect(snap?.stashSha).to.be.null;
      });
    });

    it('refuses a leftover stash and unmerged paths as precondition', async () => {
      const leftover = loadWorkspace({
        'git stash list -z': { stdout: OUR_ENTRY },
        'git rev-parse HEAD': { stdout: 'abc1234deadbeef\n' },
        'git status --porcelain': { stdout: '' },
      });
      const unmerged = loadWorkspace({
        'git rev-parse HEAD': { stdout: 'abc1234deadbeef\n' },
        'git status --porcelain': { stdout: 'UU conflict.ts\n' },
      });
      const leftoverError = await leftover.snapshotChtCore('/tmp/cht-core').catch((err: unknown) => err);
      const unmergedError = await unmerged.snapshotChtCore('/tmp/cht-core').catch((err: unknown) => err);
      expect(leftoverError).to.be.instanceOf(leftover.WorkspaceSafetyError);
      expect((leftoverError as { kind: string }).kind).to.equal('precondition');
      expect(unmergedError).to.be.instanceOf(unmerged.WorkspaceSafetyError);
      expect((unmergedError as { kind: string }).kind).to.equal('precondition');
      expect((unmergedError as { lines: string[] }).lines).to.deep.equal([(unmergedError as Error).message]);
    });

    it('refuses as precondition when a read before the push fails, and never stashes', async () => {
      const calls: string[] = [];
      const failure = Object.assign(new Error('Command failed: git ls-files\nfatal: injected'), {
        code: 128, stderr: 'fatal: injected',
      });
      const ws = loadWorkspace({
        'git rev-parse HEAD': { stdout: 'abc1234deadbeef\n' },
        'git status --porcelain': { stdout: ' M x.ts\n' },
        'git ls-files --others --exclude-standard -z': { error: failure },
      }, {}, calls);
      const err = await ws.snapshotChtCore('/tmp/cht-core').catch((e: unknown) => e) as {
        kind?: string; message: string; cause?: unknown; lines?: string[];
      };
      expect(err.kind).to.equal('precondition');
      expect(err.message).to.equal('cht-agent could not read the untracked files (fatal: injected); nothing was changed.');
      expect(err.lines).to.deep.equal([err.message]);
      expect(err.cause).to.equal(failure);
      expect(calls.some(c => c.startsWith('git stash push'))).to.equal(false);
    });

    it('refuses as precondition when the ignored listing fails on a clean tree', async () => {
      const failure = Object.assign(new Error('Command failed: git ls-files\nfatal: injected'), {
        code: 128, stderr: 'fatal: injected',
      });
      const ws = loadWorkspace({
        'git rev-parse HEAD': { stdout: 'abc1234deadbeef\n' },
        'git status --porcelain': { stdout: '' },
        'git ls-files --others --ignored': { error: failure },
      });
      const err = await ws.snapshotChtCore('/tmp/cht-core').catch((e: unknown) => e) as {
        kind?: string; message: string; cause?: unknown;
      };
      expect(err.kind).to.equal('precondition');
      expect(err.message).to.equal(
        'cht-agent could not read the untracked and ignored files (fatal: injected); nothing was changed.',
      );
      expect(err.cause).to.equal(failure);
    });

    it('names cht-agent, not claude-code-cli, in the unmerged, subdirectory and in-progress refusals', async () => {
      const unmerged = loadWorkspace({
        'git rev-parse HEAD': { stdout: 'abc1234deadbeef\n' },
        'git status --porcelain': { stdout: 'UU conflict.ts\n' },
      });
      const subdirectory = loadWorkspace({ 'git rev-parse --show-prefix': { stdout: 'sub/\n' } });
      const inProgress = loadWorkspace(
        { 'git rev-parse --path-format=absolute': { stdout: '/tmp/cht-core/.git/MERGE_HEAD\n' } },
        { lstat: sinon.stub().resolves({}) },
      );
      const messages: string[] = [];
      for (const ws of [unmerged, subdirectory, inProgress]) {
        messages.push(((await ws.snapshotChtCore('/tmp/cht-core').catch((err: unknown) => err)) as Error).message);
      }
      expect(messages).to.have.length(3);
      for (const message of messages) expect(message).to.include('refuse to run cht-agent.');
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

    it('excludes baseline untracked files and keeps CLI-created ones', async () => {
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

    it('stays in phase on a rename entry, which carries two paths', async () => {
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

    it('a non-array baseline throws instead of misattributing operator files', async () => {
      // Symmetry with the clean path's guard. Without it, `new Set(undefined)` is
      // empty, so every pre-existing untracked file is reported as a session
      // CREATE and offered for approval into cht-core (silent misattribution).
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
      expect((thrown as Error).message).to.include('HEAD moved from abc1234 to fedcba9 during the session (a commit or a checkout)');
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

    it('names a nested repository entry instead of skipping it silently', async () => {
      const ws = loadWorkspace({
        'git rev-parse HEAD': { stdout: 'abc1234\n' },
        'git diff --name-status -z abc1234': { stdout: '' },
        'git ls-files --others --exclude-standard': { stdout: 'nr/\0src/a.ts\0' },
      }, regularFiles());
      const warnSpy = sinon.spy(console, 'warn');
      let files;
      try {
        files = await ws.captureChtCoreDiff('/tmp/cht-core', 'abc1234', []);
      } finally {
        warnSpy.restore();
      }
      expect(files.map((f: { path: string }) => f.path)).to.deep.equal(['src/a.ts']);
      expect(warnSpy.getCalls().map(c => String(c.args[0]))).to.include('[claude-code-cli] Not captured: nr/ (nested repository).');
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

    it('puts back an entry that an operator pushed right before our drop, then drops ours', async () => {
      const calls: string[] = [];
      const { snapshot, script } = rollbackFixture(WITH_STASH, {
        'git stash list -z': [
          { stdout: OUR_ENTRY }, // pre-check
          { stdout: OUR_ENTRY }, // first drop lookup: ours is stash@{0}
          // An operator push lands before the drop, so `drop stash@{0}` takes the
          // operator's NEW entry, which the lookup never saw. After the put-back:
          { stdout: stashListZ(['stash@{0}', OTHER_SHA, 'On main: operator new stash'], ['stash@{1}', OUR_SHA, `On main: ${OUR_NAME}`]) },
        ],
        'git stash drop stash@{0}': { stdout: `Dropped stash@{0} (${OTHER_SHA})\n` },
        'git stash drop stash@{1}': { stdout: `Dropped stash@{1} (${OUR_SHA})\n` },
        [`git log -1 --format=%s ${OTHER_SHA}`]: { stdout: 'On main: operator new stash\n' },
      });
      const ws = loadWorkspace(script, {}, calls);

      const result = await ws.rollbackChtCore('/tmp/cht-core', snapshot);

      expect(calls).to.include(`git stash store -m On main: operator new stash ${OTHER_SHA}`);
      expect(calls).to.include('git stash drop stash@{1}');
      expect(result.stashPop).to.equal('ok');
    });

    it('puts back a dropped entry that the pre-drop list held under its list message, not its commit subject', async () => {
      const calls: string[] = [];
      const listed = stashListZ(
        ['stash@{0}', OUR_SHA, `On main: ${OUR_NAME}`],
        ['stash@{1}', OTHER_SHA, 'custom message from stash store -m'],
      );
      const { snapshot, script } = rollbackFixture(WITH_STASH, {
        // The pre-check, then every drop lookup: the list holds the other entry too.
        'git stash list -z': [{ stdout: OUR_ENTRY }, { stdout: listed }],
        'git stash drop stash@{0}': [
          { stdout: `Dropped stash@{0} (${OTHER_SHA})\n` },
          { stdout: `Dropped stash@{0} (${OUR_SHA})\n` },
        ],
        [`git log -1 --format=%s ${OTHER_SHA}`]: { stdout: 'On main: the commit subject differs\n' },
      });
      const ws = loadWorkspace(script, {}, calls);

      await ws.rollbackChtCore('/tmp/cht-core', snapshot);

      expect(calls).to.include(`git stash store -m custom message from stash store -m ${OTHER_SHA}`);
      expect(calls.filter(c => c.includes('the commit subject differs'))).to.deep.equal([]);
    });

    it('names the entry, with a store command and no drop command, when the put-back fails', async () => {
      const { snapshot, script } = rollbackFixture(WITH_STASH, {
        'git stash list -z': [{ stdout: OUR_ENTRY }, { stdout: OUR_ENTRY }, { stdout: '' }],
        'git stash drop stash@{0}': { stdout: `Dropped stash@{0} (${OTHER_SHA})\n` },
        [`git log -1 --format=%s ${OTHER_SHA}`]: { stdout: 'On main: operator new stash\n' },
        'git stash store': { error: new Error('fatal: cannot lock ref') },
      });
      const ws = loadWorkspace(script);
      const errorSpy = sinon.stub(console, 'error');
      sinon.stub(console, 'warn');
      try {
        await ws.rollbackChtCore('/tmp/cht-core', snapshot);
      } finally {
        sinon.restore();
      }
      const printed = errorSpy.getCalls().map(c => String(c.args[0])).join('\n');
      expect(printed).to.include(`${OTHER_SHA}, "On main: operator new stash"`);
      expect(printed).to.include(`stash store -m 'On main: operator new stash' ${OTHER_SHA}`);
      expect(printed).to.not.include('stash drop');
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

    it('cleans ONLY session-created paths, sparing the baseline', async () => {
      const calls: string[] = [];
      const { snapshot, script } = rollbackFixture({ baselineUntracked: ['.aider.chat'] }, {
        'git ls-files --others --exclude-standard': { stdout: '.aider.chat\0src/cli-made.ts\0' },
      });
      const ws = loadWorkspace(script, { lstat: sinon.stub().rejects(errno('ENOENT')) }, calls);

      const result = await ws.rollbackChtCore('/tmp/cht-core', snapshot);

      expect(result.clean).to.equal('ok');
      const cleanCall = calls.find(c => c.startsWith('git clean'));
      // :(literal) so a metachar in a session filename cannot fnmatch-delete an
      // operator file.
      expect(cleanCall).to.equal('git clean -fd -- :(literal)src/cli-made.ts');
      expect(cleanCall).to.not.include('.aider.chat'); // operator's file spared
    });

    it('skips the clean entirely when the delta is empty (no blanket clean)', async () => {
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

      it('refuses a subdirectory of the snapshot repo', async () => {
        const calls: string[] = [];
        const { snapshot, script } = rollbackFixture({}, {
          'git rev-parse --show-prefix': { stdout: 'sub/\n' },
        });
        const ws = loadWorkspace(script, {}, calls);
        let thrown: unknown;
        try {
          await ws.rollbackChtCore('/tmp/cht-core/sub', snapshot);
        } catch (err) {
          thrown = err;
        }
        expect((thrown as { kind: string }).kind).to.equal('drift');
        expect((thrown as { lines: string[] }).lines[0]).to.equal(
          'Rollback must run at the top level of /tmp/cht-core, not at /tmp/cht-core/sub (the subdirectory sub/); nothing was changed.',
        );
        for (const destructive of ['git reset', 'git clean', 'git stash apply']) {
          expect(calls.some(c => c.startsWith(destructive)), destructive).to.equal(false);
        }
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
        await expectDrift(ws, snapshot, calls, 'The checkout changed from refs/heads/main to refs/heads/twin (at the same commit)');
      });

      describe('the reason each drift gives', () => {
        const driftLines = async (overrides: Partial<typeof SNAPSHOT>, script: Script) => {
          const fixture = rollbackFixture(overrides, script);
          const ws = loadWorkspace(fixture.script);
          try {
            await ws.rollbackChtCore('/tmp/cht-core', fixture.snapshot);
          } catch (err) {
            return (err as { lines: string[] }).lines.join('\n');
          }
          throw new Error('expected a drift');
        };

        it('a commit on the branch: HEAD moved, and a reset could orphan commits', async () => {
          const lines = await driftLines({}, { 'git rev-parse HEAD': { stdout: 'fedcba9\n' } });
          expect(lines).to.include('HEAD moved from abc1234 to fedcba9 on refs/heads/main');
          expect(lines).to.include('can orphan commits made since');
        });

        it('a branch switch at the same commit: no claim about orphaned commits', async () => {
          const lines = await driftLines({}, { 'git symbolic-ref -q HEAD': { stdout: 'refs/heads/twin\n' } });
          expect(lines).to.include('(at the same commit)');
          expect(lines).to.include('which is not the checkout that it snapshotted');
          expect(lines).to.not.include('orphan');
        });

        it('a detach: names the detached HEAD', async () => {
          const lines = await driftLines({}, {
            'git symbolic-ref -q HEAD': { error: Object.assign(new Error('not a symbolic ref'), { code: 1 }) },
          });
          expect(lines).to.include('The checkout changed from refs/heads/main to a detached HEAD (at the same commit)');
        });

        it('prints the review line only when a list is not empty', async () => {
          const empty = await driftLines({}, { 'git rev-parse HEAD': { stdout: 'fedcba9\n' } });
          expect(empty).to.not.include('Review these files');
          const listed = await driftLines({}, {
            'git rev-parse HEAD': { stdout: 'fedcba9\n' },
            'git diff --name-only -z HEAD': { stdout: 'op-commit.ts\0' },
          });
          expect(listed).to.include('Review these files yourself');
        });
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

      /** The rollback's drift lines after a failed first read, called at `chtCorePath`. */
      const precheckFailureLines = async (overrides: Partial<typeof SNAPSHOT>, chtCorePath: string) => {
        const { snapshot, script } = rollbackFixture(overrides, {
          'git rev-parse --show-toplevel': { error: new Error('fatal: not a git repository') },
        });
        const ws = loadWorkspace(script);
        let thrown: { kind?: string; lines?: string[] } | undefined;
        await ws.rollbackChtCore(chtCorePath, snapshot).catch((err: { kind?: string; lines?: string[] }) => {
          thrown = err;
        });
        expect(thrown?.kind).to.equal('drift');
        return thrown?.lines ?? [];
      };

      it('says where the work is after a failed pre-check read, with the hint for the snapshot repo', async () => {
        const lines = await precheckFailureLines(WITH_STASH, '/tmp/elsewhere');
        const text = lines.join('\n');
        expect(text).to.include(
          `cht-agent did not restore stash ${OUR_NAME}. Unless you restored it yourself, your uncommitted work is in it.`,
        );
        expect(text).to.include("Find the stash: git -C '/tmp/cht-core' stash list");
        expect(text).to.include("Restore it: ref=$(git -C '/tmp/cht-core' stash list");
        expect(text).to.not.include('/tmp/elsewhere');
        expect(text).to.not.include('is still in stash');
      });

      it('prints only the read failure after a failed pre-check read when no stash was taken', async () => {
        const lines = await precheckFailureLines({}, '/tmp/cht-core');
        expect(lines).to.deep.equal([
          'cht-agent could not read the repo state before rollback (fatal: not a git repository); nothing was changed.',
        ]);
      });
    });

    describe('the choices at a failed restore or drop', () => {
      const RESTORE_TRAILER = 'Choose "I handled it myself" after you ran the steps above, or Abort to stop the run. ' +
        'The steps above still apply after Abort.';
      const OURS = stashListZ(['stash@{0}', OUR_SHA, `On main: ${OUR_NAME}`]);
      const TRACKED = `git diff --name-only --no-renames --ignore-submodules=all -z ${OUR_SHA} --`;
      const applyFailure = () => Object.assign(new Error('Command failed: git stash apply'), {
        stderr: 'error: Your local changes to the following files would be overwritten by merge:\n\tf.txt',
      });
      type Failure = { step: string; lines: readonly string[]; choices: readonly string[] };

      /** A resolver that answers in order (then Abort). */
      const answering = (answers: string[]) => {
        const seen: Failure[] = [];
        const resolve = sinon.stub().callsFake(async (failure: Failure) => {
          seen.push(failure);
          return answers.shift() ?? 'abort';
        });
        return { resolve, seen };
      };

      /** A snapshot that took our stash; by default with the pre-push listing that the screen needs. */
      const restoreFixture = (script: Script, extra: Record<string, unknown> = { prePushUntracked: [] }) => {
        const fixture = rollbackFixture(WITH_STASH, script);
        return { snapshot: { ...fixture.snapshot, ...extra }, script: fixture.script };
      };

      /** The rollback, then settleRollback as cli calls it; console output is captured. */
      const rollbackWith = async (
        script: Script,
        snapshot: typeof SNAPSHOT,
        options: Record<string, unknown>,
        fsStubs: Record<string, unknown> = {},
      ) => {
        const calls: string[] = [];
        const ws = loadWorkspace(script, fsStubs, calls);
        const spies = { error: sinon.stub(console, 'error'), warn: sinon.stub(console, 'warn'), log: sinon.stub(console, 'log') };
        const result = await ws.rollbackChtCore('/tmp/cht-core', snapshot, options);
        let halt: { kind?: string; lines?: string[] } | undefined;
        try {
          ws.settleRollback(result, { logPrefix: '[claude-code-cli]', label: 'claude-code-cli', chtCorePath: '/tmp/cht-core', snapshot });
        } catch (err) {
          halt = err as { kind?: string; lines?: string[] };
        }
        const lines = (spy: sinon.SinonStub) => spy.getCalls().map(c => String(c.args[0]));
        const out = { printed: lines(spies.error), warned: lines(spies.warn), logged: lines(spies.log) };
        for (const spy of Object.values(spies)) spy.restore();
        return { ws, result, halt, calls, ...out };
      };

      it('drops our entry and says so when "handled" finds the work back with the entry listed', async () => {
        const { resolve, seen } = answering(['handled']);
        const { snapshot, script } = restoreFixture({ 'git stash apply': { error: applyFailure() } });
        const { result, halt, calls, printed, logged } = await rollbackWith(script, snapshot, { resolveStashFailure: resolve });
        expect(resolve.calledOnce).to.equal(true);
        expect(seen[0].step).to.equal('restore');
        expect(seen[0].choices).to.deep.equal(['handled', 'abort']);
        expect(seen[0].lines[0]).to.include('Rollback could not restore your work');
        expect(printed).to.include(`[claude-code-cli] ${RESTORE_TRAILER}`);
        expect(result.stashPop).to.equal('ok');
        expect(result.errors).to.deep.equal([]);
        expect(result).to.not.have.any.keys('popResidue', 'popBlockers', 'unwritableDirs', 'unreadableFiles');
        expect(calls).to.include('git stash drop stash@{0}');
        expect(logged).to.include(`[claude-code-cli] Your work is restored from stash ${OUR_NAME}.`);
        expect(halt).to.be.undefined;
      });

      it('says the restore is done, with no drop, when "handled" finds the work back and the entry gone', async () => {
        const { resolve } = answering(['handled']);
        const { snapshot, script } = restoreFixture({
          'git stash apply': { error: applyFailure() },
          // The pre-check, then the check after "handled".
          'git stash list -z': [{ stdout: OURS }, { stdout: '' }],
        });
        const { result, halt, calls } = await rollbackWith(script, snapshot, { resolveStashFailure: resolve });
        expect(resolve.calledOnce).to.equal(true);
        expect(result.stashPop).to.equal('ok');
        expect(calls.some(c => c.startsWith('git stash drop'))).to.equal(false);
        expect(halt).to.be.undefined;
      });

      it('shows the screen again with the paths that differ, then keeps that error for the halt on Abort', async () => {
        const { resolve, seen } = answering(['handled', 'abort']);
        const { snapshot, script } = restoreFixture({ 'git stash apply': { error: applyFailure() }, [TRACKED]: { stdout: 'a.txt\0' } });
        const { ws, result, halt, printed } = await rollbackWith(script, snapshot, { resolveStashFailure: resolve });
        expect(resolve.calledTwice).to.equal(true);
        expect(printed).to.include(`[claude-code-cli] The working tree does not match stash ${OUR_NAME} yet. These paths differ:`);
        expect(printed).to.include('[claude-code-cli]   - "a.txt"');
        expect(result.stashPop).to.equal('failed');
        expect(halt?.kind).to.equal('stash');
        // The screen showed the reason lines first, then the checklist that Abort keeps.
        expect(seen[1].lines.slice(0, 2)).to.deep.equal([
          `The working tree does not match stash ${OUR_NAME} yet. These paths differ:`, '  - "a.txt"',
        ]);
        expect(halt?.lines).to.deep.equal(seen[1].lines.slice(2));
        expect(ws.isOperatorAbort(halt)).to.equal(true);
        // After the last screen, settleRollback prints only its heading and the errors.
        const afterScreen = printed.slice(printed.lastIndexOf(`[claude-code-cli] ${RESTORE_TRAILER}`) + 1);
        expect(afterScreen[0]).to.equal('[claude-code-cli] ROLLBACK INCOMPLETE; cht-core may be in an unexpected state:');
        expect(afterScreen.slice(1).every(l => l.startsWith('[claude-code-cli]   - '))).to.equal(true);
      });

      it('warns with the commit of our entry, and says the restore is done, when the entry is gone and the tree differs', async () => {
        const { resolve } = answering(['handled']);
        const { snapshot, script } = restoreFixture({
          'git stash apply': { error: applyFailure() },
          [TRACKED]: { stdout: 'a.txt\0' },
          'git stash list -z': [{ stdout: OURS }, { stdout: '' }],
        });
        const { result, warned } = await rollbackWith(script, snapshot, { resolveStashFailure: resolve });
        expect(resolve.calledOnce).to.equal(true);
        expect(warned).to.include(
          `[claude-code-cli] Stash ${OUR_NAME} is no longer in the stash list, and these paths do not match it: "a.txt". ` +
            `Its commit is ${OUR_SHA}. If you still need it: git -C '/tmp/cht-core' stash apply --index ${OUR_SHA}`,
        );
        expect(result.stashPop).to.equal('ok');
      });

      it('prints the checklist once and keeps it as the halt, marked, on Abort', async () => {
        const { resolve } = answering(['abort']);
        const { snapshot, script } = restoreFixture({ 'git stash apply': { error: applyFailure() } });
        const { ws, result, halt, printed } = await rollbackWith(script, snapshot, { resolveStashFailure: resolve });
        expect(resolve.calledOnce).to.equal(true);
        expect(halt?.lines).to.deep.equal(ws.buildRecoveryChecklist('/tmp/cht-core', snapshot, result));
        expect(ws.isOperatorAbort(halt)).to.equal(true);
        expect(printed.filter(l => l.includes('Rollback could not restore your work'))).to.have.length(1);
      });

      it('prints no reset step when HEAD moved while the restore screen waited', async () => {
        const { resolve, seen } = answering(['handled', 'abort']);
        const { snapshot, script } = restoreFixture({
          'git stash apply': { error: applyFailure() },
          [TRACKED]: { stdout: 'a.txt\0' },
          'git rev-parse HEAD': [{ stdout: 'abc1234\n' }, { stdout: 'fedcba9876543210\n' }],
        });
        const { halt } = await rollbackWith(script, snapshot, { resolveStashFailure: resolve });
        expect(resolve.calledTwice).to.equal(true);
        expect(seen[0].lines.some(l => l.includes('reset --hard'))).to.equal(true);
        expect(seen[1].lines[0]).to.equal(
          'HEAD is at fedcba9876543210 on refs/heads/main now, not abc1234 on refs/heads/main, so cht-agent did not ' +
            'put your work back over it.',
        );
        expect(seen[1].lines.some(l => l.includes('reset --hard'))).to.equal(false);
        expect(halt?.lines).to.deep.equal(seen[1].lines);
      });

      it('lists only the stash files on disk as residue when the screen shows again, not a new operator file', async () => {
        const { resolve, seen } = answering(['handled', 'abort']);
        const { snapshot, script } = restoreFixture({
          'git stash apply': { error: applyFailure() },
          // The clean's delta, the failed restore's residue, then the tree after the operator added a file.
          'git ls-files --others --exclude-standard': [{ stdout: '' }, { stdout: 'u.txt\0' }, { stdout: 'u.txt\0new-op.txt\0' }],
          [`git ls-tree -r -z --name-only ${OUR_SHA}^3`]: { stdout: 'u.txt\0' },
          [`git ls-tree -r -z ${OUR_SHA}^3`]: { stdout: '' },
        });
        const { result, halt } = await rollbackWith(script, snapshot, { resolveStashFailure: resolve }, { lstat: sinon.stub().resolves({}) });
        expect(resolve.calledTwice).to.equal(true);
        expect(seen).to.have.length(2);
        expect(result.popResidue).to.deep.equal(['u.txt']);
        // The checklist of the second screen, which Abort keeps: the reason above it names every differing path.
        expect(halt?.lines).to.include('  - "u.txt"');
        expect(halt?.lines).to.not.include('  - "new-op.txt"');
      });

      it('never asks at a failed restore when the snapshot has no pre-push listing', async () => {
        const { resolve } = answering(['handled']);
        const { snapshot, script } = restoreFixture({ 'git stash apply': { error: applyFailure() } }, {});
        const { result, halt } = await rollbackWith(script, snapshot, { resolveStashFailure: resolve });
        expect(resolve.called).to.equal(false);
        expect(result.stashPop).to.equal('failed');
        expect(halt?.kind).to.equal('stash');
      });

      it('never asks after a failed reset', async () => {
        const { resolve } = answering(['handled']);
        const { snapshot, script } = restoreFixture({
          'git reset --hard': { error: new Error('reset blew up') },
          'git diff --quiet abc1234': { error: new Error('tree still differs') },
        });
        const { result, halt } = await rollbackWith(script, snapshot, { resolveStashFailure: resolve });
        expect(resolve.called).to.equal(false);
        expect(result.reset).to.equal('failed');
        expect(halt?.kind).to.equal('reset');
      });

      it('lets a session file that the clean could not remove pass the check, and keeps the clean failure', async () => {
        const { resolve } = answering(['handled']);
        const { snapshot, script } = restoreFixture({
          'git stash apply': { error: applyFailure() },
          'git ls-files --others --exclude-standard': { stdout: 'keep.txt\0' },
        });
        const { result, halt } = await rollbackWith(script, snapshot, { resolveStashFailure: resolve }, { lstat: sinon.stub().resolves({}) });
        expect(resolve.calledOnce).to.equal(true);
        expect(result.stashPop).to.equal('ok');
        expect(result.clean).to.equal('failed');
        expect(result.survivors).to.deep.equal(['keep.txt']);
        expect(result.errors).to.have.length(1);
        expect(result.errors[0]).to.match(/^clean: /);
        expect(halt).to.be.undefined;
      });

      it('still stops the check at a session file that differs at a path the stash holds', async () => {
        const { resolve, seen } = answering(['handled', 'abort']);
        const { snapshot, script } = restoreFixture({
          'git stash apply': { error: applyFailure() },
          'git ls-files --others --exclude-standard': { stdout: 'keep.txt\0' },
          [`git ls-tree -r -z ${OUR_SHA}^3`]: { stdout: '100644 blob 1234567890abcdef\tkeep.txt\0' },
          'git hash-object --no-filters -- keep.txt': { stdout: 'fedcba0987654321\n' },
        });
        const { result, printed } = await rollbackWith(script, snapshot, { resolveStashFailure: resolve }, {
          lstat: sinon.stub().resolves({ isFile: () => true, isSymbolicLink: () => false }),
        });
        expect(resolve.calledTwice).to.equal(true);
        expect(seen[1].step).to.equal('restore');
        const reason = printed.indexOf(`[claude-code-cli] The working tree does not match stash ${OUR_NAME} yet. These paths differ:`);
        expect(reason).to.be.greaterThan(-1);
        expect(printed[reason + 1]).to.equal('[claude-code-cli]   - "keep.txt"');
        expect(result.stashPop).to.equal('failed');
      });

      it('asks at a spare entry after a good restore, and goes on when "handled" finds it gone', async () => {
        const spares: string[] = [];
        const { resolve, seen } = answering(['handled']);
        const { snapshot, script } = restoreFixture({
          'git stash drop': { error: Object.assign(new Error('Command failed'), { stderr: 'fatal: cannot lock ref' }) },
          // The pre-check, the drop's own read, then the read after "handled".
          'git stash list -z': [{ stdout: OURS }, { stdout: OURS }, { stdout: '' }],
        });
        const { result, halt, warned } = await rollbackWith(script, snapshot, {
          resolveStashFailure: resolve, onSpareStash: (sha: string) => spares.push(sha),
        });
        expect(resolve.calledOnce).to.equal(true);
        expect(seen[0].step).to.equal('drop');
        expect(seen[0].lines).to.deep.equal([
          `Your work is restored; the stash entry ${OUR_NAME} is a spare copy.`,
          'cht-agent could not remove it from the stash list: fatal: cannot lock ref',
        ]);
        expect(spares).to.deep.equal([OUR_SHA]);
        expect(result.stashPop).to.equal('ok');
        expect(halt).to.be.undefined;
        expect(warned.filter(l => l.includes('spare copy'))).to.deep.equal([]);
      });

      it('keeps a marked stash error with the spare lines for the halt on Abort at a spare entry', async () => {
        const { resolve, seen } = answering(['abort']);
        const { snapshot, script } = restoreFixture({ 'git stash drop': { error: new Error('fatal: cannot lock ref') } });
        const { ws, halt } = await rollbackWith(script, snapshot, { resolveStashFailure: resolve });
        expect(resolve.calledOnce).to.equal(true);
        expect(halt?.kind).to.equal('stash');
        expect(halt?.lines).to.deep.equal(seen[0].lines);
        expect(ws.isOperatorAbort(halt)).to.equal(true);
      });

      it('tells the caller about a spare entry without a resolver, and keeps the warning', async () => {
        const spares: string[] = [];
        const { snapshot, script } = restoreFixture({ 'git stash drop': { error: new Error('fatal: cannot lock ref') } });
        const { halt, warned } = await rollbackWith(script, snapshot, { onSpareStash: (sha: string) => spares.push(sha) });
        expect(spares).to.deep.equal([OUR_SHA]);
        expect(warned).to.include(`[claude-code-cli] Your work is restored; the stash entry ${OUR_NAME} is a spare copy.`);
        expect(halt).to.be.undefined;
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

    it('says only what the permission checks found', () => {
      const ws = loadWorkspace({});
      const failedReset = (errors: string[], found: { unwritableDirs?: string[]; unreadableFiles?: string[] } = {}) =>
        ws.buildRecoveryChecklist('/tmp/cht-core', SNAPSHOT, {
          reset: 'failed', clean: 'skipped', stashPop: 'skipped', errors, ...found,
        }).join('\n');

      const neutral = failedReset(["reset: error: unable to unlink old 'x': Permission denied"]);
      expect(neutral).to.include("git hit a permission error (Permission denied, see git's message above)");
      expect(neutral).to.not.match(/cannot write|could not write/);

      const named = failedReset(['reset: Permission denied'], { unwritableDirs: ['rt'], unreadableFiles: ['k.pem'] });
      expect(named).to.include('git cannot write inside "rt"; git cannot read "k.pem" (Permission denied)');

      const lock = failedReset(["reset: fatal: Unable to create '/tmp/cht-core/.git/index.lock': File exists."]);
      expect(lock).to.include('Remove that file only if no git process runs, then run the steps below.');

      const other = failedReset(['reset: fatal: something else']);
      expect(other).to.include('Find out why git failed (see its message above) and fix the cause');
    });

    it('lists the clean survivors under their own heading, apart from what the restore wrote', () => {
      const ws = loadWorkspace({});
      const text = ws.buildRecoveryChecklist('/tmp/cht-core', { ...SNAPSHOT, ...WITH_STASH }, {
        reset: 'ok', clean: 'failed', stashPop: 'failed',
        errors: ['clean: these session files are still on disk: "nr/", "s.ts"', 'stash apply: error: conflicts in index'],
        survivors: ['nr/', 's.ts'], popResidue: ['op-untracked.txt'],
      }).join('\n');
      const residueAt = text.indexOf('Untracked files the failed restore wrote (the stash also holds them):');
      const survivorsAt = text.indexOf('Session files the clean could not remove:');
      expect(residueAt).to.be.greaterThan(-1);
      expect(survivorsAt).to.be.greaterThan(residueAt);
      expect(text.slice(residueAt, survivorsAt)).to.not.include('"nr/"');
      expect(text.slice(survivorsAt)).to.include('"nr/"');
      expect(text).to.include(`clean -fd -- ':(literal)op-untracked.txt' ':(literal)s.ts'`);
      expect(text).to.include('Remove these directories by hand (git clean cannot remove a nested repository): "nr/"');
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

  describe('verify-then-throw pattern', () => {
    // Stub Date.now so the stash-name is deterministic across the test run.
    beforeEach(() => {
      sinon.stub(Date, 'now').returns(NOW);
    });

    afterEach(() => {
      sinon.restore();
    });

    it('stash push exits non-zero but stash was created → no throw', async () => {
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

    it('stash push exits non-zero AND no stash was created → re-throws', async () => {
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
      // The trigger (the push's own error) and the restore error each on their own line.
      expect(lines).to.include("git stash did not complete (error: unable to unlink old 'rt/t.txt': Permission denied).");
      expect(lines).to.include('\nThe restore from the stash failed part way: error: unable to unlink old rt/t.txt\n');
      // The restore threw, so the work is NOT back, and git's error is never a path entry.
      expect(lines).to.not.include('The rest of your work is already back');
      expect(lines).to.not.match(/ {2}- "\(/);
      expect(lines.indexOf('reset --hard abc1234')).to.be.lessThan(lines.indexOf('stash pop --index'));
      expect(calls.some(c => c.startsWith('git stash drop'))).to.equal(false);
    });

    describe('the undo of a partial push', () => {
      /** A push that leaves `x.ts` changed, so the snapshot undoes it; the test's keys come first. */
      const partialPush = async (script: Script, fsStubs: Record<string, unknown> = {}) => {
        const calls: string[] = [];
        const ws = loadWorkspace(withDefaults(script, {
          'git rev-parse HEAD': { stdout: 'abc1234\n' },
          'git status --porcelain=v1 -z --untracked-files=no': { stdout: ' M x.ts\0' },
          'git status --porcelain': { stdout: ' M x.ts\n' },
          'git stash push': { stdout: 'Saved\n' },
          'git stash list -z': STASH_CREATED,
          'git stash drop': { stdout: `Dropped stash@{0} (${OUR_SHA})\n` },
        }), fsStubs, calls);
        const warnSpy = sinon.stub(console, 'warn');
        let err: { kind?: string; lines?: string[] } | undefined;
        try {
          await ws.snapshotChtCore('/tmp/cht-core');
        } catch (e) {
          err = e as { kind?: string; lines?: string[] };
        }
        const warned = warnSpy.getCalls().map(c => String(c.args[0]));
        warnSpy.restore();
        return { calls, err, text: (err?.lines ?? []).join('\n'), warned };
      };

      it('restores the index from the stash index commit', async () => {
        const { calls } = await partialPush({
          [`git diff --cached --name-only --no-renames -z ${OUR_SHA}^2`]: { stdout: 'a.txt\0' },
        });
        expect(calls).to.include(`git restore --source=${OUR_SHA}^2 --staged -- :(literal)a.txt`);
      });

      it('keeps the stash when the index does not match after the undo', async () => {
        const { calls, err, text } = await partialPush({
          [`git diff --cached --name-only --no-renames --ignore-submodules=all -z ${OUR_SHA}^2`]: { stdout: 'a.txt\0' },
        });
        expect(err?.kind).to.equal('stash');
        expect(text).to.include('  - "a.txt"');
        expect(calls.some(c => c.startsWith('git stash drop'))).to.equal(false);
      });

      it('keeps the stash when an untracked file differs from its stored blob', async () => {
        const { calls, err, text } = await partialPush({
          [`git ls-tree -r -z ${OUR_SHA}^3`]: { stdout: '100644 blob 1234567890abcdef\tu.txt\0' },
          'git hash-object --no-filters -- u.txt': { stdout: 'fedcba0987654321\n' },
        }, { lstat: sinon.stub().resolves({ isFile: () => true, isSymbolicLink: () => false }) });
        expect(err?.kind).to.equal('stash');
        expect(text).to.include('  - "u.txt"');
        expect(calls.some(c => c.startsWith('git stash drop'))).to.equal(false);
      });

      it('keeps the stash when an untracked symlink points elsewhere than its stored target', async () => {
        const { calls, err, text } = await partialPush({
          [`git ls-tree -r -z ${OUR_SHA}^3`]: { stdout: '120000 blob 1234567890abcdef\tlnk\0' },
          'git cat-file blob 1234567890abcdef': { stdout: 'tracked.txt' },
        }, {
          lstat: sinon.stub().resolves({ isFile: () => false, isSymbolicLink: () => true }),
          readlink: sinon.stub().resolves('somewhere-else.txt'),
        });
        expect(err?.kind).to.equal('stash');
        expect(text).to.include('  - "lnk"');
        expect(calls.some(c => c.startsWith('git stash drop'))).to.equal(false);
      });

      it('puts the removal of the stashed untracked files between the reset and the lookup', async () => {
        const { text } = await partialPush({
          [`git diff --cached --name-only --no-renames --ignore-submodules=all -z ${OUR_SHA}^2`]: { stdout: 'a.txt\0' },
          [`git ls-tree -r -z --name-only ${OUR_SHA}^3`]: { stdout: 'u.txt\0' },
        }, { lstat: sinon.stub().resolves({}) });
        const resetAt = text.indexOf('reset --hard abc1234');
        const cleanAt = text.indexOf("clean -fd -- ':(literal)u.txt'");
        expect(resetAt).to.be.greaterThan(-1);
        expect(cleanAt).to.be.greaterThan(resetAt);
        expect(cleanAt).to.be.lessThan(text.indexOf('Find the stash: '));
      });

      it('notes a spare copy when the undo worked but our entry cannot be dropped', async () => {
        const { err, warned } = await partialPush({
          'git stash drop': { error: new Error('fatal: cannot lock ref') },
        });
        expect(err?.kind).to.equal('stash');
        expect(warned).to.include(`[claude-code-cli] Your work is restored; the stash entry ${OUR_NAME} is a spare copy.`);
      });

      it('names the pre-push files to move, and prints no clean step, when the stash cannot be read', async () => {
        const readFailure = Object.assign(new Error('Command failed: git rev-parse\nfatal: bad object'), {
          code: 128, stderr: 'fatal: bad object',
        });
        const { err, text } = await partialPush({
          'git ls-files --others --exclude-standard -z': { stdout: 'u.txt\0' },
          'git rev-parse -q --verify': { error: readFailure },
        }, { lstat: sinon.stub().resolves({ isDirectory: () => false, isFile: () => true, isSymbolicLink: () => false }) });
        expect(err?.kind).to.equal('stash');
        expect(text).to.not.include('clean -fd');
        expect(text).to.include(`Move these files out of the way before 'Restore it', and do not delete them: "u.txt".`);
        expect(text).to.include(`cht-agent could not read the untracked files in stash ${OUR_NAME}: fatal: bad object`);
      });

      it('prints no step and no read error when the stash has no untracked files (exit 1)', async () => {
        const { err, text } = await partialPush({
          [`git diff --cached --name-only --no-renames --ignore-submodules=all -z ${OUR_SHA}^2`]: { stdout: 'a.txt\0' },
          'git rev-parse -q --verify': { error: Object.assign(new Error('exit 1'), { code: 1 }) },
        });
        expect(err?.kind).to.equal('stash');
        expect(text).to.include('could not fully put your work back');
        expect(text).to.not.include('clean -fd');
        expect(text).to.not.include('Move these files');
        expect(text).to.not.include('could not read the untracked files');
      });

      /** The stash deletes `d/b.txt`; lstat of it fails with `code`, and every other path is gone. */
      const deletedPathLstat = (code: string) => ({
        lstat: sinon.stub().callsFake(async (p: string) => {
          throw errno(p === '/tmp/cht-core/d/b.txt' ? code : 'ENOENT');
        }),
      });
      const STASH_DELETES_D_B = {
        [`git diff --name-only --no-renames --diff-filter=D -z ${OUR_SHA}^1 ${OUR_SHA}`]: { stdout: 'd/b.txt\0' },
      };

      it('counts a deleted path as absent when a dir above it is now a file (ENOTDIR)', async () => {
        const { calls, text } = await partialPush(STASH_DELETES_D_B, deletedPathLstat('ENOTDIR'));
        expect(calls).to.include('git stash drop stash@{0}');
        expect(text).to.not.include('could not fully put your work back');
      });

      it('still counts a deleted path as on disk after any other lstat error', async () => {
        const { calls, text } = await partialPush(STASH_DELETES_D_B, deletedPathLstat('EACCES'));
        expect(text).to.include('could not fully put your work back');
        expect(text).to.include('  - "d/b.txt"');
        expect(calls.some(c => c.startsWith('git stash drop'))).to.equal(false);
      });
    });

    describe('a git read that fails after the push', () => {
      const readError = () => Object.assign(new Error('Command failed: git x\nfatal: injected read failure'), {
        code: 128, stderr: 'fatal: injected read failure',
      });

      const snapshotRejection = async (script: Script, calls: string[]) => {
        // The test's keys come first, so a more specific key wins over these.
        const ws = loadWorkspace(withDefaults(script, {
          'git rev-parse HEAD': { stdout: 'abc1234\n' },
          'git status --porcelain': { stdout: ' M file.ts\n' },
          'git stash push': { stdout: 'Saved\n' },
          'git stash drop': { stdout: `Dropped stash@{0} (${OUR_SHA})\n` },
        }), {}, calls);
        try {
          await ws.snapshotChtCore('/tmp/cht-core');
        } catch (err) {
          return { err: err as { kind?: string; cause?: unknown; lines?: string[]; message: string }, ws };
        }
        throw new Error('expected the snapshot to reject');
      };

      it('puts the work back and stops when the post-push stash list read fails', async () => {
        const calls: string[] = [];
        const failure = readError();
        const { err, ws } = await snapshotRejection({
          'git status --porcelain=v1': { stdout: '' },
          // The leftover check, then the failed post-push read, then the re-read.
          'git stash list -z': [{ stdout: '' }, { error: failure }, { stdout: OUR_ENTRY }],
        }, calls);
        expect(err).to.be.instanceOf(ws.WorkspaceSafetyError);
        expect(err.kind).to.equal('precondition');
        expect(err.cause).to.equal(failure);
        expect(err.message).to.include('put your work back, so nothing was changed');
        expect(calls).to.include('git stash drop stash@{0}');
      });

      it('puts the work back and stops when the post-push status read fails', async () => {
        const calls: string[] = [];
        const failure = readError();
        const { err } = await snapshotRejection({
          'git status --porcelain=v1 -z --untracked-files=no': { error: failure },
          'git stash list -z': STASH_CREATED,
        }, calls);
        expect(err.kind).to.equal('precondition');
        expect(err.cause).to.equal(failure);
        expect(calls).to.include('git stash drop stash@{0}');
      });

      it('says a spare copy is left, not "nothing was changed", when the undo cannot drop our entry', async () => {
        const warnSpy = sinon.stub(console, 'warn');
        const { err } = await snapshotRejection({
          'git status --porcelain=v1 -z --untracked-files=no': { error: readError() },
          'git stash list -z': STASH_CREATED,
          'git stash drop': { error: new Error('fatal: cannot lock ref') },
        }, []);
        expect(err.kind).to.equal('stash');
        const text = (err.lines ?? []).join('\n');
        expect(text).to.not.include('nothing was changed');
        expect(err.message).to.include(`put your work back, but could not remove its stash entry ${OUR_NAME}`);
        expect(err.lines).to.include(`Your work is restored; the stash entry ${OUR_NAME} is a spare copy.`);
        expect(text).to.not.include('stash drop');
        expect(warnSpy.getCalls().filter(c => String(c.args[0]).includes('spare copy'))).to.deep.equal([]);
      });

      it("says that the next run's start check shows a spare entry", async () => {
        sinon.stub(console, 'warn');
        const { err } = await snapshotRejection({
          'git status --porcelain=v1 -z --untracked-files=no': { error: readError() },
          'git stash list -z': STASH_CREATED,
          'git stash drop': { error: new Error('fatal: cannot lock ref') },
        }, []);
        expect(err.lines?.at(-1)).to.equal(
          "The next run's start check shows that entry. Remove it from the stash list when you no longer need it.",
        );
      });

      it('keeps "nothing was changed" when our entry is gone before the undo drops it', async () => {
        const calls: string[] = [];
        const { err } = await snapshotRejection({
          'git status --porcelain=v1 -z --untracked-files=no': { error: readError() },
          // The leftover check, the post-push lookup, then the drop's own read: gone.
          'git stash list -z': [{ stdout: '' }, { stdout: OUR_ENTRY }, { stdout: '' }],
        }, calls);
        expect(err.kind).to.equal('precondition');
        expect(err.message).to.include('put your work back, so nothing was changed');
        expect(calls.some(c => c.startsWith('git stash drop'))).to.equal(false);
      });

      it('stops with the lookup hint when the stash list cannot be read at all', async () => {
        const calls: string[] = [];
        const failure = readError();
        const { err } = await snapshotRejection({
          'git stash list -z': [{ stdout: '' }, { error: failure }],
        }, calls);
        expect(err.kind).to.equal('stash');
        expect(err.cause).to.equal(failure);
        const lines = (err.lines ?? []).join('\n');
        expect(lines).to.include(`Your uncommitted work may be in stash ${OUR_NAME}`);
        expect(lines).to.include('Find the stash: ');
        expect(calls.some(c => c.startsWith('git stash drop'))).to.equal(false);
      });

      it('keeps "nothing was stashed" and adds the read error when the re-read finds no entry', async () => {
        const { err } = await snapshotRejection({
          'git status --porcelain=v1': { stdout: '' },
          'git stash list -z': [{ stdout: '' }, { error: readError() }, { stdout: '' }],
        }, []);
        expect(err.kind).to.equal('stash');
        const lines = (err.lines ?? []).join('\n');
        expect(lines).to.include('nothing was stashed and your tree is unchanged');
        expect(lines).to.include('A git read of the stash list failed too: fatal: injected read failure');
      });
    });

    it('reset --hard exits non-zero but the tree matches the snapshot → no warning', async () => {
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

    it('reset failure is reported when the tree does NOT match the snapshot', async () => {
      // Verify restoration, not HEAD identity: the pre-checks already proved that
      // HEAD is the snapshot's, so HEAD says nothing about a reset that failed.
      // Only a tree diff against the snapshot shows the edits that stayed.
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

    it('a baseline-less snapshot throws instead of blanket-cleaning', async () => {
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

    it('a failing chunk does not stop later chunks from being cleaned', async () => {
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

    it('a non-ENOENT stat error counts as NOT removed → clean failed', async () => {
      const { snapshot, script } = rollbackFixture({}, {
        'git ls-files --others --exclude-standard': { stdout: 'src/cli-made.ts\0' },
        'git clean -fd': { error: new Error('permission denied') },
      });
      const ws = loadWorkspace(script, {
        // An earlier check caught every error as "removed"; EACCES means the clean did NOT work.
        lstat: sinon.stub().rejects(errno('EACCES')),
      });

      const result = await ws.rollbackChtCore('/tmp/cht-core', snapshot);
      expect(result.clean).to.equal('failed');
    });

    it('clean exits non-zero but the delta paths are gone → no warning', async () => {
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

    it('clean does NOT report failure just because the tree is legitimately dirty', async () => {
      // The operator's own untracked files survive rollback by design, so the old
      // "status --porcelain is empty" verifier would have misreported a failure.
      const { snapshot, script } = rollbackFixture({ baselineUntracked: ['.aider.chat'] }, {
        'git ls-files --others --exclude-standard': { stdout: '.aider.chat\0src/cli-made.ts\0' },
        'git clean -fd': { error: new Error('warning: could not remove') },
      });
      const ws = loadWorkspace(script, {
        lstat: sinon.stub().rejects(errno('ENOENT')),
      });

      const result = await ws.rollbackChtCore('/tmp/cht-core', snapshot);
      expect(result.clean).to.equal('ok');
      expect(result.errors).to.deep.equal([]);
    });

    it('reports a clean as failed when git exits 0 but the path is still on disk, and names it', async () => {
      const { snapshot, script } = rollbackFixture({}, {
        'git ls-files --others --exclude-standard': { stdout: 'src/cli-made.ts\0nr/\0' },
        'git clean -fd': { stdout: '' }, // exit 0, removed nothing
      });
      const ws = loadWorkspace(script, {
        lstat: sinon.stub().resolves({}), // still there
      });

      const result = await ws.rollbackChtCore('/tmp/cht-core', snapshot);
      expect(result.clean).to.equal('failed');
      expect(result.survivors).to.deep.equal(['src/cli-made.ts', 'nr/']);
      expect(result.errors[0]).to.equal('clean: these session files are still on disk: "src/cli-made.ts", "nr/"');
      expect(ws.rollbackWarnings(result)).to.deep.equal([
        'Rollback could not remove these session files. Remove them before the next run, or the next run ' +
          'treats them as your files: "src/cli-made.ts", "nr/"',
      ]);
    });

    it('lists at most 20 surviving paths in the error line', async () => {
      const paths = Array.from({ length: 23 }, (_, i) => `s/f${i}.ts`);
      const { snapshot, script } = rollbackFixture({}, {
        'git ls-files --others --exclude-standard': { stdout: paths.join('\0') + '\0' },
      });
      const ws = loadWorkspace(script, { lstat: sinon.stub().resolves({}) });

      const result = await ws.rollbackChtCore('/tmp/cht-core', snapshot);
      expect(result.errors[0]).to.include('"s/f19.ts" and 3 more');
      expect(result.errors[0]).to.not.include('"s/f20.ts"');
      expect(result.survivors).to.have.length(23);
    });

    it('clean reports failure when a delta path still exists', async () => {
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

    it('keeps a clean survivor out of the files that a failed restore wrote', async () => {
      const { snapshot, script } = rollbackFixture(WITH_STASH, {
        // The clean sees the session's nested repo; after the failed restore, a restored file too.
        'git ls-files --others --exclude-standard': [{ stdout: 'nr/\0' }, { stdout: 'nr/\0op-untracked.txt\0' }],
        'git stash apply': { error: new Error('error: conflicts in index') },
      });
      const ws = loadWorkspace(script, { lstat: sinon.stub().resolves({}) });
      sinon.stub(console, 'warn');
      let result;
      try {
        result = await ws.rollbackChtCore('/tmp/cht-core', snapshot);
      } finally {
        sinon.restore();
      }
      expect(result.survivors).to.deep.equal(['nr/']);
      expect(result.popResidue).to.deep.equal(['op-untracked.txt']);
    });

    it('a failed restore keeps our entry and records what blocks a manual one', async () => {
      const calls: string[] = [];
      const { snapshot, script } = rollbackFixture(WITH_STASH, {
        'git stash apply': { error: Object.assign(new Error('Command failed'), {
          stderr: "error: unable to unlink old 'ro/f.txt': Permission denied\nIndex was not unstashed.\n",
        }) },
        // Nothing to clean before the restore; the failed restore then wrote ro/new.txt.
        'git ls-files --others --exclude-standard': [{ stdout: '' }, { stdout: 'ro/new.txt\0' }],
        'git diff --name-only --no-renames -z': { stdout: 'ro/f.txt\0' },
        'git rev-parse -q --verify': { error: Object.assign(new Error('no third parent'), { code: 1 }) },
      });
      const ws = loadWorkspace(script, {
        lstat: sinon.stub().resolves({}),
        access: sinon.stub().callsFake(async (p: string) => {
          if (p.endsWith('/ro')) throw errno('EACCES');
        }),
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

    it('returns typed RollbackResult with per-op outcomes', async () => {
      const { snapshot, script } = rollbackFixture(WITH_STASH);
      const ws = loadWorkspace(script);

      const result = await ws.rollbackChtCore('/tmp/cht-core', snapshot);
      expect(result.reset).to.equal('ok');
      expect(result.clean).to.equal('ok');
      expect(result.stashPop).to.equal('ok');
      expect(result.errors).to.deep.equal([]);
    });

    it('stashPop is "skipped" when there is no stash', async () => {
      const { snapshot, script } = rollbackFixture();
      const ws = loadWorkspace(script);

      const result = await ws.rollbackChtCore('/tmp/cht-core', snapshot);
      expect(result.stashPop).to.equal('skipped');
    });

    it('reset failure is captured in result.errors and result.reset', async () => {
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

  describe('reportSafetyError', () => {
    afterEach(() => sinon.restore());

    it('prints a safety error once, however many layers report it', () => {
      const ws = loadWorkspace({});
      const errorSpy = sinon.stub(console, 'error');
      const err = new ws.WorkspaceSafetyError('drift', 'moved', { lines: ['line one', 'line two'] });
      ws.reportSafetyError(err, '[a]');
      ws.reportSafetyError(err, '[b]');
      expect(errorSpy.getCalls().map(c => String(c.args[0]))).to.deep.equal(['[a] line one', '[a] line two']);
    });
  });

  describe('the git child environment', () => {
    it('runs every git call with LC_ALL=C and the hardened config', async () => {
      const options: Array<{ env?: NodeJS.ProcessEnv }> = [];
      const ws = loadWorkspace({
        'git rev-parse HEAD': { stdout: 'abc1234\n' },
        'git status --porcelain': { stdout: '' },
      }, {}, [], options);
      await ws.snapshotChtCore('/tmp/cht-core');
      expect(options.length).to.be.greaterThan(3);
      for (const opts of options) {
        expect(opts.env?.LC_ALL).to.equal('C');
        expect(opts.env?.GIT_CONFIG_KEY_0).to.equal('core.fsmonitor');
        expect(opts.env?.GIT_CONFIG_KEY_1).to.equal('core.hooksPath');
      }
    });
  });
});
