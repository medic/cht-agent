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
  ResetTier,
  RoleConfig,
  TestDataResult,
  TransitionConfig,
} from '../types';
import { MOCK_TEST_ENV_DATA, mockConfigActionResult } from './test-environment-agent.mock-data';
import { waitForReady } from '../utils/cht-readiness';
import { runBucket, runChtConf } from '../utils/cht-conf-runner';
import { BulkDoc, bulkDocs, DocRevRow, fetchDocRevs, fetchFormRevs, fetchSettings } from '../utils/cht-api';
import {
  classifySeededDocs,
  cleanSeededDocs,
  countCreatedUsers,
  hasUsersCsv,
  parseUploadDocsSummary,
  readSeededDocs,
  SeededDoc,
  SeededDocCounts,
} from '../utils/test-data';

// Real-path defaults: the human brings CHT up on cht-agent-net; the agent
// reaches it at the nginx service hostname with the cht-docker-compose.sh creds.
const DEFAULT_ENV_URL = 'https://nginx';
const DEFAULT_NETWORK = 'cht-agent-net';
const DEFAULT_AUTH = { user: 'medic', password: 'password' };
// Humans may take minutes to run local-images + compose up.
const DEFAULT_PROVISION_WAIT_MS = 300_000;

// Default config project (cht-core in-repo) and the full cht-conf upload set.
const DEFAULT_CONFIG_PATH = 'config/default';
const DEFAULT_CONFIG_ACTIONS: ConfigUploadAction[] = [
  'app-settings',
  'app-forms',
  'contact-forms',
  'resources',
];

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

/** A resolved real-mode target: a credential-free instance URL + its auth. */
interface RealTarget {
  url: string;
  auth: { user: string; password: string };
}

/**
 * Resolve the real-mode instance URL + credentials from the options, the
 * CHT_URL / COUCHDB_* env seams, and any credentials embedded in the URL:
 * - URL fallback: options.url -> CHT_URL (trimmed; blank ignored) -> the
 *   on-network default; canonicalized (no trailing slash).
 * - Embedded basic-auth creds are stripped OUT of the URL (logged everywhere,
 *   and undici rejects credentialed URLs); they survive only as an auth
 *   fallback, decoded raw-`%`-tolerantly.
 * - Auth precedence: options.auth -> embedded creds -> COUCHDB_* env (the same
 *   seam scripts/test-env-up.sh uses) -> the default.
 */
type BasicAuth = { user: string; password: string };

/**
 * Resolve real-mode credentials by precedence: options.auth -> creds embedded in
 * the URL -> the COUCHDB_USER/COUCHDB_PASSWORD env seam -> the default. The env
 * seam is gated on COUCHDB_PASSWORD (COUCHDB_USER falls back to the default user).
 */
const resolveRealAuth = (options: ProvisionOptions, embeddedAuth: BasicAuth | undefined): BasicAuth => {
  const envAuth = process.env.COUCHDB_PASSWORD
    ? { user: process.env.COUCHDB_USER ?? DEFAULT_AUTH.user, password: process.env.COUCHDB_PASSWORD }
    : undefined;
  return options.auth ?? embeddedAuth ?? envAuth ?? DEFAULT_AUTH;
};

const resolveRealTarget = (options: ProvisionOptions): RealTarget => {
  const envUrl = process.env.CHT_URL?.trim() || undefined;
  const resolved = new URL(options.url ?? envUrl ?? DEFAULT_ENV_URL);
  const embeddedAuth = resolved.username
    ? { user: decodeUserinfo(resolved.username), password: decodeUserinfo(resolved.password) }
    : undefined;
  resolved.username = '';
  resolved.password = '';
  const url = stripTrailingSlashes(resolved.toString());
  return { url, auth: resolveRealAuth(options, embeddedAuth) };
};

/** Build the deterministic mock-mode handle (no instance, no Docker). */
const buildMockHandle = (options: ProvisionOptions, network: string): EnvironmentHandle => ({
  url: options.url ?? MOCK_TEST_ENV_DATA.url,
  auth: { ...(options.auth ?? MOCK_TEST_ENV_DATA.auth) },
  network,
  chtCorePath: options.chtCorePath,
  source: 'mock',
});

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

/**
 * Aggregate per-bucket results into the ConfigApplyResult envelope. Shared by
 * the mock and real paths so both return an identical shape.
 */
