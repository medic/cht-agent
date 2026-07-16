---
id: cht-core-10037
category: feature
domain: contacts
domainFit: strong
issueNumber: 10037
issueUrl: https://github.com/medic/cht-core/issues/10037
title: Add updatePerson operation to cht-datasource remote (and local) implementations, with API controllers and routing (place/report extended in lockstep)
lastUpdated: '2026-06-22'
summary: The cht-datasource remote (API-backed) implementation had no update operation for persons. This PR implements updatePerson across the public/local/remote datasource layers and wires matching API controller handlers and routes, extending place and report in parallel.
services:
  - api
  - webapp
techStack:
  - typescript
  - javascript
  - nodejs
  - couchdb
  - express
tags:
  - cht-datasource
  - person
  - update
  - remote-implementation
  - datasource
  - crud
  - contacts
related_workflows: []
source_pr: medic/cht-core#10157
source_sha: ac8c9c5a0d2bf10bc4210342a4b0342bdeb0efce
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - shared-libs/cht-datasource/src/remote/person.ts
  - shared-libs/cht-datasource/src/person.ts
  - shared-libs/cht-datasource/src/local/person.ts
  - shared-libs/cht-datasource/src/remote/libs/data-context.ts
  - api/src/controllers/person.js
  - api/src/routing.js
concepts:
  - data access layer (datasource) abstraction
  - remote vs local data context
  - CRUD / update operation surface
  - API controllers and route registration
  - symmetric public API across entity types (person/place/report)
related_issues: []
stale: false
---

## Problem

The cht-datasource public API and its remote (HTTP/API-backed) implementation exposed read operations (e.g. get/getPage) for persons but had no way to update a person record through the datasource abstraction. To allow editing person/contact records via the datasource, an updatePerson operation had to be added and surfaced through the API.

## Root Cause

Not a defect — a missing capability. The cht-datasource remote/local data contexts and the corresponding API controllers/routes did not yet implement update operations for person (or place/report). Issue #10037 tracks extending the datasource CRUD surface to support updating persons.

## Solution

Implemented updatePerson in the remote person datasource (shared-libs/cht-datasource/src/remote/person.ts), delegated to it from the public person.ts factory, and added the local implementation; the remote data-context lib (remote/libs/data-context.ts) was extended to issue the update request. Place and report were updated in lockstep to keep the CRUD surface uniform. API controller handlers (api/src/controllers/{person,place,report}.js) and route registrations (api/src/routing.js) were added to expose the endpoints.

## Code Patterns

Datasource operations follow a consistent layering: a public factory (person.ts) delegates to remote/person.ts, which builds the request against the API through the remote data context (remote/libs/data-context.ts); the local/person.ts mirrors it for direct DB access. New operations mirror existing ones such as getPage, including JSDoc on the inner function to document params like updateInput (per reviewer feedback to match getPage's documentation style).

## Design Choices

Kept remote and local implementations symmetric behind the same public datasource API so callers are agnostic to data context, and extended place and report alongside person to keep the CRUD surface uniform across entity types. Reviewer (sugat009) recommended documenting the inner updatePerson function like getPage so updateInput and related parameters are explained in JSDoc.

## Related Files

- shared-libs/cht-datasource/src/remote/person.ts
- shared-libs/cht-datasource/src/person.ts
- shared-libs/cht-datasource/src/local/person.ts
- shared-libs/cht-datasource/src/local/libs/core.ts
- shared-libs/cht-datasource/src/remote/libs/data-context.ts
- shared-libs/cht-datasource/src/index.ts
- shared-libs/cht-datasource/src/remote/place.ts
- shared-libs/cht-datasource/src/remote/report.ts
- api/src/controllers/person.js
- api/src/routing.js

## Testing

Tests were added/updated at three levels: mocha unit tests for API controllers (api/tests/mocha/controllers/{person,place,report}.spec.js), cht-datasource unit tests across public/local/remote layers (test/{person,place,report}.spec.ts, test/local/*, test/remote/* and test/remote/libs/data-context.spec.ts), and integration tests (tests/integration/api/controllers/person.spec.js and tests/integration/shared-libs/cht-datasource/{person,place,report}.spec.js). The PR body's initial 'TODO: Add tests' note is superseded by the merged diff, which includes them.

## Related Issues

- #10037: Update person remote implementation — extend cht-datasource to support updating persons (and place/report)

## Domain Rationale

**Fit:** strong

The PR extends the cht-datasource update operation for person (and place), which are CHT contacts, and the title and issue #10037 center explicitly on person. Report files are touched as collateral pattern-extension, but person/place dominate and contacts is the squarely-fitting functional domain (not data-sync — cht-datasource is a data-access abstraction, not replication).
