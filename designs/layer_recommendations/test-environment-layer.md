# Test Environment Layer — Recommendation Document

**Issue:** [medic/cht-agent#16](https://github.com/medic/cht-agent/issues/16)
**Status:** Draft
**Date:** 2026-04-13

---

## Summary

The Test Environment Layer is responsible for providing the QA Supervisor with a ready, configured, data-populated CHT environment. It is not responsible for test execution, verification, or reporting. Those belong to the QA Supervisor's Test Orchestration Layer ([#18](https://github.com/medic/cht-agent/issues/18)).

The layer's contract: **"I give you a healthy CHT environment with the right config and test data. You tell me when to reset or tear it down."**

### Architectural Placement

The Test Environment Layer sits under the **QA Supervisor**, alongside Test Orchestration. It acts as the first step in the QA workflow: before tests can run or manual verification can happen, there must be a live CHT instance.

```
QA Supervisor
├── Test Environment Layer     ← set up environment, config, test data
└── Test Orchestration Layer   ← run tests, manual QA, verification
```

### Scope Boundaries

| In Scope | Out of Scope |
|----------|-------------|
| Build Docker images from local code | Running tests (Test Orchestration) |
| Start/stop/reset containers | Browser automation (Test Orchestration) |
| Health check and readiness polling | Pass/fail judgment (QA Supervisor) |
| Config discovery from running instance | Reporting and evidence collection (QA Supervisor) |
| Test data generation and seeding | Test execution strategy (Test Orchestration) |
| CLI interface for independent invocation | Code validation/linting (Code Validation Layer) |

---

## Three Responsibilities

### 1. Environment Lifecycle

Manage the full lifecycle of a local CHT instance built from source.

#### Bootstrap Sequence

```
1. Build images     →  npm run local-images (in cht-core directory)
2. Start containers →  docker compose -f cht-couchdb.yml -f cht-core.yml up -d
3. Wait for ready   →  Poll /api/v2/monitoring until healthy
4. Upload config    →  cht-conf --url=<url> compile-app-settings upload-app-settings
5. Prepare data     →  Seed contacts, reports, users (see Responsibility #3)
6. Signal ready     →  Return environment handle to QA Supervisor
```

#### `npm run local-images`

The primary mechanism for building Docker images from local source code. Produces branch-specific image tags and generates compose files in `local-build/`. This is the correct foundation because it tests the actual code changes in a production-like environment.

```bash
# In cht-core directory
npm run local-images

# Start the environment
cd local-build
COUCHDB_PASSWORD=password docker compose -f cht-couchdb.yml -f cht-core.yml up -d
```

#### Readiness Strategy

CHT requires multiple services to initialize (HAProxy, API, CouchDB, Sentinel). The layer must confirm the environment is usable before signaling ready.

**Primary approach:** Poll `GET /api/v2/monitoring` with exponential backoff until a successful response. This is the same approach used by cht-conf's e2e test utilities ([cht-docker-utils.js](https://github.com/medic/cht-conf/blob/main/test/e2e/cht-docker-utils.js)).

```typescript
// Pseudocode
const waitForReady = async (url: string, maxWaitMs = 120_000): Promise<void> => {
  const start = Date.now();
  let delay = 2_000;

  while (Date.now() - start < maxWaitMs) {
    try {
      const res = await fetch(`${url}/api/v2/monitoring`);
      if (res.ok) return;
    } catch {
      // not ready yet
    }
    await sleep(delay);
    delay = Math.min(delay * 1.5, 15_000);
  }

  throw new Error(`CHT did not become ready within ${maxWaitMs}ms`);
};
```

**Supplementary checks:**
- `docker ps` to confirm all expected containers are running (nginx, sentinel, api, haproxy, healthcheck, couchdb)
- `GET /api/v1/settings` to confirm the API is serving config (not just accepting connections)

#### Reset Mechanism

Between test runs, the environment needs to return to a known state. Three strategies, in order of preference:

| Strategy | Speed | Isolation | When to Use |
|----------|-------|-----------|-------------|
| **CouchDB wipe + reseed** | Fast (~10s) | Good | Between test cases within a session |
| **Container restart** | Medium (~30-60s) | Better | Between test suites or after config changes |
| **Full teardown + rebuild** | Slow (~3-5min) | Complete | Between tickets or after code changes |

The default should be **container restart** as a balance of speed and isolation. Full teardown is reserved for when the code under test has changed (new images needed).

```bash
# Quick reset: restart containers, reseed data
docker compose restart
# wait for readiness again
# reseed test data

# Full teardown
docker compose down -v
# rebuild if needed
docker compose up -d
```

#### Teardown

```bash
docker compose -f cht-couchdb.yml -f cht-core.yml down -v
```

The `-v` flag removes volumes to ensure clean state. The layer should always teardown on completion or failure to avoid orphaned containers.

### 2. Config Discovery

Connect to a running CHT instance and discover its deployed configuration. This enables the layer to generate test data that is valid for the specific deployment.

#### Data Sources

| Endpoint | Data Retrieved |
|----------|---------------|
| `GET /api/v1/settings` | `contact_types` (hierarchy), `roles`, `permissions`, `transitions`, task/target config |
| `GET /api/v1/forms` | List of installed forms (returns array of filenames) |
| `GET /api/v1/forms/{id}.xml` | Individual form definitions |
| CouchDB `_all_docs` | Existing documents for reference |

#### Discovery Flow

```typescript
// Pseudocode
const discoverConfig = async (url: string, auth: string) => {
  const settings = await fetch(`${url}/api/v1/settings`, { headers: { Authorization: auth } });
  const forms = await fetch(`${url}/api/v1/forms`, { headers: { Authorization: auth } });

  return {
    contactTypes: settings.contact_types,   // hierarchy structure
    roles: settings.roles,                   // user types (online/offline)
    permissions: settings.permissions,       // role-permission mapping
    transitions: settings.transitions,       // enabled server-side transitions
    forms: forms,                            // installed form list
  };
};
```

#### Why Config-Driven?

The QA layer must work with **any** CHT deployment, not just a hardcoded assumed structure. Different deployments have different hierarchies, roles, and forms. Generating test data that doesn't match the deployed config will produce false failures.

### 3. Test Data Preparation

Generate and upload test data that conforms to the discovered configuration.

#### Tools

| Tool | Purpose | Invocation |
|------|---------|------------|
| **cht-conf** `csv-to-docs` | Convert CSV → JSON documents | `cht csv-to-docs` then `cht upload-docs` |
| **cht-conf** `create-users` | Create user accounts from CSV | `cht create-users` (reads `users.csv`) |
| **cht-conf** `compile-app-settings` | Compile and upload app config | `cht compile-app-settings upload-app-settings` |
| **CHT API** | Direct document creation | `POST /api/v1/people`, `POST /api/v1/places` |
| **CouchDB API** | Bulk document operations | `POST /medic/_bulk_docs` |
| **cht-datasource** | Typed data access (read/verify) | `@medic/cht-datasource` remote adapter |

#### Programmatic cht-conf Invocation

Based on the existing pattern in [cht-core's test utilities](https://github.com/medic/cht-core/blob/master/tests/utils/cht-conf.js):

```typescript
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

const runChtConf = async (action: string, cwd: string, url: string) => {
  const chtConfPath = path.resolve(process.cwd(), './node_modules/.bin/cht');
  const { stdout } = await execAsync(
    `${chtConfPath} --url=${url} ${action} --force --accept-self-signed-certs --debug`,
    { cwd }
  );
  return stdout;
};
```

#### Data Generation Strategy

1. Read discovered config (`contact_types`, `roles`, `forms`)
2. Generate a valid hierarchy (places at each level, people assigned to places)
3. Create users with appropriate roles
4. Generate reports that match installed form definitions
5. Upload via cht-conf or CHT API

The data must be **minimal but complete**: enough to exercise the feature under test without unnecessary volume.

#### cht-conf-test-harness

For testing CHT app configurations (tasks, targets, contact summaries, forms) **without a full CHT instance**, [`cht-conf-test-harness`](https://github.com/medic/cht-conf-test-harness) provides a lightweight alternative:

```javascript
const Harness = require('cht-conf-test-harness');
const harness = new Harness();

await harness.start();
await harness.setNow('2026-01-15');
const tasks = await harness.getTasks();
await harness.stop();
```

This is useful when the Test Generation agent produces config-level tests (task logic, target calculations) that don't require a full environment. The Test Environment Layer should detect when `cht-conf-test-harness` is sufficient and skip full environment setup.

---

## Tool Capabilities Matrix

| Tool | Environment Lifecycle | Config Discovery | Test Data Prep | Notes |
|------|----------------------|-----------------|----------------|-------|
| `npm run local-images` | Build images from local code | - | - | Foundation for testing code changes |
| `docker compose` | Start/stop/reset containers | - | - | Lifecycle management |
| CHT API (`/api/v1/*`) | Health check (`/v2/monitoring`) | Settings, forms | Create contacts, reports | Primary programmatic interface |
| `cht-conf` | - | - | Upload config, create users, seed docs | CLI tool, invoke via child_process |
| `cht-conf-test-harness` | Simulates CHT (no Docker) | - | Embedded test data | Config-level tests only (tasks, targets, forms) |
| `cht-toolbox` | - | - | Replicate docs between instances | Copy contacts/hierarchies from existing environments ([repo](https://github.com/jkuester/chtoolbox)) |
| `cht-datasource` | - | - | Read/verify data (remote adapter) | Typed API for data access (CHT 4.18.0+) |
| CouchDB API | - | - | Bulk doc operations | Direct database access for seeding/cleanup |

---

## CLI Interface

The layer should be independently callable via `npm run test-env`, following the same pattern as `npm run research <ticket>` for the Research Supervisor. This enables:
- Manual QA workflows from Claude Code containers
- Overnight refactor testing where Claude can trigger environment setup independently
- Standalone environment management without running the full cht-agent pipeline

### Usage

```bash
# Full setup: build from local code, start, discover config, seed data
npm run test-env -- --cht-core-path /path/to/cht-core

# Use a specific CHT version from Docker Hub instead of building from source
npm run test-env -- --version 4.18.0

# Teardown a running environment
npm run test-env -- --teardown

# Reset to clean state (restart containers, reseed data)
npm run test-env -- --reset
```

The primary command (`npm run test-env -- --cht-core-path ...`) runs the full bootstrap sequence: build images, start containers, wait for readiness, discover config, seed test data, and print the environment URL and credentials. This is the equivalent of `npm run research <ticket>` but for environment setup.

### LangGraph Node Interface

When called as part of the cht-agent pipeline, the layer exposes the same capabilities through a LangGraph node:

```typescript
interface TestEnvironmentState {
  chtCorePath?: string;        // path to cht-core with code changes
  version?: string;            // CHT version to use (if not building from source)
  environmentUrl?: string;     // URL of running instance (output)
  environmentAuth?: string;    // auth credentials (output)
  config?: DiscoveredConfig;   // discovered configuration (output)
  status: 'idle' | 'starting' | 'ready' | 'error' | 'teardown';
  error?: string;
}
```

---

## Industry Context

Research into how other multi-agent software development systems handle test environments reveals a clear pattern: **production systems universally separate environment setup from agent logic**.

| System | Approach |
|--------|----------|
| SWE-Agent | SWE-ReX runtime abstraction (shared service, Docker-based) |
| Devin | Pre-configured Devbox sandbox (infrastructure layer) |
| OpenHands | Workspace SDK package (modular, pluggable backends) |
| Amazon Q | Devfile declarations (configuration-as-code) |
| MetaGPT, ChatDev | Implicit (not modeled, assumed to exist) |

The common pattern is that environment management is a **service** that testing agents consume, not a step that a testing agent performs itself. Our design follows the same principle: the Test Environment Layer provides the service, the Test Orchestration Layer consumes it.

---

## Integration with QA Supervisor Workflow

```
┌─────────────────────────────────────────────────────────┐
│                     QA Supervisor                        │
│                                                         │
│  1. Test Environment Layer                              │
│     ├── Build images (npm run local-images)             │
│     ├── Start containers (docker compose up)            │
│     ├── Wait for readiness (/api/v2/monitoring)         │
│     ├── Discover config (/api/v1/settings, /forms)      │
│     ├── Seed test data (cht-conf, CHT API)              │
│     └── Signal ready → environment handle               │
│                          │                              │
│  2. Test Orchestration Layer                            │
│     ├── Run unit tests (npm test)                       │
│     ├── Run integration tests (against live CHT)        │
│     ├── Run e2e tests (WebdriverIO)                     │
│     ├── Manual QA verification                          │
│     └── Coverage analysis (nyc)                         │
│                          │                              │
│  3. Signal complete → reset or teardown                 │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## Open Questions

1. **Docker-in-Docker:** If cht-agent runs inside a container (e.g., Claude Code container), can it reliably run `docker compose`? May need Docker socket mounting or sibling container patterns.

2. **Resource constraints:** `npm run local-images` builds multiple Docker images. Minimum specs per CHT docs: 8GB RAM, 50GB disk, 4 cores. How do we handle environments where this isn't available?

3. **Caching strategy:** Building images from source is slow. Can we cache built images per git SHA and skip rebuilds when the code hasn't changed?

4. **Parallel environments:** Can we run multiple CHT instances (different ports) for parallel test runs? This matters for the Master Supervisor if it processes multiple tickets concurrently.

5. **cht-conf-test-harness scope:** When should the layer use the lightweight harness instead of a full Docker environment? Need heuristics based on what the Test Generation agent produced (config tests vs integration tests vs e2e tests).
