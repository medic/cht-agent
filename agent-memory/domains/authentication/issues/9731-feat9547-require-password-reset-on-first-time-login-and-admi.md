---
id: cht-core-9547
category: feature
domain: authentication
domainFit: strong
issueNumber: 9547
issueUrl: https://github.com/medic/cht-core/issues/9547
title: Require password reset on first-time login and after admin updates a user's password
lastUpdated: '2026-10-05'
summary: Admins create CHW accounts and share a single password, which then stays valid indefinitely with no forced rotation. This PR adds a password-reset flow that requires users to set a new password on first login (and whenever an admin sets or resets their password), enabled by default with a permission to skip it.
services:
  - api
  - admin
  - webapp
techStack:
  - javascript
  - angularjs
  - couchdb
  - service-worker
  - html
  - css
tags:
  - password-reset
  - first-login
  - password-change-required
  - security
  - user-management
  - login-flow
  - permissions
  - internationalization
related_workflows:
  - user-registration
source_pr: medic/cht-core#9731
source_sha: 67b533070d124a274994ce5b3e8a772986a239d1
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - api/src/controllers/login.js
  - api/src/public/login/password-reset.js
  - api/src/templates/login/password-reset.html
  - shared-libs/user-management/src/users.js
  - admin/src/js/controllers/edit-user.js
  - api/src/services/cookie.js
concepts:
  - password-reset enforcement on login
  - first-time login flow
  - password_change_required user flag
  - permission-gated bypass (can_skip_password_change)
  - cookie/session management
  - service-worker caching of login assets
related_issues: []
stale: true
---

## Problem

System admins create accounts for CHWs and share the password with them out-of-band. There was no mechanism to force the user to change that shared password on first login, nor to force a change after an admin reset a user's password, so initial/admin-set credentials remained valid indefinitely — a security weakness for newly provisioned accounts.

## Root Cause

Not a bug but a missing capability: the user model and login flow had no notion of a required password change. User documents carried no password_change_required flag, the login controller never redirected to a reset page, and user-management saved admin-set passwords (on create, update or reset) without flagging the account for forced rotation.

## Solution

Introduced a `password_change_required` flag on `_users` docs, set server-side in shared-libs/user-management/src/users.js: whenever an update carries a `password`, `getUserUpdates()` sets it to `data.password_change_required === false ? false : isPasswordChangeRequired(updatedUser, data, fullAccess)`. `isPasswordChangeRequired()` returns false when the caller lacks full access (`can_edit` + `can_update_users`, which is the webapp self-service case for ordinary users) or the update enables token login, and otherwise true unless the user's roles hold `can_skip_password_change`; `createUser()` and `resetPassword()` pass full access, and `updateUser()` passes its `fullAccess` argument.

In api/src/controllers/login.js, `setCookies()` now loads the user doc (`users.getUserDoc`) after authenticating; if the flag is set, `redirectToPasswordReset()` sets only the `userCtx` and locale cookies — not the session cookie — and returns `PASSWORD_RESET_URL` (`/medic/password-reset`). api/src/routing.js serves that page with `login.getPasswordReset` (GET, rendering the new api/src/templates/login/password-reset.html) and handles its form with `login.resetPassword` (POST), which is rate-limited, validates the new password's length and strength, checks the current password with a GET to `/_session` using the submitted credentials, rejects reusing the current password, saves the new one with `password_change_required: false`, and then creates the session and redirects into the app. api/src/services/cookie.js only gained a `clearCookie(res, name)` helper, used to clear the `login` cookie.

In the admin app, `validateSkipPasswordPermission()` in admin/src/js/controllers/edit-user.js computes `$scope.skipPasswordChange` from `can_skip_password_change`, and admin/src/templates/edit_user.html shows the `update.password.help` hint under the Password label when it is false; the admin app does not set `password_change_required` itself. config/default/app_settings.json and config/demo/app_settings.json (both modified) gained a `can_skip_password_change` permission with an empty role list, so by default every role is prompted; a users-API request that sets a password together with `password_change_required: false` skips the prompt for that user.

