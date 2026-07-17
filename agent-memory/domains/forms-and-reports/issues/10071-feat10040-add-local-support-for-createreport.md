---
id: cht-core-10040
category: feature
domain: forms-and-reports
domainFit: strong
issueNumber: 10040
issueUrl: https://github.com/medic/cht-core/issues/10040
title: Add createReport support to the cht-datasource local adapter
lastUpdated: '2026-07-16'
summary: The cht-datasource local (direct-database) adapter could read reports but had no way to create them. This PR implements `createReport` in the local report adapter with supporting qualifier changes, bringing the local context to parity with the create operation.
services:
  - api
  - webapp
techStack:
  - typescript
  - pouchdb
  - couchdb
tags:
  - createReport
  - cht-datasource
  - local-adapter
  - reports
  - data-access
  - qualifier
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
  - shared-libs/cht-datasource/src/qualifier.ts
concepts:
  - local data adapter
  - datasource abstraction
  - local vs remote data context
  - report creation
  - qualifiers
related_issues:
  - cht-core-10038
stale: false
---

## Problem

The cht-datasource local data context lacked a `createReport` implementation. Consumers operating against the local (direct-database/PouchDB) adapter could not create report documents through the datasource abstraction, leaving the local context behind the intended create capability. On the remote/API side the same gap existed: the report module exposed only read operations, with no remote create implementation, API controller method, or POST route for creating reports, even though person and place already had a full create path (PR #10099).

## Root Cause

The local report adapter in cht-datasource implemented read operations but had no `createReport`, and the qualifier module lacked the supporting qualification needed to back the create operation in the local context.

## Solution

Added a `createReport` implementation to shared-libs/cht-datasource/src/local/report.ts following the existing local-adapter structure, with accompanying changes in shared-libs/cht-datasource/src/qualifier.ts to support the operation. Unit tests were added/updated in test/local/report.spec.ts and test/local/person.spec.ts. The API layer completes the create path (PR #10099): a create operation on the report domain module (src/report.ts) delegates to a remote adapter (src/remote/report.ts) issuing the HTTP POST, wired to an API controller method (api/src/controllers/report.js) and route (api/src/routing.js), with shared input validation added in src/libs/parameter-validators.ts; person and place create paths were touched to share/align validation logic.

## Code Patterns

Local adapter create-operation pattern in cht-datasource: implement the operation in src/local/<entity>.ts mirroring the datasource abstraction, leaning on qualifiers from src/qualifier.ts for input identification/validation. Establishes the template for adding further local create operations and keeping local/remote contexts at parity. The corresponding remote/API pattern (PR #10099): domain module (src/report.ts) exposes create → delegates to the remote adapter (src/remote/report.ts) for the HTTP POST → API controller (api/src/controllers/report.js) handles the request → route registered in api/src/routing.js → shared argument validation in src/libs/parameter-validators.ts, mirroring the existing person.ts and place.ts implementations.

## Design Choices

Implements createReport in the local adapter to keep the local data context aligned with the datasource abstraction's create operations (parity with the remote context), delivered as incremental work toward the broader createReport feature (#10038). On the API side (PR #10099), reused the existing person/place create architecture (domain module + remote adapter + controller + shared validators) for API and naming consistency across the datasource surface rather than a bespoke report-only path, and centralized validation in parameter-validators.ts to avoid duplication.

## Related Files

Local adapter (PR #10071):

- shared-libs/cht-datasource/src/local/report.ts
- shared-libs/cht-datasource/src/qualifier.ts
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

Added and updated unit specs (shared-libs/cht-datasource/test/local/report.spec.ts and test/local/person.spec.ts) to cover the new local createReport behavior. The API layer (PR #10099) added Mocha unit tests for the API controllers (report, person, place spec files), cht-datasource unit tests (report, person, place, index, and remote/report specs), and end-to-end integration tests for both the API controller (tests/integration/api/controllers/report.spec.js) and the datasource library (tests/integration/shared-libs/cht-datasource/report.spec.js).

## Related Issues

- #10040: issue implemented by these PRs — add local and API support for createReport
- #10038: broader createReport feature this work builds toward
