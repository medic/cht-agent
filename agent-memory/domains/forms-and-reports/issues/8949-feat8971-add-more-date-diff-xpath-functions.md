---
id: cht-core-8971
category: feature
domain: forms-and-reports
domainFit: strong
issueNumber: 8971
issueUrl: https://github.com/medic/cht-core/issues/8971
title: Add more date-difference XPath functions to Enketo medic-xpath-extensions for in-form date calculations
lastUpdated: '2026-06-23'
summary: Date logic in CHT xforms previously required manual, error-prone calculations because few date helpers existed. This PR adds additional date-difference XPath functions to the Enketo extension library so form authors can compute differences between dates directly, backed by unit and e2e tests.
services:
  - webapp
techStack:
  - javascript
  - enketo
  - xpath
  - xlsform
  - mocha
  - webdriverio
tags:
  - date-functions
  - xpath-extensions
  - enketo
  - date-diff
  - form-calculations
related_workflows:
  - form-submission
source_pr: medic/cht-core#8949
source_sha: 070000100fd7228985e6e0b55d2c91d55d29c4b0
distilled_at: '2026-06-23'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - webapp/src/js/enketo/medic-xpath-extensions.js
concepts:
  - XPath extension functions
  - Enketo form engine
  - date arithmetic in xforms
  - custom XForms function registration
related_issues: []
stale: false
---

## Problem

Performing date logic inside xforms was tricky and error-prone because it relied on mostly manual calculations; the existing medic-xpath-extensions exposed only a limited set of date helpers, so form authors had to hand-roll date math for common needs like computing the gap between two dates.

## Root Cause

The Enketo XPath extension library (medic-xpath-extensions.js) lacked generic date-difference functions, leaving date calculations to manual, repetitive, and bug-prone expression logic within each form.

## Solution

Extended medic-xpath-extensions.js with additional date-diff XPath functions that compute the difference between two dates in various units, registering them alongside the existing custom functions so they are callable from form expressions. Added a dedicated e2e test form (dates.xlsx/dates.xml) and spec, plus mocha unit tests.

## Code Patterns

New date-diff helpers are added by registering named functions in the function map of webapp/src/js/enketo/medic-xpath-extensions.js, following the established custom-XPath-function pattern (each function accepts date arguments and returns a numeric difference); each is covered by a corresponding case in medic-xpath-extensions.spec.js and exercised end-to-end through the dates test form.

## Design Choices

Implemented the date math as reusable, unit-tested XPath extension functions rather than expecting form authors to write manual calculations in each form, reducing duplication and calculation errors and providing a generic, shared primitive for date logic across all forms.

## Related Files

- webapp/src/js/enketo/medic-xpath-extensions.js
- webapp/tests/mocha/unit/enketo/medic-xpath-extensions.spec.js
- tests/e2e/cht-form/default/dates.wdio-spec.js
- tests/e2e/cht-form/default/forms/dates.xlsx
- tests/e2e/cht-form/default/forms/dates.xml

## Testing

Added mocha unit tests in medic-xpath-extensions.spec.js covering the new date-diff functions, plus an e2e suite (dates.wdio-spec.js) with a dedicated cht-form test form (dates.xlsx/dates.xml) verifying the functions evaluate correctly in a rendered form. Reviewers explicitly praised the unit and e2e test coverage.

## Related Issues

- #8971: Feature request for proper XPath functions to handle generic date calculations in xforms (logged retroactively for this PR)
- #5468: Earlier issue describing the difficulty and error-proneness of manual date logic in xforms

## Domain Rationale

**Fit:** strong

The PR adds custom XPath functions to the Enketo form engine (webapp/src/js/enketo/medic-xpath-extensions.js) that forms invoke for date calculations during data entry — this is squarely form functionality, not sync, config, or infrastructure.
