---
id: cht-core-8681
category: feature
domain: forms-and-reports
domainFit: strong
issueNumber: 8681
issueUrl: https://github.com/medic/cht-core/issues/8681
title: Support requiring countdown-timer fields by binding the widget to 'trigger' question types instead of 'note'
lastUpdated: '2026-06-23'
summary: 'The countdown-timer widget was attached to ''note'' fields, which cannot be marked required, so users could bypass the timer before it finished. The widget was migrated to ''trigger'' question types that support ''required: yes'', enforcing timer completion via a constraint message, with custom durations set through a new instance::cht:duration column.'
services:
  - api
  - webapp
techStack:
  - javascript
  - typescript
  - enketo
  - xforms
  - less
tags:
  - countdown-timer
  - enketo-widget
  - trigger-question-type
  - required-fields
  - form-validation
  - xform-generation
  - custom-xlsform-attribute
related_workflows:
  - form-submission
  - ui-extensions
source_pr: medic/cht-core#8826
source_sha: 3e91ea65c0aa0d6799dcf1e3f7c6345d2cd2dd8b
distilled_at: '2026-06-23'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - webapp/src/js/enketo/widgets/countdown-widget.js
  - webapp/src/js/enketo/lib/timer-animation.js
  - api/src/services/generate-xform.js
  - webapp/src/css/enketo/medic.less
concepts:
  - Enketo custom widget binding by question type
  - XForm/XLSForm generation and custom attribute passthrough
  - required-field constraint enforcement
  - trigger vs note ODK question types
related_issues: []
stale: false
---

## Problem

The countdown-timer Enketo widget only applied to questions of input type 'note'. Notes are read-only display fields in ODK XForms and cannot be marked 'required', so a user could skip past the timer before it completed — there was no way to enforce that the user waited for the countdown to finish.

## Root Cause

The widget selector and XForm generation bound the countdown timer to the 'note' input type, which does not support the 'required' constraint, making timer completion unenforceable.

## Solution

Migrated the countdown-timer widget to apply to 'trigger' question types, which support 'required: yes'. When the timer completes, the widget checks the trigger's OK radio button, satisfying the required constraint; otherwise the user gets a 'This field is required' message if they try to bypass it. The checked OK value can gate subsequent questions. Custom timer durations are now configured via a new instance::cht:duration XLSForm column, with generate-xform.js updated to preserve that custom attribute through transformation, and medic.less adjusted for the new markup.

## Code Patterns

Custom Enketo widget targeting a specific question/input type in countdown-widget.js; separation of animation concerns into webapp/src/js/enketo/lib/timer-animation.js; custom XLSForm attribute passthrough (instance::cht:duration) handled in api/src/services/generate-xform.js with fixture-based round-trip tests under api/tests/mocha/services/xforms/custom-attributes/.

## Design Choices

Chose 'trigger' over 'note' specifically because trigger inputs support the 'required' attribute needed to enforce timer completion (notes cannot be required). Per the review thread, the team deliberated question-types and parameter-vs-default before landing on a custom instance::cht:duration column for developer-configurable durations, mirroring the prior note-based duration capability.

## Related Files

- webapp/src/js/enketo/widgets/countdown-widget.js
- webapp/src/js/enketo/lib/timer-animation.js
- api/src/services/generate-xform.js
- webapp/src/css/enketo/medic.less
- tests/e2e/default/enketo/forms/countdown-timer.xml
- tests/e2e/default/enketo/submit-countdown-timer-form.wdio-spec.js
- webapp/tests/karma/js/enketo/widgets/countdown-widget.spec.ts
- webapp/tests/karma/js/enketo/lib/timer-animation.spec.ts
- api/tests/mocha/services/generate-xform.spec.js

## Testing

Added Karma unit tests for the widget and animation library (countdown-widget.spec.ts, timer-animation.spec.ts); added Mocha tests for generate-xform with custom-attributes fixtures (form.html, model.xml, xform.xml and their expected outputs) verifying instance::cht:duration passthrough; added a WebdriverIO e2e spec (submit-countdown-timer-form.wdio-spec.js) with a dedicated countdown-timer.xml form and updated Enketo/contacts page objects.

## Related Issues

- #8681: support requiring countdown-timer fields

## Domain Rationale

**Fit:** strong

The PR modifies the Enketo countdown-timer form widget and the XForm generation pipeline to change which question type the widget binds to and how form fields are validated — this is squarely form-building and form-field behavior, not sync, permissions, or config.
