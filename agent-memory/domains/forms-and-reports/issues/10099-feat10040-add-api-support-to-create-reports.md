---
id: cht-core-10040
category: feature
domain: forms-and-reports
domainFit: strong
issueNumber: 10040
issueUrl: https://github.com/medic/cht-core/issues/10040
title: Add API and cht-datasource support for creating reports
lastUpdated: '2026-06-22'
summary: Adds the ability to create reports programmatically through the API and the cht-datasource shared library, exposing a new report-creation path (domain module, remote HTTP adapter, controller, route) modeled on the existing person/place create flow.
services:
  - api
techStack:
  - typescript
  - javascript
  - nodejs
  - express
  - mocha
tags:
  - api
  - reports
  - report-creation
  - cht-datasource
  - rest-api
  - data-access
  - create-endpoint
related_workflows:
  - form-submission
  - contact-creation
source_pr: medic/cht-core#10099
source_sha: d19e4e5077f74e1e113b031c9eae8b61a41ae2f8
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - api/src/controllers/report.js
  - shared-libs/cht-datasource/src/report.ts
  - shared-libs/cht-datasource/src/remote/report.ts
  - shared-libs/cht-datasource/src/libs/parameter-validators.ts
  - api/src/routing.js
concepts:
  - cht-datasource public API
  - REST controller
  - remote data adapter
  - parameter validation
  - report creation
  - consistent CRUD pattern across entity modules
related_issues: []
stale: false
---

## Problem

The cht-datasource library and API supported creating persons and places but offered no programmatic way to create reports; consumers of the datasource/API had no report-creation operation or POST endpoint.

## Root Cause

Not a defect but a missing capability: the report module in cht-datasource exposed only read operations, there was no remote create implementation, and the API had no controller method or route for creating reports.

## Solution

Added a create operation to the report domain module (report.ts) backed by a remote adapter (remote/report.ts) that issues the HTTP POST, wired a corresponding API controller method (controllers/report.js) and route (routing.js), and added shared input validation in parameter-validators.ts. Person and place create paths were touched to share/align validation logic.

## Code Patterns

Follows the established cht-datasource entity pattern: domain module (report.ts) exposes create → delegates to remote adapter (remote/report.ts) for the HTTP POST → API controller (controllers/report.js) handles the request → route registered in routing.js → shared argument validation in libs/parameter-validators.ts. Mirrors the existing person.ts and place.ts implementations.

## Design Choices

Reused the existing person/place create architecture (domain module + remote adapter + controller + shared validators) for API and naming consistency across the datasource surface rather than a bespoke report-only path, and centralized validation in parameter-validators.ts to avoid duplication. The PR body's 'TODO: add tests' was resolved before merge — unit, datasource, and integration tests are included.

## Related Files

- api/src/controllers/person.js
- api/src/controllers/place.js
- api/src/controllers/report.js
- api/src/routing.js
- api/tests/mocha/controllers/person.spec.js
- api/tests/mocha/controllers/place.spec.js
- api/tests/mocha/controllers/report.spec.js
- shared-libs/cht-datasource/src/index.ts
- shared-libs/cht-datasource/src/libs/parameter-validators.ts
- shared-libs/cht-datasource/src/person.ts
- shared-libs/cht-datasource/src/place.ts
- shared-libs/cht-datasource/src/remote/report.ts
- shared-libs/cht-datasource/src/report.ts
- shared-libs/cht-datasource/test/index.spec.ts
- shared-libs/cht-datasource/test/person.spec.ts
- shared-libs/cht-datasource/test/place.spec.ts
- shared-libs/cht-datasource/test/remote/report.spec.ts
- tests/integration/api/controllers/report.spec.js
- tests/integration/shared-libs/cht-datasource/report.spec.js

## Testing

Added/updated Mocha unit tests for the API controllers (report, person, place spec files), cht-datasource unit tests (report, person, place, index, and remote/report specs), and end-to-end integration tests for both the API controller (tests/integration/api/controllers/report.spec.js) and the datasource library (tests/integration/shared-libs/cht-datasource/report.spec.js), covering the create path despite the initial 'TODO: add tests' note in the PR body.

## Related Issues

- #10040: Add cht-datasource / API support to create reports (parent feature issue)

## Domain Rationale

**Fit:** strong

The PR's core subject is the report entity and a new report-creation operation, which belongs squarely to forms-and-reports (a report is a submitted form). The delivery mechanism is the cht-datasource public API, giving it a secondary interoperability flavor, but per the entity-wins rule the functional domain is forms-and-reports.
