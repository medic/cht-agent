/**
 * claim-probes.ts — deterministic grounding of draft claims against a real
 * cht-core checkout at the commit the draft was distilled from.
 *
 * This is the half of claim grounding that needs no LLM: given a claim of a
 * known shape ("symbol X exists", "symbol X lives in file F", "the PR touched
 * F"), a git probe settles it. Everything here is decided by `git grep`,
 * `git diff-tree` and `git ls-tree` — same input, same verdict, forever — which
 * is why it is factored apart from the extraction step and can later migrate
 * into CI behind a cht-core checkout.
 *
 * Three rules are load-bearing and must not be relaxed:
 *
 * 1. WORD-BOUNDED SEARCH ONLY. Substring `getOidc` returns 8 hits in cht-core —
 *    every one of them a longer identifier (`getOidcUsername`, `getOidcBaseUrl`).
 *    An unanchored grep would have CERTIFIED the exact hallucination a reviewer
 *    caught. `git grep -F -w` returns 0. Probes use -F -w, always.
 *
 * 2. ABSENCE IS ONLY PROVABLE AT A COMMIT. Grepping the working tree proves
 *    nothing about the tree the draft describes, so every probe is scoped to the
 *    anchor sha. A draft whose anchor cannot be resolved is `unverifiable` —
 *    never `grounded`.
 *
 * 3. REVERTS ARE NOT EVIDENCE. cht-core PR #10599 resolves to a commit that
 *    REVERTS the change its draft describes; grounding against it yields a
 *    confidently wrong pass. A revert anchor is `anchor-unusable`.
 */

import { execFileSync } from 'node:child_process';
import type { ExecFn } from './gh-classify';

export type { ExecFn };

/**
 * - `grounded`      the probe confirms the claim against the anchor commit
 * - `ungrounded`    the probe contradicts it — a real defect
 * - `unverifiable`  the probe could not run (anchor unresolvable, e.g. a PR
 *                   newer than the local checkout). Never treat as a pass.
 * - `anchor-unusable` the anchor exists but cannot serve as evidence (a revert)
 */
export type Outcome = 'grounded' | 'ungrounded' | 'unverifiable' | 'anchor-unusable';

/** The cht-core commit a draft's claims are checked against. */
export interface Anchor {
  prNumber?: number;
  sha: string;
  subject: string;
  /** Subject looks like a revert — the anchor cannot evidence the described change. */
  isRevert: boolean;
}

export type Claim =
  /** `symbol` must exist somewhere in the tree. */
  | { kind: 'symbol'; symbol: string; quote: string }
  /** `symbol` must exist AND be findable in `file` — catches misattribution. */
  | { kind: 'symbol-in-file'; symbol: string; file: string; quote: string }
  /** `file` must appear in the PR's own diff, optionally with a given status. */
  | { kind: 'file-touched'; file: string; status?: 'added' | 'modified' | 'deleted'; quote: string }
  /** `file` must exist in the tree at the anchor. */
  | { kind: 'path-exists'; file: string; quote: string }
  /** A claimed backport line must exist and contain the anchor commit. */
  | { kind: 'release-branch'; branch: string; quote: string };

/**
 * Which tree the verdict was proven against.
 * - `anchor`   the draft's own commit — the claim is settled
 * - `fallback` a tree-wide ref (default origin/master) because the anchor would
 *              not resolve. Absence here still refutes a fabricated symbol, but
 *              cannot distinguish "never existed" from "existed and was removed
 *              after this PR", so it is evidence, not proof.
 */
export type Provenance = 'anchor' | 'fallback';

export interface Verdict {
  claim: Claim;
  outcome: Outcome;
  /** The probe actually run and what it returned — the audit trail. */
  evidence: string;
  /** Where the real thing lives, when the probe can say. */
  suggestion?: string;
  provenance?: Provenance;
}

export interface ProbeCtx {
  chtCorePath: string;
  exec: ExecFn;
  /**
   * Ref used when a draft's anchor cannot be resolved. cht-core does not stamp
   * every PR number into its subject (the SSO cluster is merged without one),
   * so without this a large slice of the corpus would be unverifiable even
   * though the code is sitting in the checkout.
   */
  fallbackRef?: string;
}

export const DEFAULT_FALLBACK_REF = 'origin/master';

