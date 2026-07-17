---
id: cht-core-9275
category: bug
domain: tasks-and-targets
domainFit: strong
issueNumber: 9275
issueUrl: https://github.com/medic/cht-core/issues/9275
title: Set targets dropdown selection on navigation in the analytics filter component
lastUpdated: '2026-06-23'
summary: The analytics filter's targets dropdown was not being set correctly when navigating, leaving it out of sync with the active targets view. The fix updates analytics-filter.component.ts to set the dropdown selection on navigation.
services:
  - webapp
techStack:
  - typescript
  - angular
  - karma
tags:
  - targets
  - analytics-filter
  - dropdown
  - navigation
  - ui
  - bugfix
related_workflows: []
source_pr: medic/cht-core#9277
source_sha: 88f9e463abcdd1944a62ced090e9ce870bdf9fb0
distilled_at: '2026-06-23'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - webapp/src/ts/components/filters/analytics-filter/analytics-filter.component.ts
concepts:
  - UI state synchronization with navigation
  - Angular component routing/lifecycle
  - analytics filtering
  - dropdown selected-state management
related_issues: []
stale: false
---

## Problem

The targets dropdown in the analytics filter did not reflect the correct selection when navigating between analytics views. Because the dropdown state was not set on navigation, it could display a stale or incorrect selected target module after route changes.

## Root Cause

The analytics-filter component did not update the targets dropdown's selected value in response to navigation/route changes, so the dropdown selection was not synchronized with the currently active analytics route/module.

## Solution

Updated analytics-filter.component.ts to set the targets dropdown selection on navigation, synchronizing the dropdown's selected value with the current route so the correct target view is reflected after navigating.

## Code Patterns

Derive/refresh UI dropdown selected-state from navigation/route changes rather than only on initial load, in webapp/src/ts/components/filters/analytics-filter/analytics-filter.component.ts.

## Design Choices

Keeps the dropdown's selected state driven by navigation so the control stays consistent with the active view, rather than relying on a one-time initialization that goes stale on route changes.

## Related Files

- webapp/src/ts/components/filters/analytics-filter/analytics-filter.component.ts
- webapp/tests/karma/ts/components/filters/analytics-filter.component.spec.ts

## Testing

Karma unit tests in analytics-filter.component.spec.ts were updated to cover setting the targets dropdown on navigation. The reviewer additionally verified the fix manually and confirmed it works (with a screen-recording attachment).

## Related Issues

- #9275: Targets dropdown not set/synchronized on navigation in the analytics filter

## Domain Rationale

**Fit:** strong

The PR fixes the targets dropdown in the analytics filter, which is the selector for the targets/target-aggregates views — squarely a targets feature. There is no generic 'analytics' or 'UI' domain, and tasks-and-targets is the most specific principled match rather than a least-bad fallback.
