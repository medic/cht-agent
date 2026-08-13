import { expect } from 'chai';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'node:fs';
import { checkPending } from '../../src/scripts/check-pending';

const VALID_FRONTMATTER = `---
id: cht-core-1042
category: bug
domain: contacts
issueNumber: 1042
issueUrl: https://github.com/medic/cht-core/issues/1042
title: Prevent duplicate contact creation
lastUpdated: "2026-05-20"
summary: "Race condition caused duplicate contacts"
services:
  - webapp
techStack:
  - javascript
tags:
  - contacts
source_pr: medic/cht-core#42
source_sha: abc1234
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

function setupPendingDir(files: Record<string, string>): string {
  const pendingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-pending-test-'));
  const domainDir = path.join(pendingDir, 'contacts');
  fs.mkdirSync(domainDir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(domainDir, name), content, 'utf8');
  }
  return pendingDir;
}

describe('checkPending', () => {
  it('returns no failures for an empty or missing pending directory', () => {
    expect(checkPending(path.join(os.tmpdir(), 'does-not-exist'))).to.deep.equal([]);
    expect(checkPending(setupPendingDir({}))).to.deep.equal([]);
  });

  it('passes a schema-valid, correctly-linked draft', () => {
    const dir = setupPendingDir({ '42-issue-1042-prevent-duplicates.md': VALID_FRONTMATTER });
    expect(checkPending(dir)).to.deep.equal([]);
  });

  it('fails a draft whose filename slug contradicts its frontmatter issueNumber', () => {
    const dir = setupPendingDir({ '42-issue-9999-prevent-duplicates.md': VALID_FRONTMATTER });
    const failures = checkPending(dir);
    expect(failures).to.have.length(1);
    expect(failures[0].reason).to.include('CI guard:');
    expect(failures[0].reason).to.include('9999');
  });

  it('fails a draft whose issueNumber aliases its own source PR', () => {
    const aliased = VALID_FRONTMATTER
      .replace('issueNumber: 1042', 'issueNumber: 42')
      .replace('id: cht-core-1042', 'id: cht-core-42')
      .replace('issues/1042', 'issues/42');
    const dir = setupPendingDir({ '42-prevent-duplicates.md': aliased });
    const failures = checkPending(dir);
    expect(failures).to.have.length(1);
    expect(failures[0].reason).to.include('equals its own source PR number');
  });

  it('fails a schema-invalid draft', () => {
    const dir = setupPendingDir({ '42-broken.md': '---\ntitle: only a title\n---\n\nbody\n' });
    const failures = checkPending(dir);
    expect(failures).to.have.length(1);
    expect(failures[0].reason).to.include('schema invalid');
  });

  it('fails a draft with no frontmatter block', () => {
    const dir = setupPendingDir({ '42-plain.md': '# Just markdown\n' });
    const failures = checkPending(dir);
    expect(failures).to.have.length(1);
    expect(failures[0].reason).to.include('missing or unparseable frontmatter');
  });
});
