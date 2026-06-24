---
id: cht-core-10043
category: feature
domain: contacts
domainFit: strong
issueNumber: 10043
issueUrl: https://github.com/medic/cht-core/issues/10043
title: Add PersonQualifier and related functions to cht-datasource to enable person document creation
lastUpdated: '2026-06-22'
summary: The cht-datasource library lacked a qualifier abstraction for person documents, which is a prerequisite for creating persons via the datasource. This PR adds a `PersonQualifier` type plus related helper/guard functions and unit tests as groundwork for person-creation support.
services:
  - api
  - webapp
techStack:
  - typescript
tags:
  - person-qualifier
  - cht-datasource
  - qualifier
  - data-access
  - person
  - contacts
related_workflows:
  - contact-creation
source_pr: medic/cht-core#10043
source_sha: c734c65d858e5ced94a0e7d7c7f24d729fad818c
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - shared-libs/cht-datasource/src/qualifier.ts
concepts:
  - qualifier abstraction
  - data source access layer
  - type guards
  - document identification
related_issues: []
stale: false
---

## Problem

The cht-datasource library had no `PersonQualifier` or supporting functions to identify and validate person documents, blocking the planned ability to create `person` documents through the datasource API.

## Root Cause

Person documents lacked a dedicated qualifier type in cht-datasource's qualifier module; without it there was no consistent, type-safe way to qualify person inputs for downstream create operations.

## Solution

Added a `PersonQualifier` type and related functions (e.g. construction and guard/validation helpers) to qualifier.ts following the existing qualifier pattern, with accompanying unit tests, as a WIP step toward supporting person document creation.

## Code Patterns

Follows the established qualifier pattern in shared-libs/cht-datasource/src/qualifier.ts (type definition plus factory and type-guard functions) used by other qualifiers, keeping person qualification consistent with existing datasource abstractions.

## Design Choices

Reused the existing qualifier abstraction in cht-datasource rather than introducing a bespoke validation path, ensuring consistency with other document qualifiers and a clean foundation for incremental person-creation work.

## Related Files

- shared-libs/cht-datasource/src/qualifier.ts
- shared-libs/cht-datasource/test/qualifier.spec.ts

## Testing

Unit tests added in shared-libs/cht-datasource/test/qualifier.spec.ts covering the new PersonQualifier and related functions.

## Related Issues

- #10036: integrate PersonQualifier to add support for creating person documents

## Domain Rationale

**Fit:** strong

The PR adds a `PersonQualifier` to the cht-datasource data-access library; person documents are a core CHT contact type, so identifying/qualifying persons squarely belongs to the contacts domain rather than a generic data-layer bucket.
