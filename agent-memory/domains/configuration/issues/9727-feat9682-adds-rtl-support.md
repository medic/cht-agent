---
id: cht-core-9682
category: feature
domain: configuration
domainFit: strong
issueNumber: 9682
issueUrl: https://github.com/medic/cht-core/issues/9682
title: Add right-to-left (RTL) language support via a configurable per-language `rtl` flag, Admin UI toggle, and RTL stylesheet
lastUpdated: '2026-06-22'
summary: CHT Core assumed every language renders left-to-right, so RTL languages like Arabic displayed with broken layout. The PR adds a configurable `rtl` boolean on language docs (Arabic defaulted to RTL), an Admin UI checkbox to set it, and an rtl.less stylesheet so the webapp renders correct RTL layouts.
services:
  - api
  - webapp
  - admin
techStack:
  - typescript
  - angular
  - javascript
  - less
  - couchdb
  - ngrx
tags:
  - rtl
  - i18n
  - internationalization
  - localization
  - languages
  - css
  - accessibility
  - arabic
  - translations
related_workflows:
  - ui-extensions
source_pr: medic/cht-core#9727
source_sha: 2175676e28ea8d6eaa232408c8fe3573c3b0ae74
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - webapp/src/css/rtl.less
  - api/src/translations.js
  - admin/src/js/controllers/edit-language.js
  - webapp/src/ts/services/language.service.ts
  - webapp/src/ts/reducers/global.ts
  - webapp/src/ts/selectors/index.ts
concepts:
  - internationalization (i18n)
  - right-to-left text/layout direction
  - per-language configuration in translation docs
  - Redux/NgRx global state propagation
  - direction-specific CSS overrides
  - locale-aware UI rendering
related_issues: []
stale: false
---

## Problem

CHT Core assumed all languages were left-to-right (English, French, etc.), so right-to-left languages such as Arabic rendered with incorrect, mis-aligned layout and unusable text direction. There was no way to mark a language as RTL.

## Root Cause

Language/translation docs had no notion of directionality, and the webapp hardcoded LTR layout assumptions — nothing read or applied a text direction based on the active language.

## Solution

Introduced a boolean `rtl` field on language docs (messages-xx); the API defaults Arabic (ar) to RTL. Added an Admin UI checkbox (edit-language) to set the flag per language. Added webapp/src/css/rtl.less with direction-specific styling and wired the active language's directionality through global actions/reducer/selectors so app.component applies the correct document direction. The login page and admin app layout were intentionally excluded.

## Code Patterns

Directionality stored per-language in the translation doc and surfaced through global state (webapp/src/ts/actions/global.ts, reducers/global.ts, selectors/index.ts), consumed by app.component.ts/html to set the document direction; RTL-only overrides isolated in webapp/src/css/rtl.less; language.service.ts resolves the rtl property from the language doc; components (analytics targets, date-filter, fast-action-button, reports-more-menu, select2-search) adapt to the direction flag.

## Design Choices

Stored directionality as an admin-configurable per-language boolean on the language doc rather than hardcoding a fixed RTL-language list, while still defaulting Arabic to RTL out of the box. Deliberately scoped out the login page and admin app to limit the blast radius of the layout changes.

## Related Files

- webapp/src/css/rtl.less
- webapp/src/css/inbox.less
- api/src/translations.js
- api/resources/translations/messages-en.properties
- admin/src/js/controllers/edit-language.js
- admin/src/templates/edit_language.html
- admin/src/templates/display_languages.html
- webapp/src/ts/services/language.service.ts
- webapp/src/ts/actions/global.ts
- webapp/src/ts/reducers/global.ts
- webapp/src/ts/selectors/index.ts
- webapp/src/ts/app.component.ts
- webapp/src/ts/app.component.html
- webapp/src/ts/providers/translation-loader.provider.ts

## Testing

Added/updated Mocha unit tests in api/tests/mocha/translations.spec.js covering the new rtl field, and Karma unit tests in the webapp for language.service, translation-loader.provider, selectors/index, fast-action-button.component, and select2-search.service.

## Related Issues

- #9682: Support right-to-left (RTL) languages like Arabic

## Domain Rationale

**Fit:** strong

The defining change is a per-language configuration setting — a boolean `rtl` field stored on the language/translation docs, defaulted for Arabic and toggleable from the Admin UI; translations and locale configuration are canonically the configuration domain. The webapp/CSS layout work is the implementation of that language config rather than a separate functional domain.
