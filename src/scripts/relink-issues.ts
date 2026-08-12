/**
 * relink-issues.ts — one-off, idempotent repair of id/issueNumber/issueUrl on
 * promoted drafts whose distiller aliased the merge-PR number as the issue number
 * (the bug fixed for future runs in distiller.ts). It reuses the SAME linkage
 * logic as the scraper (issue-linkage.ts) so the relink and the pipeline agree.
 *
 * A draft is AFFECTED only when its issueNumber equals its source_pr PR number
 * (the alias signature). For each affected draft it resolves the true issue via,
 * in order, gh `closingIssuesReferences` (sidebar) + PR title + body, then the
 * filename token `<pr>-<type><issue>-` as a cross-check, and rewrites ONLY the
 * three identity lines. Ambiguous cases (multi-issue, tokenless with no gh,
 * gh/token conflict, suspect mismatches) are flagged, never guessed.
 *
 * Dry-run is the default — pass --apply to write.
 *
 * Usage:
 *   npx ts-node src/scripts/relink-issues.ts --dir agent-memory/domains/data-sync/issues [--apply] [--offline]
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import matter from 'gray-matter';
import { classifyNumber, resolveRealIssue, ClassifyCache, ResolveResult, NumberKind, ExecFn } from './gh-classify';

/** Exec function type (single source: gh-classify) — re-exported for callers/tests. */
export type { ExecFn };

export type RelinkStatus = 'relinked' | 'unchanged' | 'flagged';
type RelinkSource = 'gh' | 'filename-token';

export interface RelinkResult {
  file: string;
  status: RelinkStatus;
  from?: number;
  to?: number;
  source?: RelinkSource;
  reason?: string;
  /** gh was authoritative but the filename token disagreed — surfaced for audit. */
  tokenMismatch?: boolean;
  /** Other files resolving to the same issue (the #135 dedup worklist). */
  collidesWith?: string[];
  /** The issue this file resolves to (current or relinked) — set when it collides. */
  issue?: number;
}

export interface RelinkOptions {
  /** Directory to walk recursively for *.md (default: agent-memory/domains). */
  dir?: string;
  /** Write changes; default is dry-run. */
  apply?: boolean;
  /** Force filename-token-only resolution (no gh). */
  offline?: boolean;
  /** owner/repo used for gh lookups (default: medic/cht-core). */
  repo?: string;
  /** Injected exec for tests. */
  exec?: ExecFn;
}

