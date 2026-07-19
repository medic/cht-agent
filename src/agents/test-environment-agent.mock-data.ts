import {
  CompiledSettingsVerifyOptions,
  ConfigActionResult,
  ConfigUploadAction,
  DiscoveredConfig,
  FormXmlVerifyOptions,
  TestDataResult,
  VerifyArtifactResult,
} from '../types';
import { CONFIG_ACTION_COMMANDS } from '../utils/cht-conf-runner';

/**
 * Raw deterministic fixtures for the Test Environment Agent's mock mode.
 *
 * The agent wraps these and stamps `source` itself (mirrors how
 * code-context-agent.mock-data holds raw data while the agent computes the
 * envelope). No Docker, cht-conf, or CouchDB calls are made in mock mode.
 */
export type MockTestEnvData = {
  url: string;
  auth: { user: string; password: string };
  network: string;
  config: DiscoveredConfig;
  testData: TestDataResult;
};

/**
 * Build a successful (uploaded), warning-free mock result for a single bucket.
 */
export const mockConfigActionResult = (action: ConfigUploadAction): ConfigActionResult => ({
  action,
  status: 'uploaded',
  commands: [...CONFIG_ACTION_COMMANDS[action]],
  warnings: [],
});

/**
 * Build a passing mock form-xml verifyArtifact result (mock mode has no live
 * instance to fetch from, so it echoes each expected bind as satisfied).
 */
export const mockVerifyArtifactResult = (options: FormXmlVerifyOptions): VerifyArtifactResult => {
  // One passing check per asserted attribute (mock mode has no live instance to
  // fetch from, so it echoes each expected attr as satisfied). For an absence
  // assertion (expected null) the mock reports it as satisfied without an actual.
  const checks = options.expectedBinds.flatMap((bind) =>
    Object.entries(bind.attrs).map(([attr, expected]) => ({
      nodeset: bind.nodeset,
      attr,
      expected,
      ...(expected !== null ? { actual: expected } : {}),
      passed: true,
    })),
  );
  return {
    kind: 'form-xml',
    artifact: options.artifactName,
    configArtifact: options.configArtifact,
    passed: true,
    checks,
    summary: `${options.artifactName}: all ${checks.length} bind assertion(s) passed (mock)`,
  };
};

/**
 * P4: build a passing mock compiled-settings verifyArtifact result (mock mode has
 * no live instance to fetch from, so it echoes each requested section as matched).
 */
export const mockCompiledSettingsVerifyResult = (
  options: CompiledSettingsVerifyOptions
): VerifyArtifactResult => {
  const checks = options.sections.map((path) => ({ path, passed: true }));
  return {
    kind: 'compiled-settings',
    artifact: options.artifactName,
    configArtifact: options.configArtifact,
    passed: true,
    checks,
    summary: `${options.artifactName}: all ${checks.length} settings section(s) match (mock)`,
  };
};

export const MOCK_TEST_ENV_DATA: MockTestEnvData = {
  url: 'https://nginx',
  // matches the defaults set by cht-core's scripts/docker-helper/cht-docker-compose.sh
  auth: { user: 'medic', password: 'password' },
  network: 'cht-agent-net',
  config: {
    contactTypes: [
      { id: 'district_hospital' },
      { id: 'health_center', parents: ['district_hospital'] },
      { id: 'clinic', parents: ['health_center'] },
      { id: 'person', parents: ['clinic', 'health_center'], person: true },
    ],
    roles: {
      chw: { name: 'CHW', offline: true },
      supervisor: { name: 'Supervisor', offline: false },
    },
    permissions: {
      can_edit: ['chw', 'supervisor'],
      can_export_messages: ['supervisor'],
    },
    transitions: {
      update_clinics: true,
      death_reporting: { disable: false },
    },
    forms: ['delivery', 'pregnancy', 'assessment'],
    formVersions: {
      delivery: '1-mockrev',
      pregnancy: '1-mockrev',
      assessment: '1-mockrev',
    },
  },
  testData: {
    placesCreated: 3,
    peopleCreated: 5,
    reportsCreated: 4,
    usersCreated: 2,
    warnings: [],
    succeeded: true,
    // One id per mock place/person/report (users are accounts, not docs).
    seededDocIds: [
      'mock-place-district-1',
      'mock-place-health-center-1',
      'mock-place-clinic-1',
      'mock-person-1',
      'mock-person-2',
      'mock-person-3',
      'mock-person-4',
      'mock-person-5',
      'mock-report-delivery-1',
      'mock-report-pregnancy-1',
      'mock-report-pregnancy-2',
      'mock-report-assessment-1',
    ],
  },
};
