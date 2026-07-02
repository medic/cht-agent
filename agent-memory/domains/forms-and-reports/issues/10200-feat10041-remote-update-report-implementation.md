---
id: cht-core-10200
category: feature
domain: forms-and-reports
domainFit: strong
issueNumber: 10200
issueUrl: https://github.com/medic/cht-core/issues/10200
title: Add remote (API-backed) update support for reports in cht-datasource and the API report controller
lastUpdated: '2026-06-22'
summary: cht-datasource and the API could read/create reports but had no way to update an existing report through the remote path. This PR implements remote update for reports, adding an API update route/handler, datasource update methods (remote + local), input validation, and tests.
services:
  - api
techStack:
  - typescript
  - javascript
  - nodejs
  - couchdb
tags:
  - report
  - update
  - cht-datasource
  - remote
  - mutation
  - crud
  - api
related_workflows:
  - form-submission
source_pr: medic/cht-core#10200
source_sha: b6470973b6c3c13ea6c28b6c0858b4e75ce9bba5
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - api/src/controllers/report.js
  - api/src/routing.js
  - shared-libs/cht-datasource/src/report.ts
  - shared-libs/cht-datasource/src/remote/report.ts
  - shared-libs/cht-datasource/src/local/report.ts
  - shared-libs/cht-datasource/src/input.ts
  - shared-libs/cht-datasource/src/local/libs/doc.ts
concepts:
  - local/remote datasource abstraction behind a unified interface
  - report mutation (update) operation
  - API controller and route registration
  - input parsing and validation
related_issues: []
stale: false
---

## Problem

The cht-datasource library and the API exposed read/create for reports but provided no way to update an existing report document via the remote (API/HTTP) backend, blocking programmatic report updates.

## Root Cause

Update was simply not implemented for the report entity: there was no API update endpoint/handler for reports, and the report datasource interface plus its remote and local implementations lacked an update method.

## Solution

Implemented remote update for reports end to end: added the update handler in api/src/controllers/report.js and registered the route in api/src/routing.js; added update methods to the report datasource interface (src/report.ts) with remote (src/remote/report.ts, HTTP to API) and local (src/local/report.ts, PouchDB) implementations; added a reusable doc-update helper (src/local/libs/doc.ts) and input parsing/validation (src/input.ts); exported the new capability via src/index.ts. Unit and integration tests were added.

## Code Patterns

cht-datasource entity pattern: a public interface module (shared-libs/cht-datasource/src/report.ts) delegating to a remote backend (src/remote/report.ts, calling the API over HTTP) and a local backend (src/local/report.ts, operating on PouchDB), with shared input validation in src/input.ts and a generic document helper in src/local/libs/doc.ts. New mutating operations are added consistently across both backends rather than as a one-off API endpoint.

## Design Choices

Mirrors the established cht-datasource separation of local (offline/PouchDB) and remote (online/API) backends behind a single interface, keeping the new update consistent with existing get/create operations and reusing the shared input-validation and doc helpers instead of adding a bespoke path.

## Related Files

- api/src/controllers/report.js
- api/src/routing.js
- api/tests/mocha/controllers/report.spec.js
- shared-libs/cht-datasource/src/index.ts
- shared-libs/cht-datasource/src/input.ts
- shared-libs/cht-datasource/src/libs/core.ts
- shared-libs/cht-datasource/src/local/libs/doc.ts
- shared-libs/cht-datasource/src/local/report.ts
- shared-libs/cht-datasource/src/place.ts
- shared-libs/cht-datasource/src/remote/report.ts
- shared-libs/cht-datasource/src/report.ts
- shared-libs/cht-datasource/test/index.spec.ts
- shared-libs/cht-datasource/test/input.spec.ts
- shared-libs/cht-datasource/test/local/report.spec.ts
- shared-libs/cht-datasource/test/remote/report.spec.ts
- tests/integration/api/controllers/report.spec.js
- tests/integration/shared-libs/cht-datasource/report.spec.js

## Testing

Despite the PR body noting 'TODO: Add tests', the merged change includes tests: cht-datasource unit specs (test/local/report.spec.ts, test/remote/report.spec.ts, test/input.spec.ts, test/index.spec.ts), API mocha controller tests (api/tests/mocha/controllers/report.spec.js), and integration tests for both the API controller (tests/integration/api/controllers/report.spec.js) and the datasource (tests/integration/shared-libs/cht-datasource/report.spec.js).

## Related Issues

- #10041: Remote update report implementation — feature to support updating existing reports via the cht-datasource/API

## Domain Rationale

**Fit:** strong

The PR adds an update operation for report documents (CHT reports are submitted-form data) across the API report controller and the cht-datasource report modules; reports are the canonical entity of the forms-and-reports domain. 'Remote' here means the cht-datasource remote (HTTP/API) backend, not replication/sync, so data-sync does not apply.
