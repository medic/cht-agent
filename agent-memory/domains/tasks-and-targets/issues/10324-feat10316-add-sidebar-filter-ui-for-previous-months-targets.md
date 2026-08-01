---
id: cht-core-10316
category: feature
domain: tasks-and-targets
domainFit: strong
issueNumber: 10316
issueUrl: https://github.com/medic/cht-core/issues/10316
title: Add sidebar filter UI for viewing previous months' targets in analytics
lastUpdated: '2026-07-31'
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

The analytics targets view only showed the current reporting month's data. The target-aggregates view already had a sidebar filter with This month / Last month options (shipped in #9317), but there was no equivalent control on the targets view, so managers and supervisors could not look back at a previous month's targets there.

## Root Cause

Feature gap on the analytics targets page specifically: the target-aggregates page had carried a reporting-period sidebar filter (This month / Last month radios) since #9317 (analytics-target-aggregates-sidebar-filter.component.ts, 2024-08-14) and target-aggregates.service.ts already resolved its interval tag from a ReportingPeriod, but the targets view had no month-selection control and `fetchTargets()` on webapp/src/ts/services/rules-engine.service.ts took no reporting-period argument (it gained one in this work: `fetchTargets(reportingPeriod = ReportingPeriod.CURRENT)`).

## Solution

Added a new analytics-sidebar-filter Angular component opened by a filter icon on the green action bar, presenting two radio options (This month / Previous month). The selection drives the analytics-targets and analytics-target-aggregates components and the target-aggregates service to load the chosen month's data. Routing, the analytics-modules service, and CSS (inbox.less, targets.less) were updated, with support for both new (default) and old (can_view_old_navigation) navigation designs and RTL layouts.

## Code Patterns

The sidebar filter is the existing analytics target-aggregates sidebar filter generalised: analytics-target-aggregates-sidebar-filter.component.ts/html were replaced by analytics-sidebar-filter.component.ts/html (AnalyticsSidebarFilterComponent), which adds showFacilityFilter and telemetryKey inputs so the targets page can embed it with [showFacilityFilter]="false". Filter trigger is wired through analytics-filter.component.ts; month-scoped data retrieval was added to target-aggregates.service.ts and surfaced via analytics-modules.service.ts.

## Design Choices

Reused the established sidebar-filter pattern for UI consistency; radio buttons enforce mutually-exclusive month selection; explicitly validated for new and old navigation designs and RTL languages for backward compatibility.

## Related Files

> **Paths are as of this PR, not as of master.** This change merged into the `10140_previous-month-targets` feature branch and reached master only in that epic's squash, medic/cht-core#10423 (`622c625427`), which renamed and relocated several of the files below. The e2e suite moved from analytics/ to targets/.

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
- tests/e2e/default/analytics/analytics.wdio-spec.js (PR-era path; the suite lives at tests/e2e/default/targets/analytics.wdio-spec.js on master, the e2e directory having been renamed analytics/ -> targets/ inside the epic)
- tests/page-objects/default/analytics/analytics.wdio.page.js

## Testing

Added an e2e WebdriverIO spec (analytics.wdio-spec.js) plus page-object methods for opening and closing the sidebar, and Karma unit specs (mocha + chai + sinon, per webapp/tests/karma/karma-unit.base.conf.js) for the sidebar-filter, targets, target-aggregates, target-aggregates-detail, and analytics-filter components and the target-aggregates service.

## Related Issues

- #10316: Add sidebar filter UI for previous months targets

## Domain Rationale

**Fit:** strong

The PR adds month-selection filtering to the analytics targets and target-aggregates views. Targets and coverage metrics are canonically the tasks-and-targets domain, and the change is entirely about target data presentation.
