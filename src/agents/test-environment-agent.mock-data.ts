import { DiscoveredConfig, TestDataResult } from '../types';

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
  },
  testData: {
    placesCreated: 3,
    peopleCreated: 5,
    reportsCreated: 4,
    usersCreated: 2,
    warnings: [],
  },
};
