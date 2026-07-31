/**
 * verify-drafts.ts — semantic gate over promoted agent-memory drafts.
 *
 * `validate-schema` proves a draft is well-SHAPED. It cannot see whether the
 * shape is TRUE: `/issues/N` silently redirects to `/pull/N`, so a draft keyed to
 * its own merge PR validates perfectly. That is how ~60 of the first 107 drafts
 * reached review mis-keyed, and how five drafts naming symbols that do not exist
 * in cht-core passed CI green.
 *
 * This adds the checks that catch those, all hermetic by default:
 *   identity-alias          issueNumber equals its own source PR number
 *   identity-incoherent     id / issueNumber / issueUrl disagree
 *   filename-issue-mismatch filename's issue token contradicts frontmatter
 *   duplicate-issue         two drafts claim one issue (incl. against landed corpus)
 *   vocab-near-miss         a symbol 1-2 edits from a real cht-core term
 *   process-leakage         classifier/review scaffolding left in the prose
 *   uniform-domain-fit      every draft self-reports a strong fit (warning)
 *   related-issues-empty    machine-readable linkage never backfilled (warning)
 *   stale-timestamp         lastUpdated predates the file's last commit (warning)
 *
 * `--online` adds the checks that need the network:
 *   issue-number-is-pr          `issueNumber` names a PR, via the `pull_request`
 *                               key on the issues endpoint (gh-classify.ts)
 *   related-ref-missing         a `## Related Issues` number does not exist
 *   related-ref-is-pr           a PR cited there as though it were an issue
 *   related-ref-gloss-mismatch  the draft's one-line gloss of a cross-reference
 *                               shares no substantive word with the real title —
 *                               how #10754 ("Cookies not being sent with
 *                               `secure: true`") passed review glossed as
 *                               "Scheduled task duplicate processing"
 * A transient gh failure reports "unverified" and never fabricates a pass.
 *
 * What this does NOT catch, by construction: a fabricated symbol that is not a
 * near-miss of a real one (`getOidc`), a real symbol attributed to the wrong
 * file (`updateServiceWorker`), or correct symbols describing inverted semantics
 * (9281's AsyncGenerator). Those need the source tree — see ground-claims.ts. A
 * green run here is not a claim that the prose is true.
 *
 * Usage:
 *   npm run verify-drafts
 *   npm run verify-drafts -- --online
 *   npm run verify-drafts -- --changed-only --base <sha> --summary-md "$GITHUB_STEP_SUMMARY"
 *
 * Exit: 1 on any blocking finding, 3 when only online checks went unverified.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import matter from 'gray-matter';
import { REPO_ROOT } from './schema-utils';
import { classifyNumber, describeNumber, ClassifyCache, ExecFn, NumberKind } from './gh-classify';
import { loadVocab, nearMiss, Vocab, VOCAB_PATH } from './vocab';

export type { ExecFn };

export type Severity = 'blocking' | 'warning';

/** One defect, anchored to a file (or `(corpus)` for distribution lints). */
export interface Finding {
  file: string;
  check: string;
  severity: Severity;
  message: string;
  /** 1-indexed line of the offending text, when the check can locate one. */
  line?: number;
}

export interface VerifyOptions {
  /** Directory walked recursively for *.md (default: agent-memory). */
  dir?: string;
  /** Enable the network issue-vs-PR check. */
  online?: boolean;
  /** Restrict reported per-file findings to files changed since this git ref. */
  base?: string;
  /** owner/repo for gh lookups (default: medic/cht-core). */
  repo?: string;
  /** Injected exec for tests. */
  exec?: ExecFn;
  /** Override the committed vocabulary snapshot. */
  vocabPath?: string;
}

export interface VerifyReport {
  scanned: number;
  /** Files with no frontmatter that are legitimately prose (README, TEMPLATE). */
  skipped: string[];
  findings: Finding[];
  /** Drafts whose online check could not complete (transient gh failure). */
  unverified: number;
}

const DEFAULT_REPO = 'medic/cht-core';

/** Prose files under agent-memory that legitimately carry no frontmatter. */
const NO_FRONTMATTER_ALLOWLIST = new Set(['README.md', 'TEMPLATE.md']);

/**
 * `<pr>-<type><issue>-<slug>` — the filename form that encodes BOTH numbers.
 * Deliberately requires the type prefix: 15 drafts use `<pr>-<type>-<slug>` with
 * no issue token at all (`10555-feat-add-pt-br-translations.md`), and reading
 * their second group as an issue number would invent a contradiction.
 */
