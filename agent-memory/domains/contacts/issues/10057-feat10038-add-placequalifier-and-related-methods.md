---
id: cht-core-10038
category: feature
domain: contacts
domainFit: strong
issueNumber: 10038
issueUrl: https://github.com/medic/cht-core/issues/10038
title: Add PlaceQualifier type and related validation methods to cht-datasource
lastUpdated: '2026-06-22'
summary: The cht-datasource shared library lacked a dedicated qualifier for identifying place contacts. This PR adds a PlaceQualifier type plus related validation/type-guard methods to qualifier.ts (WIP).
services:
  - api
  - webapp
techStack:
  - typescript
tags:
  - place-qualifier
  - cht-datasource
  - data-access
  - validation
  - type-guard
  - places
related_workflows: []
source_pr: medic/cht-core#10057
source_sha: e0ecefed49ee7dad905c6af9ee243f5fbff2ab03
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - shared-libs/cht-datasource/src/qualifier.ts
concepts:
  - qualifier pattern
  - type guards / runtime validation
  - data access layer
  - place contacts
related_issues: []
stale: false
---

## Problem

The cht-datasource data-access library provided qualifiers for other entity types but had no dedicated PlaceQualifier, so callers could not cleanly qualify/identify place contacts or validate place-specific identifiers through the unified datasource API.

## Root Cause

Not a defect — a capability gap: the qualifier surface in shared-libs/cht-datasource/src/qualifier.ts did not yet model places, leaving the place-contact data-access API incomplete.

## Solution

Added a PlaceQualifier type/interface and related methods (construction plus validation/type-guard helpers) to qualifier.ts, following the library's existing qualifier conventions. Landed as a WIP step toward issue #10038.

## Code Patterns

Follows the established qualifier convention in shared-libs/cht-datasource/src/qualifier.ts (typed qualifier + isXxxQualifier-style validation/type guard), mirroring existing qualifiers (e.g. UUID/contact-type qualifiers) for consistency across the datasource API.

## Design Choices

Reuses the existing qualifier abstraction and validation/type-guard idioms already present in cht-datasource rather than introducing a new shape, keeping the data-access surface uniform across entity types.

## Related Files

- shared-libs/cht-datasource/src/qualifier.ts
- shared-libs/cht-datasource/test/qualifier.spec.ts

## Testing

Unit tests for qualifier behavior in shared-libs/cht-datasource/test/qualifier.spec.ts. Reviewer (apoorvapendse) noted that additional/missing coverage for qualifier.ts was added separately in PR #10056, so it was intentionally skipped here.

## Related Issues

- #10038: parent issue — add PlaceQualifier and related validations
- #10056: companion PR adding the missing test coverage for qualifier.ts

## Domain Rationale

**Fit:** strong

Places are a first-class contact type in the CHT contact hierarchy (districts, health facilities, etc.), and a PlaceQualifier is the abstraction used to identify/look up place contacts in the data-access layer — squarely contact lookup/management tooling.
