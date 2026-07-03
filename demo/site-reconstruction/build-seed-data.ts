/**
 * build-seed-data.ts — reconstruct a cht-conf project's seed data from scrubbed exports.
 *
 * Reads a scrubbed contact/report JSON export plus an app_settings.json, derives the
 * place hierarchy from `contact_types[].parents`, and emits csv-to-docs-ready CSVs
 * (one per contact_type, one per report form) plus a create-users CSV.
 *
 * The emitted CSV grammar matches the INSTALLED cht-conf's csv-to-docs action exactly.
 * Grammar cited from cht-conf src/fn/csv-to-docs.js (v6.5.0):
 *   - filename prefix selects the doc kind: `contact.*.csv` -> {type:'contact'},
 *     `report.<form>.csv` -> {type:'data_record', form:'<form>'} (see the `switch(prefix)`);
 *   - column headers are `name`, `name:type` (type coercion) or a reference matcher
 *     `parent:<type> WHERE reference_id=COL_VAL` (see parseColumn / REF_MATCHER /
 *     matchesType / matchesWhereClause);
 *   - `_id` is derived by csv-to-docs itself via uuid5(canonical-json(doc)) (see withId),
 *     so we emit a `reference_id` business key (NOT a `documentID` column — that column is
 *     an edit-contacts.js convention, not a csv-to-docs one) and link parents by it.
 * The create-users CSV columns match cht-conf src/lib/generate-users-csv.js /
 * src/fn/create-users.js (username,password,roles,contact,phone,place,fullname,email;
 * `roles` is ':'-separated).
 *
 * No external dependencies: node:fs / node:path only. Output is deterministic.
 *
 * Run: npx tsx demo/site-reconstruction/build-seed-data.ts \
 *        --export <docs.json> --app-settings <app_settings.json> \
 *        --users <user-devices.json> --out <dir>
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

type Json = Record<string, unknown>;

interface ContactTypeDef {
  id: string;
  parents: string[];
  person: boolean;
}

interface CsvFile {
  /** path relative to the output dir, e.g. csv/contact.clinic.csv */
  relPath: string;
  headers: string[];
  rows: string[][];
}

interface CliArgs {
  exportPath: string;
  appSettingsPath: string;
  usersPath?: string;
  outDir: string;
  help: boolean;
}

// Curated, deterministic field allow-lists carried onto contact docs (besides the
// structural reference_id / contact_type / name / parent columns).
const PERSON_EXTRA_FIELDS = ['phone', 'sex', 'date_of_birth', 'role'];
const PLACE_EXTRA_FIELDS = ['place_id', 'external_id'];

// Top-level report fields carried (in this fixed order) when present on any doc.
const REPORT_TOP_LEVEL_FIELDS = ['patient_id', 'patient_uuid', 'place_id'];

// create-users.js requires a password on create; scrubbed exports never carry one.
// Emit this documented placeholder so the CSV is complete — operators MUST reset it.
const DEFAULT_PASSWORD = 'ChangeMe_123';

const HELP = `build-seed-data — reconstruct cht-conf seed CSVs from scrubbed exports.

USAGE
  npx tsx demo/site-reconstruction/build-seed-data.ts \\
    --export <path>        Scrubbed contact/report JSON export.
                           Accepts a bare array of CouchDB docs OR { "docs": [ ... ] }.
    --app-settings <path>  app_settings.json (its contact_types[] define the hierarchy).
    --out <dir>            Output directory (a cht-conf project root). Required.
    --users <path>         (optional) Scrubbed user-devices export -> users.csv.
    -h, --help             Show this help.

OUTPUT (under --out)
  csv/contact.<type>.csv   One per contact_type (split by parent type only when a type's
                           docs sit under more than one parent type). type:'contact',
                           contact_type:'<type>', parents linked via
                           'parent:<parentType> WHERE reference_id=COL_VAL'.
  csv/report.<form>.csv    One per report form code. type:'data_record', form:'<form>'.
  users.csv                create-users input (only when --users is given).

NEXT STEPS (cht-conf parses args with minimist boolean:true, so value flags
            MUST be --flag=value, never --flag value)
  cht --source=<dir> csv-to-docs --skip-dependency-check --skip-version-check --skip-git-check
  cht --source=<dir> --url='https://user:pass@host' create-users \\
      --skip-dependency-check --skip-version-check --skip-git-check

NOTES
  - csv-to-docs assigns each doc a deterministic _id = uuid5(canonical-json(doc)); the
    original export _id is preserved as the 'reference_id' field for parent linkage.
  - users.csv 'contact'/'place' carry the ORIGINAL export _ids. If contacts are imported
    via csv-to-docs (which re-hashes _ids), remap these or upload the contacts with fixed
    _ids first. Passwords are set to '${DEFAULT_PASSWORD}' and MUST be reset.
`;

