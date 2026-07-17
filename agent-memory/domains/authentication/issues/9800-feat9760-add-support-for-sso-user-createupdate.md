---
id: cht-core-9760
category: feature
domain: authentication
domainFit: strong
issueNumber: 9760
issueUrl: https://github.com/medic/cht-core/issues/9760
title: Add SSO (OIDC) user create/update support to the user-management library and /api/v2/users API
lastUpdated: '2026-06-22'
summary: The user-management library and /api/v2/users API could not provision CouchDB users that authenticate via SSO/OIDC. This adds an `oidc` boolean field to user create/update that sets up SSO users (mutually exclusive with password/token_login), validates against the configured OIDC provider, and assigns a random password.
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
stale: false
---

## Problem

The user-management shared library and the /api/v2/users create/update endpoint had no way to provision CouchDB users that authenticate through SSO/OIDC. Only password and token_login authentication were supported, so SSO users could neither be created nor updated via the API.

## Root Cause

The user create/update logic in users.js handled only password and token_login auth and had no branch for OIDC/SSO users — no field to flag a user as SSO, no validation against the OIDC provider configured in app_settings, and no mechanism to set a placeholder password.

## Solution

Updated shared-libs/user-management (users.js plus sso-login.js) to accept an `oidc` boolean on the user payload. When set, the user is provisioned as an SSO user — mutually exclusive with password and token_login — validated against the OIDC provider configured in app_settings, and assigned a random password so password login is disabled. During review the original string `oidc_provider` field (matched against the app_settings client_id) was simplified to a boolean `oidc` flag to match the `_users` doc design.

## Code Patterns

Mutually-exclusive auth-method validation (oidc cannot be combined with password or token_login) and random-password assignment for federated/SSO users, in shared-libs/user-management/src/users.js and shared-libs/user-management/src/sso-login.js.

## Design Choices

Chose a boolean `oidc` flag over the originally-proposed `oidc_provider` string (client_id match) to align with the representation decided for the `_users` doc; assigning a random password ensures SSO users cannot authenticate via password.

## Related Files

- shared-libs/user-management/src/sso-login.js
- shared-libs/user-management/src/users.js
- shared-libs/user-management/test/unit/sso-login.spec.js
- shared-libs/user-management/test/unit/users.spec.js
- tests/integration/api/controllers/users.spec.js

## Testing

Added/updated unit tests in shared-libs/user-management/test/unit/sso-login.spec.js and users.spec.js, plus integration tests in tests/integration/api/controllers/users.spec.js covering SSO user create/update.

## Related Issues

- #9760: Add support for creating/updating SSO (OIDC) users via the users API, validating oidc against app_settings and setting a random password

## Domain Rationale

**Fit:** strong

SSO/OIDC is a login/authentication mechanism; provisioning CouchDB users tied to an OIDC identity provider — mutually exclusive with password/token_login auth — is squarely authentication, not generic user-data management.
