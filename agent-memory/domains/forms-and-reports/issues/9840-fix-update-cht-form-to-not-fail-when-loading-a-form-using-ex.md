---
id: cht-core-9844
category: improvement
domain: forms-and-reports
domainFit: strong
issueNumber: 9844
issueUrl: https://github.com/medic/cht-core/issues/9844
title: Add extension-lib support to the cht-form web component and fix runtime/cancel errors when loading forms
lastUpdated: '2026-08-09'
summary: The cht-form web component failed to load forms that use extension-libs and hit runtime errors from an unstubbed language service. This PR adds an extensionLibs input backed by a stub CHTDatasourceService, stubs the language service, turns EnketoFormContext into an interface so the web component can supply its own context, and reworks the teardown broken by Angular's web-component property debouncing.
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
  - EnketoFormContext as an interface (WebappEnketoFormContext vs ChtFormEnketoFormContext)
  - form load and cancel lifecycle
  - Angular custom element (cht-form) packaging
related_issues: []
stale: false
---

## Problem

The cht-form web component (used outside the main webapp, e.g. in the cht-conf-test-harness) could not load forms that reference extension-libs — the extension-lib functions were not available in the form context, causing failures. It also threw runtime errors because the language service was not stubbed, and after the recent Angular uplift the post-cancel teardown stopped working correctly, so a second form could not be loaded after cancelling the first.

## Root Cause

cht-form's constructor passed an empty object as the CHT API to medicXpathExtensions.init(), so `getExtensionLib` was never reachable from the Enketo form-evaluation context and forms depending on extension-libs failed to load. The language service was unstubbed in the standalone web component, producing runtime errors. Separately, cancelForm() tears the component down by resetting its inputs, but it reset the component's private fields directly; because the web-component framework skips a setter when it is handed the same value twice, a consumer re-setting an unchanged input after a cancel had that set silently dropped, so the next form did not load.

## Solution

Added an `extensionLibs` input on the cht-form component; each entry is evaluated and registered on the component's stub CHTDatasourceService, whose getSync() (exposing v1.getExtensionLib) is handed to medicXpathExtensions.init(...) so forms can call the libs as XPath functions. Mocked out the language service (plus related stubs) to eliminate runtime errors. Separately, EnketoFormContext was converted from a class into an interface in enketo.service.ts, with the webapp-only behaviour (shouldEvaluateExpression, requiresContact, userContact, editing) moved into a new WebappEnketoFormContext class in form.service.ts — that is why those two services and their five webapp call sites changed — so the web component can supply its own lightweight ChtFormEnketoFormContext. Reworked teardown to reset state "through the front door", assigning to the custom element's own properties (formXml, formHtml, formModel, contactSummary, contactType, content, formId, user, extensionLibs) so the framework registers the change, and restructured the integration tests so multiple forms can be submitted in a single test without reloading the page.

## Code Patterns

Stub services for the standalone cht-form web component under webapp/web-components/cht-form/src/stubs/ (language.service.ts, cht-datasource.service.ts) instead of pulling in full webapp services. Inject extension-lib functions via that stub CHTDatasourceService (addExtensionLib / clearExtensionLibs), which app.component.ts passes into medicXpathExtensions.init(); the libs are `new Function('module', libFn)`-evaluated at registration time. EnketoFormContext is an interface, so each surface supplies its own context object (WebappEnketoFormContext in the webapp, ChtFormEnketoFormContext in the web component). When resetting an Angular Elements custom element, write to the element's properties rather than the component's private fields, or duplicate-value sets will be swallowed. Integration tests submit multiple forms per spec without page reloads to exercise repeated load/cancel cycles.

## Design Choices

Chose to fully support extension-libs by injecting the functions rather than the alternative of stubbing them out (noted in issue #9844), so harness-loaded forms behave like the real app and consumers such as the test-harness can build their own abstractions on top. Shaped the stub to the object medic-xpath-extensions actually consumes (chtScriptApi.v1.getExtensionLib(libId)) and exposed it synchronously as getSync(), rather than reproducing the real service's async get(); that keeps webapp/src/js/enketo/medic-xpath-extensions.js unchanged and free of any web-component special-casing. Reworked the teardown/property handling to accommodate Angular Elements' duplicate-value de-bouncing rather than reverting the Angular uplift, and avoided per-form page reloads in tests to keep cancel coverage realistic.

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

Added a new integration spec (with-extension-libs.wdio-spec.js) plus a matching test form (with-extension-libs.xlsx/.xml) to verify extension-lib-backed forms load. Reworked person-edit.wdio-spec.js, wdio.conf.js, and mock-config.js so multiple forms can be submitted in one test without page reloads, protecting the cancel/teardown logic from regressions. Updated karma unit tests for enketo.service, form.service and the cht-form app.component (asserting addExtensionLib/clearExtensionLibs are driven by the extensionLibs input), and added karma specs for the stub services (cht-datasource.service, db.service, language.service).

## Related Issues

- #9844: cht-form web component does not support extension-libs in loaded forms; request to inject extension-lib functions usable from within forms

## Domain Rationale

**Fit:** strong

The change is squarely about loading and rendering Enketo forms in the cht-form web component — injecting extension-lib functions into the form-evaluation context and fixing runtime/cancel errors during form load. The core file is the cht-form app component with its service stubs; form.service and enketo.service changed to make EnketoFormContext shareable between the webapp and the web component. All of it is form-rendering concern rather than sync, config, or permissions.
