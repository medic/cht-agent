import { expect } from 'chai';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'node:fs';
import type { ReviewPRResult } from '../../src/types/pipeline';
import { discoverDraftsByDomain, buildPRBody, openReviewPR } from '../../src/scripts/open-review-pr';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VALID_FRONTMATTER = `---
id: cht-core-42
domain: contacts
title: Prevent duplicate contact creation
last_updated: "2026-05-20"
summary: "Race condition caused duplicate contacts"
tags:
  - contacts
source_pr: medic/cht-core#42
source_sha: abc123
distilled_at: "2026-05-20"
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - webapp/src/services/contacts.js
concepts:
  - idempotency
related_issues: []
stale: false
---

## Problem

Duplicate contacts appear on slow networks.
`;

const INVALID_FRONTMATTER = `---
title: Missing required domain field
last_updated: "2026-05-20"
---

No domain here.
`;

const NO_FRONTMATTER = `# Just markdown, no YAML\n\nSome content.`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'orp-test-'));
}

function setupPendingDir(domain: string, files: Record<string, string>): string {
  const pendingDir = makeTmpDir();
  const domainDir = path.join(pendingDir, domain);
  fs.mkdirSync(domainDir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(domainDir, name), content, 'utf8');
  }
  return pendingDir;
}

/** Stub execFn that dispatches on the first arg (file) and second arg (args[0]) */
type ExecCall = [string, string[]];

function makeExecStub(handlers: Record<string, (args: string[]) => string>): {
  fn: (file: string, args: string[]) => string;
  calls: ExecCall[];
} {
  const calls: ExecCall[] = [];
  return {
    calls,
    fn: (file: string, args: string[]) => {
      calls.push([file, args]);
      const key = file === 'git' ? `git-${args[0]}` : `${file}-${args[0]}`;
      const handler = handlers[key] ?? handlers['*'];
      if (!handler) throw new Error(`Unexpected exec call: ${file} ${args.join(' ')}`);
      return handler(args);
    },
  };
}

// ---------------------------------------------------------------------------
// discoverDraftsByDomain
// ---------------------------------------------------------------------------

describe('discoverDraftsByDomain', () => {
  it('returns empty map when pending dir has no .md files', () => {
    const pendingDir = makeTmpDir();
    fs.mkdirSync(path.join(pendingDir, 'contacts'));
    // Only .gitkeep, no .md
    fs.writeFileSync(path.join(pendingDir, 'contacts', '.gitkeep'), '');

    const result = discoverDraftsByDomain(pendingDir);
    expect(result.size).to.equal(0);
  });

  it('returns .md files grouped by domain', () => {
    const pendingDir = setupPendingDir('contacts', {
      '42-foo.md': VALID_FRONTMATTER,
      '43-bar.md': VALID_FRONTMATTER,
    });

    const result = discoverDraftsByDomain(pendingDir);
    expect(result.get('contacts')).to.have.length(2);
  });

  it('ignores .gitkeep and non-.md files', () => {
    const pendingDir = setupPendingDir('contacts', {
      '42-foo.md': VALID_FRONTMATTER,
      '.gitkeep': '',
      'notes.txt': 'ignore me',
    });

    const result = discoverDraftsByDomain(pendingDir);
    const files = result.get('contacts') ?? [];
    expect(files).to.have.length(1);
    expect(files[0]).to.match(/42-foo\.md$/);
  });

  it('returns empty map when pending dir does not exist', () => {
    const result = discoverDraftsByDomain('/does/not/exist/at/all');
    expect(result.size).to.equal(0);
  });
});

// ---------------------------------------------------------------------------
// buildPRBody
// ---------------------------------------------------------------------------