New login-page strings (`change.password.*`, `password.current.incorrect`, `password.must.match`, `password.same`) were added to the api/resources/translations messages files for ar, en, es, fr, id, ne and sw, and `update.password.help` for en, es, fr, ne and sw only. The webapp bootstrapper (webapp/src/js/bootstrapper/index.js, webapp/src/js/bootstrapper/translator.js) shows a `PASSWORD_CHANGE_SUCCESS` message after the reset page stores `passwordStatus` = `PASSWORD_CHANGED` in localStorage, and api/src/generate-service-worker.js adds `/medic/password-reset` to the service worker's `templatedURLs` next to `/medic/login`.

## Code Patterns

Login client logic is shared between the standard login and the new reset page through a new `window.AuthUtils` module (api/src/public/login/auth-utils.js, added), loaded by the login, token-login and password-reset templates; api/src/public/login/script.js and api/src/public/login/password-reset.js destructure helpers such as `request`, `getUserCtx` and `togglePassword` from it. The `password_change_required` flag on the CouchDB `_users` doc acts as a server-side gate checked in api/src/controllers/login.js (`skipPasswordChange(user)` is `!user?.password_change_required`) to drive the redirect, and the `can_skip_password_change` permission provides the role-based bypass — the standard CHT `can_*` permission pattern, declared in config/default/app_settings.json (and, at this PR, config/demo/app_settings.json, which PR #11354 deleted on master). At this PR `isPasswordChangeRequired()` checks the permission with `roles.hasAllPermissions(userRoles, ['can_skip_password_change'])`; on master it uses `chtDatasource.v1.hasPermissions(['can_skip_password_change'], userRoles)` (changed by PR #10795).

## Design Choices

Enabled by default to satisfy the issue's security-first requirement, with a permission to skip rather than a global on/off toggle so behavior can be scoped per role. The session cookie is withheld until the reset succeeds, so a flagged user cannot reach the app with the shared password. The flag is keyed on the caller's permissions, not on self-versus-other: password changes by a caller without full access (`can_edit` + `can_update_users`, which is the webapp self-service case for ordinary users) and updates that enable token login never set the flag, while a user who holds both permissions (default config: `program_officer`) is flagged even when changing their own password unless their role has `can_skip_password_change`. An API escape hatch (password_change_required: false for a specific user) covers exceptions. The admin app surfaces an explicit hint when changing a password so admins know the user will be prompted, rather than silently flagging the account.

## Related Files

- api/src/controllers/login.js
- api/src/public/login/password-reset.js
- api/src/templates/login/password-reset.html
- api/src/public/login/auth-utils.js
- api/src/public/login/script.js
- api/src/routing.js
- api/src/services/cookie.js
- api/src/generate-service-worker.js
- shared-libs/user-management/src/users.js
- admin/src/js/controllers/edit-user.js
- admin/src/templates/edit_user.html
- config/default/app_settings.json
- config/demo/app_settings.json (present at this PR's anchor; removed on master by the demo-config deletion, PR #11354)
- webapp/src/js/bootstrapper/index.js
- api/resources/translations/messages-en.properties

## Testing

No new spec files; existing unit specs were extended for the login controller, cookie service and service-worker generation (api/tests/mocha), the admin edit-user controller (admin/tests/unit), user-management users (shared-libs/user-management/test/unit) and the webapp bootstrapper (webapp/tests/mocha). The integration specs in tests/integration/api/controllers cover the flag being set unless the role has `can_skip_password_change` (tests/integration/api/controllers/users.spec.js) and the login redirect to `/medic/password-reset` for first-time users (tests/integration/api/controllers/login.spec.js). In the WebdriverIO suite, tests/e2e/default/login/login-logout.wdio-spec.js gained a `Password Reset` block (missing fields, weak, mismatched and reused passwords, incorrect current password, and a successful reset), and the service-worker, user/contact creation and replacement specs, the login page object and shared test utils were updated for the new flow.

## Related Issues

- #9547: "Change password on first login" — the issue this PR closes; asks to force a password change for admin-provisioned CHW accounts, on by default with a `can_skip_password_change` bypass

## Domain Rationale

**Fit:** strong

The PR is entirely about the login/password lifecycle — enforcing a password reset on first login and after admin password changes, a new password-reset page and endpoint, withholding the session cookie until the password is changed, and a permission to bypass it — which is squarely authentication: it changes what a successful login yields and how credentials are rotated.
