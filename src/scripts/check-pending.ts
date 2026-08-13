/**
 * check-pending.ts — the CI entry point for the pending-draft guard.
 *
 * Validates every draft under agent-memory/_pending/ against schema.json and
 * `ciGuardReason` (mislinked issueNumber or a stale filename slug), so a bad
 * draft fails the PR that carries it instead of surfacing at promotion time.
 *
 * Usage: npm run check-pending  (exits 1 when any draft fails)
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import matter from 'gray-matter';
import { REPO_ROOT, buildValidator, normalizeFrontmatter, hasFrontmatter } from './schema-utils';
import { ciGuardReason } from './dedup';

const PENDING_DIR = path.join(REPO_ROOT, 'agent-memory', '_pending');

export interface PendingFailure {
  path: string;
  reason: string;
}

/** Every .md draft under `pendingDir`, one directory level deep (domain dirs). */
function pendingDrafts(pendingDir: string): string[] {
  if (!fs.existsSync(pendingDir)) return [];
  const drafts: string[] = [];
  for (const entry of fs.readdirSync(pendingDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const domainDir = path.join(pendingDir, entry.name);
    for (const file of fs.readdirSync(domainDir)) {
      if (file.endsWith('.md')) drafts.push(path.join(domainDir, file));
    }
  }
  return drafts;
}

/** Validate all pending drafts; returns one failure per bad draft. */
export function checkPending(pendingDir: string = PENDING_DIR): PendingFailure[] {
  const validate = buildValidator();
  const failures: PendingFailure[] = [];
  for (const draftPath of pendingDrafts(pendingDir)) {
    const content = fs.readFileSync(draftPath, 'utf8');
    if (!hasFrontmatter(content)) {
      failures.push({ path: draftPath, reason: 'missing frontmatter block' });
      continue;
    }
    let data: Record<string, unknown>;
    try {
      data = normalizeFrontmatter(matter(content).data as Record<string, unknown>);
    } catch (err) {
      failures.push({ path: draftPath, reason: `unparseable frontmatter: ${err instanceof Error ? err.message : String(err)}` });
      continue;
    }
    if (!validate(data)) {
      const errors = (validate.errors ?? []).map(e => `${e.instancePath || '(root)'} ${e.message ?? 'invalid'}`).join('; ');
      failures.push({ path: draftPath, reason: `schema invalid: ${errors}` });
      continue;
    }
    const guardReason = ciGuardReason(draftPath, data);
    if (guardReason !== null) failures.push({ path: draftPath, reason: `CI guard: ${guardReason}` });
  }
  return failures;
}

if (require.main === module) {
  const failures = checkPending();
  for (const f of failures) {
    console.error(`FAIL ${path.relative(REPO_ROOT, f.path)}: ${f.reason}`);
  }
  if (failures.length > 0) {
    console.error(`${failures.length} pending draft(s) failed the CI guard.`);
    process.exit(1);
  }
  console.log('All pending drafts pass the CI guard.');
}
