---
id: cht-core-8681
category: feature
domain: forms-and-reports
domainFit: strong
issueNumber: 8681
issueUrl: https://github.com/medic/cht-core/issues/8681
title: Support requiring countdown-timer fields by binding the widget to 'trigger' question types instead of 'note'
lastUpdated: '2026-08-13'
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

The widget's own selector (`.or-appearance-countdown-timer input`) bound the countdown timer to the 'note' input type, which does not support the 'required' constraint, making timer completion unenforceable. A per-field duration could not survive form generation: the XSLT transform drops instance attributes and generate-xform.js had no involvement with the countdown widget before this PR. Durations were configurable already, but only in the one way that needed no generation support — the old note-based timer read its duration straight off the note's own value.

## Solution

Migrated the countdown-timer widget to apply to 'trigger' question types, which support 'required: yes'. When the timer completes, the widget checks the trigger's OK radio button, satisfying the required constraint; otherwise the user gets a 'This field is required' message if they try to bypass it. The checked OK value can gate subsequent questions. Custom timer durations are now configured via a new instance::cht:duration XLSForm column: generate-xform.js gained a generic `cht:*` passthrough (`setChtAttributes`) that re-reads the namespaced attributes off the source XForm's instance nodes — which the XSLT transform drops — and stamps them onto the rendered question element as `data-cht-*`, so the widget reads `$wrapper.attr('data-cht-duration')`. medic.less was adjusted for the new markup.

## Code Patterns

Custom Enketo widget targeting a specific question/input type in countdown-widget.js; separation of animation concerns into webapp/src/js/enketo/lib/timer-animation.js; custom XLSForm attribute passthrough handled in api/src/services/generate-xform.js, with fixture-based round-trip tests under api/tests/mocha/services/xforms/custom-attributes/. Note the two notations: authors write the XLSForm column `instance::cht:duration`, which exists only inside the `.xlsx` workbook, and generation renders it into the XForm as the `cht:duration` attribute — that second form is the one present in the tree.

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

Added Karma unit tests for the widget and animation library (countdown-widget.spec.ts, timer-animation.spec.ts); added Mocha tests for generate-xform with custom-attributes fixtures (form.html, model.xml, xform.xml and their expected outputs) verifying the `cht:duration` passthrough (authored as the `instance::cht:duration` XLSForm column); extended the pre-existing WebdriverIO e2e spec (submit-countdown-timer-form.wdio-spec.js) and its countdown-timer.xml form to cover the trigger-based widget alongside the deprecated note form, and updated the Enketo/contacts/generic-form page objects.

## Related Issues

- #8681: support requiring countdown-timer fields

## Domain Rationale

**Fit:** strong

The PR modifies the Enketo countdown-timer form widget and the XForm generation pipeline to change which question type the widget binds to and how form fields are validated — this is squarely form-building and form-field behavior, not sync, permissions, or config.