function printHelp(): void {
  process.stdout.write(HELP);
}

function fail(message: string): never {
  process.stderr.write(`Error: ${message}\n`);
  process.exit(1);
}

function parseArgs(argv: string[]): CliArgs {
  const opts: Record<string, string> = {};
  let help = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') {
      help = true;
      continue;
    }
    if (!arg.startsWith('--')) {
      fail(`Unexpected argument: ${arg} (see --help)`);
    }
    const eq = arg.indexOf('=');
    if (eq !== -1) {
      opts[arg.slice(2, eq)] = arg.slice(eq + 1);
    } else {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) {
        fail(`Missing value for ${arg}`);
      }
      opts[arg.slice(2)] = value;
      i++;
    }
  }
  return {
    exportPath: opts.export,
    appSettingsPath: opts['app-settings'],
    usersPath: opts.users,
    outDir: opts.out,
    help,
  };
}

function readJson(filePath: string): unknown {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch {
    return fail(`Cannot read file: ${filePath}`);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    return fail(`Invalid JSON in ${filePath}: ${(err as Error).message}`);
  }
}

function asRecord(value: unknown): Json | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Json)
    : undefined;
}

/** Coerce a scalar (string/number/boolean) to a string; return undefined for anything else. */
function scalarString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return undefined;
}

function getStr(doc: Json, key: string): string | undefined {
  return scalarString(doc[key]);
}

/** A doc's business _id whether stored as a string or a nested lineage object. */
function extractId(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }
  const rec = asRecord(value);
  return rec ? getStr(rec, '_id') : undefined;
}

/** CHT contact-type of a doc: type==='contact' uses contact_type, else legacy `type`. */
function typeIdOf(doc: Json): string | undefined {
  const type = getStr(doc, 'type');
  return type === 'contact' ? getStr(doc, 'contact_type') : type;
}

/** Mirrors cht-conf int() semantics so leading-zero strings stay strings. */
function isIntegerString(s: string): boolean {
  return Number.parseInt(s, 10).toString() === s;
}

// ---- app_settings -> contact type model ------------------------------------

function loadContactTypes(appSettings: unknown): ContactTypeDef[] {
  const root = asRecord(appSettings);
  const raw = root ? root.contact_types : undefined;
  if (!Array.isArray(raw)) {
    return fail('app_settings.json has no contact_types array.');
  }
  const defs: ContactTypeDef[] = [];
  for (const entry of raw) {
    const rec = asRecord(entry);
    const id = rec ? getStr(rec, 'id') : undefined;
    if (!id) {
      continue;
    }
    const parentsRaw = rec && Array.isArray(rec.parents) ? rec.parents : [];
    const parents = parentsRaw.filter((p): p is string => typeof p === 'string');
    const person = rec ? rec.person === true : false;
    defs.push({ id, parents, person });
  }
  if (!defs.length) {
    return fail('app_settings.json contact_types has no usable entries.');
  }
  return defs;
}

/** Depth from a root (parents:[]) for stable, hierarchy-ordered file emission. */
function depthOf(id: string, byId: Map<string, ContactTypeDef>): number {
  const memo = new Map<string, number>();
  const visit = (current: string, stack: Set<string>): number => {
    const cached = memo.get(current);
    if (cached !== undefined) {
      return cached;
    }
    const def = byId.get(current);
    if (!def || def.parents.length === 0 || stack.has(current)) {
      memo.set(current, 0);
      return 0;
    }
    stack.add(current);
    let best = Number.POSITIVE_INFINITY;
    for (const parent of def.parents) {
      if (byId.has(parent)) {
        best = Math.min(best, visit(parent, stack) + 1);
      }
    }
    stack.delete(current);
    const depth = Number.isFinite(best) ? best : 0;
    memo.set(current, depth);
    return depth;
  };
  return visit(id, new Set<string>());
}

