---
id: cht-core-10569
category: feature
domain: contacts
domainFit: strong
issueNumber: 10569
issueUrl: https://github.com/medic/cht-core/issues/10569
title: Display active (non-deceased) child contact count in contact profile group headers
lastUpdated: '2026-06-22'
summary: CHPs/CHAs had to scroll or manually count to know how many child contacts sat under a hierarchy level; this adds a localized parenthetical count (e.g. "People (2)", "Areas (5)") to each group header, computed from already-loaded in-memory data.
services:
  - webapp
techStack:
  - typescript
  - angular
  - less
  - html
tags:
  - contact-hierarchy
  - contact-profile
  - child-count
  - group-headers
  - ui-enhancement
  - localization
  - localizeNumber
related_workflows:
  - ui-extensions
source_pr: medic/cht-core#10804
source_sha: b8913e5917eda435893d256d677ecc06f175fffd
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - webapp/src/ts/services/contact-view-model-generator.service.ts
  - webapp/src/ts/modules/contacts/contacts-content.component.html
concepts:
  - contact hierarchy view model
  - child group model
  - in-memory aggregation (no extra DB query)
  - number localization pipe
  - RTL-compatible UI
related_issues: []
stale: false
---

## Problem

Users (mostly CHPs and CHAs) had no at-a-glance way to see how many child contacts — households, members, or sub-areas — existed under a given hierarchy level on a contact's profile. They had to scroll, manually count, or navigate to the performance window, slowing routine work.

## Root Cause

Not a defect: the contact profile's child group model exposed only group names and a deceasedCount, and the contacts-content template rendered headers (e.g. "People", "Areas") with no count. There was no active-count property computed or surfaced in the UI.

## Solution

Added an `activeCount` property to the child group model in ContactViewModelGeneratorService, computed alongside the existing `deceasedCount` within `markDeceased()` so no new iteration or database query is needed. Updated contacts-content.component.html to render the count as a parenthetical suffix on each group header, formatted via the existing `localizeNumber` pipe, with supporting styles in inbox.less.

## Code Patterns

Piggyback a new aggregate on an existing pass: derive `activeCount` in the same `markDeceased()` loop that already produces `deceasedCount` (contact-view-model-generator.service.ts) rather than adding a separate query/loop. Use the `localizeNumber` pipe in the template for locale-aware numeric display.

## Design Choices

Counts are computed from data already loaded in memory — no additional CouchDB queries — keeping the feature cheap and offline-safe. Display is purely additive (backwards compatible across hierarchy levels and RTL locales) and localized. Reviewer (jkuester) noted the bare parenthetical lacked visual distinction but ultimately approved (LGTM); the parenthetical-suffix approach was kept per the issue's design guidance.

## Related Files

- webapp/src/ts/services/contact-view-model-generator.service.ts
- webapp/src/ts/modules/contacts/contacts-content.component.html
- webapp/src/css/inbox.less
- webapp/tests/karma/ts/services/contact-view-model-generator.service.spec.ts
- tests/e2e/default/contacts/add-custom-hierarchy.wdio-spec.js

## Testing

Karma unit tests in contact-view-model-generator.service.spec.ts were updated to assert the new `activeCount` value, and the WebdriverIO e2e spec add-custom-hierarchy.wdio-spec.js was updated to cover the count rendered in group headers across a custom hierarchy.

## Related Issues

- #10569: Indicate the count of children (e.g. HHs/CHPs) under an area (CHP/CHU) so CHPs/CHAs don't have to scroll, manually count, or use the performance window

## Domain Rationale

**Fit:** strong

The change adds and renders a child-contact count on the contact profile page's hierarchy group headers, working entirely within the contacts module and its view-model generation — squarely contact management, not permissions, sync, or config.
