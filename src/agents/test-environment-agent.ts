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
 * The LangGraph node + CLI land in a later #66 phase.
 *
 * See: designs/layer_recommendations/test-environment-layer.md
 */

import {
  ApplyConfigOptions,
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
import { BulkDoc, bulkDocs, fetchDocRevs, fetchFormRevs, fetchSettings } from '../utils/cht-api';
import {
  classifySeededDocs,
  cleanSeededDocs,
  countCreatedUsers,
  hasUsersCsv,
  parseUploadDocsSummary,
  readSeededDocs,
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

const parseRoles = (raw: unknown): Record<string, RoleConfig> => {
  if (!isRecord(raw)) {
    return {};
  }
  const roles: Record<string, RoleConfig> = {};
  for (const [name, value] of Object.entries(raw)) {
    if (!isRecord(value)) {
      continue;
    }
    roles[name] = {
      ...(typeof value.name === 'string' ? { name: value.name } : {}),
      ...(typeof value.offline === 'boolean' ? { offline: value.offline } : {}),
    };
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
      const url = options.url ?? DEFAULT_ENV_URL;
      const auth = options.auth ?? DEFAULT_AUTH;

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

    const handle: EnvironmentHandle = {
      url: options.url ?? MOCK_TEST_ENV_DATA.url,
      auth: { ...(options.auth ?? MOCK_TEST_ENV_DATA.auth) },
      network,
      chtCorePath: options.chtCorePath,
      source: 'mock',
    };

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
      // Real path: one cht-conf invocation per bucket against the running
      // instance (the agent runs no Docker — cht-conf talks over HTTP). Buckets
      // run independently so one failure doesn't abort the rest; never push.
      const instanceUrl = credentialedUrl(handle);
      const results: ConfigActionResult[] = [];
      for (const action of actions) {
        results.push(await runBucket({ action, instanceUrl, configPath, artifact }));
      }
      return toApplyResult(configPath, artifact, results);
    }

    const results = actions.map((action) => mockConfigActionResult(action));
    console.log(`[Test Environment Agent] (mock) config applied — ${results.length} action(s)`);
    return toApplyResult(configPath, artifact, results);
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

    if (!this.useMockDocker) {
      const dataPath = options.dataPath;
      if (!dataPath) {
        throw new Error('prepareTestData requires options.dataPath (a cht-conf project folder with csv/)');
      }
      const shared = {
        instanceUrl: credentialedUrl(handle),
        configPath: dataPath,
        // cht-conf drops report files (upload-docs.<ts>.log.json) in its cwd;
        // keep them in the data project, not the repo.
        cwd: dataPath,
        bin: options.bin,
        timeoutMs: options.timeoutMs,
      };
      const warnings: string[] = [];

      // csv-to-docs never cleans json_docs (it writes alongside what is
      // there), so clear a previous run's docs first — otherwise a superseded
      // dataset would be re-uploaded and counted as this run's data.
      const staleDocs = cleanSeededDocs(dataPath);
      if (staleDocs > 0) {
        console.log(`[Test Environment Agent] Cleared ${staleDocs} stale json_docs file(s) from a previous run`);
      }

      // Docs: CSV -> json_docs -> instance, in one ordered cht-conf process.
      const docsRun = await runChtConf({
        verbs: ['csv-to-docs', 'upload-docs'],
        logLabel: 'test-data: csv-to-docs upload-docs',
        ...shared,
      });
      const docsOk = runSucceeded(docsRun);
      if (!docsOk) {
        warnings.push(describeRunFailure('csv-to-docs/upload-docs', docsRun));
      }

      // What landed on disk is the seeding evidence AND the reset worklist
      // (deterministic ids: re-running the same CSVs rewrites the same files).
      const seeded = readSeededDocs(dataPath);
      const counts = classifySeededDocs(seeded, config);
      warnings.push(...counts.warnings);

      const summary = parseUploadDocsSummary(docsRun.output);
      if (docsOk && summary && summary.uploaded < summary.total) {
        warnings.push(`only ${summary.uploaded} of ${summary.total} docs uploaded — see the upload-docs report in ${dataPath}`);
      }
      if (docsOk && !summary) {
        warnings.push(`no docs were uploaded — does ${dataPath}/csv exist and contain CSV files?`);
      }

      // Users: accounts via POST /api/v1/users, driven by users.csv (either
      // hand-written or generated by csv-to-docs from users.*.csv inputs).
      // cht-conf throws on a missing users.csv, so gate on its existence.
      let usersCreated = 0;
      let usersOk = true;
      if (hasUsersCsv(dataPath)) {
        const usersRun = await runChtConf({
          verbs: ['create-users'],
          logLabel: 'test-data: create-users',
          ...shared,
        });
        usersOk = runSucceeded(usersRun);
        const attempts = countCreatedUsers(usersRun.output);
        // On failure the last logged "Creating user" attempt is the one that
        // blew up — count only the ones before it.
        usersCreated = usersOk ? attempts : Math.max(0, attempts - 1);
        if (!usersOk) {
          warnings.push(describeRunFailure('create-users', usersRun));
        }
      } else {
        console.log('[Test Environment Agent] No users.csv in the data project — skipping create-users');
      }

      // Only a successful, non-empty seed defines the reset worklist — a
      // failed or empty re-seed must not clobber a live one (docs from the
      // earlier seed are still on the instance). Deterministic ids mean a
      // successful follow-up seed re-covers a failed run's partial upload.
      if (docsOk && seeded.length > 0) {
        this.seededData.set(handle.url, { dataPath, docIds: seeded.map((doc) => doc.id) });
      }

      const result: TestDataResult = {
        placesCreated: counts.places,
        peopleCreated: counts.people,
        reportsCreated: counts.reports,
        usersCreated,
        warnings,
        succeeded: docsOk && usersOk,
        seededDocIds: seeded.map((doc) => doc.id),
      };
      console.log(
        `[Test Environment Agent] Seeded ${result.placesCreated} places, ` +
          `${result.peopleCreated} people, ${result.reportsCreated} reports, ` +
          `${result.usersCreated} users`
      );
      return result;
    }

    const result = structuredClone(MOCK_TEST_ENV_DATA.testData);
    console.log(
      `[Test Environment Agent] Seeded ${result.placesCreated} places, ` +
        `${result.peopleCreated} people, ${result.reportsCreated} reports, ` +
        `${result.usersCreated} users`
    );
    return result;
  }

  /**
   * Reset the environment to a known state. See the three-tier reset strategy
   * in the recommendation doc. The couchdb tier is the one reset the agent
   * performs itself (CouchDB HTTP API — no Docker): it wipes the docs the last
   * prepareTestData seeded and re-uploads pristine copies, leaving the deployed
   * config untouched. restart/full remain human-gated Docker operations.
   */
  async reset(handle: EnvironmentHandle, tier: ResetTier): Promise<void> {
    if (!this.useMockDocker) {
      if (tier === 'couchdb') {
        await this.resetCouchdbTier(handle);
        return;
      }

      // restart/full are Docker operations — human-gated, the agent runs none.
      const target = handle.chtCorePath ?? '<cht-core>';
      console.log(`[Test Environment Agent] HUMAN GATE — reset (${tier}); the agent runs no Docker:`);
      if (tier === 'restart') {
        console.log(`    (in ${target}/local-build) docker compose restart`);
      } else {
        console.log(`    scripts/test-env-down.sh ${target} && scripts/test-env-up.sh ${target}`);
      }
      console.log('[Test Environment Agent] Re-confirm health with provision()/waitForReady after.');
      return;
    }

    console.log(`[Test Environment Agent] Reset (${tier}) -> ${handle.url}`);
    console.log('[Test Environment Agent] (mock) reset complete');
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
    const rows = await fetchDocRevs(handle.url, handle.auth, tracked.docIds);
    const deletions: BulkDoc[] = [];
    for (const row of rows) {
      if (row.rev !== undefined && !row.deleted && !row.missing) {
        deletions.push({ _id: row.id, _rev: row.rev, _deleted: true });
      }
    }

    if (deletions.length > 0) {
      const outcomes = await bulkDocs(handle.url, handle.auth, deletions);
      const failed = outcomes.filter((row) => row.error);
      if (failed.length > 0) {
        const failedIds = failed.map((row) => row.id ?? 'unknown').slice(0, 5).join(', ');
        throw new Error(`couchdb reset failed to delete ${failed.length} doc(s): ${failedIds}`);
      }
    }

    // Reseed pristine copies — deterministic ids mean the same docs come back
    // with fresh revs (CouchDB allows re-creating a deleted id without a rev).
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
    // upload-docs exits 0 with NO summary when it uploaded nothing, and the
    // summary total is only the on-disk file count — so require a summary and
    // measure it against what the pre-flight saw, never against itself.
    const summary = parseUploadDocsSummary(reseed.output);
    const uploadedCount = summary?.uploaded ?? 0;
    if (uploadedCount < onDisk.length) {
      throw new Error(`couchdb reset: reseed uploaded only ${uploadedCount} of ${onDisk.length} docs`);
    }

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
