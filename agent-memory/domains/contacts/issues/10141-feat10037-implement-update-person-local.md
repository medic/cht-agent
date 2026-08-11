---
id: cht-core-10037
category: feature
domain: contacts
domainFit: strong
issueNumber: 10037
issueUrl: https://github.com/medic/cht-core/issues/10037
title: Implement update-person operation in the cht-datasource local data module
lastUpdated: '2026-08-11'
summary: The cht-datasource local (offline-capable) backend exposed read and create operations for person documents but had no update operation. This PR implements update-person in the local module as the internal v1.updatePerson factory, built on shared helpers added to src/local/libs/core.ts. It was the first update operation in the local module, and it was not yet wired into the public datasource API — the public Person.v1.update export came in the follow-up PR #10157.
services:
  - api
  - webapp
techStack:
  - typescript
  - pouchdb
  - couchdb
  - mocha
tags:
  - cht-datasource
  - update-person
  - local-datasource
  - crud
  - data-access
  - person
related_workflows: []
source_pr: medic/cht-core#10141
source_prs:
  - "medic/cht-core#10141"
  - "medic/cht-core#10157"
source_sha: d32883fff468de69d481c363dcf6522780cd1c5e
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - shared-libs/cht-datasource/src/local/person.ts
  - shared-libs/cht-datasource/src/person.ts
  - shared-libs/cht-datasource/src/input.ts
  - shared-libs/cht-datasource/src/local/libs/core.ts
concepts:
  - data-access layer / datasource abstraction
  - local vs remote data-source backends
  - CRUD update operation
  - offline-first data access
  - shared update-validation primitives in the local core lib
  - versioned (v1) curried, context-bound API
related_issues: []
stale: false
---

## Problem

