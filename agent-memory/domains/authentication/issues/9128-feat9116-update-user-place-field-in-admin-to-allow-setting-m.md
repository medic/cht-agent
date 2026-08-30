---
id: cht-core-9116
category: feature
domain: authentication
domainFit: strong
issueNumber: 9116
issueUrl: https://github.com/medic/cht-core/issues/9116
title: Allow assigning multiple places to a user in the Admin app via a multiselect place field gated by can_have_multiple_places
lastUpdated: '2026-06-23'
summary: The Admin app could only associate a user with a single facility despite backend support for multi-facility users (#6543). This PR converts the user place field to a multiselect, enabled when a selected role grants `can_have_multiple_places`, and validates hierarchy level and parentage of the chosen places.
services:
  - admin
  - webapp
  - api
techStack:
  - javascript
  - typescript
  - angularjs
  - angular
  - select2
tags:
  - user-management
  - multiple-places
  - can_have_multiple_places
  - roles
  - permissions
  - multiselect
  - facility-association
  - admin-app
related_workflows:
  - user-registration
source_pr: medic/cht-core#9128
source_sha: c7fbcb1b88129d9df4ca1cedf1d2a599803acd10
distilled_at: '2026-06-23'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - admin/src/js/controllers/edit-user.js
  - admin/src/js/services/create-user.js
  - admin/src/js/services/select2-search.js
  - admin/src/js/services/contact-types.js
  - admin/src/templates/edit_user.html
  - shared-libs/contact-types-utils/src/index.js
  - webapp/src/ts/modules/contacts/contacts.component.ts
  - webapp/src/ts/modules/contacts/contacts-more-menu.component.ts
concepts:
  - user-place association
  - role-based permissions
  - contact hierarchy validation
  - multiselect form input
  - user management in admin app
related_issues: []
stale: false
---

## Problem

The CHT Admin app modeled a user's facility as a single-value field, so even after backend support landed for users belonging to multiple facilities (#6543), admins had no way to associate more than one place with a user. This blocked configuring supervisors/CHAs who oversee multiple areas.

## Root Cause

The edit-user controller and edit_user.html template bound the user's place to a single-value select2 field, and the create-user/update-user services and validation assumed exactly one place per user. The admin UI had no concept of the `can_have_multiple_places` role flag.

## Solution

Converted the place field to a multiselect select2 dropdown that is enabled when at least one selected role has `can_have_multiple_places`. On submit it validates that (a) at least one role grants the permission, (b) all selected places sit at the same hierarchy level, and (c) the user is a descendant of at least one selected place; otherwise the form shows a translated error. The edit form prefills the multiselect with the user's existing place(s), and create/update persist the place array. Added supporting helpers in shared-libs/contact-types-utils, error strings to messages-*.properties (en/es/fr/ne/sw), and updated webapp contacts components/more-menu to handle places with multiple assigned users (e.g. delete-assigned-place behavior).

## Code Patterns

Role-permission gating of a form control — the multiselect is toggled by inspecting selected roles for `can_have_multiple_places` (admin/src/js/controllers/edit-user.js). Parameterized select2-search service (admin/src/js/services/select2-search.js) to support multi-selection, reusing existing search infrastructure. Hierarchy-level and parentage validation centralized in shared-libs/contact-types-utils/src/index.js so admin and api enforce identical rules.

## Design Choices

Gated the multiselect behind the `can_have_multiple_places` role flag rather than enabling it globally, preserving single-place behavior and backwards compatibility for existing roles. Put the shared hierarchy/parentage validation in contact-types-utils so both the admin UI and the API apply the same constraints. Reused the existing select2-search component instead of introducing a new widget.

## Related Files

- admin/src/js/controllers/edit-user.js
- admin/src/js/services/create-user.js
- admin/src/js/services/select2-search.js
- admin/src/templates/edit_user.html
- shared-libs/contact-types-utils/src/index.js
- api/resources/translations/messages-en.properties
- webapp/src/ts/modules/contacts/contacts-more-menu.component.ts
- webapp/src/ts/modules/contacts/contacts.component.ts

## Testing

Added/updated admin unit tests (edit-user.spec.js, update-user.spec.js) and shared-libs contact-types-utils tests for the multi-place permission/validation helpers. Added an API integration test for the users controller (tests/integration/api/controllers/users.spec.js). Added/updated e2e WDIO specs — add-user, delete-assigned-place, edit-person-home-place, person-under-area — and the users page object, covering multiselect assignment, validation error display, editing with prefilled places, and deleting a place with assigned users.

## Related Issues

- #9116: Update the Admin app user place field to allow setting multiple places (closed by this PR)
- #6543: Backend support for associating a user with multiple facilities (predecessor work this continues)

## Domain Rationale

**Fit:** strong

The PR is user-account management: it adds Admin-app UI and validation for assigning facilities to a user, gated by the `can_have_multiple_places` role permission. User accounts, roles, and permissions are core authentication concerns (per the roles/permissions pitfall), not the contacts or configuration domains, even though places are contacts and the work happens in the admin tool.
