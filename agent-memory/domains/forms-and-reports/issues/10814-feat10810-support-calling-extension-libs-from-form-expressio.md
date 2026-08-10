---
id: cht-core-10810
category: feature
domain: forms-and-reports
domainFit: strong
issueNumber: 10810
issueUrl: https://github.com/medic/cht-core/issues/10810
title: Support calling extension-libs from form expressions (duplicate_check.expression and context.expression)
lastUpdated: '2026-08-09'
summary: Form expressions such as duplicate_check.expression and context.expression could only run a single inline JS string, forcing complex logic like duplicate-contact detection to be maintained inline. This PR converts XmlFormsContextUtilsService into an async get() factory and adds an extensionLib(libId, ...args) utility to the object it returns, so these expressions can call reusable extension-lib JS functions instead.
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
  - XmlFormsContextUtilsService.get
concepts:
  - form expression evaluation
  - extension libraries (extension-libs)
  - duplicate contact detection
  - XPath extension functions (cht:extension-lib)
  - async service initialization
  - async factory returning the expression-evaluation scope
related_issues: []
stale: false
---

## Problem

App developers configuring duplicate_check.expression (and context.expression) could only write a single inline JS expression string. Encapsulating complex logic such as sophisticated duplicate-contact detection was impractical and non-reusable, because there was no way to invoke an extension-lib from these form-level expressions — extension-libs were only callable via the cht:extension-lib xPath function inside form fields.

## Root Cause

Form context expressions were evaluated against the public methods of XmlFormsContextUtilsService (the service instance was passed straight into parseProvider.parse(...)), and that class had no helper for retrieving and invoking an extension-lib — nor any way to await the datasource, since every method was synchronous. The existing extension-lib mechanism lived only in the cht:extension-lib xPath function (medic-xpath-extensions.js) and was unavailable to duplicate_check/context expression evaluation.

## Solution

Converted XmlFormsContextUtilsService from a bag of public methods into a single async get() factory that resolves CHTDatasourceService first and returns the utils object handed to expression evaluation. Alongside the existing ageInDays/ageInMonths/ageInYears/levenshteinEq/normalizedLevenshteinEq entries it adds extensionLib(libId, ...args), which looks the lib up on the resolved datasource and invokes it with the supplied arguments (throwing a configuration error when no lib with that ID exists), mirroring the existing cht:extension-lib xPath function. Callers — deduplicate.service (getDuplicates became async), form.service and xml-forms.service (checkFormExpression became async) — now await …get() and pass the resulting object to parseProvider.parse(...), so extensionLib is available within duplicate_check.expression and context.expression evaluation. Per review feedback the utils object is built behind an await this.chtDatasourceService.get(), so the datasource is fully initialized before any expression can run; the existing synchronous datasource.v1.getExtensionLib(id) accessor (added in #9090) is then used unchanged for the lookup, rather than exposing a new pre-initialization accessor on CHTDatasourceService itself.

## Code Patterns

XmlFormsContextUtilsService.get() returns the object whose properties form the scope of context.expression / duplicate_check.expression evaluation — a new utility must be added to that returned object, not as a class method, to become available to form expressions. Its extensionLib(libId, ...args) entry retrieves an extension-lib from the resolved CHT datasource and invokes it, reusing the pattern of the cht:extension-lib xPath function in webapp/src/js/enketo/medic-xpath-extensions.js.

## Design Choices

Modeled extensionLib() on the existing cht:extension-lib xPath function for consistency rather than inventing a new mechanism. Because the datasource must be initialized before any lookup, the whole utils surface was moved behind an async get() factory that awaits chtDatasourceService.get() once — pushing the async boundary out to the callers (getDuplicates, checkFormExpression) — instead of leaving expression evaluation to reach for the datasource synchronously mid-flight. The trade-off is that the utils are no longer class methods, so anything added later must go inside the object get() returns.

## Related Files

- webapp/src/ts/services/xml-forms-context-utils.service.ts
- webapp/src/ts/services/deduplicate.service.ts
- webapp/src/ts/services/form.service.ts
- webapp/src/ts/services/xml-forms.service.ts
- tests/e2e/default/contacts/duplicate-contacts.wdio-spec.js
- tests/page-objects/default/enketo/custom-doc.wdio.page.js

## Testing

Added/updated Karma unit tests for xml-forms-context-utils.service, deduplicate.service, form.service, xml-forms.service, cht-datasource.service and parse.provider. Coverage for calling extension-libs from duplicate-check expressions was added into the existing WebdriverIO e2e spec (tests/e2e/default/contacts/duplicate-contacts.wdio-spec.js) and its existing page object (tests/page-objects/default/enketo/custom-doc.wdio.page.js) — both files were modified, not created.

## Related Issues

- #10810: Feature request to support more complex logic in duplicate contact expressions by calling reusable extension-libs from duplicate_check.expression

## Domain Rationale

**Fit:** strong

The PR extends form expression evaluation — it adds an extensionLib() utility to the scope object XmlFormsContextUtilsService.get() returns, making it available within duplicate_check.expression and context.expression, and every touched source file is a form-subsystem service. Duplicate contact detection is the motivating use case, but the actual capability is a general form-expression feature (it also applies to context.expression, which governs form relevance), so forms-and-reports is the most specific fit rather than contacts.
