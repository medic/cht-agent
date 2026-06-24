---
id: cht-core-10071
category: feature
domain: forms-and-reports
domainFit: strong
issueNumber: 10071
issueUrl: https://github.com/medic/cht-core/issues/10071
title: Add createReport support to the cht-datasource local adapter
lastUpdated: '2026-06-22'
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
related_issues: []
stale: false
---

## Problem

The cht-datasource local data context lacked a `createReport` implementation. Consumers operating against the local (direct-database/PouchDB) adapter could not create report documents through the datasource abstraction, leaving the local context behind the intended create capability.

## Root Cause

The local report adapter in cht-datasource implemented read operations but had no `createReport`, and the qualifier module lacked the supporting qualification needed to back the create operation in the local context.

## Solution

Added a `createReport` implementation to shared-libs/cht-datasource/src/local/report.ts following the existing local-adapter structure, with accompanying changes in shared-libs/cht-datasource/src/qualifier.ts to support the operation. Unit tests were added/updated in test/local/report.spec.ts and test/local/person.spec.ts.

## Code Patterns

Local adapter create-operation pattern in cht-datasource: implement the operation in src/local/<entity>.ts mirroring the datasource abstraction, leaning on qualifiers from src/qualifier.ts for input identification/validation. Establishes the template for adding further local create operations and keeping local/remote contexts at parity.

## Design Choices

Implements createReport in the local adapter to keep the local data context aligned with the datasource abstraction's create operations (parity with the remote context), delivered as incremental work toward the broader createReport feature (#10038).

## Related Files

- shared-libs/cht-datasource/src/local/report.ts
- shared-libs/cht-datasource/src/qualifier.ts
- shared-libs/cht-datasource/test/local/report.spec.ts
- shared-libs/cht-datasource/test/local/person.spec.ts

## Testing

Added and updated unit specs (shared-libs/cht-datasource/test/local/report.spec.ts and test/local/person.spec.ts) to cover the new local createReport behavior; the PR checklist marks unit testing as complete.

## Related Issues

- #10040: issue implemented by this PR — add local support for createReport
- #10038: broader createReport feature this PR works toward

## Domain Rationale

**Fit:** strong

The PR adds a `createReport` operation to the cht-datasource local adapter; reports are the core entity being created, which is squarely the forms-and-reports domain. The 'local adapter' framing touches offline/data access, but the functionality is report creation, not sync mechanics, so it stays in the closest functional domain.
