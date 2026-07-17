---
id: cht-core-9065
category: feature
domain: contacts
domainFit: strong
issueNumber: 9065
issueUrl: https://github.com/medic/cht-core/issues/9065
title: Introduce cht-datasource shared data-access library (converted from cht-script-api) with get-person-by-UUID over local/remote data contexts
lastUpdated: '2026-07-16'
summary: CHT had no unified, context-aware data-access layer for fetching domain entities consistently across server, client, and custom config code. This PR converts cht-script-api into a new cht-datasource TypeScript library exposing person.getByUuid through both imperative and declarative APIs over local (offline) and remote (online) data contexts.
services:
  - api
  - sentinel
  - admin
techStack:
  - typescript
  - javascript
  - couchdb
  - pouchdb
  - mocha
tags:
  - cht-datasource
  - data-access-layer
  - person
  - get-by-uuid
  - data-context
  - offline-first
  - typescript
  - shared-library
  - refactor
related_workflows: []
source_pr: medic/cht-core#9090
source_prs:
  - "medic/cht-core#9090"
  - "medic/cht-core#9176"
  - "medic/cht-core#9205"
source_sha: 59b42e2fa3271a69c713b4720b9ee9fb7ea3dc61
distilled_at: '2026-06-23'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - shared-libs/cht-datasource/src/person.ts
  - shared-libs/cht-datasource/src/qualifier.ts
  - shared-libs/cht-datasource/src/libs/data-context.ts
  - shared-libs/cht-datasource/src/local/person.ts
  - shared-libs/cht-datasource/src/remote/person.ts
  - shared-libs/cht-datasource/src/index.ts
  - api/src/controllers/person.js
  - api/src/services/data-context.js
concepts:
  - data-access layer
  - data context (local vs remote)
  - imperative vs declarative API surface
  - function currying / dependency injection of context
  - offline-first data access
  - factory pattern (hierarchical datasource)
  - qualifier pattern
  - versioned API namespace (v1)
  - monorepo shared library
related_issues: []
stale: false
---

## Problem

