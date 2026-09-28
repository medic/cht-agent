---
id: cht-core-10332
category: feature
domain: tasks-and-targets
domainFit: strong
issueNumber: 10332
issueUrl: https://github.com/medic/cht-core/issues/10332
title: Add telemetry for analytics target aggregates sidebar filter selection
lastUpdated: '2026-08-07'
summary: Telemetry previously only recorded when the analytics target-aggregates sidebar filter was opened, not when a user actually applied a selection (e.g. 'Previous month'). This PR adds telemetry collection for the filter selection/change event, recorded by the shared sidebar filter so it covers the target-aggregates page by default and the targets page via a per-page key.
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

Added selection telemetry in the shared analytics-sidebar-filter.component.ts (collectFilterSelectionTelemetry records sidebar_filter:analytics:<telemetryKey>:<facility|reporting-period>:select), so both pages get the new selection events: the telemetryKey input defaults to `target_aggregates`, giving the aggregates page its selection telemetry with no wiring, and the targets page overrides it per-page where it embeds the sidebar in analytics-targets.component.html (`telemetryKey = "targets"` as the epic landed it); analytics-filter.component.ts still records only open events and gained sidebar_filter:analytics:targets:open alongside the existing target_aggregates one. E2e assertions were added on top of the pre-existing tests/utils/telemetry.js helper.

## Code Patterns

Instrument filter usage with a `sidebar_filter:analytics:<tab>:<action>` telemetry key, split across the two components that own each half — analytics-filter.component.ts records the `:open` events when the sidebar is opened, and the sidebar filter component records the selection events, whose action segment is `:facility` or `:reporting-period` (the code builds the key as a template literal, `` `sidebar_filter:analytics:${this.telemetryKey}:${filter}:select` ``); assert emitted telemetry entries in e2e using the shared helper at tests/utils/telemetry.js (pattern mirrored from tests/e2e/default/contacts/duplicate-contacts.wdio-spec.js).

## Design Choices

Recorded a distinct selection event alongside the existing open event rather than replacing it, so both 'opened' and 'applied' signals are captured separately. Added e2e telemetry assertions on top of the pre-existing tests/utils/telemetry.js helper, which this PR extended rather than introduced.

## Related Files

> **Paths are as of this PR, not as of master.** This change merged into the `10140_previous-month-targets` feature branch and reached master only in that epic's squash, medic/cht-core#10423 (`622c625427`), which renamed and relocated several of the files below. The e2e suite lives under tests/e2e/default/targets/ on master — renamed from analytics/ by #10480 (bed454652), not by the epic.

- tests/e2e/default/analytics/analytics.wdio-spec.js (PR-era path; on master the suite is tests/e2e/default/targets/analytics.wdio-spec.js — the analytics/ -> targets/ rename happened on master in #10480, commit bed454652)
- tests/e2e/default/contacts/duplicate-contacts.wdio-spec.js
- tests/e2e/default/targets/target-aggregates.wdio-spec.js
- tests/utils/telemetry.js
- webapp/src/ts/components/filters/analytics-filter/analytics-filter.component.ts
- webapp/src/ts/modules/analytics/analytics-sidebar-filter.component.ts
- webapp/src/ts/modules/analytics/analytics-targets.component.html
- webapp/tests/karma/ts/components/filters/analytics-filter.component.spec.ts
- webapp/tests/karma/ts/modules/analytics/analytics-sidebar-filter-component.spec.ts

## Testing

Added/updated karma unit tests for the analytics-filter and analytics-sidebar-filter components and added e2e (wdio) assertions for the telemetry entries across the analytics, target-aggregates, and duplicate-contacts specs, extending the pre-existing shared telemetry util at tests/utils/telemetry.js (added in #9609) with getTelemetry()/destroyTelemetryDb() helpers.

## Related Issues

- #10332: collect telemetry when a user actually selects a target sidebar filter (e.g. 'Previous month'), not just when the filter is opened

## Domain Rationale

**Fit:** strong

The change instruments the analytics sidebar filter shared by the target-aggregates and targets views; targets, target aggregates and coverage views are squarely part of the tasks-and-targets domain. The telemetry/observability nature is cross-cutting and captured in relatedWorkflows rather than altering the functional home.
