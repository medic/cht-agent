/**
 * Test Environment Agent
 *
 * Deterministic provisioning orchestrator for the Test Environment Layer
 * (QA Supervisor). It provisions a live CHT instance, applies a config,
 * discovers the deployed config, and seeds conforming test data. No LLM is
 * involved. Real paths: provision (human-gated bring-up + readiness polling),
 * applyConfig (cht-conf upload buckets), discoverConfig (settings + form-rev
 * fetch), prepareTestData (cht-conf csv-to-docs/upload-docs/create-users),
 * and the couchdb-tier reset (tracked-doc wipe + reseed over the CouchDB HTTP
 * API — the one reset the agent does itself; restart/full stay human-gated).
 * The pipeline wiring that invokes this layer lands with #64.
 *
 * See: designs/layer_recommendations/test-environment-layer.md
 */

import { resolve } from 'node:path';
import {
  ApplyConfigOptions,
  ChtConfExecOptions,
  ChtConfExecResult,
  ConfigActionResult,
  ConfigApplyResult,
  ConfigUploadAction,
  ContactTypeConfig,
  DiscoveredConfig,
  EnvironmentHandle,
  PrepareTestDataOptions,
  ProvisionOptions,
  ResetOptions,
  ResetResult,
  ResetTier,
  RoleConfig,
  TestDataResult,
  TransitionConfig,
} from '../types';
import { MOCK_TEST_ENV_DATA, mockConfigActionResult } from './test-environment-agent.mock-data';
import { waitForReady } from '../utils/cht-readiness';
import { FORM_BUCKETS, outputTail, runBucket, runChtConf } from '../utils/cht-conf-runner';
import {
  BulkDoc,
  bulkDocs,
  DocRevRow,
  fetchDocRevs,
  fetchFormRevs,
  fetchSession,
  fetchSettings,
} from '../utils/cht-api';
import {
  classifySeededDocs,
  countCreatedUsers,
  findForeignDocFiles,
  hasCsvInput,
  hasUsersCsv,
  parseUploadDocsSummary,
  readSeededDocs,
  recordOwnedDocFiles,
  removeOwnedDocFiles,
  SeededDoc,
  SeededDocCounts,
} from '../utils/test-data';

// Real-path defaults: scripts/test-env-up.sh brings CHT up on cht-agent-net with these
// same credentials and with COMMON_NAME=nginx, so the stack's SAN-less self-signed cert
// names the host the agent dials. The cht-conf child gets --accept-self-signed-certs; the
// agent's own fetch trusts the cert via NODE_EXTRA_CA_CERTS=<the stack's cert.pem>.
// NODE_TLS_REJECT_UNAUTHORIZED=0 disables verification for ALL agent traffic (LLM/MCP
// included) — disposable runner containers only.
const DEFAULT_ENV_URL = 'https://nginx';
const DEFAULT_NETWORK = 'cht-agent-net';
const DEFAULT_AUTH = { user: 'medic', password: 'password' };
// A cold first run of test-env-up.sh (clone, npm ci, build-dev, local-images) takes
// about 18 minutes.
const DEFAULT_PROVISION_WAIT_MS = 1_800_000;

// Default config project (cht-core in-repo) and the full cht-conf upload set.
const DEFAULT_CONFIG_PATH = 'config/default';
const DEFAULT_CONFIG_ACTIONS: ConfigUploadAction[] = [
  'app-settings',
  'app-forms',
  'contact-forms',
  'resources',
];

const CSV_TO_DOCS = 'csv-to-docs';
const UPLOAD_DOCS = 'upload-docs';

// CouchDB id prefix of installed form docs (form:pregnancy -> pregnancy).
const FORM_DOC_PREFIX = 'form:';

/**
 * Decode a URL userinfo component. Userinfo SHOULD be percent-encoded, but a
 * raw '%' in a hand-typed CHT_URL password must not crash provision with an
 * opaque URIError — fall back to the literal value.
 */
const decodeUserinfo = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

/** Strip trailing slashes without a backtracking regex. */
const stripTrailingSlashes = (value: string): string => {
  let result = value;
  while (result.endsWith('/')) {
    result = result.slice(0, -1);
  }
  return result;
};

// POSIX single-quote escaping: close the quote, emit an escaped one, reopen.
const SINGLE_QUOTE_ESCAPE = String.raw`'\''`;

/** Single-quote a path for the printed human-gate commands (spaces/metachars stay inert when pasted). */
const shellQuote = (value: string): string => `'${value.replaceAll("'", SINGLE_QUOTE_ESCAPE)}'`;

/**
 * Argument for a printed gate command: a quoted path, or nothing when we don't
 * know one — the scripts resolve CHT_CORE_PATH (or their managed checkout)
 * themselves, so a bare command is runnable while a `'<cht-core>'` placeholder
 * would not be.
 */
const gateArg = (chtCorePath: string | undefined): string =>
  chtCorePath === undefined ? '' : ` ${shellQuote(chtCorePath)}`;

/** Carry an explicit Compose project into the printed gates, so down/restart address the same stack. */
const gateEnv = (): string => {
  const project = process.env.CHT_TEST_ENV_PROJECT;
  return project ? `CHT_TEST_ENV_PROJECT=${shellQuote(project)} ` : '';
};

const hasControlChars = (value: string): boolean =>
  [...value].some((ch) => (ch.codePointAt(0) ?? 0) < 0x20);

type BasicAuth = { user: string; password: string };

/** A resolved real-mode target: a credential-free instance URL + its auth. */
interface RealTarget {
  url: string;
  auth: BasicAuth;
}

