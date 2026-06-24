---
id: cht-core-10414
category: improvement
domain: authentication
domainFit: strong
issueNumber: 10414
issueUrl: https://github.com/medic/cht-core/issues/10414
title: Show unsupported-browser message for Safari users on the login page
lastUpdated: '2026-06-22'
summary: Safari users reached the CHT login page with no indication the browser is unsupported, yielding a degraded experience. Added Safari detection that displays a localized 'unsupported browser' message advising users to switch to Chrome or Firefox.
services:
  - api
techStack:
  - javascript
  - html
  - express
  - i18n
tags:
  - safari
  - browser-detection
  - login
  - unsupported-browser
  - i18n
  - user-agent
  - token-login
related_workflows: []
source_pr: medic/cht-core#10414
source_sha: 043e35d9992f0044ef5d9cbe232015e75f880def
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - api/src/controllers/login.js
  - api/src/public/login/script.js
  - api/src/templates/login/index.html
  - api/resources/translations/messages-en.properties
concepts:
  - browser detection
  - internationalization
  - server-rendered login page
  - token (magic link) login
  - unsupported browser handling
related_issues: []
stale: false
---

## Problem

On the login page, Safari users were not warned that Safari is unsupported by the CHT app, so they proceeded to a broken/degraded experience with no explanation (issue #6784). The expected message was: 'For a better app experience, please contact your administrator or supervisor. Safari is not supported. Please use Chrome or Firefox.'

## Root Cause

The login page's browser-detection logic in api/src/public/login/script.js did not identify Safari as an unsupported browser, so no warning message was rendered for Safari users on the login template.

## Solution

Added Safari detection to the login page and rendered a localized unsupported-browser message on the login template when Safari is detected. The new message string was added to all supported locale files (en, ar, es, fr, ne, sw) and wired through the login controller, client script, and HTML template. A separate error that triggered when token_login was enabled (and was breaking the e2e suite) was also fixed.

## Code Patterns

User-agent based browser detection in api/src/public/login/script.js; conditional rendering of a localized warning in api/src/templates/login/index.html driven by translation keys in api/resources/translations/messages-*.properties; controller wiring in api/src/controllers/login.js.

## Design Choices

Surface an informational warning rather than hard-blocking Safari. Reviewer (dianabarsan) noted the browser-support check runs only after token/magic-link login, so logging in via a magic link on an unsupported browser remains possible — explicitly deferred to a follow-up PR. New text was internationalised across all bundled locales rather than English-only.

## Related Files

- api/resources/translations/messages-ar.properties
- api/resources/translations/messages-en.properties
- api/resources/translations/messages-es.properties
- api/resources/translations/messages-fr.properties
- api/resources/translations/messages-ne.properties
- api/resources/translations/messages-sw.properties
- api/src/controllers/login.js
- api/src/public/login/script.js
- api/src/templates/login/index.html

## Testing

e2e tests covered the login-page behavior; they were initially failing consistently because of an error triggered when token_login was enabled, which was then fixed so the suite passed before merge.

## Related Issues

- #6784: Safari unsupported browser message missing on login page

## Domain Rationale

**Fit:** strong

The change lives entirely in the CHT login page (controller, client script, template) and interacts with the token/magic-link login flow noted in review — the login surface is canonically the authentication domain. Despite the six translation-properties files, the PR is primarily about login-page browser detection, not locale registration, so it is not configuration.