The cht-datasource local data module lacked an update operation for person documents. Local (offline-capable / server-local) consumers could read and create persons but could not update them, leaving the local datasource API surface for persons incomplete relative to the intended uniform entity API. The same gap existed on the remote (HTTP/API-backed) side, which exposed reads (get/getPage) and create but no way to update a person through the datasource abstraction (PR #10157).

## Root Cause

Incremental build-out of the cht-datasource API: the update-person capability had simply not been implemented yet for the local backend (tracked under #10037), so the local module exposed reads and creates but no person update path.

## Solution

Added the update-person implementation to shared-libs/cht-datasource/src/local/person.ts as the internal `v1.updatePerson` factory. #10141 did not expose it publicly — the public `Person.v1.update` export in src/person.ts was added by the follow-up remote PR #10157; #10141's own changes to src/person.ts, src/place.ts and src/report.ts are reindentation only. The supporting shared helpers (`addParentToInput`, `dehydrateDoc`, `ensureHasRequiredFields`, `ensureImmutability`) were added to src/local/libs/core.ts; the only substantive src/input.ts change here is unrelated to persons — it makes `contact` a required field of `isReportInput`. The implementation follows the established curried, context-bound local factory pattern used by the existing `createPerson`/`createPlace`/`createReport` operations; person update was the first update operation in the local module — place and report update followed later. The companion remote implementation (PR #10157) added the remote `v1.update` operation in src/remote/person.ts (a `PUT api/v1/person` via `putResource`), delegated to it from the public person.ts factory, and extended the remote data-context lib (src/remote/libs/data-context.ts) to issue the update request; matching API controller handlers (api/src/controllers/person.js) and route registrations (api/src/routing.js) expose the endpoints. Place and report were touched on the remote side by #10157 only for the `create*` → `create` rename (src/remote/place.ts, src/remote/report.ts and the matching controllers); their remote update operations came later — update-place in #10173.

## Code Patterns

Local datasource update follows the established curried-factory pattern: a versioned factory bound to the local data context that checks the input is a `Doc`, loads the existing doc via the local `get`, rejects a `_rev` mismatch, validates the update payload, and persists it via `updateDoc(medicDb)`. Update-payload validation is per-entity (`validateUpdatePersonPayload` in src/local/person.ts) but built from shared primitives in src/local/libs/core.ts (`ensureHasRequiredFields`, `ensureImmutability`, `dehydrateDoc`); src/input.ts covers create-input shapes. See shared-libs/cht-datasource/src/local/person.ts and shared-libs/cht-datasource/src/local/libs/core.ts. On the remote side (PR #10157) the public factory (person.ts) delegates to remote/person.ts, which builds the request against the API through the remote data context (remote/libs/data-context.ts), so local and remote stay symmetric behind one public API; new operations mirror existing ones such as getPage, including JSDoc on the inner function to document params like updateInput (PR #10157).

## Design Choices

Preserved cht-datasource's local/remote split and modelled the local update-person contract on the existing create operations so the API stays uniform across entities; person update was the first update operation in the local module, and place and report update were later built to match. Per-entity update validation is kept thin by factoring the shared checks into src/local/libs/core.ts rather than duplicating them.

## Related Files

- shared-libs/cht-datasource/src/local/person.ts
- shared-libs/cht-datasource/src/person.ts
- shared-libs/cht-datasource/src/input.ts
- shared-libs/cht-datasource/src/local/libs/core.ts
- shared-libs/cht-datasource/src/local/place.ts
- shared-libs/cht-datasource/src/local/report.ts
- shared-libs/cht-datasource/src/place.ts
- shared-libs/cht-datasource/src/report.ts
- shared-libs/cht-datasource/test/local/person.spec.ts
- shared-libs/cht-datasource/test/input.spec.ts
- shared-libs/cht-datasource/test/libs/parameter-validators.spec.ts
- shared-libs/cht-datasource/test/local/place.spec.ts
- shared-libs/cht-datasource/test/report.spec.ts
- shared-libs/cht-datasource/test/index.spec.ts
- api/tests/mocha/controllers/person.spec.js
- api/tests/mocha/services/settings.spec.js
- tests/integration/shared-libs/cht-datasource/report.spec.js
- shared-libs/nyc.config.js

Remote implementation (PR #10157):

- shared-libs/cht-datasource/src/remote/person.ts
- shared-libs/cht-datasource/src/remote/libs/data-context.ts
- shared-libs/cht-datasource/src/remote/place.ts
- shared-libs/cht-datasource/src/remote/report.ts
- shared-libs/cht-datasource/src/index.ts
- api/src/controllers/person.js
- api/src/routing.js
- tests/integration/api/controllers/person.spec.js
- tests/integration/shared-libs/cht-datasource/person.spec.js

## Testing

Added and extended unit tests for the new local update-person path (test/local/person.spec.ts), input validation (test/input.spec.ts, test/libs/parameter-validators.spec.ts), and entity API surfaces (test/local/place.spec.ts, test/report.spec.ts, test/index.spec.ts). Updated api controller/service tests (api/tests/mocha/controllers/person.spec.js, api/tests/mocha/services/settings.spec.js) and applied a lint-only reflow of one assertion message in tests/integration/shared-libs/cht-datasource/report.spec.js (no test was added there). Coverage config (shared-libs/nyc.config.js) was adjusted. The 'Tested' checklist item was checked. The remote implementation (PR #10157) added tests at three levels: mocha unit tests for the API controllers (api/tests/mocha/controllers/{person,place,report}.spec.js), cht-datasource unit tests across the public/local/remote layers (including test/remote/* and test/remote/libs/data-context.spec.ts), and integration tests (tests/integration/api/controllers/person.spec.js and tests/integration/shared-libs/cht-datasource/{person,place,report}.spec.js).

## Related Issues

- #10037: umbrella/parent issue for implementing person update operations in cht-datasource

## Domain Rationale

**Fit:** strong

Persons are CHT contacts, and this implements the update-person CRUD operation in the cht-datasource data-access library — core contact data management. 'Local' here denotes the offline/local data-access backend within cht-datasource (vs the remote/API backend), not replication, so contacts is a strong fit over data-sync.
