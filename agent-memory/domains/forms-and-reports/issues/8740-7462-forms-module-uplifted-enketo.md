---
id: cht-core-8740
category: improvement
domain: forms-and-reports
domainFit: strong
issueNumber: 8740
issueUrl: https://github.com/medic/cht-core/issues/8740
title: 'Uplift Enketo forms module: enable excludeNonRelevant and patch date pickers to not auto-open as first question'
lastUpdated: '2026-06-23'
summary: The Enketo forms module was uplifted to enable `excludeNonRelevant` and to stop the date and date-time picker widgets from auto-popping open when they are the first question on a page. The enketo-core relevance patch was updated so CHT `inputs` group fields remain accessible to expressions even when the group is non-relevant.
services:
  - webapp
techStack:
  - javascript
  - enketo
  - enketo-core
  - patch-package
  - webdriverio
tags:
  - enketo
  - forms
  - date-picker
  - datetime-picker
  - excludeNonRelevant
  - relevant
  - inputs-group
  - form-widgets
related_workflows:
  - form-submission
source_pr: medic/cht-core#8740
source_sha: 3443fff1e99616e45c2b814a0e5e6c5282bd4988
distilled_at: '2026-06-23'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - webapp/src/js/enketo/config.js
  - webapp/patches/enketo-core+7.2.5.patch
  - tests/e2e/cht-form/default/death-report.wdio-spec.js
  - tests/page-objects/default/enketo/delivery.wdio.page.js
concepts:
  - Enketo form rendering engine
  - non-relevant field handling (relevance logic)
  - excludeNonRelevant submission pruning
  - Enketo widget initialization (date/datetime pickers)
  - patch-package overrides of vendored library code
  - CHT inputs group accessibility to form expressions
related_issues: []
stale: false
---

## Problem

Two form UX/behavior issues: (1) the Enketo date and date-time picker widgets auto-popped open when they were the first question on a page, creating an unwanted UX (enketo-core #1002); and (2) enabling `excludeNonRelevant` to prune non-relevant fields from submissions conflicted with CHT's custom `inputs` group, whose fields must stay accessible to form expressions even when the group is non-relevant.

## Root Cause

enketo-core's date/datetime picker widgets auto-open on focus when rendered first on a page. Separately, enketo-core's `relevant.js` clears values from non-relevant fields; with `excludeNonRelevant: true` this would clear the `inputs` group field values that CHT forms rely on for expression evaluation, breaking custom functionality.

## Solution

Patched enketo-core 7.2.5 (via webapp/patches/enketo-core+7.2.5.patch) so the date and date-time picker widgets do not auto-pop open when they are the first question on a page. Set `excludeNonRelevant: true` in webapp/src/js/enketo/config.js, and updated the relevant.js portion of the enketo-core patch to skip clearing values from `inputs` group fields when they are non-relevant, preserving their accessibility to expressions.

## Code Patterns

Maintain vendored-library behavior changes through patch-package (webapp/patches/enketo-core+7.2.5.patch) rather than forking; guard value-clearing in relevant.js so the CHT `inputs` group is exempted when applying excludeNonRelevant pruning.

## Design Choices

Used a patch-package patch to override enketo-core internals instead of forking the dependency, keeping the override small and reviewable. Rather than abandoning excludeNonRelevant to protect the inputs group, the patch narrowly preserves inputs-group values so submissions stay lean while CHT's expression functionality keeps working.

## Related Files

- webapp/src/js/enketo/config.js
- webapp/patches/enketo-core+7.2.5.patch
- tests/e2e/cht-form/default/death-report.wdio-spec.js
- tests/page-objects/default/enketo/delivery.wdio.page.js

## Testing

Updated end-to-end WebdriverIO coverage: the death-report cht-form e2e spec (tests/e2e/cht-form/default/death-report.wdio-spec.js) and the delivery Enketo page object (tests/page-objects/default/enketo/delivery.wdio.page.js) to exercise the new widget and relevance behavior; PR checklist confirms e2e testing where appropriate.

## Related Issues

- #7462: Uplift the forms module / Enketo (originating ticket)
- #7674: Enable excludeNonRelevant in the Enketo config
- enketo/enketo-core#1002: Date and date-time pickers auto-pop open when first question on a page

## Domain Rationale

**Fit:** strong

The PR changes Enketo form-engine configuration and widget/relevance behavior — date/date-time picker initialization, non-relevant field handling, and the CHT-specific `inputs` group — which is squarely how CHT forms render and evaluate. The config edited is the Enketo rendering config baked into webapp code, not user-facing app settings/translations, so it is forms-and-reports rather than configuration.
