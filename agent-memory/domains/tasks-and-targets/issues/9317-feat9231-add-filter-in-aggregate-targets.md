---
id: cht-core-9231
category: feature
domain: tasks-and-targets
domainFit: strong
issueNumber: 9231
issueUrl: https://github.com/medic/cht-core/issues/9231
title: Add facility (place) and reporting-period filters to aggregate targets, re-enabling the view for users assigned to multiple facilities
lastUpdated: '2026-06-23'
summary: After 4.9.0 multi-place support, users with multiple facility_ids were temporarily blocked from viewing aggregate targets and there was no way to filter them by facility or period. This combines 5 PRs to add place and reporting-period filters (plus a facility indicator) and re-enable the aggregate targets view for multi-facility users.
services:
  - webapp
  - api
techStack:
  - typescript
  - angular
  - less
  - javascript
  - webdriverio
  - karma
tags:
  - aggregate-targets
  - target-filtering
  - place-filter
  - period-filter
  - sidebar-filter
  - multi-facility
  - analytics
  - calendar-interval
  - i18n
related_workflows:
  - ui-extensions
source_pr: medic/cht-core#9317
source_sha: 837c7fe2badf3fcd4c5d2596933a8f26e4292cd1
distilled_at: '2026-06-23'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - webapp/src/ts/modules/analytics/analytics-target-aggregates.component.ts
  - webapp/src/ts/modules/analytics/analytics-target-aggregates-sidebar-filter.component.ts
  - webapp/src/ts/modules/analytics/analytics-target-aggregates-detail.component.ts
  - webapp/src/ts/services/target-aggregates.service.ts
  - webapp/src/ts/components/filters/analytics-filter/analytics-filter.component.ts
  - webapp/src/ts/services/calendar-interval.service.ts
  - shared-libs/calendar-interval/src/index.js
concepts:
  - target aggregates
  - sidebar filtering
  - reporting period / calendar interval
  - multi-facility user support
  - place/facility filtering
  - analytics module
related_issues: []
stale: false
---

## Problem

Following 4.9.0 changes that let users be assigned to multiple places/facilities, users with multiple facility_ids were temporarily blocked from viewing aggregate targets. Additionally, aggregate targets could only be viewed for a single area and the current reporting period — there was no way to filter by facility or by past reporting periods.

## Root Cause

When multi-place support landed in 4.9.0, the aggregate targets feature (which assumed a single facility and the current reporting period) was disabled for users with multiple facility_ids instead of being reworked. The analytics target-aggregates module/service had no place selector and no period filter.

## Solution

Combined 5 incremental PRs to: add a place/facility selector via the shared analytics-filter so multi-facility users can choose which facility's aggregates to view; add a sidebar filter for reporting period backed by the calendar-interval service and shared-lib; display a facility indicator on the aggregates view; re-enable aggregate targets for multi-facility users; and add new translation keys and unit + e2e coverage.

## Code Patterns

analytics-target-aggregates-sidebar-filter.component reuses the shared sidebar-filter pattern (also used by Reports/Contacts); calendar-interval.service plus shared-libs/calendar-interval compute reporting periods robustly across year boundaries and leap years; analytics-filter.component is extended with a place dropdown for multi-facility users; target-aggregates.service fetches aggregates scoped to a selected place and period.

## Design Choices

Reused the existing sidebar-filter and analytics-filter UI patterns for consistency with Reports/Contacts rather than building a bespoke filter; delegated period math to the calendar-interval shared lib so year transitions and leap years are handled correctly; bundled 5 dependent PRs into one merge for atomic delivery of the complete feature.

## Related Files

- webapp/src/ts/modules/analytics/analytics-target-aggregates.component.ts
- webapp/src/ts/modules/analytics/analytics-target-aggregates.component.html
- webapp/src/ts/modules/analytics/analytics-target-aggregates-sidebar-filter.component.ts
- webapp/src/ts/modules/analytics/analytics-target-aggregates-sidebar-filter.component.html
- webapp/src/ts/modules/analytics/analytics-target-aggregates-detail.component.ts
- webapp/src/ts/modules/analytics/analytics-target-aggregates-detail.component.html
- webapp/src/ts/modules/analytics/analytics.routes.ts
- webapp/src/ts/components/filters/analytics-filter/analytics-filter.component.ts
- webapp/src/ts/components/filters/analytics-filter/analytics-filter.component.html
- webapp/src/ts/services/target-aggregates.service.ts
- webapp/src/ts/services/calendar-interval.service.ts
- webapp/src/ts/services/analytics-modules.service.ts
- webapp/src/ts/services/user-settings.service.ts
- shared-libs/calendar-interval/src/index.js
- webapp/src/css/sidebar-filter.less
- webapp/src/css/targets.less
- api/resources/translations/messages-en.properties
- tests/e2e/default/targets/target-aggregates.wdio-spec.js

## Testing

Added/updated Karma unit specs for the analytics-filter component, the target-aggregates component/detail/sidebar-filter, target-aggregates.service, user-settings.service, and calendar-interval. Added WebdriverIO e2e specs, page objects, helper functions, and config for place/period filtering. Reviewers also performed manual exploratory testing: undefined handling, January 2025 -> previous-period crossing, leap years, admin users, online vs offline users, and very long place names.

## Related Issues

- #9231: Enable users assigned to multiple facilities to view aggregate targets and add period filtering
- #9232: Enable place filter for aggregate targets for users with multiple facilities
- #9267: Filter target aggregate data using sidebar filter
- #9282: Add facility indicator in aggregate targets
- #9283: Filter aggregate targets by period
- #9305: e2e tests for aggregate targets (place, period)

## Domain Rationale

**Fit:** strong

The PR adds filtering (by facility and reporting period) to the aggregate targets analytics view and re-enables it for multi-facility users; aggregate targets and coverage metrics are canonically the tasks-and-targets domain. The multi-facility angle is about feature availability, not roles/permissions, so it stays here rather than authentication.
