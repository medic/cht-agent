/**
 * Test Environment Agent
 *
 * Deterministic provisioning orchestrator for the Test Environment Layer
 * (QA Supervisor). It provisions a live CHT instance, applies a config,
 * discovers the deployed config, and seeds conforming test data. No LLM is
 * involved. Real paths implemented: provision (human-gated bring-up + readiness
 * polling) and applyConfig (cht-conf upload buckets). discoverConfig /
 * prepareTestData / the couchdb-tier reset real paths land in #66 phase 3.
 *
 * See: designs/layer_recommendations/test-environment-layer.md
 */

import {
  ApplyConfigOptions,
  ConfigActionResult,
  ConfigApplyResult,
  ConfigUploadAction,
  DiscoveredConfig,
  EnvironmentHandle,
  ProvisionOptions,
  ResetTier,
  TestDataResult,
} from '../types';
import { MOCK_TEST_ENV_DATA, mockConfigActionResult } from './test-environment-agent.mock-data';
import { waitForReady } from '../utils/cht-readiness';
import { runBucket } from '../utils/cht-conf-runner';

const NOT_IMPLEMENTED = 'Docker orchestration not yet implemented';

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

export class TestEnvironmentAgent {
  private readonly useMockDocker: boolean;

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
   * can be generated to conform to it.
   */
  async discoverConfig(handle: EnvironmentHandle): Promise<DiscoveredConfig> {
    if (!this.useMockDocker) {
      throw new Error(NOT_IMPLEMENTED);
    }

    console.log(`[Test Environment Agent] Discovering config from ${handle.url}...`);
    const config = structuredClone(MOCK_TEST_ENV_DATA.config);
    console.log(
      `[Test Environment Agent] Discovered ${config.contactTypes.length} contact types, ` +
        `${Object.keys(config.roles).length} roles, ${config.forms.length} forms`
    );
    return config;
  }

  /**
   * Generate and seed test data (places, people, reports, users) that conforms
   * to the discovered config.
   */
  async prepareTestData(
    handle: EnvironmentHandle,
    config: DiscoveredConfig
  ): Promise<TestDataResult> {
    if (!this.useMockDocker) {
      throw new Error(NOT_IMPLEMENTED);
    }

    console.log(
      `[Test Environment Agent] Preparing test data for ${config.contactTypes.length} contact types -> ${handle.url}`
    );
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
   * in the recommendation doc.
   */
  async reset(handle: EnvironmentHandle, tier: ResetTier): Promise<void> {
    if (!this.useMockDocker) {
      // couchdb-tier wipe/reseed operates on the docs prepareTestData seeds,
      // so it lands with test-data prep in a later phase.
      if (tier === 'couchdb') {
        throw new Error('couchdb-tier reset requires seeded-data tracking (lands in #66 Phase 3)');
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
   * Tear the environment down and clean up volumes.
   */
  async teardown(handle: EnvironmentHandle): Promise<void> {
    if (!this.useMockDocker) {
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
