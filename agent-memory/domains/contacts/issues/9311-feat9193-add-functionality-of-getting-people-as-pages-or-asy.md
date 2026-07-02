---
id: cht-core-9241
category: feature
domain: contacts
domainFit: strong
issueNumber: 9241
issueUrl: https://github.com/medic/cht-core/issues/9241
title: Add paged and async-iterable retrieval of people by contact type in cht-datasource plus GET /api/v1/person endpoint
lastUpdated: '2026-06-23'
summary: cht-datasource had no way to fetch people by contact type in bulk and no REST endpoint to page through them. This adds cursor-based pagination (getPageByType), an AsyncGenerator API (getByType), the byContactType qualifier, and a new GET /api/v1/person endpoint.
services:
  - api
techStack:
  - typescript
  - javascript
  - couchdb
  - node.js
tags:
  - cht-datasource
  - pagination
  - async-generator
  - person
  - contact-type
  - rest-api
  - cursor
  - qualifier
related_workflows: []
source_pr: medic/cht-core#9311
source_sha: 34dd0303c28230c2db271e5aaec7c7780c0655d2
distilled_at: '2026-06-23'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - shared-libs/cht-datasource/src/person.ts
  - shared-libs/cht-datasource/src/local/person.ts
  - shared-libs/cht-datasource/src/remote/person.ts
  - shared-libs/cht-datasource/src/qualifier.ts
  - shared-libs/cht-datasource/src/libs/core.ts
  - api/src/controllers/person.js
  - api/src/routing.js
concepts:
  - cursor-based pagination
  - async generators / async iterables
  - local vs remote data context abstraction
  - qualifier pattern
  - REST endpoint over shared datasource library
related_issues: []
stale: false
---

## Problem

cht-datasource exposed no API for retrieving people by their contact type, neither as discrete pages nor as a lazily-consumed stream, and there was no REST endpoint allowing clients to page through people of a given type.

## Root Cause

Missing feature: the person module in cht-datasource lacked by-type bulk retrieval with pagination/iteration support, and api exposed no corresponding /api/v1/person route or controller.

## Solution

Added Person.v1.getPageByType(Qualifier.byContactType(type), cursor, limit) for cursor/limit pagination (defaults limit=100, cursor="0"), Person.v1.getByType(ctx)(qualifier) returning an AsyncGenerator that transparently walks pages, and the Qualifier.byContactType qualifier. Implemented both local (direct doc/lineage access) and remote (API-backed) data-context variants, and wired a new GET /api/v1/person endpoint with personType/limit/cursor query params via a new person controller and route.

## Code Patterns

Cursor-based pagination with sensible defaults and an AsyncGenerator wrapper that repeatedly fetches pages until exhausted (shared-libs/cht-datasource/src/person.ts); paired local/remote implementations behind a single datasource interface (src/local/person.ts, src/remote/person.ts); qualifier factory pattern for typed query predicates (src/qualifier.ts, byContactType); page primitives/types in src/libs/core.ts; thin api controller delegating to the datasource (api/src/controllers/person.js).

## Design Choices

Exposed two complementary access styles — explicit page-by-page retrieval for callers managing cursors and an AsyncGenerator for ergonomic full iteration. cursor and limit are optional with defaults (100, "0"). Reviewer discussion (jkuester, Slack) addressed null/undefined cursor handling to standardize how an absent cursor is represented.

## Related Files

- shared-libs/cht-datasource/src/person.ts
- shared-libs/cht-datasource/src/local/person.ts
- shared-libs/cht-datasource/src/remote/person.ts
- shared-libs/cht-datasource/src/qualifier.ts
- shared-libs/cht-datasource/src/libs/core.ts
- shared-libs/cht-datasource/src/index.ts
- shared-libs/cht-datasource/src/local/libs/doc.ts
- shared-libs/cht-datasource/src/local/libs/lineage.ts
- shared-libs/cht-datasource/src/remote/libs/data-context.ts
- api/src/controllers/person.js
- api/src/routing.js
- api/src/server-utils.js
- tests/integration/api/controllers/person.spec.js

## Testing

Extensive mocha unit tests added/updated across cht-datasource (person, local/person, remote/person, qualifier, libs/core, local/libs/doc, local/libs/lineage, remote/libs/data-context, index) and api (controllers/person.spec.js, server-utils.spec.js), plus an integration test at tests/integration/api/controllers/person.spec.js exercising the new GET /api/v1/person endpoint.

## Related Issues

- #9193: Epic — API endpoints for getting contacts by type
- #9241: Add GET /api/v1/person REST endpoint (closed by this PR)
- #9237: cht-datasource person-by-type retrieval support
- #9238: cht-datasource person-by-type retrieval support

## Domain Rationale

**Fit:** strong

The PR adds the ability to fetch people (a contact type) by their contact type via cht-datasource and a new REST endpoint, which is core contact retrieval and management. The qualifier is literally Qualifier.byContactType, making contacts the most specific fit; it is not a sync/replication concern (data-sync) nor operational lifecycle (infrastructure).
