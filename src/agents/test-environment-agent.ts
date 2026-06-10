/**
 * Test Environment Agent
 *
 * Deterministic provisioning orchestrator for the Test Environment Layer
 * (QA Supervisor). It provisions a live CHT instance, applies a config,
 * discovers the deployed config, and seeds conforming test data. No LLM is
 * involved. This file implements mock mode only; the real Docker / cht-conf /
 * CouchDB orchestration lands in #66.
 *
 * See: designs/layer_recommendations/test-environment-layer.md
 */

import {
  DiscoveredConfig,
  EnvironmentHandle,
  ProvisionOptions,
  ResetTier,
  TestDataResult,
} from '../types';
import { MOCK_TEST_ENV_DATA } from './test-environment-agent.mock-data';
import { waitForReady } from '../utils/cht-readiness';

const NOT_IMPLEMENTED = 'Docker orchestration not yet implemented';

// Real-path defaults: the human brings CHT up on cht-agent-net; the agent
// reaches it at the nginx service hostname with the cht-docker-compose.sh creds.
const DEFAULT_ENV_URL = 'https://nginx';
const DEFAULT_NETWORK = 'cht-agent-net';
const DEFAULT_AUTH = { user: 'medic', password: 'password' };
// Humans may take minutes to run local-images + compose up.
const DEFAULT_PROVISION_WAIT_MS = 300_000;

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
      console.log('[Test Environment Agent] HUMAN GATE — bring the env up (the agent runs no Docker):');
      console.log(`    scripts/test-env-up.sh ${options.chtCorePath ?? '<cht-core>'}   # build + start on ${network}`);
      console.log(`[Test Environment Agent] Polling ${url}/api/v2/monitoring until healthy...`);

      await waitForReady(url, { maxWaitMs: DEFAULT_PROVISION_WAIT_MS, ...options.readiness });

      console.log(`[Test Environment Agent] Ready at ${url} (network: ${network})`);
      return { url, auth: { ...auth }, network, chtCorePath: options.chtCorePath, source: 'docker' };
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
   * Apply (compile + upload) a config project from the working copy to the
   * instance. Defaults to cht-core's in-repo `config/default` project.
   */
  async applyConfig(handle: EnvironmentHandle, configPath = 'config/default'): Promise<void> {
    if (!this.useMockDocker) {
      throw new Error(NOT_IMPLEMENTED);
    }

    console.log(`[Test Environment Agent] Applying config: ${configPath} -> ${handle.url}`);
    console.log('[Test Environment Agent] (mock) config applied');
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
      throw new Error(NOT_IMPLEMENTED);
    }

    console.log(`[Test Environment Agent] Reset (${tier}) -> ${handle.url}`);
    console.log('[Test Environment Agent] (mock) reset complete');
  }

  /**
   * Tear the environment down and clean up volumes.
   */
  async teardown(handle: EnvironmentHandle): Promise<void> {
    if (!this.useMockDocker) {
      throw new Error(NOT_IMPLEMENTED);
    }

    console.log(`[Test Environment Agent] Teardown -> ${handle.url}`);
    console.log('[Test Environment Agent] (mock) teardown complete');
  }
}
