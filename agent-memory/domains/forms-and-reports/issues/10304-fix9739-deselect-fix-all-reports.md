---
id: cht-core-9739
category: bug
domain: forms-and-reports
domainFit: strong
issueNumber: 9739
issueUrl: https://github.com/medic/cht-core/issues/9739
title: Fix 'Select all' deselection not clearing selected reports on the reports page
lastUpdated: '2026-08-09'
summary: Deselecting the 'Select all' checkbox on the reports page left previously selected reports still selected. The deselect handler was never at fault — `areAllReportsSelected()` mis-computed the toggle state, so the template routed the click back into select-all instead of deselect-all. The predicate was rewritten against a new `totalReportsCount` field.
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
  - computed toggle predicate driving the click branch
  - rendered page vs total selection count
related_issues: []
stale: false
---

## Problem

On the reports page, checking 'Select all' selected every report, but unchecking 'Select all' did not clear the selection — the previously selected reports remained selected, leaving the UI selection state inconsistent (issue #9739).

## Root Cause

Not the deselect handler — `deselectAllReports()` already cleared the state and is not in this PR's diff at all. The template picks the branch from a computed predicate:

```
(click)="areAllReportsSelected() ? deselectAllReports() : selectAllReports()"
[checked]="areAllReportsSelected()"
```

and `areAllReportsSelected()` was `selectedReports.length >= LIMIT_SELECT_ALL_REPORTS (500) || reportsList.length === selectedReports.length`. `reportsList` holds only the rendered page, so with more reports selected than are rendered but fewer than the 500 cap the predicate returned false: the checkbox drew itself unchecked and the click re-ran `selectAllReports()`. That is why issue #9739's repro specifies an offline user with **at least 50 reports** — below that, the rendered page and the selection match and the predicate happens to be right.

## Solution

Added a `totalReportsCount` field to the reports component, set to the size of the prepared selection when `selectAllReports()` runs, and rewrote `areAllReportsSelected()` to compare the current selection against it (falling back to the 500-report cap when the count is unknown). With the predicate accurate, the template's existing ternary routes the second click into the already-correct `deselectAllReports()`. Neither `deselectAllReports()` nor the selection actions were changed.

## Code Patterns

When a template picks its action from a computed predicate — `(click)="areAllReportsSelected() ? deselectAllReports() : selectAllReports()"` in webapp/src/ts/modules/reports/reports.component.ts — the predicate is load-bearing, not just cosmetic: a wrong answer silently sends the click down the wrong branch. Compare the selection against a recorded total (`totalReportsCount`) rather than against the currently-rendered page (`reportsList`), which only holds what is on screen.

## Design Choices

Fixed the toggle-state predicate rather than the handlers or the selection model: `deselectAllReports()` already did the right thing, so the minimal correct change was to record how many reports select-all actually selected and compare against that. Kept `LIMIT_SELECT_ALL_REPORTS` as the fallback so behavior is unchanged before select-all has ever run.

## Related Files

- webapp/src/ts/modules/reports/reports.component.ts
- webapp/tests/karma/ts/modules/reports/reports.component.spec.ts

## Testing

No deselect-specific test was added. The existing Karma specs in reports.component.spec.ts were adjusted to seed `totalReportsCount` (two added lines) so the `areAllReportsSelected()` assertions stay valid under the new predicate — worth knowing, because the regression itself is still uncovered.

## Related Issues

- #9739: Deselecting the 'Select all' checkbox on the reports page did not clear the selected reports

## Domain Rationale

**Fit:** strong

The change lives entirely in the reports module (reports.component.ts) and fixes selection behavior on the reports list page, which is core forms-and-reports functionality; no sync, permission, or config concern is involved.
