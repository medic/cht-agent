---
id: cht-core-10318
category: feature
domain: tasks-and-targets
domainFit: strong
issueNumber: 10318
issueUrl: https://github.com/medic/cht-core/issues/10318
title: Display previous month's targets and aggregates with dynamic subtitle, mobile back button, and selected-filter count
lastUpdated: '2026-06-22'
summary: When the 'previous month' reporting period was selected, the analytics targets and target-aggregates pages didn't surface the right context (they showed the previous month name and lacked navigation/filter affordances). This PR wires the selected reporting period through the components, derives the target subtitle dynamically, adds a mobile back button for the previous-month view, and shows a count of how many filters are selected.
services:
  - webapp
techStack:
  - typescript
  - angular
  - less
  - ngrx
tags:
  - targets
  - target-aggregates
  - analytics
  - reporting-period
  - sidebar-filter
  - filter-count
  - mobile-ui
related_workflows:
  - ui-extensions
source_pr: medic/cht-core#10436
source_sha: 06d72b51753e4a8d0ddd27aab3e026ac30d04cff
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - webapp/src/ts/modules/analytics/analytics-targets.component.ts
  - webapp/src/ts/modules/analytics/analytics-target-aggregates.component.ts
  - webapp/src/ts/modules/analytics/analytics-sidebar-filter.component.ts
  - webapp/src/ts/components/filters/analytics-filter/analytics-filter.component.ts
  - webapp/src/ts/services/rules-engine.service.ts
  - webapp/src/ts/services/target-aggregates.service.ts
  - webapp/src/ts/libs/config.ts
  - webapp/src/ts/reducers/global.ts
concepts:
  - reporting-period filtering (CURRENT vs PREVIOUS)
  - target subtitle derivation from config
  - shared analytics sidebar filter state
  - ngrx global state
  - rules-engine target fetching
  - responsive mobile title-bar navigation
related_issues: []
stale: false
---

## Problem

Selecting the previous month in the analytics 'Reporting Period' sidebar filter did not present previous-month targets with appropriate context: the target-aggregates page displayed the previous month's name instead of a meaningful subtitle, there was no back button in the mobile title bar when viewing the previous month, and neither the targets nor the target-aggregates page indicated how many filters were currently selected.

## Root Cause

The analytics targets / target-aggregates components and the shared analytics filter components did not fully propagate the selected reportingPeriod through to the UI subtitle/title rendering and the rules-engine target fetch. Subtitle text was effectively static (month name) rather than derived dynamically, and the filter UI lacked a selected-count and a contextual mobile back affordance.

## Solution

Threaded the selected reporting period (current/previous) through analytics-targets and analytics-target-aggregates components down to the rules-engine target fetch; derived the monthly target subtitle dynamically in webapp/src/ts/libs/config.ts so it works for both current and previous periods (instead of showing the previous month's name on the aggregates page); added a back button in the mobile title bar when the previous month is selected; and added a selected-filter count badge to both the targets and target-aggregates pages via the shared analytics filter / sidebar-filter components, backed by global state in reducers/global.ts.

## Code Patterns

Pass ReportingPeriod (CURRENT | PREVIOUS) from the analytics sidebar filter through the component into target-fetch logic (rules-engine.service.ts / target-aggregates.service.ts). Derive display subtitle from config in webapp/src/ts/libs/config.ts rather than hardcoding period/month strings. Compute and render a selected-filter count badge in the reusable analytics-filter.component for cross-view reuse.

## Design Choices

Reused the existing shared analytics sidebar filter framework and ngrx global state (reducers/global.ts) instead of introducing new view-specific state, and centralized subtitle derivation in libs/config.ts so a single dynamic rule serves both current- and previous-month rendering across the targets and aggregates pages. The targets/aggregates area is already a tangle of selectors and listeners; this change passes the period param through that existing wiring rather than refactoring it.

## Related Files

- webapp/src/ts/modules/analytics/analytics-targets.component.ts
- webapp/src/ts/modules/analytics/analytics-targets.component.html
- webapp/src/ts/modules/analytics/analytics-target-aggregates.component.ts
- webapp/src/ts/modules/analytics/analytics-target-aggregates.component.html
- webapp/src/ts/modules/analytics/analytics-sidebar-filter.component.ts
- webapp/src/ts/modules/analytics/analytics-sidebar-filter.component.html
- webapp/src/ts/components/filters/analytics-filter/analytics-filter.component.ts
- webapp/src/ts/components/filters/analytics-filter/analytics-filter.component.html
- webapp/src/ts/services/rules-engine.service.ts
- webapp/src/ts/services/target-aggregates.service.ts
- webapp/src/ts/libs/config.ts
- webapp/src/ts/reducers/global.ts
- webapp/src/css/inbox.less

## Testing

Broad test coverage added/updated. Karma unit specs updated for analytics-targets, analytics-target-aggregates, analytics-sidebar-filter, analytics-filter, rules-engine.service, and target-aggregates.service. A new Mocha unit-test harness was added for the webapp (webapp/tests/mocha/.mocharc.js, tsconfig.mocha.json, tsconfig.spec.json) specifically to unit-test webapp/src/ts/libs/config.ts (config.spec.ts). WDIO e2e specs were updated for targets analytics and target-aggregates, including new page objects (analytics, target-aggregates) and helper functions (aggregates-helper-functions.js, targets-helper-functions.js) plus updated e2e target-aggregates config.

## Related Issues

- #10318: Implement filtering of targets when the reporting period (current/previous month) is selected in the analytics sidebar

## Domain Rationale

**Fit:** strong

The entire PR is about rendering target and target-aggregate data and filtering it by reporting period (current vs previous month) on the analytics targets pages — squarely the targets feature area. The dynamic-subtitle change in libs/config.ts is in service of the targets display, not a standalone configuration change, so it stays in tasks-and-targets rather than configuration.
