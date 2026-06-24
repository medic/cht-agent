---
id: cht-core-10316
category: feature
domain: tasks-and-targets
domainFit: strong
issueNumber: 10316
issueUrl: https://github.com/medic/cht-core/issues/10316
title: Add sidebar filter UI for viewing previous months' targets in analytics
lastUpdated: '2026-06-22'
summary: Targets analytics only displayed the current month with no way to review prior periods. Added a sidebar filter (filter icon on the green bar with This month / Previous month radio buttons) wired into the analytics targets and target-aggregates views.
services:
  - webapp
techStack:
  - typescript
  - angular
  - less
  - webdriverio
  - karma
tags:
  - targets
  - target-aggregates
  - analytics
  - sidebar-filter
  - previous-months
  - ui
related_workflows:
  - ui-extensions
source_pr: medic/cht-core#10324
source_sha: 9337c841e9afd6c25652f534a6f0105f4675bd88
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - webapp/src/ts/modules/analytics/analytics-sidebar-filter.component.ts
  - webapp/src/ts/modules/analytics/analytics-targets.component.ts
  - webapp/src/ts/modules/analytics/analytics-target-aggregates.component.ts
  - webapp/src/ts/modules/analytics/analytics-target-aggregates-detail.component.ts
  - webapp/src/ts/components/filters/analytics-filter/analytics-filter.component.ts
  - webapp/src/ts/services/target-aggregates.service.ts
  - webapp/src/ts/services/analytics-modules.service.ts
concepts:
  - sidebar filter
  - target aggregates
  - analytics module
  - radio-button month selection
  - Angular component composition
  - old/new navigation compatibility
  - RTL support
related_issues: []
stale: false
---

## Problem

The analytics targets and target-aggregates views only showed the current reporting month's data. Managers and supervisors reviewing coverage had no UI to look back at a previous month's targets.

## Root Cause

Feature gap: the analytics module lacked any month-selection control, so target components and the target-aggregates service always computed/loaded data for the current interval only.

## Solution

Added a new analytics-sidebar-filter Angular component opened by a filter icon on the green action bar, presenting two radio options (This month / Previous month). The selection drives the analytics-targets and analytics-target-aggregates components and the target-aggregates service to load the chosen month's data. Routing, the analytics-modules service, and CSS (inbox.less, targets.less) were updated, with support for both new (default) and old (can_view_old_navigation) navigation designs and RTL layouts.

## Code Patterns

Sidebar filter mirrors the existing reports/contacts sidebar-filter UX (analytics-sidebar-filter.component.ts/html). Filter trigger is wired through analytics-filter.component.ts; month-scoped data retrieval was added to target-aggregates.service.ts and surfaced via analytics-modules.service.ts.

## Design Choices

Reused the established sidebar-filter pattern for UI consistency; radio buttons enforce mutually-exclusive month selection; explicitly validated for new and old navigation designs and RTL languages for backward compatibility.

## Related Files

- webapp/src/ts/modules/analytics/analytics-sidebar-filter.component.ts
- webapp/src/ts/modules/analytics/analytics-sidebar-filter.component.html
- webapp/src/ts/modules/analytics/analytics-targets.component.ts
- webapp/src/ts/modules/analytics/analytics-targets.component.html
- webapp/src/ts/modules/analytics/analytics-target-aggregates.component.ts
- webapp/src/ts/modules/analytics/analytics-target-aggregates.component.html
- webapp/src/ts/modules/analytics/analytics-target-aggregates-detail.component.ts
- webapp/src/ts/components/filters/analytics-filter/analytics-filter.component.ts
- webapp/src/ts/services/target-aggregates.service.ts
- webapp/src/ts/services/analytics-modules.service.ts
- webapp/src/ts/modules/analytics/analytics.routes.ts
- webapp/src/css/targets.less
- webapp/src/css/inbox.less
- tests/e2e/default/analytics/analytics.wdio-spec.js
- tests/page-objects/default/analytics/analytics.wdio.page.js

## Testing

Added an e2e WebdriverIO spec (analytics.wdio-spec.js) plus page-object methods for opening and closing the sidebar, and Karma/Jasmine unit specs for the sidebar-filter, targets, target-aggregates, target-aggregates-detail, and analytics-filter components and the target-aggregates service.

## Related Issues

- #10316: Add sidebar filter UI for previous months targets

## Domain Rationale

**Fit:** strong

The PR adds month-selection filtering to the analytics targets and target-aggregates views. Targets and coverage metrics are canonically the tasks-and-targets domain (per seed example #5), and the change is entirely about target data presentation.
