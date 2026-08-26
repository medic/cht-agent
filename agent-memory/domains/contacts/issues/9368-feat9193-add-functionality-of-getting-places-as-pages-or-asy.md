---
id: cht-core-9193
category: feature
domain: contacts
domainFit: strong
issueNumber: 9193
issueUrl: https://github.com/medic/cht-core/issues/9193
title: Add paginated and async-iterable retrieval of places by type to cht-datasource, plus the GET /api/v1/place REST endpoint
lastUpdated: '2026-08-20'
summary: cht-datasource could fetch individual places but had no way to retrieve places by contact type in bulk. This PR adds cursor-based pagination (Place.v1.getPage) and an async-generator API (Place.v1.getAll), and exposes the paginated REST endpoint GET /api/v1/place, mirroring the GET /api/v1/person endpoint already added by #9295/#9311.
services:
  - api
techStack:
  - typescript
  - javascript
  - node.js
  - express
  - couchdb
tags:
  - pagination
  - cursor-pagination
  - async-generator
  - async-iterable
  - cht-datasource
  - places
  - contacts
  - rest-api
  - datasource
related_workflows: []
source_pr: medic/cht-core#9368
source_sha: 09dc81748affeffb24fdd78b5e59723072a56c18
distilled_at: '2026-06-23'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - shared-libs/cht-datasource/src/place.ts
  - shared-libs/cht-datasource/src/person.ts
  - shared-libs/cht-datasource/src/local/place.ts
  - shared-libs/cht-datasource/src/remote/place.ts
  - shared-libs/cht-datasource/src/libs/core.ts
  - api/src/controllers/place.js
  - api/src/routing.js
concepts:
  - cursor-based pagination
  - async generators / async iterables
  - data access layer abstraction
  - local/remote data context split
  - REST API design
  - qualifier-based queries (byContactType)
related_issues:
  - cht-core-9239
  - cht-core-9240
  - cht-core-9242
  - cht-core-9241
stale: false
---

## Problem

The cht-datasource library exposed only single-document place lookups; there was no supported way to retrieve all places of a given contact type, neither as paginated pages nor as a streaming async iterable, and no REST endpoint to fetch places as pages. The equivalent person capability already existed at this point, added by #9295 and landed on master via #9311.

## Root Cause

Not a defect — a missing capability. The Place API in cht-datasource lacked bulk get-by-type methods and corresponding local/remote implementations, and api routing exposed no endpoint for paginated place-by-type retrieval.

## Solution

Added Place.v1.getPage(ctx)(qualifier, cursor, limit) for cursor-paginated fetches (defaults: limit 100, cursor `null`) and Place.v1.getAll(ctx)(qualifier) which returns an AsyncGenerator that internally pages through all matching places, yielding one place at a time. Both are surfaced on the `getDatasource()` facade as place.getPageByType(placeType, cursor, limit) and place.getByType(placeType), which take a plain string type rather than a qualifier. Implemented in the local (CouchDB-backed) and remote data contexts, with shared paging logic in libs/core.ts and local/libs/doc.ts. Exposed the REST endpoint GET /api/v1/place (query params: type, limit, cursor) via api/src/controllers/place.js and api/src/routing.js.

## Code Patterns

Two complementary access patterns layered over one query: (1) explicit cursor pagination Place.v1.getPage(ctx)(qualifier, cursor, limit) returning a page plus next cursor, for callers (e.g. REST clients) that manage their own cursor; (2) Place.v1.getAll(ctx)(qualifier) returning an AsyncGenerator that auto-pages and yields individual places, so callers can `for await` over all results without cursor bookkeeping. Both share doc-fetch-by-type helpers in shared-libs/cht-datasource/src/libs/core.ts and src/local/libs/doc.ts, with parallel local (src/local/place.ts) and remote (src/remote/place.ts) implementations behind the same public surface in src/place.ts. Mirrors the existing Person API for consistency.

## Design Choices

Offered both paginated pages and async generators so REST/stateless consumers can drive their own cursors while in-process consumers can iterate lazily without manual paging. Defaults (limit 100, cursor `null`) keep calls ergonomic. The Place API was modeled on the Person API to keep the datasource surface uniform, and logic was split across local vs remote data contexts to preserve cht-datasource's existing online/offline abstraction.

## Related Files

- shared-libs/cht-datasource/src/place.ts
- shared-libs/cht-datasource/src/person.ts
- shared-libs/cht-datasource/src/local/place.ts
- shared-libs/cht-datasource/src/local/person.ts
- shared-libs/cht-datasource/src/local/libs/doc.ts
- shared-libs/cht-datasource/src/remote/place.ts
- shared-libs/cht-datasource/src/remote/libs/data-context.ts
- shared-libs/cht-datasource/src/libs/core.ts
- shared-libs/cht-datasource/src/index.ts
- api/src/controllers/place.js
- api/src/routing.js

## Testing

Updated unit tests (mocha) — eleven spec files in all, every one modified and none added: across cht-datasource, test/place.spec.ts, test/local/place.spec.ts, test/local/person.spec.ts, test/local/libs/doc.spec.ts, test/remote/place.spec.ts, test/remote/libs/data-context.spec.ts, test/index.spec.ts — plus api controller specs (api/tests/mocha/controllers/place.spec.js and person.spec.js) and integration tests (tests/integration/api/controllers/place.spec.js and person.spec.js) exercising the pagination API, async-generator API, and the new GET /api/v1/place REST endpoint.

## Related Issues

- #9193: API endpoints for getting contacts by type (parent/branch issue)
- #9239: Retrieve places by type via cht-datasource
- #9240: Paginated / async-iterable access for places
- #9242: Create API endpoint for getting places with types

## Domain Rationale

**Fit:** strong

Places are CHT contacts, and this PR extends the cht-datasource contact-access layer to retrieve places by contact type — the entities fetched and the library extended are both contact-centric. Not infrastructure: this is in-application data-access code, not operational lifecycle.
