/**
 * PR handoff bundle for cht-conf config changes.
 *
 * The agent never pushes and never opens PRs (see docker/docker-compose.cht-agent.yml:
 * no SSH keys, no write tokens, hardened .git/config). The operator raises the PR
 * against the real config repo by hand, so the pipeline's job is to leave behind
 * everything that needs copying out — a description to paste and a patch to apply:
 *
 *   docker cp cht-agent:/workspace/cht-conf-project/.cht-agent/pr ./pr
 *   git -C <real-config-repo> apply pr/changes.patch
 *
 * Written under `.cht-agent/` (where the XLSForm descriptor already lives) and
 * added to the project's .gitignore, so the bundle never rides into the PR it
 * describes.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { IssueTemplate, QaResult, TriagedRecommendation } from '../types';
import { summarizeLedger } from './recommendation-triage';
import {
  isTier2EnvironmentalFailure,
  tier2BaselineLine,
  tier2FailuresArePreExisting,
  tier2PassLine,
} from './cht-conf-tier2';

const execFileAsync = promisify(execFile);

/** Bundle location, relative to the config project root. */
export const PR_BUNDLE_DIR = path.join('.cht-agent', 'pr');
const GITIGNORE_ENTRY = '.cht-agent';

export interface PrBundleInput {
  /** The config project root (CHT_CONF_PATH). */
  configRoot: string;
  ticket: IssueTemplate;
  /**
   * Every config-relative path THIS ticket's development phase wrote — the union
   * across the first pass and any QA retries.
   *
   * This is the patch's SCOPE, not just a list to print. The config project is
   * not reset between tickets, so whatever else is dirty in the mount belongs to
   * someone else: an earlier ticket's spec files, or an operator environment fix
   * (the harness's Chromium `--no-sandbox` args in harness.defaults.json).
   * Observed shipping all six of the previous ticket's specs in a 779KB patch.
   * Empty/absent ⇒ no scope is known and the patch takes every change, as before.
   */
  filesWritten: ReadonlyArray<string>;
  /** QA evidence, when the closed loop ran. */
  qa?: QaResult;
  /**
   * m4: the development phase's recommendation ledger. Deferred correctness
   * items become a checklist in the PR body — the reviewer sees what validation
   * flagged and the pipeline did NOT fix.
   */
  recommendations?: ReadonlyArray<TriagedRecommendation>;
}

/** Why a dirty file is not in the patch. Rendered verbatim in PR.md. */
export type ExclusionReason = 'agent housekeeping' | 'not written by this ticket';

export interface ExcludedPath {
  /** Repo-relative path. */
  path: string;
  reason: ExclusionReason;
}

/** What `buildPatch` produced — the patch AND what it says about itself. */
export interface PatchScopeResult {
  /** The patch text; '' when nothing was captured. */
  patch: string;
  /**
   * The repo-relative paths that actually contributed hunks. PR.md's file lists
   * are rendered from THIS, so the document always describes the patch it ships
   * with — it used to print the final development pass's filesWritten, which
   * described a 25-file patch with 5 files.
   */
  files: string[];
  /** Dirty paths deliberately left out. Reported in PR.md, never dropped silently. */
  excluded: ExcludedPath[];
  /** True when a scope narrowed the patch; false when it took every change. */
  scoped: boolean;
  /** Set when scoping was abandoned because it would have shipped an empty patch. */
  scopeFallbackReason?: string;
  /** Scope entries git sees no change for — the write did not stick, or is ignored. */
  declaredButAbsent: string[];
}

export interface PrBundleResult {
  /** Absolute path to the bundle directory. */
  dir: string;
  descriptionPath: string;
  patchPath: string;
  /** True when the patch has content (a bundle with an empty patch is a red flag). */
  patchHasContent: boolean;
  /** The paths the patch contains — the same list PR.md describes. */
  files: string[];
  /** The dirty paths it deliberately omits, with reasons. */
  excluded: ExcludedPath[];
}

/**
 * Append `.cht-agent` to the project's .gitignore if absent.
 *
 * Idempotent, and deliberately the only write this module makes outside its own
 * directory: without it the bundle shows up as untracked files in the very PR it
 * is meant to describe.
 */
