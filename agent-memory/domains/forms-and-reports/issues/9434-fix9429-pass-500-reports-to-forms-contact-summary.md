---
id: cht-core-9429
category: bug
domain: forms-and-reports
domainFit: strong
issueNumber: 9429
issueUrl: https://github.com/medic/cht-core/issues/9429
title: Pass up to 500 of a contact's reports into the contact summary when rendering forms
lastUpdated: '2026-08-10'
summary: When rendering an enketo form, form.service.ts loaded the contact's reports via its own SearchService call with no limit, so the contact summary saw only the search default of 50 reports while the contact page saw 500. The fix delegates to ContactViewModelGeneratorService so the forms contact summary receives the same set of up to 500 reports.
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
  - reports
  - enketo
  - report-limit
  - forms
related_workflows:
  - form-submission
source_pr: medic/cht-core#9434
source_prs:
  - "medic/cht-core#9434"
  - "medic/cht-core#9436"
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

Issue #9429 ('Only 50 reports are passed to the contact summary which is passed to enketo'): viewing a contact's page computed the contact summary over up to 500 reports, but completing an action from that same place re-computed the contact summary with only 50 reports before handing it to enketo. Contact-summary fields that aggregate over a contact's reports were therefore computed from incomplete data whenever a form was opened, and the same summary yielded different answers depending on where it was calculated.

## Root Cause

The form-rendering path in form.service.ts fetched the contact's reports with its own SearchService.search('reports', ...) call and passed no `limit`, so it silently took the search service's default page size of 50 — while the contact page had already been switched to ContactViewModelGeneratorService, whose `LIMIT_SELECT_ALL_REPORTS = 500` returns up to 500. The two call sites therefore disagreed, and the contact summary computed at form-render time saw only 50 reports.

## Solution

Replaced form.service.ts's own SearchService.search('reports', ...) call with a delegation to ContactViewModelGeneratorService.loadReports({ doc: contact }, []), so the forms contact summary now receives up to 500 of the contact's reports instead of the search default of 50, and passes them into the contact summary used during enketo form rendering. The generator's `_loadReports` was guarded with `model.children?.forEach` because form.service.ts passes a bare `{ doc }` model with no children. 500 acts as a hard cap — contacts with more than 500 reports get the first 500, while contacts with fewer get all of them. This aligns the forms contact summary with the contact-page summary, which already loads the same 500-report set via contact-view-model-generator.service.ts, so both call sites produce the same summary instead of each choosing its own limit.

## Code Patterns

Loading a bounded report set for the contact summary at form-render time: webapp/src/ts/services/form.service.ts fetches the contact's reports through webapp/src/ts/services/contact-view-model-generator.service.ts and supplies them to the contact summary input. The cap lives in the generator as the named constant LIMIT_SELECT_ALL_REPORTS = 500, so every consumer inherits one deliberate limit instead of silently falling back to SearchService's page-size default of 50.

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

- #9429: only 50 reports are passed to the contact summary which is passed to enketo — the summary should be computed over the same report set every time (resolved with the shared 500-report cap)
- PR #9434 was cherry-picked into backport PR #9436, which landed on the 4.11.x release branch.

## Domain Rationale

**Fit:** strong

The fix lives in the enketo form-rendering path (form.service.ts) and governs how many report documents are fed into the contact summary computed while a form is open — reports + form rendering are squarely forms-and-reports. It touches the contacts-owned ContactViewModelGeneratorService as a shared report-loading helper, so a reviewer could re-bin to contacts, but the bug and feature concern the forms contact summary specifically.
