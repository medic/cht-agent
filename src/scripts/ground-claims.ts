/**
 * ground-claims.ts — Layer 2 of draft verification: check what a draft SAYS
 * against the cht-core source it was distilled from.
 *
 * `verify-drafts` (Layer 1) is hermetic and gates CI, but by construction it
 * only catches defects visible in the draft itself — identity incoherence,
 * duplicates, and symbols within two edits of a real one. It cannot catch the
 * defects that need the source tree, and those are the ones that survived two
 * rounds of review:
 *
 *   - a fabricated symbol that resembles nothing real       (`getOidc`, `isDue`)
 *   - a real symbol credited to the wrong file              (`updateServiceWorker`)
 *   - a mechanism claim that is simply inverted             ("preserved" a file the PR deleted)
 *   - a backport attributed to the wrong release line       ("4.1.x" for a 4.13.x backport)
 *
 * Two stages. An LLM reads the draft and extracts checkable CLAIMS (the only
 * step needing a model — recognising an assertion in prose). Then every claim is
 * settled by a deterministic git probe in claim-probes.ts. The model never
 * decides whether a claim is true; it only decides what was claimed. That split
 * is deliberate: an LLM verdict can flip between runs, a `git grep` cannot.
 *
 * Not wired into CI, on purpose: it needs a multi-hundred-MB cht-core checkout
 * and an LLM, and a required check that can flake gets de-required. It runs
 * operator-side before pushing, and its report is attached to the PR.
 *
 * Usage:
 *   CHT_CORE_PATH=/path/to/cht-core LLM_PROVIDER=claude-cli \
 *     npm run ground-claims -- --dir agent-memory --label promote-messaging
 *   ... -- --changed-only --base origin/main     # only this branch's drafts
 *   ... -- --limit 5                             # smoke-test the prompt cheaply
 *   ... -- --no-api-resolve                      # fully offline: skip GitHub-API anchor resolution
 *
 * Reports land in outputs/verification/<label>/ (gitignored, never committed —
 * a report inside agent-memory/ would become memory a future agent reads).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import matter from 'gray-matter';
import { z } from 'zod';
import { REPO_ROOT } from './schema-utils';
import { enumerateClaims, normaliseClaim, quoteDisclaims, quoteIsPreFix } from './enumerate-claims';
import { createStructuredCliChain, isUsingCLIProvider } from '../llm/structured-cli';
import {
  Anchor, Claim, Outcome, ProbeCtx, Verdict, checkClaim, defaultExec, entityIsTimeScoped,
  resolveAnchor, snippetMatches, ExecFn,
} from './claim-probes';

const OUTCOMES: Outcome[] = ['grounded', 'ungrounded', 'unverifiable', 'anchor-unusable'];

/** A draft plus the anchor metadata needed to check it. */
export interface DraftInput {
  /** Repo-relative path. */
  file: string;
  frontmatter: Record<string, unknown>;
  body: string;
  /** Raw bytes, hashed so a report can be tied to the exact content verified. */
  raw: string;
}

export type ExtractFn = (draft: DraftInput) => Promise<Claim[]>;

/**
 * A fenced code block that occurs in none of the files the draft names. Every
 * identifier in it may be real — the 4278 snippet was assembled from two genuine
 * helpers — so no symbol probe can catch it.
 */
export interface SnippetFinding {
  language: string;
  /** 1-indexed line of the opening fence. */
  line: number;
  excerpt: string;
  /** Files it was compared against, so the report shows the search was fair. */
  checkedAgainst: string[];
}

export interface DraftReport {
  file: string;
  /** sha256 of the draft bytes — lets a later gate refuse a stale report. */
  contentHash: string;
  anchor: { sha: string; subject: string; isRevert: boolean; note?: string } | null;
  verdicts: Verdict[];
  counts: Record<Outcome, number>;
  /** Code fences matching nothing in the files the draft names. */
  snippets?: SnippetFinding[];
  /** Extraction failed; the draft was not verified. */
  error?: string;
}

export interface GroundOptions {
  dir?: string;
  /** Restrict to drafts changed since this ref. */
  base?: string;
  chtCorePath?: string;
  outDir?: string;
  label?: string;
  extractFn?: ExtractFn;
  exec?: ExecFn;
  fallbackRef?: string;
  /** Stop after N drafts — for cheaply smoke-testing the prompt. */
  limit?: number;
  concurrency?: number;
  /** False disables GitHub-API anchor resolution (fully offline run). */
  apiResolve?: boolean;
}

