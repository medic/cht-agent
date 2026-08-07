/**
 * Representative-form scope (hardening A + B).
 *
 * The QA oracle is SINGULAR by construction: `deriveVerifyOptions` takes
 * `technical_context.artifactName` and verifies exactly that one artifact
 * red→green. A ticket, however, routinely names several SITES of the same
 * defect — m7 names three copies of the age-only `is_orphan` gate
 * (`forms/contact/e_household-create.xml`, `forms/contact/f_client-create.xml`,
 * `forms/app/household_member_registration_reminder.xml`) — and the run said
 * nothing about the two it never touched. A reviewer reading "closed loop
 * succeeded ✅" had no way to see that the green covered one third of the scope.
 *
 * Making the oracle PLURAL is a five-layer refactor (measured: 71 compile errors
 * across 11 files); this module does the cheap, honest half instead — it makes
 * the representative choice LOUD. It derives, from the ticket alone, the sites
 * the ticket names that tier-1 did NOT verify, so the QA transition and the PR
 * body can both say so in one grep-able line.
 *
 * Everything here is PURE: no I/O, no LLM, no type change to
 * `VerifyArtifactOptions`. The input is prose written by a human, so every parse
 * is defensive — an unparseable ticket yields an empty extra-site list and the
 * run reports exactly what it does today.
 */

import { IssueTemplate } from '../types';

/**
 * File extensions that name a deployment-config SITE — somewhere a cht-conf fix
 * can actually land. Deliberately narrow: `.md`/`.png`/`.csv` references in a
 * ticket are documentation, not sites, and counting them would cry wolf.
 */
const SITE_EXTENSIONS = ['xml', 'xlsx', 'xlsm', 'js', 'json'] as const;

/**
 * A path-ish token embedded in prose. The ticket's Technical Context is bullets
 * of English with paths inline and in backticks, sometimes with a line suffix:
 *
 *   - `forms/contact/f_client-create.xml:19317` (individual client registration)
 *   - `e_household-create.xml:21329-21330`: `father_alive` / `mother_alive`
 *   - The newborn follow-up task (`tasks.js:1341-1370`) is ...
 *
 * The match ENDS at the extension, so the `:21441` / `:19314-19320` suffix and
 * any trailing markdown punctuation fall away on their own.
 */
const PATH_TOKEN_RE = new RegExp(
  String.raw`[A-Za-z0-9_@./-]*[A-Za-z0-9_-]\.(?:${SITE_EXTENSIONS.join('|')})\b`,
  'g'
);

/**
 * Project scaffolding a ticket mentions for context but which is never a fix
 * site (and, for `harness.defaults.json`, is explicitly operator-owned — see
 * the PR bundle's exclusion list).
 */
const NOISE_BASENAMES: ReadonlySet<string> = new Set([
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'harness.defaults.json',
  '.eslintrc.json',
]);

/**
 * Spec files are the TIER-2 surface, not a deployment site: nothing about them
 * is ever "deployment-verified", so counting one would be noise in a line whose
 * whole job is to name real, unverified config.
 */
const isSpecPath = (token: string): boolean => /(^|\/)test\//.test(token) || /\.spec\.[jt]s$/.test(token);

/** Basename of a config-relative path token (POSIX separators — ticket prose). */
const baseName = (token: string): string => token.slice(token.lastIndexOf('/') + 1);

/** Basename minus its extension: `forms/contact/f_client-create.xml` → `f_client-create`. */
const stemOf = (token: string): string => {
  const base = baseName(token);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
};

/**
 * Does the tier-1 oracle for `configArtifact` already cover a site with this
 * stem? This is what keeps the warning honest rather than noisy:
 *
 *  - `form` / `contact-form` → the XForm-bind oracle covers exactly the named
 *    form (its `.xml` and the `.xlsx` it was converted from share the stem).
 *  - `task` / `target` → the compiled-settings oracle compares the WHOLE
 *    compiled `tasks` / `targets` section, so `tasks.js` / `targets.js` are
 *    covered even when the ticket names a single task id inside them.
 *  - `contact-summary` → likewise for `contact-summary*.js` (`.templated.js`).
 *  - `app-settings` → whole-document: every source that compiles into
 *    `app_settings.json` is covered.
 *
 * So m3 (a `task` ticket naming only `tasks.js`) reports NO unverified sites,
 * while m4 (a `contact-summary` ticket that also names a form and `tasks.js`)
 * reports both — which is the truth about what its green proved.
 */
/**
 * Shared modules that compile-app-settings webpacks INTO a settings section, so
 * a settings ticket's tier-1 green already covers them. Deliberately a closed
 * list of the config root's known extras rather than "any .js": a JS file the
 * bundle does not reach must still be reported as unverified.
 */
const SETTINGS_BUNDLED_EXTRAS = new Set([
  'nools-extras',
  'common-extras',
  'contact-summary-extras',
]);