/** Hosts treated as disposable test instances (see assertDisposableTarget). */
const DISPOSABLE_HOSTS = new Set(['nginx', 'localhost', '127.0.0.1', '[::1]']);

// cht-docker-helper serves a stack on a dashed IP under this resolver, but the resolver
// answers for ANY address (203-0-113-5.local-ip.medicmobile.org is public).
const PRIVATE_DASHED_IP =
  /^(?:10-\d{1,3}|127-\d{1,3}|192-168|172-(?:1[6-9]|2\d|3[01]))-\d{1,3}-\d{1,3}\.local-ip\.medicmobile\.org$/;

// `.local` is deliberately absent: it is also the legacy Active Directory suffix.
const isDisposableHost = (hostname: string): boolean =>
  DISPOSABLE_HOSTS.has(hostname) || hostname.endsWith('.localhost') || PRIVATE_DASHED_IP.test(hostname);

/** Parse an instance URL without letting ERR_INVALID_URL carry the raw string (password included). */
const parseInstanceUrl = (raw: string): URL => {
  try {
    return new URL(raw);
  } catch {
    throw new Error('provision: the instance URL (options.url / CHT_URL) is not a valid URL');
  }
};

/** Credentials embedded in a URL. Both halves are required: `https://medic@host` carries none. */
const embeddedAuthOf = (url: URL): BasicAuth | undefined =>
  url.username && url.password
    ? { user: decodeUserinfo(url.username), password: decodeUserinfo(url.password) }
    : undefined;

/** The canonical, credential-free form of an instance URL; handle.url reaches logs. */
const withoutUserinfo = (url: URL): string => {
  const copy = new URL(url);
  copy.username = '';
  copy.password = '';
  return stripTrailingSlashes(copy.toString());
};

/**
 * Auth precedence: options.auth, then URL-embedded, then COUCHDB_USER / COUCHDB_PASSWORD,
 * which default independently exactly as the scripts' `${VAR:-default}` do. `isDefault`
 * means nobody supplied a password, so the guard can refuse to send the built-in one away.
 */
const resolveRealAuth = (
  options: ProvisionOptions,
  embeddedAuth: BasicAuth | undefined
): { auth: BasicAuth; isDefault: boolean } => {
  const supplied = options.auth ?? embeddedAuth;
  if (supplied) {
    return { auth: supplied, isDefault: false };
  }
  const password = process.env.COUCHDB_PASSWORD || undefined;
  return {
    auth: { user: process.env.COUCHDB_USER || DEFAULT_AUTH.user, password: password ?? DEFAULT_AUTH.password },
    isDefault: password === undefined,
  };
};

/** https is always allowed; http only when the host is a local disposable one. */
const isSchemeAllowed = (target: URL, disposable: boolean): boolean =>
  target.protocol === 'https:' || (target.protocol === 'http:' && disposable);

const isExternalTargetAllowed = (options: ProvisionOptions): boolean =>
  options.allowExternalTarget === true || process.env.CHT_TEST_ENV_ALLOW_EXTERNAL === '1';

/**
 * Refuse to aim the destructive paths at anything but a disposable test instance:
 * applyConfig runs cht-conf with `--force` and reset('couchdb') deletes docs, so a
 * stale CHT_URL pointing at staging must fail loudly rather than clobber it.
 * Override per call with allowExternalTarget, or with CHT_TEST_ENV_ALLOW_EXTERNAL=1.
 */
const assertDisposableTarget = (target: URL, options: ProvisionOptions, defaultCreds: boolean): void => {
  const disposable = isDisposableHost(target.hostname);
  if (!isSchemeAllowed(target, disposable)) {
    throw new Error(
      `provision: refusing ${target.protocol}//${target.host} — https is required ` +
        '(http only for a local disposable instance)'
    );
  }
  if (disposable) {
    return;
  }
  if (!isExternalTargetAllowed(options)) {
    throw new Error(
      `provision: ${target.host} is not a known disposable test instance, and this layer runs ` +
        'cht-conf --force and deletes docs. Set allowExternalTarget (or ' +
        'CHT_TEST_ENV_ALLOW_EXTERNAL=1) if that really is the target.'
    );
  }
  if (defaultCreds) {
    throw new Error(
      `provision: refusing the built-in default credentials against ${target.host} — pass auth ` +
        'explicitly or set COUCHDB_USER/COUCHDB_PASSWORD.'
    );
  }
};

/**
 * Resolve the real-mode instance URL + credentials. URL: options.url, then CHT_URL
 * (trimmed; blank ignored), then the on-network default. Embedded basic-auth creds are
 * stripped out of the URL (it is logged, and undici rejects credentialed URLs) and kept
 * only as an auth fallback.
 */
const resolveRealTarget = (options: ProvisionOptions): RealTarget => {
  const target = parseInstanceUrl(options.url ?? (process.env.CHT_URL?.trim() || DEFAULT_ENV_URL));
  const { auth, isDefault } = resolveRealAuth(options, embeddedAuthOf(target));
  assertDisposableTarget(target, options, isDefault);
  return { url: withoutUserinfo(target), auth };
};

/** A docIds worklist with no dataPath to reseed from is a caller error, not an empty reset. */
const assertNoOrphanDocIds = (options: ResetOptions): void => {
  if (options.docIds !== undefined) {
    throw new Error('reset: options.docIds also needs options.dataPath (the project to reseed from)');
  }
};

/** Reject provision inputs before anything is printed or polled. */
const validateProvisionOptions = (options: ProvisionOptions): void => {
  if (!options.chtCorePath && !options.version) {
    throw new Error('provision requires either chtCorePath or version');
  }
  // The path is interpolated into printed human-gate command lines.
  if (options.chtCorePath && hasControlChars(options.chtCorePath)) {
    throw new Error('provision: chtCorePath contains control characters — must be a plain filesystem path');
  }
};

