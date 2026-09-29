---
id: cht-core-9763
category: feature
domain: authentication
domainFit: strong
issueNumber: 9763
issueUrl: https://github.com/medic/cht-core/issues/9763
title: Block SSO/OIDC users from default password login and password reset flows
lastUpdated: '2026-09-29'
summary: 'Nothing in the default username/password login or the reset-password flow rejected a user flagged for SSO; the random password user-management assigns SSO users was the only barrier. This PR adds an `isOidcUser` guard to api/src/controllers/login.js so `setCookies` (the step every password-based login finishes through) answers 401 `Password Login Not Permitted For SSO Users` and `resetPassword` answers 400 before the password is changed. As written here the guard reads the user doc''s `oidc` boolean; on master it reads `oidc_username` instead, re-keyed before landing (see the banner).'
services:
  - api
techStack:
  - javascript
  - nodejs
  - express
  - couchdb
  - mocha
tags:
  - sso
  - oidc
  - login
  - password-reset
  - authentication
  - security-hardening
related_workflows: []
source_pr: medic/cht-core#9887
source_sha: 6716fb951251f6318e2ceef1c88b0874cfa4723d
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - api/src/controllers/login.js
concepts:
  - single sign-on
  - OIDC authentication
  - password-based login
  - credential validation
  - authentication gating
related_issues:
  - cht-core-9735
stale: true
---

> **Epic child.** PR #9887 was squash-merged into the feature branch `9735_sso`
> (`6716fb951`, 2025-05-08), not into master. That branch reached master as PR #9955
> (`2cbe9c109`, 2025-06-03). Its own PR number is stamped nowhere on master, which is
> why this draft's `source_sha` does not resolve in a plain clone. Fetch it with
> `git fetch origin +refs/pull/9955/head:refs/verify/pr9955` — the epic PR's head ref.
>
> **Superseded before landing (`stale-as-written`):** as this PR wrote it, `isOidcUser`
> is `userDoc?.oidc === true && config.get('oidc_provider')?.client_id`. Inside the epic,
> PR #9961 (`4b77459de`) replaced the per-user `oidc` boolean with the string
> `oidc_username` and rewrote the predicate as
> `userDoc?.oidc_username && ssoLogin.isSsoLoginEnabled()`, where `isSsoLoginEnabled`
> (shared-libs/user-management/src/sso-login.js) is `!!config.get('oidc_provider')` and no
> longer requires a `client_id`. That form reached master in `2cbe9c109` and is still
> there; on master a user doc with `oidc: true` and no `oidc_username` is not blocked.
> The same PR changed `resetPassword`'s catch to `err.error || err.message || ...`, so on
> master that 400's body is `Password Reset Not Permitted For SSO Users`. The guard sites
> (`setCookies`, `resetPassword`), error strings and statuses are otherwise unchanged on
> master.

## Problem

