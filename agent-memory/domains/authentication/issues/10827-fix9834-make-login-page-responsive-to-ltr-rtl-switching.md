---
id: cht-core-9834
category: improvement
domain: authentication
domainFit: strong
issueNumber: 9834
issueUrl: https://github.com/medic/cht-core/issues/9834
title: Make login, password-reset, and token-login pages dynamically switch layout direction (LTR ↔ RTL) on locale change without reload
lastUpdated: '2026-06-22'
summary: The login, password-reset, and token-login pages use their own JS/CSS/templates and did not flip to RTL when an RTL language was selected, unlike the main webapp. The fix extracts the RTL flag from CouchDB translation docs, passes an encoded rtlLocales array to the templates, and switches the <html dir> attribute client-side on load and every locale change, with CSS to flip the password-toggle icon.
services:
  - api
techStack:
  - javascript
  - css
  - html
  - couchdb
  - mocha
tags:
  - rtl
  - ltr
  - i18n
  - login-page
  - localization
  - bidirectional-text
  - responsive-layout
related_workflows: []
source_pr: medic/cht-core#10827
source_sha: 5b4670614d7bd46a4d47d01e30941adb3d60c3d8
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - api/src/controllers/login.js
  - api/src/public/login/auth-utils.js
  - api/src/public/login/style.css
  - api/src/templates/login/index.html
  - api/src/templates/login/password-reset.html
  - api/src/templates/login/token-login.html
concepts:
  - internationalization
  - bidirectional-text-rtl-layout
  - server-side-template-rendering
  - client-side-direction-switching
  - locale-translation-documents
  - data-attribute-server-to-client-handoff
related_issues: []
stale: false
---

## Problem

The CHT webapp supports RTL languages, but the login page does not — it has its own JavaScript library, stylesheets, and templates for language switching. Selecting an RTL language on the login, password-reset, or token-login pages left the layout in LTR, producing an incorrect direction for RTL users.

## Root Cause

The login pages are rendered independently of the main webapp with their own auth-utils.js, style.css, and templates that had no awareness of locale text direction. The login controller did not expose which locales are RTL, the client-side translation routine (baseTranslate) never set the <html dir> attribute, and the password-visibility toggle icon was absolutely positioned for LTR only.

## Solution

Backend (login.js): read the rtl flag directly from CouchDB translation documents and pass an encoded rtlLocales JSON array to the templates. Frontend (auth-utils.js): added getRtlLocales and setDirection; direction is evaluated and injected into <html dir="..."> inside baseTranslate on initial load and on every locale switch. Templates: added a data-rtl-locales attribute to index.html, token-login.html, and password-reset.html. CSS: added [dir="rtl"] overrides to flip the absolutely-positioned password visibility toggle icon. Added Mocha unit tests for the rtlLocales encoding.

## Code Patterns

Server-to-client data handoff via encoded data attribute: the controller encodes a JSON array (rtlLocales) which templates expose as data-rtl-locales and client JS reads back (api/src/controllers/login.js → templates → auth-utils.js getRtlLocales). Dynamic, reload-free direction switching: setDirection sets <html dir> from the active locale's membership in the RTL set, hooked into baseTranslate so it fires on load and every locale change. RTL-aware styling via [dir="rtl"] attribute selectors to mirror absolutely-positioned elements (api/src/public/login/style.css).

## Design Choices

The RTL flag is sourced from the CouchDB translation documents themselves (single source of truth) rather than a hardcoded list, so adding or removing RTL locales needs no code change. Direction is switched client-side without a page reload by hooking baseTranslate, giving an instant layout flip on locale selection. A reviewer (dianabarsan) raised an alternative approach inline; the discussion resolved positively before merge.

## Related Files

- api/src/controllers/login.js
- api/src/public/login/auth-utils.js
- api/src/public/login/style.css
- api/src/templates/login/index.html
- api/src/templates/login/password-reset.html
- api/src/templates/login/token-login.html
- api/tests/mocha/controllers/login.spec.js

## Testing

Added Mocha unit tests in api/tests/mocha/controllers/login.spec.js verifying that the controller correctly derives the rtlLocales array from translation documents and passes the encoded value to the templates. The PR checklist marks Tested and Internationalised as complete, and notes manual UI verification of appropriate RTL design (and backwards-compatible LTR/old-navigation rendering).

## Related Issues

- #9834: Login page does not switch to RTL layout when an RTL language is selected; request to extend the webapp's RTL support to the login page templates and scripts

## Domain Rationale

**Fit:** strong

Every changed file targets the login/password-reset/token-login pages — the authentication UI surface (login controller, templates, and client scripts under api/src/.../login). The work improves the login page's layout behavior rather than adding new translations or registering locales (which would be configuration), so authentication is the principled, strong fit.
