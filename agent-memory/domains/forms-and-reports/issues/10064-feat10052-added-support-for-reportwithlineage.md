---
id: cht-core-10052
category: feature
domain: forms-and-reports
domainFit: strong
issueNumber: 10052
issueUrl: https://github.com/medic/cht-core/issues/10052
title: Add ReportWithLineage support to fetch reports with fully hydrated contact lineage via cht-datasource and REST API
lastUpdated: '2026-08-11'
summary: Report retrieval via cht-datasource and the REST API only returned the minified (dehydrated) contact lineage. This PR adds ReportWithLineage methods and interfaces to fetch a report with its full contact lineage hydrated, mirroring the existing PersonWithLineage/PlaceWithLineage pattern.
services:
  - api
  - webapp
techStack:
  - typescript
  - javascript
  - couchdb
  - angular
tags:
  - report-lineage
  - cht-datasource
  - hydration
  - rest-api
  - lineage
  - with-lineage
related_workflows: []
source_pr: medic/cht-core#10064
source_sha: 6ccbb7464566321dd2388858258eceddf86e6c25
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - shared-libs/cht-datasource/src/report.ts
  - shared-libs/cht-datasource/src/local/report.ts
  - shared-libs/cht-datasource/src/remote/report.ts
  - shared-libs/cht-datasource/src/local/libs/lineage.ts
  - shared-libs/lineage/src/index.d.ts
  - api/src/controllers/report.js
concepts:
  - lineage hydration/dehydration
  - contact lineage resolution
  - cht-datasource local vs remote abstraction
  - report retrieval API
  - WithLineage interface pattern
related_issues: []
stale: false
---

## Problem

When retrieving a report doc through cht-datasource or the REST API (GET /api/v1/report/:uuid), the response only included minified (dehydrated) data about the report's contact lineage. Consumers had no way to get a report with its full parent contact hierarchy hydrated, unlike the existing PersonWithLineage/PlaceWithLineage capabilities.

## Root Cause

The Report.v1 datasource interface and the report retrieval code paths (local, remote, and the API controller) only returned the raw report doc with dehydrated contact references; no method existed to hydrate the report's contact lineage.

## Solution

Added ReportWithLineage support across the stack: new methods/interfaces in cht-datasource (src/report.ts, src/local/report.ts, src/remote/report.ts) to fetch a report with its contact lineage hydrated, backed by lineage resolution helpers in src/local/libs/lineage.ts. The API controller (api/src/controllers/report.js) was updated to return the report with lineage when the `with_lineage` query param is set, which is what the remote adapter calls.

The only file this PR *added* is `shared-libs/lineage/src/index.d.ts` — type declarations for the previously untyped `@medic/lineage` package. That addition is also the whole reason the two webapp files appear in the diff: `lineage-model-generator.service.ts` and the delete-doc-confirm modal were switched from `import * as LineageFactory from '@medic/lineage'` to a default import `import LineageFactory from '@medic/lineage'`. Neither webapp file consumes ReportWithLineage; the change is import-syntax fallout from the new declarations, nothing more.

## Code Patterns

Mirrors the established PersonWithLineage/PlaceWithLineage pattern — `Report.v1.getWithLineage` exposed through the datasource index (shared-libs/cht-datasource/src/index.ts), adapting between a local implementation that hydrates via shared-libs/lineage and a remote one that delegates to the REST endpoint, in src/local/report.ts and src/remote/report.ts respectively.

## Design Choices

Followed the existing WithLineage conventions for Person/Place to keep the cht-datasource API consistent and predictable, and preserved the local-vs-remote implementation split inherent to the datasource architecture rather than introducing a new bespoke retrieval shape.

## Related Files

- api/src/controllers/report.js
- shared-libs/cht-datasource/src/index.ts
- shared-libs/cht-datasource/src/report.ts
- shared-libs/cht-datasource/src/local/report.ts
- shared-libs/cht-datasource/src/remote/report.ts
- shared-libs/cht-datasource/src/local/libs/lineage.ts
- shared-libs/lineage/src/index.d.ts
- webapp/src/ts/services/lineage-model-generator.service.ts
- webapp/src/ts/modals/delete-doc-confirm/delete-doc-confirm.component.ts

## Testing

Updated unit tests in cht-datasource (test/report.spec.ts, test/local/report.spec.ts, test/remote/report.spec.ts, test/local/libs/lineage.spec.ts, test/index.spec.ts) and API controller mocha tests (api/tests/mocha/controllers/report.spec.js). Extended the existing integration tests (tests/integration/api/controllers/report.spec.js, tests/integration/shared-libs/cht-datasource/report.spec.js) and the pre-existing generic-report test factory (tests/factories/cht/reports/generic-report.js), which dates back to #7427 — no test file was created by this PR.

## Related Issues

- #10052: Improve report retrieval to include hydrated contact lineage (ReportWithLineage), matching PersonWithLineage/PlaceWithLineage

## Domain Rationale

**Fit:** strong

The PR's primary entity is the report — it adds a way to fetch a report doc enriched with its contact lineage via cht-datasource and the REST API. Reports are canonically forms-and-reports; the lineage (contact hierarchy) is the enrichment, not the subject.

Its files are entirely `shared-libs/cht-datasource`, so this is library extension rather than consumption, and review on #122 asked for `data-access` as the primary domain with `secondaryDomains: [forms-and-reports]`. That re-key is deliberately not made here — neither the enum value nor the field exists in the schema yet, and the recommendation on that same PR is to ship both as one coordinated taxonomy change rather than through a content PR. Same for the sibling extenders `10071` and `10180`.
