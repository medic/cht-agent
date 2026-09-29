---
id: cht-core-9761
category: feature
domain: authentication
domainFit: strong
issueNumber: 9761
issueUrl: https://github.com/medic/cht-core/issues/9761
title: Add an SSO Email Address (oidc_username) text field to the admin app user modal, hiding password and token_login for SSO users
lastUpdated: '2026-09-29'
summary: 'The admin app''s user create/edit modal had no way to mark a user as an SSO user. This PR adds an "SSO Email Address" text input (`<input id="sso-login" type="text">`, bound to `editUserModel.oidc_username`) that renders only when app_settings has an `oidc_provider`; while it holds a value the token_login controls and password fields are hidden and password validation is skipped. For an existing user whose user-settings doc has `oidc_login`, the modal loads `oidc_username` from `GET /api/v2/users/<name>`, which user-management now returns.'
services:
  - admin
  - api
techStack:
  - javascript
  - angularjs
  - oidc
  - couchdb
tags:
  - sso
  - oidc
  - user-management
  - admin-app
  - authentication
  - oidc_username
  - token-login
related_workflows:
  - user-registration
source_pr: medic/cht-core#9900
source_sha: fd3bf4a4080037ab7b913dfc43260c74fddc0fc0
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - admin/src/js/controllers/edit-user.js
  - admin/src/templates/edit_user.html
  - shared-libs/user-management/src/sso-login.js
  - shared-libs/user-management/src/token-login.js
  - shared-libs/user-management/src/users.js
concepts:
  - single sign-on (SSO)
  - OIDC identity provider
  - mutually-exclusive login methods
  - user authentication configuration
  - SSO email address (oidc_username) as the per-user SSO key
related_issues:
  - cht-core-9735
  - cht-core-10062
stale: true
---

> **Epic child.** PR #9900 was squash-merged into the feature branch `9735_sso`
> (`fd3bf4a40`, 2025-05-22), not into master. That branch reached master as PR #9955
> (`2cbe9c109`, 2025-06-03). Its own PR number is stamped nowhere on master, which is
> why this draft's `source_sha` does not resolve in a plain clone. Fetch it with
> `git fetch origin +refs/pull/9955/head:refs/verify/pr9955` — the epic PR's head ref.

## Problem

The admin app's user create/edit modal offered only password and token_login. The users API could already provision SSO users — user-management accepts an `oidc_username` (introduced inside the epic by PR #9961, replacing PR #9800's `oidc` boolean) and rejects combining it with a password or token_login — but the modal had no field for it, so it could neither create an SSO user nor switch an existing user to or from SSO.

## Root Cause

This is a feature gap rather than a defect: admin/src/js/controllers/edit-user.js and admin/src/templates/edit_user.html predated SSO support — neither mentions `oidc` or SSO at this PR's parent — so there was no `oidc_username` input, and the password and token_login controls knew nothing of an SSO mode that should hide them.

## Solution

Added an "SSO Email Address" text input to admin/src/templates/edit_user.html — `<input id="sso-login" type="text" class="form-control" ng-model="editUserModel.oidc_username" />`, label key `user.sso.username`. It renders only when `allowSSOLogin` is truthy — `const allowSSOLogin = settings => settings.oidc_provider;` in admin/src/js/controllers/edit-user.js, i.e. an OIDC provider is configured in app_settings — and the user neither has token login nor is having it switched on (it also shows while an existing token login is being switched off). While `oidc_username` has a value and SSO is allowed, both token-login blocks are removed (`ng-if`) and the password/confirm fields get the `hidden` class; `validatePasswordForEditUser` then skips password validation and clears any typed password, and blanking the field (`oidc_username === ''`) makes a password required again. When SSO is not allowed, `validatePasswordFields` blanks a leftover `oidc_username` whenever it runs, and `validateTokenLogin` does so when token login is on and the phone number validates.

For existing users the modal is opened with the user-settings doc from the admin users list, which carries `oidc_login` but not `oidc_username` (that lives on the `_users` doc). The new `getOidcUsername()` therefore issues `GET /api/v2/users/<name>` — only when `$scope.model.oidc_login` is set — and `determineEditUserModel` now waits for it with `$q.all([Settings(), getOidcUsername()])`. Three keys were added to api/resources/translations/messages-en.properties: `user.sso.username`, `user.sso.username.help` and `user.sso.username.duplicate`.

Supporting user-management changes: `mapUser` in shared-libs/user-management/src/users.js now returns `oidc_username` (what that GET reads); `validateSsoLogin` in shared-libs/user-management/src/sso-login.js rejects only `token_login === true` alongside `oidc_username` (so an explicit `token_login: false` can accompany it) and tags the duplicate-`oidc_username` error with the `user.sso.username.duplicate` key, which shared-libs/user-management/src/users.js now passes to `error400`; `validateSsoLoginUpdate` also rejects setting `oidc_username` on a user whose token_login stays enabled, unless the same update sends `token_login: false`; and `validateTokenLoginEdit` in shared-libs/user-management/src/token-login.js accepts `oidc_username` in place of a password when token login is being disabled.

