---
id: cht-core-9844
category: feature
domain: forms-and-reports
domainFit: strong
issueNumber: 9844
issueUrl: https://github.com/medic/cht-core/issues/9844
title: Add extension-lib support to the cht-form web component and fix runtime/cancel errors when loading forms
lastUpdated: '2026-06-22'
summary: The cht-form web component failed to load forms that use extension-libs and hit runtime errors from an unstubbed language service. This PR injects extension-lib functions into cht-form, stubs the language service, and reworks the cancel logic broken by Angular's web-component property debouncing.
services:
  - webapp
techStack:
  - typescript
  - angular
  - enketo
  - web-components
  - webdriverio
  - karma
tags:
  - extension-libs
  - cht-form
  - enketo
  - form-rendering
  - web-component
  - language-service
  - cancel-logic
related_workflows:
  - form-submission
  - ui-extensions
source_pr: medic/cht-core#9840
source_sha: e73d2e3036c34f2936f4b92d387300650262926c
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - webapp/web-components/cht-form/src/app.component.ts
  - webapp/src/ts/services/enketo.service.ts
  - webapp/src/ts/services/form.service.ts
  - webapp/web-components/cht-form/src/stubs/language.service.ts
  - webapp/web-components/cht-form/src/stubs/cht-datasource.service.ts
concepts:
  - Enketo extension-libs (injected XPath/JS functions in form context)
  - standalone web component service stubbing/mocking
  - Angular Elements property-set debouncing
  - form load and cancel lifecycle
  - Angular custom element (cht-form) packaging
related_issues: []
stale: false
---

## Problem

The cht-form web component (used outside the main webapp, e.g. in the cht-conf-test-harness) could not load forms that reference extension-libs — the extension-lib functions were not available in the form context, causing failures. It also threw runtime errors because the language service was not stubbed, and after the recent Angular uplift the form 'cancel' logic stopped working correctly.

## Root Cause

cht-form never injected extension-lib functions into the Enketo form-evaluation context, so forms depending on them failed to load. The language service was unstubbed in the standalone web component, producing runtime errors. The cancel logic relied on repeatedly setting a web component property to the same value, but the Angular uplift introduced de-bouncing of duplicate property sets, so the repeated set was dropped and cancel no longer fired.

## Solution

Added support for injecting extension-lib functions into cht-form and wired them through the form/enketo services so forms can call them. Mocked out the language service (plus related stubs) to eliminate runtime errors. Reworked the cancel logic to tolerate the new web-component property de-bouncing behavior, and restructured the integration tests so multiple forms can be submitted in a single test without reloading the page, guarding the cancel behavior against future regressions.

## Code Patterns

Stub services for the standalone cht-form web component under webapp/web-components/cht-form/src/stubs/ (language.service.ts, cht-datasource.service.ts) instead of pulling in full webapp services. Inject extension-lib functions through webapp/src/ts/services/enketo.service.ts and form.service.ts so the cht-form app.component.ts can pass them into the Enketo form context. Integration tests submit multiple forms per spec without page reloads to exercise repeated load/cancel cycles.

## Design Choices

Chose to fully support extension-libs by injecting the functions rather than the alternative of stubbing them out (noted in issue #9844), so harness-loaded forms behave like the real app. Reworked the cancel/property handling to accommodate Angular Elements' duplicate-value de-bouncing rather than reverting the Angular uplift, and avoided per-form page reloads in tests to keep cancel coverage realistic.

## Related Files

- webapp/web-components/cht-form/src/app.component.ts
- webapp/web-components/cht-form/src/stubs/language.service.ts
- webapp/web-components/cht-form/src/stubs/cht-datasource.service.ts
- webapp/src/ts/services/enketo.service.ts
- webapp/src/ts/services/form.service.ts
- webapp/src/ts/components/training-cards-form/training-cards-form.component.ts
- webapp/src/ts/modules/contacts/contacts-edit.component.ts
- webapp/src/ts/modules/contacts/contacts-report.component.ts
- webapp/src/ts/modules/reports/reports-add.component.ts
- webapp/src/ts/modules/tasks/tasks-content.component.ts
- tests/integration/cht-form/default/with-extension-libs.wdio-spec.js
- tests/integration/cht-form/default/forms/with-extension-libs.xlsx
- tests/integration/cht-form/default/forms/with-extension-libs.xml
- tests/integration/cht-form/default/person-edit.wdio-spec.js
- tests/integration/cht-form/wdio.conf.js
- tests/integration/cht-form/mock-config.js
- webapp/web-components/cht-form/tsconfig.app.json

## Testing

Added a new integration spec (with-extension-libs.wdio-spec.js) plus a matching test form (with-extension-libs.xlsx/.xml) to verify extension-lib-backed forms load. Reworked person-edit.wdio-spec.js, wdio.conf.js, and mock-config.js so multiple forms can be submitted in one test without page reloads, protecting the cancel logic from regressions. Updated/added karma unit tests for enketo.service, form.service, the cht-form app.component, and the stub services (cht-datasource.service, db.service, language.service).

## Related Issues

- #9844: cht-form web component does not support extension-libs in loaded forms; request to inject extension-lib functions usable from within forms

## Domain Rationale

**Fit:** strong

The change is squarely about loading and rendering Enketo forms in the cht-form web component — injecting extension-lib functions into the form-evaluation context and fixing runtime/cancel errors during form load. The core files are form.service, enketo.service, and the cht-form app component, all form-rendering concerns rather than sync, config, or permissions.
