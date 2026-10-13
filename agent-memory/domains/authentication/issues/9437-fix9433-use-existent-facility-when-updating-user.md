---
id: cht-core-9433
category: bug
domain: authentication
domainFit: strong
issueNumber: 9433
issueUrl: https://github.com/medic/cht-core/issues/9433
title: Validate a new contact against the user's stored facility when a user update changes only the contact
lastUpdated: '2026-09-29'
summary: 'Since the 4.9.0 multi-facility change (PR #9126), updating only a user''s contact through /api/v1/users/{username} returned a 500, because `validateUserContact` mapped over `data.facility_id`, which is undefined when the payload has no `place`. The fix validates the new contact against the payload''s facility or, failing that, the facility stored on the user doc.'
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
related_issues:
  - cht-core-6543
stale: false
---

## Problem

Updating a user's contact without re-sending its place — a request to `/api/v1/users/{username}` with body `{"contact": "<contact_id>"}` — returned 500 Server Error. The issue reports it as a regression: the same request worked in 4.8.0 and failed in 4.9.0 and 4.10.0.

## Root Cause

Since PR #9126, `validateUserContact` in shared-libs/user-management/src/users.js checked the new contact with `data.facility_id.map(...)`. `hydratePayload` only sets `data.facility_id` from `data.place`, so when the payload had no `place` it was undefined and the `.map` threw, which surfaced as the 500. The check never looked at the facility already stored on the user doc.

## Solution

Added `validateNewContact`, which checks the contact against `forceArray(data.facility_id || user?.facility_id)` — the payload's facilities if a place was sent, otherwise the user doc's stored `facility_id` — and passes if the contact sits under any of them (`Promise.any` over `validateContact`). The new `forceArray` helper also covers a legacy string `facility_id` and replaces the inline `Array.isArray` checks in `getUsers`, `mapUser` and `getUserSettings`; the offline-role "contact required" branch moved into `validateContactForRoles`, which now reads `data.roles || user?.roles`.

## Code Patterns

Partial-update validation in shared-libs/user-management/src/users.js: when a request changes one field (the contact) whose validity depends on another (the facility), read the dependent value from the payload first and fall back to the merged user doc (`data.facility_id || user?.facility_id`) instead of assuming the caller resent it; normalize string-or-array fields once with `forceArray`.

## Design Choices

Validate against the already-associated facility rather than requiring every contact update to resend the place — before PR #9126 the check used the user doc's `facility_id`, so this restores contact-only updates; `forceArray` keeps users whose stored `facility_id` is still a string working.

## Related Files

- shared-libs/user-management/src/users.js
- shared-libs/user-management/test/unit/users.spec.js
- tests/integration/api/controllers/users.spec.js

## Testing

Both test files were modified, not added. The existing shared-libs/user-management/test/unit/users.spec.js gained a case (`should update contact on user and user settings`: a contact-only update keeps `facility_id: ['maine']` and writes the updated `contact_id` to both docs). The existing tests/integration/api/controllers/users.spec.js gained one (`should allow to only update the contact`: POST `/api/v1/users/{username}` with only `contact`, after which both the user-settings and `_users` docs carry the new `contact_id`).

## Related Issues

- #9433: "REST Endpoint `/api/v1/users/{{username}}` throwing Server error when updating `contact`" — this draft's issue
- #6543: "Allow for multiple places to be assigned to users" — its API PR #9126 introduced the `data.facility_id.map(...)` contact check this fixes

## Domain Rationale

**Fit:** strong

User account creation/update logic in shared-libs/user-management is canonically the authentication domain (user provisioning, roles, and their facility/contact associations); this PR fixes how a changed contact is validated against the user's facility during an update, not contact lookup or place configuration.
