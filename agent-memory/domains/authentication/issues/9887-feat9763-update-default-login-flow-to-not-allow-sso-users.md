---
id: cht-core-9763
category: feature
domain: authentication
domainFit: strong
issueNumber: 9763
issueUrl: https://github.com/medic/cht-core/issues/9763
title: Block SSO/OIDC users from default password login and password reset flows
lastUpdated: '2026-06-22'
summary: SSO users could authenticate through the standard username/password login form and reset their password, bypassing their intended SSO provider. The login controller now checks the user's oidc property and blocks such users from both the default password login and the reset password flow.
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
stale: false
---

## Problem

Users provisioned for SSO (with an oidc property set) were still able to log in via the default non-SSO username/password boxes on the login page and to use the reset-password flow, allowing them to bypass their intended SSO provider authentication.

## Root Cause

The login controller's post (login) handler and reset-password handler in api/src/controllers/login.js did not inspect the user's oidc property before validating credentials, so SSO users were treated like any password-based user.

## Solution

Updated the login controller so the default password login and the reset-password flow check the user's oidc property; if it is set, the SSO user is blocked from authenticating/resetting via the standard flow and must use SSO. Logic was reworked to integrate with concurrent SSO branch changes.

## Code Patterns

Guard credential-based auth by checking the user document's oidc property before allowing login/reset in api/src/controllers/login.js — short-circuit SSO users out of the password flow.

## Design Choices

The login-controller logic became more involved than expected due to integration with a parallel SSO branch, requiring careful sequencing so the default-login block and reset-password block work together. The issue scope shifted from checking the get handler/oidc_provider to the post handler and the oidc property.

## Related Files

- api/tests/mocha/controllers/login.spec.js
- tests/integration/api/controllers/login.spec.js

## Testing

Added/updated unit tests in api/tests/mocha/controllers/login.spec.js and integration tests in tests/integration/api/controllers/login.spec.js covering that SSO/OIDC users are blocked from the default password login and password reset flows.

## Related Issues

- #9763: Block SSO users from the default login page by checking the user's oidc property in the login controller's post function, with integration tests

## Domain Rationale

**Fit:** strong

The PR modifies the login controller to gate password-based login and password reset based on a user's SSO/OIDC status — login, credential validation, and SSO provider handling are core authentication concerns.
