---
id: cht-core-10246
category: bug
domain: forms-and-reports
domainFit: strong
issueNumber: 10246
issueUrl: https://github.com/medic/cht-core/issues/10246
title: Fix missing reported_date on report updates by normalizing the update payload's reported_date to a unix epoch before validation in cht-datasource
lastUpdated: '2026-06-22'
summary: Updating a report via cht-datasource's local data source could drop `reported_date` because the update payload's value (e.g. a date/ISO string) did not match the original document's unix-epoch format during validation. The fix autoconverts the payload's `reported_date` to a unix epoch before the validation checks against the original document.
services:
  - api
  - webapp
techStack:
  - typescript
  - couchdb
  - pouchdb
tags:
  - reported_date
  - report-update
  - validation
  - data-integrity
  - unix-epoch
  - date-normalization
  - cht-datasource
related_workflows: []
source_pr: medic/cht-core#10246
source_sha: 46a0efef6a7a159fe264d0fdae54e9cdb53ce939
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - shared-libs/cht-datasource/src/local/libs/core.ts
concepts:
  - document update validation
  - timestamp normalization
  - data access layer
  - unix epoch conversion
  - payload-vs-original reconciliation
related_issues: []
stale: false
---

## Problem

When updating a report (document) through cht-datasource's local data source, the `reported_date` field could go missing after the update. The update payload could carry `reported_date` in a non-epoch form (date/ISO string) while the persisted document stores it as a unix epoch, so the validation comparing the payload against the original document failed to reconcile the two formats and the field was lost.

## Root Cause

In shared-libs/cht-datasource/src/local/libs/core.ts the update logic compared/validated the payload's `reported_date` directly against the original document's `reported_date` without normalizing formats. Because the payload's value could be in a different representation than the stored unix epoch, the validation step dropped the field rather than preserving it.

## Solution

Autoconvert the update payload's `reported_date` to a unix epoch before performing the validation checks against the original document, so both values are compared in the same canonical format and the field is preserved through the update.

## Code Patterns

Coerce timestamp fields (e.g. `reported_date`) to the canonical stored representation (unix epoch) before comparing or validating an incoming update payload against the persisted document — in shared-libs/cht-datasource/src/local/libs/core.ts.

## Design Choices

Normalizing the incoming payload to the canonical unix-epoch format (the stored representation) before validation was chosen over loosening the validation rules or persisting dates in mixed formats, keeping stored data consistent and avoiding comparisons across incompatible date representations.

## Related Files

- shared-libs/cht-datasource/src/local/libs/core.ts
- shared-libs/cht-datasource/test/libs/core.spec.ts
- shared-libs/cht-datasource/test/report.spec.ts

## Testing

Unit tests added/updated in shared-libs/cht-datasource/test/libs/core.spec.ts and shared-libs/cht-datasource/test/report.spec.ts to cover the reported_date conversion and confirm the field is preserved through report updates; the PR checklist marks unit testing as done.

## Related Issues

- #9835: Missing reported_date bug (the issue this PR fixes)
- #10083: PR introducing the cht-datasource update path where the reported_date regression was reported via review comment

## Domain Rationale

**Fit:** strong

The bug concerns the `reported_date` field on reports (the regression is exercised by report.spec.ts), and report data integrity is squarely forms-and-reports. The change lives in generic data-access plumbing (cht-datasource local core), so a reviewer could re-bin to data-sync as a data-layer internal, but per the 'closest functional domain' rule reports map most specifically to forms-and-reports.
