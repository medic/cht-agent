---
id: cht-core-10040
category: feature
domain: forms-and-reports
domainFit: strong
issueNumber: 10040
issueUrl: https://github.com/medic/cht-core/issues/10040
title: Add report-create support to the cht-datasource local adapter
lastUpdated: '2026-08-09'
summary: The cht-datasource local (direct-database) adapter could read reports but had no way to create them. This work implements `Local.Report.v1.create` in the local report adapter, taking a typed `Input.v1.ReportInput`, bringing the local context to parity with the create operation.
services:
  - api
  - webapp
techStack:
  - typescript
  - pouchdb
  - couchdb
tags:
  - report-create
  - cht-datasource
  - local-adapter
  - reports
  - data-access
  - input-validation
related_workflows:
  - form-submission
source_prs:
  - "medic/cht-core#10071"
  - "medic/cht-core#10099"
source_pr: medic/cht-core#10071
source_sha: d40e65bae79d6eaf60c29c6b529139a83579a92f
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - shared-libs/cht-datasource/src/local/report.ts
  - shared-libs/cht-datasource/src/input.ts
  - shared-libs/cht-datasource/src/libs/parameter-validators.ts
concepts:
  - local data adapter
  - datasource abstraction
  - local vs remote data context
  - report creation
  - typed operation input and validation
  - epic-branch provenance
related_issues:
  - cht-core-10038
stale: false
---

## Provenance

PRs #10071 and #10099 were child PRs of the `9835-…` epic branch and are stamped nowhere in cht-core's history — `git log --grep='(#10071)'` finds nothing, and `source_sha` (`d40e65bae`) is this PR's own merge commit into that epic branch — GitHub still reports it as that PR's merge commit, but it is absent from a clone because the epic squashed it away. The work reaches master only through the epic squash `f382785be` — `feat(#9835): add cht datasource apis for creation and update of contacts and reports (#10083)`. Every path and symbol below is stated as of that squash; the per-child split between #10071 and #10099 comes from the PR descriptions, not from anything verifiable in the git history.

## Problem

The cht-datasource local data context could not create reports. Consumers operating against the local (direct-database/PouchDB) adapter could not create report documents through the datasource abstraction, leaving the local context behind the intended create capability. On the remote/API side the same gap existed: the report module exposed only read operations, with no remote create implementation, API controller method, or POST route for creating reports, even though person and place already had a full create path (PR #10099).

## Root Cause

The local report adapter in cht-datasource implemented read operations only — there was no `create` export on `Local.Report.v1` — and the library had no typed input shape or validator for the fields a new report needs (`form`, `contact`, `reported_date`).

## Solution

Added `Local.Report.v1.create` to shared-libs/cht-datasource/src/local/report.ts following the existing local-adapter structure. It takes an `Input.v1.ReportInput`, asserts it via `assertReportInput`, resolves and validates the referenced contact, checks `form` against the supported-forms list, then minifies and writes the doc through `createDoc` from src/local/libs/doc.ts. Unit tests were added/updated in test/local/report.spec.ts and test/local/person.spec.ts. The API layer completes the create path (PR #10099): `Report.v1.create` on the domain module (src/report.ts) adapts between the local implementation and a remote adapter (`Remote.Report.v1.create = postResource('api/v1/report')` in src/remote/report.ts), wired to an API controller method (api/src/controllers/report.js) and the route `app.postJson('/api/v1/report', report.v1.create)` in api/src/routing.js, with shared input validation in src/libs/parameter-validators.ts; person and place create paths were touched to share/align validation logic.

Note the naming: there is no `createReport` symbol anywhere in cht-core's production code. The operation is namespaced — `Report.v1.create`, `Local.Report.v1.create`, `Remote.Report.v1.create` — and "createReport" survives only as the informal feature name and as test-stub variable names.

## Code Patterns

Local adapter create-operation pattern in cht-datasource: implement `create` in src/local/<entity>.ts mirroring the datasource abstraction, taking a typed input object from src/input.ts (`Input.v1.ReportInput`) rather than a qualifier — qualifiers identify existing docs for reads, so they play no part in the create path. Establishes the template for adding further local create operations and keeping local/remote contexts at parity. The corresponding remote/API pattern (PR #10099): domain module (src/report.ts) exposes `create` → adapts to the remote adapter (src/remote/report.ts) for the HTTP POST → API controller (api/src/controllers/report.js) handles the request → route registered in api/src/routing.js → shared argument validation in src/libs/parameter-validators.ts, mirroring the existing person.ts and place.ts implementations.

## Design Choices

Implements report creation in the local adapter to keep the local data context aligned with the datasource abstraction's create operations (parity with the remote context), delivered as incremental work toward the broader create-report feature (#10038). Named the operation `create` inside the `Report.v1` namespace rather than a flat `createReport`, matching `Person.v1.create` and `Place.v1.create`. On the API side (PR #10099), reused the existing person/place create architecture (domain module + remote adapter + controller + shared validators) for API and naming consistency across the datasource surface rather than a bespoke report-only path, and centralized validation in parameter-validators.ts to avoid duplication.

## Related Files

Paths are as they stand in the #10083 epic squash.

Local adapter (PR #10071):

- shared-libs/cht-datasource/src/local/report.ts
- shared-libs/cht-datasource/src/input.ts
- shared-libs/cht-datasource/src/local/libs/doc.ts
- shared-libs/cht-datasource/test/local/report.spec.ts
- shared-libs/cht-datasource/test/local/person.spec.ts

API and remote adapter (PR #10099):

- api/src/controllers/report.js
- api/src/controllers/person.js
- api/src/controllers/place.js
- api/src/routing.js
- api/tests/mocha/controllers/report.spec.js
- api/tests/mocha/controllers/person.spec.js
- api/tests/mocha/controllers/place.spec.js
- shared-libs/cht-datasource/src/report.ts
- shared-libs/cht-datasource/src/remote/report.ts
- shared-libs/cht-datasource/src/person.ts
- shared-libs/cht-datasource/src/place.ts
- shared-libs/cht-datasource/src/index.ts
- shared-libs/cht-datasource/src/libs/parameter-validators.ts
- shared-libs/cht-datasource/test/remote/report.spec.ts
- shared-libs/cht-datasource/test/person.spec.ts
- shared-libs/cht-datasource/test/place.spec.ts
- shared-libs/cht-datasource/test/index.spec.ts
- tests/integration/api/controllers/report.spec.js
- tests/integration/shared-libs/cht-datasource/report.spec.js

## Testing

Added and updated unit specs (shared-libs/cht-datasource/test/local/report.spec.ts and test/local/person.spec.ts) to cover the new local `create` behavior. The API layer (PR #10099) added Mocha unit tests for the API controllers (report, person, place spec files), cht-datasource unit tests (report, person, place, index, and remote/report specs), and end-to-end integration tests for both the API controller (tests/integration/api/controllers/report.spec.js) and the datasource library (tests/integration/shared-libs/cht-datasource/report.spec.js).

## Related Issues

- #10040: "To have API that can create reports" — the issue these PRs implement, via local and API support for report creation
- #10038: "To have API that can create places" — the sibling issue covering the place-creation half of the same cht-datasource create work
- PR #10083: "feat(#9835): add cht datasource apis for creation and update of contacts and reports" — the epic PR whose squash (`f382785be`) is the only commit carrying this work on master