describe('buildPRBody', () => {
  let pendingDir: string;
  let draftPath: string;

  beforeEach(() => {
    pendingDir = makeTmpDir();
    draftPath = path.join(pendingDir, '42-foo.md');
    fs.writeFileSync(draftPath, VALID_FRONTMATTER, 'utf8');
  });

  it('includes the domain heading', () => {
    const body = buildPRBody('contacts', [draftPath]);
    expect(body).to.include('## Knowledge drafts: contacts');
  });

  it('lists the draft title from frontmatter', () => {
    const body = buildPRBody('contacts', [draftPath]);
    expect(body).to.include('Prevent duplicate contact creation');
  });

  it('includes the source_pr link', () => {
    const body = buildPRBody('contacts', [draftPath]);
    expect(body).to.include('medic/cht-core#42');
  });

  it('includes the review checklist', () => {
    const body = buildPRBody('contacts', [draftPath]);
    expect(body).to.include('- [ ] Summary accurately describes the change');
    expect(body).to.include('- [ ] Domain and category are correct');
  });

  it('uses filename as title fallback when frontmatter has no title', () => {
    const noTitlePath = path.join(pendingDir, '99-no-title.md');
    fs.writeFileSync(noTitlePath, '---\ndomain: contacts\nlast_updated: "2026-05-20"\n---\n', 'utf8');
    const body = buildPRBody('contacts', [noTitlePath]);
    expect(body).to.include('99-no-title.md');
  });
});

// ---------------------------------------------------------------------------
// openReviewPR — dry-run
// ---------------------------------------------------------------------------

describe('openReviewPR (dry-run)', () => {
  it('returns dry-run result without calling exec', () => {
    const pendingDir = setupPendingDir('contacts', { '42-foo.md': VALID_FRONTMATTER });
    const domainsDir = makeTmpDir();
    const logPath = path.join(makeTmpDir(), 'skipped.ndjson');
    let execCalled = false;

    const results = openReviewPR({
      pendingDir,
      domainsDir,
      logPath,
      date: '20260520',
      execFn: () => { execCalled = true; return ''; },
    });

    expect(execCalled).to.equal(false);
    expect(results).to.have.length(1);
    expect(results[0].status).to.equal('dry-run');
    expect(results[0].domain).to.equal('contacts');
    expect(results[0].filesPromoted).to.equal(1);
    expect(results[0].branch).to.equal('memory/review/contacts-20260520');
  });

  it('skips domains with no drafts and omits them from results', () => {
    const pendingDir = makeTmpDir();
    // No domain directories at all
    const results = openReviewPR({ pendingDir });
    expect(results).to.have.length(0);
  });

  it('does not copy files to domainsDir in dry-run', () => {
    const pendingDir = setupPendingDir('contacts', { '42-foo.md': VALID_FRONTMATTER });
    const domainsDir = makeTmpDir();
    const logPath = path.join(makeTmpDir(), 'skipped.ndjson');

    openReviewPR({ pendingDir, domainsDir, logPath });

    const targetDir = path.join(domainsDir, 'contacts', 'issues');
    expect(fs.existsSync(targetDir)).to.equal(false);
  });
});

// ---------------------------------------------------------------------------
// openReviewPR — invalid drafts
// ---------------------------------------------------------------------------

describe('openReviewPR — invalid draft handling', () => {
  it('skips draft with missing required schema fields and logs to skip file', () => {
    const pendingDir = setupPendingDir('contacts', { '99-bad.md': INVALID_FRONTMATTER });
    const domainsDir = makeTmpDir();
    const logPath = path.join(makeTmpDir(), 'skipped.ndjson');

    const results = openReviewPR({ pendingDir, domainsDir, logPath });

    // Domain had only invalid drafts → skipped
    expect(results[0].status).to.equal('skipped');
    expect(results[0].filesPromoted).to.equal(0);

    // Skip entry written
    const log = fs.readFileSync(logPath, 'utf8');
    const entry = JSON.parse(log.trim());
    expect(entry.decision).to.equal('flag-for-human');
    expect(entry.reason).to.include('Schema invalid');
  });

  it('skips draft with no frontmatter and logs skip entry', () => {
    const pendingDir = setupPendingDir('contacts', { '99-no-fm.md': NO_FRONTMATTER });
    const logPath = path.join(makeTmpDir(), 'skipped.ndjson');

    openReviewPR({ pendingDir, logPath });

    const log = fs.readFileSync(logPath, 'utf8');
    expect(log).to.include('No frontmatter');
  });

  it('promotes valid drafts and skips invalid ones in the same domain', () => {
    const pendingDir = setupPendingDir('contacts', {
      '42-good.md': VALID_FRONTMATTER,
      '99-bad.md': INVALID_FRONTMATTER,
    });
    const domainsDir = makeTmpDir();
    const logPath = path.join(makeTmpDir(), 'skipped.ndjson');

    const results = openReviewPR({ pendingDir, domainsDir, logPath, date: '20260520' });

    // 1 valid draft → dry-run result with filesPromoted=1
    expect(results[0].status).to.equal('dry-run');
    expect(results[0].filesPromoted).to.equal(1);

    // Skip entry for the bad one
    const log = fs.readFileSync(logPath, 'utf8');
    expect(log).to.include('99-bad.md');
  });

  it('parses prNumber from filename in skip log entry', () => {
    const pendingDir = setupPendingDir('contacts', { '77-invalid.md': INVALID_FRONTMATTER });
    const logPath = path.join(makeTmpDir(), 'skipped.ndjson');

    openReviewPR({ pendingDir, logPath });

    const entry = JSON.parse(fs.readFileSync(logPath, 'utf8').trim());
    expect(entry.prNumber).to.equal(77);
  });
});

