---
id: cht-core-9339
category: feature
domain: forms-and-reports
domainFit: strong
issueNumber: 9339
issueUrl: https://github.com/medic/cht-core/issues/9339
title: Update Enketo phone widget to display the formatted/normalized number in the visible proxy input
lastUpdated: '2026-08-09'
summary: The phone widget normalized numbers before saving to the form model but left the visible proxy input showing the raw typed value, causing a confusing mismatch. The fix updates formatAndCopy so the proxy input is set to the same value written to the model — which, for an invalid number, is the user's raw entry, since the normalizer already falls back to it.
services:
  - webapp
techStack:
  - javascript
  - typescript
  - enketo
  - jquery
tags:
  - phone-widget
  - enketo
  - phone-number-formatting
  - form-input
  - ui-ux
  - input-normalization
related_workflows:
  - form-submission
  - ui-extensions
source_pr: medic/cht-core#10937
source_sha: 96afcd858f076e2078a4b73fc98283c0b2f4b6ab
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - webapp/src/js/enketo/widgets/phone-widget.js
  - formatAndCopy
concepts:
  - Enketo custom widgets
  - proxy input vs hidden real (model) input binding
  - phone number normalization/formatting
  - form model synchronization
related_issues: []
stale: false
---

## Problem

When a user typed a phone number into the custom phone widget, the value was normalized/formatted before being written to the hidden input bound to the form model, but the visible proxy input continued to show the raw value the user originally typed (e.g. user types '+1 (650) 222-3333', model stores '+16502223333', proxy still shows '+1 (650) 222-3333'). This mismatch between displayed and stored values was confusing to users.

## Root Cause

In formatAndCopy(), the normalized/formatted value was copied only to the hidden real input (the form model binding); the visible proxy input was never updated, so it retained the user's raw input.

## Solution

Updated formatAndCopy() to compute getFormattedValue() once and, after copying it to the hidden real input and firing the change event, set the visible proxy input to the same value. There is no new validity check: the pre-existing getFormattedValue() already returns `phoneNumber.normalize(settings, value) || value`, so when normalization returns false (invalid number) the "formatted" value is simply the raw entry and the proxy is left showing exactly what the user typed, keeping the resulting validation error comprehensible.

## Code Patterns

Enketo proxy/real-input synchronization pattern in webapp/src/js/enketo/widgets/phone-widget.js (formatAndCopy): a visible proxy input plus a hidden real input bound to the model; after transforming/normalizing, sync the same value into both unconditionally. The invalid-input case needs no branch because the normalizer itself falls back to the raw value (`normalize(...) || value`), so "write the formatted value everywhere" and "leave a bad entry visible for validation" are the same line of code.

## Design Choices

There was discussion on the issue about whether it is acceptable to mutate the displayed value after the user has entered it; the team accepted this so the displayed value matches what is actually stored. Preserving the original raw value on invalid input is a deliberate choice to keep validation errors comprehensible — implemented by reusing getFormattedValue()'s existing `|| value` fallback rather than adding a separate validity branch in formatAndCopy.

## Related Files

- webapp/src/js/enketo/widgets/phone-widget.js
- webapp/tests/karma/js/enketo/widgets/phone-widget.spec.ts

## Testing

Karma unit tests for the phone widget were updated to assert on proxyInput.val() after entry: the normalized number for valid input, and the unchanged denormalized entry for an invalid number. The change was additionally tested locally.

## Related Issues

- #9339: Feature request to have the phone widget display the auto-formatted/normalized number to the user rather than only storing it in the form model

## Domain Rationale

**Fit:** strong

The change modifies a custom Enketo form widget (phone-widget) governing how phone-number input is collected and displayed within forms. There is no sync, permissions, or messaging-gateway concern, so form input/widget behavior is the squarely correct domain.
