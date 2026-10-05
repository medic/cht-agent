---
id: cht-core-9890
category: improvement
domain: authentication
domainFit: strong
issueNumber: 9890
issueUrl: https://github.com/medic/cht-core/issues/9890
title: Map OIDC/SSO identities to CHT users via oidc_username on _users doc and oidc_login flag on user-settings, hiding password update for SSO users
lastUpdated: '2026-10-05'
summary: 'OIDC identities could not be mapped cleanly to CHT users: CHT usernames allow only `[a-z0-9_-]` (so no `@`) while identity providers identify users by email, and the SSO callback matched the id_token `preferred_username` claim to the CHT username. SSO users were also still offered the in-app Update password option. This PR replaces the per-user `oidc` boolean with an `oidc_username` string on the `_users` doc, matched against the id_token `email` claim through the `users_by_field` view, and mirrors a boolean `oidc_login` onto the replicated user-settings doc so the webapp can hide password update, offline included.'
services:
  - api
  - webapp
techStack:
  - javascript
  - typescript
  - couchdb
  - angular
  - oidc
tags:
  - oidc
  - sso
  - single-sign-on
  - openid-connect
  - user-management
  - microsoft-entra-id
  - password-management
  - login
related_workflows:
  - user-registration
source_pr: medic/cht-core#9961
source_sha: 4b77459dee772ed4da0e08ba78ca21277922a091
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - api/src/services/sso-login.js
  - api/src/controllers/login.js
  - shared-libs/user-management/src/sso-login.js
  - shared-libs/user-management/src/users.js
  - shared-libs/user-management/src/token-login.js
  - ddocs/users-db/users/views/users_by_field/map.js
  - webapp/src/ts/modules/configuration-user/configuration-user.component.ts
  - webapp/src/ts/services/user-settings.service.ts
concepts:
  - OIDC/OpenID Connect identity federation
  - single sign-on (SSO)
  - separation of auth-sensitive data (_users doc) from non-sensitive data (user-settings doc)
  - CouchDB user document model and replication boundary
  - email-as-identity mapping for SSO providers
  - offline-aware UI gating via replicated user-settings flags
related_issues:
  - cht-core-9735
  - cht-core-9760
  - cht-core-9762
  - cht-core-9765
  - cht-core-9836
  - cht-core-9938
stale: true
---

> **Epic child.** PR #9961 was squash-merged into the feature branch `9735_sso`
> (`4b77459de`, 2025-05-16), not into master. That branch reached master as PR #9955
> (`2cbe9c109`, 2025-06-03). Its own PR number is stamped nowhere on master, which is
> why this draft's `source_sha` does not resolve in a plain clone. Fetch it with
> `git fetch origin +refs/pull/9955/head:refs/verify/pr9955` — the epic PR's head ref.

## Problem

CHT usernames are restricted to lower-case letters, digits, `_` and `-` (`USERNAME_ALLOWED_CHARS = /^[a-z0-9_-]+$/` in shared-libs/user-management/src/users.js), so they cannot hold an `@`, but OIDC/SSO providers such as Microsoft Entra ID identify users by email (the id_token `email` claim). Before this PR the SSO callback read the id_token `preferred_username` claim and used it directly as the CHT username, so a provider identity could only be mapped when the two happened to match. The per-user state was a boolean `oidc` flag on the `_users` doc, which could not store the mapping email and — because `_users` is not replicated to offline clients — gave the webapp no way to know a user was an SSO user. As a result, the in-app self-serve 'Update password' option was still shown to SSO users, who do not manage their password in CHT.

## Root Cause

