---
id: cht-core-10494
category: improvement
domain: authentication
domainFit: strong
issueNumber: 10494
issueUrl: https://github.com/medic/cht-core/issues/10494
title: Block token_login links for Safari users and show an unsupported-browser message
lastUpdated: '2026-10-05'
summary: 'Token login links opened in Safari still authenticated successfully even though regular login fields are already hidden for Safari users (from #6784). This extends the Safari block to the token_login page. The login script now runs the browser check first and does not send the token-login request from Safari, and the page renders a matching unsupported-browser message. The block is client-side only.'
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
related_issues:
  - cht-core-6784
stale: false
---

## Problem

After #6784 hid login fields for Safari users, the token_login path was left uncovered: a token_login link opened in Safari would still complete authentication, putting Safari users into a flow that is otherwise intentionally blocked/unsupported. The behavior was inconsistent with the main login page.

## Root Cause

The shared login script (api/src/public/login/script.js) is also loaded by api/src/templates/login/token-login.html. Its `DOMContentLoaded` handler called `requestTokenLogin()`, which POSTs to `document.getElementById('tokenLogin')?.action` (the token URL, rendered from `req.url`), before `checkUnsupportedBrowser()`, so the Safari check from #6784 ran only after the login request had been sent. api/src/templates/login/token-login.html also lacked the `id="unsupported-browser"` element and the lib-bowser.js include. In api/src/controllers/login.js, the `tokenLogin` template's `translationStrings` had no unsupported-browser keys, so the message could not render there. Neither before nor after this PR does the server-side token-login handler check the user agent.

## Solution

- api/src/public/login/script.js: added `shouldBlockBrowser()`, which at this PR returns `isSafariBrowser()`, and moved `checkUnsupportedBrowser()` ahead of the token-login branch of the `DOMContentLoaded` handler. It now calls `requestTokenLogin()` only when `!shouldBlockBrowser()`. On Safari, `checkUnsupportedBrowser()` now also hides `.locale-wrapper .loading`, the token page's "Logging you in. Please wait." text and spinner, alongside the login form's `getElementById('login-fields')` wrapper.
- api/src/templates/login/token-login.html: added the `id="unsupported-browser"` paragraph and a `<script src="/login/lib-bowser.js">` include.
- api/src/controllers/login.js: added `login.unsupported_browser` and `login.unsupported_browser.safari` to the `tokenLogin` template's `translationStrings`, so the message text reaches that page.

The block is client-side. The script withholds the token POST, and the token-login endpoint itself is unchanged.

## Code Patterns

Run the browser check before any action that fires on page load. In api/src/public/login/script.js, `checkUnsupportedBrowser()` runs first, and the auto-submitting `requestTokenLogin()` is gated on `!shouldBlockBrowser()`, which reuses `isSafariBrowser()` from #6784. Each server-rendered login template receives only the translation keys listed in its entry of the `templates` object in api/src/controllers/login.js (read as `templates[page].translationStrings`). Showing a message on another page therefore needs its keys added there as well as the element in the template (api/src/templates/login/token-login.html).

## Design Choices

Mirror the main login page's Safari-blocking UX and messaging rather than inventing a separate token_login flow, keeping the experience consistent across all login entry points and reusing the prior #6784 detection rather than introducing new detection logic. The new `shouldBlockBrowser()` only wraps `isSafariBrowser()`, so the token gate names a policy rather than a browser (the reviewer asked for "a function that will return whether the app is safe to use or not", with Safari the only case at this point). It is kept separate from `checkUnsupportedBrowser()` because that function returns early when `selectedLocale` is unset and only shows the message and hides elements; the reviewer required a block that does not depend on translations (PR #10502 review thread on script.js:207, 2026-01-12; commit c124751d34). At this PR, `checkUnsupportedBrowser()` still tests `isSafari` directly when hiding elements. On master, PR #10992 extended `shouldBlockBrowser()` to also return true for Chrome below 90, and `checkUnsupportedBrowser()` now uses it too.

## Related Files

- api/src/controllers/login.js
- api/src/public/login/script.js
- api/src/templates/login/token-login.html

## Testing

No tests were added or changed. The diff touches only api/src/controllers/login.js, api/src/public/login/script.js and api/src/templates/login/token-login.html.

## Related Issues

- #10494: "Prevent logging in with token in Safari Browser" — this draft's issue
- #6784: "Alert Safari users CHT doesn't support their browser" — the prior change (PR #10414) that added `isSafariBrowser()` and hid the main login page's fields, which this PR extends to token login

## Domain Rationale

**Fit:** strong

The PR decides whether a token login can happen in Safari: the token-login page's script no longer submits the token there (#10494, "Prevent logging in with token in Safari Browser"). That gates a login mechanism, which is authentication. Enforcement is client-side only: the token-login endpoint is unchanged and performs no browser check, and no credential, session or token handling changed.
