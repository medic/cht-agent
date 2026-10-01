---
id: cht-core-9122
category: bug
domain: authentication
domainFit: strong
issueNumber: 9122
issueUrl: https://github.com/medic/cht-core/issues/9122
title: Detect and reject unsafe (double-slash / protocol-relative) redirect URLs on login
lastUpdated: '2026-09-29'
summary: The login controller reduced a requested post-login redirect to its path and hash, but a URL whose path itself began with a double slash (typically the CHT host's own URL) came back as a protocol-relative //other-host/... URL, which the browser follows to another site after login. The fix rejects any requested redirect whose path or hash contains a double slash, after repeated percent-decoding, and falls back to the user's home URL.
services:
  - api
techStack:
  - javascript
  - node.js
  - express
tags:
  - open-redirect
  - security
  - login
  - redirect-validation
  - url-sanitization
  - double-slash
related_workflows: []
source_pr: medic/cht-core#9131
source_sha: b565e13433fdcde4f2e61d47ff96641d7904a5f5
distilled_at: '2026-06-23'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - api/src/controllers/login.js
concepts:
  - open redirect prevention
  - post-login redirect validation
  - same-origin URL validation
  - protocol-relative URL handling
related_issues: []
stale: true
---

## Problem

After a successful login, the API login controller answers the login POST with a redirect URL derived from the client-supplied `redirect` value, and the login page script navigates to it (`window.location = xmlhttp.response`). A URL whose path begins with a double slash, such as the same-host `https://demo-cht.dev.medicmobile.org//MYFAKESITE.com/phishing-example/login/`, came back as the protocol-relative `//MYFAKESITE.com/phishing-example/login/`, which browsers treat as another host. A crafted login link could therefore send a freshly authenticated user to an attacker-controlled site (open redirect / phishing vector). The issue's details are in a private tracker.

## Root Cause

At this PR's parent, `getRedirectUrl` (params `userCtx`, `requested`) in api/src/controllers/login.js ran `url.resolve('/', requested)`, parsed the result against a dummy `resolve://` base, and returned `parsed.pathname + (parsed.hash || '')`. That drops any scheme and host, and a requested value that itself starts with `//host` resolves to just its path. A double slash inside the path was kept, though, so the returned string could start with `//`.

## Solution

`getRedirectUrl()` now delegates to `sanitizeRequestedRedirect()`. That function resolves the value with `resolveUrl()`, which at this PR is a try/catch around `url.resolve('/', requested)` (on master, since the ESLint 9 bump in PR #10066, it builds `new URL(requested, new URL('/', 'resolve://'))` instead). It then takes `parsed.pathname + (parsed.hash || '')` as before and rejects the result when `hasDoubleSlash()` finds `//` anywhere in it. `hasDoubleSlash()` keeps percent-decoding while decoding still changes the string, so encoded and double-encoded slashes are caught too. A rejected or unresolvable value falls back to the user's home URL (`getHomeUrl(userCtx)`), so only same-origin paths without `//` are honored.

## Code Patterns

Server-side redirect sanitizing in api/src/controllers/login.js. Reduce the requested target to its path and hash, dropping scheme and host. Then reject it outright if it contains `//` anywhere after recursive percent-decoding (`hasDoubleSlash()`), and fall back to the home URL rather than trying to repair it. Rejecting any `//`, not just a leading one, also refuses otherwise harmless paths such as `/a//b`.

## Design Choices

Validation is enforced server-side in the login controller, and unsafe targets are rejected in favor of the home URL rather than rewritten (for example by collapsing slashes), keeping the allow-list to genuine same-origin relative paths. Only the server-side `getRedirectUrl()` changed. The client-side `getRedirectUrl()` in api/src/public/login/script.js returns the raw `redirect` query parameter when the `username` query parameter matches the entered username. `checkSession()` also uses it to send an already-logged-in user onward (`window.location = getRedirectUrl() || userCtx.home || '/'`), and this PR left it untouched.

## Related Files

- api/src/controllers/login.js
- api/tests/mocha/controllers/login.spec.js

## Testing

Added two cases to the existing table-driven tests (`Bad URL "${given}" should redirect to root`) for `getRedirectUrl` in api/tests/mocha/controllers/login.spec.js, both expected to return `/`:
- `https://demo-cht.dev.medicmobile.org//MYFAKESITE.com/phishing-example/login/`
- a fully percent-encoded `https://demo-cht.dev.medicmobile.org/%2F%61%6C…` path

The existing `Good URL "${requested}" should redirect unchanged` cases were not modified and cover the paths that must still be honored.

## Related Issues

- #9122: "Protect against redirection attack" — this draft's issue (labelled Type: Security; the details are in a private tracker)

## Domain Rationale

**Fit:** strong

The change hardens the login controller's post-authentication redirect handling against open-redirect attacks; login flow and redirect validation are core authentication concerns.
