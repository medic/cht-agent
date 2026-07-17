---
id: cht-core-9429
category: bug
domain: forms-and-reports
domainFit: strong
issueNumber: 9429
issueUrl: https://github.com/medic/cht-core/issues/9429
title: Pass up to 500 reports to the contact summary injected into Enketo forms
lastUpdated: '2026-06-23'
summary: When a form was opened from a contact, the contact summary made available to the form was generated from too few of the contact's reports, so form logic depending on that context could be wrong. The fix passes up to 500 reports to the forms contact summary, aligning it with the contact-page summary.
services:
  - webapp
techStack:
  - typescript
  - angular
  - enketo
  - xforms
  - webdriverio
  - karma
tags:
  - contact-summary
  - forms
  - enketo
  - reports
  - report-limit
  - contact-view-model
  - bug-fix
related_workflows:
  - form-submission
source_pr: medic/cht-core#9436
source_sha: 806b5906f91d2bbcbe1911aa8864ee19e0bfcaa1
distilled_at: '2026-06-23'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - webapp/src/ts/services/form.service.ts
  - webapp/src/ts/services/contact-view-model-generator.service.ts
concepts:
  - contact summary
  - contact view model generation
  - Enketo form contact-summary instance
  - report fetch limit
related_issues: []
stale: false
---

## Problem

When opening an Enketo form from a contact, the contact summary injected into the form (consumed by form logic via the contact-summary instance) was computed from a limited subset of the contact's reports rather than the same set used on the contact page. For contacts with many reports this meant form behavior driven by the contact-summary context (conditional fields, calculations, relevance) could be incomplete or inconsistent with the contact's profile summary.

## Root Cause

The form rendering pathway in form.service.ts built the contact summary using a different, smaller report set than the contact page's contact-view-model-generator.service.ts. Because the two code paths did not share the same report limit, forms received fewer reports than expected when generating the contact summary.

## Solution

Updated the forms pathway so the contact summary generated for a form is fed up to 500 of the contact's reports, matching the contact-page summary. Changes touch form.service.ts and contact-view-model-generator.service.ts to keep the report limit/loading consistent between the contact view and the forms contact summary.

## Code Patterns

Keep the contact-summary report limit (500) consistent across both consumers — contact-view-model-generator.service.ts (contact page) and form.service.ts (Enketo forms) — so the same contact summary is produced regardless of where it is rendered, rather than each call site choosing its own limit.

## Design Choices

A fixed cap of 500 reports balances summary completeness against performance, avoiding loading an unbounded report history into the contact summary for high-volume contacts while ensuring forms see the same data the contact page does.

## Related Files

- webapp/src/ts/services/form.service.ts
- webapp/src/ts/services/contact-view-model-generator.service.ts
- webapp/tests/karma/ts/services/form.service.spec.ts
- tests/e2e/default/enketo/config/contact-summary-reports.js
- tests/e2e/default/enketo/contact-summary-reports.wdio-spec.js
- tests/e2e/default/enketo/forms/contact-summary-reports.xml
- tests/page-objects/default/enketo/common-enketo.wdio.page.js

## Testing

Added/updated karma unit tests in form.service.spec.ts asserting that up to 500 reports are passed to the forms contact summary, plus a new WDIO e2e spec (contact-summary-reports.wdio-spec.js) backed by a config form (contact-summary-reports.js), an XForm (contact-summary-reports.xml), and shared enketo page-object helpers (common-enketo.wdio.page.js) to verify the form's contact summary receives the expected reports.

## Related Issues

- #9429: forms contact summary received too few of the contact's reports
- #9434: original PR for this fix (cherry-picked into this backport)

## Domain Rationale

**Fit:** strong

The defect and fix center on the contact summary that gets injected into Enketo forms (form.service.ts plus the enketo e2e/unit tests make up 5 of 7 files), so form logic relying on the contact-summary context behaved incorrectly. It overlaps with contacts via contact-view-model-generator.service.ts, but the user-facing impact and tests are squarely in the forms/Enketo rendering pathway.
