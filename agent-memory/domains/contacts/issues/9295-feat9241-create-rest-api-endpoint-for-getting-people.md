---
id: cht-core-9241
category: feature
domain: contacts
domainFit: strong
issueNumber: 9241
issueUrl: https://github.com/medic/cht-core/issues/9241
title: Add REST API endpoint for getting people via cht-datasource
lastUpdated: '2026-08-11'
summary: CHT had no REST API endpoint for retrieving people in bulk by contact type. Building on the person module and `/api/v1/person/:uuid` route added by #9090, this adds the paged `GET /api/v1/person` endpoint and the shared `InvalidArgumentError` type used across the cht-datasource person and qualifier code.
services:
  - api
techStack:
  - typescript
  - javascript
  - nodejs
  - express
  - couchdb
  - mocha
tags:
  - rest-api
  - cht-datasource
  - person
  - api-endpoint
  - data-access
related_workflows: []
source_pr: medic/cht-core#9295
source_prs:
  - "medic/cht-core#9295"
  - "medic/cht-core#9311"
source_sha: 20ee6e5c627b19c1c9a03f25142bc698f85062bf
distilled_at: '2026-06-23'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - api/src/controllers/person.js
  - api/src/routing.js
  - api/src/server-utils.js
  - shared-libs/cht-datasource/src/index.ts
  - shared-libs/cht-datasource/src/person.ts
  - shared-libs/cht-datasource/src/local/person.ts
  - shared-libs/cht-datasource/src/remote/person.ts
  - shared-libs/cht-datasource/src/qualifier.ts
concepts:
  - REST API design
  - cht-datasource abstraction layer
  - local vs remote data access pattern
  - qualifier-based data fetching
  - person/contact data model
related_issues:
  - cht-core-9193
  - cht-core-9237
  - cht-core-9238
stale: false
---

## Problem

CHT lacked a standardized REST API endpoint for retrieving people in bulk by contact type — clients had no way to page through people of a given type. Single-person lookup by UUID (`/api/v1/person/:uuid`) and the underlying cht-datasource person module already existed, added by PR #9090.

## Root Cause

Missing functionality rather than a defect: no api route or controller method exposed the datasource's by-type paging over HTTP, and the datasource threw bare `Error`s that the api layer could not map to a 400 response.

## Solution

Building on the person module and `/api/v1/person/:uuid` route added by #9090, this PR added the paged `GET /api/v1/person` endpoint (`person.v1.getAll` in api/src/controllers/person.js, registered in api/src/routing.js) and introduced shared-libs/cht-datasource/src/libs/error.ts with `InvalidArgumentError`, adopted across person.ts and qualifier.ts, with error handling wired through server-utils.js.

This PR merged into the feature branch `9193-api-endpoints-for-getting-contacts-by-type` alongside #9266 (paging) and #9281 (generator), and reached master only via the epic squash PR #9311. The datasource surface those PRs landed is `Person.v1.getPage(ctx)(Qualifier.byContactType(type), cursor, limit)` for pagination and `Person.v1.getAll(ctx)(qualifier)` for the AsyncGenerator that transparently walks pages, surfaced on the `getDatasource()` facade as `person.getPageByType(type, cursor, limit)` and `person.getByType(type)` — implemented across both local and remote data-context variants, with defaults limit=100, cursor=`null`. The endpoint accepts personType/limit/cursor query params (`personType` was renamed to `type` by #9390; master reads `req.query.type`).

## Code Patterns

cht-datasource local/remote split: each data type (e.g., src/person.ts) defines a unified interface implemented twice — local/person.ts queries CouchDB directly while remote/person.ts calls the REST API — chosen by context. New API endpoints follow the pattern of adding api/src/controllers/<entity>.js and registering the route in api/src/routing.js, delegating data access to cht-datasource rather than querying the DB inline. Qualifiers (src/qualifier.ts) provide typed, validated identifiers (e.g., byUuid) passed to datasource getters.

Cursor-based pagination with sensible defaults plus an AsyncGenerator wrapper that repeatedly fetches pages until exhausted, backed by page primitives/types in src/libs/core.ts (PR #9311). The qualifier factory pattern extends to typed query predicates (byContactType) alongside identifier qualifiers.

## Design Choices

Implemented data access through the cht-datasource abstraction instead of ad-hoc CouchDB queries in the controller, centralizing logic so it is reusable across server-side (local) and client-side (remote) contexts. Used typed qualifiers for identifier handling and a dedicated datasource error type for consistent error semantics across the library and the api layer. For bulk retrieval, exposed two complementary access styles — explicit page-by-page retrieval for callers managing cursors, and an AsyncGenerator for ergonomic full iteration — with cursor and limit optional (defaults limit 100, cursor `null`) (PR #9311).

## Related Files

- api/src/controllers/person.js
- api/src/routing.js
- api/src/server-utils.js
- shared-libs/cht-datasource/src/index.ts
- shared-libs/cht-datasource/src/person.ts
- shared-libs/cht-datasource/src/local/person.ts
- shared-libs/cht-datasource/src/remote/person.ts
- shared-libs/cht-datasource/src/qualifier.ts
- shared-libs/cht-datasource/src/libs/error.ts
- shared-libs/cht-datasource/src/libs/core.ts (page primitives/types — PR #9311)
- shared-libs/cht-datasource/src/local/libs/doc.ts (PR #9311)
- shared-libs/cht-datasource/src/local/libs/lineage.ts (PR #9311)
- shared-libs/cht-datasource/src/remote/libs/data-context.ts (PR #9311)

## Testing

Test coverage extended — every test file in this PR is modified, none added. New cases in the api controller unit spec (api/tests/mocha/controllers/person.spec.js); cht-datasource unit tests for the person interface (test/person.spec.ts), local implementation (test/local/person.spec.ts), remote implementation (test/remote/person.spec.ts), and qualifier (test/qualifier.spec.ts); plus new end-to-end cases in the existing integration spec (tests/integration/api/controllers/person.spec.js). The by-type work extended these with unit tests across libs/core, local/libs/doc, local/libs/lineage, remote/libs/data-context, and server-utils, plus integration coverage of the GET /api/v1/person endpoint (landed on master via the epic squash PR #9311).

## Related Issues

- #9241: Create API endpoint for getting people
- #9193: Epic — API endpoints for getting contacts by type
- #9237: Add functionality of getting people with pagination in cht-datasource
- #9238: Add functionality of getting people as an iterator in cht-datasource

## Domain Rationale

**Fit:** strong

The endpoint retrieves person documents, and persons are a core contact type in CHT, so the subject matter is contact data access. There is a secondary interoperability dimension (it adds a public REST API surface), but the data domain is unambiguously contacts.