// ---------------------------------------------------------------------------
// openReviewPR — apply mode
// ---------------------------------------------------------------------------

describe('openReviewPR (apply)', () => {
  let pendingDir: string;
  let domainsDir: string;
  let logPath: string;
  let draftPath: string;

  beforeEach(() => {
    pendingDir = makeTmpDir();
    domainsDir = makeTmpDir();
    logPath = path.join(makeTmpDir(), 'skipped.ndjson');

    const domainDir = path.join(pendingDir, 'contacts');
    fs.mkdirSync(domainDir);
    draftPath = path.join(domainDir, '42-foo.md');
    fs.writeFileSync(draftPath, VALID_FRONTMATTER, 'utf8');
  });

  function makeApplyExec(prUrl = 'https://github.com/medic/cht-agent/pull/99') {
    return makeExecStub({
      'git-fetch': () => '',
      'git-rev-parse': (args) => {
        if (args.includes('--abbrev-ref')) return 'feat/108\n';
        // '--verify' for uniqueBranchName: throw to signal branch doesn't exist
        throw new Error('branch does not exist');
      },
      'git-switch': () => '',
      'git-add': () => '',
      'git-commit': () => '',
      'git-push': () => '',
      'gh-pr': () => `${prUrl}\n`,
    });
  }

  it('returns created status with prUrl', () => {
    const { fn } = makeApplyExec();
    const results = openReviewPR({ apply: true, pendingDir, domainsDir, logPath, date: '20260520', execFn: fn });

    expect(results).to.have.length(1);
    const r = results[0] as ReviewPRResult;
    expect(r.status).to.equal('created');
    expect(r.prUrl).to.equal('https://github.com/medic/cht-agent/pull/99');
    expect(r.filesPromoted).to.equal(1);
    expect(r.branch).to.equal('memory/review/contacts-20260520');
  });

  it('calls git fetch origin main before branching', () => {
    const { fn, calls } = makeApplyExec();
    openReviewPR({ apply: true, pendingDir, domainsDir, logPath, date: '20260520', execFn: fn });

    const fetchCall = calls.find(([f, a]) => f === 'git' && a[0] === 'fetch');
    expect(fetchCall).to.exist;
    expect(fetchCall![1]).to.deep.equal(['fetch', 'origin', 'main']);
  });

  it('creates branch from origin/main', () => {
    const { fn, calls } = makeApplyExec();
    openReviewPR({ apply: true, pendingDir, domainsDir, logPath, date: '20260520', execFn: fn });

    const switchCall = calls.find(([f, a]) => f === 'git' && a[0] === 'switch' && a[1] === '-c');
    expect(switchCall).to.exist;
    expect(switchCall![1]).to.deep.equal(['switch', '-c', 'memory/review/contacts-20260520', 'origin/main']);
  });

  it('copies draft to domainsDir and deletes from pendingDir', () => {
    const { fn } = makeApplyExec();
    openReviewPR({ apply: true, pendingDir, domainsDir, logPath, date: '20260520', execFn: fn });

    const targetPath = path.join(domainsDir, 'contacts', 'issues', '42-foo.md');
    expect(fs.existsSync(targetPath)).to.equal(true);
    expect(fs.existsSync(draftPath)).to.equal(false);
  });

  it('calls gh pr create with correct title and base branch', () => {
    const { fn, calls } = makeApplyExec();
    openReviewPR({ apply: true, pendingDir, domainsDir, logPath, date: '20260520', execFn: fn });

    const prCall = calls.find(([f, a]) => f === 'gh' && a[0] === 'pr');
    expect(prCall).to.exist;
    const args = prCall![1];
    expect(args).to.include('--title');
    expect(args[args.indexOf('--title') + 1]).to.equal('Memory review: contacts');
    expect(args).to.include('--base');
    expect(args[args.indexOf('--base') + 1]).to.equal('main');
    expect(args).to.include('--head');
    expect(args[args.indexOf('--head') + 1]).to.equal('memory/review/contacts-20260520');
  });

  it('switches back to original branch after PR created', () => {
    const { fn, calls } = makeApplyExec();
    openReviewPR({ apply: true, pendingDir, domainsDir, logPath, date: '20260520', execFn: fn });

    const switchBackCalls = calls.filter(([f, a]) => f === 'git' && a[0] === 'switch' && !a.includes('-c'));
    // Last switch should be back to original branch
    const lastSwitch = switchBackCalls[switchBackCalls.length - 1];
    expect(lastSwitch[1]).to.deep.equal(['switch', 'feat/108']);
  });

  it('switches back to original branch even when an error is thrown', () => {
    const originalBranch = 'feat/108';
    let switchBackCalled = false;

    const exec = makeExecStub({
      'git-fetch': () => '',
      'git-rev-parse': (args) => {
        if (args.includes('--abbrev-ref')) return `${originalBranch}\n`;
        throw new Error('branch does not exist');
      },
      'git-switch': (args) => {
        if (args.includes('-c')) return '';
        // The switch-back call
        switchBackCalled = true;
        return '';
      },
      'git-add': () => { throw new Error('git add failed'); },
      '*': () => '',
    });

    expect(() => openReviewPR({
      apply: true, pendingDir, domainsDir, logPath, date: '20260520', execFn: exec.fn,
    })).to.throw('git add failed');

    expect(switchBackCalled).to.equal(true);
  });
});

