import { TestGenModuleInput } from '../interface';
import { countLines } from './budget';

/**
 * Awareness of the specs that already exist in the target repo.
 *
 * The test-gen plan call runs with `disableTools: true` and nothing populates
 * `TestGenModuleInput.existingTestExamples` or `directoryListing`, so the
 * planner has never been able to see the repo's own suites. The measured result:
 * m4 invented a `test/unit/` mirror tree (14 of its 22 spec files) that the
 * partner repo does not have, and m3 wrote six parallel specs beside the two the
 * ticket had pinned in `qaSpecs`. Everything here is plain IO through the
 * module's existing `listDirectory`/`readFile` closures — no LLM tool use — so
 * it works identically on the API and claude-cli providers.
 */

const SPEC_RE = /\.(spec|test)\.[cm]?[jt]sx?$/i;
const AGENT_SPEC_RE = /\.agent\.(spec|test)\.[cm]?[jt]sx?$/i;
const TEST_ROOT = 'test';
/** `test/` plus one level of subdirectory covers all 94 tracked partner specs. */
const MAX_DEPTH = 2;
const MAX_INVENTORY_ENTRIES = 400;
const MAX_NAMES_PER_DIR = 12;
const MAX_PINNED_EXAMPLES = 2;
const MAX_PINNED_EXAMPLE_LINES = 150;
const MAX_EXTENSION_LINES = 400;

/** A spec file already present in the target repo. */
export interface ExistingSpec {
  /** Repo-relative, POSIX separators (e.g. `test/tasks/immunization_service.spec.js`). */
  path: string;
  /** True for a spec an earlier run of this pipeline wrote (`*.agent.spec.js`). */
  agentOwned: boolean;
  /** Set only for specs we read: the ticket's pins and our own agent specs. */
  content?: string;
  /** Line count; present whenever `content` is. */
  lines?: number;
}

export interface SpecContext {
  /** Every spec found under `test/` (depth 2), read or not. */
  existing: ExistingSpec[];
  /** The ticket's `qaSpecs`, expanded and resolved against disk, with content. */
  pinned: ExistingSpec[];
  /** Raw `qaSpecs` values off the ticket, in order. */
  requestedPins: string[];
  /** Pins that resolve to nothing on disk (a ticket error, not a silent drop). */
  missingPins: string[];
  /** True when the walk hit its entry cap, so the inventory is partial. */
  truncated: boolean;
}

export const EMPTY_SPEC_CONTEXT: SpecContext = {
  existing: [], pinned: [], requestedPins: [], missingPins: [], truncated: false,
};

/** Any plan item with a destination path (structurally satisfied by TestPlanItem). */
export interface PlanPathItem {
  filePath: string;
  targetSourceFile?: string;
  description?: string;
}

export const normalizeRel = (p: string): string =>
  p.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/+$/, '');

const dirOf = (p: string): string => {
  const rel = normalizeRel(p);
  const idx = rel.lastIndexOf('/');
  return idx === -1 ? '.' : rel.slice(0, idx);
};

const baseOf = (p: string): string => normalizeRel(p).split('/').pop() ?? '';

export const isAgentOwnedSpec = (p: string): boolean => AGENT_SPEC_RE.test(baseOf(p));

/**
 * Collapse a spec name to a comparison key. `child-pnc-followup-source-id` and
 * `child-pnc-followup-sourceid` — the near-duplicate pair m3 actually shipped —
 * are ONE name under this slug.
 */
