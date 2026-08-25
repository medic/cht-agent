/**
 * Test-data helpers for the Test Environment Layer.
 *
 * Everything prepareTestData needs around the cht-conf runner: reading the
 * json_docs directory csv-to-docs produced (the fs access is isolated here,
 * the way cht-readiness.ts isolates fetch), classifying seeded docs against
 * the discovered config, and parsing cht-conf's stdout (upload-docs summary,
 * create-users progress). cht-conf logs every level to STDOUT with ANSI color
 * prefixes (cht-conf's src/lib/log.js), so the parsers strip escapes first.
 *
 * Verified against the installed cht-conf 6.5.0 src: csv-to-docs.js writes
 * `<project>/json_docs/<id>.doc.json`; upload-docs.js logs
 * "Summary: <ok> of <total> docs uploaded OK."; create-users.js logs
 * "Creating user <username>" before each POST /api/v1/users.
 */

import { readdirSync, readFileSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { DiscoveredConfig } from '../types';

const DOC_FILE_EXTENSION = '.doc.json';

/** A doc csv-to-docs generated, reduced to what classification needs. */
export interface SeededDoc {
  id: string;
  type: string;
  contactType?: string;
}

/** Doc counts per TestDataResult bucket, plus classification warnings. */
export interface SeededDocCounts {
  places: number;
  people: number;
  reports: number;
  warnings: string[];
}

// cht-conf's log lines carry ANSI color codes (e.g. \x1b[32mINFO ... \x1b[0m).
// eslint-disable-next-line no-control-regex
const ANSI_ESCAPES = /\x1b\[[0-9;]*m/g;

const stripAnsi = (output: string): string => output.replace(ANSI_ESCAPES, '');

/**
 * Parse upload-docs' summary line ("Summary: 12 of 12 docs uploaded OK.").
 * Returns undefined when no summary was printed — upload-docs exits 0 without
 * one when json_docs is missing or empty, so absence means "nothing uploaded".
 */
export const parseUploadDocsSummary = (output: string): { uploaded: number; total: number } | undefined => {
  const match = /summary: (\d+) of (\d+) docs uploaded ok/i.exec(stripAnsi(output));
  if (!match) {
    return undefined;
  }
  return { uploaded: Number.parseInt(match[1], 10), total: Number.parseInt(match[2], 10) };
};

/**
 * Count create-users' "Creating user <name>" progress lines. Each line is
 * logged immediately BEFORE the POST /api/v1/users call, so on a clean exit
 * the count equals the users created; on a failed exit the last logged
 * attempt is the one that blew up (callers subtract it).
 */
export const countCreatedUsers = (output: string): number => {
  const matches = stripAnsi(output).match(/\bCreating user /g);
  return matches ? matches.length : 0;
};

/** True when the data project has a users.csv for create-users to consume. */
export const hasUsersCsv = (dataPath: string): boolean => existsSync(join(dataPath, 'users.csv'));

/**
 * Remove the .doc.json files a previous csv-to-docs run left behind in
 * `<dataPath>/json_docs`. csv-to-docs never cleans the directory (it warns
 * "There are already docs in <dir>" and writes alongside), so without this a
 * superseded dataset's docs would be re-uploaded and counted as the current
 * run's data. Only *.doc.json files are removed — upload-docs report logs and
 * anything else stay. Returns how many files were removed.
 */
export const cleanSeededDocs = (dataPath: string): number => {
  const docDir = join(dataPath, 'json_docs');
  if (!existsSync(docDir)) {
    return 0;
  }
  const names = readdirSync(docDir).filter((name) => name.endsWith(DOC_FILE_EXTENSION));
  for (const name of names) {
    unlinkSync(join(docDir, name));
  }
  return names.length;
};

/**
 * Read the docs csv-to-docs generated at `<dataPath>/json_docs`. Returns []
 * when the directory does not exist (csv-to-docs warns-and-skips when there
 * is no csv/ input, leaving no json_docs behind — the agent turns the empty
 * list into a warning). A malformed doc file throws: the seeding evidence and
 * the reset worklist both come from this listing, so guessing is worse than
 * failing loudly.
 */
export const readSeededDocs = (dataPath: string): SeededDoc[] => {
  const docDir = join(dataPath, 'json_docs');
  if (!existsSync(docDir)) {
    return [];
  }
  return readdirSync(docDir)
    .filter((name) => name.endsWith(DOC_FILE_EXTENSION))
    .sort()
    .map((name) => {
      const raw = readFileSync(join(docDir, name), 'utf-8');
      const doc = JSON.parse(raw) as { _id?: string; type?: string; contact_type?: string };
      return {
        id: doc._id ?? name.slice(0, -DOC_FILE_EXTENSION.length),
        type: doc.type ?? '',
        ...(doc.contact_type !== undefined ? { contactType: doc.contact_type } : {}),
      };
    });
};

/** Which TestDataResult bucket a single seeded doc counts toward. */
type DocBucket = 'places' | 'people' | 'reports' | 'skip';

/** Configurable hierarchies store the real type in contact_type. */
const resolveContactType = (doc: SeededDoc): string =>
  doc.type === 'contact' ? (doc.contactType ?? '') : doc.type;

/**
 * Decide the bucket for one seeded doc against the discovered config. `skip` is
 * a `user` account artifact (create-users owns that count). The resolved
 * contact type is returned for the unknown-type warning.
 */
const classifyOneDoc = (
  doc: SeededDoc,
  personTypes: Set<string>
): { bucket: DocBucket; contactType: string } => {
  if (doc.type === 'data_record') {
    return { bucket: 'reports', contactType: doc.type };
  }
  if (doc.type === 'user') {
    return { bucket: 'skip', contactType: doc.type };
  }
  const contactType = resolveContactType(doc);
  if (contactType === 'person' || personTypes.has(contactType)) {
    return { bucket: 'people', contactType };
  }
  return { bucket: 'places', contactType };
};

/** Once-per-type bookkeeping for the unknown-contact-type warning. */
interface UnknownTypeTracker {
  /** Contact type ids present in the discovered config. */
  known: Set<string>;
  /** Types already warned about, so each warns at most once. */
  warned: Set<string>;
}

/**
 * Warn once per contact type that landed in `places` without being in the
 * discovered config (an unknown type counted as a place).
 */
const noteUnknownType = (
  bucket: DocBucket,
  contactType: string,
  tracker: UnknownTypeTracker,
  warnings: string[]
): void => {
  if (bucket === 'places' && !tracker.known.has(contactType) && !tracker.warned.has(contactType)) {
    tracker.warned.add(contactType);
    warnings.push(`contact type "${contactType}" is not in the discovered config; counted as a place`);
  }
};

/**
 * Classify seeded docs into TestDataResult buckets using the DISCOVERED
 * config (a `person: true` contact type counts as a person even under a
 * custom hierarchy). `user` docs are csv-to-docs artifacts of users.*.csv
 * inputs, not accounts — create-users owns the usersCreated count, so they
 * are tracked for reset but not counted here. Unknown contact types count as
 * places, once-per-type warned.
 */
export const classifySeededDocs = (docs: SeededDoc[], config: DiscoveredConfig): SeededDocCounts => {
  const personTypes = new Set(
    config.contactTypes.filter((contactType) => contactType.person === true).map((contactType) => contactType.id)
  );
  const tracker: UnknownTypeTracker = {
    known: new Set(config.contactTypes.map((contactType) => contactType.id)),
    warned: new Set<string>(),
  };
  const counts: SeededDocCounts = { places: 0, people: 0, reports: 0, warnings: [] };

  for (const doc of docs) {
    const { bucket, contactType } = classifyOneDoc(doc, personTypes);
    if (bucket === 'skip') {
      continue;
    }
    noteUnknownType(bucket, contactType, tracker, counts.warnings);
    counts[bucket] += 1;
  }

  return counts;
};