/**
 * Real mode brings a stack up from a cht-core working copy only. A published version comes
 * up through cht-docker-helper at a URL this layer can neither print a gate for nor poll,
 * so it is refused; checking the release tag out in a working copy reaches the same code.
 */
const assertRealModeSupported = (options: ProvisionOptions, network: string): void => {
  if (options.version !== undefined) {
    throw new Error(
      `provision: real mode has no published-version bring-up — check ${options.version} out in a ` +
        'cht-core working copy and pass chtCorePath'
    );
  }
  if (network !== DEFAULT_NETWORK) {
    throw new Error(
      'provision: the bring-up scripts and docker/cht-agent-net.override.yml hardcode ' +
        `${DEFAULT_NETWORK}; a custom network needs an edit there too`
    );
  }
};

/**
 * /api/v2/monitoring needs no auth, so readiness proves nothing about the credentials. cht-conf
 * --force and the reset's _bulk_docs both need a CouchDB admin: check that now, not minutes later.
 */
const assertAdminCredentials = async (url: string, auth: BasicAuth): Promise<void> => {
  const session = await fetchSession(url, auth).catch((error: Error) => {
    throw new Error(`provision: could not verify the credentials for ${auth.user}: ${error.message}`);
  });
  if (!session.roles.includes('_admin')) {
    throw new Error(
      `provision: ${auth.user} is authenticated but is not a CouchDB admin; apply and reset need one`
    );
  }
};

/** Real provision: gate, wait for health, prove admin credentials, hand back the handle. */
const provisionReal = async (options: ProvisionOptions, network: string): Promise<EnvironmentHandle> => {
  assertRealModeSupported(options, network);
  const { url, auth } = resolveRealTarget(options);

  console.log('[Test Environment Agent] HUMAN GATE — bring the env up (agent runs no Docker):');
  console.log(`    ${gateEnv()}scripts/test-env-up.sh${gateArg(options.chtCorePath)}   # build + start on ${network}`);
  console.log(`[Test Environment Agent] Polling ${url}/api/v2/monitoring until healthy...`);

  const readiness = {
    ...options.readiness,
    maxWaitMs: options.readiness?.maxWaitMs ?? DEFAULT_PROVISION_WAIT_MS,
  };
  await waitForReady(url, readiness);
  await assertAdminCredentials(url, auth);

  console.log(`[Test Environment Agent] Ready at ${url} (network: ${network})`);
  return { url, auth: { ...auth }, network, chtCorePath: options.chtCorePath, source: 'docker' };
};

/** Build the deterministic mock-mode handle (no instance, no Docker). */
const buildMockHandle = (options: ProvisionOptions, network: string): EnvironmentHandle => {
  const target = parseInstanceUrl(options.url ?? MOCK_TEST_ENV_DATA.url);
  return {
    url: withoutUserinfo(target),
    auth: { ...(options.auth ?? embeddedAuthOf(target) ?? MOCK_TEST_ENV_DATA.auth) },
    network,
    chtCorePath: options.chtCorePath,
    source: 'mock',
  };
};

/**
 * Build the cht-conf instance URL with embedded credentials
 * (https://user:pass@host). Only the runner sees this; logs use handle.url.
 */
const credentialedUrl = (handle: EnvironmentHandle): string => {
  const url = new URL(handle.url);
  url.username = encodeURIComponent(handle.auth.user);
  url.password = encodeURIComponent(handle.auth.password);
  return url.toString();
};

/** Default config project: cht-core's in-repo config/default, resolved against the handle's working copy. */
const defaultConfigPath = (handle: EnvironmentHandle): string =>
  handle.chtCorePath
    ? `${stripTrailingSlashes(handle.chtCorePath)}/${DEFAULT_CONFIG_PATH}`
    : DEFAULT_CONFIG_PATH;

/**
 * Aggregate per-bucket results into the ConfigApplyResult envelope. Shared by
 * the mock and real paths so both return an identical shape.
 */
