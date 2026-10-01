---
id: cht-core-9116
category: feature
domain: authentication
domainFit: strong
issueNumber: 9116
issueUrl: https://github.com/medic/cht-core/issues/9116
title: Allow assigning multiple places to a user in the Admin app via a multiselect place field, with more than one place requiring can_have_multiple_places
lastUpdated: '2026-09-29'
summary: 'The Admin app could only associate a user with a single facility despite backend support for multi-facility users (#6543). This PR makes the user place field a multiselect for every user and creates single users through /api/v3/users; on save, choosing more than one place requires a selected role holding `can_have_multiple_places` and places of the same contact type, and the user''s contact must sit under one of the chosen places.'
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
related_issues:
  - cht-core-6543
  - cht-core-9203
stale: false
---

## Problem

The CHT Admin app modeled a user's facility as a single-value field, so even after backend support landed for users belonging to multiple facilities (#6543), admins had no way to associate more than one place with a user. This blocked configuring supervisors/CHAs who oversee multiple areas.

## Root Cause

The edit-user controller and admin/src/templates/edit_user.html template bound the user's place to a single-value select2 field (admin/src/js/services/select2-search.js resolved only the first initial value), CreateUser posted single-user creations to `/api/v2/users` rather than the multi-facility `/api/v3/users` endpoint, and the contact-in-place check compared the contact's ancestors against one place id. The admin UI had no concept of the `can_have_multiple_places` permission, which the API had enforced since PR #9126.

## Solution

Made the place field a multiselect select2 dropdown (`multiple="multiple"` on the `id="facilitySelect"` select in admin/src/templates/edit_user.html) for every user, as the issue proposed; the `can_have_multiple_places` permission is checked when the form is submitted, not used to enable the field. On submit, when more than one place is selected, it validates that (a) at least one selected role has `can_have_multiple_places` (`validatePlacesPermission`, via cht-datasource `hasPermissions`) and (b) all selected places have the same contact type (`validateFacilityHierarchy` → `ContactTypes.isSameContactType`; the error text calls this the same hierarchy level); for any selection, (c) the user's contact must have one of the selected places as an ancestor (`validateContactIsInPlace`). Failures show translated errors (`permission.description.can_have_multiple_places.not_allowed` / `permission.description.can_have_multiple_places.incompatible_place`, or `configuration.user.place.contact`). The edit form prefills the multiselect with the user's existing place(s) (`usersPlaces`, passed to Select2Search as `initialValue`); CreateUser's single-user path now posts to `/api/v3/users` (CSV bulk creation stays on `/api/v2/users`), and updates still go to `/api/v1/users/{username}`, which accepts a place array since #9126. Added `isSameContactType` to shared-libs/contact-types-utils (exposed through the admin ContactTypes service), the two error strings to messages-*.properties (en/es/fr/ne/sw), and in the webapp disabled the contact Delete option for a place in the logged-in non-admin user's `facility_id` (`isUserFacility` in webapp/src/ts/modules/contacts/contacts-more-menu.component.ts).

## Code Patterns

Permission-gated validation rather than a gated control — `validatePlacesPermission` in admin/src/js/controllers/edit-user.js checks the selected roles for `can_have_multiple_places` only when more than one place is chosen, mirroring the API's own check (`validateAllowedMultipleFacilities`, #9126). Parameterized select2-search service (admin/src/js/services/select2-search.js) to support multi-selection, reusing existing search infrastructure. The same-type check is a pure helper, `isSameContactType` in shared-libs/contact-types-utils/src/index.js, called only from the Admin app (the API does not call it, at this PR or on master); the parentage check stays in admin/src/js/controllers/edit-user.js (`validateContactIsInPlace`).

## Design Choices

Left the multiselect on for everyone and enforced `can_have_multiple_places` at save time, so single-place users and roles without the permission behave as before — selecting one place never triggers the permission or same-type checks. Put the same-type check in contact-types-utils as a reusable helper; only the Admin app applies it, so the API still accepts places of different types. Reused the existing select2-search component instead of introducing a new widget.

## Related Files

- admin/src/js/controllers/edit-user.js
- admin/src/js/services/create-user.js
- admin/src/js/services/select2-search.js
- admin/src/js/services/contact-types.js
- admin/src/templates/edit_user.html
- shared-libs/contact-types-utils/src/index.js
- api/resources/translations/messages-en.properties
- webapp/src/ts/modules/contacts/contacts-more-menu.component.ts
- webapp/src/ts/modules/contacts/contacts-more-menu.component.html
- webapp/src/ts/modules/contacts/contacts.component.ts

## Testing

Updated admin unit tests: admin/tests/unit/controllers/edit-user.spec.js adds `should allow only user with permission to have multiple places` and `user is updated with multiple places`, and admin/tests/unit/services/update-user.spec.js now expects CreateUser to post to `/api/v3/users`; the shared-libs contact-types-utils tests cover `isSameContactType`. In tests/integration/api/controllers/users.spec.js the `POST/GET api/v2/users` suite was re-enabled (it had been `describe.skip`); no cases were added. E2E: the new tests/e2e/default/contacts/delete-assigned-place.wdio-spec.js logs in as a user with two places and checks that the Delete menu option is disabled on one of them; tests/e2e/default/users/add-user.wdio-spec.js adds `should add user with multiple places with permission` and `should require user to have permission for multiple places` (checks the not-allowed message); edit-person-home-place and person-under-area were re-enabled from `describe.skip`; the users page object gained multiselect place input.

## Related Issues

- #9116: "Make place field in the user form a multiselect dropdown" — this draft's issue, closed by this PR
- #6543: "Allow for multiple places to be assigned to users" — the API support (PR #9126) this Admin-app work builds on
- #9203: "Ensure backward compatibility of facility_id in Admin app" — follow-up bug: editing a user whose `facility_id` is still a legacy string failed to load the place, fixed by PR #9204

## Domain Rationale

**Fit:** strong

The PR is user-account management: the Admin-app user form now writes a user's place list (the `facility_id` that scopes what the user may replicate) and refuses more than one place unless a selected role holds the `can_have_multiple_places` permission; the webapp change also stops a user deleting a place assigned to them. Those are user, role and permission concerns rather than contacts or configuration, even though places are contacts and the work happens in the admin tool.
