---
id: cht-core-9429
category: bug
domain: forms-and-reports
domainFit: strong
issueNumber: 9429
issueUrl: https://github.com/medic/cht-core/issues/9429
title: Pass up to 500 of a contact's reports into the contact summary when rendering forms
lastUpdated: '2026-06-23'
summary: When rendering an enketo form, the contact summary received only a limited subset of the contact's reports, so report-derived summary fields were computed from incomplete data for contacts with large histories. The fix loads and passes up to 500 of the contact's reports into the forms contact summary (capped at 500).
services:
  - webapp
techStack:
  - typescript
  - angular
  - enketo
  - webdriverio
  - karma
tags:
  - contact-summary
  - reports
  - enketo
  - report-limit
  - forms
related_workflows:
  - form-submission
source_pr: medic/cht-core#9434
source_sha: a2fe0b43d4161d80c93d7fd8980d56afcaea01b6
distilled_at: '2026-06-23'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - webapp/src/ts/services/form.service.ts
  - webapp/src/ts/services/contact-view-model-generator.service.ts
concepts:
  - contact summary
  - enketo form rendering
  - report loading limit
  - contact view model generation
related_issues: []
stale: false
---

## Problem

Issue #9429 ('all reports in contact summary'): when an enketo form was rendered, the contact summary made available to the form received only a limited/default subset of the contact's reports. As a result, contact-summary fields that aggregate over a contact's reports were computed from incomplete data for contacts with many reports, producing incorrect form behavior and displayed values.

## Root Cause

The form-rendering path (form.service.ts) loaded the contact's reports with a low/default limit via the contact view model generator before passing them into the contact summary computation, so contacts with large report histories had their reports truncated below what the summary logic needed.

## Solution

Raised the report limit applied when building the forms contact summary to 500: form.service.ts now requests up to 500 of the contact's reports (via ContactViewModelGeneratorService) and passes them into the contact summary used during enketo form rendering. 500 acts as a hard cap — contacts with more than 500 reports get the first 500, while contacts with fewer get all of them.

## Code Patterns

Loading a bounded report set for the contact summary at form-render time: webapp/src/ts/services/form.service.ts fetches the contact's reports (limit 500) through webapp/src/ts/services/contact-view-model-generator.service.ts and supplies them to the contact summary input, keeping the report cap as a named limit rather than relying on the page-size default.

## Design Choices

Chose a fixed 500-report cap instead of truly loading every report. This balances completeness of report-derived contact-summary fields against the performance and memory cost of loading an unbounded report set for contacts with very large histories, while covering the overwhelming majority of real-world contacts.

## Related Files

- webapp/src/ts/services/form.service.ts
- webapp/src/ts/services/contact-view-model-generator.service.ts
- webapp/tests/karma/ts/services/form.service.spec.ts
- tests/e2e/default/enketo/contact-summary-reports.wdio-spec.js
- tests/e2e/default/enketo/config/contact-summary-reports.js
- tests/e2e/default/enketo/forms/contact-summary-reports.xml
- tests/page-objects/default/enketo/common-enketo.wdio.page.js

## Testing

Added a Karma unit test in form.service.spec.ts asserting the report limit passed to the contact summary, plus a WebdriverIO e2e spec (contact-summary-reports.wdio-spec.js) with a supporting contact-summary config (contact-summary-reports.js), enketo form (contact-summary-reports.xml), and page-object helpers (common-enketo.wdio.page.js). Manually verified by the reviewer: 550 reports → contact summary receives 500 (capped); 400 reports → receives all 400.

## Related Issues

- #9429: all reports in contact summary — the forms contact summary should receive the contact's reports (resolved with a 500-report cap)

## Domain Rationale

**Fit:** strong

The fix lives in the enketo form-rendering path (form.service.ts) and governs how many report documents are fed into the contact summary computed while a form is open — reports + form rendering are squarely forms-and-reports. It touches the contacts-owned ContactViewModelGeneratorService as a shared report-loading helper, so a reviewer could re-bin to contacts, but the bug and feature concern the forms contact summary specifically.
