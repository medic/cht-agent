---
id: cht-core-9354
category: feature
domain: authentication
domainFit: strong
issueNumber: 9354
issueUrl: https://github.com/medic/cht-core/issues/9354
title: Add reveal/unmask password toggle (eye icon) to the change-password flows in webapp User Settings and admin Edit User
lastUpdated: '2026-06-23'
summary: Password-change forms in the webapp User Settings modal and the admin App Management Edit User modal had no way to reveal the typed password, unlike the login page. Added an eye-icon button that toggles the field between masked and plaintext so users can confirm there are no typos.
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
related_issues: []
stale: false
---

## Problem

When changing a password through the app — both in the webapp User Settings password modal and the admin App Management Edit User modal — there was no way to reveal the typed password. Users could not verify they had entered the password without typos, even though the login page already offered this (added in #8311).

## Root Cause

The password input fields in the webapp update-password modal and the admin edit-user template were hard-coded to type="password" with no visibility toggle; the reveal-password affordance introduced on the login page in #8311 had not been extended to the password-change forms.

## Solution

Added an eye-icon button next to the password fields that toggles their input type between "password" and "text". The webapp Angular component (update-password.component.ts/html) tracks a visibility flag and switches the input type on click; the admin AngularJS controller (edit-user.js) and template (edit_user.html) do the same. Styling was added/shared via password.less in both apps and wired into main.less / theme.less.

## Code Patterns

Password reveal toggle: bind the input's type to a boolean state and flip it on eye-icon click. Webapp — boolean visibility flag in webapp/src/ts/modals/edit-user/update-password.component.ts bound in update-password.component.html; admin — equivalent scope flag toggled in admin/src/js/controllers/edit-user.js and admin/src/templates/edit_user.html; shared styling in password.less.

## Design Choices

Reused the existing reveal-password UX from the login page (#8311) for consistency rather than inventing a new pattern, and applied it across both the admin (AngularJS) and webapp (Angular) surfaces so the behavior is uniform. Styling was factored into a dedicated password.less in each app.

## Related Files

- admin/src/css/main.less
- admin/src/css/password.less
- admin/src/js/controllers/edit-user.js
- admin/src/templates/edit_user.html
- admin/tests/unit/controllers/edit-user.spec.js
- tests/e2e/default/users/add-user.wdio-spec.js
- tests/page-objects/default/users/user.wdio.page.js
- webapp/src/css/password.less
- webapp/src/css/theme.less
- webapp/src/ts/modals/edit-user/update-password.component.html
- webapp/src/ts/modals/edit-user/update-password.component.ts

## Testing

Added/updated admin unit tests in admin/tests/unit/controllers/edit-user.spec.js for the toggle logic, and updated WebdriverIO e2e coverage in tests/e2e/default/users/add-user.wdio-spec.js with a supporting page object in tests/page-objects/default/users/user.wdio.page.js.

## Related Issues

- #9354: feature request to add a button to reveal the password when changing it, as on the login page
- #8311: earlier PR that added the reveal-password button to the login page (pattern reused here)

## Domain Rationale

**Fit:** strong

The change adds a reveal/unmask toggle to password-entry fields in the change-password flows (webapp User Settings and admin Edit User); credential entry and password handling are core authentication concerns, mirroring the login-page reveal feature added in #8311.
