---
id: cht-core-10332
category: feature
domain: tasks-and-targets
domainFit: strong
issueNumber: 10332
issueUrl: https://github.com/medic/cht-core/issues/10332
title: Add telemetry for analytics target aggregates sidebar filter selection
lastUpdated: '2026-06-22'
summary: Telemetry previously only recorded when the analytics target-aggregates sidebar filter was opened, not when a user actually applied a selection (e.g. 'Previous month'). This PR adds telemetry collection for the filter selection/change event on target aggregates.
services:
  - webapp
techStack:
  - typescript
  - angular
  - html
  - webdriverio
  - karma
tags:
  - telemetry
  - analytics
  - target-aggregates
  - sidebar-filter
  - observability
related_workflows:
  - observability
source_pr: medic/cht-core#10371
source_sha: fef3308dce7e285d19aa9fd3c552e1b0aff25c11
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - webapp/src/ts/components/filters/analytics-filter/analytics-filter.component.ts
  - webapp/src/ts/modules/analytics/analytics-sidebar-filter.component.ts
  - webapp/src/ts/modules/analytics/analytics-targets.component.html
  - tests/utils/telemetry.js
concepts:
  - telemetry instrumentation
  - user behaviour analytics
  - sidebar filter selection
  - observability
related_issues: []
stale: false
---

## Problem

The analytics target-aggregates view only emitted `sidebar_filter:analytics:target_aggregates:open` telemetry, which records that a user opened the filter but gives no insight into whether they actually selected/applied a filter option such as 'Previous month'.

## Root Cause

The analytics filter component recorded a telemetry event only on filter open and had no instrumentation hooked to the filter selection/change event, so applied-filter usage was invisible in telemetry.

## Solution

Added telemetry recording for the target sidebar filter selection event in the analytics-filter and analytics-sidebar-filter components (in addition to the existing open event), wired through the analytics-targets template, plus a shared telemetry test util and e2e assertions.

## Code Patterns

Instrument filter usage via `telemetryService.record('sidebar_filter:analytics:target_aggregates:...')` for both open and selection events; assert emitted telemetry entries in e2e using the shared helper at tests/utils/telemetry.js (pattern mirrored from tests/e2e/default/contacts/duplicate-contacts.wdio-spec.js).

## Design Choices

Recorded a distinct selection event alongside the existing open event rather than replacing it, so both 'opened' and 'applied' signals are captured separately. Added e2e telemetry assertions and a reusable telemetry test util per reviewer (jkuester) feedback.

## Related Files

- tests/e2e/default/analytics/analytics.wdio-spec.js
- tests/e2e/default/contacts/duplicate-contacts.wdio-spec.js
- tests/e2e/default/targets/target-aggregates.wdio-spec.js
- tests/utils/telemetry.js
- webapp/src/ts/components/filters/analytics-filter/analytics-filter.component.ts
- webapp/src/ts/modules/analytics/analytics-sidebar-filter.component.ts
- webapp/src/ts/modules/analytics/analytics-targets.component.html
- webapp/tests/karma/ts/components/filters/analytics-filter.component.spec.ts
- webapp/tests/karma/ts/modules/analytics/analytics-sidebar-filter-component.spec.ts

## Testing

Added/updated karma unit tests for the analytics-filter and analytics-sidebar-filter components and added e2e (wdio) assertions for the telemetry entries across the analytics, target-aggregates, and duplicate-contacts specs, backed by a new shared telemetry assertion util in tests/utils/telemetry.js.

## Related Issues

- #10332: collect telemetry when a user actually selects a target sidebar filter (e.g. 'Previous month'), not just when the filter is opened

## Domain Rationale

**Fit:** strong

The change instruments the analytics 'target aggregates' sidebar filter; target aggregates and coverage views are squarely part of the tasks-and-targets domain. The telemetry/observability nature is cross-cutting and captured in relatedWorkflows rather than altering the functional home.
