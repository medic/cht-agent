---
id: cht-core-6784
category: feature
domain: authentication
domainFit: strong
issueNumber: 6784
issueUrl: https://github.com/medic/cht-core/issues/6784
title: Show an unsupported-browser message and hide the login fields for Safari users on the login page
lastUpdated: '2026-09-29'
summary: 'Safari users could log in from the CHT login page with no warning that Safari is unsupported. The PR adds client-side user-agent Safari detection to the login page script, which shows a localized "Safari is not supported. Please use Chrome or Firefox." message and hides the login form fields. Token (magic-link) login was not covered and was left to a follow-up issue.'
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
related_issues:
  - cht-core-10494
stale: false
---

## Problem

Safari users could log in from the login page with no warning that Safari is unsupported by the CHT app, and then hit subtle, non-obvious breakage with no explanation (issue #6784). The expected message was: 'For a better app experience, please contact your administrator or supervisor. Safari is not supported. Please use Chrome or Firefox.'

## Root Cause

`checkUnsupportedBrowser()` in api/src/public/login/script.js had no Safari case. Outside cht-android, its only check was bowser's `parser.satisfies()` with `chrome: '>=90'` and `firefox: '>=98'`. That call returns `undefined` for a browser it does not list, so at most Safari got the generic `login.unsupported_browser.outdated_browser` text ("Let them know to update your browser."), and nothing hid the login form. Separately, the `DOMContentLoaded` handler called `ssoLoginButton.addEventListener('click', requestSSOLogin, false)` without a null check. The `id="login-sso"` button is rendered only `if(hasOidcProvider)` in api/src/templates/login/index.html and not at all in api/src/templates/login/token-login.html, so on the login page without an OIDC provider, and always on the token-login page, the handler threw before it reached `checkUnsupportedBrowser()`.

## Solution

The PR added `isSafariBrowser()` to api/src/public/login/script.js. It tests `navigator.userAgent` against `/^((?!chrome|android|crios|fxios).)*safari/i`, which skips user agents where `chrome`, `android`, `crios` or `fxios` appears before `safari`. For non-cht-android browsers, `checkUnsupportedBrowser()` tests it before the bowser version check and selects the new `login.unsupported_browser.safari` key. On Safari it also adds `hidden` to a new `id="login-fields"` wrapper in api/src/templates/login/index.html, which holds the username and password inputs, the error messages, and the login and SSO buttons, so the form cannot be used. api/src/controllers/login.js adds the key to the login template's `translationStrings`. The string was added to six of the nine bundled locale files: ar, en, es, fr, ne and sw, but not bm, hi or id. The PR also null-guards the `getElementById('login-sso')` listener and the `getElementById('user')` lookup, moving the page wiring into `handleLoginButton()`, `handleUserInputFocus()`, `handlePasswordInputFocus()`, `handlePasswordToggle()` and `handleServiceWorker()`. It also makes `isUsingSupportedBrowser()` return `false` instead of throwing when bowser is not loaded.

## Code Patterns

Client-side user-agent detection (`isSafariBrowser()` in api/src/public/login/script.js) feeds the existing `checkUnsupportedBrowser()`. That function writes the translated text into the `id="unsupported-browser-update"` span, un-hides the `id="unsupported-browser"` paragraph, and on Safari hides the `id="login-fields"` wrapper, all three in api/src/templates/login/index.html. A translation key reaches a login page only if it is listed in that template's `translationStrings` in api/src/controllers/login.js (`getTranslationsString()` encodes just those keys). A new message therefore needs an entry there as well as in api/resources/translations/messages-*.properties.

## Design Choices

On Safari the login form is hidden, not just accompanied by a warning. The issue asked for an alert at minimum and preferably for blocking Safari logins. The hiding is client-side only, and the API performs no browser check. In the `DOMContentLoaded` handler, `checkUnsupportedBrowser()` still runs after `requestTokenLogin()` has fired, so a token (magic-link) login still went through on Safari. That gap was left to a follow-up (#10494, PR #10502). The Safari detection lives inside the existing `checkUnsupportedBrowser()` rather than in a separate check, so all unsupported-browser handling stays in one function. The new string covers six of the nine bundled locales (not bm, hi or id).

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

No tests were added or changed. The diff touches only the six translation files, api/src/controllers/login.js, api/src/public/login/script.js and api/src/templates/login/index.html.

## Related Issues

- #6784: "Alert Safari users CHT doesn't support their browser" — this draft's issue, which asks for an alert at minimum and preferably for blocking Safari logins
- #10494: "Prevent logging in with token in Safari Browser" — the follow-up (PR #10502) that closed the token-login gap left open here

## Domain Rationale

**Fit:** strong

The PR decides whether a Safari user can log in at all: on Safari it hides the login form and shows an unsupported-browser warning, as #6784 asked (an alert at minimum, preferably blocking Safari logins). That is login-flow policy, which is authentication. Enforcement is client-side only: it changes no credential, session or token handling, and the API still accepts logins from Safari. The six translation files carry the new string and do not register locales, so this is not configuration.
