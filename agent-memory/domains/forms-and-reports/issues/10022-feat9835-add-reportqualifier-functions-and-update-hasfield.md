---
id: cht-core-10022
category: feature
domain: forms-and-reports
domainFit: strong
issueNumber: 10022
issueUrl: https://github.com/medic/cht-core/issues/10022
title: Add ReportQualifier functions to cht-datasource and add optional truthy check to hasField/hasFields
lastUpdated: '2026-06-22'
summary: cht-datasource had no ReportQualifier and its field-presence helpers accepted empty-string values as valid. This PR adds ReportQualifier (with an error for non-object data) and an optional truthy check to hasField/hasFields so contact and report qualifiers reject empty/falsy field values.
services:
  - api
  - webapp
techStack:
  - typescript
tags:
  - report-qualifier
  - qualifier
  - type-guard
  - input-validation
  - cht-datasource
related_workflows: []
source_pr: medic/cht-core#10022
source_sha: 57c5056c8a39bf10aff648c09d5712b45e2552d1
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - shared-libs/cht-datasource/src/qualifier.ts
  - shared-libs/cht-datasource/src/libs/core.ts
  - ReportQualifier
  - isReportQualifier
  - isContactQualifier
  - hasField
  - hasFields
concepts:
  - type guards
  - data-access qualifiers
  - runtime input validation
  - shared data-access library
related_issues: []
stale: false
---

## Problem

The cht-datasource library exposed contact qualifiers but had no ReportQualifier to construct or validate report identifiers by their data. Separately, the hasField/hasFields helpers only verified that a property existed, so qualifier type guards treated empty-string field values as valid.

## Root Cause

qualifier.ts provided a ContactQualifier path with no report equivalent, and core.ts's hasField/hasFields checked only for key presence (not value truthiness), allowing empty strings to pass qualifier validation.

## Solution

Commit 1 adds ReportQualifier construction plus the isReportQualifier type guard, throwing an explicit error when the supplied data is not a valid object. Commit 2 adds an optional truthy-check parameter to hasField/hasFields and applies it within isContactQualifier and isReportQualifier so empty-string (falsy) field values now return false.

## Code Patterns

hasField/hasFields in shared-libs/cht-datasource/src/libs/core.ts gained an opt-in truthy-check flag, letting type guards centrally reject falsy/empty values instead of duplicating empty-string checks in each guard; consumed by the qualifier guards in shared-libs/cht-datasource/src/qualifier.ts.

## Design Choices

Extending the shared hasField/hasFields helpers with an optional truthy check keeps value validation centralized and reusable across qualifiers rather than scattering per-guard empty-string checks; throwing an explicit error for non-object data surfaces misuse clearly instead of silently returning false.

## Related Files

- shared-libs/cht-datasource/src/qualifier.ts
- shared-libs/cht-datasource/src/libs/core.ts
- shared-libs/cht-datasource/test/qualifier.spec.ts

## Testing

Unit tests in shared-libs/cht-datasource/test/qualifier.spec.ts were added/updated to cover ReportQualifier (including the non-object-data error case) and the new empty-string/truthy behavior of hasField/hasFields exercised through isContactQualifier and isReportQualifier.

## Related Issues

- #9835: Define and add ReportQualifier to the cht-datasource data-access library

## Domain Rationale

**Fit:** strong

The PR adds a ReportQualifier (and tightens validation) for identifying reports in the cht-datasource data-access library; reports are the canonical forms-and-reports entity, so this is a direct functional fit rather than a generic data-layer change.