// ---- doc partitioning -------------------------------------------------------

function loadDocs(exportJson: unknown): Json[] {
  let list: unknown;
  if (Array.isArray(exportJson)) {
    list = exportJson;
  } else {
    const rec = asRecord(exportJson);
    list = rec ? rec.docs : undefined;
  }
  if (!Array.isArray(list)) {
    return fail('Export must be a JSON array or an object with a "docs" array.');
  }
  const docs: Json[] = [];
  for (const item of list) {
    const rec = asRecord(item);
    if (rec) {
      docs.push(rec);
    }
  }
  return docs;
}

// ---- CSV serialization ------------------------------------------------------

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function toCsv(headers: string[], rows: string[][]): string {
  const lines = [headers, ...rows].map((row) => row.map(csvCell).join(','));
  return `${lines.join('\n')}\n`;
}

// ---- contact CSVs -----------------------------------------------------------

interface ContactGroup {
  parentType: string | null;
  docs: Json[];
}

function groupByParentType(
  docs: Json[],
  def: ContactTypeDef,
  byId: Map<string, Json>,
  warnings: string[],
): ContactGroup[] {
  const groups = new Map<string, ContactGroup>();
  for (const doc of docs) {
    const parentId = extractId(doc.parent);
    let parentType: string | null = null;
    if (parentId) {
      const parentDoc = byId.get(parentId);
      const resolved = parentDoc ? typeIdOf(parentDoc) : undefined;
      if (resolved) {
        parentType = resolved;
        if (!def.parents.includes(resolved)) {
          warnings.push(
            `${def.id} doc ${extractId(doc._id)} has parent type '${resolved}' ` +
              `not listed in its contact_types.parents [${def.parents.join(', ')}].`,
          );
        }
      } else {
        warnings.push(
          `${def.id} doc ${extractId(doc._id)} references missing parent ${parentId}; ` +
            'emitting without a parent link.',
        );
      }
    }
    const key = parentType ?? '';
    const group = groups.get(key);
    if (group) {
      group.docs.push(doc);
    } else {
      groups.set(key, { parentType, docs: [doc] });
    }
  }
  return [...groups.values()].sort((a, b) =>
    (a.parentType ?? '').localeCompare(b.parentType ?? ''),
  );
}

function buildContactCsv(
  def: ContactTypeDef,
  group: ContactGroup,
  singleGroup: boolean,
): CsvFile {
  const extraAllow = def.person ? PERSON_EXTRA_FIELDS : PLACE_EXTRA_FIELDS;
  const sortedDocs = [...group.docs].sort((a, b) =>
    (extractId(a._id) ?? '').localeCompare(extractId(b._id) ?? ''),
  );

  const presentExtras = extraAllow.filter((field) =>
    sortedDocs.some((doc) => getStr(doc, field) !== undefined),
  );

  const headers = ['reference_id', 'contact_type', 'name'];
  if (group.parentType) {
    headers.push(`parent:${group.parentType} WHERE reference_id=COL_VAL`);
  }
  headers.push(...presentExtras);

  const rows = sortedDocs.map((doc) => {
    const row = [extractId(doc._id) ?? '', def.id, getStr(doc, 'name') ?? ''];
    if (group.parentType) {
      row.push(extractId(doc.parent) ?? '');
    }
    for (const field of presentExtras) {
      row.push(getStr(doc, field) ?? '');
    }
    return row;
  });

  const suffix = singleGroup ? '' : `.${group.parentType ?? 'orphan'}`;
  return { relPath: path.join('csv', `contact.${def.id}${suffix}.csv`), headers, rows };
}

// ---- report CSVs ------------------------------------------------------------

function scalarFieldKeys(docs: Json[]): string[] {
  const keys = new Set<string>();
  for (const doc of docs) {
    const fields = asRecord(doc.fields);
    if (!fields) {
      continue;
    }
    for (const key of Object.keys(fields)) {
      if (scalarString(fields[key]) !== undefined) {
        keys.add(key);
      }
    }
  }
  return [...keys].sort();
}

