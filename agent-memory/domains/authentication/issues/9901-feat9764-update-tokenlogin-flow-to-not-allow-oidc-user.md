---
id: cht-core-9764
category: feature
domain: authentication
domainFit: strong
issueNumber: 9764
issueUrl: https://github.com/medic/cht-core/issues/9764
title: Block OIDC-configured users from authenticating via the token_login flow
lastUpdated: '2026-09-29'
summary: 'A user flagged for SSO could still complete the token_login flow and receive a session, bypassing the identity provider. This PR adds a guard to `getUserByToken` in shared-libs/user-management/src/token-login.js — as written here `user.oidc && config.get().oidc_provider?.client_id`, where `oidc` is the per-user truthy flag and `oidc_provider` the app_settings provider config — that rejects with 401 `Token login not allowed for SSO users` before `loginByToken` in api/src/controllers/login.js resets the password or creates a session. On master the guard reads `oidc_username` instead; the flag was re-keyed before landing (see the banner).'
services:
  - api
techStack:
  - nodejs
  - javascript
  - couchdb
  - oidc
tags:
  - token-login
  - oidc
  - authentication
  - session
  - login
  - guard-clause
related_workflows:
  - user-registration
source_pr: medic/cht-core#9901
source_sha: f74d663dc7e1f9b3b9711237389145699c52dc7e
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - api/src/controllers/login.js
  - shared-libs/user-management/src/token-login.js
concepts:
  - one-time token login
  - OIDC (OpenID Connect) authentication
  - session issuance
  - authentication-provider mutual exclusivity
  - fail-closed guard before session creation
  - async/await consistency
related_issues:
  - cht-core-9735
stale: true
---

> **Epic child.** PR #9901 was squash-merged into the feature branch `9735_sso`
> (`f74d663dc`, 2025-04-23), not into master. That branch reached master as PR #9955
> (`2cbe9c109`, 2025-06-03). Its own PR number is stamped nowhere on master, which is
> why this draft's `source_sha` does not resolve in a plain clone. Fetch it with
> `git fetch origin +refs/pull/9955/head:refs/verify/pr9955` — the epic PR's head ref.
>
> **Superseded before landing (`stale-as-written`):** as this PR wrote it, the guard in
> `getUserByToken` is `user.oidc && config.get().oidc_provider?.client_id` — `oidc` is the
> per-user truthy flag, `oidc_provider` the app_settings provider config. Inside the epic,
> PR #9961 (`4b77459de`) replaced the per-user flag with the string `oidc_username` and
> rewrote the guard as `user.oidc_username && ssoLogin.isSsoLoginEnabled()`
> (`isSsoLoginEnabled` = `!!config.get('oidc_provider')`, no `client_id` required). That
> form reached master in `2cbe9c109` and is still in
> shared-libs/user-management/src/token-login.js on master; the error message and 401
> status are unchanged.

## Problem

Nothing in the token-login path checked whether the user was an SSO user, so a user flagged `oidc` on their `_users` doc (the per-user flag at this commit) who also held an active token_login could open the token link and be given a session, bypassing the identity provider. SSO users are meant to authenticate through their provider only, so token login was an unintended second way in. The issue asked that `tokenPost` in api/src/controllers/login.js do this check before giving the user a valid session.

## Root Cause

`tokenPost` in api/src/controllers/login.js falls through to `loginByToken` (same file) when the request has no valid session. `loginByToken` calls `tokenLogin.getUserByToken` (shared-libs/user-management/src/token-login.js) to resolve the token to a user id, then `tokenLogin.resetPassword`, creates a CouchDB session and calls `setCookies`. `getUserByToken` validated only that the user's token_login was active, matched the token and had not expired; nothing on the path read the user's `oidc` flag.

## Solution

Added a guard to `getUserByToken` in shared-libs/user-management/src/token-login.js, after the active/match/expiry checks: `if (user.oidc && config.get().oidc_provider?.client_id)` (this commit's form; see the banner) it throws an `Error('Token login not allowed for SSO users')` with `status = 401`. `loginByToken` in api/src/controllers/login.js needs no SSO-specific code: its catch computes `status = err.status || err.code || 400` and `message = err.error || err.message || 'Unexpected error logging in'` and sends `res.status(status).json({ error: message })`, so the client gets a 401 whose `error` field carries the guard's message, and because the rejection comes from the token lookup, `resetPassword` never regenerates the password and no session is created. `loginByToken` was also rewritten from a promise chain to async/await, with the same outcomes.

## Code Patterns

Guard at the lookup step every token login passes through: the SSO check sits in `getUserByToken` (shared-libs/user-management/src/token-login.js) beside the existing `invalid`/`expired` rejections, so its caller `loginByToken` (api/src/controllers/login.js) needs no new branch — it maps any rejection's `status` and `error`/`message` to the response. Promise-chain to async/await normalisation of `loginByToken`.

## Design Choices

The check runs before the token login's side effects — `resetPassword` regenerating the password, the CouchDB session being created, `deactivateTokenLogin` — so nothing is created or changed for an SSO user, rather than issuing a session and revoking it afterwards. At this commit it also requires the app_settings `oidc_provider` to carry a `client_id`, so on an instance with no SSO configured a user flagged `oidc` can still use token login. The issue asked for the check in `tokenPost` (api/src/controllers/login.js); it landed one layer down, in user-management's `getUserByToken`, which `tokenPost` reaches through `loginByToken`.

## Related Files

- api/src/controllers/login.js
- api/tests/mocha/controllers/login.spec.js
- shared-libs/user-management/src/token-login.js
- shared-libs/user-management/test/unit/token-login.spec.js
- tests/integration/api/controllers/login.spec.js

## Testing

All three spec files are modified, none added; the fixtures below are as written at this PR. api/tests/mocha/controllers/login.spec.js gains 'should reject token login for SSO users' (stubs `getUserByToken` to reject with the 401; asserts status 401 with `error: 'Token login not allowed for SSO users'` and that `resetPassword` is not called). shared-libs/user-management/test/unit/token-login.spec.js gains 'should throw when user is oidc' (`oidc: true` with `oidc_provider.client_id` configured). tests/integration/api/controllers/login.spec.js gains 'should reject token login for SSO users', which configures `oidc_provider.client_id`, creates a token-login user, writes a truthy `oidc` (`'some-provider'`) onto its `_users` doc, opens the token link and asserts the 401 body and an empty `Set-Cookie`. All three cases are still on master, with their fixtures switched from `oidc` to `oidc_username` by PR #9961.

## Related Issues

- #9764: "Update `token_login` flow to not allow login if `oidc_provider` value is set for user." — this draft's issue; it asked for the check in `tokenPost` before a session is issued, keyed on a per-user `oidc_provider`.
- #9735: "Single sign on (SSO) using identity provider" — the SSO epic this PR is a child of.

## Domain Rationale

**Fit:** strong

The PR modifies the token-based login flow and session-issuance logic to reject users flagged for SSO/OIDC login — this is core authentication/session-management behavior, squarely in the authentication domain.
