/**
 * cht-core vocabulary snapshot + near-miss detection.
 *
 * The round-2 review of the promote PRs found drafts naming symbols that do not
 * exist in cht-core, each one edit-distance 1-2 from the real thing:
 * `con_create_people` (real `can_create_people`), `docs_by_type` (real
 * `doc_by_type`), `task.status` (real `task.state`). A distiller paraphrasing
 * from memory produces exactly this shape, and no JSON-schema check can see it.
 *
 * A committed vocabulary snapshot makes that class deterministic: extract
 * candidate tokens from a draft, and if a candidate is absent from the snapshot
 * but within `maxDistance` of a real term, it is a near-miss. Grouping terms
 * into families keeps the comparison scoped (a permission is never compared to
 * a view name), which is what keeps false positives down.
 *
 * The snapshot is committed so verification stays hermetic — CI needs no
 * cht-core checkout. Regenerate it with a checkout to hand:
 *   npm run build-vocab -- --cht-core /path/to/cht-core
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { REPO_ROOT } from './schema-utils';
import type { ExecFn } from './gh-classify';

export const VOCAB_PATH = path.join(REPO_ROOT, 'agent-memory', 'indices', 'cht-core-vocab.json');

/**
 * A group of related cht-core terms, compared only against each other.
 * `candidatePattern` extracts tokens of this shape from draft prose; any
 * extracted token not in `terms` but within `maxDistance` of one is a near-miss.
 */
export interface VocabFamily {
  name: string;
  description: string;
  /** Regex source (no flags) matching candidate tokens in draft text. */
  candidatePattern: string;
  /** Inclusive Levenshtein bound for calling a candidate a near-miss. */
  maxDistance: number;
  terms: string[];
}

/** A vocabulary snapshot, stamped with the checkout it was mined from. */
export interface Vocab {
  repo: string;
  /** Commit the snapshot was mined at — the provenance for every term below. */
  sha: string;
  families: VocabFamily[];
}

/**
 * Levenshtein distance, abandoned once it provably exceeds `limit` (returns
 * `limit + 1`). Near-miss detection only cares about small distances, so the
 * bound turns an O(mn) comparison against every term into a cheap one.
 *
 * @example
 * levenshtein('docs_by_type', 'doc_by_type', 2); // => 1
 * levenshtein('unrelated', 'doc_by_type', 2);    // => 3 (limit + 1, abandoned)
 */
export function levenshtein(a: string, b: string, limit: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > limit) return limit + 1;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      rowMin = Math.min(rowMin, curr[j]);
    }
    if (rowMin > limit) return limit + 1; // no cell in this row can improve
    prev = curr;
  }
  return prev[b.length];
}

/**
 * The closest real term to `token` within the family's distance bound, or null
 * when `token` is itself legitimate (present in `terms`) or too far from
 * anything to be a plausible typo.
 *
 * @example
 * nearMiss('con_create_people', permissionFamily); // => 'can_create_people'
 * nearMiss('can_create_people', permissionFamily); // => null (it is real)
 */
export function nearMiss(token: string, family: VocabFamily): string | null {
  if (family.terms.includes(token)) return null;
  let best: string | null = null;
  let bestDist = family.maxDistance + 1;
  for (const term of family.terms) {
    const d = levenshtein(token, term, family.maxDistance);
    if (d < bestDist) {
      best = term;
      bestDist = d;
    }
  }
  return bestDist <= family.maxDistance ? best : null;
}

/** Load the committed snapshot. Throws if it is missing or unparseable. */
export function loadVocab(vocabPath: string = VOCAB_PATH): Vocab {
  return JSON.parse(fs.readFileSync(vocabPath, 'utf8')) as Vocab;
}

// ---------------------------------------------------------------------------
// Generation (needs a cht-core checkout; not used by verification)
// ---------------------------------------------------------------------------

/** How each family is mined from a checkout. `filter` drops test-fixture noise. */
interface FamilySpec {
  name: string;
  description: string;
  candidatePattern: string;
  maxDistance: number;
  /** git-grep -oE pattern collecting raw matches. */
  minePattern: string;
  pathspecs: string[];
  /** Reduce a raw match to the bare term. */
  extract: (raw: string) => string;
  /** Keep only terms of the shape this family is about. */
  filter: (term: string) => boolean;
}

