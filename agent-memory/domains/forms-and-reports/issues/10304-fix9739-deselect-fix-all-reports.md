---
id: cht-core-9739
category: bug
domain: forms-and-reports
domainFit: strong
issueNumber: 9739
issueUrl: https://github.com/medic/cht-core/issues/9739
title: Fix 'Select all' deselection not clearing selected reports on the reports page
lastUpdated: '2026-06-22'
summary: Deselecting the 'Select all' checkbox on the reports page left previously selected reports still selected; the reports component's deselect handler was corrected to clear the selection state.
services:
  - webapp
techStack:
  - typescript
  - angular
  - rxjs
  - ngrx
  - karma
tags:
  - reports
  - select-all
  - deselect
  - bulk-selection
  - checkbox
  - ui-state
related_workflows: []
source_pr: medic/cht-core#10304
source_sha: cdbb21a272af5458be60d611151523893766abdb
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - webapp/src/ts/modules/reports/reports.component.ts
concepts:
  - bulk report selection
  - select-all/deselect-all toggle state
  - selected-items state management
related_issues: []
stale: false
---

## Problem

On the reports page, checking 'Select all' selected every report, but unchecking 'Select all' did not clear the selection — the previously selected reports remained selected, leaving the UI selection state inconsistent (issue #9739).

## Root Cause

The deselect path of the 'Select all' toggle in reports.component.ts did not dispatch/perform the clearing of the selected-reports state, so toggling the checkbox off was a no-op against the existing selection rather than resetting it.

## Solution

Corrected the reports component so that deselecting the 'Select all' checkbox properly clears the selected reports, ensuring the selection state mirrors the checkbox; accompanying unit tests were added/updated to cover the deselect behavior.

## Code Patterns

Toggle handler in webapp/src/ts/modules/reports/reports.component.ts should handle both branches explicitly: select-all populates the selection while deselect-all resets it (clear selected reports), keeping UI checkbox state and the selected-items store in sync.

## Design Choices

Fix targeted the deselect branch of the existing select-all toggle rather than reworking the selection model, keeping the change minimal and backwards compatible with existing selection behavior.

## Related Files

- webapp/src/ts/modules/reports/reports.component.ts
- webapp/tests/karma/ts/modules/reports/reports.component.spec.ts

## Testing

Karma unit tests in reports.component.spec.ts were added/modified to verify that deselecting 'Select all' clears the selected reports.

## Related Issues

- #9739: Deselecting the 'Select all' checkbox on the reports page did not clear the selected reports

## Domain Rationale

**Fit:** strong

The change lives entirely in the reports module (reports.component.ts) and fixes selection behavior on the reports list page, which is core forms-and-reports functionality; no sync, permission, or config concern is involved.