There was no unified, reusable data-access abstraction in cht-core. Code that needed to fetch domain entities (e.g. a person by UUID) did so ad-hoc and differently depending on whether it ran online (server/API) or offline (client), and the existing shared-libs/cht-script-api was narrowly scoped to the rules engine. There was no consistent, type-safe way to expose data access to server code, client code, and custom configuration code (tasks/targets). Beyond a bare by-UUID lookup, there was also no way to fetch a person together with their full parent-contact lineage in one call — callers had to fetch the person and then resolve each ancestor separately (PR #9176).

## Root Cause

shared-libs/cht-script-api was purpose-built for the rules engine and did not provide a general, context-aware (local vs remote) data-access layer, so each consumer reimplemented its own fetching logic and there was no shared contract for retrieving entities like a person.

## Solution

Converted shared-libs/cht-script-api into a new shared-libs/cht-datasource TypeScript library. Added a DataContext abstraction with getLocalDataContext (offline) and getRemoteDataContext (online), and exposed two usage modes: an imperative hierarchical factory (getDatasource(ctx).v1.person.getByUuid(uuid)) intended to be handed to custom config code, and a declarative curried API (Person.V1.get(ctx)(Qualifier.byUuid(uuid))). Implemented the first entity, Person, with separate local and remote getByUuid implementations behind a shared interface, a Qualifier helper (byUuid), and wired the API person controller/route and data-context service. Updated consumers (api server-utils/data-context, sentinel purging, admin auth) to the renamed library. A follow-up added a getWithLineage operation to the person module — backed by both local (CouchDB-direct) and remote (HTTP) bindings, with shared lineage-resolution logic factored into local/libs/lineage.ts and contact helpers in libs/contact.ts — and exposed it through a new person REST API endpoint that returns the person hydrated with its parent hierarchy (PR #9176).

## Code Patterns

Acquire a DataContext once, then inject it into data functions. Declarative currying: `const getPerson = Person.V1.get(dataContext); await getPerson(Qualifier.byUuid(uuid))` (shared-libs/cht-datasource/src/person.ts). Imperative factory drill-down: `getDatasource(ctx).v1.person.getByUuid(uuid)`. Qualifier builder objects: `Qualifier.byUuid(uuid)` (shared-libs/cht-datasource/src/qualifier.ts). Local/remote strategy split behind a common interface (src/local/person.ts vs src/remote/person.ts). Versioned namespace (v1/V1) for forward-compatible API evolution. Datasource feature template (PR #9176): declare the public operation in src/person.ts, implement parallel local (src/local/person.ts) and remote (src/remote/person.ts) bindings against a shared data-context, and reuse cross-cutting helpers (src/local/libs/lineage.ts, src/libs/contact.ts, src/libs/doc.ts); the api/src/controllers/person.js controller delegates to the datasource rather than embedding query logic.

## Design Choices

Provided both imperative and declarative APIs to serve different consumers — the imperative factory is convenient to pass into custom config functions (tasks/targets), while the declarative curried form is more composable for internal use. Split local vs remote data contexts so the same call sites work offline (client) and online (server) without branching logic. The local and remote functions implement the same interface; the lack of partial type-argument inference (microsoft/TypeScript#420) is a noted limitation. Versioned namespace (v1) chosen for forward compatibility; written in TypeScript for type safety in the new shared library.

## Related Files

- shared-libs/cht-datasource/src/index.ts
- shared-libs/cht-datasource/src/person.ts
- shared-libs/cht-datasource/src/qualifier.ts
- shared-libs/cht-datasource/src/libs/data-context.ts
- shared-libs/cht-datasource/src/libs/doc.ts
- shared-libs/cht-datasource/src/libs/contact.ts
- shared-libs/cht-datasource/src/libs/core.ts
- shared-libs/cht-datasource/src/local/person.ts
- shared-libs/cht-datasource/src/remote/person.ts
- shared-libs/cht-datasource/src/local/libs/lineage.ts (PR #9176)
- shared-libs/cht-datasource/src/place.ts (PR #9176)
- shared-libs/cht-datasource/src/remote/libs/data-context.ts (PR #9176)
- shared-libs/cht-datasource/README.md
- api/src/controllers/person.js
- api/src/routing.js
- api/src/services/data-context.js
- api/src/server-utils.js
- sentinel/src/lib/purging.js
- admin/src/js/services/auth.js

## Testing

Comprehensive unit tests added across the new library (test/person.spec.ts, test/qualifier.spec.ts, test/index.spec.ts, test/local/person.spec.ts, test/local/libs/{data-context,doc}.spec.ts, test/libs/{core,data-context,doc}.spec.ts) with a dedicated .mocharc.js, plus added/updated API tests (controllers/person.spec.js, services/data-context.spec.js, server-utils.spec.js) and sentinel purging.spec.js. The lineage follow-up added specs for the new bindings and helpers (test/local/libs/lineage.spec.ts, test/libs/contact.spec.ts, test/remote/person.spec.ts, test/remote/libs/data-context.spec.ts), api controller mocha tests, and end-to-end integration tests against the REST endpoint (tests/integration/api/controllers/person.spec.js) (PR #9176).

## Related Issues

- #9065: Add a data-access layer (cht-datasource) to get a contact/person by id
- get-person-with-lineage capability and REST endpoint delivered as a follow-up (PR #9176), with API documentation tracked in cht-docs#1422.
- Follow-up hardening in PR #9205 (on a separate branch) gates the person REST endpoint for offline users.

## Domain Rationale

**Fit:** strong

The concrete capability delivered is retrieving a person (a contact) by UUID, and the only entity modeled (Person, via local/remote implementations and an API person controller) is a contact — person/contact lookup is squarely the contacts domain. The PR also lays down a general data-access layer (cht-datasource), but its first and only vertical slice is contact retrieval, so contacts is the most specific functional fit rather than the data-sync data-layer bucket.