const FAMILY_SPECS: FamilySpec[] = [
  {
    name: 'permission',
    description: 'CHT permission names as referenced in code (can_*)',
    // Any short-prefixed <verb>_<object> token, so a fabricated `con_create_people`
    // is a candidate even though its prefix is not `can`.
    candidatePattern:
      '\\b[a-z]{2,5}_(?:create|add|edit|delete|update|view|export|configure|manage|access|bulk)_[a-z][a-z_]{2,}\\b',
    maxDistance: 2,
    minePattern: '\\bcan_[a-z][a-z_]{2,}\\b',
    pathspecs: ['*.js', '*.ts', '*.html', '*.json'],
    extract: raw => raw,
    filter: term => term.startsWith('can_'),
  },
  {
    name: 'couch-view',
    description: 'CouchDB view names of the <noun>_by_<key> shape',
    candidatePattern: '\\b[a-z][a-z0-9]*_by_[a-z][a-z0-9_]*\\b',
    maxDistance: 2,
    // git grep -E is POSIX ERE: no (?:...) non-capturing groups.
    minePattern: '(medic-client|medic)/[a-z][a-z0-9_]{3,}',
    pathspecs: ['*.js', '*.ts'],
    extract: raw => raw.slice(raw.lastIndexOf('/') + 1),
    filter: term => term.includes('_by_'),
  },
  {
    name: 'task-field',
    description: 'Fields on a scheduled-task object (task.*)',
    candidatePattern: '\\btask\\.[a-z][a-zA-Z_]+\\b',
    maxDistance: 2,
    minePattern: '\\btask\\.[a-z][a-zA-Z_]{1,}\\b',
    pathspecs: ['*.js', '*.ts'],
    extract: raw => raw,
    filter: () => true,
  },
];

const defaultExec: ExecFn = (file, args) =>
  execFileSync(file, args, { encoding: 'utf8', maxBuffer: 100 * 1024 * 1024 }) as string;

/**
 * git grep -hoE for a family's terms. Exit 1 means "no matches" and yields an
 * empty family; anything else (a bad pattern, a missing checkout) throws. A
 * silently-empty family would disable its whole check while still reporting
 * success — the one failure mode this snapshot must never have.
 */
function mine(chtCorePath: string, spec: FamilySpec, exec: ExecFn): string[] {
  let raw: string;
  try {
    raw = exec('git', ['-C', chtCorePath, 'grep', '-hoE', spec.minePattern, '--', ...spec.pathspecs]);
  } catch (err) {
    const status = (err as { status?: unknown }).status;
    if (status !== 1) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new Error(`mining family "${spec.name}" failed (git grep exit ${String(status)}): ${detail}`);
    }
    return [];
  }
  const terms = new Set<string>();
  for (const line of raw.split('\n')) {
    const token = spec.extract(line.trim());
    if (token && spec.filter(token)) terms.add(token);
  }
  return [...terms].toSorted((a, b) => a.localeCompare(b));
}

/**
 * Mine a vocabulary snapshot from a cht-core checkout. The recorded `sha` is the
 * checkout's HEAD, so a stale snapshot is visible rather than silent.
 */
export function buildVocab(chtCorePath: string, repo = 'medic/cht-core', exec: ExecFn = defaultExec): Vocab {
  const sha = exec('git', ['-C', chtCorePath, 'rev-parse', 'HEAD']).trim();
  return {
    repo,
    sha,
    families: FAMILY_SPECS.map(spec => ({
      name: spec.name,
      description: spec.description,
      candidatePattern: spec.candidatePattern,
      maxDistance: spec.maxDistance,
      terms: mine(chtCorePath, spec, exec),
    })),
  };
}

/* istanbul ignore next */
if (require.main === module) {
  const argv = process.argv.slice(2);
  const idx = argv.indexOf('--cht-core');
  if (idx < 0 || !argv[idx + 1]) {
    console.error('usage: npm run build-vocab -- --cht-core <path-to-cht-core-checkout>');
    process.exit(1);
  }
  const vocab = buildVocab(path.resolve(argv[idx + 1]));
  fs.writeFileSync(VOCAB_PATH, JSON.stringify(vocab, null, 2) + '\n', 'utf8');
  const counts = vocab.families.map(f => `${f.name}=${f.terms.length}`).join(' ');
  console.log(`wrote ${path.relative(REPO_ROOT, VOCAB_PATH)} at ${vocab.sha.slice(0, 10)} (${counts})`);
}
