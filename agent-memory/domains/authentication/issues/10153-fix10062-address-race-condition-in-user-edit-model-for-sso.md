---
id: cht-core-10062
category: bug
domain: authentication
domainFit: strong
issueNumber: 10062
issueUrl: https://github.com/medic/cht-core/issues/10062
title: Fix race condition in admin user edit modal that broke Facility and Associated contact field population for SSO users
lastUpdated: '2026-09-29'
summary: 'The admin app''s edit user modal intermittently left the Place (`facilitySelect`) and Associated contact (`contactSelect`) selects unpopulated, reproducibly for SSO users. The Select2 setup for both ran on `$uibModalInstance.rendered` without waiting for `determineEditUserModel()`, which for SSO users also waits on an extra `GET /api/v2/users/<name>`; the fix moves that setup into `populateFacilitynContact()`, called only after `$scope.editUserModel` is assigned.'
services:
  - admin
techStack:
  - javascript
  - angularjs
  - webdriverio
tags:
  - sso
  - user-management
  - race-condition
  - edit-user-modal
  - admin-app
  - facility
  - associated-contact
  - select2
related_workflows:
  - user-registration
source_pr: medic/cht-core#10153
source_sha: cc8758d1dbb3665a933b55a921d5d24e075e2a75
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - admin/src/js/controllers/edit-user.js
concepts:
  - race condition
  - asynchronous data loading
  - modal form model population
  - SSO user management
  - data binding ordering
related_issues:
  - cht-core-9735
  - cht-core-9761
stale: false
---

## Problem

When the edit user modal was opened in the admin app, the Place (label key `Facility`) and Associated contact selects were sometimes left empty or uninitialised. It was intermittent — the issue's repro is to give a user an SSO Email Address, then close and reopen their edit modal until it happens — and was reported from the community forum for SSO-enabled users; the issue is labelled as affecting 4.20.0 and 4.21.0.

## Root Cause

A race in admin/src/js/controllers/edit-user.js. `this.setupPromise = determineEditUserModel().then(model => { $scope.editUserModel = model; ... })` and a separate `$uibModalInstance.rendered.then(() => ContactTypes.getAll()).then(...)` chain ran independently. The second chain initialised both Select2 widgets from the model: the contact select via `Select2Search`, which takes its initial value from the `<option ng-value="editUserModel.contactSelect">` in the template, and the place select with `usersPlaces($scope.editUserModel.facilitySelect)`. If the modal rendered before the model had been assigned, the contact widget came up empty and reading `facilitySelect` off the still-undefined `$scope.editUserModel` threw, leaving the place widget uninitialised.

The race was latent: the `rendered` chain dates from the admin app's creation and has read `$scope.editUserModel.facilitySelect` since PR #9128 (multiple places per user). What made it reproducible for SSO users is PR #9900, part of the SSO epic that reached master as PR #9955: `determineEditUserModel` now waits on `$q.all([Settings(), getOidcUsername()])`, and `getOidcUsername()` issues an extra `GET /api/v2/users/<name>` for users whose user-settings doc has `oidc_login`, so the model resolves later for exactly those users.

## Solution

Wrapped the `rendered` chain in a new `populateFacilitynContact()` (the name as spelled in the source) and called it from `setupPromise`'s `.then`, right after `$scope.editUserModel = model` and `validateSkipPasswordPermission()`. The contact select's `Select2Search` call also moved inside the `usersPlaces(...)` callback, so both widgets are initialised together, after the model exists and the place ids have been resolved. The fix was cherry-picked to 4.20.x (`7197a46c1`, first released in 4.20.1) and 4.21.x (`f02285311`, 4.21.1); on master it is first in 4.22.0. The same code is on master today, where `setupPromise` waits on `$q.all([determineEditUserModel(), datasourcePromise])` (added by PR #10795) before calling it.

## Code Patterns

Do not run view-widget initialisation off a render promise that races the model; chain it after the model promise instead. In admin/src/js/controllers/edit-user.js the `$uibModalInstance.rendered` → `ContactTypes.getAll()` → `Select2Search` sequence is started from inside `setupPromise`'s `.then`, after `$scope.editUserModel` is set, so it still waits for the modal to render but can no longer run before the model exists.

## Design Choices

The fix orders the widget setup after the model rather than masking the symptom in the view, so the modal behaves the same whichever of the model lookups and the render finishes first. No unit spec was changed; coverage is an e2e case, and rather than adding a new spec file the PR consolidated the add-user spec into one covering both creating and editing users.

## Related Files

- tests/e2e/default/users/user.wdio-spec.js (renamed by this PR from tests/e2e/default/users/add-user.wdio-spec.js)
- tests/page-objects/default/users/user.wdio.page.js

## Testing

tests/e2e/default/users/add-user.wdio-spec.js was renamed to tests/e2e/default/users/user.wdio-spec.js (77% similar), with its fixtures hoisted to module scope. It gains one case, 'Editing User -> should render user details', which, with an `oidc_provider` configured, creates an offline (`chw`) user with a place, a contact and an `oidc_username`, opens the edit modal and asserts the username, role, place (`#facilitySelect`), contact (`#contactSelect`) and SSO email (`#sso-login`) values. The users page object (tests/page-objects/default/users/user.wdio.page.js) gains `openEditUserDialog` and `editUserDialogDetails`, plus the `getUsernameRow` and `userList` helpers they use.

## Related Issues

- #10062: "Rendering issue in edit user modal for SSO user" — this draft's issue.
- #9761: "Update user creation frontend to support creating SSO users" — its PR #9900 added the `getOidcUsername()` request whose delay exposed this race.
- #9735: "Single sign on (SSO) using identity provider" — the SSO epic that carried PR #9900 to master.

## Domain Rationale

**Fit:** strong

The fix is in the admin app's user-account editor (`EditUserCtrl`), which configures a user's roles, place, contact and login method, and the regression it repairs was made reproducible by the SSO epic's `getOidcUsername()` lookup. User-account management and SSO are authentication concerns; the Place and Associated contact fields here are the user account's assignments, not contact records being edited.
