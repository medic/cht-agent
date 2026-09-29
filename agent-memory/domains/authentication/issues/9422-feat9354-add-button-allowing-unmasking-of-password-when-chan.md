---
id: cht-core-9354
category: improvement
domain: authentication
domainFit: weak
issueNumber: 9354
issueUrl: https://github.com/medic/cht-core/issues/9354
title: Add reveal/unmask password toggle (eye icon) to the change-password flows in webapp User Settings and admin Edit User
lastUpdated: '2026-09-29'
summary: Password-change forms in the webapp User Settings modal and the admin App Management Edit User modal had no way to reveal the typed password, unlike the login page. Added an eye-icon button that toggles the password and confirm-password fields together between masked and plaintext so users can confirm there are no typos.
services:
  - webapp
  - admin
techStack:
  - typescript
  - javascript
  - angular
  - angularjs
  - less
  - html
tags:
  - password
  - reveal-password
  - unmask
  - eye-icon
  - user-settings
  - edit-user
  - ui
  - accessibility
related_workflows:
  - ui-extensions
  - user-registration
source_pr: medic/cht-core#9422
source_sha: 0efce626d8459cdd75fc49a3427b0ab77e3f1dfd
distilled_at: '2026-06-23'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - webapp/src/ts/modals/edit-user/update-password.component.ts
  - webapp/src/ts/modals/edit-user/update-password.component.html
  - admin/src/js/controllers/edit-user.js
  - admin/src/templates/edit_user.html
concepts:
  - password visibility toggle
  - input type switching (password/text)
  - UI consistency across admin (AngularJS) and webapp (Angular)
  - credential entry usability/accessibility
related_issues:
  - cht-core-8311
stale: true
---

## Problem

When changing a password through the app — both in the webapp User Settings password modal and the admin App Management Edit User modal — there was no way to reveal the typed password. Users could not verify they had entered the password without typos, even though the login page already offered this (issue #8311, PR #8319).

## Root Cause

The password input fields in the webapp update-password modal and the admin edit-user template were hard-coded to type="password" with no visibility toggle; the reveal-password affordance introduced on the login page for #8311 (PR #8319) had not been extended to the password-change forms.

## Solution

Added an eye-icon button (`id="password-toggle"`) inside the password field's `.password-input-group` that toggles both the password and confirm-password inputs between type "password" and "text". The webapp component (webapp/src/ts/modals/edit-user/update-password.component.ts) keeps `editUserModel.passwordFieldType` (initially `'password'`), which webapp/src/ts/modals/edit-user/update-password.component.html binds to both inputs' `type`, and `togglePasswordMasking()` flips it; the admin AngularJS controller (admin/src/js/controllers/edit-user.js) does the same with `$scope.editUserModel.passwordFieldType` and `$scope.togglePasswordMasking()`, used by admin/src/templates/edit_user.html. Both reuse the login page's icons, `/login/images/show-password.svg` and `/login/images/hide-password.svg` (`SHOW_PASSWORD_ICON` / `HIDE_PASSWORD_ICON`). Styling is in a new password.less in each app — admin/src/css/password.less imported from admin/src/css/main.less, webapp/src/css/password.less imported from webapp/src/css/theme.less. The admin password inputs also lost their `autocomplete="new-password"` attribute in this change (still absent on master).

## Code Patterns

Password reveal toggle: keep the input type itself as model state (`passwordFieldType`, `'password'` or `'text'`), bind it to every password input of the form (`type="{{editUserModel.passwordFieldType}}"`) and flip it on eye-icon click, choosing the icon from the same value. Webapp — `togglePasswordMasking()` in webapp/src/ts/modals/edit-user/update-password.component.ts, bound in webapp/src/ts/modals/edit-user/update-password.component.html; admin — `$scope.togglePasswordMasking()` in admin/src/js/controllers/edit-user.js and admin/src/templates/edit_user.html; each app has its own copy of the styling in password.less.

## Design Choices

Reused the existing reveal-password UX from the login page (#8311, PR #8319), including its icon files, for consistency rather than inventing a new pattern, and applied it across both the admin (AngularJS) and webapp (Angular) surfaces so the behavior is uniform. Styling was factored into a dedicated password.less in each app. One toggle drives both the password and confirm fields, so the user sees both values in the same state.

## Related Files

- admin/src/css/main.less
- admin/src/css/password.less
- admin/src/js/controllers/edit-user.js
- admin/src/templates/edit_user.html
- admin/tests/unit/controllers/edit-user.spec.js
- tests/e2e/default/users/add-user.wdio-spec.js (present at this PR's anchor; renamed on master to tests/e2e/default/users/user.wdio-spec.js by PR #10153)
- tests/page-objects/default/users/user.wdio.page.js
- webapp/src/css/password.less
- webapp/src/css/theme.less
- webapp/src/ts/modals/edit-user/update-password.component.html
- webapp/src/ts/modals/edit-user/update-password.component.ts

## Testing

The admin unit spec (admin/tests/unit/controllers/edit-user.spec.js) only adds the new `passwordFieldType`, `showPasswordIcon` and `hidePasswordIcon` fields to an expected model; there is no unit test of `togglePasswordMasking()`. The toggle is covered end to end in the admin Edit User modal by a new WebdriverIO case, `should hide and reveal password value, and add user with a revealed password`, in tests/e2e/default/users/add-user.wdio-spec.js (renamed on master to tests/e2e/default/users/user.wdio-spec.js by PR #10153, where the case still exists), using `togglePassword()`, `setUserPassword()` and `setUserConfirmPassword()` added to tests/page-objects/default/users/user.wdio.page.js. The webapp update-password modal has no new test.

## Related Issues

- #9354: "Add password reveal to change password form" — the issue this PR closes
- #8311: "Show password when clicking on the eye icon" — the login-page reveal feature (implemented by PR #8319) whose pattern and icons this PR reuses

## Domain Rationale

**Fit:** weak

The change is UI-only: an eye-icon toggle that switches the `type` of the password and confirm inputs in the webapp update-password modal and the admin Edit User modal, mirroring the login-page reveal feature added for #8311. It does not change how the password is validated, stored or transmitted, and touches no session or access handling. Authentication is the least-bad home because the only surfaces touched are password-entry forms for user credentials; no app_settings or translation files change, so it is not configuration either.