export const defaultExec: ExecFn = (file, args) =>
  execFileSync(file, args, {
    encoding: 'utf8',
    maxBuffer: 100 * 1024 * 1024,
    // Capture stderr instead of inheriting it: probing deliberately asks git
    // about objects that may not exist, and those "fatal: Not a valid object
    // name" lines are expected control flow, not output for the operator.
    stdio: ['ignore', 'pipe', 'pipe'],
  }) as string;

/** Abbreviate a sha for display; leave symbolic refs (origin/master) intact. */
const refLabel = (ref: string): string => (/^[0-9a-f]{40}$/.test(ref) ? ref.slice(0, 10) : ref);

/** git in the cht-core checkout. Exit 1 (no matches) yields ''; other failures throw. */
function git(ctx: ProbeCtx, args: string[]): string {
  try {
    return ctx.exec('git', ['-C', ctx.chtCorePath, ...args]);
  } catch (err) {
    if ((err as { status?: unknown }).status === 1) return '';
    throw err;
  }
}

/** True when the commit object exists locally. */
function commitExists(ctx: ProbeCtx, sha: string): boolean {
  try {
    ctx.exec('git', ['-C', ctx.chtCorePath, 'cat-file', '-e', `${sha}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

const subjectOf = (ctx: ProbeCtx, sha: string): string =>
  git(ctx, ['log', '-1', '--format=%s', sha]).trim();

const isRevertSubject = (subject: string): boolean => /^revert[\s"']/i.test(subject.trim());

/**
 * Resolve the cht-core commit for a draft. `source_sha` is used when it resolves
 * locally; otherwise the PR number is found via the squash-merge subject, which
 * cht-core stamps as `... (#NNNNN)` — this is why grounding works without
 * `refs/pull/*` fetched.
 *
 * Returns null when neither resolves (typically a PR newer than the checkout),
 * which callers must render as `unverifiable`.
 */
export function resolveAnchor(
  ctx: ProbeCtx,
  opts: { prNumber?: number; sourceSha?: string }
): Anchor | null {
  if (opts.sourceSha && commitExists(ctx, opts.sourceSha)) {
    const subject = subjectOf(ctx, opts.sourceSha);
    return { prNumber: opts.prNumber, sha: opts.sourceSha, subject, isRevert: isRevertSubject(subject) };
  }
  if (opts.prNumber === undefined) return null;

  const raw = git(ctx, [
    'log', '--all', '-1', '--fixed-strings', `--grep=(#${opts.prNumber})`, '--format=%H%x00%s',
  ]).trim();
  if (!raw) return null;
  const [sha, subject = ''] = raw.split('\0');
  return { prNumber: opts.prNumber, sha, subject, isRevert: isRevertSubject(subject) };
}

// ---------------------------------------------------------------------------
// Probes
// ---------------------------------------------------------------------------

/**
 * Word-bounded, fixed-string search at a commit, optionally scoped to a path.
 * `-F -w` is what separates a real symbol from a hallucination that happens to
 * be a prefix of one.
 */
export function symbolHits(ctx: ProbeCtx, sha: string, symbol: string, pathspec?: string): string[] {
  const scope = pathspec ? ['--', pathspec] : [];
  const search = (needle: string): string[] =>
    git(ctx, ['grep', '-n', '-F', '-w', needle, sha, ...scope])
      .split('\n').map(l => l.trim()).filter(Boolean);

  const hits = search(symbol);
  if (hits.length > 0 || !symbol.includes('.')) return hits;
  // A dotted member reference is often written with optional chaining in the
  // source (`res?.resources`) while prose and claim extraction normalise it to
  // `res.resources`. Retrying the optional-chained spelling avoids reporting a
  // real member access as fabricated.
  return search(symbol.replace(/\./g, '?.'));
}

/** Paths the commit itself changed, mapped to their git status letter. */
export function changedPaths(ctx: ProbeCtx, sha: string): Map<string, string> {
  const raw = git(ctx, ['diff-tree', '--no-commit-id', '--name-status', '-r', sha]);
  const out = new Map<string, string>();
  for (const line of raw.split('\n')) {
    const [status, ...rest] = line.trim().split('\t');
    if (status && rest.length) out.set(rest[rest.length - 1], status[0]);
  }
  return out;
}

/** True when the path exists in the tree at `sha`. */
export function pathExistsAt(ctx: ProbeCtx, sha: string, file: string): boolean {
  return git(ctx, ['ls-tree', '--name-only', sha, '--', file]).trim().length > 0;
}

/** Remote branches containing the commit — settles backport-line claims. */
export function branchesContaining(ctx: ProbeCtx, sha: string): string[] {
  const raw = git(ctx, ['branch', '-r', '--contains', sha, '--format=%(refname:short)']);
  return raw.split('\n').map(l => l.trim()).filter(Boolean);
}

const STATUS_WORD: Record<string, 'added' | 'modified' | 'deleted' | 'renamed'> = {
  A: 'added', M: 'modified', D: 'deleted', R: 'renamed',
};

// ---------------------------------------------------------------------------
// Claim adjudication
// ---------------------------------------------------------------------------

const verdict = (
  claim: Claim, outcome: Outcome, evidence: string, suggestion?: string, provenance?: Provenance
): Verdict => ({ claim, outcome, evidence, suggestion, provenance });

/**
 * Absence proves a fabrication only at the draft's OWN commit. Under `fallback`
 * we are searching a tree that predates the change, so a symbol the PR itself
 * introduced is legitimately missing — reporting that as a defect manufactures
 * false positives on every draft whose PR postdates the checkout. Absence under
 * fallback is therefore `unverifiable`; presence still grounds the claim.
 */
function absenceOutcome(prov: Provenance): Outcome {
  return prov === 'anchor' ? 'ungrounded' : 'unverifiable';
}

function checkSymbol(ctx: ProbeCtx, ref: string, claim: Claim & { kind: 'symbol' }, prov: Provenance): Verdict {
  const hits = symbolHits(ctx, ref, claim.symbol);
  const cmd = `git grep -nFw ${claim.symbol} ${refLabel(ref)}`;
  if (hits.length > 0) {
    return verdict(claim, 'grounded', `${cmd} → ${hits.length} hit(s), e.g. ${hits[0]}`, undefined, prov);
  }
  const note = prov === 'fallback'
    ? ' — but the anchor is unresolved, so this tree predates the change and the PR may have introduced it; fetch cht-core to settle'
    : '';
  return verdict(claim, absenceOutcome(prov), `${cmd} → 0 hits: the symbol does not exist in this tree${note}`,
    undefined, prov);
}

/**
 * Misattribution check. A symbol that exists but not in the named file is the
 * `updateServiceWorker` defect: real export, wrong provenance — and exactly what
 * a bare existence check waves through.
 */
function checkSymbolInFile(
  ctx: ProbeCtx, ref: string, claim: Claim & { kind: 'symbol-in-file' }, prov: Provenance
): Verdict {
  const scoped = symbolHits(ctx, ref, claim.symbol, claim.file);
  const cmd = `git grep -nFw ${claim.symbol} ${refLabel(ref)} -- ${claim.file}`;
  if (scoped.length > 0) return verdict(claim, 'grounded', `${cmd} → ${scoped.length} hit(s)`, undefined, prov);

  const global = symbolHits(ctx, ref, claim.symbol);
  if (global.length === 0) {
    // Absent everywhere: under fallback this may simply be code the PR added.
    const note = prov === 'fallback' ? ' (tree predates the change — fetch cht-core to settle)' : '';
    return verdict(claim, absenceOutcome(prov),
      `${cmd} → 0 hits, and 0 anywhere in the tree: the symbol does not exist${note}`, undefined, prov);
  }
  // The symbol exists, just not in the named file. At the anchor that is
  // misattribution. Under fallback it is only a hint: we cannot tell a wrong
  // attribution from a symbol the PR itself added to that file, and a common
  // word ("weight") matches somewhere in any large tree — so report it for a
  // human rather than asserting a defect.
  const elsewhere = [...new Set(global.map(h => h.split(':')[1] ?? h))].slice(0, 3);
  const where = `found in ${elsewhere.join(', ')}`;
  if (prov === 'fallback') {
    return verdict(claim, 'unverifiable',
      `${cmd} → 0 hits, but ${global.length} elsewhere in a tree that predates the change; ` +
        'cannot distinguish misattribution from code this PR added — fetch cht-core to settle',
      where, prov);
  }
  return verdict(claim, 'ungrounded',
    `${cmd} → 0 hits, but ${global.length} elsewhere: attributed to the wrong file`, where, prov);
}

function checkFileTouched(ctx: ProbeCtx, a: Anchor, claim: Claim & { kind: 'file-touched' }): Verdict {
  const changed = changedPaths(ctx, a.sha);
  const cmd = `git diff-tree --name-status -r ${refLabel(a.sha)}`;
  const status = changed.get(claim.file);
  if (status === undefined) {
    return verdict(claim, 'ungrounded', `${cmd} → ${claim.file} is not in this PR's diff (${changed.size} files changed)`);
  }
  const word = STATUS_WORD[status] ?? status;
  if (claim.status && claim.status !== word) {
    return verdict(claim, 'ungrounded',
      `${cmd} → ${claim.file} was ${word}, not ${claim.status}`,
      `the draft describes it as ${claim.status}`);
  }
  return verdict(claim, 'grounded', `${cmd} → ${claim.file} ${word}`);
}

function checkPathExists(
  ctx: ProbeCtx, ref: string, claim: Claim & { kind: 'path-exists' }, prov: Provenance
): Verdict {
  const cmd = `git ls-tree ${refLabel(ref)} -- ${claim.file}`;
  return pathExistsAt(ctx, ref, claim.file)
    ? verdict(claim, 'grounded', `${cmd} → present`, undefined, prov)
    : verdict(claim, 'ungrounded', `${cmd} → no such path in this tree`, undefined, prov);
}

function checkReleaseBranch(ctx: ProbeCtx, a: Anchor, claim: Claim & { kind: 'release-branch' }): Verdict {
  const containing = branchesContaining(ctx, a.sha);
  const cmd = `git branch -r --contains ${refLabel(a.sha)}`;
  const match = containing.find(b => b === `origin/${claim.branch}` || b.endsWith(`/${claim.branch}`));
  if (match) return verdict(claim, 'grounded', `${cmd} → includes ${match}`);
  const releaseLines = containing.filter(b => /\d+\.\d+\.x$/.test(b));
  return verdict(claim, 'ungrounded',
    `${cmd} → does not include ${claim.branch}`,
    releaseLines.length ? `present on ${releaseLines.join(', ')}` : undefined);
}

/** Claim kinds that read a tree and so can fall back to a tree-wide ref. */
const TREE_SCOPED = new Set<Claim['kind']>(['symbol', 'symbol-in-file', 'path-exists']);

/** Dispatch a tree-scoped claim at `ref`. */
function checkAtRef(ctx: ProbeCtx, ref: string, claim: Claim, prov: Provenance): Verdict {
  switch (claim.kind) {
    case 'symbol': return checkSymbol(ctx, ref, claim, prov);
    case 'symbol-in-file': return checkSymbolInFile(ctx, ref, claim, prov);
    case 'path-exists': return checkPathExists(ctx, ref, claim, prov);
    default: throw new Error(`checkAtRef called with non-tree-scoped claim: ${claim.kind}`);
  }
}

/**
 * Ground one claim.
 *
 * Anchor problems never masquerade as a pass. A revert anchor is
 * `anchor-unusable` outright. An unresolved anchor falls back to a tree-wide ref
 * for claims that only read a tree — absence there still refutes a fabricated
 * symbol, flagged `provenance: 'fallback'` so the weaker evidence is visible —
 * and stays `unverifiable` for claims that need the commit itself (what the PR
 * changed, which release lines carry it).
 */
export function checkClaim(ctx: ProbeCtx, anchor: Anchor | null, claim: Claim): Verdict {
  if (anchor?.isRevert) {
    return verdict(claim, 'anchor-unusable',
      `anchor ${anchor.sha.slice(0, 10)} is a revert ("${anchor.subject}") — it cannot evidence the described change`);
  }

  if (!anchor) {
    if (!TREE_SCOPED.has(claim.kind)) {
      return verdict(claim, 'unverifiable',
        `anchor commit unresolved, and a ${claim.kind} claim can only be settled at the commit itself — fetch cht-core`);
    }
    const ref = ctx.fallbackRef ?? DEFAULT_FALLBACK_REF;
    if (!commitExists(ctx, ref)) {
      return verdict(claim, 'unverifiable', `anchor unresolved and fallback ref ${ref} is missing from this checkout`);
    }
    return checkAtRef(ctx, ref, claim, 'fallback');
  }

  if (TREE_SCOPED.has(claim.kind)) return checkAtRef(ctx, anchor.sha, claim, 'anchor');
  return claim.kind === 'file-touched'
    ? checkFileTouched(ctx, anchor, claim)
    : checkReleaseBranch(ctx, anchor, claim as Claim & { kind: 'release-branch' });
}
