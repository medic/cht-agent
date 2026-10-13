---
id: cht-core-9834
category: improvement
domain: authentication
domainFit: weak
issueNumber: 9834
issueUrl: https://github.com/medic/cht-core/issues/9834
title: Make the login and token-login pages switch layout direction (LTR ↔ RTL) with the selected locale without a reload, and render all three login templates with the default locale's direction
lastUpdated: '2026-09-29'
summary: The login, password-reset and token-login pages use their own JS, CSS and templates and stayed LTR for RTL languages, unlike the main webapp. The fix carries each translation doc's rtl flag into the login controller, renders <html dir> from the default locale's direction plus a data-rtl attribute on each RTL locale link, and has setDirection() in auth-utils.js set document.documentElement.dir from the selected locale's link (ltr when no such link is rendered) on load and on every locale change. RTL CSS mirrors the password field and its toggle.
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

The CHT webapp supports RTL languages, but the login page does not — it has its own JavaScript library, stylesheets, and templates for language switching. Selecting an RTL language on the login or token-login page left the layout LTR, and none of the three login templates (api/src/templates/login/index.html, api/src/templates/login/token-login.html, api/src/templates/login/password-reset.html) set `dir` on `<html>`, so RTL users got an LTR layout.

## Root Cause

The login pages are rendered independently of the main webapp with their own api/src/public/login/auth-utils.js, api/src/public/login/style.css, and templates that had no awareness of locale text direction. The login controller did not expose which locales are RTL (its `getEnabledLocales()` mapped translation docs to `{ key: doc.code, label: doc.name }` only), the client-side translation routine (baseTranslate) never set the <html dir> attribute, and the password-visibility toggle icon was absolutely positioned for LTR only.

## Solution

- api/src/controllers/login.js: `getEnabledLocales()` now maps each enabled translation doc to `{ key: doc.code, label: doc.name, rtl: doc.rtl || false }`. It no longer empties the list when fewer than two locales are enabled. `render()` does that instead: it passes `selectorLocales = locales.length < 2 ? [] : locales` as `locales` and computes `defaultLocale` via `getBestLocaleCode()`. It also passes `defaultDir`, which is `'rtl'` when the default locale's entry has `rtl` set and `'ltr'` otherwise.
- Templates: api/src/templates/login/index.html, api/src/templates/login/token-login.html and api/src/templates/login/password-reset.html render `<html dir="{{ defaultDir }}">`, and api/src/templates/login/password-reset.html drops its `lang="en"`. The `class="locale"` links in api/src/templates/login/index.html and api/src/templates/login/token-login.html get `data-rtl="true"` when `locale.rtl` is set. api/src/templates/login/password-reset.html has no locale selector.
- api/src/public/login/auth-utils.js: the new `setDirection` (`const setDirection = (locale) =>`) finds the `.locale[name="${locale}"]` link. It sets `document.documentElement.dir` to `'rtl'` if that link has `data-rtl`, else `'ltr'`. `baseTranslate()` calls it first, so it runs on load and on every locale click (`handleLocaleSelection` → `translate()` in api/src/public/login/script.js → `baseTranslate()` from api/src/public/login/auth-utils.js). It is also exported on `window.AuthUtils`. The body attributes `data-default-locale` and `data-translations` are now read via `document.body.dataset.defaultLocale` and `dataset.translations`.
- api/src/public/login/style.css: `[dir="rtl"] #password-container #password` mirrors the input padding (`6px 10px 6px 43px`). `[dir="rtl"] #password-container #password-toggle` moves the absolutely-positioned toggle to `left: 0` (`right: auto`).

## Code Patterns

Server-to-client handoff via a per-element data attribute. The controller adds `rtl` to each locale entry. In api/src/templates/login/index.html and api/src/templates/login/token-login.html the templates emit it as `data-rtl="true"` on that locale's link. Client JS reads it back: `localeLink?.dataset.rtl` in `setDirection()` (api/src/public/login/auth-utils.js). The server also renders the initial `<html dir="{{ defaultDir }}">`, so the page starts in the default locale's direction before any script runs. Reload-free direction switching: `setDirection()` is called from `baseTranslate()`, the routine that every load and locale change goes through. RTL-aware styling via [dir="rtl"] attribute selectors to mirror absolutely-positioned elements (api/src/public/login/style.css).

## Design Choices

The RTL flag comes from the `rtl` field of the `messages-*` translation docs, not from a list in the login code. The webapp reads the same field (`doc.rtl && this.languageService.setRtlLanguage(locale)` in webapp/src/ts/providers/translation-loader.provider.ts). For bundled languages, api/src/translations.js writes that field from its `RTL_LANGUAGES` list (`['ar']` at this PR), so a new bundled RTL language still needs that list updated. A translation doc that already carries `rtl: true` is picked up with no code change. Direction is switched client-side without a page reload by hooking baseTranslate, giving an instant layout flip on locale selection. As written, though, `setDirection()` takes the direction only from the matching `.locale` link. Where no such link is rendered, the client sets `ltr` once the script runs and overrides the server-rendered `dir`. That always happens on api/src/templates/login/password-reset.html, which has no locale selector and whose api/src/public/login/password-reset.js calls `baseTranslate()` on load. It also happens on api/src/templates/login/index.html and api/src/templates/login/token-login.html when fewer than two locales are enabled, because the selector is then not rendered.

## Related Files

- api/src/controllers/login.js
- api/src/public/login/auth-utils.js
- api/src/public/login/style.css
- api/src/templates/login/index.html
- api/src/templates/login/password-reset.html
- api/src/templates/login/token-login.html
- api/tests/mocha/controllers/login.spec.js

## Testing

Added two Mocha tests to api/tests/mocha/controllers/login.spec.js: 'sets defaultDir to rtl when the default locale is RTL' and 'sets defaultDir to ltr when the default locale is not RTL'. They stub `translations.getEnabledLocales()` with `rtl`-flagged docs and a `{{ defaultDir }}` template, and assert the rendered login page. There are no client-side tests for `setDirection()` or the RTL CSS.

## Related Issues

- #9834: "Make login page responsive to LTR <-> RTL switching" — this draft's issue, which asks to extend the webapp's RTL support to the login page templates and scripts

## Domain Rationale

**Fit:** weak

Every changed file serves the login, password-reset and token-login pages: the login controller, templates, client scripts and CSS under api/src/.../login. The change itself is i18n and layout, making those pages follow the locale's text direction, and it touches no credential, session or access handling. Authentication is the least-bad home because the login pages are the only surface touched. It adds no translations and registers no locales, so it is not configuration either.
