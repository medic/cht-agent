---
id: cht-core-9098
category: bug
domain: contacts
domainFit: strong
issueNumber: 9098
issueUrl: https://github.com/medic/cht-core/issues/9098
title: Remove extra validation of ancestor places' primary contacts when creating a new place
lastUpdated: '2026-06-23'
summary: Creating a new place unnecessarily re-validated the primary contacts of ancestor (parent) places, which could block legitimate place creation. The fix removes that extra validation so ancestors' primary contacts are no longer checked during creation.
services:
  - api
techStack:
  - javascript
  - couchdb
  - nodejs
tags:
  - place-creation
  - validation
  - contact-hierarchy
  - primary-contact
  - ancestor-places
  - cherry-pick
related_workflows:
  - contact-creation
source_pr: medic/cht-core#9098
source_sha: 4b015a91a2e5d0a4c6798a1003e2df9981d50271
distilled_at: '2026-06-23'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - shared-libs/contacts/src/places.js
concepts:
  - place hierarchy
  - primary contact validation
  - ancestor/parent place resolution
  - place creation flow
related_issues: []
stale: false
---

## Problem

When creating a new place, the system performed extra validation on the primary contacts of the place's ancestors (parent places). This redundant validation was not needed for the create-place operation and could incorrectly block creation of a new place.

## Root Cause

The place creation code path in shared-libs/contacts/src/places.js validated the primary contacts of ancestor places in addition to the new place itself, applying validation that should not have been part of the new-place creation flow.

## Solution

Removed the extra validation logic for parent/ancestor place contacts in places.js so that primary contacts of ancestors are no longer validated when creating a new place. Unit and integration tests were updated to reflect the relaxed behavior. Backported via cherry-pick (from commit 6bb7f6963aad9454c22d6836f5c4c7cff33398b9) to the 4.7.x release branch.

## Code Patterns

Place creation/validation lives in shared-libs/contacts/src/places.js; scope validation to the entity being created rather than re-validating already-persisted ancestor documents.

## Design Choices

Chose to remove the ancestor primary-contact validation outright (rather than relax or conditionalize it) since validating already-existing parent places' contacts is not the responsibility of the new-place creation flow.

## Related Files

- shared-libs/contacts/src/places.js
- shared-libs/contacts/test/unit/places.spec.js
- tests/integration/api/controllers/places.spec.js

## Testing

Updated unit tests in shared-libs/contacts/test/unit/places.spec.js and integration tests in tests/integration/api/controllers/places.spec.js to verify ancestor primary contacts are no longer validated during place creation.

## Related Issues

- #8985: extra validation incorrectly applied to parent place contact during place creation
- #9027: original PR cherry-picked into this backport

## Domain Rationale

**Fit:** strong

Places are contact documents in the CHT hierarchy, and the change edits the place-creation validation logic in shared-libs/contacts/src/places.js — squarely contact management, not config, permissions, or sync.
