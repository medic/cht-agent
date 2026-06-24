---
id: cht-core-8656
category: bug
domain: forms-and-reports
domainFit: strong
issueNumber: 8656
issueUrl: https://github.com/medic/cht-core/issues/8656
title: Make Enketo XPath date extension functions handle dates consistently
lastUpdated: '2026-06-23'
summary: The custom XPath date extension functions exposed to Enketo forms behaved inconsistently in how they parsed/normalized date inputs; the fix aligns their date handling and updates the unit tests accordingly.
services:
  - webapp
techStack:
  - javascript
  - enketo
  - xpath
  - mocha
tags:
  - xpath
  - enketo
  - dates
  - date-extensions
  - form-calculations
related_workflows:
  - form-submission
source_pr: medic/cht-core#8656
source_sha: 7202de54bbbc83351c46c8e6fa328743d4087e8a
distilled_at: '2026-06-23'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - webapp/src/js/enketo/medic-xpath-extensions.js
concepts:
  - XPath extension functions
  - Enketo form evaluation
  - date parsing/normalization
  - custom function registration
related_issues: []
stale: false
---

## Problem

Custom XPath date extension functions registered for Enketo forms (e.g. the date-difference/date-handling helpers) did not behave consistently with one another — differing in how they accepted or normalized date arguments — leading to unpredictable results in form calculations and constraints (tracked in #8556).

## Root Cause

Individual date extension functions in medic-xpath-extensions.js implemented their own date parsing/conversion logic instead of sharing a common normalization path, so equivalent inputs were treated differently across functions.

## Solution

Reconciled the date extension functions so they parse and handle date values consistently (shared/uniform date normalization), and updated the mocha unit specs to assert the consistent behavior.

## Code Patterns

Centralize date input normalization for custom XPath functions in webapp/src/js/enketo/medic-xpath-extensions.js rather than per-function ad hoc parsing; cover each extension's date handling in webapp/tests/mocha/unit/enketo/medic-xpath-extensions.spec.js.

## Design Choices

Standardizing the existing extension functions in place (rather than introducing new function names) preserves backwards compatibility for deployed form configurations while removing the inconsistency.

## Related Files

- webapp/src/js/enketo/medic-xpath-extensions.js
- webapp/tests/mocha/unit/enketo/medic-xpath-extensions.spec.js

## Testing

Updated/extended the mocha unit suite in webapp/tests/mocha/unit/enketo/medic-xpath-extensions.spec.js to verify the date extension functions now behave consistently.

## Related Issues

- #8556: Enketo XPath date extension functions behave inconsistently

## Domain Rationale

**Fit:** strong

The change touches medic-xpath-extensions.js, which registers the custom XPath functions Enketo evaluates inside form calculations/constraints — squarely form-rendering/evaluation behavior, not sync, config, or ops.
