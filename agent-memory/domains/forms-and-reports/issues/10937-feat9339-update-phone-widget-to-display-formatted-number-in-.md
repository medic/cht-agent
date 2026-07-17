---
id: cht-core-9339
category: improvement
domain: forms-and-reports
domainFit: strong
issueNumber: 9339
issueUrl: https://github.com/medic/cht-core/issues/9339
title: Update Enketo phone widget to display the formatted/normalized number in the visible proxy input
lastUpdated: '2026-06-22'
summary: The phone widget normalized numbers before saving to the form model but left the visible proxy input showing the raw typed value, causing a confusing mismatch. The fix updates formatAndCopy so the proxy input also shows the formatted number, except when the number is invalid.
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

Updated formatAndCopy() so that after copying the formatted value to the hidden real input and firing the change event, the visible proxy input is also set to the same formatted value. When normalization returns false (invalid number), the proxy input keeps the original raw value so the resulting validation error still makes sense to the user.

## Code Patterns

Enketo proxy/real-input synchronization pattern in webapp/src/js/enketo/widgets/phone-widget.js (formatAndCopy): a visible proxy input plus a hidden real input bound to the model; after transforming/normalizing, sync the formatted value into both — but guard with a validity check so an invalid value preserves the user's raw entry for meaningful validation feedback.

## Design Choices

There was discussion on the issue about whether it is acceptable to mutate the displayed value after the user has entered it; the team accepted this so the displayed value matches what is actually stored. Preserving the original raw value on invalid input is a deliberate choice to keep validation errors comprehensible.

## Related Files

- webapp/src/js/enketo/widgets/phone-widget.js
- webapp/tests/karma/js/enketo/widgets/phone-widget.spec.ts

## Testing

Karma unit tests for the phone widget were updated to assert that the proxy input displays the formatted value after entry. The change was additionally tested locally.

## Related Issues

- #9339: Feature request to have the phone widget display the auto-formatted/normalized number to the user rather than only storing it in the form model

## Domain Rationale

**Fit:** strong

The change modifies a custom Enketo form widget (phone-widget) governing how phone-number input is collected and displayed within forms. There is no sync, permissions, or messaging-gateway concern, so form input/widget behavior is the squarely correct domain.
