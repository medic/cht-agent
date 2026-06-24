---
id: cht-core-10222
category: improvement
domain: authentication
domainFit: strong
issueNumber: 10222
issueUrl: https://github.com/medic/cht-core/issues/10222
title: Update create/update permission checks for person, place, and report API controllers to honor the general can_edit permission
lastUpdated: '2026-06-22'
summary: The API's create/update endpoints for people, places, and reports were checking for entity-specific permissions, but the intended model is that the general can_edit permission should govern those operations. This PR updates auth.js and the three controllers so create/update consistently authorize against can_edit.
services:
  - api
techStack:
  - javascript
  - nodejs
  - express
tags:
  - permissions
  - authorization
  - can_edit
  - access-control
  - api-controllers
related_workflows:
  - contact-creation
  - form-submission
source_pr: medic/cht-core#10222
source_sha: 8c92517ece2c61d416e5def7a0b9725e1ccda869
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - api/src/auth.js
  - api/src/controllers/person.js
  - api/src/controllers/place.js
  - api/src/controllers/report.js
concepts:
  - permission checks
  - role-based access control
  - general vs granular permissions
  - session permission evaluation
related_issues: []
stale: false
---

## Problem

Create/update operations on people, places, and reports applied inconsistent or overly-specific permission checks in the API controllers, rather than uniformly authorizing against the general can_edit permission that a user holds in their session. This raised the question (per the linked forum thread) of whether dedicated per-entity permissions like can_update_people were even needed.

## Root Cause

The person, place, and report controllers each performed their own create/update permission gating without a consistent, centralized check, so the authorization behavior diverged from the intended model where can_edit governs editing of any place/person/report.

## Solution

Centralized/aligned the create/update permission logic in api/src/auth.js and updated the person, place, and report controllers to check the appropriate (can_edit) permission before allowing create/update, with corresponding unit-test updates in the mocha controller specs.

## Code Patterns

Controllers delegate create/update authorization to a shared helper in api/src/auth.js rather than each implementing its own permission check, keeping permission gating consistent across person.js, place.js, and report.js.

## Design Choices

Chose to rely on the existing general can_edit permission for create/update rather than introducing new granular per-entity permissions (e.g. can_update_people / can_create_people), keeping the permission model simpler — as concluded in the linked forum discussion (#9835).

## Related Files

- api/src/auth.js
- api/src/controllers/person.js
- api/src/controllers/place.js
- api/src/controllers/report.js
- api/tests/mocha/controllers/person.spec.js
- api/tests/mocha/controllers/place.spec.js
- api/tests/mocha/controllers/report.spec.js

## Testing

Updated mocha unit tests for the person, place, and report controllers (api/tests/mocha/controllers/person.spec.js, place.spec.js, report.spec.js) to assert the new create/update permission-check behavior.

## Related Issues

- #9835: Reconsider whether dedicated create/update (e.g. can_update_people) permissions are needed, or whether the general can_edit permission should govern create/update of people, places, and reports

## Domain Rationale

**Fit:** strong

The PR is entirely about authorization — how create/update permission checks are evaluated against a user's session permissions (e.g. can_edit). Per CHT classification rules, roles/permissions work belongs to authentication even though the affected entities are contacts (person/place) and reports.