const FILENAME_ISSUE_TOKEN = /^(\d+)-(?:fix|feat|perf|chore|refactor|docs|ci|build|test|style|revert)(\d+)-/;

const SOURCE_PR_RE = /^([^#]+)#(\d+)$/;
const ID_RE = /^cht-(core|interoperability)-([1-9][0-9]*)$/;
const ISSUE_URL_RE = /^https:\/\/github\.com\/(medic\/(?:cht-core|cht-interoperability))\/issues\/([1-9][0-9]*)$/;

/**
 * Classifier and review scaffolding that leaked into distilled prose. These are
 * artifacts of how a draft was PRODUCED; a future agent reading the corpus as
 * knowledge is misled by them. Every entry is drawn from a real review comment.
 */
const LEAKAGE_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /\bper the (?:classification )?seeds?\b/i, label: 'classification-seed reference' },
  { re: /\bthe seed\b/i, label: 'classification-seed reference' },
  { re: /\bseed example\b/i, label: 'classification-seed reference' },
  { re: /\bcarve-out\b/i, label: 'classifier rubric language' },
  { re: /\bpitfall does not apply\b/i, label: 'classifier rubric language' },
  { re: /\bper the [\w/-]+ pitfall\b/i, label: 'classifier rubric language' },
  { re: /\bexplicit strong fit\b/i, label: 'classifier rubric language' },
  { re: /\bCI (?:is )?green\b/i, label: 'process narrative' },
  { re: /\ball \d+ checks pass\b/i, label: 'process narrative' },
  { re: /\bthe human reverted\b/i, label: 'process narrative' },
];

