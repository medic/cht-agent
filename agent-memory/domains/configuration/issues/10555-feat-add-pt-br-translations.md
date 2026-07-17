---
id: cht-core-10556
category: feature
domain: configuration
domainFit: strong
issueNumber: 10556
issueUrl: https://github.com/medic/cht-core/issues/10556
title: Add Brazilian Portuguese (pt-BR) translations and register the pt locale
lastUpdated: '2026-06-22'
summary: CHT Core shipped no Portuguese translations despite deployment in Lusophone geographies. This PR adds a Brazilian Portuguese messages properties file and registers the `pt` locale across the API translation loader and the webapp bootstrapper, Enketo, and Angular entry points.
services:
  - api
  - webapp
techStack:
  - javascript
  - typescript
  - angular
  - enketo
  - i18n
tags:
  - translations
  - i18n
  - localization
  - portuguese
  - pt-BR
  - locale
related_workflows: []
source_pr: medic/cht-core#10555
source_sha: c6242118cd2a847ad1302f2b065cc2beac54dba3
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - api/resources/translations/messages-pt.properties
  - api/src/translations.js
  - webapp/src/js/bootstrapper/translator.js
  - webapp/src/js/enketo/main.js
  - webapp/src/ts/main.ts
concepts:
  - internationalization (i18n)
  - localization
  - locale registration
  - translation properties files
related_issues: []
stale: false
---

## Problem

There were no Portuguese translations in CHT Core, leaving the UI unlocalized for users in Portuguese-speaking regions where the CHT is deployed (e.g. Mozambique, Angola, and the six African countries with Portuguese as an official language).

## Root Cause

Not a defect: the `pt` locale had never been added — no messages-pt.properties file existed and the locale was not registered in the translation-loading entry points.

## Solution

Added api/resources/translations/messages-pt.properties with Brazilian Portuguese translations (AI-assisted, using the existing Spanish and English translations as reference) and registered the `pt` locale in the translation loader (api/src/translations.js) and the three webapp entry points: the bootstrapper translator, Enketo main, and the Angular main.ts.

## Code Patterns

To add a new UI language: drop a messages-<locale>.properties file into api/resources/translations and register the locale code in each translation entry point — api/src/translations.js, webapp/src/js/bootstrapper/translator.js, webapp/src/js/enketo/main.js, and webapp/src/ts/main.ts — mirroring an existing locale's registration.

## Design Choices

Used the `pt` extension rather than `pt-BR`/`pt-PT` since separate Portugal-Portuguese translations are unlikely in the short term for CHT's target regions. Chose Brazilian Portuguese conventions (e.g. "usuário" over "utilizador", "senha" over "palavra-passe") as more widely understood across Lusophone Africa. Included an explicit AI-disclosure comment documenting Claude-assisted authorship as a reference pattern.

## Related Files

- api/resources/translations/messages-pt.properties
- api/src/translations.js
- webapp/src/js/bootstrapper/translator.js
- webapp/src/js/enketo/main.js
- webapp/src/ts/main.ts

## Testing

PR checklist reports the change was verified for UI/UX backwards compatibility (new default navigation and legacy navigation via can_view_old_navigation), RTL layout, and full internationalization of user-facing text; no automated test files appear in the diff.

## Related Issues

- #10556: Feature request to add Brazilian Portuguese, since the CHT is used in Portuguese-speaking geographies (e.g. Mozambique) and six African countries have Portuguese as an official language

## Domain Rationale

**Fit:** strong

Adding translations and registering a new locale is canonically the configuration domain; this is a textbook strong fit, not a catch-all pick.
