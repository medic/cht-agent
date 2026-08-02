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
 *
 * One carve-out: anchor RESOLUTION may consult the GitHub API (see
 * `resolveViaApi`) when the clone alone cannot name the commit. Resolution only
 * picks WHICH local commit to probe — adjudication itself never leaves git, and
 * a sha the clone does not have is never anchored to.
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
  /** How a not-locally-derivable anchor was located — the report's audit trail. */
  note?: string;
  /** owner/repo, set when the anchor came from the API — lets probes ask it more. */
  repo?: string;
  /** True when `sha` is an epic squash standing in for this PR's own commit. */
  viaEpic?: boolean;
}

/**
 * Set on a claim drawn from a Problem / Root Cause section, which describes the
 * tree the PR CHANGED. Such a claim is checked at the anchor's parent when it
 * fails at the anchor itself — otherwise every accurate description of a bug the
 * fix removed reads as a fabrication.
 */
export type ClaimScope = 'pre-fix';

export type Claim =
  /** `symbol` must exist somewhere in the tree. */
  | { kind: 'symbol'; symbol: string; quote: string; scope?: ClaimScope }
  /** `symbol` must exist AND be findable in `file` — catches misattribution. */
  | { kind: 'symbol-in-file'; symbol: string; file: string; quote: string; scope?: ClaimScope }
  /** `file` must appear in the PR's own diff, optionally with a given status. */
  | { kind: 'file-touched'; file: string; status?: 'added' | 'modified' | 'deleted'; quote: string }
  /** `file` must exist in the tree at the anchor. */
  | { kind: 'path-exists'; file: string; quote: string; scope?: ClaimScope }
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

/**
 * A claim that is TRUE at its anchor but names something the current tree no
 * longer has, stated without any temporal qualifier. Not a defect in what the
 * draft says about its own PR — a defect in how a reader will read it, since an
 * agent consuming the memory takes an unqualified path or symbol as current.
 */
export interface Drift {
  /** The path or symbol that is gone from the current tree. */
  entity: string;
  /** The commit that removed it, when git can say — the fix's citation. */
  removedBy?: string;
  note: string;
}