export const specSlug = (specPath: string): string =>
  baseOf(specPath)
    .replace(SPEC_RE, '')
    .replace(/\.agent$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

const dedupeKey = (specPath: string): string => `${dirOf(specPath)}::${specSlug(specPath)}`;

/** The `<base>.agent.spec.js` sibling, the one destination that never clobbers a partner file. */
export const agentSibling = (specPath: string): string => {
  const dir = dirOf(specPath);
  const base = baseOf(specPath).replace(SPEC_RE, '').replace(/\.agent$/i, '');
  const file = `${base}.agent.spec.js`;
  return dir === '.' ? file : `${dir}/${file}`;
};

const walkSpecs = async (
  listDirectory: (dirPath: string) => Promise<string[]>,
): Promise<{ paths: string[]; truncated: boolean }> => {
  const paths: string[] = [];
  const queue: Array<{ dir: string; depth: number }> = [{ dir: TEST_ROOT, depth: 0 }];
  let truncated = false;
  while (queue.length > 0 && !truncated) {
    const next = queue.shift();
    if (!next) break;
    const entries = await listDirectory(next.dir);
    for (const entry of entries) {
      const rel = normalizeRel(entry);
      if (entry.endsWith('/')) {
        if (next.depth + 1 < MAX_DEPTH) queue.push({ dir: rel, depth: next.depth + 1 });
        continue;
      }
      if (!SPEC_RE.test(rel)) continue;
      if (paths.length >= MAX_INVENTORY_ENTRIES) {
        truncated = true;
        break;
      }
      paths.push(rel);
    }
  }
  return { paths: paths.sort((a, b) => a.localeCompare(b)), truncated };
};

const hydrate = async (
  specs: ExistingSpec[],
  wanted: Set<string>,
  readFile?: (filePath: string) => Promise<string | null>,
): Promise<void> => {
  if (!readFile) return;
  for (const spec of specs) {
    if (!spec.agentOwned && !wanted.has(spec.path)) continue;
    const content = await readFile(spec.path);
    if (content === null) continue;
    spec.content = content;
    spec.lines = countLines(content);
  }
};

/**
 * Expand `qaSpecs` the way the tier-2 hook does (see findTier2Specs): a
 * `.spec.js` entry names itself, a directory entry names the specs directly
 * inside it.
 */
const expandPins = (
  requested: ReadonlyArray<string>,
  all: ReadonlyArray<ExistingSpec>,
): string[] => {
  const out: string[] = [];
  for (const raw of requested) {
    const entry = normalizeRel(raw);
    if (SPEC_RE.test(entry)) {
      out.push(entry);
      continue;
    }
    out.push(...all.filter(s => dirOf(s.path) === entry).map(s => s.path));
  }
  return [...new Set(out)];
};

export const gatherSpecContext = async (input: TestGenModuleInput): Promise<SpecContext> => {
  const requestedPins = [...(input.ticket.issue.technical_context.qaSpecs ?? [])];
  if (!input.listDirectory) return { ...EMPTY_SPEC_CONTEXT, requestedPins };
  const found = await walkSpecs(input.listDirectory);
  const existing: ExistingSpec[] = found.paths.map(p => ({ path: p, agentOwned: isAgentOwnedSpec(p) }));
  const pinPaths = expandPins(requestedPins, existing);
  await hydrate(existing, new Set(pinPaths), input.readFile);
  const byPath = new Map(existing.map(s => [s.path, s]));
  const missingPins = requestedPins.filter(p => {
    const entry = normalizeRel(p);
    return SPEC_RE.test(entry) ? !byPath.has(entry) : !existing.some(s => dirOf(s.path) === entry);
  });
  return {
    existing,
    pinned: pinPaths.map(p => byPath.get(p)).filter((s): s is ExistingSpec => Boolean(s)),
    requestedPins,
    missingPins,
    truncated: found.truncated,
  };
};

/**
 * The one case where rewriting an existing file is safe automatically: the
 * destination is a spec THIS pipeline wrote (`*.agent.spec.js`) and we have its
 * current content to hand back to the model. A partner-authored spec is never an
 * extension target — see canonicalizeChtConfSpecPaths / dedupeSpecPlan, which
 * redirect to the `.agent.spec.js` sibling instead.
 */
export const findExtensionTarget = (ctx: SpecContext, specPath: string): ExistingSpec | undefined => {
  const match = ctx.existing.find(s => s.path === normalizeRel(specPath));
  return match?.agentOwned && match.content ? match : undefined;
};

type DedupeDecision = { filePath: string; note?: string } | { drop: string };

const decideDedupe = (
  item: PlanPathItem,
  claimed: Map<string, { path: string; existing: boolean; agentOwned: boolean }>,
): DedupeDecision => {
  const clash = claimed.get(dedupeKey(item.filePath));
  if (!clash) return { filePath: normalizeRel(item.filePath) };
  if (!clash.existing) {
    return { drop: `dropped near-duplicate spec: ${item.filePath} is the same name as ${clash.path}` };
  }
  if (clash.agentOwned) {
    const note = normalizeRel(item.filePath) === clash.path
      ? undefined
      : `near-duplicate spec name: ${item.filePath} folded into the existing agent spec ${clash.path}`;
    return note ? { filePath: clash.path, note } : { filePath: clash.path };
  }
  const sibling = agentSibling(clash.path);
  return {
    filePath: sibling,
    note: `partner spec ${clash.path} must not be rewritten: ${item.filePath} -> ${sibling}`,
  };
};

/**
 * Fold near-duplicate spec names against (a) the specs already on disk — which
 * includes previous runs' output, the cross-run case — and (b) earlier items in
 * this same plan. Never yields two items with the same destination, and never
 * yields a destination equal to a partner-authored spec.
 */
export const dedupeSpecPlan = <T extends PlanPathItem>(
  plan: ReadonlyArray<T>,
  ctx: SpecContext,
): { plan: T[]; notes: string[] } => {
  const notes: string[] = [];
  const claimed = new Map<string, { path: string; existing: boolean; agentOwned: boolean }>();
  for (const spec of ctx.existing) {
    claimed.set(dedupeKey(spec.path), { path: spec.path, existing: true, agentOwned: spec.agentOwned });
  }
  const emitted = new Set<string>();
  const out: T[] = [];
  for (const item of plan) {
    const decision = decideDedupe(item, claimed);
    if ('drop' in decision) {
      notes.push(decision.drop);
      continue;
    }
    if (decision.note) notes.push(decision.note);
    if (emitted.has(decision.filePath)) {
      notes.push(`dropped duplicate spec destination: ${item.filePath} -> ${decision.filePath}`);
      continue;
    }
    emitted.add(decision.filePath);
    claimed.set(dedupeKey(decision.filePath), {
      path: decision.filePath,
      existing: false,
      agentOwned: isAgentOwnedSpec(decision.filePath),
    });
    out.push(
      decision.filePath === normalizeRel(item.filePath) ? item : { ...item, filePath: decision.filePath },
    );
  }
  return { plan: out, notes };
};

/** Where each cht-conf artifact's specs live in a cht-conf project. */
const ARTIFACT_TEST_DIR: Readonly<Record<string, string>> = {
  form: 'test/forms',
  'contact-form': 'test/forms',
  task: 'test/tasks',
  target: 'test/targets',
  'contact-summary': 'test/contact-summary',
  purge: 'test',
};

const tokens = (text: string): string[] =>
  text.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length > 2);