const toApplyResult = (
  configPath: string,
  artifact: string | undefined,
  results: ConfigActionResult[]
): ConfigApplyResult => ({
  configPath,
  ...(artifact ? { artifact } : {}),
  actions: results,
  succeeded: results.every((result) => result.status !== 'failed'),
  warnings: results.flatMap((result) => result.warnings),
});

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
const describeRunFailure = (label: string, run: ChtConfExecResult): string => {
  if (run.timedOut) {
    return `cht-conf ${label} timed out`;
  }
  if (run.startError !== undefined) {
    return `cht-conf ${label} failed to start: ${run.startError}`;
  }
  return `cht-conf ${label} exited with code ${run.exitCode}`;
};

const runSucceeded = (run: ChtConfExecResult): boolean =>
  run.exitCode === 0 && !run.timedOut && run.startError === undefined;

/** What prepareTestData tracked for a provisioned env, keyed by handle URL. */
interface SeededDataRecord {
  dataPath: string;
  docIds: string[];
}

/** cht-conf run options shared by the seeding phases (verbs/logLabel added per call). */
type SeedRunBase = Pick<ChtConfExecOptions, 'instanceUrl' | 'configPath' | 'cwd' | 'bin' | 'timeoutMs'>;

/** Warn on a partial or empty upload-docs result (never fails the seed). */
const noteUploadShortfall = (
  docsRun: ChtConfExecResult,
  docsOk: boolean,
  dataPath: string,
  warnings: string[]
): void => {
  const summary = parseUploadDocsSummary(docsRun.output);
  if (docsOk && summary && summary.uploaded < summary.total) {
    warnings.push(`only ${summary.uploaded} of ${summary.total} docs uploaded — see the upload-docs report in ${dataPath}`);
  }
  if (docsOk && !summary) {
    warnings.push(`no docs were uploaded — does ${dataPath}/csv exist and contain CSV files?`);
  }
};

/**
 * Docs phase: clear a previous run's json_docs (csv-to-docs writes alongside what
 * is there, so a superseded dataset would otherwise be re-uploaded), run
 * csv-to-docs + upload-docs in one ordered cht-conf process, then read + classify
 * what landed on disk (the seeding evidence and the reset worklist).
 */
