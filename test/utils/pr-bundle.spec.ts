import { expect } from 'chai';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  buildPatch,
  buildPrDescription,
  ensureGitignored,
  writePrBundle,
  PatchScopeResult,
} from '../../src/utils/pr-bundle';
import { IssueTemplate, QaResult } from '../../src/types';

/** A buildPatch result standing in for a real patch, for description tests. */
const patchResult = (over: Partial<PatchScopeResult> = {}): PatchScopeResult => ({
  patch: 'diff --git a/tasks.js b/tasks.js\n',
  files: ['tasks.js', 'test/tasks/a.spec.js'],
  excluded: [],
  scoped: true,
  declaredButAbsent: [],
  ...over,
});

/** A tier-1 clean QA run: reproduced, applied, verified. */
const passingQa = (): QaResult => ({
  ran: true,
  approved: true,
  reproduced: true,
  verified: true,
  succeeded: true,
  applyResult: { succeeded: true },
  messages: [],
} as unknown as QaResult);

const ticket = (): IssueTemplate => ({
  issue: {
    title: 'Child PNC follow-up tasks accumulate as duplicates',
    type: 'bug',
    priority: 'high',
    description: 'CHPs report duplicates.',
    technical_context: { domain: 'tasks-and-targets', components: [], layer: 'cht-conf' },
    requirements: ['Correct the resolver form id'],
    acceptance_criteria: ['Submitting the follow-up resolves the task'],
    constraints: [],
  },
} as IssueTemplate);

const git = (cwd: string, args: string[]): void => {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
};

/** A scratch config repo with one committed file. */
const makeRepo = (withGitignore: boolean): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-bundle-'));
  git(dir, ['init', '-q', '.']);
  git(dir, ['config', 'user.email', 't@t']);
  git(dir, ['config', 'user.name', 't']);
  fs.writeFileSync(path.join(dir, 'tasks.js'), 'line1\nline2\nline3\n');
  if (withGitignore) fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules\n');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'init']);
  return dir;
};

