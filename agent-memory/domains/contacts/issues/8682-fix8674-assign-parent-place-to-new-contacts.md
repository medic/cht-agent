---
id: cht-core-8674
category: bug
domain: contacts
domainFit: strong
issueNumber: 8674
issueUrl: https://github.com/medic/cht-core/issues/8674
title: Assign parent place to contacts created via the places API
lastUpdated: '2026-08-12'
summary: Contacts created through the places API were not assigned a parent place, causing a 'The contact must be a child of the place' error when subsequently creating a user for that contact. The fix assigns the parent place to new contacts in the contacts shared library.
services:
  - api
techStack:
  - javascript
  - couchdb
tags:
  - parent-place
  - contact-creation
  - places-api
  - contact-hierarchy
  - user-creation
related_workflows:
  - contact-creation
  - user-registration
source_pr: medic/cht-core#8682
source_sha: 6dec6344c60ca3c36ea267a475336a797a8b4172
distilled_at: '2026-06-23'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - shared-libs/contacts/src/people.js
  - shared-libs/contacts/src/places.js
concepts:
  - contact hierarchy
  - parent-child place relationship
  - parent place assignment on contact creation
  - contact-to-user linkage
related_issues: []
stale: false
---

## Problem

Contacts created via the places API (POST /api/v1/places) were created without a parent place. Because the contact had no parent in the hierarchy, attempting to create a user for that new contact failed with the error 'The contact must be a child of the place'.

## Root Cause

`createPlace` in shared-libs/contacts/src/places.js created the person before the place document existed — it called `people.getOrCreatePerson(place.contact)` and only then `db.medic.post(place)` — so there was no place UUID available to set as the person's parent, leaving the contact detached from the place hierarchy.

## Solution

Reordered `createPlace` so the place is posted first, then `contact.place` is set to the new UUID before `people.getOrCreatePerson` runs, and finally `updatePlace` links the place back to the created person — ensuring the new contact is a valid child of its place. The response also gained the contact id (`{ ...result, contact: { id: person._id } }`), which issue #8674 had asked for. The reorder is entirely within shared-libs/contacts/src/places.js; shared-libs/contacts/src/people.js changes by exactly one line — `module.exports._getDefaultPersonType = getDefaultPersonType;` — so that places.js can default the contact's type before validation. Unit and integration test coverage accompanies both.

## Code Patterns

Assign the parent place reference to a contact at the contact-creation layer in shared-libs/contacts/src/places.js (`createPlace`), rather than patching it in the API controller, so the hierarchy invariant holds for all callers; shared-libs/contacts/src/people.js only exposes `_getDefaultPersonType` so places.js can default the contact's type before validation.

## Design Choices

The fix was applied in the shared contacts library (the common contact/place creation path) instead of only in the places API controller, so the parent-place invariant is enforced consistently for any consumer of the library rather than per-endpoint.

## Related Files

- shared-libs/contacts/src/people.js
- shared-libs/contacts/src/places.js
- shared-libs/contacts/test/unit/places.spec.js
- tests/integration/api/controllers/places.spec.js
- api/tests/integration/migrations/extract-person-contacts.spec.js

## Testing

Updated the unit spec shared-libs/contacts/test/unit/places.spec.js and added a new integration spec tests/integration/api/controllers/places.spec.js; updated the extract-person-contacts migration integration spec.

## Related Issues

- #8674: Contacts created via the places API are not assigned a parent place, causing user creation to fail with 'The contact must be a child of the place'

## Domain Rationale

**Fit:** strong

The fix lives in the contacts shared library and concerns how new contacts are placed in the contact hierarchy (parent place assignment) when created via the places API; contact creation and hierarchy are core to the contacts domain. The user-creation error is only a downstream symptom, not the root cause.
