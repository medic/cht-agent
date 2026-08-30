---
id: cht-core-9433
category: bug
domain: authentication
domainFit: strong
issueNumber: 9433
issueUrl: https://github.com/medic/cht-core/issues/9433
title: Use the user's existing facility when updating a user instead of requiring/re-deriving it
lastUpdated: '2026-06-23'
summary: Updating an existing user could fail or behave incorrectly because the update path did not fall back to the facility already stored on the user. The fix makes user updates reuse the existent facility when one is not explicitly supplied.
services:
  - api
techStack:
  - javascript
  - nodejs
  - couchdb
tags:
  - user-management
  - user-update
  - facility
  - validation
  - bug-fix
related_workflows:
  - user-registration
source_pr: medic/cht-core#9437
source_sha: 7844242f64bd619e2b09b4c7c69a500c6486c896
distilled_at: '2026-06-23'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - shared-libs/user-management/src/users.js
concepts:
  - user account management
  - facility/place association
  - partial-update field resolution
  - user update validation
related_issues: []
stale: false
---

## Problem

When updating an existing user, the user-management logic did not use the facility already persisted on the user document. If a facility was not re-supplied in the update payload (or was resolved against a missing/incorrect value), the update would fail or produce an inconsistent user record.

## Root Cause

The user-update code path in shared-libs/user-management/src/users.js did not fall back to the user's existing (stored) facility when resolving/validating the facility for the update, treating the field as if it always needed to be provided or re-derived rather than reusing the existent one.

## Solution

Update the user-management update logic to read and reuse the existent facility from the stored user document when one is not explicitly provided in the update, so the existing facility association is preserved and validated correctly.

## Code Patterns

Partial-update resolution pattern in shared-libs/user-management/src/users.js: when handling an update, fall back to the value persisted on the existing document (here, the facility) for fields absent from the update payload rather than requiring callers to resupply them.

## Design Choices

Preserve and reuse the already-associated facility on update rather than forcing every update request to include a facility or rejecting updates that omit it, keeping user edits backward compatible with existing data.

## Related Files

- shared-libs/user-management/src/users.js
- shared-libs/user-management/test/unit/users.spec.js
- tests/integration/api/controllers/users.spec.js

## Testing

Added/updated unit tests in shared-libs/user-management/test/unit/users.spec.js covering the update path using the existing facility, plus integration coverage in tests/integration/api/controllers/users.spec.js exercising the API user-update controller end to end.

## Related Issues

- #9433: user update should use the existing facility instead of failing/requiring it

## Domain Rationale

**Fit:** strong

User account creation/update logic in shared-libs/user-management is canonically the authentication domain (user provisioning, roles, and their facility/contact associations); this PR fixes how a user's facility association is resolved during an update, not contact lookup or place configuration.
