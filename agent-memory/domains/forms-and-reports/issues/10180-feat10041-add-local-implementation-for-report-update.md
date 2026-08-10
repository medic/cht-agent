---
id: cht-core-10041
category: feature
domain: forms-and-reports
domainFit: strong
issueNumber: 10041
issueUrl: https://github.com/medic/cht-core/issues/10041
title: Add local datasource implementation for updating reports in cht-datasource
lastUpdated: '2026-08-09'
summary: The cht-datasource shared library lacked a local (direct-database) implementation for updating report documents, so report updates could not be performed through the local data context. This PR adds the local update operation for reports along with unit tests.
services:
  - api
  - webapp
techStack:
  - typescript
  - couchdb
  - pouchdb
tags:
  - reports
  - report-update
  - cht-datasource
  - data-access-layer
  - local-implementation
  - crud
related_workflows: []
source_pr: medic/cht-core#10180
source_prs:
  - "medic/cht-core#10180"
  - "medic/cht-core#10200"
source_sha: 70b7be0b4f0394b22f7d24b5fd1b824fdef0aa87
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - shared-libs/cht-datasource/src/local/report.ts
  - shared-libs/cht-datasource/src/input.ts
  - shared-libs/cht-datasource/src/local/libs/doc.ts
concepts:
  - datasource abstraction layer
  - local vs remote implementation split
  - report document update
  - offline-first data access
  - data context binding
  - epic-branch provenance
related_issues: []
stale: false
---

## Provenance

PRs #10180 and #10200 were child PRs of the `9835-…` epic branch and are stamped nowhere in cht-core's history — `git log --grep='(#10180)'` finds nothing, and `source_sha` (`70b7be0b4`) is this PR's own merge commit into that epic branch — GitHub still reports it as that PR's merge commit, but it is absent from a clone because the epic squashed it away. The work reaches master only through the epic squash `f382785be` — `feat(#9835): add cht datasource apis for creation and update of contacts and reports (#10083)`. Every path and symbol below is stated as of that squash; the per-child split between #10180 and #10200 comes from the PR descriptions, not from anything verifiable in the git history.

## Problem

The cht-datasource report module exposed read (and other) operations but had no local implementation for updating a report, meaning report documents could not be updated through the local/offline data-access path provided by the library.

## Root Cause

The local report module in cht-datasource only implemented a subset of CRUD operations — there was no `update` export on `Local.Report.v1` — so the unified datasource API was incomplete for the report entity on the local (direct-DB) code path.

## Solution

Added `Local.Report.v1.update` to shared-libs/cht-datasource/src/local/report.ts, which persists changes to a report document via the local data context: it validates the incoming `Input.v1.UpdateReportInput`, loads the original report and its contact by id, asserts the read-only fields (`_rev`, `reported_date`) are unchanged and the form is still supported, then writes through `updateDoc` from src/local/libs/doc.ts. Unit tests were added alongside. Note the naming — the export is `update` inside the `Report.v1` namespace (`Local.Report.v1.update`, `Remote.Report.v1.update`), matching `Person.v1.update` and `Place.v1.update`; there is no flat `updateReport` symbol.

The remote (API-backed) path completes the same update end to end (PR #10200): an update handler in api/src/controllers/report.js with the route registered in api/src/routing.js; update methods on the report datasource interface (src/report.ts) delegating to remote (src/remote/report.ts, HTTP to API) and local (src/local/report.ts, PouchDB) backends; a reusable doc-update helper in src/local/libs/doc.ts; and input parsing/validation in src/input.ts, with the capability exported via src/index.ts.

## Code Patterns

Follows the cht-datasource local-implementation pattern in shared-libs/cht-datasource/src/local/report.ts: a factory/curried function that takes a local data context (database binding) and returns the operation function, mirroring the structure used by other entity modules (contact/person/place). The update operation writes the report doc through the local DB binding rather than via an HTTP/remote call.

At the entity level (PR #10200), a public interface module (src/report.ts) delegates to the remote backend (src/remote/report.ts, calling the API over HTTP) and the local backend, with shared input validation in src/input.ts and a generic document helper in src/local/libs/doc.ts. New mutating operations are added consistently across both backends rather than as a one-off API endpoint.

## Design Choices

Mirrors the library's existing local/remote split — the local implementation performs direct database writes while the remote implementation calls the API — keeping report operations consistent with the established datasource module structure and completing the report entity's local API surface incrementally.

## Related Files

- shared-libs/cht-datasource/src/local/report.ts
- shared-libs/cht-datasource/test/local/report.spec.ts

Remote path (PR #10200):

- api/src/controllers/report.js
- api/src/routing.js
- api/tests/mocha/controllers/report.spec.js
- shared-libs/cht-datasource/src/index.ts
- shared-libs/cht-datasource/src/input.ts
- shared-libs/cht-datasource/src/libs/core.ts
- shared-libs/cht-datasource/src/local/libs/doc.ts
- shared-libs/cht-datasource/src/place.ts
- shared-libs/cht-datasource/src/remote/report.ts
- shared-libs/cht-datasource/src/report.ts
- shared-libs/cht-datasource/test/index.spec.ts
- shared-libs/cht-datasource/test/report.spec.ts
- shared-libs/cht-datasource/test/libs/parameter-validators.spec.ts
- shared-libs/cht-datasource/test/remote/report.spec.ts
- tests/integration/api/controllers/report.spec.js
- tests/integration/shared-libs/cht-datasource/report.spec.js

## Testing

Added unit tests in shared-libs/cht-datasource/test/local/report.spec.ts covering the new local report update operation, mocking the data context/database to verify the report document is persisted and edge/error cases are handled.

The remote path (PR #10200) adds cht-datasource unit specs (test/remote/report.spec.ts, test/report.spec.ts, test/index.spec.ts, test/libs/parameter-validators.spec.ts — there is no `test/input.spec.ts`; `src/input.ts` is covered through the entity and validator specs), API mocha controller tests (api/tests/mocha/controllers/report.spec.js), and integration tests for both the API controller (tests/integration/api/controllers/report.spec.js) and the datasource (tests/integration/shared-libs/cht-datasource/report.spec.js).

## Related Issues

- #10041: umbrella issue for report update support in cht-datasource (this PR adds the local implementation portion)
- PR #10083: "feat(#9835): add cht datasource apis for creation and update of contacts and reports" — the epic PR whose squash (`f382785be`) is the only commit carrying this work on master

## Domain Rationale

**Fit:** strong

The PR adds report-update functionality to the cht-datasource library, and reports are squarely the forms-and-reports domain. Although it lives in the data-access layer, it concerns the report entity specifically (not a cross-cutting storage concern like ID generation), so forms-and-reports is the most specific home rather than data-sync.
