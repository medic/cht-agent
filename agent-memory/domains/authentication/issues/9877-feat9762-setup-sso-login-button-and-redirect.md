---
id: cht-core-9762
category: feature
domain: authentication
domainFit: strong
issueNumber: 9762
issueUrl: https://github.com/medic/cht-core/issues/9762
title: Add 'Login with SSO' button to login page that redirects to a configured OIDC provider
lastUpdated: '2026-06-22'
summary: When an OIDC provider is configured for a CHT instance there was no way to initiate SSO from the login page. This PR adds a 'Login with SSO' button that, when OIDC is configured, redirects the user to the provider's authorization URL, plus translations for the new button across 10 locales.
services:
  - api
techStack:
  - javascript
  - nodejs
  - openid-client
  - oidc
  - html
tags:
  - sso
  - oidc
  - openid-connect
  - login
  - authentication
  - redirect
  - single-sign-on
related_workflows: []
source_pr: medic/cht-core#9877
source_sha: d60a08fdd58a5095fb97a2adf036b33556bc67ca
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - api/src/controllers/login.js
  - api/src/public/login/script.js
  - api/src/services/settings.js
  - api/src/templates/login/index.html
concepts:
  - OpenID Connect (OIDC)
  - single sign-on (SSO)
  - authorization URL redirect
  - login flow
  - openid-client integration
  - conditional UI rendering based on settings
related_issues: []
stale: false
---

## Problem

When an OIDC provider was configured for a CHT instance, the login page offered no way for users to authenticate via SSO — only username/password login was available, so users could not be redirected to their SSO provider's login page.

## Root Cause

Feature gap rather than a defect: the login template, controller, and client script had no UI element or redirect logic to detect a configured OIDC provider and send the user to the provider's authorization endpoint.

## Solution

Added a 'Login with SSO' button to the login page template that is shown when an OIDC provider is configured. The login controller/settings service detect the OIDC configuration and the flow redirects the user to the provider's authorization URL (built via openid-client, e.g. buildAuthorizationUrl). Button text was internationalised across 10 locale property files.

## Code Patterns

Conditionally render the SSO button based on whether an OIDC provider is configured (api/src/templates/login/index.html driven by api/src/services/settings.js); build and issue the provider authorization-URL redirect in api/src/controllers/login.js using openid-client; client-side handling in api/src/public/login/script.js.

## Design Choices

Per issue #9762, the redirect URL is obtained from openid-client (buildAuthorizationUrl) and the OIDC client_secret is intended to be stored/loaded as a CHT credential rather than plain config. The SSO button is gated on OIDC being configured so existing password login is unaffected (backwards compatible). Reviewer (jkuester) applied a simplification before merge.

## Related Files

- api/package.json
- api/src/controllers/login.js
- api/src/public/login/script.js
- api/src/services/settings.js
- api/src/templates/login/index.html
- api/tests/mocha/controllers/login.spec.js
- api/resources/translations/messages-en.properties

## Testing

Unit tests added/modified in api/tests/mocha/controllers/login.spec.js (Mocha) covering the login controller's SSO button/redirect behaviour.

## Related Issues

- #9762: Show a 'Login with SSO' button on the login page when an OIDC provider is configured, redirecting the user to the SSO login page

## Domain Rationale

**Fit:** strong

The PR adds an SSO/OIDC login flow — a 'Login with SSO' button and redirect to the OIDC provider's authorization endpoint — which is squarely authentication. The translation files are incidental i18n for the new button text, not the PR's primary purpose, so they don't pull this toward configuration.
