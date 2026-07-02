---
id: cht-core-9131
category: bug
domain: authentication
domainFit: strong
issueNumber: 9131
issueUrl: https://github.com/medic/cht-core/issues/9131
title: Detect and reject unsafe (double-slash / protocol-relative) redirect URLs on login
lastUpdated: '2026-06-23'
summary: The login controller accepted a redirect target without validating it was same-origin, allowing protocol-relative (double-slash) URLs to silently send users to external sites after login. The fix detects such unsafe redirections and blocks them.
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
stale: false
---

## Problem

After a successful login, the API login controller redirected users to a client-supplied redirect target. Targets that were protocol-relative (e.g. starting with `//` or `/\`) were treated by browsers as absolute external URLs, so a crafted login link could redirect an authenticated user to an attacker-controlled domain (open redirect / phishing vector).

## Root Cause

The redirect-target validation in api/src/controllers/login.js only confirmed the value began with a slash and did not account for double-slash / protocol-relative URLs, which browsers resolve to an external origin rather than a local path.

## Solution

Added detection of unsafe redirection in the login controller so that protocol-relative / double-slash redirect targets are recognized as non-local and rejected (falling back to a safe default) instead of being honored, ensuring only same-origin relative paths are used for the post-login redirect.

## Code Patterns

Server-side redirect-safety check in api/src/controllers/login.js: treat a redirect target as unsafe unless it is a single-leading-slash, same-origin relative path — explicitly reject `//`/`/\` (protocol-relative) prefixes before issuing the redirect.

## Design Choices

Validation is enforced server-side in the login controller rather than relying on the client, and unsafe targets are rejected in favor of a safe default rather than attempting to rewrite them, keeping the allow-list to genuine same-origin relative paths.

## Related Files

- api/src/controllers/login.js
- api/tests/mocha/controllers/login.spec.js

## Testing

Mocha unit tests in api/tests/mocha/controllers/login.spec.js were added/updated to cover unsafe redirect detection, asserting that double-slash / protocol-relative targets are rejected while legitimate same-origin relative paths are still honored.

## Related Issues

- #9122: detect double-slash redirection on login (open-redirect vulnerability)

## Domain Rationale

**Fit:** strong

The change hardens the login controller's post-authentication redirect handling against open-redirect attacks; login flow and redirect validation are core authentication concerns.