interface Draft {
  /** Repo-relative path. */
  file: string;
  /** Absolute path — git pathspecs must not use the display path, which may be
   *  relative to a sibling worktree's parent and would silently match nothing. */
  abs: string;
  body: string;
  lines: string[];
  fm: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

/** Parse `medic/cht-core#42`. */
function parseSourcePr(ref: unknown): { repo: string; prNumber: number } | null {
  const s = str(ref);
  const m = s ? SOURCE_PR_RE.exec(s) : null;
  return m ? { repo: m[1], prNumber: Number.parseInt(m[2], 10) } : null;
}

/** 1-indexed line of the first occurrence of `needle`, or undefined. */
function lineOf(lines: string[], needle: string): number | undefined {
  const i = lines.findIndex(l => l.includes(needle));
  return i >= 0 ? i + 1 : undefined;
}

const finding = (
  file: string,
  check: string,
  severity: Severity,
  message: string,
  line?: number
): Finding => ({ file, check, severity, message, line });

// ---------------------------------------------------------------------------
// Per-file checks
// ---------------------------------------------------------------------------

/**
 * id / issueNumber / issueUrl must name one issue in one repo. Internal
 * incoherence means the identity was rewritten in part — the signature of a
 * partial relink.
 */
function checkIdentityCoherence(d: Draft): Finding[] {
  const issueNumber = num(d.fm.issueNumber);
  const idMatch = ID_RE.exec(str(d.fm.id) ?? '');
  const urlMatch = ISSUE_URL_RE.exec(str(d.fm.issueUrl) ?? '');
  if (issueNumber === undefined || !idMatch || !urlMatch) return []; // shape is validate-schema's job

  const out: Finding[] = [];
  if (Number.parseInt(idMatch[2], 10) !== issueNumber) {
    out.push(finding(d.file, 'identity-incoherent', 'blocking',
      `id "${str(d.fm.id)}" does not match issueNumber ${issueNumber}`, lineOf(d.lines, 'id:')));
  }
  if (Number.parseInt(urlMatch[2], 10) !== issueNumber) {
    out.push(finding(d.file, 'identity-incoherent', 'blocking',
      `issueUrl points at issue ${urlMatch[2]} but issueNumber is ${issueNumber}`, lineOf(d.lines, 'issueUrl:')));
  }
  if (`cht-${idMatch[1]}` !== urlMatch[1].split('/')[1]) {
    out.push(finding(d.file, 'identity-incoherent', 'blocking',
      `id names repo cht-${idMatch[1]} but issueUrl names ${urlMatch[1]}`, lineOf(d.lines, 'issueUrl:')));
  }
  return out;
}

/**
 * The round-1 defect signature: the draft is keyed to the number of the PR that
 * closed the issue, not the issue. Invisible to schema validation because
 * `/issues/N` redirects to `/pull/N` for a PR number.
 */
function checkIdentityAlias(d: Draft): Finding[] {
  const issueNumber = num(d.fm.issueNumber);
  const src = parseSourcePr(d.fm.source_pr);
  if (issueNumber === undefined || !src || issueNumber !== src.prNumber) return [];
  return [finding(d.file, 'identity-alias', 'blocking',
    `issueNumber ${issueNumber} is its own source PR (${src.repo}#${src.prNumber}) — key to the issue the PR closes`,
    lineOf(d.lines, 'issueNumber:'))];
}

/** The filename's issue token and the frontmatter must agree on the issue. */
function checkFilenameToken(d: Draft): Finding[] {
  const issueNumber = num(d.fm.issueNumber);
  const m = FILENAME_ISSUE_TOKEN.exec(path.basename(d.file));
  if (issueNumber === undefined || !m) return [];
  const tokenIssue = Number.parseInt(m[2], 10);
  if (tokenIssue === issueNumber) return [];
  return [finding(d.file, 'filename-issue-mismatch', 'blocking',
    `filename encodes issue ${tokenIssue} but frontmatter says ${issueNumber} — one of them is wrong`)];
}

/** Text a near-miss is worth hunting in: frontmatter values plus the body. */
function searchableText(d: Draft): string {
  const scalars = Object.values(d.fm).flatMap(v => {
    if (typeof v === 'string') return [v];
    if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string');
    return [];
  });
  return [...scalars, d.body].join('\n');
}

/**
 * Tokens 1-2 edits from a real cht-core term, compared only within a family.
 * This is the deterministic half of the fabricated-symbol class: a paraphrasing
 * distiller produces `con_create_people` / `docs_by_type` / `task.status`, all
 * within edit distance 2 of the real symbol.
 */
function checkVocabNearMiss(d: Draft, vocab: Vocab): Finding[] {
  const text = searchableText(d);
  const out: Finding[] = [];
  const reported = new Set<string>();
  for (const family of vocab.families) {
    const re = new RegExp(family.candidatePattern, 'g');
    for (const match of text.matchAll(re)) {
      const token = match[0];
      if (reported.has(token)) continue;
      const suggestion = nearMiss(token, family);
      if (!suggestion) continue;
      reported.add(token);
      out.push(finding(d.file, 'vocab-near-miss', 'blocking',
        `"${token}" does not exist in cht-core (${family.name}); closest real term is "${suggestion}"`,
        lineOf(d.lines, token)));
    }
  }
  return out;
}

/** Classifier/process scaffolding left in prose meant to be durable knowledge. */
function checkProcessLeakage(d: Draft): Finding[] {
  const out: Finding[] = [];
  for (const { re, label } of LEAKAGE_PATTERNS) {
    const m = re.exec(d.body);
    if (!m) continue;
    out.push(finding(d.file, 'process-leakage', 'warning',
      `${label}: "${m[0].trim()}" — internal rubric text, not durable knowledge`, lineOf(d.lines, m[0])));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Online check
// ---------------------------------------------------------------------------

interface GhCtx {
  exec: ExecFn;
  cache: ClassifyCache;
  repo: string;
}

/**
 * Assert issueNumber really names an issue. Returns `unverified` (not a finding)
 * on a transient gh failure so a throttled lookup never reads as a real defect.
 */
function checkIssueIsNotPr(d: Draft, gh: GhCtx): { findings: Finding[]; unverified: boolean } {
  const issueNumber = num(d.fm.issueNumber);
  if (issueNumber === undefined) return { findings: [], unverified: false };
  const repo = parseSourcePr(d.fm.source_pr)?.repo ?? gh.repo;
  try {
    const kind = classifyNumber(repo, issueNumber, gh.exec, gh.cache);
    if (kind === 'issue') return { findings: [], unverified: false };
    const detail = kind === 'pr'
      ? `${repo}#${issueNumber} is a PULL REQUEST, not an issue`
      : `${repo}#${issueNumber} does not exist in this repo`;
    return {
      findings: [finding(d.file, 'issue-number-is-pr', 'blocking', detail, lineOf(d.lines, 'issueNumber:'))],
      unverified: false,
    };
  } catch {
    return { findings: [], unverified: true };
  }
}

/** `- #1234: gloss text` inside the prose `## Related Issues` section. */
const RELATED_REF_RE = /^-\s*(?:PR\s*)?#(\d{2,7})\s*:\s*(.+)$/;
/** The draft already labels the ref as a PR, so citing a PR number is honest. */
const LABELLED_PR_RE = /^-\s*PR\s*#/;

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'to', 'of', 'in', 'on', 'for', 'with', 'when', 'if', 'is',
  'are', 'be', 'not', 'no', 'this', 'that', 'it', 'its', 'from', 'by', 'as', 'at', 'into',
  'related', 'issue', 'original', 'tracking', 'similar', 'improvement', 'bug', 'fixed', 'fix',
]);

const contentWords = (s: string): Set<string> =>
  new Set(
    s.toLowerCase().replace(/[`_*'"()[\]{}.,:;!?/\\-]/g, ' ').split(/\s+/)
      .filter(w => w.length > 3 && !STOPWORDS.has(w))
  );

/**
 * A gloss that states how the reference RELATES to this draft rather than what
 * the referenced issue is about — "Blocker for #10908", "closed by this PR". It
 * is not a paraphrase of the title and must not be compared to one; the reviewer
 * verified these by hand and they were correct.
 */
const RELATIONSHIP_GLOSS =
  /^(?:blocker|blocked by|blocks|parent|child|sibling|duplicate|related|follow-?up|closed by|fixed by|superseded|supersedes|precursor|prerequisite|depends on|tracking|epic)\b/i;

/**
 * Does the draft's gloss share any substantive word with the real title? A
 * paraphrase ("privacy policies do not load" vs "privacy policies change page
 * not loading") always will; a wrong reference ("Scheduled task duplicate
 * processing" vs "Cookies not being sent with `secure: true`") will not. Only
 * total disjointness is reported, so paraphrasing stays free.
 */
/**
 * The part of a gloss that makes a claim about the referenced issue. A
 * relationship prefix ("parent improvement — allow clearing messages…") is
 * linkage, but what follows the dash is a content claim and must still be
 * checked; exempting the whole string let a wrong description ride along behind
 * one relationship word.
 */
function claimPart(gloss: string): string {
  const [head, ...rest] = gloss.split(/\s+[—–-]\s+/);
  if (rest.length && RELATIONSHIP_GLOSS.test(head.trim())) return rest.join(' - ');
  return gloss;
}

const overlapCount = (gloss: string, title: string): number => {
  const t = contentWords(title);
  let n = 0;
  for (const w of contentWords(gloss)) {
    // Cheap stem tolerance: "policies"/"policy", "testing"/"tests".
    if (t.has(w) || [...t].some(tw => w.startsWith(tw.slice(0, 4)) || tw.startsWith(w.slice(0, 4)))) n++;
  }
  return n;
};

/**
 * Does the draft's gloss share substantive words with the real title? A
 * paraphrase ("privacy policies do not load" vs "privacy policies change page
 * not loading") always will; a wrong reference ("Scheduled task duplicate
 * processing" vs "Cookies not being sent with `secure: true`") will not.
 *
 * Only TOTAL disjointness is reported as a defect, which keeps precision high
 * at the cost of recall: a gloss sharing one incidental word with the title
 * passes even when it describes a different issue, which is how a draft citing
 * #10446 ("Dont send empty messages") as "failed/invalid scheduled messages were
 * not being cleared" survived — the shared word was "messages". `glossIsWeak`
 * exists to surface that case for a human without blocking on it.
 */
function glossMatchesTitle(gloss: string, title: string): boolean {
  if (skipGloss(gloss)) return true;
  const claim = claimPart(gloss);
  if (contentWords(claim).size === 0 || contentWords(title).size === 0) return true;
  return overlapCount(claim, title) > 0;
}

/** Linkage-only glosses, and ones that explain themselves by citing another number. */
const skipGloss = (gloss: string): boolean =>
  RELATIONSHIP_GLOSS.test(claimPart(gloss).trim()) || /#\d{2,7}/.test(gloss);

/**
 * A gloss long enough to be making a real claim that shares exactly one word
 * with the title. Not proof of anything — it is where a wrong reference hides
 * from the disjointness test, so it is reported as a warning for a human to read.
 */
function glossIsWeak(gloss: string, title: string): boolean {
  if (skipGloss(gloss)) return false;
  const claim = claimPart(gloss);
  return contentWords(claim).size >= 4 && overlapCount(claim, title) === 1;
}

/**
 * Audit every cross-reference in `## Related Issues`. Two defect classes, both
 * from real review rounds: a number that is a PR presented as an issue, and a
 * gloss describing a different issue than the one cited.
 */
function checkRelatedIssueRefs(d: Draft, gh: GhCtx): { findings: Finding[]; unverified: boolean } {
  const out: Finding[] = [];
  let unverified = false;
  const repo = parseSourcePr(d.fm.source_pr)?.repo ?? gh.repo;
  const self = num(d.fm.issueNumber);

  for (const [i, raw] of d.lines.entries()) {
    const m = RELATED_REF_RE.exec(raw.trim());
    if (!m) continue;
    const n = Number.parseInt(m[1], 10);
    const gloss = m[2].trim();
    if (n === self) continue; // the draft's own issue, already checked by identity
    let described: { kind: NumberKind; title: string | null };
    try {
      described = describeNumber(repo, n, gh.exec);
    } catch {
      unverified = true;
      continue;
    }
    if (described.kind === 'missing') {
      out.push(finding(d.file, 'related-ref-missing', 'blocking',
        `${repo}#${n} does not exist in this repo`, i + 1));
      continue;
    }
    if (described.kind === 'pr' && !LABELLED_PR_RE.test(raw.trim())) {
      out.push(finding(d.file, 'related-ref-is-pr', 'warning',
        `#${n} is a PULL REQUEST cited in Related Issues as an issue — label it "PR #${n}"`, i + 1));
    }
    if (described.title && !glossMatchesTitle(gloss, described.title)) {
      out.push(finding(d.file, 'related-ref-gloss-mismatch', 'blocking',
        `#${n} is "${described.title}" — the draft glosses it as "${gloss}", which describes ` +
          'something else entirely', i + 1));
    } else if (described.title && glossIsWeak(gloss, described.title)) {
      out.push(finding(d.file, 'related-ref-gloss-weak', 'warning',
        `#${n} is "${described.title}" — the gloss "${gloss}" shares only one word with it; ` +
          'read it to confirm it describes this issue and not a neighbouring one', i + 1));
    }
  }
  return { findings: out, unverified };
}

/**
 * `lastUpdated` must not predate the last commit that edited the draft. A
 * substantive rewrite that leaves the old stamp makes the corpus look older than
 * it is, and reviewers use the stamp to decide what to re-read.
 */
// Note: "last edited" counts every commit touching the file, including one that
// only bumps this stamp, and including a revert. That is why the working rule is
// "touch the file, stamp it today" rather than "stamp it with the date of the
// last content change" — the latter fails its own check on the next commit.
function checkTimestampFreshness(d: Draft, dir: string, exec: ExecFn): Finding[] {
  const stamp = str(d.fm.lastUpdated) ?? (d.fm.lastUpdated instanceof Date
    ? d.fm.lastUpdated.toISOString().slice(0, 10)
    : undefined);
  if (!stamp) return [];
  let committed: string;
  try {
    committed = exec('git', ['-C', dir, 'log', '-1', '--format=%ad', '--date=short', '--', d.abs])
      .trim();
  } catch {
    return [];
  }
  if (!committed || stamp >= committed) return [];
  return [finding(d.file, 'stale-timestamp', 'warning',
    `lastUpdated is ${stamp} but the file was last edited ${committed} — bump it`,
    lineOf(d.lines, 'lastUpdated:'))];
}

// ---------------------------------------------------------------------------
// Corpus-level checks
// ---------------------------------------------------------------------------

/** Group drafts by the issue they claim, within a repo. */
function duplicateClusters(drafts: Draft[]): Map<string, Draft[]> {
  const byIssue = new Map<string, Draft[]>();
  for (const d of drafts) {
    const issueNumber = num(d.fm.issueNumber);
    if (issueNumber === undefined) continue;
    const repo = parseSourcePr(d.fm.source_pr)?.repo ?? DEFAULT_REPO;
    const key = `${repo}#${issueNumber}`;
    byIssue.set(key, [...(byIssue.get(key) ?? []), d]);
  }
  return new Map([...byIssue].filter(([, group]) => group.length > 1));
}

/**
 * Two drafts claiming one issue. Computed across the WHOLE corpus, including
 * already-landed drafts, so a new draft colliding with main is caught — but only
 * reported when a focused (changed) file is in the cluster.
 */
function checkDuplicates(drafts: Draft[], focus: Set<string>): Finding[] {
  const out: Finding[] = [];
  for (const [key, group] of duplicateClusters(drafts)) {
    for (const d of group) {
      if (!focus.has(d.file)) continue;
      const peers = group.filter(p => p !== d).map(p => path.basename(p.file));
      out.push(finding(d.file, 'duplicate-issue', 'blocking',
        `${key} is also claimed by ${peers.join(', ')} — collapse to one memory with source_prs[]`));
    }
  }
  return out;
}

/**
 * Distribution lints. Both are warnings: they flag a metadata field that was
 * never really populated rather than a false statement. Reported once, against
 * `(corpus)`, and only when the scan is corpus-wide.
 */
function checkDistribution(drafts: Draft[]): Finding[] {
  if (drafts.length < 10) return []; // too small a sample to mean anything
  const out: Finding[] = [];
  const withFit = drafts.filter(d => str(d.fm.domainFit) !== undefined);
  if (withFit.length >= 10 && withFit.every(d => str(d.fm.domainFit) === 'strong')) {
    out.push(finding('(corpus)', 'uniform-domain-fit', 'warning',
      `all ${withFit.length} drafts self-report domainFit: strong — the field is carrying no signal`));
  }
  const declared = drafts.filter(d => Array.isArray(d.fm.related_issues));
  const empty = declared.filter(d => (d.fm.related_issues as unknown[]).length === 0);
  if (empty.length >= 10 && empty.length === declared.length) {
    out.push(finding('(corpus)', 'related-issues-empty', 'warning',
      `related_issues is empty on all ${empty.length} drafts that declare it — machine-readable linkage never backfilled`));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

/** Recursively collect *.md paths under dir. */
function walkMarkdown(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkMarkdown(full));
    else if (entry.isFile() && entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}

const defaultExec: ExecFn = (file, args) =>
  execFileSync(file, args, { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 }) as string;

/**
 * Files changed since `base`, relative to the root of the checkout being
 * scanned. `-C dir` anchors the diff to THAT worktree, so scanning a sibling
 * tree does not silently diff this one instead.
 *
 * Requires full history: a depth-1 CI checkout yields an empty diff, which would
 * quietly pass everything. Hence `fetch-depth: 0` in the workflow, and the
 * empty-diff guard in verifyDrafts.
 */
function changedFiles(base: string, dir: string, exec: ExecFn): Set<string> {
  const raw = exec('git', ['-C', dir, 'diff', '--name-only', `${base}...HEAD`]);
  return new Set(raw.split('\n').map(l => l.trim()).filter(Boolean));
}

/**
 * Display path for a scanned file. Relative to the repo for the normal case;
 * relative to the scan root when `--dir` points outside this checkout, so
 * scanning a sibling worktree (the pre-push flow) prints readable paths instead
 * of a chain of `../`.
 */
function displayPath(abs: string, scanRoot: string): string {
  const fromRepo = path.relative(REPO_ROOT, abs);
  return fromRepo.startsWith('..') ? path.relative(path.dirname(scanRoot), abs) : fromRepo;
}

function readDraft(abs: string, scanRoot: string): { draft?: Draft; skipped?: string; malformed?: Finding } {
  const rel = displayPath(abs, scanRoot);
  const content = fs.readFileSync(abs, 'utf8');
  let parsed: ReturnType<typeof matter>;
  try {
    parsed = matter(content);
  } catch (err) {
    const message = err instanceof Error ? err.message.split('\n')[0] : String(err);
    return { malformed: finding(rel, 'unparseable-frontmatter', 'blocking', message) };
  }
  const fm = parsed.data as Record<string, unknown>;
  if (Object.keys(fm).length === 0) {
    if (NO_FRONTMATTER_ALLOWLIST.has(path.basename(abs))) return { skipped: rel };
    return { malformed: finding(rel, 'missing-frontmatter', 'blocking', 'no YAML frontmatter block') };
  }
  return { draft: { file: rel, abs, body: parsed.content, lines: content.split('\n'), fm } };
}

function hermeticFileChecks(d: Draft, vocab: Vocab): Finding[] {
  return [
    ...checkIdentityCoherence(d),
    ...checkIdentityAlias(d),
    ...checkFilenameToken(d),
    ...checkVocabNearMiss(d, vocab),
    ...checkProcessLeakage(d),
  ];
}

/**
 * Verify every draft under `opts.dir`. Per-file findings are limited to files
 * changed since `opts.base` when given, while corpus-level checks always see the
 * whole tree so a collision with already-landed drafts is still caught.
 */
export function verifyDrafts(opts: VerifyOptions = {}): VerifyReport {
  const dir = path.resolve(REPO_ROOT, opts.dir ?? 'agent-memory');
  const exec = opts.exec ?? defaultExec;
  const vocab = loadVocab(opts.vocabPath);
  const gh: GhCtx = { exec, cache: new Map(), repo: opts.repo ?? DEFAULT_REPO };

  const drafts: Draft[] = [];
  const skipped: string[] = [];
  const findings: Finding[] = [];
  let unverified = 0;

  for (const abs of walkMarkdown(dir).toSorted((a, b) => a.localeCompare(b))) {
    const { draft, skipped: skip, malformed } = readDraft(abs, dir);
    if (skip) skipped.push(skip);
    if (malformed) findings.push(malformed);
    if (draft) drafts.push(draft);
  }

  const focus = opts.base ? changedFiles(opts.base, dir, exec) : new Set(drafts.map(d => d.file));
  const focused = drafts.filter(d => focus.has(d.file));

  // A shallow checkout makes the base unreachable and the diff empty, which would
  // read as "everything passed". Fail loudly instead of silently verifying nothing.
  if (opts.base && focus.size === 0) {
    throw new Error(
      `--changed-only produced an empty diff against ${opts.base}: the base commit is probably ` +
        'unreachable (shallow checkout). Fetch full history (actions/checkout fetch-depth: 0).'
    );
  }

  for (const d of focused) {
    findings.push(...hermeticFileChecks(d, vocab));
    findings.push(...checkTimestampFreshness(d, dir, exec));
    if (opts.online) {
      const res = checkIssueIsNotPr(d, gh);
      findings.push(...res.findings);
      const refs = checkRelatedIssueRefs(d, gh);
      findings.push(...refs.findings);
      if (res.unverified || refs.unverified) unverified++;
    }
  }

  findings.push(...checkDuplicates(drafts, focus));
  if (!opts.base) findings.push(...checkDistribution(drafts));

  return { scanned: focused.length, skipped, findings, unverified };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

/** Group findings by file, blocking first, for both stdout and the CI summary. */
export function formatReport(report: VerifyReport, vocabSha: string): string {
  const blocking = report.findings.filter(f => f.severity === 'blocking');
  const warnings = report.findings.filter(f => f.severity === 'warning');
  const lines = [
    `verify-drafts: ${report.scanned} drafts checked, ` +
      `${blocking.length} blocking, ${warnings.length} warnings, ${report.unverified} unverified ` +
      `(vocab @ ${vocabSha.slice(0, 10)})`,
    '',
  ];
  for (const label of ['blocking', 'warning'] as const) {
    const group = report.findings.filter(f => f.severity === label);
    if (!group.length) continue;
    lines.push(label === 'blocking' ? 'BLOCKING:' : 'WARNINGS:');
    for (const f of group) {
      const at = f.line ? `:${f.line}` : '';
      lines.push(`  [${f.check}] ${f.file}${at}`);
      lines.push(`      ${f.message}`);
    }
    lines.push('');
  }
  if (report.unverified > 0) {
    lines.push(`NOTE: ${report.unverified} draft(s) could not be checked online (transient gh failure) — not a pass.`);
  }
  return lines.join('\n');
}

/* istanbul ignore next */
function argValue(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}

/* istanbul ignore next */
if (require.main === module) {
  const argv = process.argv.slice(2);
  const report = verifyDrafts({
    dir: argValue(argv, '--dir'),
    online: argv.includes('--online'),
    base: argv.includes('--changed-only') ? (argValue(argv, '--base') ?? 'origin/main') : undefined,
    vocabPath: argValue(argv, '--vocab'),
  });
  const vocabSha = loadVocab(argValue(argv, '--vocab') ?? VOCAB_PATH).sha;
  const text = formatReport(report, vocabSha);
  console.log(text);

  const summaryPath = argValue(argv, '--summary-md');
  if (summaryPath) fs.appendFileSync(summaryPath, `## agent-memory draft verification\n\n\`\`\`\n${text}\n\`\`\`\n`);

  if (report.findings.some(f => f.severity === 'blocking')) process.exit(1);
  if (report.unverified > 0) process.exit(3);
}