// ---------------------------------------------------------------------------
// Claim extraction (the only LLM step)
// ---------------------------------------------------------------------------

const claimSchema = z.object({
  claims: z.array(z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('symbol'), symbol: z.string().min(1), quote: z.string() }),
    z.object({
      kind: z.literal('symbol-in-file'),
      symbol: z.string().min(1), file: z.string().min(1), quote: z.string(),
    }),
    z.object({
      kind: z.literal('file-touched'),
      file: z.string().min(1),
      status: z.enum(['added', 'modified', 'deleted']).optional(),
      quote: z.string(),
    }),
    z.object({ kind: z.literal('path-exists'), file: z.string().min(1), quote: z.string() }),
    z.object({ kind: z.literal('release-branch'), branch: z.string().min(1), quote: z.string() }),
  ])),
});

const CLAIM_SHAPE = `{"claims": [
  {"kind": "symbol", "symbol": "<identifier>", "quote": "<the draft sentence asserting it>"},
  {"kind": "symbol-in-file", "symbol": "<identifier>", "file": "<repo-relative path>", "quote": "..."},
  {"kind": "file-touched", "file": "<repo-relative path>", "status": "added" | "modified" | "deleted", "quote": "..."},
  {"kind": "path-exists", "file": "<repo-relative path>", "quote": "..."},
  {"kind": "release-branch", "branch": "<e.g. 4.13.x>", "quote": "..."}
]}`;

/**
 * Prompt for claim EXTRACTION only. It deliberately never asks whether a claim
 * is true — a git probe decides that. Asking a model to judge truth here is what
 * produced the fabrications in the first place.
 */
export function extractionPrompt(draft: DraftInput): string {
  return `You are extracting checkable factual claims from a distilled engineering memory about the medic/cht-core repository. Each claim will be verified mechanically with \`git grep\` / \`git diff-tree\` against the exact cht-core commit this memory was distilled from. Your ONLY job is to say what the document ASSERTS. Do not judge whether anything is true, and do not speculate about code you cannot see.

Extract a claim for each of these, and nothing else:
- Every code identifier the draft names as existing: function, method, constant, permission string, config/settings key, CouchDB view name, field name on a document. Use kind "symbol". Use the identifier EXACTLY as the draft spells it — if the draft is wrong, the probe must be able to prove it wrong, so never silently correct a spelling.
- Every identifier the draft attributes to a SPECIFIC file ("the getFoo handler in login.js", "defined in config-watcher.js"). Use kind "symbol-in-file" with that file path.
- Every file the draft says the source PR changed, added, or deleted (a "Related Files" list, or prose like "added alongside X", "removed Y"). Use kind "file-touched", with "status" only when the draft is explicit about it.
- Every file path the draft names as existing without saying the PR changed it. Use kind "path-exists".
- Every release line the draft says the change was backported to. Use kind "release-branch" with just the branch name, e.g. "4.13.x".

Rules:
- Use a path EXACTLY as the draft spells it. If the draft names only a bare filename ("rendered from analytics.component.html"), do NOT invent a directory for it — emit the bare string or nothing. A guessed prefix turns a correct sentence into a phantom path claim.
- Do NOT extract a "symbol" or "path-exists" claim for something the draft says the PR REMOVED, deleted, renamed away, or replaced ("removed the parseResponseBody helper", "the old add-branding-doc.js was deleted"). The draft is asserting the thing is GONE at that commit, so probing for its existence inverts the claim. Where the draft names the file such a removal happened in, extract "file-touched" with status "deleted" instead, and nothing else.
- "quote" must be a verbatim span from the draft (one sentence is ideal) so a human can find it.
- For a dotted field reference like \`task.state\`, use the whole dotted token as the symbol.
- Do not extract prose concepts, issue/PR numbers, dates, people, or anything not checkable by searching a source tree.
- Do not invent claims the draft does not make. An empty list is a valid answer.
- Prefer "symbol-in-file" over "symbol" whenever the draft ties the identifier to a file.

DRAFT: ${draft.file}
FRONTMATTER (for context; extract claims from entities/concepts if they name code):
${JSON.stringify(draft.frontmatter, null, 2)}

BODY:
${draft.body}`;
}

