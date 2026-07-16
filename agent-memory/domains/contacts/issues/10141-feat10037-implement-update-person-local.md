---
id: cht-core-10037
category: feature
domain: contacts
domainFit: strong
issueNumber: 10037
issueUrl: https://github.com/medic/cht-core/issues/10037
title: Implement update-person operation in the cht-datasource local data module
lastUpdated: '2026-06-22'
summary: The cht-datasource local (offline-capable) backend exposed read operations for person documents but had no update operation. This PR implements update-person in the local module, wiring it through the public datasource API, input validation, and shared core libs, following the existing place/report pattern.
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
  - centralized input validation
  - versioned (v1) curried, context-bound API
related_issues: []
stale: false
---

## Problem

The cht-datasource local data module lacked an update operation for person documents. Local (offline-capable / server-local) consumers could read persons but could not update them, leaving the local datasource API surface for persons incomplete relative to the intended uniform entity API.

## Root Cause

Incremental build-out of the cht-datasource API: the update-person capability had simply not been implemented yet for the local backend (tracked under #10037), so the local module exposed reads but no person update path.

## Solution

Added the update-person implementation to shared-libs/cht-datasource/src/local/person.ts and exposed it through the public datasource API in src/person.ts. Extended input validation in src/input.ts and shared helpers in src/local/libs/core.ts, and made parallel adjustments to place.ts/report.ts and their local counterparts for a consistent contract. The implementation follows the established curried, context-bound factory pattern (e.g. v1.update(localContext)) already used for place and report.

## Code Patterns

Local datasource update follows the established pattern: a versioned, curried factory bound to the local data context that validates the input document, loads the existing doc, applies the update, and persists it via the local context. Input shapes are validated centrally in src/input.ts rather than per entity. See shared-libs/cht-datasource/src/local/person.ts and shared-libs/cht-datasource/src/local/libs/core.ts.

## Design Choices

Preserved cht-datasource's local/remote split and made the local update-person contract identical to place and report so the API stays uniform across entities. Validation lives in a shared input module to avoid per-entity duplication.

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

## Testing

Added and extended unit tests for the new local update-person path (test/local/person.spec.ts), input validation (test/input.spec.ts, test/libs/parameter-validators.spec.ts), and entity API surfaces (test/local/place.spec.ts, test/report.spec.ts, test/index.spec.ts). Updated api controller/service tests (api/tests/mocha/controllers/person.spec.js, api/tests/mocha/services/settings.spec.js) and added an integration test (tests/integration/shared-libs/cht-datasource/report.spec.js). Coverage config (shared-libs/nyc.config.js) was adjusted. The 'Tested' checklist item was checked.

## Related Issues

- #10037: umbrella/parent issue for implementing person update operations in cht-datasource

## Domain Rationale

**Fit:** strong

Persons are CHT contacts, and this implements the update-person CRUD operation in the cht-datasource data-access library — core contact data management. 'Local' here denotes the offline/local data-access backend within cht-datasource (vs the remote/API backend), not replication, so contacts is a strong fit over data-sync.
