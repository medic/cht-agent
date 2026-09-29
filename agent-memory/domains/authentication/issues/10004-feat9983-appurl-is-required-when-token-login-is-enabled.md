---
id: cht-core-9983
category: improvement
domain: authentication
domainFit: strong
issueNumber: 9983
issueUrl: https://github.com/medic/cht-core/issues/9983
title: Require app_url config when token login (or OIDC) is enabled and read it from config instead of the request
lastUpdated: '2026-09-29'
summary: Token login and the OIDC login endpoints previously fell back to deriving the app URL from the incoming request when app_url was unset, and the api threaded that value as an appUrl parameter through the user-management functions. The PR removes the fallback and the parameter; token login and the OIDC handlers now read app_url from configuration and throw when it is missing, a breaking change that shipped in 5.0.0.
services:
  - api
  - sentinel
techStack:
  - javascript
  - nodejs
  - mocha
tags:
  - token-login
  - oidc
  - app_url
  - breaking-change
  - user-management
  - refactor
related_workflows:
  - user-registration
source_pr: medic/cht-core#10004
source_sha: 1dfd7e60df7c156da0fd20c4c5da80443d007a28
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - shared-libs/user-management/src/token-login.js
  - shared-libs/user-management/src/users.js
  - api/src/controllers/login.js
  - api/src/controllers/users.js
  - api/src/server-utils.js
  - shared-libs/transitions/src/transitions/create_user_for_contacts.js
concepts:
  - token-based passwordless login
  - OIDC authentication
  - fail-fast on missing app_url
  - single source of truth for app_url
  - breaking API/config change
related_issues:
  - cht-core-9735
stale: false
---

## Problem

Enabling token login did not require the app_url setting to be configured. Before this PR, `getAppUrl` in api/src/server-utils.js (called as `serverUtils.getAppUrl(req)` from api/src/controllers/login.js) returned `config.get('app_url')` or, when that was unset, `${req.protocol}://${req.get('host')}`, which misses a non-standard port when the API runs in Docker behind a reverse proxy. api/src/controllers/users.js and api/src/controllers/login.js passed the result as an `appUrl` argument into the user-management `createUser`/`createUsers`/`createMultiFacilityUser`/`updateUser` functions, which handed it down through `manageTokenLogin` and `enableTokenLogin` to `generateTokenLoginDoc`, where the token-login SMS link is built. The create_user_for_contacts transition passed `config.get('app_url')` into the same `createUser` parameter, and the OIDC handlers in api/src/controllers/login.js built their callback URLs from the same helper.

## Root Cause

token-login methods accepted an appUrl argument that could be reconstructed from the request when app_url was not set in configuration, so the URL had multiple possible sources and had to be threaded through the login/user-creation call chain along with request-based fallback logic in server-utils.

## Solution

Removed `getAppUrl` from api/src/server-utils.js and dropped the `appUrl` parameter from `createUser`, `createUsers`, `createMultiFacilityUser` and `updateUser` (shared-libs/user-management/src/users.js) and from `manageTokenLogin`, `enableTokenLogin` and `generateTokenLoginDoc` (shared-libs/user-management/src/token-login.js). The api controllers, `updatePassword()` in api/src/controllers/login.js and the create_user_for_contacts transition stopped passing it. `generateTokenLoginDoc()` now reads `config.get('app_url')` itself and throws `app_url configuration is required for token login` when it is unset. In api/src/controllers/login.js a module-local `getAppUrl()` reads `config.get('app_url')`, throws `The app_url value is not configured.` when it is empty, and strips trailing slashes. `oidcLogin` and `oidcAuthorize` now build their URLs from it inside their try blocks, so without app_url `oidcLogin` redirects to the login page with `sso_error=loginerror` and `oidcAuthorize` responds through `serverUtils.error`. There is no settings-level validation. The token-login check fires only when token login is being enabled for a user, and by then `createUser`/`updateUser` have already saved the user and user-settings docs. The PR also split the bulk `createUsers` loop into `filterIgnoredUsers()` and `createSingleUser()` helpers. The change is marked breaking (`feat(#9983)!`) and shipped in 5.0.0. It is on the 5.x release branches only, not on any 4.x branch.

## Code Patterns

Read app_url from configuration at the point of use, as a single source of truth, rather than passing it as a parameter or deriving it from the request. Fail fast with an explicit error when it is missing: see `generateTokenLoginDoc()` in shared-libs/user-management/src/token-login.js and `getAppUrl()` in api/src/controllers/login.js. Because the check runs at the point of use rather than when settings are saved, callers that write docs first (`createUser`, `updateUser` in shared-libs/user-management/src/users.js) can fail after those writes.

## Design Choices

Chose to require app_url and source it from config rather than continue the request-based fallback, giving a single source of truth, simpler call signatures, and consistent handling for both token login and OIDC. It also matches the create_user_for_contacts transition, which already refused to run without app_url. Accepted that this is a breaking change and deferred merge to the 5.0.0 major release rather than preserving backward-compatible fallback.

## Related Files

- shared-libs/user-management/src/token-login.js
- shared-libs/user-management/src/users.js
- api/src/controllers/login.js
- api/src/controllers/users.js
- api/src/server-utils.js
- shared-libs/transitions/src/transitions/create_user_for_contacts.js
- shared-libs/user-management/test/unit/token-login.spec.js
- shared-libs/user-management/test/unit/users.spec.js
- api/tests/mocha/controllers/login.spec.js
- api/tests/mocha/controllers/users.spec.js
- api/tests/mocha/server-utils.spec.js
- shared-libs/transitions/test/unit/transitions/create_user_for_contacts.js
- tests/integration/api/controllers/login.spec.js

## Testing

- shared-libs/user-management/test/unit/token-login.spec.js and shared-libs/user-management/test/unit/users.spec.js drop the `appUrl` argument and stub `config.get('app_url')`.
- api/tests/mocha/controllers/users.spec.js no longer stubs `serverUtils.getAppUrl`.
- api/tests/mocha/controllers/login.spec.js reworks the existing error-path tests of `oidcLogin` and `oidcAuthorize` to use an empty app_url and assert the `The app_url value is not configured.` error.
- api/tests/mocha/server-utils.spec.js deletes the `getAppUrl` tests.
- The create_user_for_contacts transition test no longer expects an app_url argument.
- The integration test tests/integration/api/controllers/login.spec.js now configures app_url by default (`setupTokenLoginSettings = (configureAppUrl = true, configureOidc = false)`) and adds it to the OIDC settings.

This PR adds no test for the token-login throw. The one on master was added later by PR #10701.

## Related Issues

- #9983: "Require `app_url` to be set when enabling `token_login`" — this draft's issue (labelled Breaking change, milestone 5.0.0)
- #9735: "Single sign on (SSO) using identity provider" — the SSO epic whose `oidcLogin`/`oidcAuthorize` handlers (landed via PR #9955) this PR made depend on a configured app_url

## Domain Rationale

**Fit:** strong

Token login and OIDC are authentication mechanisms; this PR governs how those login flows can be enabled and how the login URL is sourced. Although app_url is an app-setting value, the subject matter is the authentication feature itself, not general configuration, so it is a strong fit for authentication rather than configuration.
