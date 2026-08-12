---
id: cht-core-8556
category: improvement
domain: forms-and-reports
domainFit: strong
issueNumber: 8556
issueUrl: https://github.com/medic/cht-core/issues/8556
title: Make the medic-xpath-extensions date tests pass in any timezone
lastUpdated: '2026-08-12'
summary: The medic-xpath-extensions mocha suite baked timezone-dependent expectations into its cases, so `npm run unit-webapp` failed in some timezones (e.g. NZ +12, per #8556) while passing in others such as UTC; the fix pins `getTimezoneOffset` to -240 (emulating UTC+4) so results are identical everywhere, corrects an ambiguous fixture date, and tidies one redundant re-parse in the shared `asMoment()` helper.
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
  - timezone-dependent-tests
  - test-determinism
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
  - webapp/tests/mocha/unit/enketo/medic-xpath-extensions.spec.js
concepts:
  - XPath extension functions
  - timezone-dependent test expectations
  - stubbing Date.prototype.getTimezoneOffset
  - date parsing/normalization
related_issues: []
stale: false
---

## Problem

The `medic-xpath-extensions` mocha suite (`#difference-in-months` and every `#to-bikram-sambat()` conversion case) baked timezone-dependent expectations into its cases, so `npm run unit-webapp` failed in some timezones while passing in others — results came out off by a day or a month in e.g. NZ (+12), the environment reported in #8556, while the same expectations passed at UTC in CI. This was a test-determinism problem, not a defect in the extension functions themselves; no deployed form behaviour was wrong.

## Root Cause

The specs never pinned the timezone, so `Date.prototype.getTimezoneOffset` returned whatever the developer's machine reported and flowed straight into `getTimezoneOffsetAsTime()` and the Bikram Sambat conversions. One `difference-in-months` fixture pair (`Sun Sep 25 2005 1:00:00 GMT+0100` / `Sun Oct 25 2005 22:00:00 GMT+2300`) was also ambiguous across offsets. Separately, the string branch of the shared `asMoment()` helper ended in `return moment(r)` when `const rMoment = moment(r)` was already in scope and `r` is not reassigned after it — the same parse of the same string, run twice. Redundant rather than wrong, which is why no form behaviour changed.

## Solution

Pinned `Date.prototype.getTimezoneOffset = () => -240` in a `beforeEach` (restoring the original in `afterEach`) so the suite is timezone-independent, corrected the ambiguous fixture date to `Sun Oct 24 2005 22:00:00 GMT+2300`, and made `asMoment()` return the already-parsed `rMoment` rather than re-parsing the same string (a tidy-up carried in the same PR, with no change in result).

## Code Patterns

Any spec that exercises date conversion through `webapp/src/js/enketo/medic-xpath-extensions.js` must stub `Date.prototype.getTimezoneOffset` in `beforeEach` and restore it in `afterEach` — the module reads the ambient offset via `getTimezoneOffsetAsTime()`, so unpinned specs pass only on the author's machine. Parse a date string once into a moment and reuse it rather than re-parsing on the fallthrough path.

## Design Choices

Stubbed the offset inside the suite rather than requiring contributors to run tests under a fixed `TZ`, so the fix travels with the repo and needs no runner configuration. The source change was kept to the single redundant re-parse; the extension functions' public names and signatures were left untouched, so no deployed form configuration is affected.

## Related Files

- webapp/src/js/enketo/medic-xpath-extensions.js
- webapp/tests/mocha/unit/enketo/medic-xpath-extensions.spec.js

## Testing

The mocha unit suite in webapp/tests/mocha/unit/enketo/medic-xpath-extensions.spec.js *is* the change: it now pins the timezone offset for every case, so `npm run unit-webapp` gives the same result regardless of where it is run. There is no new assertion about form behaviour — the source edit is covered by the existing cases.

## Related Issues

- #8556: xpath extensions tests fail in my timezone (labelled `Type: Technical issue` / `Testing`)

## Domain Rationale

**Fit:** strong

The change touches medic-xpath-extensions.js and its spec — the module registering the custom XPath functions Enketo evaluates inside form calculations/constraints — so it sits with forms-and-reports even though the defect was in test determinism rather than in form-rendering behaviour.