OIDC state was modeled as a single boolean `oidc` field on the `_users` doc (added by PR #9800), and the login-time match was `preferred_username` = CHT username, via `getUserSalt` in api/src/services/sso-login.js (removed by this PR). That field could not hold the provider-side identifier, and since the `_users` database does not replicate to the offline webapp, the client UI had no signal to branch on for SSO users (e.g. to hide the password-update option). Nothing required an OIDC user to carry an email to anchor the mapping either.

## Solution

Replaced the boolean `oidc` field with a string `oidc_username` on the `_users` doc — `'oidc'` becomes `'oidc_username'` in `USER_EDITABLE_FIELDS`, and in `missingFields` a user with `oidc_username` needs no password (shared-libs/user-management/src/users.js) — and made the provider's email the mapping key:

- ddocs/users-db/users/views/users_by_field/map.js now lists `'oidc_username'` beside `'contact_id'` among the properties it emits as `[property, doc[property]]`. shared-libs/user-management/src/sso-login.js gains `getUsersByOidcUsername` (a `users/users_by_field` query) and a uniqueness check in `validateSsoLogin` (`The oidc_username [...] already exists for user [...]`); `isSsoLoginEnabled` becomes a zero-argument `!!config.get('oidc_provider')`. Both are exported to the API through a new `ssoLogin` object in shared-libs/user-management/src/index.js.
- In api/src/services/sso-login.js, `getIdToken` reads the `email` claim instead of `preferred_username`, throwing `Email claim is missing in the id token.` when it is absent, and `getCookie` resolves the CHT user with `getUsersByOidcUsername` — a 401 when none matches, an error when more than one does — replacing the `getUserSalt` lookup, which PR #9833 had added.
- `getSettingsUpdates` in shared-libs/user-management/src/users.js sets `oidc_login = !!data.oidc_username` on the user-settings doc whenever an update carries `oidc_username`. webapp/src/ts/modules/configuration-user/configuration-user.component.ts now computes `canUpdatePassword = !user.token_login && !user.oidc_login && !this.sessionService.isAdmin()`, and the `UserSettings` interface in webapp/src/ts/services/user-settings.service.ts gains `oidc_login?: boolean`.
- api/src/controllers/login.js (`isOidcUser`) and shared-libs/user-management/src/token-login.js (`getUserByToken`) switch their SSO checks to `oidc_username && ssoLogin.isSsoLoginEnabled()`, and `renderLogin` uses `ssoLogin.isSsoLoginEnabled()` in place of `hasOidcProvider`, which is removed from api/src/services/settings.js.

## Code Patterns

Dual-doc auth pattern: keep the auth-sensitive identifier on the `_users` doc and mirror a non-sensitive boolean onto the replicated user-settings doc so offline clients can branch on it. Here the mirror is written by `getSettingsUpdates` in shared-libs/user-management/src/users.js (`settings.oidc_login = !!data.oidc_username`) — the same split shared-libs/user-management/src/token-login.js already uses for `token_login`, which it writes to both `user` and `userSettings`. View-backed identity lookup: a `users_by_field` key `['oidc_username', value]` plus `getUsersByOidcUsername` serves both the login-time match and the create/update-time uniqueness check. UI gating on the replicated flag: `canUpdatePassword` in webapp/src/ts/modules/configuration-user/configuration-user.component.ts reads `oidc_login` from the user-settings doc that `UserSettingsService` returns.

## Design Choices

The data is deliberately split because the `_users` database is not replicated to offline clients: `oidc_username` (the sensitive mapping key) stays on `_users`, while `oidc_login` (a non-sensitive flag) goes on the replicated `user-settings` doc so the webapp can drive UI without exposing auth data — the convention token_login already used. Email is the mapping key because CHT usernames cannot contain `@` while OIDC providers identify users by email. Issue #9938 proposed requiring a separate `email` on users with `oidc = true`; instead the email is the `oidc_username` value itself, which must be unique, and a login whose id_token has no `email` claim is refused. The issue scoped this as an MVP targeting Microsoft Entra ID.

## Related Files

- api/src/controllers/login.js
- api/src/services/settings.js
- api/src/services/sso-login.js
- api/tests/mocha/controllers/login.spec.js
- api/tests/mocha/services/sso-login.spec.js
- ddocs/users-db/users/views/users_by_field/map.js
- shared-libs/user-management/src/index.js
- shared-libs/user-management/src/sso-login.js
- shared-libs/user-management/src/token-login.js
- shared-libs/user-management/src/users.js
- shared-libs/user-management/test/unit/sso-login.spec.js
- shared-libs/user-management/test/unit/token-login.spec.js
- shared-libs/user-management/test/unit/users.spec.js
- tests/integration/api/controllers/login.spec.js
- tests/integration/api/controllers/users.spec.js
- tests/utils/mock-oidc-provider.js
- webapp/src/ts/modules/configuration-user/configuration-user.component.ts
- webapp/src/ts/services/user-settings.service.ts
- webapp/tests/karma/karma-unit.base.conf.js
- webapp/tests/karma/ts/modules/configuration-user/configuration-user.component.spec.ts (added)
- webapp/tests/karma/ts/services/update-password.service.spec.ts (added)

## Testing

Updated: the api mocha specs api/tests/mocha/controllers/login.spec.js (rewrites 'should return 400 if is SSO User', which previously asserted `password-short`, to assert `Password Reset Not Permitted For SSO Users`) and api/tests/mocha/services/sso-login.spec.js (e.g. 'throws error if email claim not returned', 'throws error if multiple users are found for oidc_username'), and the shared-libs/user-management unit specs (sso-login, token-login, users). Added: two webapp karma specs, webapp/tests/karma/ts/modules/configuration-user/configuration-user.component.spec.ts and webapp/tests/karma/ts/services/update-password.service.spec.ts; webapp/tests/karma/karma-unit.base.conf.js lowers its `functions` coverage threshold from 86 to 85. Integration specs tests/integration/api/controllers/login.spec.js and tests/integration/api/controllers/users.spec.js are updated (the latter adds 'should fail to create/update a user when oidc_username is a duplicate', retitled 'should fail to create a user when oidc_username is a duplicate' by PR #9900 before landing); the login spec runs against tests/utils/mock-oidc-provider.js, whose id_token now carries an `email` claim.

## Related Issues

- #9890: "Ensure proper mapping for SSO users to Couch users" — this draft's issue; usernames cannot contain `@` while SSO providers identify users by email, scoped to an MVP for Microsoft Entra ID.
- #9836: "Disable in-app password change functionality for SSO users" — addressed here by `oidc_login` gating `canUpdatePassword`.
- #9938: "Require `email` to be provided for user when `oidc = true`" — the PR body says "Closes #9938"; superseded by making the email the `oidc_username` value and refusing id_tokens without an `email` claim.
- #9735: "Single sign on (SSO) using identity provider" — the SSO epic this PR is a child of.
- #9760: "Update `shared-libs/user-management` to accept an `oidc_provider` property for users" — delivered by PR #9800 as the boolean `oidc` flag that this PR replaces with `oidc_username`.
- #9762: "Update CHT login page to have button for redirecting to OIDC provider" — delivered by PR #9877 with the `settings.hasOidcProvider()` helper that this PR removes in favour of `ssoLogin.isSsoLoginEnabled()`
- #9765: "Add support to the CHT api for new endpoint for OIDC login" — delivered by PR #9833, which added api/src/services/sso-login.js with the `preferred_username` lookup (`getUserSalt`) that this PR replaces with the `email` claim matched against `oidc_username`.

## Domain Rationale

**Fit:** strong

The PR is entirely about OIDC/SSO login — mapping an external OIDC identity to a CHT user, storing auth-sensitive login data, and gating the in-app password-change affordance for SSO users. Identity federation and login/credential management are squarely the authentication domain.
