---
id: cht-core-8011
category: bug
domain: forms-and-reports
domainFit: strong
issueNumber: 8011
issueUrl: https://github.com/medic/cht-core/issues/8011
title: Prevent Bikram Sambat date picker from saving a default Baisakh date when the month is not selected
lastUpdated: '2026-08-10'
summary: The Bikram Sambat (Nepali calendar) date picker silently saved an incorrect Baisakh-defaulted Gregorian date when only day and year were entered without selecting a month. The fix lets the bikram-sambat-bootstrap library convert as before, then clears the Gregorian output whenever day, month or year is missing — re-asserting the clear on the next tick to beat the library's own blur handler — so required-field validation blocks submission.
services:
  - webapp
techStack:
  - javascript
  - typescript
  - enketo
  - webdriverio
tags:
  - bikram-sambat
  - date-picker
  - enketo-widget
  - form-validation
  - date-conversion
  - nepali-calendar
related_workflows:
  - form-submission
source_pr: medic/cht-core#11165
source_sha: b4a18bc80261633f56ca57ec86f0a0acd0bcab81
distilled_at: '2026-06-23'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - webapp/src/js/enketo/widgets/bikram-sambat-datepicker.js
concepts:
  - enketo custom widget
  - form input validation
  - bikram-sambat to gregorian date conversion
  - hidden form field state
  - post-hoc correction of a third-party library's output
  - event-ordering race with a vendored library's own handlers
related_issues: []
stale: false
---

## Problem

The Bikram Sambat date picker widget converted and saved a date even when the user had not selected a month. Entering only a day and year produced a silently incorrect Gregorian date defaulted to Baisakh (month 1), persisting wrong data without alerting the user.

## Root Cause

The month input is type="hidden" and only receives a value when the user clicks the dropdown, so it stayed empty when only day/year were typed. bikram_sambat_bs.initListeners() runs conversion on any field change, and the empty month fell back to Baisakh (month 1) instead of being treated as incomplete input.

## Solution

Added a delegated `change`/`blur` handler on the widget's inputs (clearIfIncomplete) that checks whether all three fields (day, month, year) are filled and, if any is missing, clears the Gregorian output the library just wrote. Because bikram_sambat_bs's own blur handler runs after the delegated guard and would write the Baisakh-defaulted date back, the check is repeated on the next tick via setTimeout(…, 0). The widget cannot gate the library's conversion, so the fix corrects the result rather than preventing it — the net effect is that day+year with no month leaves the real date input empty and required-field validation blocks submission.

## Code Patterns

You cannot always gate a third-party library's listeners; instead, let it run and clear the derived value afterwards when its source inputs are incomplete — and re-assert the correction on the next tick (setTimeout(fn, 0)) so the library's own later handlers do not overwrite it. See clearIfIncomplete in webapp/src/js/enketo/widgets/bikram-sambat-datepicker.js, which checks day, month and year on a delegated change/blur handler and empties the real date input (firing change) rather than letting a defaulted component produce a misleading value.

## Design Choices

Rather than treating a missing month as a sensible default (Baisakh), the fix treats incomplete input as no input and clears the Gregorian output so existing required-field validation surfaces the error instead of silently persisting a wrong date. The first attempt did not fully resolve the issue; the final fix was confirmed end-to-end — day+year with no month no longer saves a date, while a complete date still saves correctly.

## Related Files

- webapp/src/js/enketo/widgets/bikram-sambat-datepicker.js
- webapp/tests/karma/js/enketo/widgets/bikram-sambat-datepicker.spec.ts
- webapp/tests/karma/karma-unit.conf.js
- tests/e2e/default/translations/nepali-dates-and-numbers.wdio-spec.js

## Testing

Added/updated Karma unit tests for the widget (bikram-sambat-datepicker.spec.ts) with a corresponding karma-unit.conf.js update to include the spec, plus an end-to-end WebdriverIO spec (nepali-dates-and-numbers.wdio-spec.js) exercising Nepali date entry. The branch's webapp was additionally built and manually verified: day+year without a month no longer saves a date (field stays empty, required validation blocks submit) and that a complete date saves correctly.

## Related Issues

- #8011: Bikram Sambat date picker converts date even when the user hasn't selected a month, silently saving a Baisakh-defaulted date

## Domain Rationale

**Fit:** strong

This is a bug in an Enketo form input widget (the Bikram Sambat date picker) affecting how date data is captured, converted, and validated during form entry — squarely the forms-and-reports domain.