const toApplyResult = (
  configPath: string,
  artifact: string | undefined,
  results: ConfigActionResult[]
): ConfigApplyResult => {
  // An artifact filter legitimately matches nothing in the OTHER form bucket
  // (targeting an app form never matches contact-forms), so a miss only means
  // the request failed when EVERY form bucket came up empty.
  const formResults = results.filter((result) => FORM_BUCKETS.has(result.action));
  const artifactMissed =
    artifact !== undefined &&
    formResults.length > 0 &&
    formResults.every((result) => result.matchedNothing === true);
  const warnings = results.flatMap((result) => result.warnings);
  if (artifactMissed) {
    warnings.push(`no configured form bucket contains an artifact named "${artifact}"`);
  }
  return {
    configPath,
    ...(artifact ? { artifact } : {}),
    actions: results,
    succeeded: results.every((result) => result.status !== 'failed') && !artifactMissed,
    warnings,
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const parseContactTypes = (raw: unknown): ContactTypeConfig[] => {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter(isRecord).flatMap((entry) => {
    if (typeof entry.id !== 'string') {
      return [];
    }
    const parents = Array.isArray(entry.parents)
      ? entry.parents.filter((parent): parent is string => typeof parent === 'string')
      : undefined;
    return [
      {
        id: entry.id,
        ...(parents !== undefined ? { parents } : {}),
        ...(typeof entry.person === 'boolean' ? { person: entry.person } : {}),
      },
    ];
  });
};

const parseRole = (value: unknown): RoleConfig | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  return {
    ...(typeof value.name === 'string' ? { name: value.name } : {}),
    ...(typeof value.offline === 'boolean' ? { offline: value.offline } : {}),
  };
};

const parseRoles = (raw: unknown): Record<string, RoleConfig> => {
  if (!isRecord(raw)) {
    return {};
  }
  const roles: Record<string, RoleConfig> = {};
  for (const [name, value] of Object.entries(raw)) {
    const role = parseRole(value);
    if (role !== undefined) {
      roles[name] = role;
    }
  }
  return roles;
};

const parsePermissions = (raw: unknown): Record<string, string[]> => {
  if (!isRecord(raw)) {
    return {};
  }
  const permissions: Record<string, string[]> = {};
  for (const [name, value] of Object.entries(raw)) {
    if (Array.isArray(value)) {
      permissions[name] = value.filter((role): role is string => typeof role === 'string');
    }
  }
  return permissions;
};

const parseTransitions = (raw: unknown): Record<string, TransitionConfig> => {
  if (!isRecord(raw)) {
    return {};
  }
  const transitions: Record<string, TransitionConfig> = {};
  for (const [name, value] of Object.entries(raw)) {
    if (typeof value === 'boolean') {
      transitions[name] = value;
    } else if (isRecord(value)) {
      transitions[name] = { disable: value.disable === true };
    }
  }
  return transitions;
};

/**
 * Map raw /api/v1/settings JSON + the installed form docs' revs into the
 * DiscoveredConfig the data/test layers consume. Pure — exported for nothing;
 * exercised through discoverConfig.
 */
const parseDiscoveredConfig = (
  settings: Record<string, unknown>,
  formRevs: Array<{ id: string; rev: string }>
): DiscoveredConfig => {
  const formVersions: Record<string, string> = {};
  for (const form of formRevs) {
    const id = form.id.startsWith(FORM_DOC_PREFIX) ? form.id.slice(FORM_DOC_PREFIX.length) : form.id;
    formVersions[id] = form.rev;
  }
  return {
    contactTypes: parseContactTypes(settings.contact_types),
    roles: parseRoles(settings.roles),
    permissions: parsePermissions(settings.permissions),
    transitions: parseTransitions(settings.transitions),
    forms: Object.keys(formVersions),
    formVersions,
  };
};

/** One line describing why a cht-conf invocation did not succeed. */
const describeExit = (label: string, run: ChtConfExecResult): string => {
  if (run.timedOut) {
    return `cht-conf ${label} timed out`;
  }
  if (run.startError !== undefined) {
    return `cht-conf ${label} failed to start: ${run.startError}`;
  }
  return `cht-conf ${label} exited with code ${run.exitCode}`;
};

/** Why a cht-conf run did not succeed, with cht-conf's own ERROR lines when it printed any. */
const describeRunFailure = (label: string, run: ChtConfExecResult): string =>
  [describeExit(label, run), ...outputTail(run.output)].join(' | ');

const runSucceeded = (run: ChtConfExecResult): boolean =>
  run.exitCode === 0 && !run.timedOut && run.startError === undefined;

// Doc ids that name deployed configuration or accounts. They are refused wherever a data
// project reaches the instance or the reset worklist.
const PROTECTED_IDS = new Set([
  'settings',
  'resources',
  'branding',
  'partners',
  'extension-libs',
  'privacy-policies',
  'service-worker-meta',
  'zscore-charts',
  'migration-log',
  'shortcode-id-length',
]);
const PROTECTED_PREFIXES = ['_design/', 'form:', 'org.couchdb.user:', 'messages-'];

const isProtectedId = (id: string): boolean =>
  PROTECTED_IDS.has(id) || PROTECTED_PREFIXES.some((prefix) => id.startsWith(prefix));

const partitionProtected = (ids: string[]): { safe: string[]; protectedIds: string[] } => {
  const safe: string[] = [];
  const protectedIds: string[] = [];
  for (const id of ids) {
    (isProtectedId(id) ? protectedIds : safe).push(id);
  }
  return { safe, protectedIds };
};

/** `upload-docs --force` writes whatever json_docs holds, so a protected id is refused up front. */
const assertNoProtectedDocs = (label: string, dataPath: string, docs: SeededDoc[]): void => {
  const planted = partitionProtected(docs.map((doc) => doc.id)).protectedIds;
  if (planted.length > 0) {
    throw new Error(
      `${label}: ${dataPath}/json_docs contains protected config doc(s) ${planted.slice(0, 5).join(', ')} — ` +
        'upload-docs would write them to the instance; remove them first'
    );
  }
};

/** Tracking key — the URL alone collides when parallel envs share the service hostname. */
const trackingKey = (handle: EnvironmentHandle): string => `${handle.network}|${handle.url}`;

/** Where a seed or reseed reads from, and the cht-conf it runs with. */
interface SeedSource {
  /** Absolute, so a later chdir cannot move a reset onto another project. */
  dataPath: string;
  bin?: string;
  timeoutMs?: number;
}

/** What prepareTestData tracked for a provisioned env: its source and the ids it seeded. */
interface SeededDataRecord extends SeedSource {
  docIds: string[];
}

/** cht-conf run options shared by the seeding phases (verbs/logLabel added per call). */
type SeedRunBase = Pick<ChtConfExecOptions, 'instanceUrl' | 'configPath' | 'cwd' | 'bin' | 'timeoutMs'>;

/**
 * Options for every seed and reseed run. cht-conf resolves --source against the child's cwd,
 * which is the data project (so its upload-docs report lands there), so both are absolute.
 */
const seedRunBase = (handle: EnvironmentHandle, source: SeedSource): SeedRunBase => ({
  instanceUrl: credentialedUrl(handle),
  configPath: resolve(source.dataPath),
  cwd: resolve(source.dataPath),
  bin: source.bin,
  timeoutMs: source.timeoutMs,
});

/**
 * upload-docs exits 0 even when it rejects docs. A static dataset seeded twice conflicts on
 * every doc, because csv-to-docs ids hash the content.
 */
const uploadShortfall = (run: ChtConfExecResult, docCount: number): string | undefined => {
  const summary = parseUploadDocsSummary(run.output);
  if (summary === undefined) {
    return docCount > 0 ? `upload-docs printed no summary for ${docCount} doc(s)` : undefined;
  }
  if (summary.uploaded < summary.total) {
    return (
      `only ${summary.uploaded} of ${summary.total} docs uploaded — the rest were rejected or already ` +
      "exist; reset('couchdb') before re-seeding the same data"
    );
  }
  return undefined;
};

/** Refuse anything in json_docs this layer did not generate; remove what it did. */
const clearOwnedDocs = (dataPath: string): void => {
  const foreign = findForeignDocFiles(dataPath);
  if (foreign.length > 0) {
    throw new Error(
      `prepareTestData: ${dataPath}/json_docs holds ${foreign.length} file(s) this layer did not generate ` +
        `(${foreign.slice(0, 3).join(', ')}) — move them out or use a fresh data project`
    );
  }
  const removed = removeOwnedDocFiles(dataPath);
  if (removed > 0) {
    console.log(`[Test Environment Agent] Cleared ${removed} json_docs file(s) a previous run generated`);
  }
};

/** csv-to-docs into a json_docs holding nothing but this layer's own earlier output. */
const generateDocs = async (shared: SeedRunBase, dataPath: string, warnings: string[]): Promise<boolean> => {
  clearOwnedDocs(dataPath);
  const run = await runChtConf({ verbs: [CSV_TO_DOCS], logLabel: `test-data: ${CSV_TO_DOCS}`, ...shared });
  // Everything in json_docs now came from csv-to-docs: record it even on failure, so a retry
  // can clear it.
  recordOwnedDocFiles(dataPath);
  if (!runSucceeded(run)) {
    warnings.push(describeRunFailure(CSV_TO_DOCS, run));
  }
  return runSucceeded(run);
};

const uploadDocs = async (shared: SeedRunBase, docCount: number): Promise<{ ran: boolean; problem?: string }> => {
  const run = await runChtConf({ verbs: [UPLOAD_DOCS], logLabel: `test-data: ${UPLOAD_DOCS}`, ...shared });
  if (!runSucceeded(run)) {
    return { ran: false, problem: describeRunFailure(UPLOAD_DOCS, run) };
  }
  return { ran: true, problem: uploadShortfall(run, docCount) };
};

interface DocsPhase {
  /** Every doc uploaded cleanly. */
  docsOk: boolean;
  /** upload-docs exited cleanly, so what is on disk is what it was given. */
  uploadRan: boolean;
  seeded: SeededDoc[];
  counts: SeededDocCounts;
}

/**
 * Docs phase. With csv/ input, json_docs is regenerated (see generateDocs); without it,
 * json_docs is hand-authored input and is uploaded as it is. Either way protected ids are
 * refused before upload-docs runs, which is why the two verbs are separate cht-conf calls.
 */
const prepareDocs = async (
  shared: SeedRunBase,
  dataPath: string,
  config: DiscoveredConfig,
  warnings: string[]
): Promise<DocsPhase> => {
  if (hasCsvInput(dataPath) && !(await generateDocs(shared, dataPath, warnings))) {
    return { docsOk: false, uploadRan: false, seeded: [], counts: classifySeededDocs([], config) };
  }
  const seeded = readSeededDocs(dataPath);
  assertNoProtectedDocs('prepareTestData', dataPath, seeded);
  const upload = await uploadDocs(shared, seeded.length);
  if (upload.problem !== undefined) {
    warnings.push(upload.problem);
  }
  if (seeded.length === 0) {
    warnings.push(`no docs in ${dataPath}/json_docs — does ${dataPath}/csv exist and contain CSV files?`);
  }
  const counts = classifySeededDocs(seeded, config);
  warnings.push(...counts.warnings);
  return { docsOk: upload.problem === undefined, uploadRan: upload.ran, seeded, counts };
};

/**
 * Users phase: cht-conf `create-users` from `<dataPath>/users.csv` when present
 * (cht-conf throws on a missing users.csv). On a failed run the last logged
 * "Creating user" attempt is the one that blew up, so it is not counted.
 */
const seedUsers = async (
  shared: SeedRunBase,
  dataPath: string,
  warnings: string[]
): Promise<{ usersCreated: number; usersOk: boolean }> => {
  if (!hasUsersCsv(dataPath)) {
    console.log('[Test Environment Agent] No users.csv in the data project — skipping create-users');
    return { usersCreated: 0, usersOk: true };
  }
  const usersRun = await runChtConf({ verbs: ['create-users'], logLabel: 'test-data: create-users', ...shared });
  const usersOk = runSucceeded(usersRun);
  const attempts = countCreatedUsers(usersRun.output);
  const usersCreated = usersOk ? attempts : Math.max(0, attempts - 1);
  if (!usersOk) {
    warnings.push(describeRunFailure('create-users', usersRun));
  }
  return { usersCreated, usersOk };
};

/** Build _deleted tombstones for the live (non-tombstoned, non-missing) tracked docs. */
const buildTombstones = (rows: DocRevRow[]): BulkDoc[] => {
  const deletions: BulkDoc[] = [];
  for (const row of rows) {
    if (row.rev !== undefined && !row.deleted && !row.missing) {
      deletions.push({ _id: row.id, _rev: row.rev, _deleted: true });
    }
  }
  return deletions;
};

/** Never wipe a doc the data project cannot put back. */
const assertRestorable = (dataPath: string, ids: string[], onDisk: SeededDoc[]): void => {
  const available = new Set(onDisk.map((doc) => doc.id));
  const unrestorable = ids.filter((id) => !available.has(id));
  if (unrestorable.length > 0) {
    throw new Error(
      `couchdb reset: ${dataPath}/json_docs cannot restore ${unrestorable.length} of the ${ids.length} ` +
        `doc(s) it would wipe (${unrestorable.slice(0, 5).join(', ')}) — re-run prepareTestData instead`
    );
  }
};

/**
 * couchdb reset — wipe: delete the tracked docs at their CURRENT revs (sentinel may have
 * bumped them). Throws unless CouchDB acknowledged every submitted deletion with `ok`.
 * Returns how many were tombstoned.
 */
const wipeTrackedDocs = async (handle: EnvironmentHandle, docIds: string[]): Promise<number> => {
  const rows = await fetchDocRevs(handle.url, handle.auth, docIds);
  const deletions = buildTombstones(rows);
  if (deletions.length === 0) {
    return 0;
  }
  const outcomes = await bulkDocs(handle.url, handle.auth, deletions);
  if (outcomes.length !== deletions.length) {
    throw new Error(
      `couchdb reset: _bulk_docs acknowledged ${outcomes.length} of ${deletions.length} deletion(s)`
    );
  }
  const failed = outcomes.filter((row) => row.error !== undefined || row.ok !== true);
  if (failed.length > 0) {
    const failedIds = failed.map((row) => row.id ?? 'unknown').slice(0, 5).join(', ');
    throw new Error(`couchdb reset failed to delete ${failed.length} doc(s): ${failedIds}`);
  }
  return deletions.length;
};

/** couchdb reset — reseed: re-upload the data project's pristine copies. */
const reseedTrackedDocs = async (
  handle: EnvironmentHandle,
  tracked: SeededDataRecord,
  wiped: number
): Promise<void> => {
  const reseed = await runChtConf({
    verbs: [UPLOAD_DOCS],
    logLabel: `couchdb reset: ${UPLOAD_DOCS}`,
    ...seedRunBase(handle, tracked),
  });
  if (!runSucceeded(reseed)) {
    throw new Error(
      `couchdb reset: ${wiped} doc(s) were wiped but the reseed failed, so they are gone from the ` +
        `instance until you re-run prepareTestData — ${describeRunFailure(UPLOAD_DOCS, reseed)}`
    );
  }
};

/**
 * Confirm from CouchDB that every doc the reset is responsible for exists again. upload-docs'
 * summary cannot say: it re-uploads all of json_docs with no _rev, mixing restored docs with
 * conflicts on docs that were never wiped.
 */
const verifyRestored = async (handle: EnvironmentHandle, ids: string[]): Promise<void> => {
  const rows = await fetchDocRevs(handle.url, handle.auth, ids);
  const present = new Set(
    rows.filter((row) => row.rev !== undefined && !row.deleted && !row.missing).map((row) => row.id)
  );
  const absent = ids.filter((id) => !present.has(id));
  if (absent.length > 0) {
    throw new Error(
      `couchdb reset: ${absent.length} doc(s) are missing after the reseed: ${absent.slice(0, 5).join(', ')}`
    );
  }
};

/** Print the human-gated restart/full reset instructions (the agent runs no Docker). */
const printResetGate = (handle: EnvironmentHandle, tier: ResetTier): void => {
  const target = gateArg(handle.chtCorePath);
  const env = gateEnv();
  console.log(`[Test Environment Agent] HUMAN GATE — reset (${tier}); the agent runs no Docker:`);
  if (tier === 'restart') {
    console.log(`    ${env}scripts/test-env-restart.sh${target}`);
  } else {
    // A full reset is a fresh stack, so rebuild: Model A tests the code as it is now.
    console.log(`    ${env}scripts/test-env-down.sh${target} && ${env}CHT_CORE_REBUILD=1 scripts/test-env-up.sh${target}`);
  }
  console.log('[Test Environment Agent] Re-confirm health with provision()/waitForReady after.');
};

export class TestEnvironmentAgent {
  private readonly useMockDocker: boolean;
  /** Seeded-doc tracking per environment (see trackingKey) for the couchdb reset. */
  private readonly seededData = new Map<string, SeededDataRecord>();

  constructor(options: { useMockDocker?: boolean } = {}) {
    this.useMockDocker = options.useMockDocker !== false;
  }

  /**
   * Bring up a reachable CHT environment. Real mode needs a working copy (chtCorePath, built
   * by scripts/test-env-up.sh); mock mode also takes a published version.
   */
  async provision(options: ProvisionOptions): Promise<EnvironmentHandle> {
    validateProvisionOptions(options);

    const source = options.chtCorePath
      ? `local code (${options.chtCorePath})`
      : `published version ${options.version}`;
    const network = options.network ?? DEFAULT_NETWORK;

    console.log('\n[Test Environment Agent] Provisioning environment...');
    console.log(`[Test Environment Agent] Source: ${source}`);

    if (!this.useMockDocker) {
      return provisionReal(options, network);
    }

    const handle = buildMockHandle(options, network);
    console.log(`[Test Environment Agent] Ready at ${handle.url} (network: ${handle.network})`);
    return handle;
  }

  /**
   * Apply (compile + upload) a config project to the instance via cht-conf.
   * Defaults to cht-core's in-repo `config/default`; cht-conf tickets pass the
   * deployment's config project as `configPath`. `actions` picks which cht-conf
   * upload buckets run — settings, app forms, contact forms, resources — so the
   * cht-conf validate loop can re-upload only the artifact it changed.
   *
   * Accepts a bare path string (back-compat) or an options object. Returns a
   * ConfigApplyResult the verify step / QA Supervisor asserts on.
   */
  async applyConfig(
    handle: EnvironmentHandle,
    options: string | ApplyConfigOptions = {}
  ): Promise<ConfigApplyResult> {
    const opts: ApplyConfigOptions = typeof options === 'string' ? { configPath: options } : options;
    const configPath = opts.configPath ?? defaultConfigPath(handle);
    const actions = opts.actions ?? DEFAULT_CONFIG_ACTIONS;
    const artifact = opts.artifact;

    const scope = artifact ? `${actions.join(', ')}; artifact=${artifact}` : actions.join(', ');
    console.log(`[Test Environment Agent] Applying config: ${configPath} (${scope}) -> ${handle.url}`);

    if (!this.useMockDocker) {
      const results = await this.applyConfigReal(handle, configPath, actions, opts);
      return toApplyResult(configPath, artifact, results);
    }

    const results = actions.map((action) => mockConfigActionResult(action));
    console.log(`[Test Environment Agent] (mock) config applied — ${results.length} action(s)`);
    return toApplyResult(configPath, artifact, results);
  }

  /**
   * Real applyConfig path: one cht-conf invocation per bucket against the
   * running instance (the agent runs no Docker — cht-conf talks over HTTP).
   * Buckets run independently so one failure doesn't abort the rest; never push.
   */
  private async applyConfigReal(
    handle: EnvironmentHandle,
    configPath: string,
    actions: ConfigUploadAction[],
    opts: ApplyConfigOptions
  ): Promise<ConfigActionResult[]> {
    const instanceUrl = credentialedUrl(handle);
    // Keep cht-conf's report files in the config project (as the seeding path does).
    const cwd = configPath.startsWith('/') ? configPath : undefined;
    const results: ConfigActionResult[] = [];
    for (const action of actions) {
      results.push(
        await runBucket({
          action,
          instanceUrl,
          configPath,
          artifact: opts.artifact,
          cwd,
          bin: opts.bin,
          timeoutMs: opts.timeoutMs,
        })
      );
    }
    return results;
  }

  /**
   * Read the deployed configuration back from the running instance so test data
   * can be generated to conform to it. Doubles as the post-applyConfig verify
   * primitive: formVersions carries each installed form's CouchDB rev, which
   * changes iff the form was re-uploaded.
   */
  async discoverConfig(handle: EnvironmentHandle): Promise<DiscoveredConfig> {
    console.log(`[Test Environment Agent] Discovering config from ${handle.url}...`);

    let config: DiscoveredConfig;
    if (this.useMockDocker) {
      config = structuredClone(MOCK_TEST_ENV_DATA.config);
    } else {
      const settings = await fetchSettings(handle.url, handle.auth);
      if (!Array.isArray(settings.contact_types)) {
        // Discovery reflects only what the instance returns (like the other
        // parsers), so surface that cht-core is running on its built-in
        // default hierarchy rather than synthesizing types the API never sent.
        console.warn(
          '[Test Environment Agent] Instance settings define no contact_types — cht-core falls back to ' +
            'its built-in default hierarchy; seeded default-hierarchy places will be counted as unknown types.'
        );
      }
      config = parseDiscoveredConfig(settings, await fetchFormRevs(handle.url, handle.auth));
    }

    console.log(
      `[Test Environment Agent] Discovered ${config.contactTypes.length} contact types, ` +
        `${Object.keys(config.roles).length} roles, ${config.forms.length} forms`
    );
    return config;
  }

  /**
   * Seed test data (places, people, reports, users) that conforms to the
   * discovered config. Real path: cht-conf `csv-to-docs` + `upload-docs` turn
   * `<dataPath>/csv/*.csv` (or a hand-authored json_docs) into docs, then `create-users`
   * provisions accounts from `<dataPath>/users.csv` when present. The seeded
   * doc ids are tracked per environment so `reset('couchdb')` can wipe and
   * reseed them without touching the deployed config.
   */
  async prepareTestData(
    handle: EnvironmentHandle,
    config: DiscoveredConfig,
    options: PrepareTestDataOptions = {}
  ): Promise<TestDataResult> {
    console.log(
      `[Test Environment Agent] Preparing test data for ${config.contactTypes.length} contact types -> ${handle.url}`
    );

    const result = this.useMockDocker
      ? structuredClone(MOCK_TEST_ENV_DATA.testData)
      : await this.prepareTestDataReal(handle, config, options);

    console.log(
      `[Test Environment Agent] Seeded ${result.placesCreated} places, ` +
        `${result.peopleCreated} people, ${result.reportsCreated} reports, ` +
        `${result.usersCreated} users`
    );
    return result;
  }

  /**
   * Real prepareTestData path: seed docs (csv-to-docs + upload-docs) then users
   * (create-users when users.csv exists), tracking the seeded doc ids per env for
   * the couchdb reset. Requires options.dataPath (a cht-conf project with csv/ or json_docs/).
   */
  private async prepareTestDataReal(
    handle: EnvironmentHandle,
    config: DiscoveredConfig,
    options: PrepareTestDataOptions
  ): Promise<TestDataResult> {
    if (!options.dataPath) {
      throw new Error('prepareTestData requires options.dataPath (a cht-conf project folder with csv/)');
    }
    const source: SeedSource = {
      dataPath: resolve(options.dataPath),
      bin: options.bin,
      timeoutMs: options.timeoutMs,
    };
    const shared = seedRunBase(handle, source);
    const warnings: string[] = [];

    const { docsOk, uploadRan, seeded, counts } = await prepareDocs(shared, source.dataPath, config, warnings);
    const { usersCreated, usersOk } = await seedUsers(shared, source.dataPath, warnings);

    // Only a clean upload run defines the reset worklist: a failed re-seed must not clobber a
    // live one (docs from the earlier seed are still on the instance).
    if (uploadRan && seeded.length > 0) {
      this.seededData.set(trackingKey(handle), { ...source, docIds: seeded.map((doc) => doc.id) });
    }

    return {
      placesCreated: counts.places,
      peopleCreated: counts.people,
      reportsCreated: counts.reports,
      usersCreated,
      warnings,
      succeeded: docsOk && usersOk,
      seededDocIds: seeded.map((doc) => doc.id),
    };
  }

  /**
   * Reset the environment to a known state. See the three-tier reset strategy
   * in the recommendation doc. The couchdb tier is the one reset the agent
   * performs itself (CouchDB HTTP API — no Docker): it wipes the docs the last
   * prepareTestData seeded, re-uploads pristine copies, and checks they are back.
   * restart/full stay human-gated: they print the command and return
   * `performedBy: 'human-gate'` with zero counts WITHOUT waiting for the human, so the
   * caller re-confirms health itself. CouchDB data is a bind mount (COUCHDB_DATA), so it
   * survives `down -v`; only the named volumes go.
   */
  async reset(
    handle: EnvironmentHandle,
    tier: ResetTier,
    options: ResetOptions = {}
  ): Promise<ResetResult> {
    const gated = (performedBy: ResetResult['performedBy']): ResetResult => ({
      tier,
      wiped: 0,
      reseeded: 0,
      performedBy,
      protectedSkipped: [],
    });

    if (this.useMockDocker) {
      console.log(`[Test Environment Agent] Reset (${tier}) -> ${handle.url}`);
      console.log('[Test Environment Agent] (mock) reset complete');
      return gated(tier === 'couchdb' ? 'agent' : 'human-gate');
    }

    if (tier === 'couchdb') {
      return this.resetCouchdbTier(handle, options);
    }
    printResetGate(handle, tier);
    return gated('human-gate');
  }

  /**
   * Reset worklist: explicit options win (they let a handle reloaded in another
   * process drive the reset — the agent's tracking is in-memory), otherwise fall
   * back to what prepareTestData recorded for this environment.
   */
  private resolveResetWorklist(
    handle: EnvironmentHandle,
    options: ResetOptions
  ): SeededDataRecord | undefined {
    const tracked = this.seededData.get(trackingKey(handle));
    const dataPath = options.dataPath === undefined ? tracked?.dataPath : resolve(options.dataPath);
    if (dataPath === undefined) {
      assertNoOrphanDocIds(options);
      return undefined;
    }
    const docIds = options.docIds ?? tracked?.docIds ?? [];
    if (docIds.length === 0) {
      return undefined;
    }
    return { ...tracked, dataPath, docIds };
  }

  /**
   * couchdb-tier reset. Before anything is deleted it refuses a data project that names
   * deployed config and any doc json_docs cannot put back; then it wipes, reseeds, and
   * confirms from CouchDB that every wiped doc returned. A half-reset never passes as clean.
   */
  private async resetCouchdbTier(handle: EnvironmentHandle, options: ResetOptions): Promise<ResetResult> {
    const tracked = this.resolveResetWorklist(handle, options);
    if (tracked === undefined) {
      console.log(
        `[Test Environment Agent] couchdb reset: no seeded docs tracked for ${handle.url} — ` +
          'nothing to wipe (seed with prepareTestData, or pass docIds + dataPath)'
      );
      return { tier: 'couchdb', wiped: 0, reseeded: 0, performedBy: 'agent', protectedSkipped: [] };
    }
    const onDisk = readSeededDocs(tracked.dataPath);
    assertNoProtectedDocs('couchdb reset', tracked.dataPath, onDisk);
    // Tracking never holds a protected id, but a caller-supplied docIds list might.
    const { safe, protectedIds } = partitionProtected(tracked.docIds);
    assertRestorable(tracked.dataPath, safe, onDisk);

    console.log(`[Test Environment Agent] couchdb reset: wiping ${safe.length} seeded doc(s) -> ${handle.url}`);
    const wiped = await wipeTrackedDocs(handle, safe);
    await reseedTrackedDocs(handle, tracked, wiped);
    await verifyRestored(handle, safe);

    // The dataset may have changed since the wiped set was seeded.
    this.seededData.set(trackingKey(handle), { ...tracked, docIds: onDisk.map((doc) => doc.id) });
    console.log(`[Test Environment Agent] couchdb reset complete — ${wiped} doc(s) wiped, ${safe.length} restored`);
    return {
      tier: 'couchdb',
      wiped,
      reseeded: safe.length,
      performedBy: 'agent',
      protectedSkipped: protectedIds,
    };
  }

  /**
   * Tear the environment down. Tracking is kept: CouchDB data is a bind mount that survives
   * `down -v`, so the seeded docs are still there when the same stack comes back, and a stale
   * entry is harmless (the wipe skips docs that are gone, the reseed recreates them).
   */
  async teardown(handle: EnvironmentHandle): Promise<void> {
    if (!this.useMockDocker) {
      console.log('[Test Environment Agent] HUMAN GATE — teardown (the agent runs no Docker):');
      console.log(`    ${gateEnv()}scripts/test-env-down.sh${gateArg(handle.chtCorePath)}   # docker compose down -v`);
      return;
    }

    console.log(`[Test Environment Agent] Teardown -> ${handle.url}`);
    console.log('[Test Environment Agent] (mock) teardown complete');
  }
}