describe('pr-bundle', () => {
  const dirs: string[] = [];
  const track = (dir: string): string => {
    dirs.push(dir);
    return dir;
  };

  afterEach(() => {
    while (dirs.length > 0) {
      fs.rmSync(dirs.pop() as string, { recursive: true, force: true });
    }
  });

  describe('ensureGitignored', () => {
    it('appends .cht-agent when absent', () => {
      const dir = track(makeRepo(true));
      ensureGitignored(dir);
      expect(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8')).to.contain('.cht-agent');
    });

    it('is idempotent', () => {
      const dir = track(makeRepo(true));
      ensureGitignored(dir);
      ensureGitignored(dir);
      const occurrences = fs
        .readFileSync(path.join(dir, '.gitignore'), 'utf8')
        .split('\n')
        .filter(l => l.trim() === '.cht-agent').length;
      expect(occurrences).to.equal(1);
    });

    it('creates .gitignore when the project has none', () => {
      const dir = track(makeRepo(false));
      ensureGitignored(dir);
      expect(fs.existsSync(path.join(dir, '.gitignore'))).to.equal(true);
    });
  });

  describe('buildPatch', () => {
    it('captures both tracked edits and new untracked files', async () => {
      const dir = track(makeRepo(true));
      fs.writeFileSync(path.join(dir, 'tasks.js'), 'line1\nCHANGED\nline3\n');
      fs.mkdirSync(path.join(dir, 'test', 'tasks'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'test', 'tasks', 'new.spec.js'), 'describe("x", () => {});\n');

      const { patch } = await buildPatch(dir);
      expect(patch).to.contain('-line2');
      expect(patch).to.contain('+CHANGED');
      expect(patch).to.contain('test/tasks/new.spec.js');
      expect(patch).to.contain('new file mode');
    });

    // The bundle and its .gitignore line are agent housekeeping; carrying them
    // into the patch would put them in the PR the patch produces.
    it('excludes .gitignore and the bundle directory', async () => {
      const dir = track(makeRepo(true));
      fs.writeFileSync(path.join(dir, 'tasks.js'), 'line1\nCHANGED\nline3\n');
      fs.appendFileSync(path.join(dir, '.gitignore'), '.cht-agent\n');
      fs.mkdirSync(path.join(dir, '.cht-agent', 'pr'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.cht-agent', 'pr', 'PR.md'), '# draft\n');

      const { patch } = await buildPatch(dir);
      expect(patch).to.not.contain('.gitignore');
      expect(patch).to.not.contain('.cht-agent');
      expect(patch).to.contain('+CHANGED');
    });

    it('returns an empty patch when nothing changed', async () => {
      const dir = track(makeRepo(true));
      expect((await buildPatch(dir)).patch.trim()).to.equal('');
    });

    // The config mount is not reset between tickets: a previous ticket's specs and
    // an operator environment fix are dirty, but they are not this change.
    it('scopes the patch to the given files and reports what it left out', async () => {
      const dir = track(makeRepo(true));
      fs.writeFileSync(path.join(dir, 'tasks.js'), 'line1\nCHANGED\nline3\n');
      fs.writeFileSync(path.join(dir, 'harness.defaults.json'), '{"args":["--no-sandbox"]}\n');
      fs.mkdirSync(path.join(dir, 'test', 'tasks'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'test', 'tasks', 'mine.spec.js'), 'describe("mine", () => {});\n');
      fs.writeFileSync(path.join(dir, 'test', 'tasks', 'theirs.spec.js'), 'describe("theirs", () => {});\n');

      const result = await buildPatch(dir, ['tasks.js', 'test/tasks/mine.spec.js']);

      expect(result.scoped).to.equal(true);
      expect(result.files).to.have.members(['tasks.js', 'test/tasks/mine.spec.js']);
      expect(result.patch).to.contain('+CHANGED');
      expect(result.patch).to.not.contain('theirs.spec.js');
      expect(result.patch).to.not.contain('harness.defaults.json');
      expect(result.excluded.map(e => e.path)).to.have.members([
        'harness.defaults.json',
        'test/tasks/theirs.spec.js',
      ]);
    });

    it('normalises absolute scope paths', async () => {
      const dir = track(makeRepo(true));
      fs.writeFileSync(path.join(dir, 'tasks.js'), 'line1\nCHANGED\nline3\n');
      const result = await buildPatch(dir, [path.join(dir, 'tasks.js')]);
      expect(result.files).to.deep.equal(['tasks.js']);
    });

    // An empty patch reads as "nothing to apply"; it must never be the result of
    // a scope that missed.
    it('abandons scoping rather than shipping an empty patch', async () => {
      const dir = track(makeRepo(true));
      fs.writeFileSync(path.join(dir, 'tasks.js'), 'line1\nCHANGED\nline3\n');

      const result = await buildPatch(dir, ['never-written.js']);

      expect(result.scoped).to.equal(false);
      expect(result.scopeFallbackReason).to.contain('NOT scoped');
      expect(result.patch).to.contain('+CHANGED');
      expect(result.declaredButAbsent).to.deep.equal(['never-written.js']);
    });
  });

  describe('buildPrDescription', () => {
    const base = { configRoot: '/x', ticket: ticket(), filesWritten: ['tasks.js', 'test/tasks/a.spec.js'] };

    // The document must describe the PATCH: PR.md once listed 5 spec files for a
    // patch that carried 25, because it printed the dev phase's filesWritten.
    it('lists the files the patch actually contains, not what was reported written', () => {
      const md = buildPrDescription(base, patchResult({ files: ['tasks.js', 'test/tasks/b.spec.js'] }));
      expect(md).to.contain('## Changes');
      expect(md).to.contain('`tasks.js`');
      expect(md).to.contain('## Tests added');
      expect(md).to.contain('`test/tasks/b.spec.js`');
      expect(md).to.not.contain('a.spec.js');
    });

    it('warns when the patch is empty', () => {
      expect(buildPrDescription(base, patchResult({ patch: '', files: [] })))
        .to.contain('the generated patch is empty');
    });

    // Silent truncation would be worse than the leak it fixes.
    it('reports every deliberately excluded file with its reason', () => {
      const md = buildPrDescription(base, patchResult({
        excluded: [
          { path: 'harness.defaults.json', reason: 'not written by this ticket' },
          { path: '.gitignore', reason: 'agent housekeeping' },
        ],
      }));
      expect(md).to.contain('## Excluded from the patch');
      expect(md).to.contain('`harness.defaults.json` — not written by this ticket');
      expect(md).to.contain('`.gitignore` — agent housekeeping');
    });

    it('warns about files the dev phase claimed but the patch does not carry', () => {
      const md = buildPrDescription(base, patchResult({ declaredButAbsent: ['gone.js'] }));
      expect(md).to.contain('NOT in the patch');
      expect(md).to.contain('`gone.js`');
    });

    // Opening a PR for a change that failed QA should require a conscious choice.
    it('flags a failed QA run in the description', () => {
      const qa = {
        ran: true, approved: true, reproduced: true, verified: false,
        succeeded: false, messages: [],
      } as unknown as QaResult;
      const md = buildPrDescription({ ...base, qa }, patchResult());
      expect(md).to.contain('DID NOT PASS');
      expect(md).to.contain('Review the evidence before opening the PR');
    });

    it('reports a passing QA run', () => {
      const md = buildPrDescription({ ...base, qa: passingQa() }, patchResult());
      expect(md).to.contain('**Result: PASSED**');
    });

    // The headline came from qa.succeeded while tier-2 was listed independently,
    // so PR.md printed "Result: PASSED" four lines above "Tier-2: FAILED".
    it('never headlines PASSED when a tier-2 failure is unattributed', () => {
      const qa = {
        ...passingQa(),
        tier2: { ran: true, passed: false, outputTail: '3 failing' },
      } as unknown as QaResult;
      const md = buildPrDescription({ ...base, qa }, patchResult());
      expect(md).to.not.contain('**Result: PASSED**');
      expect(md).to.contain('DID NOT PASS');
      expect(md).to.contain('not attributed to pre-existing breakage');
    });

    /**
     * Hardening A: the verify oracle asserts ONE artifact. When the ticket names
     * more sites than that, a reviewer reading "Result: PASSED" reads a one-site
     * proof as a whole-scope one — so the scope is a fact, and a caveat.
     */
    it('names the ticket sites QA never deployment-verified, and qualifies the headline', () => {
      const multiSite = ticket();
      multiSite.issue.technical_context.configArtifact = 'contact-form';
      multiSite.issue.technical_context.artifactName = 'e_household-create';
      multiSite.issue.technical_context.components = [
        'forms/contact/e_household-create.xml:21441',
        'forms/contact/f_client-create.xml:19317',
      ];

      const md = buildPrDescription({ ...base, ticket: multiSite, qa: passingQa() }, patchResult());

      expect(md).to.contain('- Scope: tier-1 verified e_household-create');
      expect(md).to.contain('1 further site(s) named by this ticket are NOT deployment-verified');
      expect(md).to.contain('forms/contact/f_client-create.xml');
      expect(md).to.contain('**Result: PASSED WITH CAVEATS**');
      expect(md).to.not.contain('**Result: PASSED**');
    });

    it('says nothing about scope for a single-artifact ticket', () => {
      const md = buildPrDescription({ ...base, qa: passingQa() }, patchResult());

      expect(md).to.not.contain('NOT deployment-verified');
      expect(md).to.contain('**Result: PASSED**');
    });

    /**
     * Hardening B: a tier-2 skip is free while tier-1 covered the whole scope.
     * With a pinned regression surface that never ran AND sites tier-1 did not
     * verify, the document must not call it a pass.
     */
    it('fails the verdict when a PINNED tier-2 surface never ran on a multi-site ticket', () => {
      const multiSite = ticket();
      multiSite.issue.technical_context.configArtifact = 'contact-form';
      multiSite.issue.technical_context.artifactName = 'e_household-create';
      multiSite.issue.technical_context.components = [
        'forms/contact/e_household-create.xml:21441',
        'forms/contact/f_client-create.xml:19317',
      ];
      multiSite.issue.technical_context.qaSpecs = ['test/forms/f_client-create.spec.js'];
      const qa = {
        ...passingQa(),
        tier2: { ran: false, reason: 'pinned qaSpecs not found under the config root: test/forms/f_client-create.spec.js' },
      } as unknown as QaResult;

      const md = buildPrDescription({ ...base, ticket: multiSite, qa }, patchResult());

      expect(md).to.contain('DID NOT PASS');
      expect(md).to.contain('pinned tier-2 specs that never ran');
      expect(md).to.contain('Review the evidence before opening the PR');
    });

    it('keeps a tier-2 skip harmless on a single-artifact ticket (unchanged)', () => {
      const pinned = ticket();
      pinned.issue.technical_context.qaSpecs = ['test/tasks/a.spec.js'];
      const qa = {
        ...passingQa(),
        tier2: { ran: false, reason: 'cht-conf-test-harness is not installed in the config repo' },
      } as unknown as QaResult;

      const md = buildPrDescription({ ...base, ticket: pinned, qa }, patchResult());

      expect(md).to.contain('**Result: PASSED**');
      expect(md).to.contain('- Tier-2 harness specs: not run —');
    });

    it('qualifies the headline when the baseline attributes every tier-2 failure', () => {
      const qa = {
        ...passingQa(),
        tier2: {
          ran: true, passed: false, outputTail: '2 failing',
          baseline: { ran: true, passed: false, failing: 2 },
        },
      } as unknown as QaResult;
      const md = buildPrDescription({ ...base, qa }, patchResult());
      expect(md).to.contain('**Result: PASSED WITH CAVEATS**');
      expect(md).to.contain('NO new failures introduced by this change');
      expect(md).to.not.contain('**Result: PASSED**');
    });
  });

  describe('writePrBundle', () => {
    it('writes PR.md and an applicable changes.patch', async () => {
      const dir = track(makeRepo(true));
      fs.writeFileSync(path.join(dir, 'tasks.js'), 'line1\nCHANGED\nline3\n');

      const result = await writePrBundle({ configRoot: dir, ticket: ticket(), filesWritten: ['tasks.js'] });

      expect(result?.patchHasContent).to.equal(true);
      expect(result?.files).to.deep.equal(['tasks.js']);
      expect(fs.existsSync(result?.descriptionPath as string)).to.equal(true);
      expect(fs.existsSync(result?.patchPath as string)).to.equal(true);
      expect(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8')).to.contain('.cht-agent');
    });

    // End to end: the shipped PR.md describes the shipped patch and nothing else.
    it('writes a scoped patch and a PR.md that matches it', async () => {
      const dir = track(makeRepo(true));
      fs.writeFileSync(path.join(dir, 'tasks.js'), 'line1\nCHANGED\nline3\n');
      fs.writeFileSync(path.join(dir, 'README.md'), 'unrelated doc edit\n');
      fs.mkdirSync(path.join(dir, 'test', 'tasks'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'test', 'tasks', 'mine.spec.js'), 'describe("mine", () => {});\n');
      fs.writeFileSync(path.join(dir, 'test', 'tasks', 'theirs.spec.js'), 'describe("theirs", () => {});\n');

      const result = await writePrBundle({
        configRoot: dir,
        ticket: ticket(),
        filesWritten: ['tasks.js', 'test/tasks/mine.spec.js'],
      });
      const patch = fs.readFileSync(result?.patchPath as string, 'utf8');
      const md = fs.readFileSync(result?.descriptionPath as string, 'utf8');

      expect(patch).to.not.contain('theirs.spec.js');
      expect(patch).to.not.contain('README.md');
      expect(md).to.contain('`test/tasks/mine.spec.js`');
      expect(md).to.contain('## Excluded from the patch');
      expect(md).to.contain('`README.md` — not written by this ticket');
      expect(result?.excluded.map(e => e.path)).to.have.members([
        'README.md',
        'test/tasks/theirs.spec.js',
      ]);
    });

    // A handoff artefact must never take the run down with it.
    it('returns undefined rather than throwing on an unusable root', async () => {
      expect(await writePrBundle({
        configRoot: '/nonexistent/definitely/not/here',
        ticket: ticket(),
        filesWritten: [],
      })).to.equal(undefined);
    });
  });
});