/** Append ':int' when every non-empty value in a column is an integer string. */
function intCoercion(values: string[]): string {
  const nonEmpty = values.filter((v) => v !== '');
  return nonEmpty.length > 0 && nonEmpty.every(isIntegerString) ? ':int' : '';
}

function buildReportCsv(form: string, docs: Json[]): CsvFile {
  const sortedDocs = [...docs].sort((a, b) =>
    (extractId(a._id) ?? '').localeCompare(extractId(b._id) ?? ''),
  );

  const hasContact = sortedDocs.some((doc) => extractId(doc.contact) !== undefined);
  const hasReportedDate = sortedDocs.some((doc) => getStr(doc, 'reported_date') !== undefined);
  const topLevel = REPORT_TOP_LEVEL_FIELDS.filter((field) =>
    sortedDocs.some((doc) => getStr(doc, field) !== undefined),
  );
  const fieldKeys = scalarFieldKeys(sortedDocs);

  const headers = ['reference_id'];
  if (hasContact) {
    headers.push('contact_reference_id');
  }
  if (hasReportedDate) {
    headers.push('reported_date:timestamp');
  }
  headers.push(...topLevel);

  // Resolve per-column int coercion for flattened fields.* from the raw values.
  const fieldValues = new Map<string, string[]>();
  for (const key of fieldKeys) {
    fieldValues.set(
      key,
      sortedDocs.map((doc) => {
        const fields = asRecord(doc.fields);
        return fields ? scalarString(fields[key]) ?? '' : '';
      }),
    );
  }
  const fieldHeaders = fieldKeys.map(
    (key) => `fields.${key}${intCoercion(fieldValues.get(key) ?? [])}`,
  );
  headers.push(...fieldHeaders);

  const rows = sortedDocs.map((doc, index) => {
    const row = [extractId(doc._id) ?? ''];
    if (hasContact) {
      row.push(extractId(doc.contact) ?? '');
    }
    if (hasReportedDate) {
      row.push(getStr(doc, 'reported_date') ?? '');
    }
    for (const field of topLevel) {
      row.push(getStr(doc, field) ?? '');
    }
    for (const key of fieldKeys) {
      row.push((fieldValues.get(key) ?? [])[index] ?? '');
    }
    return row;
  });

  return { relPath: path.join('csv', `report.${form}.csv`), headers, rows };
}

// ---- users CSV --------------------------------------------------------------

function normalizeRoles(value: unknown): string {
  if (Array.isArray(value)) {
    return value.filter((r): r is string => typeof r === 'string').join(':');
  }
  return typeof value === 'string' ? value : '';
}

function buildUsersCsv(usersJson: unknown, warnings: string[]): CsvFile {
  let list: unknown;
  if (Array.isArray(usersJson)) {
    list = usersJson;
  } else {
    const rec = asRecord(usersJson);
    list = rec ? rec.users ?? rec.docs : undefined;
  }
  if (!Array.isArray(list)) {
    return fail('Users export must be a JSON array or an object with a "users"/"docs" array.');
  }

  const headers = ['username', 'password', 'roles', 'contact', 'phone', 'place', 'fullname', 'email'];
  const users: Json[] = [];
  for (const item of list) {
    const rec = asRecord(item);
    if (rec) {
      users.push(rec);
    }
  }

  const rows: string[][] = [];
  for (const user of users) {
    const username = getStr(user, 'username') ?? getStr(user, 'name');
    if (!username) {
      warnings.push('Skipping a user with no username/name.');
      continue;
    }
    const contactRec = asRecord(user.contact);
    const roles = normalizeRoles(user.roles ?? user.role);
    if (!roles) {
      warnings.push(`User '${username}' has no roles; create-users will reject an empty role.`);
    }
    const phone =
      getStr(user, 'phone') ?? (contactRec ? getStr(contactRec, 'phone') : undefined) ?? '';
    const fullname =
      getStr(user, 'fullname') ??
      getStr(user, 'fullName') ??
      (contactRec ? getStr(contactRec, 'name') : undefined) ??
      '';
    rows.push([
      username,
      getStr(user, 'password') ?? DEFAULT_PASSWORD,
      roles,
      extractId(user.contact) ?? getStr(user, 'contact_id') ?? '',
      phone,
      extractId(user.place) ?? getStr(user, 'facility_id') ?? getStr(user, 'place_id') ?? '',
      fullname,
      getStr(user, 'email') ?? '',
    ]);
  }
  rows.sort((a, b) => a[0].localeCompare(b[0]));
  return { relPath: 'users.csv', headers, rows };
}