const prepareDocs = async (
  shared: SeedRunBase,
  dataPath: string,
  config: DiscoveredConfig,
  warnings: string[]
): Promise<{ docsOk: boolean; seeded: SeededDoc[]; counts: SeededDocCounts }> => {
  const staleDocs = cleanSeededDocs(dataPath);
  if (staleDocs > 0) {
    console.log(`[Test Environment Agent] Cleared ${staleDocs} stale json_docs file(s) from a previous run`);
  }

  const docsRun = await runChtConf({
    verbs: ['csv-to-docs', 'upload-docs'],
    logLabel: 'test-data: csv-to-docs upload-docs',
    ...shared,
  });
  const docsOk = runSucceeded(docsRun);
  if (!docsOk) {
    warnings.push(describeRunFailure('csv-to-docs/upload-docs', docsRun));
  }

  const seeded = readSeededDocs(dataPath);
  const counts = classifySeededDocs(seeded, config);
  warnings.push(...counts.warnings);
  noteUploadShortfall(docsRun, docsOk, dataPath, warnings);
  return { docsOk, seeded, counts };
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

/**
 * couchdb reset — wipe: delete the tracked docs at their CURRENT revs (sentinel
 * may have bumped them). Throws if any deletion is rejected — a half-reset
 * environment must not pass as clean.
 */
const wipeTrackedDocs = async (handle: EnvironmentHandle, tracked: SeededDataRecord): Promise<void> => {
  const rows = await fetchDocRevs(handle.url, handle.auth, tracked.docIds);
  const deletions = buildTombstones(rows);
  if (deletions.length === 0) {
    return;
  }
  const outcomes = await bulkDocs(handle.url, handle.auth, deletions);
  const failed = outcomes.filter((row) => row.error);
  if (failed.length > 0) {
    const failedIds = failed.map((row) => row.id ?? 'unknown').slice(0, 5).join(', ');
    throw new Error(`couchdb reset failed to delete ${failed.length} doc(s): ${failedIds}`);
  }
};

/**
 * couchdb reset — reseed: re-upload pristine copies (deterministic ids come back
 * with fresh revs). upload-docs exits 0 with no summary when it uploaded nothing,
 * so require a summary and measure it against what the pre-flight saw.
 */
const reseedTrackedDocs = async (
  handle: EnvironmentHandle,
  tracked: SeededDataRecord,
  onDisk: SeededDoc[]
): Promise<void> => {
  const reseed = await runChtConf({
    verbs: ['upload-docs'],
    instanceUrl: credentialedUrl(handle),
    configPath: tracked.dataPath,
    cwd: tracked.dataPath,
    logLabel: 'couchdb reset: upload-docs',
  });
  if (!runSucceeded(reseed)) {
    throw new Error(`couchdb reset: reseed failed — ${describeRunFailure('upload-docs', reseed)}`);
  }
  const summary = parseUploadDocsSummary(reseed.output);
  const uploadedCount = summary?.uploaded ?? 0;
  if (uploadedCount < onDisk.length) {
    throw new Error(`couchdb reset: reseed uploaded only ${uploadedCount} of ${onDisk.length} docs`);
  }
};

/** Print the human-gated restart/full reset instructions (the agent runs no Docker). */
const printResetGate = (handle: EnvironmentHandle, tier: ResetTier): void => {
  const target = handle.chtCorePath ?? '<cht-core>';
  console.log(`[Test Environment Agent] HUMAN GATE — reset (${tier}); the agent runs no Docker:`);
  if (tier === 'restart') {
    console.log(`    (in ${target}/local-build) docker compose restart`);
  } else {
    console.log(`    scripts/test-env-down.sh ${target} && scripts/test-env-up.sh ${target}`);
  }
  console.log('[Test Environment Agent] Re-confirm health with provision()/waitForReady after.');
};

export class TestEnvironmentAgent {
  private readonly useMockDocker: boolean;
  /** Seeded-doc tracking per environment (handle URL) for the couchdb reset. */
  private readonly seededData = new Map<string, SeededDataRecord>();

  constructor(options: { useMockDocker?: boolean } = {}) {
    this.useMockDocker = options.useMockDocker !== false;
  }

  /**
   * Bring up a reachable CHT environment. Requires either a local working copy
   * (chtCorePath, built via local-images) or a published version.
   */
  async provision(options: ProvisionOptions): Promise<EnvironmentHandle> {
    if (!options.chtCorePath && !options.version) {
      throw new Error('provision requires either chtCorePath or version');
    }

    const source = options.chtCorePath
      ? `local code (${options.chtCorePath})`
      : `published version ${options.version}`;
    const network = options.network ?? DEFAULT_NETWORK;

    console.log('\n[Test Environment Agent] Provisioning environment...');
    console.log(`[Test Environment Agent] Source: ${source}`);

    if (!this.useMockDocker) {
      // Resolve the instance URL + creds from options / CHT_URL / COUCHDB_* /
      // any URL-embedded creds (see resolveRealTarget for the exact precedence).
      const { url, auth } = resolveRealTarget(options);

      // The agent runs no Docker — the human brings the environment up.
      const target = options.chtCorePath ?? '<cht-core>';
      console.log('[Test Environment Agent] HUMAN GATE — bring the env up (agent runs no Docker):');
      console.log(`    scripts/test-env-up.sh ${target}   # build + start on ${network}`);
      console.log(`[Test Environment Agent] Polling ${url}/api/v2/monitoring until healthy...`);

      await waitForReady(url, { maxWaitMs: DEFAULT_PROVISION_WAIT_MS, ...options.readiness });

      console.log(`[Test Environment Agent] Ready at ${url} (network: ${network})`);
      return {
        url,
        auth: { ...auth },
        network,
        chtCorePath: options.chtCorePath,
        source: 'docker',
      };
    }

    const handle = buildMockHandle(options, network);
    console.log(`[Test Environment Agent] Ready at ${handle.url} (network: ${handle.network})`);
    return handle;
  }

  /**
   * Apply (compile + upload) a config project to the instance via cht-conf.
   * Defaults to cht-core's in-repo `config/default`; cht-conf tickets pass the
   * mounted deployment config (CHT_CONF_PATH). `actions` selects which cht-conf
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
    const configPath = opts.configPath ?? DEFAULT_CONFIG_PATH;
    const actions = opts.actions ?? DEFAULT_CONFIG_ACTIONS;
    const artifact = opts.artifact;

    const scope = artifact ? `${actions.join(', ')}; artifact=${artifact}` : actions.join(', ');
    console.log(`[Test Environment Agent] Applying config: ${configPath} (${scope}) -> ${handle.url}`);

    if (!this.useMockDocker) {
      const results = await this.applyConfigReal(handle, configPath, actions, artifact);
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
    artifact: string | undefined
  ): Promise<ConfigActionResult[]> {
    const instanceUrl = credentialedUrl(handle);
    const results: ConfigActionResult[] = [];
    for (const action of actions) {
      results.push(await runBucket({ action, instanceUrl, configPath, artifact }));
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
   * `<dataPath>/csv/*.csv` into docs on the instance, then `create-users`
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
   * the couchdb reset. Requires options.dataPath (a cht-conf project with csv/).
   */
  private async prepareTestDataReal(
    handle: EnvironmentHandle,
    config: DiscoveredConfig,
    options: PrepareTestDataOptions
  ): Promise<TestDataResult> {
    const dataPath = options.dataPath;
    if (!dataPath) {
      throw new Error('prepareTestData requires options.dataPath (a cht-conf project folder with csv/)');
    }
    const shared: SeedRunBase = {
      instanceUrl: credentialedUrl(handle),
      configPath: dataPath,
      // cht-conf drops report files (upload-docs.<ts>.log.json) in its cwd;
      // keep them in the data project, not the repo.
      cwd: dataPath,
      bin: options.bin,
      timeoutMs: options.timeoutMs,
    };
    const warnings: string[] = [];

    const { docsOk, seeded, counts } = await prepareDocs(shared, dataPath, config, warnings);
    const { usersCreated, usersOk } = await seedUsers(shared, dataPath, warnings);

    // Only a successful, non-empty seed defines the reset worklist — a failed or
    // empty re-seed must not clobber a live one (docs from the earlier seed are
    // still on the instance).
    if (docsOk && seeded.length > 0) {
      this.seededData.set(handle.url, { dataPath, docIds: seeded.map((doc) => doc.id) });
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
   * prepareTestData seeded and re-uploads pristine copies, leaving the deployed
   * config untouched. restart/full remain human-gated Docker operations.
   */
  async reset(handle: EnvironmentHandle, tier: ResetTier): Promise<void> {
    if (this.useMockDocker) {
      console.log(`[Test Environment Agent] Reset (${tier}) -> ${handle.url}`);
      console.log('[Test Environment Agent] (mock) reset complete');
      return;
    }

    // The couchdb tier is the one reset the agent performs itself; restart/full
    // stay human-gated Docker operations.
    if (tier === 'couchdb') {
      await this.resetCouchdbTier(handle);
      return;
    }
    printResetGate(handle, tier);
  }

  /**
   * couchdb-tier reset: delete the tracked seeded docs at their CURRENT revs
   * (sentinel may have bumped them), then reseed pristine copies from the
   * tracked json_docs. The reseed source is pre-flighted BEFORE the wipe so a
   * vanished data project fails closed instead of leaving the instance empty.
   * Throws when the wipe or the reseed does not fully apply — a half-reset
   * environment must not pass as clean.
   */
  private async resetCouchdbTier(handle: EnvironmentHandle): Promise<void> {
    const tracked = this.seededData.get(handle.url);
    if (!tracked || tracked.docIds.length === 0) {
      console.log(
        `[Test Environment Agent] couchdb reset: no seeded docs tracked for ${handle.url} — ` +
          'nothing to wipe (seed with prepareTestData first)'
      );
      return;
    }

    // Pre-flight the reseed source BEFORE the destructive wipe: if the data
    // project's json_docs are gone, wiping would leave the environment empty
    // while this method reports success.
    const onDisk = readSeededDocs(tracked.dataPath);
    if (onDisk.length === 0) {
      throw new Error(
        `couchdb reset: ${tracked.dataPath}/json_docs has no docs to reseed from — ` +
          're-run prepareTestData instead of resetting'
      );
    }

    console.log(
      `[Test Environment Agent] couchdb reset: wiping ${tracked.docIds.length} seeded doc(s) -> ${handle.url}`
    );
    await wipeTrackedDocs(handle, tracked);
    await reseedTrackedDocs(handle, tracked, onDisk);

    // The reseeded docs are the new tracked state (the dataset may have
    // changed since the wiped set was seeded).
    this.seededData.set(handle.url, { dataPath: tracked.dataPath, docIds: onDisk.map((doc) => doc.id) });

    console.log(
      `[Test Environment Agent] couchdb reset complete — ` +
        `${tracked.docIds.length} doc(s) wiped, ${onDisk.length} reseeded`
    );
  }

  /**
   * Tear the environment down and clean up volumes.
   */
  async teardown(handle: EnvironmentHandle): Promise<void> {
    if (!this.useMockDocker) {
      // The environment (and every doc in it) is going away with the volumes.
      this.seededData.delete(handle.url);

      // Teardown is `docker compose down -v` — human-gated, the agent runs none.
      const target = handle.chtCorePath ?? '<cht-core>';
      console.log('[Test Environment Agent] HUMAN GATE — teardown (the agent runs no Docker):');
      console.log(`    scripts/test-env-down.sh ${target}   # docker compose down -v`);
      return;
    }

    console.log(`[Test Environment Agent] Teardown -> ${handle.url}`);
    console.log('[Test Environment Agent] (mock) teardown complete');
  }
}
