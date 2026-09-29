---
id: cht-core-9762
category: feature
domain: authentication
domainFit: strong
issueNumber: 9762
issueUrl: https://github.com/medic/cht-core/issues/9762
title: Add a 'Login with SSO' button to the login page, shown only when an OIDC provider is configured
lastUpdated: '2026-09-29'
summary: 'When an OIDC provider is configured for a CHT instance there was no way to initiate SSO from the login page. This PR adds a ''Login with SSO'' button, rendered only when app_settings has `oidc_provider`, whose click handler sends the browser to /medic/login/oidc (a route that did not exist yet at this PR; PR #9833 added it and rerouted the button through login/oidc/authorize), plus the `login.sso` translation key in nine locale files.'
services:
  - api
techStack:
  - javascript
  - nodejs
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
  - client-side redirect to the SSO login endpoint
  - login flow
  - conditional UI rendering based on settings
related_issues:
  - cht-core-9735
  - cht-core-9765
  - cht-core-9890
stale: true
---

> **Epic child.** PR #9877 was squash-merged into the feature branch `9735_sso`
> (`d60a08fdd`, 2025-04-16), not into master. That branch reached master as PR #9955
> (`2cbe9c109`, 2025-06-03). Its own PR number is stamped nowhere on master, which is
> why this draft's `source_sha` does not resolve in a plain clone. Fetch it with
> `git fetch origin +refs/pull/9955/head:refs/verify/pr9955` — the epic PR's head ref.

> **Superseded before landing (`stale-as-written`):** two pieces of this PR did not reach
> master. `getSSOLoginUrl` in api/src/public/login/script.js was replaced by PR #9833
> (`bd9b23243`) with `requestSSOLogin`, which requests `/medic/login/oidc/authorize` and
> navigates to the provider URL it returns. `hasOidcProvider()` in api/src/services/settings.js
> was removed by PR #9961 (`4b77459de`); since then `renderLogin` passes
> `hasOidcProvider: ssoLogin.isSsoLoginEnabled()` from `@medic/user-management` (true when
> `oidc_provider` is set). The template variable `hasOidcProvider`, the `id="login-sso"` button
> and the `login.sso` key are still on master.

## Problem

When an OIDC provider was configured for a CHT instance, the login page offered no way for users to authenticate via SSO — only username/password login was available, so users could not be redirected to their SSO provider's login page.

## Root Cause

Feature gap rather than a defect: the login template, controller, and client script had no UI element or redirect logic to detect a configured OIDC provider and send the user to the provider's authorization endpoint.

## Solution

Added a 'Login with SSO' button to the login page template that is shown when an OIDC provider is configured: a new `hasOidcProvider()` in api/src/services/settings.js (removed before landing) returns `!!settings?.oidc_provider`, `renderLogin` in api/src/controllers/login.js (now async) passes its result to the template as `hasOidcProvider`, and api/src/templates/login/index.html renders `<button id="login-sso" class="btn" translate="login.sso">` inside `<% if(hasOidcProvider) { %>`, just after the login form. In api/src/public/login/script.js a click listener on `document.getElementById('login-sso')` calls `getSSOLoginUrl()` (replaced before landing by `requestSSOLogin`), which sets `window.location.href = '/medic/login/oidc'`. The API has no such route at this PR (PR #9833 added it), and no authorization URL is built here: `openid-client` is not yet a dependency of api or the root package. The `login.sso` key was added to nine locale files (ar, bm, en, es, fr, hi, id, ne, sw), with text in en, es, fr, ne and sw and empty values in ar, bm, hi and id. api/package.json's `run-watch` script now passes `-e js,json,html,properties` to nodemon, so template and translation edits also restart the dev server.

## Code Patterns

Conditionally render the SSO button based on whether an OIDC provider is configured (api/src/templates/login/index.html, with the flag computed at this PR by `hasOidcProvider()` in api/src/services/settings.js and passed in by `renderLogin` in api/src/controllers/login.js); client-side navigation to the SSO endpoint in api/src/public/login/script.js.

## Design Choices

The issue proposed obtaining the redirect URL from `openid-client` and storing the OIDC client_secret as a CHT credential; neither is in this PR, and both arrived with PR #9833. The SSO button is gated on OIDC being configured so existing password login is unaffected (backwards compatible). At this PR, and still at the epic squash `2cbe9c109`, the `getElementById('login-sso')` listener is attached without a null check, so on a login page rendered without the button the `DOMContentLoaded` handler throws before `checkUnsupportedBrowser()` runs; master guards it (`if (ssoLoginButton)`) since PR #10414.

## Related Files

- api/package.json
- api/src/controllers/login.js
- api/src/public/login/script.js (its `getSSOLoginUrl` was replaced before landing by `requestSSOLogin`, PR #9833)
- api/src/services/settings.js (its `hasOidcProvider()` was removed before landing by PR #9961)
- api/src/templates/login/index.html
- api/tests/mocha/controllers/login.spec.js
- api/resources/translations/messages-en.properties

## Testing

Updated api/tests/mocha/controllers/login.spec.js (Mocha): at this PR the `get` and `renderLogin` suites stub the settings service's `hasOidcProvider` (`sinon.stub(settings, 'hasOidcProvider').resolves(false)`) and assert it is called on each render. No test exercises the SSO button (`id="login-sso"`) or its click handler.

## Related Issues

- #9762: "Update CHT login page to have button for redirecting to OIDC provider" — the issue this PR implements (the button and a client-side redirect; the redirect to the provider itself came with PR #9833)
- #9765: "Add support to the CHT api for new endpoint for OIDC login" — delivered the /medic/login/oidc endpoint this button targets, plus the login/oidc/authorize step (PR #9833)
- #9735: "Single sign on (SSO) using identity provider" — the parent epic; this PR reached master inside PR #9955
- #9890: "Ensure proper mapping for SSO users to Couch users" — removed this PR's `settings.hasOidcProvider()`; the login render passes `hasOidcProvider: ssoLogin.isSsoLoginEnabled()` instead (PR #9961)

## Domain Rationale

**Fit:** strong

The PR adds the SSO entry point to the login page — a 'Login with SSO' button, gated on OIDC being configured, that starts the SSO login — which is squarely authentication. The translation files are incidental i18n for the new button text, not the PR's primary purpose, so they don't pull this toward configuration.
