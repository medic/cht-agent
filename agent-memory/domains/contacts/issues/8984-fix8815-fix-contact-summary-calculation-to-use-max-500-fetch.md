---
id: cht-core-8815
category: bug
domain: contacts
domainFit: strong
issueNumber: 8815
issueUrl: https://github.com/medic/cht-core/issues/8815
title: Fix contact-summary calculation to fetch up to 500 reports per contact instead of being capped at 50
lastUpdated: '2026-08-11'
summary: The contact-summary calculation only received a contact's 50 most recent reports, so contacts with more than 50 reports produced incomplete summaries (e.g. a missing pregnancy card once the pregnancy registration was older than those 50). The fix raises the report fetch limit to 500 so the calculation has full report context.
services:
  - webapp
techStack:
  - typescript
  - angular
  - webdriverio
tags:
  - contact-summary
  - reports
  - query-limit
  - contact-profile
  - pregnancy-card
  - regression
related_workflows: []
source_pr: medic/cht-core#8984
source_sha: 04491c9f93c4689c4207928a339347e863c1d52f
distilled_at: '2026-06-23'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - webapp/src/ts/services/contact-view-model-generator.service.ts
  - webapp/src/ts/modules/contacts/contacts-content.component.ts
concepts:
  - contact-summary calculation
  - contact view model generation
  - report fetch/query result limit
related_issues: []
stale: false
---

## Problem

Contacts associated with more than 50 reports had their contact-summary computed from only their 50 most recent reports, so the calculation lacked full report context. Configured cards (e.g. a woman's pregnancy card) failed to appear once the triggering report was older than those 50 — register a pregnancy, submit 50 more reports, and the pregnancy card disappears. The defect had existed at least since version 3.9.

## Root Cause

The report fetch driving the contact view model generator relied on the default search result cap of 50 (defined in search.service.ts), so at most 50 reports were passed into the contact-summary calculation regardless of how many reports the contact actually had. Report searches page from the recent end — getPageRows in shared-libs/search slices the tail of the date-sorted rows when type is 'reports' — so the 50 that survived the cap were always the newest, and older reports were the ones dropped.

## Solution

Updated the contact view model generator to request up to 500 reports when loading a contact's reports for the contact-summary calculation, so the calculation receives the full set of associated reports (bounded at the new 500 limit) rather than only the 50 most recent. Separately, the same PR capped the rendered RHS report and task lists at a new DISPLAY_LIMIT = 50 in contacts-content.component.ts — a display-only cap, independent of the 500-report fetch that feeds the summary calculation.

## Code Patterns

When a calculation needs complete context, pass an explicit higher limit (500) to the report fetch in contact-view-model-generator.service.ts rather than inheriting the default 50-result cap from search.service.ts. Override the default query/page limit at the call site where full data is required.

## Design Choices

A finite cap of 500 was chosen over unbounded fetching to balance contact-summary accuracy against the performance and memory cost of loading reports client-side; 500 covers realistic per-contact report volumes while keeping the query bounded.

## Related Files

- webapp/src/ts/services/contact-view-model-generator.service.ts
- webapp/src/ts/modules/contacts/contacts-content.component.ts
- webapp/src/ts/services/search.service.ts (not modified — source of the default limit: 50)
- tests/e2e/default/contacts/contact-details.wdio-spec.js
- tests/factories/cht/reports/pregnancy.js

## Testing

Updated an e2e WebdriverIO spec (tests/e2e/default/contacts/contact-details.wdio-spec.js) to build a contact with 60 generic reports plus one pregnancy report, asserting that the contact-summary pregnancy card still appears for a contact with more than 50 reports while the RHS report and task lists each render exactly `DISPLAY_LIMIT` (50) rows, backed by an updated pregnancy report factory (tests/factories/cht/reports/pregnancy.js) to generate the >50-report test scenario.

## Related Issues

- #8815: contact-summary calculation was capped at 50 reports (since at least 3.9), causing incomplete context and missing cards for contacts with more than 50 reports

## Domain Rationale

**Fit:** strong

The fix lives in the contact view model generator and contacts-content component, which assemble a contact's profile and its contact-summary card data. The contact-summary feature is squarely a contacts-domain concept; reports merely feed the calculation but the change concerns how the contact view loads its own data.