## Code Patterns

Settings-gated, mutually exclusive login-method fields in AngularJS: `$scope.allowSSOLogin = allowSSOLogin(settings)` (admin/src/js/controllers/edit-user.js) gates the SSO block with `ng-if`, and the token-login blocks and password fields key off `allowSSOLogin && editUserModel.oidc_username` (`ng-if` / `hidden` class) in admin/src/templates/edit_user.html, with `validatePasswordForEditUser` applying the same rule on save. Fetch-on-open for a field that lives only on `_users`: `getOidcUsername()` runs only when the list's user-settings doc has `oidc_login`. The server-side rules stay in shared-libs/user-management/src/sso-login.js (`validateSsoLogin`, `validateSsoLoginUpdate`), with the token-login side in shared-libs/user-management/src/token-login.js (`validateTokenLoginEdit`).

## Design Choices

The issue proposed a checkbox toggle that sets a per-user `oidc_provider`; what shipped is a free-text field bound to `oidc_username`, matching the model PR #9961 had introduced in the commit directly before this one on `9735_sso`: a non-empty `oidc_username` is itself what marks a user as SSO, and the help text (`user.sso.username.help`) tells admins the value must match the user's email at the SSO provider. `oidc_provider` appears here only as the app_settings gate: with no provider configured the field never renders, and the password and token-login validators blank a leftover value. In the UI, SSO is mutually exclusive with password and token_login (the other controls are hidden and a typed password is cleared), matching the validation user-management already enforces; the user-management changes in this PR adjust that validation for the admin's edit flows (switching token_login off while setting `oidc_username`, showing a translated duplicate error).

## Related Files

- admin/tests/unit/controllers/edit-user.spec.js
- api/resources/translations/messages-en.properties
- shared-libs/user-management/test/unit/sso-login.spec.js
- shared-libs/user-management/test/unit/token-login.spec.js
- shared-libs/user-management/test/unit/users.spec.js
- tests/integration/api/controllers/users.spec.js
- tests/e2e/default/users/add-user.wdio-spec.js (present at this PR's anchor; renamed on master to tests/e2e/default/users/user.wdio-spec.js by PR #10153)
- tests/e2e/default/users/create-meta-db.wdio-spec.js
- tests/page-objects/default/users/user.wdio.page.js
- tests/e2e/default/contacts/delete-assigned-place.wdio-spec.js
- tests/e2e/default/contacts/person-under-area.wdio-spec.js
- tests/e2e/visual/contacts/contact-user-hierarchy-creation.wdio-spec.js

## Testing

All test files are modified, none added. admin/tests/unit/controllers/edit-user.spec.js gains cases for the password rules around `oidc_username` — not required and cleared when SSO is set on a new user, required again when SSO is removed, switching between SSO and token login in either direction, and no-op saves leaving `oidc_username` untouched. The shared-libs/user-management specs cover `mapUser` returning `oidc_username`, `token_login: false` alongside `oidc_username`, `validateTokenLoginEdit` accepting `oidc_username`, and the translation key on SSO errors; tests/integration/api/controllers/users.spec.js covers the GET returning `oidc_username`, rejecting duplicates, and switching an existing token_login user to SSO. In e2e, `inputAddUserFields` in the users page object tests/page-objects/default/users/user.wdio.page.js changed from positional arguments to an options object with an `oidcUsername` option that fills `#sso-login`. The contacts, create-meta-db and visual specs changed only for that call-site update, and tests/e2e/default/users/add-user.wdio-spec.js (tests/e2e/default/users/user.wdio-spec.js on master, after PR #10153) gained 'should add sso user', which creates a user through the modal and asserts `oidc_username` on the `_users` doc and `oidc_login: true` on the user-settings doc.

## Related Issues

- #9761: "Update user creation frontend to support creating SSO users" — this draft's issue; it proposed a checkbox toggle that sets `oidc_provider` and disables password/token_login configuration; the PR shipped the `oidc_username` text field instead.
- #9735: "Single sign on (SSO) using identity provider" — the SSO epic this PR is a child of.
- #10062: "Rendering issue in edit user modal for SSO user" — the extra `getOidcUsername()` request added here delays `determineEditUserModel()` for SSO users, which exposed a latent race in the modal's Select2 setup; fixed on master by PR #10153.
- PR #9800: "feat(#9760): add support for sso user create/update" — added shared-libs/user-management/src/sso-login.js (`validateSsoLogin`, `validateSsoLoginUpdate`), which this PR adjusts; its `oidc` boolean had already been replaced by `oidc_username` when this PR merged.
- PR #9961: "feat(#9890): add mapping from OIDC to CHT user" — introduced the `oidc_username` / `oidc_login` fields this UI reads and writes.

## Domain Rationale

**Fit:** strong

The PR adds the admin-app controls for configuring a user to authenticate via SSO — an `oidc_username` field that is mutually exclusive with password and token_login, gated on the app_settings `oidc_provider` — plus the user-management validation adjustments behind them. Per-user login-method configuration is an authentication concern, so this belongs to authentication rather than configuration or contacts.
