---
id: cht-core-9983
category: improvement
domain: authentication
domainFit: strong
issueNumber: 9983
issueUrl: https://github.com/medic/cht-core/issues/9983
title: Require app_url config when token login (or OIDC) is enabled and read it from config instead of the request
lastUpdated: '2026-06-22'
summary: Token login previously fell back to deriving the login URL from the incoming request when app_url was unset, threading an appUrl parameter through multiple methods. The PR makes app_url a required setting for token login and OIDC and reads it directly from configuration, removing the parameter — a breaking change gated to 5.0.0.
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
  - app-settings configuration validation
  - single source of truth for app_url
  - breaking API/config change
related_issues: []
stale: false
---

## Problem

Enabling token login did not require the app_url setting to be configured. When app_url was absent, the code fell back to deriving the login URL from the incoming HTTP request, which forced an appUrl parameter to be passed through several methods (controllers, server-utils, token-login lib, and the create_user_for_contacts transition) and made the code messy and error-prone.

## Root Cause

token-login methods accepted an appUrl argument that could be reconstructed from the request when app_url was not set in configuration, so the URL had multiple possible sources and had to be threaded through the login/user-creation call chain along with request-based fallback logic in server-utils.

## Solution

Refactored the user-management token-login module to read app_url directly from configuration, removed the appUrl parameter from the affected methods and from the create_user_for_contacts transition, and added validation that makes app_url a required setting when enabling token login or the new OIDC functionality. The behavior change is breaking and was gated for the 5.0.0 major release.

## Code Patterns

Read app_url from the configuration service as a single source of truth rather than passing it as a parameter or deriving it from the request; validate-on-enable pattern that rejects enabling token_login/oidc when app_url is missing (shared-libs/user-management/src/token-login.js, shared-libs/user-management/src/users.js, api/src/server-utils.js).

## Design Choices

Chose to require app_url and source it from config rather than continue the request-based fallback, giving a single source of truth, simpler call signatures, and consistent handling for both token login and OIDC. Accepted that this is a breaking change and deferred merge to the 5.0.0 major release rather than preserving backward-compatible fallback.

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

Updated and added Mocha unit tests for token-login, users, login and server-utils to reflect the removed appUrl parameter and the new required-app_url validation, updated the create_user_for_contacts transition unit tests, and updated the api login integration test (tests/integration/api/controllers/login.spec.js).

## Related Issues

- #9983: Require app_url to be configured when token login is enabled instead of falling back to the request URL

## Domain Rationale

**Fit:** strong

Token login and OIDC are authentication mechanisms; this PR governs how those login flows can be enabled and how the login URL is sourced. Although app_url is an app-setting value, the subject matter is the authentication feature itself, not general configuration, so it is a strong fit for authentication rather than configuration.
