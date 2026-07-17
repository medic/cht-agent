---
id: cht-core-10041
category: feature
domain: forms-and-reports
domainFit: strong
issueNumber: 10041
issueUrl: https://github.com/medic/cht-core/issues/10041
title: Add local datasource implementation for updating reports in cht-datasource
lastUpdated: '2026-06-22'
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
source_sha: 70b7be0b4f0394b22f7d24b5fd1b824fdef0aa87
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - shared-libs/cht-datasource/src/local/report.ts
concepts:
  - datasource abstraction layer
  - local vs remote implementation split
  - report document update
  - offline-first data access
  - data context binding
related_issues: []
stale: false
---

## Problem

The cht-datasource report module exposed read (and other) operations but had no local implementation for updating a report, meaning report documents could not be updated through the local/offline data-access path provided by the library.

## Root Cause

The local report module in cht-datasource only implemented a subset of CRUD operations and did not include an update function, so the unified datasource API was incomplete for the report entity on the local (direct-DB) code path.

## Solution

Added an update operation to the local report implementation (shared-libs/cht-datasource/src/local/report.ts) that persists changes to a report document via the local data context, following the established cht-datasource local-implementation conventions, and added corresponding unit tests.

## Code Patterns

Follows the cht-datasource local-implementation pattern in shared-libs/cht-datasource/src/local/report.ts: a factory/curried function that takes a local data context (database binding) and returns the operation function, mirroring the structure used by other entity modules (contact/person/place). The update operation writes the report doc through the local DB binding rather than via an HTTP/remote call.

## Design Choices

Mirrors the library's existing local/remote split — the local implementation performs direct database writes while the remote implementation calls the API — keeping report operations consistent with the established datasource module structure and completing the report entity's local API surface incrementally.

## Related Files

- shared-libs/cht-datasource/src/local/report.ts
- shared-libs/cht-datasource/test/local/report.spec.ts

## Testing

Added unit tests in shared-libs/cht-datasource/test/local/report.spec.ts covering the new local report update operation, mocking the data context/database to verify the report document is persisted and edge/error cases are handled; the PR checklist marks unit testing as completed.

## Related Issues

- #10041: umbrella issue for report update support in cht-datasource (this PR adds the local implementation portion)

## Domain Rationale

**Fit:** strong

The PR adds report-update functionality to the cht-datasource library, and reports are squarely the forms-and-reports domain. Although it lives in the data-access layer, it concerns the report entity specifically (not a cross-cutting storage concern like ID generation), so forms-and-reports is the most specific home rather than data-sync.
