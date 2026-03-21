# Agent Memory

This directory contains the context database for CHT agents. It provides structured knowledge that agents use to understand the CHT codebase, workflows, and patterns.

## Directory Structure

```
agent-memory/
├── domains/                    # 7 functional domain contexts
├── workflows/                  # Cross-domain process contexts
├── infrastructure/             # Cross-cutting concerns
├── services/                   # Service-specific deep dives
├── knowledge-base/             # Accumulated learnings
├── indices/                    # Fast lookup tables
└── agent-workspaces/           # Agent-specific runtime data (gitignored)
```

### Domains (7 Functional Areas)

| Domain | Description |
|--------|-------------|
| `authentication/` | User authentication, permissions, roles, session management |
| `contacts/` | Contact management - people, places, hierarchies, muting |
| `forms-and-reports/` | Form definitions, Enketo rendering, report submission |
| `tasks-and-targets/` | Task generation, rules engine, target calculations |
| `messaging/` | SMS messaging, notifications, outbound messages |
| `data-sync/` | CouchDB replication, offline sync, purging |
| `configuration/` | App settings, translations, branding, deployment config |

### Workflows (Cross-Domain Processes)

| Workflow | Description |
|----------|-------------|
| `form-submission/` | End-to-end form submission pipeline |
| `user-registration/` | User creation and setup flow |
| `contact-creation/` | Contact hierarchy creation |
| `task-scheduling/` | Task generation and scheduling |
| `message-processing/` | SMS/message handling pipeline |
| `data-migration/` | Data migration procedures |

### Infrastructure

| Directory | Description |
|-----------|-------------|
| `cht-datasource/` | CHT datasource patterns and usage |
| `shared-utilities/` | Shared library documentation |
| `database/` | CouchDB architecture and design docs |
| `testing/` | Test patterns and utilities |

### Services

| Service | Description |
|---------|-------------|
| `api/` | API service architecture, controllers, middleware |
| `webapp/` | Webapp modules, services, components |
| `sentinel/` | Sentinel transitions and scheduling |
| `admin/` | Admin app structure |

### Knowledge Base

| Directory | Description |
|-----------|-------------|
| `resolved-issues/` | Past issues organized by domain, workflow, component |
| `patterns/` | Successful solutions, anti-patterns, refactoring recipes |
| `edge-cases/` | Tricky scenarios, gotchas, workarounds |

### Indices

Lookup tables for fast navigation between different views of the codebase.

| Index | Purpose |
|-------|---------|
| `domain-to-components.json` | Domain -> files mapping |
| `workflow-to-services.json` | Workflow -> service pipeline |
| `component-to-domains.json` | File -> domains mapping |
| `tech-stack-map.json` | Technology -> usage locations |
| `dependency-graph.json` | Component dependencies |
| `error-patterns.json` | Error -> location & solution |
| `test-coverage-map.json` | Component -> test files |

## Contributing Context

### File Formats

- **Markdown (.md)**: Human-readable documentation, conceptual overviews
- **JSON (.json)**: Structured data, file lists, lookup tables

### Adding Domain Context

1. Navigate to the appropriate domain directory
2. Copy `TEMPLATE.md` to create a new context file
3. Fill in the required fields (see `schema.json` for validation)
4. Submit a PR for review

### Context File Requirements

Each context file should include:

- **Required**: `domain`, `summary`, `last_updated`
- **Recommended**: `code_patterns`, `related_components`, `common_issues`
- **Optional**: `performance_notes`, `migration_notes`, `tags`

See `TEMPLATE.md` for a full example.

## Agent Usage

Agents load context in layers:

1. **Core layer**: Domain overview + workflow context
2. **Infrastructure layer**: Relevant shared-libs and cross-cutting concerns
3. **Service layer**: Specific service implementations (only if needed)
4. **Knowledge layer**: Accumulated learnings and patterns

## Maintenance

- Context should be updated when significant codebase changes occur
- Indices can be auto-generated from static analysis
- Error patterns are enriched by agents over time
