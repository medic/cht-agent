---
id: cht-core-9683
category: feature
domain: configuration
domainFit: strong
issueNumber: 9683
issueUrl: https://github.com/medic/cht-core/issues/9683
title: Add Arabic translations and register the ar locale
lastUpdated: '2026-06-22'
summary: 'CHT Core had no Arabic translations. This PR adds a new messages-ar.properties translation file and registers the `ar` locale across the API and the webapp/bootstrapper/enketo entry points so the app can be used in Arabic (RTL rendering deferred to #9682).'
services:
  - api
  - webapp
techStack:
  - javascript
  - typescript
  - angular
  - i18n
tags:
  - translations
  - arabic
  - localization
  - i18n
  - locale-registration
related_workflows: []
source_pr: medic/cht-core#9696
source_sha: 6ba0a7d239d30b4cba752fcf0c4931a71bbdc074
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - api/resources/translations/messages-ar.properties
  - api/src/translations.js
  - webapp/src/js/bootstrapper/translator.js
  - webapp/src/js/enketo/main.js
  - webapp/src/ts/main.ts
concepts:
  - internationalization (i18n)
  - locale registration
  - translation properties files
  - enketo localization
  - bootstrapper translator locale loading
related_issues:
  - cht-core-9682
stale: false
---

## Problem

There were no Arabic translations available in CHT Core, so Arabic-speaking deployments and users could not run the app in Arabic.

## Root Cause

No messages-ar.properties translation file existed and the `ar` locale code was not registered in the API translations list nor in the webapp locale-loading entry points (bootstrapper translator, enketo, and the Angular main bootstrap).

## Solution

Added a new api/resources/translations/messages-ar.properties file with Arabic strings and registered the `ar` locale in api/src/translations.js and across the webapp entry points (bootstrapper/translator.js, enketo/main.js, ts/main.ts). RTL layout support was intentionally left out of scope and tracked under #9682.

## Code Patterns

To add a new language to CHT: (1) create api/resources/translations/messages-<locale>.properties, and (2) register the locale code in api/src/translations.js plus every webapp locale-loading entry point — webapp/src/js/bootstrapper/translator.js, webapp/src/js/enketo/main.js, and webapp/src/ts/main.ts. Note: translator.js and enketo/main.js are easy to miss when only the API and main webapp files are updated.

## Design Choices

Scope limited to translation strings and locale registration only; right-to-left (RTL) rendering for Arabic was deliberately deferred to the separate issue #9682 rather than bundled in, keeping this change additive and backwards compatible.

## Related Files

- api/resources/translations/messages-ar.properties
- api/src/translations.js
- webapp/src/js/bootstrapper/translator.js
- webapp/src/js/enketo/main.js
- webapp/src/ts/main.ts

## Testing

No automated tests were described in the PR; translations were sourced from a shared spreadsheet. Review feedback caught two unmodified locale-registration files (bootstrapper translator.js and enketo/main.js), which were then added before approval.

## Related Issues

- #9683: Tracking issue requesting an Arabic messages-ar.properties translation file
- #9682: CHT Core does not yet support RTL languages like Arabic (RTL support deferred here)

## Domain Rationale

**Fit:** strong

Adding translation strings and registering a new locale is canonically the configuration domain: the change is entirely locale registration and translation resources, with no behavioural code involved.