const pinScore = (pin: string, item: PlanPathItem): number => {
  const pinTokens = new Set(tokens(baseOf(pin).replace(SPEC_RE, '')));
  const itemTokens = tokens(
    `${item.filePath} ${item.targetSourceFile ?? ''} ${item.description ?? ''}`,
  );
  return itemTokens.filter(t => pinTokens.has(t)).length;
};

const bestPin = (
  item: PlanPathItem,
  pins: ReadonlyArray<string>,
  used: Set<string>,
): string | undefined => {
  const scored = pins
    .filter(p => !used.has(p))
    .map(p => ({ pin: p, score: pinScore(p, item) }))
    .sort((a, b) => b.score - a.score)[0];
  return scored && scored.score > 0 ? scored.pin : undefined;
};

const slugFileName = (name: string): string => {
  const base = baseOf(name).replace(SPEC_RE, '').replace(/[^A-Za-z0-9._-]+/g, '_');
  return base.length > 0 ? base : 'generated';
};

const resolveDir = (
  item: PlanPathItem,
  opts: { configArtifact?: string; ctx: SpecContext },
): string => {
  const mapped = opts.configArtifact ? ARTIFACT_TEST_DIR[opts.configArtifact] : undefined;
  if (mapped) return mapped;
  const planned = dirOf(item.filePath);
  const known = new Set(opts.ctx.existing.map(s => dirOf(s.path)));
  return known.has(planned) ? planned : TEST_ROOT;
};

const resolveChtConfDestination = (
  item: PlanPathItem,
  opts: { configArtifact?: string; artifactName?: string; ctx: SpecContext },
  pinPaths: ReadonlyArray<string>,
  used: Set<string>,
): string => {
  const pin = bestPin(item, pinPaths, used);
  if (pin) {
    used.add(pin);
    return isAgentOwnedSpec(pin) ? pin : agentSibling(pin);
  }
  const dir = resolveDir(item, opts);
  const base = slugFileName(opts.artifactName ?? baseOf(item.filePath));
  const candidate = dir === '.' ? `${base}.spec.js` : `${dir}/${base}.spec.js`;
  const clash = opts.ctx.existing.find(s => s.path === candidate);
  return clash && !clash.agentOwned ? agentSibling(candidate) : candidate;
};

/**
 * Pin generated cht-conf spec paths onto the repo's own convention: the ticket's
 * pinned spec beside which the coverage belongs (as `<base>.agent.spec.js`), or
 * the artifact's conventional directory. No-op for cht-core, which has its own
 * layout (api/tests/mocha, webapp/tests).
 */
export const canonicalizeChtConfSpecPaths = <T extends PlanPathItem>(
  plan: ReadonlyArray<T>,
  opts: {
    layer?: string;
    configArtifact?: string;
    artifactName?: string;
    ctx: SpecContext;
  },
): { plan: T[]; notes: string[] } => {
  if (opts.layer !== 'cht-conf') return { plan: [...plan], notes: [] };
  const notes: string[] = [];
  const used = new Set<string>();
  const pinPaths = opts.ctx.pinned.map(p => p.path);
  const out = plan.map(item => {
    const destination = resolveChtConfDestination(item, opts, pinPaths, used);
    if (destination === normalizeRel(item.filePath)) return item;
    notes.push(`canonicalized spec path: ${item.filePath} -> ${destination}`);
    return { ...item, filePath: destination };
  });
  return { plan: out, notes };
};

