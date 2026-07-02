---
id: cht-core-10810
category: feature
domain: forms-and-reports
domainFit: strong
issueNumber: 10810
issueUrl: https://github.com/medic/cht-core/issues/10810
title: Support calling extension-libs from form expressions (duplicate_check.expression and context.expression)
lastUpdated: '2026-06-22'
summary: Form expressions such as duplicate_check.expression and context.expression could only run a single inline JS string, forcing complex logic like duplicate-contact detection to be maintained inline. This PR adds an extensionLib(libId, ...args) utility so these expressions can call reusable extension-lib JS functions instead.
services:
  - webapp
techStack:
  - typescript
  - angular
  - enketo
  - xpath
  - javascript
tags:
  - extension-lib
  - form-expressions
  - duplicate-check
  - deduplication
  - context-expression
  - xml-forms-context-utils
related_workflows:
  - ui-extensions
  - contact-creation
  - form-submission
source_pr: medic/cht-core#10814
source_sha: 0c16f8d1f0995d84fbe609f5292ac74aaa704413
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - webapp/src/ts/services/xml-forms-context-utils.service.ts
  - webapp/src/ts/services/deduplicate.service.ts
  - webapp/src/ts/services/form.service.ts
  - webapp/src/ts/services/xml-forms.service.ts
  - CHTDatasourceService
  - XmlFormsContextUtilsService.extensionLib
concepts:
  - form expression evaluation
  - extension libraries (extension-libs)
  - duplicate contact detection
  - XPath extension functions (cht:extension-lib)
  - async service initialization
related_issues: []
stale: false
---

## Problem

App developers configuring duplicate_check.expression (and context.expression) could only write a single inline JS expression string. Encapsulating complex logic such as sophisticated duplicate-contact detection was impractical and non-reusable, because there was no way to invoke an extension-lib from these form-level expressions — extension-libs were only callable via the cht:extension-lib xPath function inside form fields.

## Root Cause

Form context expressions are evaluated against the utility functions exposed by XmlFormsContextUtilsService, which had no helper for retrieving and invoking an extension-lib. The existing extension-lib mechanism lived only in the cht:extension-lib xPath function (medic-xpath-extensions.js) and was unavailable to duplicate_check/context expression evaluation.

## Solution

Added an extensionLib(libId, ...args) method to XmlFormsContextUtilsService that fetches the named extension-lib from CHTDatasourceService and invokes it with the supplied arguments, mirroring the existing cht:extension-lib xPath function. The method is now available within duplicate_check.expression and context.expression evaluation, wired through deduplicate.service, form.service and xml-forms.service. Per review feedback, the lookup avoids a synchronous getExtensionLib accessor on CHTDatasourceService so the datasource is fully initialized before an extension-lib is returned/invoked.

## Code Patterns

XmlFormsContextUtilsService.extensionLib(libId, ...args) retrieves an extension-lib from CHTDatasourceService and invokes it, reusing the pattern of the cht:extension-lib xPath function in webapp/src/js/enketo/medic-xpath-extensions.js. New utility methods added to XmlFormsContextUtilsService automatically become available in the scope of form context/duplicate_check expression evaluation.

## Design Choices

Modeled extensionLib() on the existing cht:extension-lib xPath function for consistency rather than inventing a new mechanism. Following reviewer (jkuester) feedback, the extension-lib lookup was kept off a synchronous getExtensionLib accessor on CHTDatasourceService, ensuring the datasource is fully initialized before an extension-lib is returned and invoked.

## Related Files

- webapp/src/ts/services/xml-forms-context-utils.service.ts
- webapp/src/ts/services/deduplicate.service.ts
- webapp/src/ts/services/form.service.ts
- webapp/src/ts/services/xml-forms.service.ts
- tests/e2e/default/contacts/duplicate-contacts.wdio-spec.js
- tests/page-objects/default/enketo/custom-doc.wdio.page.js

## Testing

Added/updated Karma unit tests for xml-forms-context-utils.service, deduplicate.service, form.service, xml-forms.service, cht-datasource.service and parse.provider. A WebdriverIO e2e test (tests/e2e/default/contacts/duplicate-contacts.wdio-spec.js) with a supporting page object (custom-doc.wdio.page.js) was added by the reviewer to guard against future regressions in calling extension-libs from duplicate-check expressions.

## Related Issues

- #10810: Feature request to support more complex logic in duplicate contact expressions by calling reusable extension-libs from duplicate_check.expression

## Domain Rationale

**Fit:** strong

The PR extends form expression evaluation — it adds an extensionLib() utility to XmlFormsContextUtilsService that becomes available within duplicate_check.expression and context.expression, and every touched source file is a form-subsystem service. Duplicate contact detection is the motivating use case, but the actual capability is a general form-expression feature (it also applies to context.expression, which governs form relevance), so forms-and-reports is the most specific fit rather than contacts.
