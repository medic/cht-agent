---
id: cht-core-10494
category: improvement
domain: authentication
domainFit: strong
issueNumber: 10494
issueUrl: https://github.com/medic/cht-core/issues/10494
title: Block token_login links for Safari users and show an unsupported-browser message
lastUpdated: '2026-06-22'
summary: 'Token login links opened in Safari still authenticated successfully even though regular login fields are already hidden for Safari users (from #6784). This extends the Safari block to the token_login flow and renders a matching unsupported-browser message.'
services:
  - api
techStack:
  - javascript
  - nodejs
  - html
tags:
  - safari
  - token-login
  - browser-detection
  - user-agent
  - login
  - unsupported-browser
related_workflows:
  - user-registration
source_pr: medic/cht-core#10502
source_sha: 03ec621fedb34c6f47bb35517492c35266632c1c
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - api/src/controllers/login.js
  - api/src/public/login/script.js
  - api/src/templates/login/token-login.html
concepts:
  - token-based (passwordless) authentication
  - user-agent based browser detection
  - Safari compatibility gating
  - consistent login-flow UX across entry points
related_issues: []
stale: false
---

## Problem

After #6784 hid login fields for Safari users, the token_login path was left uncovered: a token_login link opened in Safari would still complete authentication, putting Safari users into a flow that is otherwise intentionally blocked/unsupported. The behavior was inconsistent with the main login page.

## Root Cause

The Safari-blocking logic introduced in #6784 only guarded the main login page (hiding its fields); the token_login controller path, its template (token-login.html), and client script did not perform the same Safari user-agent check, so token-based logins proceeded normally on Safari.

## Solution

Extended the Safari detection/blocking to the token_login flow across the login controller (login.js), the client script (script.js), and the token-login.html template so that token_login is blocked on Safari and shows a message similar to the main login page. A review round caught that the translation keys for the message were not present on the page and they were added so the warning text renders correctly.

## Code Patterns

Reuse the existing Safari user-agent detection from the main login page and apply the same 'block + show unsupported-browser message' pattern to the token_login entry point in api/src/controllers/login.js, api/src/public/login/script.js, and api/src/templates/login/token-login.html; ensure the corresponding i18n translation keys are passed/rendered into the template.

## Design Choices

Mirror the main login page's Safari-blocking UX and messaging rather than inventing a separate token_login flow, keeping the experience consistent across all login entry points and reusing the prior #6784 detection rather than introducing new detection logic.

## Related Files

- api/src/controllers/login.js
- api/src/public/login/script.js
- api/src/templates/login/token-login.html

## Testing

No automated tests are evident in the changed files; verification appears manual — the reviewer spoofed the browser user-agent to Safari and loaded the token-login page, which surfaced an initial bug where the translation keys were missing from the rendered page (subsequently fixed and re-approved).

## Related Issues

- #10494: token_login links still succeed in Safari despite login fields being hidden — block them and show a message
- #6784: prior change that hid login fields for Safari users (which this PR extends to token_login)

## Domain Rationale

**Fit:** strong

token_login is the CHT passwordless/token-based authentication mechanism; blocking it for an unsupported browser is squarely a login/auth-flow concern, not config or UI extension.
