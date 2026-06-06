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

const NOT_IMPLEMENTED = 'Docker orchestration not yet implemented';

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

    console.log('\n[Test Environment Agent] Provisioning environment...');
    console.log(
      `[Test Environment Agent] Source: ${options.chtCorePath ? `local code (${options.chtCorePath})` : `published version ${options.version}`}`
    );

    if (!this.useMockDocker) {
      throw new Error(NOT_IMPLEMENTED);
    }

    const handle: EnvironmentHandle = {
      url: MOCK_TEST_ENV_DATA.url,
      auth: MOCK_TEST_ENV_DATA.auth,
      network: options.network ?? MOCK_TEST_ENV_DATA.network,
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
    console.log(`[Test Environment Agent] Applying config: ${configPath} -> ${handle.url}`);

    if (!this.useMockDocker) {
      throw new Error(NOT_IMPLEMENTED);
    }

    console.log('[Test Environment Agent] (mock) config applied');
  }

  /**
   * Read the deployed configuration back from the running instance so test data
   * can be generated to conform to it.
   */
  async discoverConfig(handle: EnvironmentHandle): Promise<DiscoveredConfig> {
    console.log(`[Test Environment Agent] Discovering config from ${handle.url}...`);

    if (!this.useMockDocker) {
      throw new Error(NOT_IMPLEMENTED);
    }

    const config = MOCK_TEST_ENV_DATA.config;
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
    console.log(
      `[Test Environment Agent] Preparing test data for ${config.contactTypes.length} contact types -> ${handle.url}`
    );

    if (!this.useMockDocker) {
      throw new Error(NOT_IMPLEMENTED);
    }

    const result = MOCK_TEST_ENV_DATA.testData;
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
    console.log(`[Test Environment Agent] Reset (${tier}) -> ${handle.url}`);

    if (!this.useMockDocker) {
      throw new Error(NOT_IMPLEMENTED);
    }

    console.log('[Test Environment Agent] (mock) reset complete');
  }

  /**
   * Tear the environment down and clean up volumes.
   */
  async teardown(handle: EnvironmentHandle): Promise<void> {
    console.log(`[Test Environment Agent] Teardown -> ${handle.url}`);

    if (!this.useMockDocker) {
      throw new Error(NOT_IMPLEMENTED);
    }

    console.log('[Test Environment Agent] (mock) teardown complete');
  }
}