Nothing in the default login path or the reset-password flow looked at whether a user was provisioned for SSO. At this commit an SSO user is a `_users` doc with `oidc: true` (the flag PR #9800 added to user-management), and the only thing between such a user and the username/password form was the random password user-management generates for them. A user whose password was known — the integration test sets `oidc: true` directly on a user created with a password — could sign in, or change the password through the reset-password flow, without going through the identity provider.

## Root Cause

`setCookies` in api/src/controllers/login.js — which `login` (behind the `post` handler), `resetPassword` and `loginByToken` all call once CouchDB has accepted the credentials — went straight from `users.getUserDoc` to the forced-password-change check and `redirectToApp`, and `resetPassword`, after `passwordResetValidation`, went from `users.getUserDoc` straight to `updatePassword`. Neither inspected the user doc for an SSO flag, so SSO users were treated like any password user.

## Solution

Added `const isOidcUser = (userDoc) => userDoc?.oidc === true && config.get('oidc_provider')?.client_id;` (this commit's form; see the banner) to api/src/controllers/login.js, and two guards:

- `setCookies` throws `unauthorizedError('Password Login Not Permitted For SSO Users')` (an `Error` with `status = 401`) right after loading the user doc, before the password-change redirect and before `redirectToApp` forwards the CouchDB session cookie, so the `post` login answers `401 { error: 'Password Login Not Permitted For SSO Users' }`.
- `resetPassword` throws a 400 `Password Reset Not Permitted For SSO Users` after `passwordResetValidation` and before `updatePassword`, so the stored password is never changed. At this commit that handler's catch returns `err.error || 'Error updating password'`, so the 400's body is the generic `Error updating password`.

Because `oidcLogin` (the SSO callback) previously finished through `setCookies` too, it now calls `getUserCtxRetry` and `redirectToApp` directly, so neither the new guard nor the forced-password-change redirect applies to SSO sign-ins. Supporting refactors: `getSessionCookie` now throws the 401 `Not logged in` itself, `setCookies` lost its try/catch (`getUserCtxRetry` now logs and throws the 401 `Error getting authCtx`), and `sendLoginErrorResponse` passes 400s through as well as 401s, answering with `e.error || e.message`.

## Code Patterns

One predicate, checked at the shared post-authentication step: `isOidcUser(userDoc)` in api/src/controllers/login.js is evaluated inside `setCookies`, which every password-based path (`login`, `resetPassword`'s re-login, `loginByToken`) calls after CouchDB accepts the credentials, so one guard covers all of them, while the SSO callback `oidcLogin` is routed around `setCookies`. Errors are thrown as `Error` objects carrying `status`, and `sendLoginErrorResponse` maps 400/401 to `{ error: e.error || e.message }`.

## Design Choices

The issue, as edited, asks for the check in the `post` function of api/src/controllers/login.js (its `get` is struck through); its title and first bullet name a per-user `oidc_provider`, and its second bullet was edited from `oidc_provider` to `oidc`. What shipped keys on the `oidc` flag that user-management (PR #9800) writes to the user doc at this commit, and puts the check in `setCookies` rather than in `post`, so it also covers the reset-password re-login and `loginByToken`. The PR also blocks the reset-password flow, which the issue did not ask for. `isOidcUser` requires the app_settings `oidc_provider` to carry a `client_id` at this commit, so a user flagged `oidc` is not locked out of password login on an instance where SSO is not configured. The check runs after CouchDB has validated the credentials — a wrong password still gets the ordinary `Not logged in` 401 — and before any cookie reaches the client.

## Related Files

- api/tests/mocha/controllers/login.spec.js
- tests/integration/api/controllers/login.spec.js

## Testing

Both spec files are modified. api/tests/mocha/controllers/login.spec.js gains 'returns 401 when SSO user attempts password login and SSO is enabled' (`getUserDoc` resolves `{ oidc: true }`, `oidc_provider.client_id` configured; asserts 401 `Password Login Not Permitted For SSO Users`), and tests/integration/api/controllers/login.spec.js gains 'should fail if sso user', which creates a user with a password, writes `oidc: true` onto its `_users` doc and expects the same 401. Both cases are still on master, with their fixtures switched from `oidc: true` to `oidc_username` by PR #9961. The reset-password block has no assertion at this commit: the unit case titled 'should return 400 if is SSO User' posts a too-short password and asserts the `password-short` error. Later in the epic PR #9961 rewrote that case to assert `Password Reset Not Permitted For SSO Users`, and that version is on master.

## Related Issues

- #9763: "Update non-SSO login flow to not allow login if `oidc_provider` set for user" — this draft's issue; as edited, it asks for a check in the login controller's `post` (`get` struck through) of the user's `oidc` value (edited from `oidc_provider`, which the title still uses), plus integration tests.
- #9735: "Single sign on (SSO) using identity provider" — the SSO epic this PR is a child of.

## Domain Rationale

**Fit:** strong

The PR modifies the login controller to gate password-based login and password reset based on a user's SSO/OIDC status — login, credential validation, and SSO provider handling are core authentication concerns.