export const renderSpecInventorySection = (ctx: SpecContext): string => {
  if (ctx.existing.length === 0) return '';
  const byDir = new Map<string, string[]>();
  for (const spec of ctx.existing) {
    const dir = dirOf(spec.path);
    byDir.set(dir, [...(byDir.get(dir) ?? []), baseOf(spec.path).replace(SPEC_RE, '')]);
  }
  const lines = [...byDir.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([dir, names]) => {
      const shown = names.slice(0, MAX_NAMES_PER_DIR);
      const more = names.length > shown.length ? `, +${names.length - shown.length} more` : '';
      return `- ${dir}/ (${names.length} spec(s)): ${shown.join(', ')}${more}`;
    });
  return `
## Specs That Already Exist In This Repo (${ctx.existing.length} file(s)${ctx.truncated ? ', list truncated' : ''})
These are the repo's own suites. Their directories and their naming ARE the convention.
${lines.join('\n')}

Rules the pipeline enforces (violations are rewritten or dropped, never merged):
- Use a directory that already appears above. Do NOT invent one — no new "test/unit/" tree
  when this repo keeps task specs in "test/tasks/".
- Follow the naming already used in that directory (one spec per artifact, named after the
  artifact).
- Never plan two names for one subject, and never a spelling variant of a name above
  ("x-source-id.spec.js" vs "x-sourceid.spec.js"). Variants are folded onto the first file,
  so the second one is wasted work.
- You may NOT rewrite a spec the partner authored. To add coverage beside one, name your
  file "<their-basename>.agent.spec.js" in the SAME directory.
- If a spec above already covers the behavior you were going to test, plan nothing for it.
  Fewer, closer files beat more, parallel ones.
`;
};

export const renderPinnedSpecSection = (ctx: SpecContext): string => {
  const withContent = ctx.pinned.filter(p => p.content);
  if (withContent.length === 0) return '';
  const blocks = withContent.slice(0, MAX_PINNED_EXAMPLES).map(spec => {
    const body = (spec.content ?? '').split('\n').slice(0, MAX_PINNED_EXAMPLE_LINES).join('\n');
    return `--- ${spec.path} (${spec.lines ?? 0} lines) ---\n${body}`;
  });
  return `
## The Ticket's Pinned Regression Surface (qaSpecs)
QA runs EXACTLY these specs for this ticket: ${ctx.pinned.map(p => p.path).join(', ')}.
They are the primary home for this ticket's coverage. Match their describe() titles, their
fixture/helper imports and their assertion style so your file reads as part of the same
suite, and assert only what the diff changed — do not restate a case already shown below.
${blocks.join('\n')}
`;
};

export const renderExtensionSection = (extending?: ExistingSpec): string => {
  if (!extending?.content) return '';
  const body = extending.content.split('\n').slice(0, MAX_EXTENSION_LINES).join('\n');
  return `
## You Are REWRITING An Existing Agent-Owned Spec (${extending.path}, ${extending.lines ?? 0} lines)
An earlier run of this pipeline wrote this file and your output REPLACES it. Output the
COMPLETE file: keep every existing it() block verbatim unless the change under test
invalidates it, then add the missing case(s). Do not rename, renumber or reformat the
existing cases, and do not drop their imports or fixtures.

--- current content of ${extending.path} ---
${body}
`;
};

/**
 * Honest warning when a generated spec sits outside the ticket's pins. Verified
 * in findTier2Specs (src/utils/cht-conf-tier2.ts): when `qaSpecs` names exact
 * files, tier-2 runs EXACTLY those, so a new `.agent.spec.js` sibling is written
 * but never executed until the ticket pins it.
 */
export const auditPinCoverage = (
  files: ReadonlyArray<{ path: string }>,
  ctx: SpecContext,
): string[] => {
  if (ctx.requestedPins.length === 0 || files.length === 0) return [];
  const pinned = new Set(ctx.pinned.map(p => p.path));
  const uncovered = files.map(f => normalizeRel(f.path)).filter(p => !pinned.has(p));
  if (uncovered.length === 0) return [];
  const merged = [...new Set([...ctx.requestedPins.map(normalizeRel), ...uncovered])];
  return [
    "generated spec(s) are outside the ticket's pinned qaSpecs, so tier-2 QA will NOT run " +
    `them: ${uncovered.join(', ')}. Add them to the ticket frontmatter:\nqaSpecs:\n` +
    merged.map(p => `  - ${p}`).join('\n'),
  ];
};