// ---------------------------------------------------------------------------
// Regression: gray-matter cache — repeated calls with same content
// ---------------------------------------------------------------------------

describe('openReviewPR — regression: gray-matter cache', () => {
  it('bug: second call with identical draft content is not rejected as missing frontmatter', () => {
    // First call: gray-matter parses VALID_FRONTMATTER and stores it in matter.cache
    const dir1 = setupPendingDir('contacts', { '42-foo.md': VALID_FRONTMATTER });
    const logPath1 = path.join(makeTmpDir(), 'skip1.ndjson');
    const r1 = openReviewPR({ pendingDir: dir1, domainsDir: makeTmpDir(), logPath: logPath1, date: '20260520' });
    expect(r1[0].status, 'first call').to.equal('dry-run');

    // Second call with the same string content — must not be treated as missing frontmatter
    const dir2 = setupPendingDir('contacts', { '42-foo.md': VALID_FRONTMATTER });
    const logPath2 = path.join(makeTmpDir(), 'skip2.ndjson');
    const r2 = openReviewPR({ pendingDir: dir2, domainsDir: makeTmpDir(), logPath: logPath2, date: '20260520' });
    expect(r2[0].status, 'second call').to.equal('dry-run');
  });
});

// ---------------------------------------------------------------------------
// openReviewPR — branch collision
// ---------------------------------------------------------------------------

describe('openReviewPR — branch collision handling', () => {
  it('appends counter when branch already exists', () => {
    const pendingDir = setupPendingDir('contacts', { '42-foo.md': VALID_FRONTMATTER });
    const domainsDir = makeTmpDir();
    const logPath = path.join(makeTmpDir(), 'skipped.ndjson');

    let verifyCount = 0;
    const exec = makeExecStub({
      'git-fetch': () => '',
      'git-rev-parse': (args) => {
        if (args.includes('--abbrev-ref')) return 'feat/108\n';
        if (args.includes('--verify')) {
          verifyCount++;
          // First verify: branch exists; second: doesn't exist
          if (verifyCount === 1) return 'abc123'; // branch exists
          throw new Error('branch does not exist');
        }
        throw new Error('unexpected rev-parse');
      },
      'git-switch': () => '',
      'git-add': () => '',
      'git-commit': () => '',
      'git-push': () => '',
      'gh-pr': () => 'https://github.com/medic/cht-agent/pull/99\n',
    });

    const results = openReviewPR({
      apply: true, pendingDir, domainsDir, logPath, date: '20260520', execFn: exec.fn,
    });

    expect(results[0].branch).to.equal('memory/review/contacts-20260520-2');
  });
});