const SOURCE_PR_RE = /^([^#]+)#(\d+)$/;
export const FILENAME_TOKEN_RE =
  /^(\d+)-(?:fix|feat|perf|chore|refactor|docs|ci|build|test|style|revert)?-?(\d+)-/;
const DEFAULT_REPO = 'medic/cht-core';

interface SourcePr {
  repo: string;
  prNumber: number;
}
interface Token {
  prNumber: number;
  issueNumber: number;
}

/** Parse `medic/cht-core#42` → { repo, prNumber }. */
function parseSourcePr(ref: unknown): SourcePr | null {
  if (typeof ref !== 'string') return null;
  const m = SOURCE_PR_RE.exec(ref);
  if (!m) return null;
  return { repo: m[1], prNumber: Number.parseInt(m[2], 10) };
}

/**
 * Parse `8773-fix6299-slug` or `8773-fix-6299-slug` → { prNumber: 8773, issueNumber: 6299 };
 * null when tokenless. Both forms are accepted because old drafts predate the
 * slugify separator fix and are never rewritten.
 */
function parseFilenameToken(filename: string): Token | null {
  const m = FILENAME_TOKEN_RE.exec(path.basename(filename));
  return m ? { prNumber: Number.parseInt(m[1], 10), issueNumber: Number.parseInt(m[2], 10) } : null;
}

/** True once if gh is callable. */
function ghAvailable(exec: ExecFn): boolean {
  try {
    exec('gh', ['--version']);
    return true;
  } catch {
    return false;
  }
}

/** gh state threaded through resolution: online flag, injected exec, per-run cache. */
interface GhCtx {
  online: boolean;
  exec: ExecFn;
  cache: ClassifyCache;
}

type Resolution =
  | { kind: 'relink'; to: number; source: RelinkSource; tokenMismatch?: boolean }
  | { kind: 'flag'; reason: string };

const relink = (to: number, source: RelinkSource, tokenMismatch?: boolean): Resolution =>
  ({ kind: 'relink', to, source, tokenMismatch });
const flag = (reason: string): Resolution => ({ kind: 'flag', reason });
const errMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/**
 * Resolve an affected draft's true issue: try the source PR's closing-refs first
 * (most authoritative), then follow the stored issueNumber if it is itself a PR.
 */
function resolveAffectedIssue(src: SourcePr, issueNumber: number | undefined, gh: GhCtx): ResolveResult {
  const bySource = resolveRealIssue(src.repo, src.prNumber, gh.exec, gh.cache);
  // A multi-issue source is ambiguous — surface it, don't fall through and guess off issueNumber.
  if (bySource.issue !== null || bySource.reason === 'multi-issue') return bySource;
  if (issueNumber !== undefined && issueNumber !== src.prNumber) {
    return resolveRealIssue(src.repo, issueNumber, gh.exec, gh.cache);
  }
  return bySource;
}

/** Offline: use the filename token, or flag when there is none. */
function resolveOffline(token: Token | null): Resolution {
  return token
    ? relink(token.issueNumber, 'filename-token')
    : flag('tokenless and offline — manual relink required');
}

/**
 * Decide the true issue for an affected draft. Online, gh is authoritative
 * (closing-refs only; a PR is followed to the issue it closes) and a transient gh
 * error flags rather than dropping. Offline, the filename token is used.
 */
function resolveAffected(ctx: FileCtx, src: SourcePr, gh: GhCtx): Resolution {
  if (!gh.online) return resolveOffline(ctx.token);
  let resolved: ResolveResult;
  try {
    resolved = resolveAffectedIssue(src, ctx.issueNumber, gh);
  } catch (err) {
    return flag(`gh error resolving #${src.prNumber} (${errMessage(err)}) — manual`);
  }
  if (resolved.issue === null) return flag(`could not resolve to a single issue (${resolved.reason}) — manual`);
  const token = ctx.token;
  return relink(resolved.issue, 'gh', token ? token.issueNumber !== resolved.issue : undefined);
}

/**
 * Rewrite exactly the three identity lines in the frontmatter block. Handles the
 * medic cht-core and cht-interoperability repos (the id/issueUrl patterns are
 * fixed to those owners/repos). Throws if any line is missing or not unique, so a
 * malformed draft is flagged rather than silently corrupted. Body untouched.
 */
export function rewriteFrontmatter(content: string, repo: string, newIssue: number): string {
  const block = /^(---\r?\n)([\s\S]*?\r?\n)(---\r?\n?)/.exec(content);
  if (!block) throw new Error('no frontmatter block');
  let fm = block[2];
  const repoName = repo.split('/')[1]; // medic/cht-core -> cht-core
  const edits: Array<[RegExp, string]> = [
    [/^id: cht-(?:core|interoperability)-\d+$/m, `id: ${repoName}-${newIssue}`],
    [/^issueNumber: \d+$/m, `issueNumber: ${newIssue}`],
    [
      /^issueUrl: https:\/\/github\.com\/medic\/(?:cht-core|cht-interoperability)\/issues\/\d+$/m,
      `issueUrl: https://github.com/${repo}/issues/${newIssue}`,
    ],
  ];
  for (const [re, repl] of edits) {
    let replaced = 0;
    fm = fm.replace(new RegExp(re.source, 'gm'), () => {
      replaced++;
      return repl;
    });
    if (replaced !== 1) throw new Error(`expected exactly one ${re.source} line, found ${replaced}`);
  }
  return block[1] + fm + block[3] + content.slice(block[0].length);
}

/** Recursively collect *.md paths under dir (skips .gitkeep). */
function walkMarkdown(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkMarkdown(full));
    else if (entry.isFile() && entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}

/** Per-file plan built in phase 1 before any write or collision analysis. */
interface FilePlan {
  file: string;
  content: string;
  result: RelinkResult;
  /** Issue number this file will own after relink (for collision detection). */
  finalIssue?: number;
}

interface FileCtx {
  file: string;
  content: string;
  issueNumber?: number;
  src: SourcePr | null;
  token: Token | null;
}

function readCtx(file: string): FileCtx {
  const content = fs.readFileSync(file, 'utf8');
  const fm = matter(content).data as Record<string, unknown>;
  return {
    file,
    content,
    issueNumber: typeof fm.issueNumber === 'number' ? fm.issueNumber : undefined,
    src: parseSourcePr(fm.source_pr),
    token: parseFilenameToken(file),
  };
}

interface Classification {
  result: RelinkResult;
  finalIssue?: number;
}

const unchanged = (file: string, finalIssue?: number): Classification =>
  ({ result: { file, status: 'unchanged' }, finalIssue });

const flaggedClass = (ctx: FileCtx, reason: string): Classification =>
  ({ result: { file: ctx.file, status: 'flagged', from: ctx.issueNumber, reason }, finalIssue: ctx.issueNumber });

/** Resolve an affected draft (alias, or issueNumber that doesn't resolve to a real issue). */
function classifyAffected(ctx: FileCtx, src: SourcePr, gh: GhCtx): Classification {
  const res = resolveAffected(ctx, src, gh);
  if (res.kind === 'flag') return flaggedClass(ctx, res.reason);
  return {
    result: {
      file: ctx.file, status: 'relinked', from: ctx.issueNumber,
      to: res.to, source: res.source, tokenMismatch: res.tokenMismatch,
    },
    finalIssue: res.to,
  };
}

/** Offline (token-only) fallback: flag when issueNumber disagrees with the filename token. */
function classifySuspect(ctx: FileCtx): Classification {
  const t = ctx.token;
  if (t && ctx.issueNumber !== undefined && ctx.issueNumber !== t.issueNumber) {
    return flaggedClass(ctx, `suspect: issueNumber ${ctx.issueNumber} disagrees with filename token ${t.issueNumber} — verify against gh`);
  }
  return unchanged(ctx.file, ctx.issueNumber);
}

/**
 * Non-alias draft with a source_pr. Online, verify issueNumber is a real issue:
 * a PR/missing number is affected (relink), a real issue is unchanged (a stale
 * filename-token mismatch is suppressed, so re-runs stay idempotent). Offline,
 * fall back to the token-only suspect check.
 */
function classifyNonAlias(ctx: FileCtx, src: SourcePr, gh: GhCtx): Classification {
  if (!gh.online || ctx.issueNumber === undefined) return classifySuspect(ctx);
  let kind: NumberKind;
  try {
    kind = classifyNumber(src.repo, ctx.issueNumber, gh.exec, gh.cache);
  } catch (err) {
    return flaggedClass(ctx, `could not verify issueNumber ${ctx.issueNumber} (${errMessage(err)}) — manual`);
  }
  if (kind !== 'issue') return classifyAffected(ctx, src, gh);
  return unchanged(ctx.file, ctx.issueNumber);
}

function classify(ctx: FileCtx, gh: GhCtx): Classification {
  const src = ctx.src;
  if (!src) return unchanged(ctx.file, ctx.issueNumber); // old-convention file, not the alias bug
  if (ctx.issueNumber === src.prNumber) return classifyAffected(ctx, src, gh);
  return classifyNonAlias(ctx, src, gh);
}

function planFile(file: string, gh: GhCtx): FilePlan {
  const ctx = readCtx(file);
  const { result, finalIssue } = classify(ctx, gh);
  return { file, content: ctx.content, result, finalIssue };
}

function groupByFinalIssue(plans: FilePlan[]): Map<number, FilePlan[]> {
  const byIssue = new Map<number, FilePlan[]>();
  for (const p of plans) {
    if (p.finalIssue === undefined) continue;
    const arr = byIssue.get(p.finalIssue) ?? [];
    arr.push(p);
    byIssue.set(p.finalIssue, arr);
  }
  return byIssue;
}

function annotateCluster(issue: number, group: FilePlan[]): void {
  const names = group.map(p => path.basename(p.file));
  for (const p of group) {
    const self = path.basename(p.file);
    p.result.collidesWith = names.filter(n => n !== self);
    p.result.issue = issue;
  }
}

/** Annotate plans with collision clusters (same final issue across the scanned set). */
function detectCollisions(plans: FilePlan[]): void {
  for (const [issue, group] of groupByFinalIssue(plans)) {
    if (group.length >= 2) annotateCluster(issue, group);
  }
}

interface RelinkConfig {
  dir: string;
  apply: boolean;
  repo: string;
  exec: ExecFn;
  online: boolean;
}

const defaultExec: ExecFn = (file, args) =>
  execFileSync(file, args, { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 }) as string;

function resolveConfig(opts: RelinkOptions): RelinkConfig {
  const exec = opts.exec ?? defaultExec;
  return {
    dir: opts.dir ?? path.join('agent-memory', 'domains'),
    apply: opts.apply ?? false,
    repo: opts.repo ?? DEFAULT_REPO,
    exec,
    online: !opts.offline && ghAvailable(exec),
  };
}

function warnIfOffline(online: boolean): void {
  if (!online) {
    console.warn(
      'WARNING: gh unavailable or --offline — running in filename-token-only mode. ' +
        'gh-authoritative resolution and multi-issue detection are DISABLED; treat results as provisional.'
    );
  }
}

function writeRelink(p: FilePlan, defaultRepo: string): void {
  const src = parseSourcePr(matter(p.content).data.source_pr);
  const repo = src?.repo ?? defaultRepo;
  try {
    fs.writeFileSync(p.file, rewriteFrontmatter(p.content, repo, p.result.to as number), 'utf8');
  } catch (err) {
    p.result.status = 'flagged';
    p.result.reason = `rewrite failed: ${errMessage(err)}`;
  }
}

function applyRelinks(plans: FilePlan[], repo: string): void {
  for (const p of plans) {
    if (p.result.status === 'relinked' && p.result.to !== undefined) writeRelink(p, repo);
  }
}

/**
 * Relink affected drafts in `dir`. Idempotent: a file whose issueNumber already
 * differs from its PR number is left unchanged, so re-runs are no-ops.
 */
export function relinkIssues(opts: RelinkOptions = {}): RelinkResult[] {
  const cfg = resolveConfig(opts);
  warnIfOffline(cfg.online);
  const gh: GhCtx = { online: cfg.online, exec: cfg.exec, cache: new Map() };
  const plans = walkMarkdown(cfg.dir).map(f => planFile(f, gh));
  detectCollisions(plans);
  if (cfg.apply) applyRelinks(plans, cfg.repo);
  return plans.map(p => p.result);
}

/* istanbul ignore next */
function printRelinks(relinked: RelinkResult[]): void {
  for (const r of relinked) {
    const note = [r.source, r.tokenMismatch ? 'TOKEN-MISMATCH' : ''].filter(Boolean).join(' ');
    console.log(`  relink  ${r.from} -> ${r.to}  [${note}]  ${path.basename(r.file)}`);
  }
}

/* istanbul ignore next */
function printFlagged(flagged: RelinkResult[]): void {
  if (!flagged.length) return;
  console.log('\nFLAGGED (manual):');
  for (const r of flagged) console.log(`  ${path.basename(r.file)} (issue ${r.from ?? '?'}): ${r.reason}`);
}

/* istanbul ignore next */
function printCollisions(collisions: RelinkResult[]): void {
  if (!collisions.length) return;
  console.log('\nCOLLISIONS (#135 dedup worklist — confirm each is genuine multi-PR-to-one-issue):');
  for (const r of collisions) {
    console.log(`  ${path.basename(r.file)} -> issue ${r.issue ?? r.to ?? r.from}  also: ${r.collidesWith?.join(', ')}`);
  }
}

/* istanbul ignore next */
function printReport(results: RelinkResult[], apply: boolean): void {
  const relinked = results.filter(r => r.status === 'relinked');
  const flagged = results.filter(r => r.status === 'flagged');
  const collisions = results.filter(r => r.collidesWith?.length);
  const unchangedCount = results.length - relinked.length - flagged.length;
  console.log(`\n${apply ? 'APPLIED' : 'DRY-RUN'} — ${relinked.length} relinked, ${flagged.length} flagged, ${unchangedCount} unchanged\n`);
  printRelinks(relinked);
  printFlagged(flagged);
  printCollisions(collisions);
}

/* istanbul ignore next */
if (require.main === module) {
  const argv = process.argv.slice(2);
  const dirIdx = argv.indexOf('--dir');
  const opts: RelinkOptions = {
    dir: dirIdx >= 0 ? argv[dirIdx + 1] : undefined,
    apply: argv.includes('--apply'),
    offline: argv.includes('--offline'),
  };
  const results = relinkIssues(opts);
  printReport(results, opts.apply ?? false);
  if (opts.apply && results.some(r => r.status === 'flagged')) process.exit(1);
}
