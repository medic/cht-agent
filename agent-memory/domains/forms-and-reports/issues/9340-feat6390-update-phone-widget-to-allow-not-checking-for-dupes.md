---
id: cht-core-6390
category: feature
domain: forms-and-reports
domainFit: strong
issueNumber: 6390
issueUrl: https://github.com/medic/cht-core/issues/6390
title: Update Enketo phone widget to allow validating phone numbers without checking for duplicate contacts
lastUpdated: '2026-08-12'
summary: 'The phone widget previously always both validated a phone number and enforced uniqueness across contacts, with no way to permit duplicates. This PR adds a new field style (type: string, appearance: numbers tel) that validates the number but does not dup-check by default, with opt-in uniqueness via instance::cht:unique_tel.'
services:
  - webapp
techStack:
  - javascript
  - typescript
  - enketo
  - xlsform
  - webdriverio
tags:
  - enketo
  - phone-widget
  - form-widget
  - phone-validation
  - duplicate-check
  - xlsform
  - backwards-compatible
  - deprecation
related_workflows:
  - form-submission
  - ui-extensions
source_pr: medic/cht-core#9340
source_sha: 6a3d4449527fc0800bccacfe65699aa843b96f92
distilled_at: '2026-06-23'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - webapp/src/js/enketo/widgets/phone-widget.js
  - webapp/tests/karma/js/enketo/widgets/phone-widget.spec.ts
concepts:
  - Enketo custom widgets
  - XForm/xlsform field type and appearance configuration
  - phone number format validation
  - duplicate contact detection
  - opt-in uniqueness constraint via instance attribute
  - backwards-compatible deprecation
related_issues: []
stale: false
---

## Problem

The phone widget, configured via type: tel, coupled two behaviors: it validated the phone number format AND ensured no two contacts shared the same number. Workflows like MSF-Goma's SMS 'shared phones' need to validate the number format but allow duplicate phone numbers across contacts, and there was no way to disable the duplicate check.

## Root Cause

phone-widget.js hardwired format validation together with the duplicate-contact lookup, and the only way to get a phone field (type: tel) enabled both behaviors unconditionally.

## Solution

Introduced a new field configuration — type: string with appearance: numbers tel — that always validates the phone number format but, by default, does NOT query for contacts with the same number. Uniqueness becomes opt-in by adding an instance::cht:unique_tel: true column. The legacy type: tel behavior is preserved (now deprecated) for backwards compatibility.

## Code Patterns

Widget behavior is selected by one line in `_init`: `const uniqueTel = $wrapper.attr('data-cht-unique_tel') === 'true' || deprecated.isDeprecated($wrapper)`. Two things can therefore turn duplicate-checking on — the new `instance::cht:unique_tel` XLSForm column, and the legacy shape, which `deprecated.isDeprecated` detects as the absence of the `or-appearance-tel` class. The legacy `type: tel` field keeps always-on dup-checking through that second branch; only the new `type: string` / `appearance: numbers tel` style is opt-in. That column header lives only inside the `.xlsx` workbook, so it cannot be found by grepping the tree. It reaches the code in two steps: pyxform emits `cht:unique_tel` into the generated XForm instance, and the transform renders it as a `data-cht-unique_tel` attribute on the question. `webapp/src/js/enketo/widgets/phone-widget.js` reads `data-cht-unique_tel`; format validation is decoupled from the duplicate check rather than made independently switchable: the `numbers tel` appearance always validates the format, and only the uniqueness lookup is opt-in, via `cht:unique_tel="true"` — webapp/src/js/enketo/widgets/phone-widget.js.

## Design Choices

Preserved the existing type: tel widget behavior to remain backwards compatible (deprecating rather than removing it) and made the duplicate check opt-in under the new appearance-based config, since the requesting workflows want duplicates allowed by default. Followed the countdown-timer precedent of splitting out a dedicated phone_widget test form/spec instead of overloading the shared enketo_widgets tests.

## Related Files

- webapp/src/js/enketo/widgets/phone-widget.js
- webapp/tests/karma/js/enketo/widgets/phone-widget.spec.ts
- webapp/.eslintrc
- tests/e2e/default/enketo/phone-widget.wdio-spec.js
- tests/e2e/default/enketo/forms/phone_widget.xlsx
- tests/e2e/default/enketo/forms/phone_widget.xml
- tests/integration/cht-form/default/phone_widget.wdio-spec.js
- tests/integration/cht-form/default/forms/phone_widget.xml
- tests/page-objects/default/enketo/enketo-widgets.wdio.page.js
- tests/page-objects/default/enketo/common-enketo.wdio.page.js
- tests/page-objects/default/contacts/contacts.wdio.page.js

## Testing

Added a dedicated phone_widget form and new specs in both e2e and integration/cht-form, replacing reliance on the shared enketo_widgets tests. cht-form integration tests cover format validation; e2e tests cover the duplicate-contact database query that cannot be exercised in cht-form. Updated the karma unit spec (phone-widget.spec.ts) and the relevant page objects.

## Related Issues

- #6390: Allow the phone widget to validate phone number format while permitting duplicate phone numbers across contacts (MSF-Goma 'shared phones' SMS workflow)

## Domain Rationale

**Fit:** strong

The change modifies an Enketo form input widget (phone-widget.js) and introduces new xlsxform field configuration governing how a phone field renders and validates within forms — this is squarely form widget/input behavior. The change is precisely about when the widget's contact duplicate-check runs. Before this PR every phone field dup-checked; after it, the new `type: string` / `appearance: numbers tel` style dup-checks only when opted in via `instance::cht:unique_tel`, while the legacy `type: tel` shape keeps its always-on behaviour.