export interface Verdict {
  claim: Claim;
  outcome: Outcome;
  /** The probe actually run and what it returned — the audit trail. */
  evidence: string;
  /** Where the real thing lives, when the probe can say. */
  suggestion?: string;
  provenance?: Provenance;
  /** Grounded at the anchor, but stale as written against the current tree. */
  drift?: Drift;
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
  /**
   * Let resolveAnchor consult the GitHub API (gh, then anonymous curl) when the
   * clone alone cannot locate a draft's commit. Resolution only — every verdict
   * is still a git probe against a commit the clone has. Defaults to true;
   * transport failures degrade to an unresolved anchor, never to a defect or a
   * crash. Set false for a fully offline run.
   */
  apiResolve?: boolean;
  /** Per-run cache of PR file lists, so an epic's children cost one call each. */
  prFiles?: Map<string, Map<string, string> | null>;
  /** Per-run cache of `ls-tree -r` output, keyed by ref — ~10k paths per entry. */
  treeCache?: Map<string, string[]>;
  /**
   * GitHub responses keyed by API path. Anonymous access allows 60 requests an
   * hour and one sweep of three branches spends most of that on anchor
   * resolution and PR file lists, so a second sweep in the same hour returned
   * inflated `unverifiable` counts. Persisted across runs by ground-claims,
   * which makes re-gating after a fix nearly free — the thing this workflow
   * does constantly.
   */
  apiCache?: Map<string, unknown>;
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
 * `refs/pull/*` fetched. When both clone-local strategies fail and `repo` is
 * known, the GitHub API is asked which local commit carries the PR (see
 * `resolveViaApi`).
 *
 * Returns null when nothing resolves (typically a PR newer than the checkout),
 * which callers must render as `unverifiable`.
 */
export function resolveAnchor(
  ctx: ProbeCtx,
  opts: { prNumber?: number; sourceSha?: string; repo?: string }
): Anchor | null {
  if (opts.sourceSha && commitExists(ctx, opts.sourceSha)) {
    const subject = subjectOf(ctx, opts.sourceSha);
    return { prNumber: opts.prNumber, sha: opts.sourceSha, subject, isRevert: isRevertSubject(subject) };
  }
  if (opts.prNumber === undefined) return null;

  const raw = git(ctx, [
    'log', '--all', '-1', '--fixed-strings', `--grep=(#${opts.prNumber})`, '--format=%H%x00%s',
  ]).trim();
  if (raw) {
    const [sha, subject = ''] = raw.split('\0');
    return { prNumber: opts.prNumber, sha, subject, isRevert: isRevertSubject(subject) };
  }

  if ((ctx.apiResolve ?? true) && opts.repo) return resolveViaApi(ctx, opts.repo, opts.prNumber);
  return null;
}

// ---------------------------------------------------------------------------
// GitHub-API anchor resolution
//
// A PR merged into a FEATURE branch that later squash-merged onto master (the
// ui-extensions epic, PR #130's drafts 11057/11021) leaves no trace a clone can
// see: its merge commit lives only on the deleted branch, and no squash subject
// carries its number — so both local strategies fail and nine TRUE claims
// degraded to `unverifiable`. The API knows the missing link: the child's base
// branch names the epic, and the epic's own squash IS in the clone. Resolution
// only — a sha the clone does not have is never anchored to, so verdicts remain
// reproducible from the clone plus the resolved sha.
//
// Grounding against an epic squash carries the same over-approximation the
// sibling-diff union already accepts: `file-touched` sees the union of every
// child's changes, and statuses reflect the landed state rather than the child
// PR's own diff. The anchor's `note` makes that provenance visible in reports.
// ---------------------------------------------------------------------------

/** Minimal slice of the pulls endpoints the resolver reads. */
interface PrRecord {
  number?: number;
  /** Single-PR endpoint only; the list endpoint exposes `merged_at` instead. */
  merged?: boolean;
  merged_at?: string | null;
  merge_commit_sha?: string | null;
  base?: { ref?: string };
}

/**
 * GET a GitHub API path as parsed JSON — `gh` first (authenticated, higher rate
 * limit), anonymous `curl` second. Null on ANY failure: gh missing, HTTP error,
 * rate limit, malformed JSON. Resolution must degrade to an unresolved anchor,
 * never throw mid-run.
 */
function githubApi(ctx: ProbeCtx, apiPath: string): unknown {
  const cached = ctx.apiCache?.get(apiPath);
  if (cached !== undefined) return cached;
  const transports: Array<[string, string[]]> = [
    ['gh', ['api', apiPath]],
    ['curl', ['-sf', '--max-time', '15', `https://api.github.com/${apiPath}`]],
  ];
  for (const [file, args] of transports) {
    try {
      const parsed: unknown = JSON.parse(ctx.exec(file, args));
      ctx.apiCache?.set(apiPath, parsed);
      return parsed;
    } catch {
      // Try the next transport; callers treat null as "could not resolve".
    }
  }
  // Deliberately NOT cached: a null here is usually the 60/hour budget running
  // out, and persisting that would bake a transient failure into every later
  // run as though the PR did not exist.
  return null;
}

/** Anchor at `sha` only if the clone has it — never anchor to a sha we cannot probe. */
function anchorAt(ctx: ProbeCtx, sha: string, prNumber: number, note: string): Anchor | null {
  if (!commitExists(ctx, sha)) return null;
  const subject = subjectOf(ctx, sha);
  return { prNumber, sha, subject, isRevert: isRevertSubject(subject), note };
}

function resolveViaApi(ctx: ProbeCtx, repo: string, prNumber: number): Anchor | null {
  const pr = githubApi(ctx, `repos/${repo}/pulls/${prNumber}`) as PrRecord | null;
  if (!pr || pr.merged !== true) return null; // unmerged or unknown stays unverifiable

  // Merged, and the merge commit is sitting in the clone — the squash subject
  // just carries no "(#N)" stamp (cht-core's SSO cluster merges without one).
  if (pr.merge_commit_sha) {
    const direct = anchorAt(ctx, pr.merge_commit_sha, prNumber,
      `resolved via GitHub API: merge commit of ${repo}#${prNumber}`);
    if (direct) return direct;
  }

  // Epic child: its merge commit lives on a deleted feature branch. The PR that
  // carried that branch onward has OUR base as ITS head, and that PR's squash is
  // what the clone can see. One hop only — an epic nested inside another epic
  // stays unresolved rather than chasing the graph.
  const base = pr.base?.ref;
  if (!base) return null;
  const owner = repo.split('/')[0];
  const carriers = githubApi(ctx, `repos/${repo}/pulls?state=closed&head=${owner}:${base}`);
  if (!Array.isArray(carriers)) return null;
  for (const c of carriers as PrRecord[]) {
    if (!c.merged_at || !c.merge_commit_sha) continue;
    const viaEpic = anchorAt(ctx, c.merge_commit_sha, prNumber,
      `resolved via GitHub API: ${repo}#${prNumber} merged into ${base}; anchored at the squash of #${c.number}`);
    if (viaEpic) return { ...viaEpic, repo, viaEpic: true };
  }
  return null;
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
  // Prose attributes a symbol to a file by its bare name ("`handleIntervalTurnover`
  // in provider-wireup.js"), which no pathspec resolves. Expand it to the real
  // path first, or the symbol reads as misattributed to a file that has no hits
  // simply because git was handed a name it could not find.
  let scoped = pathspec;
  if (scoped && !scoped.includes('/')) {
    const [resolved] = basenameMatches(ctx, sha, scoped);
    if (resolved) scoped = resolved;
  }
  const scope = scoped ? ['--', scoped] : [];
  const search = (needle: string): string[] =>
    git(ctx, ['grep', '-n', '-F', '-w', needle, sha, ...scope])
      .split('\n').map(l => l.trim()).filter(Boolean);

  const hits = search(symbol);
  if (hits.length > 0 || !symbol.includes('.')) return hits;

  // A dotted member reference is often written with optional chaining in the
  // source while prose normalises it away — and the `?` may sit on ANY subset of
  // the dots (`doc.fields?.patient_id`). Retry once with a regex that makes the
  // `?` optional at every position, rather than guessing one spelling.
  const pattern = symbol
    .split('.')
    .map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('\\??\\.');
  return git(ctx, ['grep', '-n', '-E', '-w', pattern, sha, ...scope])
    .split('\n').map(l => l.trim()).filter(Boolean);
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
  if (git(ctx, ['ls-tree', '--name-only', sha, '--', file]).trim().length > 0) return true;
  return basenameMatches(ctx, sha, file).length > 0;
}

/**
 * Prose names files by basename constantly — "Updated unit tests across the
 * rules engine (integration.spec.js, pouchdb-provider.spec.js)". Those are real
 * files, but an exact-path probe cannot see them and reporting them as
 * fabricated would be flatly wrong. Resolve a bare name against the tree.
 *
 * Returns [] for anything already containing a slash, so a wrong directory is
 * still a defect rather than being rescued by its basename.
 */
export function basenameMatches(ctx: ProbeCtx, sha: string, file: string): string[] {
  if (file.includes('/')) return [];
  // A `*/name` pathspec silently matches NOTHING in ls-tree — it returned empty
  // for a file a plain scan finds — so list the tree once per ref and filter
  // here. Cached because the tree is ~10k paths and every draft asks repeatedly.
  let all = ctx.treeCache?.get(sha);
  if (!all) {
    all = git(ctx, ['ls-tree', '-r', '--name-only', sha]).split('\n').map(l => l.trim()).filter(Boolean);
    ctx.treeCache?.set(sha, all);
  }
  return all.filter(p => p === file || p.endsWith(`/${file}`));
}

/** Full blob at `ref:file`, or null when the path is absent there. */
function fileAt(ctx: ProbeCtx, ref: string, file: string): string | null {
  try {
    return ctx.exec('git', ['-C', ctx.chtCorePath, 'show', `${ref}:${file}`]);
  } catch {
    return null;
  }
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * `request.post` spelled as `request\n  .post({` is invisible to line-oriented
 * git grep, so a TRUE member-chain claim reads as a misattribution (found on
 * the 10073 draft — the call is wrapped at api/src/services/africas-talking.js:80-81).
 * Re-check a dotted symbol against the file blob with whitespace tolerated
 * around the dots, plus the same optional `?.` the -E retry allows. Word-ish
 * boundaries on both ends keep this as strict as rule 1's -F -w probes.
 */
function wrappedMemberHit(ctx: ProbeCtx, ref: string, symbol: string, file: string): string | null {
  const blob = fileAt(ctx, ref, file);
  if (blob === null) return null;
  const pattern = symbol.split('.').map(escapeRe).join('\\s*\\??\\.\\s*');
  const re = new RegExp(`(?:^|[^\\w$])(${pattern})(?![\\w$])`);
  const m = re.exec(blob);
  if (!m) return null;
  const line = blob.slice(0, m.index).split('\n').length;
  return `${file}:${line} (whitespace-tolerant match)`;
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

/**
 * A dotted token that prose writes whole but code never spells that way: an app
 * settings key reached as `config.get('sms')?.clear_failing_schedules`, an
 * export a caller sees as `smsparser.parse` but the file declares as
 * `exports.parse`, a method written `RulesEngineService.fetchTargets` and
 * defined as a bare `fetchTargets`. Every one of these was hand-adjudicated as
 * a false positive during review; resolving the last segment turns the whole
 * class into a grounded verdict that says how it was reached.
 */
function lastSegmentHit(ctx: ProbeCtx, ref: string, symbol: string, pathspec?: string): string | null {
  if (!symbol.includes('.')) return null;
  const tail = symbol.split('.').filter(Boolean).pop();
  if (!tail || tail.length < 3) return null;
  const hits = symbolHits(ctx, ref, tail, pathspec);
  return hits.length ? `${tail} at ${hits[0]}` : null;
}

function checkSymbol(ctx: ProbeCtx, ref: string, claim: Claim & { kind: 'symbol' }, prov: Provenance): Verdict {
  const hits = symbolHits(ctx, ref, claim.symbol);
  const cmd = `git grep -nFw ${claim.symbol} ${refLabel(ref)}`;
  if (hits.length > 0) {
    return verdict(claim, 'grounded', `${cmd} → ${hits.length} hit(s), e.g. ${hits[0]}`, undefined, prov);
  }
  const tail = lastSegmentHit(ctx, ref, claim.symbol);
  if (tail) {
    return verdict(claim, 'grounded',
      `${cmd} → 0 hits for the dotted form, but its final segment resolves: ${tail}. ` +
        'Prose writes the qualified name; the code reaches it through an accessor, import or receiver.',
      undefined, prov);
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

  if (claim.symbol.includes('.')) {
    const wrapped = wrappedMemberHit(ctx, ref, claim.symbol, claim.file);
    if (wrapped) {
      return verdict(claim, 'grounded',
        `${cmd} → 0 hits line-oriented, but the member chain matches across lines at ${wrapped}`, undefined, prov);
    }
  }

  const tailInFile = lastSegmentHit(ctx, ref, claim.symbol, claim.file);
  if (tailInFile) {
    return verdict(claim, 'grounded',
      `${cmd} → 0 hits for the dotted form, but its final segment resolves in this file: ${tailInFile}`,
      undefined, prov);
  }

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

/**
 * Files the PR itself changed, from the API. Only meaningful for an epic child:
 * its own merge commit is unreachable in a clone, so the anchor is the epic's
 * squash — whose diff is a DIFFERENT set. The squash contains every sibling's
 * work and, where the epic renamed things before landing, may not contain the
 * child's files under the names the draft (correctly) records.
 *
 * Without this, an accurate Related Files list on an epic child reads as 27
 * fabricated paths. Cached per PR; any transport failure returns null and the
 * caller falls back to the squash diff.
 */
function prFileList(ctx: ProbeCtx, repo: string, prNumber: number): Map<string, string> | null {
  const cacheKey = `${repo}#${prNumber}`;
  const cached = ctx.prFiles?.get(cacheKey);
  if (cached !== undefined) return cached;
  const raw = githubApi(ctx, `repos/${repo}/pulls/${prNumber}/files?per_page=100`);
  let out: Map<string, string> | null = null;
  if (Array.isArray(raw)) {
    out = new Map();
    for (const f of raw as Array<{ filename?: string; status?: string }>) {
      if (f.filename) out.set(f.filename, (f.status ?? 'modified')[0].toUpperCase());
    }
  }
  ctx.prFiles?.set(cacheKey, out);
  return out;
}

/** Verbs that make a sentence a claim about a CHANGE rather than about existence. */
// "change" is excluded on purpose: it is overwhelmingly a NOUN in this corpus
// ("the `api/src/` layout postdates this change"), and including it blocked the
// existence rescue on exactly the sentence that rescue exists for. Every other
// entry here is unambiguously verbal.
const CHANGE_VERB =
  /\b(?:add(?:s|ed)?|creat(?:e|es|ed)|modif(?:y|ies|ied)|updat(?:e|es|ed)|edit(?:s|ed)?|remov(?:e|es|ed)|delet(?:e|es|ed)|renam(?:e|es|ed)|touch(?:es|ed)?|introduc(?:e|es|ed)|extend(?:s|ed)?|rewr(?:ite|ites|ote)|refactor(?:s|ed)?)\b/i;

/**
 * Is the sentence claiming the PR CHANGED this file, or merely mentioning it?
 * Scanning the whole quote is too coarse: 4278's Root Cause names the endpoint
 * and then, 200 characters later, says the lack of tests made it "risky to
 * modify or extend" — a statement about risk, not about what the PR did, yet
 * enough to block the existence rescue. Only a verb NEAR the file mention
 * counts.
 */
function changeVerbNearFile(quote: string, file: string): boolean {
  const base = file.split('/').pop() ?? file;
  const at = quote.indexOf(file) >= 0 ? quote.indexOf(file) : quote.indexOf(base);
  if (at < 0) return CHANGE_VERB.test(quote);          // cannot locate it — be strict
  const WINDOW = 70;
  return CHANGE_VERB.test(quote.slice(Math.max(0, at - WINDOW), at + base.length + WINDOW));
}

function checkFileTouched(
  ctx: ProbeCtx, a: Anchor, claim: Claim & { kind: 'file-touched' },
  siblings: Anchor[] = [], clusterPrs: Array<{ repo: string; prNumber: number }> = []
): Verdict {
  // A draft that collapsed a duplicate cluster covers several commits, and its
  // Related Files legitimately spans all of them. Checking only the canonical
  // source_sha reports the sibling PRs' files as untouched.
  // Build the full set of paths this draft's PR(s) touched. Three sources, and
  // a draft can need all three at once: 9232 is a collapsed cluster (three PRs)
  // whose canonical PR is ALSO an epic child, so its Related Files span sibling
  // PRs while its anchor is the epic squash of a different PR entirely.
  const changed = new Map<string, string>();
  const sources: string[] = [];
  const absorb = (m: Map<string, string>): void => {
    for (const [f, s] of m) if (!changed.has(f)) changed.set(f, s);
  };

  // 1. an epic child's OWN file list, which the squash cannot supply — plus
  //    every PR in a collapsed cluster, since a sibling whose merge commit is
  //    unreachable resolves to no anchor at all and would otherwise be lost.
  //    9553's Related Files span four PRs; only one sibling resolved locally.
  let usedApi = false;
  const asked = new Set<string>();
  const wanted: Array<{ repo: string; prNumber: number }> = [
    ...[a, ...siblings]
      .filter(x => x.viaEpic && x.repo && x.prNumber !== undefined)
      .map(x => ({ repo: x.repo as string, prNumber: x.prNumber as number })),
    ...clusterPrs,
  ];
  for (const { repo, prNumber } of wanted) {
    const key = `${repo}#${prNumber}`;
    if (asked.has(key)) continue;
    asked.add(key);
    const own = prFileList(ctx, repo, prNumber);
    if (own) { absorb(own); usedApi = true; sources.push(`${key} files`); }
  }
  // 2. the anchor commit's diff, and 3. each sibling commit's diff
  absorb(changedPaths(ctx, a.sha));
  sources.push(`diff ${refLabel(a.sha)}`);
  for (const sib of siblings) {
    absorb(changedPaths(ctx, sib.sha));
    sources.push(`diff ${refLabel(sib.sha)}`);
  }
  const describeScope = (): string => {
    if (usedApi) return ` [${sources.join(' + ')}]`;
    return siblings.length ? ` (+${siblings.length} sibling commit(s))` : '';
  };
  const cmd = `git diff-tree --name-status -r ${refLabel(a.sha)}${describeScope()}`;
  let status = changed.get(claim.file);

  // Prose names files by basename ("integration.spec.js") and sub-packages name
  // them relative to their own root ("test/qualifier.spec.ts" inside
  // shared-libs/cht-datasource). Both are proper suffixes of the real path, so a
  // suffix match resolves them — while a WRONG directory (components/ where the
  // tree has modules/) is not a suffix and stays a defect.
  if (status === undefined) {
    const hits = [...changed.keys()].filter(p => p.endsWith(`/${claim.file}`) || p === claim.file);
    if (hits.length) {
      const word = STATUS_WORD[changed.get(hits[0]) as string] ?? changed.get(hits[0]);
      if (claim.status && claim.status !== word) {
        return verdict(claim, 'ungrounded', `${cmd} → ${hits[0]} was ${word}, not ${claim.status}`,
          `the draft describes it as ${claim.status}`);
      }
      return verdict(claim, 'grounded',
        `${cmd} → named by basename; resolves to ${hits[0]} (${word})`);
    }
  }
  // A sentence with no change verb is describing what a file WAS, not what the
  // PR did to it — 4278's "was not untested: api/tests/unit/... covered it"
  // names the endpoint under test. If such a path exists at the anchor, the
  // draft is right and the claim kind was simply mis-inferred.
  if (status === undefined && !changeVerbNearFile(claim.quote, claim.file) && !claim.status
      && pathExistsAt(ctx, a.sha, claim.file)) {
    return verdict(claim, 'grounded',
      `${claim.file} is not in this PR's diff, but the sentence names it without any change verb ` +
        `and it exists at ${refLabel(a.sha)} — read as an existence claim, not a modification`);
  }
  if (status === undefined) {
    return verdict(claim, 'ungrounded', `${cmd} → ${claim.file} is not in this PR's diff (${changed.size} files changed)`);
  }
  status = status as string;
  const word = STATUS_WORD[status] ?? status;
  if (claim.status && claim.status !== word) {
    return verdict(claim, 'ungrounded',
      `${cmd} → ${claim.file} was ${word}, not ${claim.status}`,
      `the draft describes it as ${claim.status}`);
  }
  return verdict(claim, 'grounded', `${cmd} → ${claim.file} ${word}`);
}

function checkPathExists(
  ctx: ProbeCtx, ref: string, claim: Claim & { kind: 'path-exists' }, prov: Provenance,
  anchor?: Anchor | null
): Verdict {
  const cmd = `git ls-tree ${refLabel(ref)} -- ${claim.file}`;
  if (pathExistsAt(ctx, ref, claim.file)) {
    return verdict(claim, 'grounded', `${cmd} → present`, undefined, prov);
  }
  // An epic child's new files are absent from the squash tree when the epic
  // renamed them before landing, yet the PR demonstrably created them.
  if (anchor?.viaEpic && anchor.repo && anchor.prNumber !== undefined) {
    const own = prFileList(ctx, anchor.repo, anchor.prNumber);
    const hit = own && [...own.keys()].find(p => p === claim.file || p.endsWith(`/${claim.file}`));
    if (hit) {
      return verdict(claim, 'grounded',
        `absent from the epic squash ${refLabel(ref)}, but ${anchor.repo}#${anchor.prNumber} ` +
          `itself ${STATUS_WORD[own.get(hit) as string] ?? 'touched'} ${hit}`, undefined, prov);
    }
  }
  // Absence at the fallback ref proves nothing about the tree the draft
  // describes: layouts move (api/ → api/src/, protractor → wdio), so a path
  // that is real at the draft's own commit is legitimately gone from master.
  // Three TRUE 2018-era path claims were reported as defects this way.
  const note = prov === 'fallback'
    ? ' — but the anchor is unresolved and paths move across layout changes; resolve the anchor to settle'
    : '';
  return verdict(claim, absenceOutcome(prov), `${cmd} → no such path in this tree${note}`, undefined, prov);
}

/**
 * A backport is almost always a CHERRY-PICK, so it is a different commit and
 * `--contains <anchor>` can never see it. Falling back to searching the release
 * branches for a commit that references the same PR is what makes a true
 * backport claim verifiable instead of a false defect.
 */
function findCherryPick(ctx: ProbeCtx, prNumber: number | undefined): string[] {
  if (prNumber === undefined) return [];
  const raw = git(ctx, [
    'log', '--all', '--fixed-strings', `--grep=(#${prNumber})`, '--format=%H',
  ]).split('\n').map(l => l.trim()).filter(Boolean);
  return raw.flatMap(sha => branchesContaining(ctx, sha));
}

function checkReleaseBranch(ctx: ProbeCtx, a: Anchor, claim: Claim & { kind: 'release-branch' }): Verdict {
  const onBranch = (branches: string[]): string | undefined =>
    branches.find(b => b === `origin/${claim.branch}` || b.endsWith(`/${claim.branch}`)
      // "4.x" / "4.21" in prose vs "origin/4.21.x" as a ref
      || new RegExp(`/${claim.branch.replace(/\./g, '\\.').replace(/x$/, '')}[0-9.]*x?$`).test(b));

  const containing = branchesContaining(ctx, a.sha);
  const direct = onBranch(containing);
  const cmd = `git branch -r --contains ${refLabel(a.sha)}`;
  if (direct) return verdict(claim, 'grounded', `${cmd} → includes ${direct}`);

  // The backport is usually carried by a DIFFERENT PR, and the draft normally
  // names it right there in the sentence ("backported to 4.13.x (PR #9555)").
  // Searching only the draft's own PR number misses it and reports a true claim
  // as a defect.
  const quotedPrs = [...claim.quote.matchAll(/#(\d{3,6})/g)].map(m => Number.parseInt(m[1], 10));
  for (const pr of [a.prNumber, ...quotedPrs].filter((n): n is number => n !== undefined)) {
    const viaPick = onBranch(findCherryPick(ctx, pr));
    if (viaPick) {
      return verdict(claim, 'grounded',
        `${cmd} does not contain the anchor, but a commit referencing (#${pr}) reaches ${viaPick} — cherry-picked backport`);
    }
  }

  const releaseLines = containing.filter(b => /\d+\.\d+\.x$/.test(b));
  return verdict(claim, 'ungrounded',
    `${cmd} → does not include ${claim.branch}, and no commit referencing (#${a.prNumber}) reaches it`,
    releaseLines.length ? `anchor reaches ${releaseLines.join(', ')}` : undefined);
}

/** Claim kinds that read a tree and so can fall back to a tree-wide ref. */
const TREE_SCOPED = new Set<Claim['kind']>(['symbol', 'symbol-in-file', 'path-exists']);

// ---------------------------------------------------------------------------
// Snippet fidelity
// ---------------------------------------------------------------------------

/**
 * Does a fenced code block attributed to `file` actually occur there at `sha`?
 *
 * A draft can pass every symbol probe while its illustrative snippet is a
 * composite that exists nowhere: the 4278 draft showed a `check()` function
 * calling `utils.db.query(...)` without `include_docs`, assembled from two real
 * helpers, and every identifier in it was real. Comparison is whitespace- and
 * comment-insensitive, and a snippet using `...`/`// ...` elision is checked
 * segment by segment, so only genuinely invented code fails.
 *
 * Returns null when the snippet is too short to judge or the file is absent.
 *
 * Known gaps, none closed: only tagged js/ts fences are checked (an untagged
 * fence is skipped entirely), comments are stripped so comment text inside a
 * fence is never verified, and a match against ANY file the draft names counts —
 * so a snippet attributed to the wrong one of the draft's own files passes.
 */
export function snippetMatches(
  ctx: ProbeCtx, sha: string, file: string, snippet: string
): boolean | null {
  const blob = fileAt(ctx, sha, file);
  if (blob === null) return null;
  const strip = (s: string): string => s
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map(l => l.replace(/\/\/.*$/, ''))
    .join(' ')
    .replace(/\s+/g, '');
  const haystack = strip(blob);
  // Elision markers split a snippet into segments that must each appear, in order.
  const segments = snippet
    .split(/\n\s*(?:\/\/\s*)?\.\.\.\s*\n|\n\s*\/\/\s*\.\.\.\s*\n/)
    .map(strip)
    .filter(s => s.length >= 12);
  if (segments.length === 0) return null;
  let from = 0;
  for (const seg of segments) {
    const at = haystack.indexOf(seg, from);
    if (at < 0) return false;
    from = at + seg.length;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Drift: true at the anchor, stale as written
// ---------------------------------------------------------------------------

/**
 * Prose that scopes a claim to the past. A draft that says "at the time of this
 * fix" or annotates "(deleted)" is already honest about a dead entity; one that
 * simply names it is not. Deliberately generous — a false negative here costs a
 * missed nit, a false positive costs churn on a correct draft.
 */
const TIME_SCOPED = new RegExp([
  'at the time', 'as of ', 'no longer', 'used to', 'former', 'then-',
  'has since', 'since (?:replaced|renamed|removed|deleted)',
  '(?:was|were|later) (?:replaced|renamed|removed|deleted)',
  'postdates', 'predates', '-era\\b', '\\(deleted\\)',
  // NOT '(added)' or '(modified)': those annotate what the PR did to a file,
  // which says nothing about whether the path still exists today. Treating them
  // as time-scoping let a draft mark a path "(added)" in Related Files and then
  // recommend it in the present tense elsewhere, unflagged.
].join('|'), 'i');

/**
 * Is `entity` time-scoped ANYWHERE in the draft? A draft often qualifies a dead
 * path once, in a dedicated note or an annotated Related Files entry, and then
 * refers to it plainly elsewhere. Flagging each unqualified mention would demand
 * the same caveat in every sentence, so one honest mention settles the entity.
 */
export function entityIsTimeScoped(text: string, entity: string): boolean {
  return text.split('\n').some(line => line.includes(entity) && TIME_SCOPED.test(line));
}
// Gap: this matches the literal path only. A draft that qualifies "the webapp
// service" in prose and names the dead path elsewhere still flags, and one
// qualifying the path once can then discuss it loosely anywhere. Deliberate —
// erring toward flagging is cheap, and a prose alias is not machine-resolvable.

/**
 * Wording that scopes a claim FORWARD — to the current tree rather than to the
 * draft's own commit. "X was replaced by Y in #11050" asserts that Y exists
 * *now*, so probing Y at the anchor, where it does not yet exist, refutes a true
 * sentence. This is drift's mirror image: there the prose was too present-tense
 * for an anchor-era fact, here it is too past-tense for a current-tree fact.
 *
 * Both of the false positives this fixes came from time-scoping notes added in
 * response to review — the act of dating a claim created a second, forward claim.
 */
const FORWARD_SCOPED = new RegExp([
  'replaced by', 'renamed to', 'superseded by', 'since renamed',
  'current master', 'on master', 'today',
  'now (?:lives|reads|tests|uses|is|are|called|spelled)',
  // NOT 'moved to': anchor-era prose says "the guard moved to the top of the
  // function", meaning the PR moved it — not that the current tree differs.
  // Rescuing on that could excuse a genuinely wrong anchor-era claim.
].join('|'), 'i');

/** The entity a claim asserts exists, if it names one checkable in a tree. */
function claimEntity(claim: Claim): { kind: 'path' | 'symbol'; value: string } | null {
  switch (claim.kind) {
    case 'path-exists': return { kind: 'path', value: claim.file };
    case 'file-touched': return { kind: 'path', value: claim.file };
    case 'symbol-in-file': return { kind: 'path', value: claim.file };
    case 'symbol': return { kind: 'symbol', value: claim.symbol };
    default: return null;
  }
}

/** Subject of the commit that deleted `file`, when there is one. */
function removalCommit(ctx: ProbeCtx, ref: string, file: string): string | undefined {
  const raw = git(ctx, ['log', '--diff-filter=D', '-1', '--format=%h %s', ref, '--', file]).trim();
  return raw || undefined;
}

/**
 * Flag a claim that grounds at its anchor but names something absent from
 * `currentRef`, unless the draft sentence already time-scopes it.
 *
 * This is the class no existing probe could see: `resource-icons.service.ts` was
 * real when its PR shipped and is gone today, so checking only the anchor
 * certifies it and checking only master refutes it — both wrong. The claim is
 * true; the tense is not.
 */
export function driftFor(
  ctx: ProbeCtx, claim: Claim, currentRef: string, anchorSha: string, draft = ''
): Drift | undefined {
  const entity = claimEntity(claim);
  if (!entity) return undefined;
  // Time-scoping is a property of the DRAFT, not of whichever sentence the
  // extractor happened to quote. 9232 annotates its dead sidebar-filter
  // component in Related Files and its retired permissions in Design Choices,
  // yet kept being flagged because the quoted line was a different mention.
  // A reader warned once is warned.
  if (draft ? entityIsTimeScoped(draft, entity.value) : TIME_SCOPED.test(claim.quote)) return undefined;
  if (!commitExists(ctx, currentRef)) return undefined;

  if (entity.kind === 'path') {
    if (pathExistsAt(ctx, currentRef, entity.value)) return undefined;
    // Never report drift for something that was already absent at the anchor —
    // that is a different (and worse) finding, and the outcome layer owns it.
    if (!pathExistsAt(ctx, anchorSha, entity.value)) return undefined;
    const removedBy = removalCommit(ctx, currentRef, entity.value);
    return {
      entity: entity.value,
      removedBy,
      note: `present at the anchor but absent from ${refLabel(currentRef)}` +
        `${removedBy ? ` (removed by ${removedBy})` : ''} — the draft names it without time-scoping`,
    };
  }

  if (symbolHits(ctx, currentRef, entity.value).length > 0) return undefined;
  if (symbolHits(ctx, anchorSha, entity.value).length === 0) return undefined;
  return {
    entity: entity.value,
    note: `present at the anchor but absent from ${refLabel(currentRef)} — ` +
      'the draft names it without time-scoping',
  };
}

/** Dispatch a tree-scoped claim at `ref`. */
function checkAtRef(
  ctx: ProbeCtx, ref: string, claim: Claim, prov: Provenance, anchorForPath?: Anchor | null
): Verdict {
  switch (claim.kind) {
    case 'symbol': return checkSymbol(ctx, ref, claim, prov);
    case 'symbol-in-file': return checkSymbolInFile(ctx, ref, claim, prov);
    case 'path-exists': return checkPathExists(ctx, ref, claim, prov, anchorForPath);
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
export function checkClaim(
  ctx: ProbeCtx, anchor: Anchor | null, claim: Claim, siblings: Anchor[] = [],
  clusterPrs: Array<{ repo: string; prNumber: number }> = [], draft = ''
): Verdict {
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

  const settleAtAnchor = (): Verdict => {
    if (TREE_SCOPED.has(claim.kind)) return checkAtRef(ctx, anchor.sha, claim, 'anchor', anchor);
    if (claim.kind === 'file-touched') return checkFileTouched(ctx, anchor, claim, siblings, clusterPrs);
    return checkReleaseBranch(ctx, anchor, claim as Claim & { kind: 'release-branch' });
  };
  const settled = settleAtAnchor();

  // A Problem / Root Cause claim describes the tree the PR CHANGED. When it
  // fails at the anchor, ask the parent before calling it a fabrication — the
  // fix removing the thing the bug report named is the expected outcome, not a
  // defect. Absent from BOTH trees is still ungrounded.
  const preFix = TREE_SCOPED.has(claim.kind) && 'scope' in claim && claim.scope === 'pre-fix';
  if (settled.outcome === 'ungrounded' && preFix) {
    const parent = `${anchor.sha}^`;
    if (commitExists(ctx, parent)) {
      const before = checkAtRef(ctx, parent, claim, 'anchor', anchor);
      if (before.outcome === 'grounded') {
        return {
          ...before,
          evidence: `${before.evidence} — checked at ${refLabel(anchor.sha)}^ because the claim sits in a ` +
            'Problem/Root Cause section, which describes the state this PR changed',
        };
      }

      // A pre-fix claim pinned to a file the PR CREATED cannot be judged against
      // that file: it did not exist in the tree the sentence describes. The file
      // is an extraction artefact — prose naming a symbol rarely names its home,
      // so the model borrows a path from elsewhere in the draft. Re-probe the
      // symbol repo-wide at the parent and judge the substance, not the binding.
      if (claim.kind === 'symbol-in-file' && changedPaths(ctx, anchor.sha).get(claim.file) === 'A') {
        const bare: Claim = { kind: 'symbol', symbol: claim.symbol, quote: claim.quote, scope: 'pre-fix' };
        const anywhere = checkAtRef(ctx, parent, bare, 'anchor', anchor);
        if (anywhere.outcome === 'grounded') {
          return {
            ...anywhere,
            claim,
            evidence: `${anywhere.evidence} — searched the whole tree at ${refLabel(anchor.sha)}^ because ` +
              `${claim.file} was ADDED by this PR, so a Problem/Root Cause claim cannot be about it`,
          };
        }
      }
    }
  }

  // A claim the draft explicitly scopes to the current tree must be judged
  // there. Failing it at the anchor is checking the wrong commit, not a defect.
  if (settled.outcome === 'ungrounded' && TREE_SCOPED.has(claim.kind) && FORWARD_SCOPED.test(claim.quote)) {
    const ref = ctx.fallbackRef ?? DEFAULT_FALLBACK_REF;
    if (commitExists(ctx, ref)) {
      const atCurrent = checkAtRef(ctx, ref, claim, 'fallback');
      if (atCurrent.outcome === 'grounded') {
        return {
          ...atCurrent,
          evidence: `${atCurrent.evidence} — absent at the anchor, but the draft scopes this to the ` +
            'current tree ("replaced by", "on master", …), so it was checked there',
        };
      }
    }
  }

  // Drift is only meaningful for a claim that HELD at its anchor: the sentence
  // is true about its own PR, and stale only as read against today's tree.
  if (settled.outcome !== 'grounded') return settled;
  const drift = driftFor(ctx, claim, ctx.fallbackRef ?? DEFAULT_FALLBACK_REF, anchor.sha, draft);
  return drift ? { ...settled, drift } : settled;
}
