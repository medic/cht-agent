---
id: cht-core-9065
category: feature
domain: contacts
domainFit: strong
issueNumber: 9065
issueUrl: https://github.com/medic/cht-core/issues/9065
title: Introduce cht-datasource shared data-access library (converted from cht-script-api) with get-person-by-UUID over local/remote data contexts
lastUpdated: '2026-06-23'
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

There was no unified, reusable data-access abstraction in cht-core. Code that needed to fetch domain entities (e.g. a person by UUID) did so ad-hoc and differently depending on whether it ran online (server/API) or offline (client), and the existing shared-libs/cht-script-api was narrowly scoped to the rules engine. There was no consistent, type-safe way to expose data access to server code, client code, and custom configuration code (tasks/targets).

## Root Cause

shared-libs/cht-script-api was purpose-built for the rules engine and did not provide a general, context-aware (local vs remote) data-access layer, so each consumer reimplemented its own fetching logic and there was no shared contract for retrieving entities like a person.

## Solution

Converted shared-libs/cht-script-api into a new shared-libs/cht-datasource TypeScript library. Added a DataContext abstraction with getLocalDataContext (offline) and getRemoteDataContext (online), and exposed two usage modes: an imperative hierarchical factory (getDatasource(ctx).v1.person.getByUuid(uuid)) intended to be handed to custom config code, and a declarative curried API (Person.V1.get(ctx)(Qualifier.byUuid(uuid))). Implemented the first entity, Person, with separate local and remote getByUuid implementations behind a shared interface, a Qualifier helper (byUuid), and wired the API person controller/route and data-context service. Updated consumers (api server-utils/data-context, sentinel purging, admin auth) to the renamed library.

## Code Patterns

Acquire a DataContext once, then inject it into data functions. Declarative currying: `const getPerson = Person.V1.get(dataContext); await getPerson(Qualifier.byUuid(uuid))` (shared-libs/cht-datasource/src/person.ts). Imperative factory drill-down: `getDatasource(ctx).v1.person.getByUuid(uuid)`. Qualifier builder objects: `Qualifier.byUuid(uuid)` (shared-libs/cht-datasource/src/qualifier.ts). Local/remote strategy split behind a common interface (src/local/person.ts vs src/remote/person.ts). Versioned namespace (v1/V1) for forward-compatible API evolution.

## Design Choices

Provided both imperative and declarative APIs to serve different consumers — the imperative factory is convenient to pass into custom config functions (tasks/targets), while the declarative curried form is more composable for internal use. Split local vs remote data contexts so the same call sites work offline (client) and online (server) without branching logic. Reviewers (m5r, echoing Gareth) requested the local and remote functions implement the same interface and noted the lack of partial type-argument inference (microsoft/TypeScript#420) as a limitation. Versioned namespace (v1) chosen for forward compatibility; written in TypeScript for type safety in the new shared library.

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
- shared-libs/cht-datasource/README.md
- api/src/controllers/person.js
- api/src/routing.js
- api/src/services/data-context.js
- api/src/server-utils.js
- sentinel/src/lib/purging.js
- admin/src/js/services/auth.js

## Testing

Comprehensive unit tests added across the new library (test/person.spec.ts, test/qualifier.spec.ts, test/index.spec.ts, test/local/person.spec.ts, test/local/libs/{data-context,doc}.spec.ts, test/libs/{core,data-context,doc}.spec.ts) with a dedicated .mocharc.js, plus added/updated API tests (controllers/person.spec.js, services/data-context.spec.js, server-utils.spec.js) and sentinel purging.spec.js. Reviewer lorerod approved from a testing perspective.

## Related Issues

- #9065: Add a data-access layer (cht-datasource) to get a contact/person by id

## Domain Rationale

**Fit:** strong

The concrete capability delivered is retrieving a person (a contact) by UUID, and the only entity modeled (Person, via local/remote implementations and an API person controller) is a contact — person/contact lookup is squarely the contacts domain. The PR also lays down a general data-access layer (cht-datasource), but its first and only vertical slice is contact retrieval, so contacts is the most specific functional fit rather than the data-sync data-layer bucket.
