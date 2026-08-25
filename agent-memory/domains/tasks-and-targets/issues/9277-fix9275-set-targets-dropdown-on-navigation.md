---
id: cht-core-9275
category: bug
domain: tasks-and-targets
domainFit: strong
issueNumber: 9275
issueUrl: https://github.com/medic/cht-core/issues/9275
title: Set targets dropdown selection on navigation in the analytics filter component
lastUpdated: '2026-07-31'
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

The analytics-filter component did subscribe to route changes, but to the parent `ActivatedRoute`'s `url` observable (`this.route.url.subscribe(() => this.setActiveModule())`). The component is rendered from analytics.component.html — the template of the parent `analytics` route, with `moduleId` living on the `targets`/`target-aggregates` child routes — so that observable does not re-emit when navigation only switches children. `setActiveModule` was therefore not re-run, and the `ngAfterContentChecked` fallback only called it while `!this.activeModule`, so the dropdown kept its first-resolved module.

## Solution

Updated analytics-filter.component.ts to set the targets dropdown selection on navigation, synchronizing the dropdown's selected value with the current route so the correct target view is reflected after navigating.

## Code Patterns

When a parent component must track a child route's data, subscribe to `Router.events` filtered on `ActivationEnd` and read the id off `event.snapshot.data` rather than subscribing to the parent `ActivatedRoute.url` and re-reading `route.snapshot.firstChild`, in webapp/src/ts/components/filters/analytics-filter/analytics-filter.component.ts.

## Design Choices

Keeps the dropdown's selected state driven by navigation so the control stays consistent with the active view, rather than relying on the parent `ActivatedRoute.url` subscription, which never re-emitted for child-route-only navigations.

## Related Files

- webapp/src/ts/components/filters/analytics-filter/analytics-filter.component.ts
- webapp/tests/karma/ts/components/filters/analytics-filter.component.spec.ts

## Testing

A new Karma spec, webapp/tests/karma/ts/components/filters/analytics-filter.component.spec.ts, was added to cover setting the targets dropdown on navigation. The fix was additionally verified manually (screen recording attached to the PR).

## Related Issues

- #9275: Targets dropdown not set/synchronized on navigation in the analytics filter

## Domain Rationale

**Fit:** strong

The PR fixes the targets dropdown in the analytics filter, which is the selector for the targets/target-aggregates views — squarely a targets feature. There is no generic 'analytics' or 'UI' domain, and tasks-and-targets is the most specific principled match rather than a least-bad fallback.