// ---- orchestration ----------------------------------------------------------

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || (!args.exportPath && !args.appSettingsPath && !args.outDir)) {
    printHelp();
    return;
  }
  if (!args.exportPath) {
    fail('--export is required (see --help).');
  }
  if (!args.appSettingsPath) {
    fail('--app-settings is required (see --help).');
  }
  if (!args.outDir) {
    fail('--out is required (see --help).');
  }

  const warnings: string[] = [];
  const contactTypes = loadContactTypes(readJson(args.appSettingsPath));
  const typeById = new Map(contactTypes.map((def) => [def.id, def]));

  const docs = loadDocs(readJson(args.exportPath));
  const docById = new Map<string, Json>();
  for (const doc of docs) {
    const id = extractId(doc._id);
    if (id) {
      docById.set(id, doc);
    }
  }

  const contactsByType = new Map<string, Json[]>();
  const reportsByForm = new Map<string, Json[]>();
  let skipped = 0;
  for (const doc of docs) {
    const tid = typeIdOf(doc);
    if (tid && typeById.has(tid)) {
      const bucket = contactsByType.get(tid);
      if (bucket) {
        bucket.push(doc);
      } else {
        contactsByType.set(tid, [doc]);
      }
      continue;
    }
    const form = getStr(doc, 'form');
    if (getStr(doc, 'type') === 'data_record' && form) {
      const bucket = reportsByForm.get(form);
      if (bucket) {
        bucket.push(doc);
      } else {
        reportsByForm.set(form, [doc]);
      }
      continue;
    }
    skipped++;
  }

  const csvFiles: CsvFile[] = [];

  const orderedTypes = [...contactsByType.keys()].sort((a, b) => {
    const da = depthOf(a, typeById);
    const db = depthOf(b, typeById);
    return da !== db ? da - db : a.localeCompare(b);
  });
  for (const tid of orderedTypes) {
    const def = typeById.get(tid);
    const typeDocs = contactsByType.get(tid);
    if (!def || !typeDocs) {
      continue;
    }
    const groups = groupByParentType(typeDocs, def, docById, warnings);
    const singleGroup = groups.length === 1;
    for (const group of groups) {
      csvFiles.push(buildContactCsv(def, group, singleGroup));
    }
  }

  for (const form of [...reportsByForm.keys()].sort()) {
    const formDocs = reportsByForm.get(form);
    if (formDocs) {
      csvFiles.push(buildReportCsv(form, formDocs));
    }
  }

  let usersFile: CsvFile | undefined;
  if (args.usersPath) {
    usersFile = buildUsersCsv(readJson(args.usersPath), warnings);
  }

  // Write everything deterministically.
  fs.mkdirSync(path.join(args.outDir, 'csv'), { recursive: true });
  for (const file of csvFiles) {
    const dest = path.join(args.outDir, file.relPath);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, toCsv(file.headers, file.rows));
  }
  if (usersFile) {
    fs.writeFileSync(path.join(args.outDir, usersFile.relPath), toCsv(usersFile.headers, usersFile.rows));
  }

  // Summary.
  const out = [`Wrote seed data to ${path.resolve(args.outDir)}`];
  for (const file of csvFiles) {
    out.push(`  ${file.relPath} (${file.rows.length} rows)`);
  }
  if (usersFile) {
    out.push(`  ${usersFile.relPath} (${usersFile.rows.length} rows)`);
  }
  out.push(`Contacts: ${[...contactsByType.values()].reduce((n, d) => n + d.length, 0)} across ${contactsByType.size} type(s).`);
  out.push(`Reports: ${[...reportsByForm.values()].reduce((n, d) => n + d.length, 0)} across ${reportsByForm.size} form(s).`);
  out.push(`Skipped (non contact/report) docs: ${skipped}.`);
  process.stdout.write(`${out.join('\n')}\n`);

  if (warnings.length) {
    process.stderr.write(`\n${warnings.length} warning(s):\n`);
    for (const warning of warnings) {
      process.stderr.write(`  - ${warning}\n`);
    }
  }
}

main();
