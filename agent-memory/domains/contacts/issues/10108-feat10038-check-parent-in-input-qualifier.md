---
id: cht-core-10038
category: improvement
domain: contacts
domainFit: strong
issueNumber: 10038
issueUrl: https://github.com/medic/cht-core/issues/10038
title: Add parent field validation to the place input qualifier in cht-datasource local provider
lastUpdated: '2026-06-22'
summary: The local place data access in cht-datasource did not validate the `parent` field when qualifying a place document. This PR adds parent-field checks to the place input qualifier with accompanying unit tests.
services:
  - api
  - webapp
techStack:
  - typescript
  - couchdb
tags:
  - place
  - parent-validation
  - input-qualifier
  - cht-datasource
  - contact-hierarchy
  - data-validation
related_workflows: []
source_pr: medic/cht-core#10108
source_sha: 54e907681c1e759947ead6b8e01b0a505f6c01cc
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - shared-libs/cht-datasource/src/local/place.ts
concepts:
  - input qualifier validation
  - place document validation
  - contact hierarchy / parent reference
  - cht-datasource local provider
related_issues: []
stale: false
---

## Problem

The place input qualifier in the cht-datasource local provider did not verify the `parent` field of a place document, so places could be qualified/validated without confirming a valid parent reference in the contact hierarchy. Tracked under issue #10038.

## Root Cause

The validation logic for place documents in shared-libs/cht-datasource/src/local/place.ts omitted a check on the `parent` field, leaving that portion of the place's hierarchy data unvalidated in the input qualifier.

## Solution

Extended the place input qualifier in local/place.ts to add checks for the `parent` field, and updated the unit tests in place.spec.ts to cover the new parent validation behavior.

## Code Patterns

Field validation within the local place provider's input qualifier — extend the existing qualifier validation in shared-libs/cht-datasource/src/local/place.ts to assert the `parent` field, mirrored by unit tests in test/local/place.spec.ts.

## Design Choices

Validation is enforced at the cht-datasource local provider layer (input qualifier) so place hierarchy integrity is checked where place documents are accessed, rather than relying on each call site to validate the parent reference.

## Related Files

- shared-libs/cht-datasource/src/local/place.ts
- shared-libs/cht-datasource/test/local/place.spec.ts

## Testing

Unit tests added/updated in shared-libs/cht-datasource/test/local/place.spec.ts to cover the new parent-field checks; the PR checklist marks unit/e2e testing as complete.

## Related Issues

- #10038: parent tracking issue for validating place fields (including the parent reference) in cht-datasource

## Domain Rationale

**Fit:** strong

Places are contacts in the CHT hierarchy, and this change validates the `parent` field of place documents in the cht-datasource place module — squarely contact-data territory. The 'local' provider here is about data access/validation for place contacts (not sync/replication or storage-engine internals), so contacts is a strong fit.