export const ensureGitignored = (configRoot: string): void => {
  const gitignorePath = path.join(configRoot, '.gitignore');
  let current = '';
  if (fs.existsSync(gitignorePath)) {
    current = fs.readFileSync(gitignorePath, 'utf8');
    const alreadyListed = current
      .split('\n')
      .map(line => line.trim())
      .some(line => line === GITIGNORE_ENTRY || line === `${GITIGNORE_ENTRY}/`);
    if (alreadyListed) return;
  }
  const separator = current === '' || current.endsWith('\n') ? '' : '\n';
  fs.appendFileSync(gitignorePath, `${separator}${GITIGNORE_ENTRY}\n`, 'utf8');
  console.log(`[PR bundle] Added ${GITIGNORE_ENTRY} to ${gitignorePath}`);
};

const git = async (configRoot: string, args: string[]): Promise<string> => {
  try {
    const { stdout } = await execFileAsync('git', args, { cwd: configRoot, maxBuffer: 32 * 1024 * 1024 });
    return stdout;
  } catch (error) {
    // `git diff --no-index` exits 1 when the inputs differ — that is the success
    // case for us, and the patch text is still on stdout.
    const withStdout = error as { stdout?: string };
    if (typeof withStdout.stdout === 'string' && withStdout.stdout !== '') {
      return withStdout.stdout;
    }
    return '';
  }
};

/**
 * Paths the bundle must never patch in: its own directory, and the .gitignore
 * line this module adds. Both are this module's OWN writes, so they are dropped
 * unconditionally — even when no ticket scope is known.
 *
 * This is a floor, not the rule. As the rule it leaked: two real patches also
 * carried harness.defaults.json (an operator Chromium `--no-sandbox` fix) and a
 * 22-line unrelated README.md, because a denylist can only ever name the
 * housekeeping we have already been burned by. The rule is the allowlist below.
 */
const isBundleHousekeeping = (rel: string): boolean =>
  rel === '.gitignore' || rel === '.cht-agent' || rel.startsWith('.cht-agent/');

/**
 * Put a caller-supplied path into the exact form git reports, so scope matching
 * cannot fail quietly — a miss would drop a real fix file out of the patch.
 */
