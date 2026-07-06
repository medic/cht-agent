# [Design]: Directory Structure or Database for Context Files (and Shared-Context)

This ticket should list our choices and decisions around storing context.

### Current proposal

- Directory structure inside this repository that is similar to cht-core. Example outlined [here](https://github.com/Hareet/cht-agent/blob/main/design/CHT%20Hierarchical%20Multi-Agent%20System%20PoC.md#shared-context-structure)
  - Pros:
    - Simple file-based Context that has easy access and readability for human validation (in-the-loop)
  - Cons:
    - Difficulty mapping harder workflows (purging, sms) 


--- 

**Comment by @sugat009 at 2025-11-05T16:28:01Z:**

I read some possible directory structures for the context files and I think this one seems to be comprehensive for us.

## Key Design Principles

1. **Domain-First Organization**: Agents navigate by functional domain (contacts, forms, tasks) rather than technical structure
2. **Workflow Contexts**: Pre-built end-to-end flow documentation for multi-step processes
3. **Infrastructure as Shared Resources**: Critical shared components (cht-datasource, shared-libs) documented centrally
4. **Agent-Specific Workspaces**: Each agent accumulates specialized knowledge
5. **Rich Indices**: Fast navigation using lookup tables

---

## Directory Structure

```
agent-memory/
├── domains/                          # Functional domain contexts
│   ├── authentication/
│   │   ├── overview.md              # Domain summary, key concepts
│   │   ├── data-flow.md            # Auth flow diagrams
│   │   ├── components.json          # api/auth, webapp/services, shared-libs
│   │   ├── common-patterns.md       # SSO, cookie auth, permissions
│   │   └── test-scenarios.md
│   │
│   ├── contacts/                    # People, places, hierarchies
│   │   ├── overview.md
│   │   ├── lineage-system.md       # Critical for this domain
│   │   ├── components.json          # api/controllers/contact, webapp/modules/contacts
│   │   ├── hierarchy-rules.md
│   │   └── common-tasks.md
│   │
│   ├── forms-and-reports/
│   │   ├── overview.md
│   │   ├── submission-pipeline.md   # End-to-end workflow
│   │   ├── enketo-integration.md
│   │   ├── validation-rules.md
│   │   ├── components.json
│   │   └── common-transitions.md
│   │
│   ├── tasks-and-targets/
│   │   ├── overview.md
│   │   ├── rules-engine.md          # Core concept
│   │   ├── calculation-flow.md
│   │   ├── components.json
│   │   └── configuration-examples.md
│   │
│   ├── messaging/
│   │   ├── overview.md
│   │   ├── scheduling-system.md
│   │   ├── outbound-integrations.md
│   │   ├── components.json
│   │   └── common-patterns.md
│   │
│   ├── data-sync/
│   │   ├── overview.md
│   │   ├── offline-first-architecture.md
│   │   ├── replication-strategies.md
│   │   ├── conflict-resolution.md
│   │   ├── purging-system.md
│   │   └── components.json
│   │
│   └── configuration/
│       ├── overview.md
│       ├── app-settings.md
│       ├── config-watcher.md
│       └── components.json
│
├── workflows/                        # Cross-domain processes
│   ├── form-submission/
│   │   ├── flow.md                  # Complete pipeline
│   │   ├── involved-components.json
│   │   ├── test-checklist.md
│   │   └── common-issues.md
│   │
│   ├── user-registration/
│   │   └── [similar structure]
│   │
│   ├── contact-creation/
│   │   └── [similar structure]
│   │
│   ├── task-scheduling/
│   │   └── [similar structure]
│   │
│   ├── message-processing/
│   │   └── [similar structure]
│   │
│   └── data-migration/
│       └── [similar structure]
│
├── infrastructure/                   # Cross-cutting concerns
│   ├── cht-datasource/              # THE most used/complex shared component?
│   │   ├── overview.md
│   │   ├── adapters.md              # local vs remote
│   │   ├── api-reference.md
│   │   └── migration-guide.md
│   │
│   ├── shared-utilities/
│   │   ├── validation.md
│   │   ├── lineage.md
│   │   ├── message-utils.md
│   │   ├── authorization.md
│   │   └── [other shared-libs]
│   │
│   ├── database/
│   │   ├── couchdb-architecture.md
│   │   ├── design-docs.md
│   │   ├── views-guide.md
│   │   └── data-model.md
│   │
│   └── testing/
│       ├── unit-test-patterns.md
│       ├── integration-test-setup.md
│       ├── e2e-test-guide.md
│       └── test-utilities.md
│
├── services/                         # Service-specific deep dives
│   ├── api/
│   │   ├── architecture.md
│   │   ├── controllers/
│   │   │   ├── overview.md
│   │   │   └── [per-controller docs]
│   │   ├── services/
│   │   │   ├── overview.md
│   │   │   └── [per-service docs]
│   │   ├── middleware/
│   │   │   └── overview.md
│   │   └── routes-map.json
│   │
│   ├── webapp/
│   │   ├── architecture.md
│   │   ├── modules/
│   │   │   ├── overview.md
│   │   │   └── [per-module docs]
│   │   ├── services/
│   │   │   ├── overview.md
│   │   │   └── [per-service docs]
│   │   ├── ngrx-state.md
│   │   └── component-tree.json
│   │
│   ├── sentinel/
│   │   ├── architecture.md
│   │   ├── transitions/
│   │   │   ├── overview.md
│   │   │   └── [per-transition docs]
│   │   ├── scheduling.md
│   │   └── change-processing.md
│   │
│   └── admin/
│       ├── architecture.md
│       └── [similar structure]
│
├── agent-workspaces/                 # Agent-specific learning
│   ├── research-agent/
│   │   ├── documentation-index.json
│   │   ├── search-patterns.md
│   │   ├── common-questions.md
│   │   └── solution-library/
│   │       ├── by-domain/
│   │       ├── by-error-type/
│   │       └── by-component/
│   │
│   ├── code-generation-agent/
│   │   ├── code-templates/
│   │   │   ├── api-controller.template
│   │   │   ├── webapp-component.template
│   │   │   ├── sentinel-transition.template
│   │   │   └── shared-lib.template
│   │   ├── naming-conventions.md
│   │   ├── coding-standards.md
│   │   └── common-imports.json
│   │
│   ├── test-environment-agent/
│   │   ├── docker-compose-recipes/
│   │   ├── cht-conf-commands.md
│   │   ├── test-data-generation/
│   │   │   ├── contact-templates/
│   │   │   ├── form-templates/
│   │   │   └── relationship-templates/
│   │   └── k3d-setup-patterns.md
│   │
│   ├── code-validation-agent/
│   │   ├── eslint-rules.json
│   │   ├── common-lint-fixes.md
│   │   ├── style-guide.md
│   │   └── anti-patterns.md
│   │
│   └── test-orchestration-agent/
│       ├── test-suites-map.json     # Which tests cover what
│       ├── flaky-tests-tracker.json
│       ├── coverage-history.json
│       └── test-selection-rules.md
│
├── knowledge-base/                   # Accumulated learnings
│   ├── resolved-issues/
│   │   ├── by-domain/
│   │   │   ├── contacts/
│   │   │   ├── forms/
│   │   │   ├── tasks/
│   │   │   └── [etc]
│   │   ├── by-workflow/
│   │   │   ├── form-submission/
│   │   │   ├── contact-creation/
│   │   │   └── [etc]
│   │   └── by-component/
│   │       ├── api/
│   │       ├── webapp/
│   │       ├── sentinel/
│   │       └── [etc]
│   │
│   ├── patterns/
│   │   ├── successful-solutions/
│   │   │   ├── performance-optimizations/
│   │   │   ├── offline-handling/
│   │   │   └── data-validation/
│   │   ├── anti-patterns/
│   │   │   ├── common-mistakes.md
│   │   │   └── gotchas.md
│   │   └── refactoring-recipes/
│   │       ├── angular-upgrades/
│   │       └── api-modernization/
│   │
│   └── edge-cases/
│       ├── tricky-scenarios.md
│       ├── gotchas.md
│       └── workarounds.md
│
└── indices/                          # Fast lookup tables
    ├── domain-to-components.json     # Domain → files mapping
    ├── workflow-to-services.json     # Workflow → service pipeline
    ├── component-to-domains.json     # File → domains mapping
    ├── tech-stack-map.json           # Technology → usage locations
    ├── dependency-graph.json         # Component dependencies & impact
    ├── error-patterns.json           # Error → location & solution
    └── test-coverage-map.json        # Component → test files
```

---

## Indices Folder Specification

The `indices/` folder contains **lookup tables** that enable fast navigation between different organizational views of the codebase. These are the "routing tables" for agents. This is where all the dots are connected.

### `domain-to-components.json`

Maps functional domains to all files/components involved across all services.

**Purpose**: When an agent works on a domain (e.g., "contacts"), it can quickly load all relevant code across api, webapp, sentinel, shared-libs, ddocs, and tests.

**Sample Structure**:
```json
{
  "contacts": {
    "api": ["api/src/controllers/contact.js", "api/src/controllers/person.js", ...],
    "webapp": ["webapp/src/ts/modules/contacts/*.ts", ...],
    "sentinel": ["sentinel/src/transitions/registration.js"],
    "shared-libs": ["shared-libs/contacts", "shared-libs/lineage", ...],
    "ddocs": ["ddocs/medic-db/medic-client/views/contacts_by_type", ...],
    "tests": ["tests/integration/api/controllers/contact.spec.js", ...]
  },
  "forms-and-reports": { ... },
  "authentication": { ... }
}
```

---

### `workflow-to-services.json`

Maps end-to-end workflows to the services and order they're involved in.

**Purpose**: Agent working on a workflow (e.g., "form submission") understands the complete pipeline across services.

**Sample Structure**:
```json
{
  "form-submission": {
    "flow": [
      {
        "step": 1,
        "service": "webapp",
        "component": "enketo.service.ts",
        "action": "Render form and collect data"
      },
      {
        "step": 2,
        "service": "api",
        "component": "controllers/records.js",
        "action": "Validate and save to CouchDB"
      },
      {
        "step": 3,
        "service": "sentinel",
        "component": "transitions/*",
        "action": "Apply validation, registration, alerts"
      }
    ],
    "data_flow": "FormData → HTTP → CouchDB doc → Changes feed → Processed doc",
    "key_files": [...],
    "test_coverage": [...]
  },
  "user-authentication": { ... },
  "contact-creation": { ... }
}
```

---

### `component-to-domains.json`

**Reverse lookup**: Given a file/component, which domains care about it?

**Purpose**:
- Impact analysis: "Someone modified `shared-libs/lineage`, which domains are affected?"
- Context loading: "I'm debugging `cht-datasource`, what domain contexts should I load?"

**Sample Structure**:
```json
{
  "shared-libs/lineage": ["contacts", "forms-and-reports", "data-sync"],
  "shared-libs/cht-datasource": ["contacts", "forms-and-reports", "tasks-and-targets", "messaging", "data-sync", "authentication"],
  "shared-libs/rules-engine": ["tasks-and-targets", "forms-and-reports"],
  "api/src/auth.js": ["authentication"],
  "webapp/src/ts/services/enketo.service.ts": ["forms-and-reports"]
}
```

---

### `tech-stack-map.json`

Maps technologies/frameworks to where they're used in the codebase.

**Purpose**: Agent knows which patterns/APIs to use based on technology in a given location.

**Sample Structure**:
```json
{
  "angular": {
    "version": "19.x",
    "locations": ["webapp/src/ts/**/*.ts"],
    "key_patterns": ["components", "services", "modules", "ngrx-store"]
  },
  "express": {
    "version": "5.x",
    "locations": ["api/src/**/*.js"],
    "patterns": ["controllers", "middleware", "routes"]
  },
  "pouchdb": {
    "version": "9.x",
    "locations": ["api/src/**/*.js", "sentinel/src/**/*.js", "webapp/src/ts/services/db*.ts", "shared-libs/cht-datasource"],
    "critical": true
  },
  "enketo-core": {
    "version": "7.x",
    "locations": ["webapp/src/ts/services/enketo.service.ts"],
    "purpose": "XForm rendering"
  }
}
```

---

### `dependency-graph.json`

Shows what depends on what (impact analysis and blast radius).

**Purpose**:
- Agent modifying critical component knows downstream impact
- Test orchestration agent knows which tests to run based on changes

**Sample Structure**:
```json
{
  "shared-libs/cht-datasource": {
    "dependents": ["api/src/**/*.js", "sentinel/src/**/*.js", "webapp/src/ts/services/db*.ts", "admin/src/js/**/*.js"],
    "impact_level": "CRITICAL",
    "test_requirements": ["Full integration test suite", "All service unit tests"]
  },
  "shared-libs/lineage": {
    "dependents": ["api/src/controllers/person.js", "api/src/controllers/place.js", "webapp/src/ts/services/lineage*.ts"],
    "impact_level": "HIGH"
  },
  "api/src/auth.js": {
    "dependents": ["api/src/middleware/authorization.js", "api/src/controllers/login.js"],
    "dependencies": ["shared-libs/user-management"],
    "impact_level": "HIGH"
  }
}
```

---

### `error-patterns.json`

Common errors and where they occur, with typical causes and solutions.

**Purpose**:
- QA agent learns error patterns over time
- Research agent finds similar past issues quickly
- Enables pattern-based debugging

**Sample Structure**:
```json
{
  "ETIMEDOUT": {
    "common_locations": ["api/src/services/replication.js", "webapp/src/ts/services/db-sync.service.ts"],
    "related_domains": ["data-sync"],
    "typical_causes": ["CouchDB unavailable", "Network issues", "Large document sync"],
    "test_scenarios": ["tests/integration/api/services/replication.spec.js"]
  },
  "Invalid lineage": {
    "common_locations": ["api/src/controllers/person.js:145", "api/src/controllers/place.js:203"],
    "related_domains": ["contacts"],
    "typical_causes": ["Parent not found", "Circular reference", "Permission denied"],
    "shared_libs": ["shared-libs/lineage"]
  },
  "Form validation failed": {
    "common_locations": ["sentinel/src/transitions/accept_patient_reports.js", "api/src/controllers/records.js"],
    "related_domains": ["forms-and-reports"],
    "typical_causes": ["Missing required field", "Invalid data type", "Business rule violation"],
    "shared_libs": ["shared-libs/validation"]
  }
}
```

---

### `test-coverage-map.json`

Maps source components to their test files and coverage metrics.

**Purpose**: Test Orchestration Agent knows exactly which tests to run for a given change.

**Sample Structure**:
```json
{
  "api/src/controllers/person.js": {
    "unit_tests": ["api/tests/unit/controllers/person.spec.js"],
    "integration_tests": ["tests/integration/api/controllers/person.spec.js"],
    "e2e_tests": ["tests/e2e/default/contacts/add-person.wdio-spec.js"],
    "coverage": {
      "lines": 87.3,
      "branches": 78.1,
      "functions": 92.5
    }
  },
  "webapp/src/ts/services/enketo.service.ts": {
    "unit_tests": ["webapp/tests/karma/ts/services/enketo.service.spec.ts"],
    "e2e_tests": ["tests/e2e/default/submit/*.wdio-spec.js"],
    "coverage": {
      "lines": 91.2,
      "branches": 85.7,
      "functions": 100
    }
  }
}
```

---

## How Indices Work Together

**Example Scenario: "Fix bug in contact creation"**

1. Load `domain-to-components.json["contacts"]` → get all relevant files
2. Load `workflow-to-services.json["contact-creation"]` → understand flow
3. Load `component-to-domains.json["shared-libs/lineage"]` → see this affects contacts + forms domains
4. Load `dependency-graph.json` → understand impact of any changes
5. Load `test-coverage-map.json` → know which tests to run
6. Check `error-patterns.json` → see if this is a known issue pattern

**The agent now has**:
- Complete context (all files involved)
- End-to-end understanding (workflow)
- Impact awareness (dependencies)
- Test strategy (coverage map)
- Historical knowledge (error patterns)

---

## Index Generation Strategy

These indices should be:

1. **Auto-generated** from static analysis of the codebase (initial population)
2. **Enriched by agents** as they work (e.g., error-patterns learned over time)
3. **Versioned** with the context system
4. **Cached** for fast lookup (JSON files are fast to parse)
5. **Regenerated** periodically or on significant codebase changes


---

## Agent Usage Patterns

### Research Agent
- Loads domain contexts for high-level understanding
- Uses workflow contexts to understand end-to-end flows
- References error-patterns for known issues
- Builds solution library in agent-workspaces/research-agent/

### Code Generation Agent
- Loads domain + workflow contexts
- Uses tech-stack-map to know which patterns to apply
- References code templates in agent-workspaces/code-generation-agent/
- Checks dependency-graph for impact

### Test Environment Agent
- Uses test-coverage-map to find relevant tests
- Loads agent-workspaces/test-environment-agent/ for recipes
- References domain contexts for test scenarios

### QA Supervisor
- Uses test-coverage-map extensively
- Monitors flaky-tests-tracker
- Enriches error-patterns over time
- Validates against coding standards

### Test Orchestration Agent
- Primary user of test-coverage-map
- Uses dependency-graph for intelligent test selection
- Tracks coverage-history
- Detects flaky tests

---

## Implementation Notes

### Context File Formats

**Markdown files (.md)**: Human-readable documentation, conceptual overviews, flow diagrams
**JSON files (.json)**: Structured data, file lists, configuration, lookup tables
**Template files (.template)**: Code generation templates for common patterns

### Context Loading Strategy

Agents should load contexts in layers:
1. **Core layer**: Domain overview + workflow
2. **Infrastructure layer**: Relevant shared-libs and cross-cutting concerns
3. **Service layer**: Specific service implementations (only if needed)
4. **Agent layer**: Agent-specific accumulated knowledge

### Context Updates

- **Manual curation**: Initial domain overviews, workflow documentation
- **Automated generation**: Indices, file lists, dependency graphs
- **Agent learning**: Error patterns, successful solutions, flaky tests
- **Periodic refresh**: Re-generate indices on major codebase changes



# [Design]: Directory Structure or Database for Context Files (and Shared-Context)

This ticket should list our choices and decisions around storing context.

### Current proposal

- Directory structure inside this repository that is similar to cht-core. Example outlined [here](https://github.com/Hareet/cht-agent/blob/main/design/CHT%20Hierarchical%20Multi-Agent%20System%20PoC.md#shared-context-structure)
  - Pros:
    - Simple file-based Context that has easy access and readability for human validation (in-the-loop)
  - Cons:
    - Difficulty mapping harder workflows (purging, sms) 


--- 

**Comment by @Hareet at 2025-11-13T19:22:53Z:**

@sugat009 Great input!

<img width="732" height="322" alt="Image" src="https://github.com/user-attachments/assets/895be965-7a8c-4042-8e57-a060c73c9666" />

I like the Domain-based approach for MVP and moving the scope beyond just a simple demo. Mainly the "Agent Intelligence" and "Problem Solving" will be worth the trade-off of simplicity.

### Scale of Context 

- ~10 main CHT domains
- Thousands of context files
- Read-heavy, agents repeatedly accessing learned patterns

### Modifications

Move the indices to SQLite, and use that for Checkpointers (LangGraph states)
   - Better query than JSON indices

### Other Alternatives

- Chroma for Embedded Vector Search (adds semantic search)
- MongoDB 
- Vector DB's are overly complex for our use case (Pinecone, etc)

### Storage Architecture:
```
├── SQLite (250MB max)
│   ├── LangGraph checkpoints (built-in support)
│   ├── Domain indices (your JSON files as tables)
│   └── Agent learning patterns
│
├── Local File System
│   ├── Your domain structure AS IS
│   ├── Human checkpoint files
│   └── Agent workspace accumulation

