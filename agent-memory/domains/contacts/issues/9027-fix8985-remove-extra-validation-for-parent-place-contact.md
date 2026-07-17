---
id: cht-core-8985
category: bug
domain: contacts
domainFit: strong
issueNumber: 8985
issueUrl: https://github.com/medic/cht-core/issues/8985
title: Remove extra validation of parent place contact so creating a person via the people API no longer fails
lastUpdated: '2026-07-16'
summary: Creating a person via POST api/v1/people failed with 'Wrong type, this is not a person.' when the place hierarchy contained a place without a primary contact (a regression from 4.4 to 4.6). The fix removes the overly strict validation of the parent place's contact.
services:
  - api
techStack:
  - javascript
  - nodejs
  - couchdb
  - mocha
tags:
  - contacts
  - places
  - people-api
  - validation
  - place-hierarchy
  - primary-contact
  - regression
related_workflows:
  - contact-creation
source_pr: medic/cht-core#9027
source_prs:
  - "medic/cht-core#9027"
  - "medic/cht-core#9098"
source_sha: 6bb7f6963aad9454c22d6836f5c4c7cff33398b9
distilled_at: '2026-06-23'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - shared-libs/contacts/src/places.js
concepts:
  - place hierarchy validation
  - contact type validation
  - parent place primary contact
  - people creation API
related_issues: []
stale: false
---

## Problem

Using POST api/v1/people to create a person inside a parent place failed with the error 'Wrong type, this is not a person.' whenever the surrounding hierarchy included a place lacking a primary contact (e.g. a grandparent place with no primary contact). This worked in 4.4 but regressed in 4.6, and the error gave no UUID of the offending contact or place, making it hard to diagnose.

## Root Cause

The place-validation logic in shared-libs/contacts/src/places.js performed extra validation on the parent place's contact during person creation, effectively requiring the parent place's primary contact to satisfy a 'person' type check. When an ancestor place had no (or a non-person) primary contact, this transitive validation incorrectly rejected the request.

## Solution

Removed the extra validation of the parent place contact in shared-libs/contacts/src/places.js so that person creation no longer hinges on the parent/ancestor place's primary contact, restoring the pre-regression (4.4) behavior. Backported to the 4.7.x release branch via cherry-pick (PR #9098).

## Code Patterns

When validating a newly created entity (here, a person within a place), validate only the entity being created and its direct constraints — do not transitively re-validate ancestor places' primary contacts. Removing unnecessary cross-entity validation in shared-libs/contacts/src/places.js avoids coupling person creation to unrelated hierarchy state.

## Design Choices

The fix removes the validation rather than patching it, since the type of a parent place's primary contact is irrelevant to whether a person can be created under that place. Additional e2e coverage was noted as a follow-up.

## Related Files

- shared-libs/contacts/src/places.js
- shared-libs/contacts/test/unit/places.spec.js
- tests/integration/api/controllers/places.spec.js

## Testing

Updated unit tests in shared-libs/contacts/test/unit/places.spec.js and integration tests in tests/integration/api/controllers/places.spec.js to cover creating a person under a parent place whose hierarchy lacks a primary contact. Reviewer noted more e2e tests could be added later to further assess behavior.

## Related Issues

- #8985: POST api/v1/people returns 'Wrong type, this is not a person.' when creating a person under a parent place whose hierarchy includes a place with no primary contact (regression from 4.4 to 4.6)

## Domain Rationale

**Fit:** strong

The PR fixes a bug in the contacts shared library (shared-libs/contacts/src/places.js) governing creation of a person (a contact type) within a parent place via the people API. Creating and validating places/people is squarely the contacts domain; this is not a permissions or sync issue.