export const toRepoRelative = (configRoot: string, candidate: string): string => {
  const cleaned = candidate.trim().replace(/\\/g, '/');
  if (cleaned === '') {
    return '';
  }
  const rel = path.isAbsolute(cleaned)
    ? path.relative(configRoot, cleaned).split(path.sep).join('/')
    : cleaned.replace(/^\.\//, '');
  return rel.replace(/\/+$/, '');
};

const splitLines = (out: string): string[] =>
  out.split('\n').map(l => l.trim()).filter(Boolean);

/**
 * Build a patch covering tracked edits AND new files, scoped to this ticket.
 *
 * `git diff HEAD` omits untracked files, and staging them with --intent-to-add
 * would mutate the operator's index. `git diff --no-index /dev/null <file>`
 * produces an applicable "new file" hunk without touching the repo at all.
 *
 * SCOPE (`scope` = the files this ticket's development phase wrote): the patch
 * ships exactly those. Everything else dirty in the mount is environment, not
 * change — the config project is never reset between tickets, so the working
 * copy accumulates previous tickets' files and operator fixes. Withheld files
 * are returned in `excluded` and printed in PR.md: silent truncation would be
 * worse than the leak, because an operator cannot judge a file they cannot see.
 */
export const buildPatch = async (
  configRoot: string,
  scope?: ReadonlyArray<string>,
): Promise<PatchScopeResult> => {
  const trackedChanged = splitLines(await git(configRoot, ['diff', '--name-only', 'HEAD']));
  const untracked = splitLines(await git(configRoot, ['ls-files', '--others', '--exclude-standard']));
  const dirty = [...trackedChanged, ...untracked];

  const housekeeping: ExcludedPath[] = dirty
    .filter(isBundleHousekeeping)
    .map(p => ({ path: p, reason: 'agent housekeeping' as const }));
  const candidates = dirty.filter(rel => !isBundleHousekeeping(rel));

  const wanted = new Set(
    (scope ?? [])
      .map(p => toRepoRelative(configRoot, p))
      .filter(p => p !== '' && !isBundleHousekeeping(p)),
  );
  let scoped = wanted.size > 0;
  let included = scoped ? candidates.filter(rel => wanted.has(rel)) : [...candidates];
  let scopeFallbackReason: string | undefined;
  // Scoping must never ship an empty patch: an operator reads that as "nothing to
  // apply", when it actually means the file list and the working copy disagree.
  if (scoped && included.length === 0 && candidates.length > 0) {
    scopeFallbackReason =
      'none of the files the development phase reported writing are dirty in the config repo, so the ' +
      'patch is NOT scoped to this ticket — it carries every change in the working copy. Review it by hand.';
    scoped = false;
    included = [...candidates];
  }

  const includedSet = new Set(included);
  const excluded: ExcludedPath[] = [
    ...housekeeping,
    ...candidates
      .filter(rel => !includedSet.has(rel))
      .map(rel => ({ path: rel, reason: 'not written by this ticket' as const })),
  ];

  const parts: string[] = [];
  const files: string[] = [];
  // `git diff --name-only` already lists only paths that differ from HEAD, so
  // this list IS the tracked contribution — no patch parsing needed to know what
  // went in.
  const trackedIncluded = trackedChanged.filter(rel => includedSet.has(rel));
  if (trackedIncluded.length > 0) {
    const tracked = await git(configRoot, ['diff', 'HEAD', '--', ...trackedIncluded]);
    if (tracked.trim() !== '') {
      parts.push(tracked.trimEnd());
      files.push(...trackedIncluded);
    }
  }
  for (const rel of untracked) {
    if (!includedSet.has(rel)) continue;
    const hunk = await git(configRoot, ['diff', '--no-index', '--', '/dev/null', rel]);
    if (hunk.trim() !== '') {
      parts.push(hunk.trimEnd());
      files.push(rel);
    }
  }

  return {
    patch: parts.length > 0 ? `${parts.join('\n')}\n` : '',
    files,
    excluded,
    scoped,
    ...(scopeFallbackReason ? { scopeFallbackReason } : {}),
    declaredButAbsent: [...wanted].filter(rel => !files.includes(rel)),
  };
};

/**
 * One QA fact: the line the report prints, and how that line bears on the
 * verdict. `label` is what the headline says when this fact decides it.
 */
interface QaFact {
  line: string;
  status: 'ok' | 'caveat' | 'fail';
  label?: string;
}

const VERDICT: Record<QaFact['status'], string> = {
  ok: 'PASSED',
  caveat: 'PASSED WITH CAVEATS',
  fail: 'DID NOT PASS',
};

const worstStatus = (facts: ReadonlyArray<QaFact>): QaFact['status'] => {
  if (facts.some(f => f.status === 'fail')) {
    return 'fail';
  }
  if (facts.some(f => f.status === 'caveat')) {
    return 'caveat';
  }
  return 'ok';
};

/**
 * The tier-2 lines.
 *
 * A tier-2 failure is a CAVEAT only when the pre-fix baseline proved every
 * failure was already there — that attribution is the whole point of
 * QaTier2Baseline. Unknown attribution stays a FAILURE (never excuse a possible
 * regression), and a failure whose browser never launched is named as the
 * environment problem it is rather than reported as a broken assertion.
 */
const tier2Facts = (qa: QaResult): QaFact[] => {
  const tier2 = qa.tier2;
  if (!tier2) {
    return [];
  }
  if (!tier2.ran) {
    return [{
      line: `- Tier-2 harness specs: not run — ${tier2.reason ?? 'no reason recorded'}`,
      status: 'ok',
    }];
  }
  const facts: QaFact[] = [];
  if (tier2.specs && tier2.specs.length > 0) {
    facts.push({
      line: `- Tier-2 specs run: ${tier2.specs.map(s => `\`${s}\``).join(', ')}`,
      status: 'ok',
    });
  }
  if (tier2.passed) {
    facts.push({ line: `- Tier-2 harness specs: ${tier2PassLine(tier2.outputTail)}`, status: 'ok' });
    return facts;
  }
  if (isTier2EnvironmentalFailure(tier2.outputTail)) {
    facts.push({
      line: '- Tier-2 harness specs: NOT PROVEN — the harness browser failed to launch, so the specs never ran',
      status: 'fail',
      label: 'tier-2 never ran (the harness browser failed to launch — an environment problem, not the fix)',
    });
    return facts;
  }
  const preExisting = tier2FailuresArePreExisting(tier2);
  facts.push({
    line: `- Tier-2 harness specs: FAILED\n  - ${tier2BaselineLine(tier2)}`,
    status: preExisting ? 'caveat' : 'fail',
    label: preExisting
      ? 'tier-2 specs failed, but the pre-fix baseline shows NO new failures from this change'
      : 'tier-2 harness specs failed, and the failures are not attributed to pre-existing breakage',
  });
  return facts;
};

/**
 * Facts first; the headline is derived from them.
 *
 * The old section took "Result: PASSED" from `qa.succeeded` and then listed
 * tier-2 independently, so PR.md printed "**Result: PASSED**" four lines above
 * "- Tier-2 harness specs: FAILED" and a skimming reviewer saw PASSED. Every
 * pass/fail line is now a fact carrying a status; the verdict is the worst
 * status present and the headline names the facts that produced it, so the
 * headline cannot contradict the lines under it.
 */
const qaFacts = (qa: QaResult): QaFact[] => {
  const applied = qa.applyResult?.succeeded === true;
  const facts: QaFact[] = [
    {
      line: `- Reproduced (red baseline): ${qa.reproduced ? 'yes' : 'no'}`,
      status: qa.reproduced ? 'ok' : 'fail',
      label: 'the symptom never reproduced pre-fix',
    },
    {
      line: `- Verified (green): ${qa.verified ? 'yes' : 'no'}`,
      status: qa.verified ? 'ok' : 'fail',
      label: 'the deployed artifact failed the green assertion',
    },
    {
      line: `- Config applied: ${applied ? 'yes' : 'no'}`,
      status: applied ? 'ok' : 'fail',
      label: qa.applyResult ? 'the config apply failed' : 'the config was never applied',
    },
  ];
  if (qa.revChanged !== undefined) {
    facts.push({
      line: `- Artifact rev changed: ${qa.revChanged ? 'yes' : 'no'}`,
      status: qa.revChanged ? 'ok' : 'caveat',
      label: 'the deployed artifact rev did not change, so the apply may have been a no-op',
    });
  }
  if (qa.redEvidence?.summary) {
    facts.push({ line: `- Red evidence: ${qa.redEvidence.summary}`, status: 'ok' });
  }
  if (qa.greenEvidence?.summary) {
    facts.push({ line: `- Green evidence: ${qa.greenEvidence.summary}`, status: 'ok' });
  }
  if (qa.abortReason) {
    facts.push({ line: `- Abort reason: ${qa.abortReason}`, status: 'ok' });
  }
  facts.push(...tier2Facts(qa));
  return facts;
};

const qaSection = (qa: QaResult | undefined): string => {
  if (!qa?.ran) {
    return '## QA\n\nThe QA closed loop did not run for this change.\n';
  }
  const facts = qaFacts(qa);
  const status = worstStatus(facts);
  const reasons = status === 'ok'
    ? []
    : facts.filter(f => f.status === status && f.label).map(f => f.label as string);
  const headline = reasons.length > 0
    ? `**Result: ${VERDICT[status]}** — ${reasons.join('; ')}`
    : `**Result: ${VERDICT[status]}**`;

  const lines = [
    '## QA (closed loop against a live CHT instance)',
    '',
    headline,
    '',
    ...facts.map(f => f.line),
  ];
  if (status === 'fail') {
    lines.push('', '> This change did not pass QA. Review the evidence before opening the PR.');
    if (qa.succeeded) {
      // Divergence is itself worth printing: the console said success, this
      // document says otherwise, and the reviewer needs to know which to trust.
      lines.push(
        '>',
        ">  The QA phase's own aggregate reported success. This document reports the stricter",
        '>  verdict because a fact above failed.',
      );
    }
  } else if (status === 'caveat') {
    lines.push('', '> QA passed WITH CAVEATS — read the qualified lines above before opening the PR.');
  }
  return `${lines.join('\n')}\n`;
};

const bulletList = (items: ReadonlyArray<string>, empty: string): string =>
  items.length > 0 ? items.map(f => `- \`${f}\``).join('\n') : empty;

/** In a cht-conf project every spec lives under `test/`; anything else is source. */
const isTestFile = (rel: string): boolean => /\.spec\.[jt]s$/.test(rel) || rel.startsWith('test/');

/**
 * Where the file lists come from, and what the patch could not honour. PR.md
 * must never claim a file set the patch it ships does not contain.
 */
const patchProvenance = (patch: PatchScopeResult): string => {
  const count = `${patch.files.length} file(s) in \`changes.patch\``;
  const lines: string[] = [];
  if (patch.scopeFallbackReason) {
    lines.push(`> **Warning:** ${patch.scopeFallbackReason}`, '', `_${count}._`);
  } else if (patch.scoped) {
    lines.push(`_${count}, scoped to the files this ticket's development phase wrote._`);
  } else {
    lines.push(`_${count}. No per-ticket file list; the patch carries every change in the working copy._`);
  }
  if (patch.declaredButAbsent.length > 0) {
    lines.push(
      '',
      '> **Warning:** the development phase reported writing these, but the config repo shows no',
      '> change for them — they are NOT in the patch:',
      ...patch.declaredButAbsent.map(f => `> - \`${f}\``),
    );
  }
  return lines.join('\n');
};

/**
 * What the patch deliberately left out.
 *
 * Silent truncation would be worse than the leak it fixes: an operator who
 * cannot see that a file was withheld cannot decide whether it belonged.
 */
const excludedSection = (patch: PatchScopeResult): string => {
  if (patch.excluded.length === 0) {
    return '';
  }
  const rows = patch.excluded.map(e => `- \`${e.path}\` — ${e.reason}`).join('\n');
  return `## Excluded from the patch

These files are dirty in the config working copy but are NOT part of this change,
so \`changes.patch\` leaves them out. If something here belongs in this PR, add it
by hand and say so in the PR description.

${rows}

The config project is not reset between tickets, so an earlier ticket's files and
operator environment fixes (e.g. the harness's Chromium \`--no-sandbox\` args in
\`harness.defaults.json\`) stay dirty in the mount.

`;
};

/**
 * m4: the validation recommendations with their dispositions. Deferred
 * correctness items are rendered as an unchecked checklist so a reviewer has to
 * look at each one; '' when there is nothing deferred.
 */
const recommendationSection = (
  recs: ReadonlyArray<TriagedRecommendation> | undefined,
): string => {
  if (!recs || recs.length === 0) {
    return '';
  }
  const counts = summarizeLedger(recs);
  const deferred = recs.filter(r => r.disposition === 'deferred');
  const blocking = deferred.filter(r => r.severity === 'blocking');
  const advisory = deferred.filter(r => r.severity === 'advisory');
  if (blocking.length === 0 && advisory.length === 0) {
    return '';
  }
  const lines: string[] = [
    '## Validation recommendations',
    '',
    `${counts.applied} applied during refinement · ${counts.deferredBlocking} deferred (correctness) · ` +
      `${counts.deferredAdvisory} deferred (advisory)`,
    '',
  ];
  if (blocking.length > 0) {
    lines.push('### Deferred — correctness (review before merging)', '');
    for (const rec of blocking) {
      lines.push(`- [ ] ${rec.text}`);
      lines.push(`  - _deferred: ${rec.deferralReason ?? 'no reason recorded'}_`);
    }
    lines.push(
      '',
      '> These were raised by validation and NOT applied. Each is a candidate defect in this change.',
      '',
    );
  }
  if (advisory.length > 0) {
    lines.push('### Deferred — advisory', '', ...advisory.map(r => `- ${r.text}`), '');
  }
  return `${lines.join('\n')}\n`;
};

export const buildPrDescription = (input: PrBundleInput, patch: PatchScopeResult): string => {
  const { ticket, qa, recommendations } = input;
  const issue = ticket.issue;
  // Both lists are read from the patch, so this document cannot describe a
  // different change from the one it ships. Deriving them from the final
  // development pass's filesWritten described a 25-file patch with 5 files.
  const sourceFiles = patch.files.filter(f => !isTestFile(f));
  const testFiles = patch.files.filter(isTestFile);
  const emptyWarning = patch.patch.trim() === ''
    ? '\n> **Warning:** the generated patch is empty — nothing was captured to apply.\n'
    : '';

  return `# ${issue.title}

> Generated by cht-agent. Review before opening — this is a draft, not an approved change.

**Type:** ${issue.type} | **Priority:** ${issue.priority} | **Domain:** ${issue.technical_context.domain}

## Problem

${issue.description.trim()}

## Requirements

${issue.requirements.map((r, i) => `${i + 1}. ${r}`).join('\n') || '_none stated_'}

## Acceptance criteria

${issue.acceptance_criteria.map((c, i) => `${i + 1}. ${c}`).join('\n') || '_none stated_'}

## Changes

${patchProvenance(patch)}

${bulletList(sourceFiles, '_no source files changed_')}

## Tests added

${bulletList(testFiles, '_no test files added_')}

${qaSection(qa)}
${recommendationSection(recommendations)}${excludedSection(patch)}## Applying this change

\`\`\`bash
# from the container host
docker cp cht-agent:/workspace/cht-conf-project/${PR_BUNDLE_DIR} ./pr

# in a clean checkout of the config repo
git checkout -b fix/${slugify(issue.title)}
git apply pr/changes.patch
git diff --stat        # confirm the change is what this document describes
\`\`\`
${emptyWarning}`;
};

const slugify = (text: string): string =>
  text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

/**
 * Write the PR bundle. Best-effort: a handoff artefact must never fail the run,
 * so callers get `undefined` on error rather than an exception.
 */
export const writePrBundle = async (input: PrBundleInput): Promise<PrBundleResult | undefined> => {
  try {
    // Patch first: ensureGitignored writes to .gitignore, and building the patch
    // beforehand keeps that write out of this run's diff regardless of whether
    // the file is tracked.
    const patch = await buildPatch(input.configRoot, input.filesWritten);

    const dir = path.join(input.configRoot, PR_BUNDLE_DIR);
    fs.mkdirSync(dir, { recursive: true });
    ensureGitignored(input.configRoot);

    const patchHasContent = patch.patch.trim() !== '';
    const description = buildPrDescription(input, patch);

    const descriptionPath = path.join(dir, 'PR.md');
    const patchPath = path.join(dir, 'changes.patch');
    fs.writeFileSync(descriptionPath, description, 'utf8');
    fs.writeFileSync(patchPath, patch.patch, 'utf8');

    const patchLabel = patchHasContent
      ? `${patch.files.length} file(s), git apply-able`
      : 'EMPTY — nothing captured';
    console.log(`\n📄 PR bundle written to ${dir}`);
    console.log(`   - PR.md          (description to paste)`);
    console.log(`   - changes.patch  (${patchLabel})`);
    if (patch.excluded.length > 0) {
      console.log(`   - ${patch.excluded.length} dirty file(s) excluded as not part of this ticket (listed in PR.md)`);
    }
    if (patch.declaredButAbsent.length > 0) {
      console.log(`   - ⚠️  ${patch.declaredButAbsent.length} reported-written file(s) show no change in the config repo`);
    }
    console.log(`   Copy out: docker cp cht-agent:${path.join(input.configRoot, PR_BUNDLE_DIR)} ./pr\n`);

    return {
      dir,
      descriptionPath,
      patchPath,
      patchHasContent,
      files: patch.files,
      excluded: patch.excluded,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[PR bundle] Skipped — ${message}`);
    return undefined;
  }
};