const isCoveredByTier1 = (
  stem: string,
  configArtifact: string | undefined,
  artifactName: string | undefined
): boolean => {
  if (artifactName && stem === artifactName) {
    return true;
  }
  switch (configArtifact) {
    // A settings section is a WEBPACK BUNDLE, not one file: compile-app-settings
    // packs the rules entry point together with the extras modules it requires,
    // and the compiled-settings oracle compares that bundled string. So a change
    // to nools-extras.js IS deployment-verified by a `task` ticket's green —
    // treating it as unverified cried wolf on m3 (nools-extras.js) and m4
    // (common-extras.js), turning honest passes into PASSED WITH CAVEATS.
    case 'task':
    case 'target':
      return stem === 'tasks' || stem === 'targets' || SETTINGS_BUNDLED_EXTRAS.has(stem);
    case 'contact-summary':
      return stem.startsWith('contact-summary') || SETTINGS_BUNDLED_EXTRAS.has(stem);
    case 'app-settings':
      return (
        stem === 'app_settings' ||
        stem === 'app-settings' ||
        stem === 'tasks' ||
        stem === 'targets' ||
        stem.startsWith('contact-summary') ||
        SETTINGS_BUNDLED_EXTRAS.has(stem)
      );
    default:
      return false;
  }
};

/** What tier-1 verified, and what the ticket named that it did not. */
export interface VerifyScope {
  /** The single artifact tier-1 verified (`technical_context.artifactName`). */
  verified?: string;
  /**
   * Config-relative sites the ticket names that tier-1 did NOT verify, in
   * ticket order, de-duplicated by stem (so `forms/contact/x.xml:19317` and a
   * later bare `x.xml:19402` count once). Paths are kept as the ticket wrote
   * them, minus any `:line` suffix, because that is what an operator greps for.
   */
  unverified: string[];
}

/** Ticket fields that carry file paths. `components` is the Technical Context. */
const scopeText = (issue: IssueTemplate): string[] => [
  ...issue.issue.technical_context.components,
  ...(issue.issue.technical_context.existing_references ?? []),
];

/**
 * Derive the representative-form scope from the ticket ALONE (no disk, no
 * deployment): the artifact tier-1 verifies, and the other sites the ticket
 * names. Never throws and never guesses — a ticket with no parseable paths, or
 * one whose paths all resolve to the verified artifact, yields
 * `unverified: []` and the caller stays silent.
 */
export const deriveVerifyScope = (issue: IssueTemplate): VerifyScope => {
  const { configArtifact, artifactName } = issue.issue.technical_context;
  const unverified: string[] = [];
  const seen = new Set<string>();
  for (const entry of scopeText(issue)) {
    if (typeof entry !== 'string') {
      continue;
    }
    for (const token of entry.match(PATH_TOKEN_RE) ?? []) {
      if (token.includes('node_modules/') || NOISE_BASENAMES.has(baseName(token)) || isSpecPath(token)) {
        continue;
      }
      const stem = stemOf(token);
      if (seen.has(stem) || isCoveredByTier1(stem, configArtifact, artifactName)) {
        continue;
      }
      seen.add(stem);
      unverified.push(token);
    }
  }
  return {
    ...(artifactName ? { verified: artifactName } : {}),
    unverified,
  };
};

/** How many site paths the line names before it collapses the rest into a count. */
const MAX_NAMED_SITES = 5;

/**
 * The one grep-able line that says the green is REPRESENTATIVE, not exhaustive.
 * Returns undefined when the ticket names no site beyond the verified artifact
 * (the single-artifact case), so single-site tickets read exactly as they do
 * today.
 */
export const representativeScopeLine = (scope: VerifyScope): string | undefined => {
  if (scope.unverified.length === 0) {
    return undefined;
  }
  const shown = scope.unverified.slice(0, MAX_NAMED_SITES);
  const overflow = scope.unverified.length - shown.length;
  const named = overflow > 0 ? `${shown.join(', ')}, +${overflow} more` : shown.join(', ');
  return (
    `tier-1 verified ${scope.verified ?? '(unnamed artifact)'}; ` +
    `${scope.unverified.length} further site(s) named by this ticket are NOT deployment-verified: ${named}`
  );
};

/** Convenience: the scope line straight from a ticket. */
export const ticketScopeLine = (issue: IssueTemplate): string | undefined =>
  representativeScopeLine(deriveVerifyScope(issue));

/**
 * B — when a tier-2 self-skip stops being honest and becomes a hole.
 *
 * Tier-2's self-skip philosophy is deliberate: a config repo with no runnable
 * harness must not fail a green loop. That holds while tier-1 verified the
 * whole scope — the loop still proved everything the ticket named.
 *
 * It stops holding on a multi-site ticket that PINNED its regression surface via
 * `qaSpecs`. There, tier-1 verified one site by construction and the pinned
 * specs were the ONLY thing that could have said anything about the others; a
 * skip means zero coverage of those sites, reported as a clean green. The pin
 * exists precisely so the run either exercises it or fails — so any skip of a
 * pinned surface counts here, not only a missing spec file (a missing harness
 * leaves the same hole).
 *
 * The single-artifact case keeps today's semantics exactly: no pin, or nothing
 * unverified, and the skip stays free.
 */
export const tier2SkipIsFatal = (opts: {
  /** The run pinned tier-2 specs (`technical_context.qaSpecs`). */
  pinnedSpecs: boolean;
  /** How many ticket-named sites tier-1 did NOT verify. */
  unverifiedSites: number;
}): boolean => opts.pinnedSpecs && opts.unverifiedSites > 0;
