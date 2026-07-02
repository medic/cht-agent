---
id: cht-core-9764
category: improvement
domain: authentication
domainFit: strong
issueNumber: 9764
issueUrl: https://github.com/medic/cht-core/issues/9764
title: Block OIDC-configured users from authenticating via the token_login flow
lastUpdated: '2026-06-22'
summary: Users with an oidc_provider set could still complete the token_login flow and receive a valid session, bypassing the intended OIDC-only authentication path. The token login flow now rejects such users before any session is issued.
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
related_issues: []
stale: false
---

## Problem

A user whose account has an oidc_provider value configured was still able to authenticate through the token_login flow and be granted a valid session. OIDC users are meant to authenticate through their OIDC provider only, so allowing token login created an inconsistent and insecure secondary authentication path. Per issue #9764, the tokenPost handler performed/issued the session without first verifying the user was not an OIDC user.

## Root Cause

The tokenPost handler in api/src/controllers/login.js and the loginByToken logic in shared-libs/user-management/src/token-login.js did not inspect the user document's oidc_provider field before validating the token and creating a session — there was no guard enforcing mutual exclusivity between OIDC authentication and token login.

## Solution

Added a check in the token login path that rejects the login when the target user document has an oidc_provider value set, performing this check before a valid session is issued (fail-closed). Also refactored loginByToken to use consistent async/await in place of mixed promise handling.

## Code Patterns

Early guard-clause pattern: inspect user.oidc_provider near the start of the token login path (shared-libs/user-management/src/token-login.js loginByToken and api/src/controllers/login.js tokenPost) and short-circuit/reject before session creation rather than after. Promise-chain-to-async/await normalization within loginByToken.

## Design Choices

The OIDC check is placed before session issuance (fail-closed) so no valid session is ever created for an OIDC user, rather than validating and revoking afterward. New code intentionally mirrors existing implementation and test conventions in the login controller and token-login lib (per reviewer feedback), keeping the guard consistent with surrounding patterns.

## Related Files

- api/src/controllers/login.js
- api/tests/mocha/controllers/login.spec.js
- shared-libs/user-management/src/token-login.js
- shared-libs/user-management/test/unit/token-login.spec.js
- tests/integration/api/controllers/login.spec.js

## Testing

Unit tests added/updated for the login controller (api/tests/mocha/controllers/login.spec.js) and the token-login shared lib (shared-libs/user-management/test/unit/token-login.spec.js), plus integration coverage in tests/integration/api/controllers/login.spec.js, verifying that token login is rejected for users with oidc_provider set and that no session is issued.

## Related Issues

- #9764: tokenPost should check the user's oidc_provider before giving the user a valid session

## Domain Rationale

**Fit:** strong

The PR modifies the token-based login flow and session-issuance logic to reject users configured with an OIDC provider — this is core authentication/session-management behavior, squarely in the authentication domain.
