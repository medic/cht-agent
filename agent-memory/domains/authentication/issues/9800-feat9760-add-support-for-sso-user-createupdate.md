---
id: cht-core-9760
category: feature
domain: authentication
domainFit: strong
issueNumber: 9760
issueUrl: https://github.com/medic/cht-core/issues/9760
title: Add SSO (OIDC) user create/update support to the user-management library and the /api/v1, v2 and v3 users APIs
lastUpdated: '2026-09-29'
summary: The user-management library and the users API could not provision CouchDB users that authenticate via SSO/OIDC. This adds an `oidc` boolean field (on master the field is `oidc_username`, which replaced it before the epic landed) to user create/update that sets up SSO users (mutually exclusive with password/token_login), is rejected unless app_settings has `oidc_provider.client_id`, and assigns a random password.
services:
  - api
techStack:
  - javascript
  - nodejs
  - couchdb
  - oidc
tags:
  - sso
  - oidc
  - user-management
  - user-provisioning
  - openid-connect
  - authentication
related_workflows:
  - user-registration
source_pr: medic/cht-core#9800
source_sha: 5f55c171f71daaf872ac000ae32fce8caaa8670a
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - shared-libs/user-management/src/sso-login.js
  - shared-libs/user-management/src/users.js
concepts:
  - single-sign-on
  - oidc-authentication
  - user-provisioning
  - identity-federation
  - mutually-exclusive-auth-methods
related_issues:
  - cht-core-9735
  - cht-core-9890
stale: true
---

> **Epic child.** PR #9800 was squash-merged into the feature branch `9735_sso`
> (`5f55c171f`, 2025-04-12), not into master. That branch reached master as PR #9955
> (`2cbe9c109`, 2025-06-03). Its own PR number is stamped nowhere on master, which is
> why this draft's `source_sha` does not resolve in a plain clone. Fetch it with
> `git fetch origin +refs/pull/9955/head:refs/verify/pr9955` — the epic PR's head ref.

> **Renamed before landing (`stale-as-written`):** this PR's boolean `oidc` user field
> never reached master. On `9735_sso`, PR #9961 (`4b77459de`) replaced it with a string
> `oidc_username` (the SSO email, kept unique through the `users/users_by_field` view) plus
> a boolean `oidc_login` on the user-settings doc, made `validateSsoLogin` async, and changed
> `isSsoLoginEnabled` from checking `oidc_provider.client_id` to `!!config.get('oidc_provider')`.
> That later form is what `2cbe9c109` carried to master, and it is what is on master today; the names
> `validateSsoLogin` and `validateSsoLoginUpdate` in shared-libs/user-management/src/sso-login.js
> are unchanged.

## Problem

The user-management shared library and the users API create/update endpoints (/api/v1, v2 and v3) had no way to provision CouchDB users that authenticate through SSO/OIDC. Only password and token_login authentication were supported, so SSO users could neither be created nor updated via the API.

## Root Cause

The user create/update logic in shared-libs/user-management/src/users.js handled only password and token_login auth and had no branch for OIDC/SSO users — no field to flag a user as SSO, no check that an OIDC provider is configured in app_settings, and no mechanism to set a placeholder password.

## Solution

Added shared-libs/user-management/src/sso-login.js (`validateSsoLogin`, `validateSsoLoginUpdate`) and wired it into shared-libs/user-management/src/users.js so the user payload accepts an `oidc` boolean (replaced by `oidc_username` before landing). When set, the user is provisioned as an SSO user — rejected if password or token_login is also given, rejected unless app_settings has `oidc_provider.client_id` (internal `isSsoLoginEnabled`, which checks `settings?.oidc_provider?.client_id`), and assigned a generated password (`passwords.generate()`) with `password_change_required: false`. shared-libs/user-management/src/users.js adds `oidc` to `USER_EDITABLE_FIELDS`, stops requiring `password` when `oidc` is set, and calls the validators from `createUser`, `createUsers`, `createMultiFacilityUser` and `updateUser`. The API itself does not check `oidc` at this PR, so password login is not yet blocked; that guard arrived with PR #9887. The issue proposed a string `oidc_provider` user property matched against the app_settings `oidc_provider.client_id`; the PR shipped the boolean `oidc` flag instead, although the JSDoc it added to shared-libs/user-management/src/users.js still documents a `data.oidc_provider` parameter ("Client ID for the OIDC Client").

## Code Patterns

Mutually-exclusive auth-method validation (at this PR, `oidc` cannot be combined with password or token_login) and random-password assignment for federated/SSO users live in shared-libs/user-management/src/sso-login.js; shared-libs/user-management/src/users.js calls them from each create/update path, following the existing token-login validation calls.

## Design Choices

Shipped a boolean `oidc` flag on the `_users` doc (replaced by `oidc_username` before landing) rather than the `oidc_provider` string (client_id match) the issue proposed. The create/update payload carries the same boolean that is stored on the `_users` doc (`'oidc'` in `USER_EDITABLE_FIELDS`). Assigning a generated password gives the account a CouchDB credential that is never returned to the caller (the create response carries only doc ids and revs); explicit rejection of password login for SSO users came later in the epic (PR #9887).

## Related Files

- shared-libs/user-management/src/sso-login.js (added)
- shared-libs/user-management/src/users.js
- shared-libs/user-management/test/unit/sso-login.spec.js (added)
- shared-libs/user-management/test/unit/users.spec.js
- tests/integration/api/controllers/users.spec.js

## Testing

Added shared-libs/user-management/test/unit/sso-login.spec.js (`validateSsoLogin`, `validateSsoLoginUpdate`) and updated shared-libs/user-management/test/unit/users.spec.js; updated tests/integration/api/controllers/users.spec.js with SSO cases: create via /api/v1, /api/v2 and /api/v3/users, update via /api/v3/users/:username, and rejection when `oidc_provider` is not configured or when password or token_login is combined with `oidc`.

## Related Issues

- #9760: "Update `shared-libs/user-management` to accept an `oidc_provider` property for users" — the issue this PR implements (it shipped a boolean `oidc` flag instead)
- #9735: "Single sign on (SSO) using identity provider" — the parent epic; this PR reached master inside PR #9955
- #9890: "Ensure proper mapping for SSO users to Couch users" — replaced this PR's `oidc` flag with `oidc_username` and `oidc_login` (PR #9961)

## Domain Rationale

**Fit:** strong

SSO/OIDC is a login/authentication mechanism; provisioning CouchDB users tied to an OIDC identity provider — mutually exclusive with password/token_login auth — is squarely authentication, not generic user-data management.