/** Claim extraction via the Claude CLI provider (no API key; operator's subscription). */
function cliExtractor(): ExtractFn {
  const chain = createStructuredCliChain(claimSchema, CLAIM_SHAPE);
  return async draft => (await chain.invoke(extractionPrompt(draft))).claims as Claim[];
}

// ---------------------------------------------------------------------------
// Corpus walking
// ---------------------------------------------------------------------------

function walkMarkdown(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkMarkdown(full));
    else if (entry.isFile() && entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}

const displayPath = (abs: string, scanRoot: string): string => {
  const fromRepo = path.relative(REPO_ROOT, abs);
  return fromRepo.startsWith('..') ? path.relative(path.dirname(scanRoot), abs) : fromRepo;
};

function readDraft(abs: string, scanRoot: string): DraftInput | null {
  const raw = fs.readFileSync(abs, 'utf8');
  let parsed: ReturnType<typeof matter>;
  try {
    parsed = matter(raw);
  } catch {
    return null;
  }
  const fm = parsed.data as Record<string, unknown>;
  if (Object.keys(fm).length === 0) return null; // prose file, nothing to ground
  return { file: displayPath(abs, scanRoot), frontmatter: fm, body: parsed.content, raw };
}

const SOURCE_PR_RE = /^([^#]+)#(\d+)$/;

/**
 * Anchors for the OTHER PRs a collapsed draft covers. A draft that merged a
 * duplicate cluster carries `source_prs[]`, and its Related Files span every one
 * of them, so checking only `source_sha` reports the siblings' files as untouched.
 */
function siblingAnchors(ctx: ProbeCtx, fm: Record<string, unknown>, canonical: Anchor | null): Anchor[] {
  const refs = Array.isArray(fm.source_prs) ? fm.source_prs : [];
  const out: Anchor[] = [];
  for (const ref of refs) {
    const m = typeof ref === 'string' ? SOURCE_PR_RE.exec(ref) : null;
    if (!m) continue;
    const pr = Number.parseInt(m[2], 10);
    if (canonical?.prNumber === pr) continue;
    const a = resolveAnchor(ctx, { prNumber: pr, repo: m[1] });
    if (a && a.sha !== canonical?.sha) out.push(a);
  }
  return out;
}

/**
 * Canonical PR ref: `source_pr`, else the first `source_prs[]` entry. The
 * hand-authored drafts carry only the array (schema: "source_pr remains the
 * canonical PR" — for them the first entry IS the canonical one), and without
 * this fallback their anchors never resolve and every commit-scoped claim
 * degrades to `unverifiable`.
 */
function canonicalPrRef(fm: Record<string, unknown>): RegExpExecArray | null {
  if (typeof fm.source_pr === 'string') return SOURCE_PR_RE.exec(fm.source_pr);
  const first = Array.isArray(fm.source_prs) ? fm.source_prs[0] : undefined;
  return typeof first === 'string' ? SOURCE_PR_RE.exec(first) : null;
}

/** Anchor metadata from frontmatter: source_sha first, then the canonical source PR number. */
function anchorFor(ctx: ProbeCtx, fm: Record<string, unknown>): Anchor | null {
  const sourcePr = canonicalPrRef(fm);
  return resolveAnchor(ctx, {
    prNumber: sourcePr ? Number.parseInt(sourcePr[2], 10) : undefined,
    sourceSha: typeof fm.source_sha === 'string' ? fm.source_sha : undefined,
    repo: sourcePr?.[1],
  });
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

const tally = (verdicts: Verdict[]): Record<Outcome, number> => {
  const counts = Object.fromEntries(OUTCOMES.map(o => [o, 0])) as Record<Outcome, number>;
  for (const v of verdicts) counts[v.outcome]++;
  return counts;
};

const contentHash = (raw: string): string => createHash('sha256').update(raw).digest('hex').slice(0, 16);

/** Languages whose fences are real source and so checkable against the tree. */
const CODE_FENCE = /^```(js|javascript|ts|typescript|jsx|tsx)\s*$/;
const REPO_PATH_RE =
  /\b(?:api|webapp|admin|sentinel|shared-libs|tests|ddocs|config|scripts)\/[A-Za-z0-9_./-]+\.(?:js|ts|json|less|css|html)\b/g;

/** Every cht-core path the draft names, from frontmatter and prose alike. */
function candidateFiles(draft: DraftInput): string[] {
  const out = new Set<string>();
  const entities = Array.isArray(draft.frontmatter.entities) ? draft.frontmatter.entities : [];
  for (const e of entities) if (typeof e === 'string') for (const m of e.matchAll(REPO_PATH_RE)) out.add(m[0]);
  for (const m of draft.raw.matchAll(REPO_PATH_RE)) out.add(m[0]);
  return [...out];
}

/**
 * Check every code fence against the files the draft names. Reporting "this
 * snippet is in none of the files this draft cites" avoids guessing which file a
 * fence belongs to, which prose rarely states unambiguously.
 */
function auditSnippets(ctx: ProbeCtx, draft: DraftInput, anchor: Anchor | null): SnippetFinding[] {
  if (!anchor || anchor.isRevert) return [];
  const files = candidateFiles(draft);
  if (files.length === 0) return [];
  const lines = draft.raw.split('\n');
  const out: SnippetFinding[] = [];

  for (let i = 0; i < lines.length; i++) {
    const open = CODE_FENCE.exec(lines[i].trim());
    if (!open) continue;
    const close = lines.indexOf('```', i + 1);
    if (close < 0) break;
    const snippet = lines.slice(i + 1, close).join('\n');
    i = close;
    if (snippet.replace(/\s+/g, '').length < 24) continue;   // too short to judge

    let anyMatch = false;
    let anyChecked = false;
    for (const f of files) {
      const res = snippetMatches(ctx, anchor.sha, f, snippet);
      if (res === null) continue;                             // file absent at the anchor
      anyChecked = true;
      if (res) { anyMatch = true; break; }
    }
    if (anyChecked && !anyMatch) {
      out.push({
        language: open[1],
        line: i + 1,
        excerpt: snippet.split('\n').slice(0, 3).join(' ⏎ ').slice(0, 160),
        checkedAgainst: files,
      });
    }
  }
  return out;
}

/**
 * Merge the deterministic enumeration with whatever the model noticed. The
 * enumerator is exhaustive over code-shaped claims and identical run to run;
 * the model adds semantic claims it cannot express. Dedup is by claim identity,
 * so a claim both produce is probed once.
 */
function mergeClaims(deterministic: Claim[], modelled: Claim[], raw: string): Claim[] {
  const key = (c: Claim): string =>
    `${c.kind}|${'symbol' in c ? c.symbol : ''}|${'file' in c ? c.file : ''}`;
  const out = [...deterministic];
  const seen = new Set(deterministic.map(key));
  for (const c of modelled) {
    if (seen.has(key(c))) continue;
    seen.add(key(c));
    out.push(c);
  }
  // Apply the context filters to EVERY claim, not just enumerated ones. The
  // model read 4278's "was not untested" sentence and produced a file-touched
  // claim from it; the enumerator would have skipped that line.
  return out
    .map(c => normaliseClaim(raw, c))
    .filter((c): c is Claim => c !== null)
    .filter(c => !quoteDisclaims(raw, c.quote))
    .map(c => (
      'scope' in c || !quoteIsPreFix(raw, c.quote) ? c : { ...c, scope: 'pre-fix' as const }
    ));
}

/** Ground one draft: extract claims, then probe each. */
async function groundOne(ctx: ProbeCtx, draft: DraftInput, extract: ExtractFn): Promise<DraftReport> {
  const anchor = anchorFor(ctx, draft.frontmatter);
  const base = {
    file: draft.file,
    contentHash: contentHash(draft.raw),
    anchor: anchor && {
      sha: anchor.sha, subject: anchor.subject, isRevert: anchor.isRevert,
      ...(anchor.note !== undefined && { note: anchor.note }),
    },
  };
  // The deterministic half never fails and never varies, so a model outage
  // degrades coverage to "code-shaped claims only" instead of to nothing.
  const enumerated = enumerateClaims(draft.raw);
  let claims: Claim[];
  try {
    claims = mergeClaims(enumerated, await extract(draft), draft.raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const verdicts = enumerated.map(c => checkClaim(ctx, anchor, c, siblingAnchors(ctx, draft.frontmatter, anchor)));
    return {
      ...base, verdicts, counts: tally(verdicts),
      error: `semantic extraction failed (${message}); ${enumerated.length} enumerated claims still checked`,
    };
  }
  const siblings = siblingAnchors(ctx, draft.frontmatter, anchor);
  const verdicts = claims.map(c => checkClaim(ctx, anchor, c, siblings)).map(v => {
    // The probe only saw the claim's own sentence; the draft may time-scope the
    // entity elsewhere (a "Note on paths" paragraph, an annotated Related File).
    if (v.drift && entityIsTimeScoped(draft.raw, v.drift.entity)) {
      return { ...v, drift: undefined };
    }
    return v;
  });
  const snippets = auditSnippets(ctx, draft, anchor);
  return { ...base, verdicts, counts: tally(verdicts), ...(snippets.length && { snippets }) };
}

/** Bounded-concurrency map preserving input order. */
async function pooled<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return out;
}

/**
 * Load the drafts a run should cover. Exported so sibling checkers (coherence)
 * select exactly the same set from the same flags rather than re-implementing the
 * walk and drifting out of step.
 */
export function loadDrafts(dir: string, opts: { base?: string; limit?: number; exec?: ExecFn } = {}): DraftInput[] {
  return selectDrafts(
    { base: opts.base, limit: opts.limit },
    path.resolve(REPO_ROOT, dir),
    opts.exec ?? defaultExec
  );
}

function selectDrafts(opts: GroundOptions, dir: string, exec: ExecFn): DraftInput[] {
  const all = walkMarkdown(dir)
    .toSorted((a, b) => a.localeCompare(b))
    .map(abs => readDraft(abs, dir))
    .filter((d): d is DraftInput => d !== null);

  if (!opts.base) return opts.limit ? all.slice(0, opts.limit) : all;

  const raw = exec('git', ['-C', dir, 'diff', '--name-only', `${opts.base}...HEAD`]);
  const changed = new Set(raw.split('\n').map(l => l.trim()).filter(Boolean));
  if (changed.size === 0) {
    throw new Error(`--changed-only produced an empty diff against ${opts.base} (shallow checkout?)`);
  }
  const picked = all.filter(d => changed.has(d.file));
  // A non-empty diff that matches no draft means the two sides are speaking
  // different path languages: `--dir` points outside this repo, so git reports
  // paths relative to THAT repo root while display paths are relative to this
  // one. Selecting nothing would then be reported as "all clean", which is the
  // worst possible failure for a verification tool.
  if (picked.length === 0) {
    throw new Error(
      `--changed-only matched none of the ${all.length} drafts under ${dir}, though ${changed.size} ` +
        'file(s) changed. This happens when --dir points outside the repo running the tool: run a ' +
        'full scan without --changed-only, or run the tool from the repo that owns those drafts.'
    );
  }
  return opts.limit ? picked.slice(0, opts.limit) : picked;
}

export interface GroundResult {
  reports: DraftReport[];
  outDir: string;
  chtCoreSha: string;
  totals: Record<Outcome, number>;
}

/**
 * Ground every selected draft and write the reports. Returns the reports so
 * callers (and tests) never have to read them back off disk.
 */
export async function groundClaims(opts: GroundOptions = {}): Promise<GroundResult> {
  const chtCorePath = opts.chtCorePath ?? process.env.CHT_CORE_PATH;
  if (!chtCorePath) {
    throw new Error('cht-core checkout required: pass --cht-core <path> or set CHT_CORE_PATH');
  }
  const exec = opts.exec ?? defaultExec;
  const ctx: ProbeCtx = {
    chtCorePath, exec, fallbackRef: opts.fallbackRef, apiResolve: opts.apiResolve, prFiles: new Map(), treeCache: new Map(),
  };
  const dir = path.resolve(REPO_ROOT, opts.dir ?? 'agent-memory');
  const extract = opts.extractFn ?? cliExtractor();

  const drafts = selectDrafts(opts, dir, exec);
  const reports = await pooled(drafts, opts.concurrency ?? 3, d => groundOne(ctx, d, extract));

  const totals = Object.fromEntries(OUTCOMES.map(o => [o, 0])) as Record<Outcome, number>;
  for (const r of reports) for (const o of OUTCOMES) totals[o] += r.counts[o];

  const chtCoreSha = exec('git', ['-C', chtCorePath, 'rev-parse', 'HEAD']).trim();
  const outDir = path.resolve(REPO_ROOT, opts.outDir ?? path.join('outputs', 'verification', opts.label ?? 'local'));
  writeReports(outDir, reports, { chtCorePath, chtCoreSha, totals });

  return { reports, outDir, chtCoreSha, totals };
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

interface ReportMeta {
  chtCorePath: string;
  chtCoreSha: string;
  totals: Record<Outcome, number>;
}

/** Markdown summary: the ungrounded findings first, since those are the work. */
export function renderReport(reports: DraftReport[], meta: ReportMeta): string {
  const lines = [
    '# Claim grounding report',
    '',
    `- cht-core: \`${meta.chtCorePath}\` @ \`${meta.chtCoreSha.slice(0, 10)}\``,
    `- drafts verified: ${reports.length}`,
    `- claims: ${OUTCOMES.map(o => `${meta.totals[o]} ${o}`).join(', ')}`,
    '',
    'A `grounded` claim was confirmed against the source tree. `unverifiable` means the',
    'probe could not run — it is NOT a pass. `fallback` provenance means the anchor commit',
    'would not resolve and the claim was checked against the tree-wide ref instead.',
    '',
  ];

  const withFindings = reports.filter(r => r.counts.ungrounded > 0);
  lines.push(`## Ungrounded claims (${withFindings.length} draft(s))`, '');
  if (!withFindings.length) lines.push('_None._', '');
  for (const r of withFindings) {
    lines.push(`### \`${r.file}\``);
    lines.push(`anchor: ${r.anchor ? `\`${r.anchor.sha.slice(0, 10)}\` — ${r.anchor.subject}` : '_unresolved_'}` +
      `${r.anchor?.note ? ` _(${r.anchor.note})_` : ''}  `);
    lines.push(`content hash: \`${r.contentHash}\``, '');
    for (const v of r.verdicts.filter(x => x.outcome === 'ungrounded')) {
      lines.push(`- **${describeClaim(v.claim)}** _(${v.provenance ?? 'anchor'})_`);
      lines.push(`  - draft says: "${v.claim.quote.trim()}"`);
      lines.push(`  - probe: ${v.evidence}`);
      if (v.suggestion) lines.push(`  - real: ${v.suggestion}`);
    }
    lines.push('');
  }

  const blocked = reports.filter(r => r.counts['anchor-unusable'] > 0 || r.error);
  if (blocked.length) {
    lines.push('## Could not be verified', '');
    for (const r of blocked) {
      lines.push(`- \`${r.file}\` — ${r.error ?? 'anchor is a revert; grounding against it would be wrong'}`);
    }
    lines.push('');
  }

  const withSnippets = reports.filter(r => r.snippets?.length);
  if (withSnippets.length) {
    lines.push('## Code fences matching nothing in the files the draft names', '');
    lines.push('Every identifier in these may be real while the block as written exists nowhere —',
      'a composite assembled from separate helpers. Replace with the real code or drop the fence.', '');
    for (const r of withSnippets) {
      lines.push(`### \`${r.file}\``);
      for (const s of r.snippets ?? []) {
        lines.push(`- L${s.line} (\`${s.language}\`): ${s.excerpt}`);
        lines.push(`  - checked against: ${s.checkedAgainst.join(', ')}`);
      }
      lines.push('');
    }
  }

  const drifted = reports.filter(r => r.verdicts.some(v => v.drift));
  if (drifted.length) {
    lines.push('## Stale as written (true at the anchor, gone from the current tree)', '');
    lines.push('These claims are correct about their own PR but name something the current tree no',
      'longer has, with no temporal qualifier — an agent reading the memory will take them as',
      'current. Time-scope them.', '');
    for (const r of drifted) {
      lines.push(`### \`${r.file}\``);
      for (const v of r.verdicts.filter(x => x.drift)) {
        lines.push(`- **${v.drift!.entity}** — ${v.drift!.note}`);
        lines.push(`  - draft says: "${v.claim.quote.trim()}"`);
      }
      lines.push('');
    }
  }

  const unverifiable = reports.filter(r => r.counts.unverifiable > 0);
  if (unverifiable.length) {
    lines.push('## Partially unverifiable (anchor unresolved)', '');
    for (const r of unverifiable) {
      lines.push(`- \`${r.file}\` — ${r.counts.unverifiable} claim(s) need the anchor commit; fetch cht-core and re-run`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

function describeClaim(claim: Claim): string {
  switch (claim.kind) {
    case 'symbol': return `\`${claim.symbol}\` does not exist`;
    case 'symbol-in-file': return `\`${claim.symbol}\` is not in \`${claim.file}\``;
    case 'file-touched': return `\`${claim.file}\` ${claim.status ? `was not ${claim.status}` : 'was not touched'} by this PR`;
    case 'path-exists': return `\`${claim.file}\` does not exist`;
    case 'release-branch': return `not backported to \`${claim.branch}\``;
  }
}

function writeReports(outDir: string, reports: DraftReport[], meta: ReportMeta): void {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, 'claims.json'),
    JSON.stringify({ ...meta, reports }, null, 2) + '\n',
    'utf8'
  );
  fs.writeFileSync(path.join(outDir, 'REPORT.md'), renderReport(reports, meta), 'utf8');
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

/* istanbul ignore next */
function argValue(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}

/* istanbul ignore next */
async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (!isUsingCLIProvider() && !process.env.OPENROUTER_API_KEY && !process.env.ANTHROPIC_API_KEY) {
    console.error('No LLM available: set LLM_PROVIDER=claude-cli (uses the claude binary, no API key) ' +
      'or provide OPENROUTER_API_KEY / ANTHROPIC_API_KEY.');
    process.exit(1);
  }
  const limitArg = argValue(argv, '--limit');
  const concArg = argValue(argv, '--concurrency');
  const result = await groundClaims({
    dir: argValue(argv, '--dir'),
    base: argv.includes('--changed-only') ? (argValue(argv, '--base') ?? 'origin/main') : undefined,
    chtCorePath: argValue(argv, '--cht-core'),
    outDir: argValue(argv, '--out'),
    label: argValue(argv, '--label'),
    fallbackRef: argValue(argv, '--fallback-ref'),
    limit: limitArg ? Number.parseInt(limitArg, 10) : undefined,
    concurrency: concArg ? Number.parseInt(concArg, 10) : undefined,
    apiResolve: argv.includes('--no-api-resolve') ? false : undefined,
  });

  const { totals } = result;
  const driftCount = result.reports.reduce((n, r) => n + r.verdicts.filter(v => v.drift).length, 0);
  const snippetCount = result.reports.reduce((n, r) => n + (r.snippets?.length ?? 0), 0);
  console.log(`\nground-claims: ${result.reports.length} drafts, ` +
    OUTCOMES.map(o => `${totals[o]} ${o}`).join(', ') +
    `, ${driftCount} stale-as-written, ${snippetCount} unmatched-snippet`);
  console.log(`report: ${path.relative(REPO_ROOT, result.outDir)}/REPORT.md`);
  for (const r of result.reports.filter(x => x.counts.ungrounded > 0)) {
    console.log(`  ✗ ${r.file} — ${r.counts.ungrounded} ungrounded`);
  }
  for (const r of result.reports.filter(x => x.verdicts.some(v => v.drift))) {
    console.log(`  ~ ${r.file} — ${r.verdicts.filter(v => v.drift).length} stale-as-written`);
  }
  for (const r of result.reports.filter(x => x.snippets?.length)) {
    console.log(`  ~ ${r.file} — ${r.snippets?.length} unmatched snippet(s)`);
  }
  // 1 = the draft says something false. 3 = needs attention but nothing is
  // disproven (anchor unresolved, or true-but-stale wording). Keeping drift out
  // of the exit-1 class preserves `ungrounded` as the "this is wrong" signal.
  if (totals.ungrounded > 0 || snippetCount > 0) process.exit(1);
  if (totals.unverifiable > 0 || totals['anchor-unusable'] > 0 || driftCount > 0) process.exit(3);
}

/* istanbul ignore next */
if (require.main === module) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
