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
import type { ValidateFunction } from 'ajv';
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
  return fs
    .readdirSync(pendingDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .flatMap(entry => {
      const domainDir = path.join(pendingDir, entry.name);
      return fs
        .readdirSync(domainDir)
        .filter(file => file.endsWith('.md'))
        .map(file => path.join(domainDir, file));
    });
}

/** Parse a draft's frontmatter, or null when the block is missing/unparseable. */
function parseFrontmatter(content: string): Record<string, unknown> | null {
  if (!hasFrontmatter(content)) return null;
  try {
    return normalizeFrontmatter(matter(content).data as Record<string, unknown>);
  } catch {
    return null;
  }
}

/** The reason one draft fails the guard, or null when it passes. */
function draftFailure(draftPath: string, validate: ValidateFunction): string | null {
  const data = parseFrontmatter(fs.readFileSync(draftPath, 'utf8'));
  if (data === null) return 'missing or unparseable frontmatter block';
  if (!validate(data)) {
    const errors = (validate.errors ?? []).map(e => `${e.instancePath || '(root)'} ${e.message ?? 'invalid'}`).join('; ');
    return `schema invalid: ${errors}`;
  }
  const guardReason = ciGuardReason(draftPath, data);
  return guardReason === null ? null : `CI guard: ${guardReason}`;
}

/** Validate all pending drafts; returns one failure per bad draft. */
export function checkPending(pendingDir: string = PENDING_DIR): PendingFailure[] {
  const validate = buildValidator();
  return pendingDrafts(pendingDir)
    .map(draftPath => ({ path: draftPath, reason: draftFailure(draftPath, validate) }))
    .filter((f): f is PendingFailure => f.reason !== null);
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
