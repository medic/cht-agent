---
id: cht-core-9231
category: feature
domain: tasks-and-targets
domainFit: strong
issueNumber: 9231
issueUrl: https://github.com/medic/cht-core/issues/9231
title: Enable place filter for aggregate targets for users with multiple facility_ids
lastUpdated: '2026-07-31'
summary: Users assigned to multiple facilities had no way to scope the aggregate targets analytics view by place. Added a sidebar place filter letting users scope aggregate targets to a selected facility. It is gated on the user having a facility list at all, not on how long that list is, so single-facility users get the filter button and sidebar too.
services:
  - webapp
  - api
techStack:
  - typescript
  - angular
  - less
  - karma
  - webdriverio
tags:
  - target-aggregates
  - place-filter
  - analytics
  - multi-facility
  - sidebar-filter
  - facility_ids
  - facility-indicator
  - period-filter
  - calendar-interval
related_workflows:
  - ui-extensions
source_pr: medic/cht-core#9232
source_prs:
  - "medic/cht-core#9232"
  - "medic/cht-core#9282"
  - "medic/cht-core#9317"
source_sha: 06646f756fdbe0c71d738d59d86dafcf23499064
distilled_at: '2026-06-23'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - webapp/src/ts/modules/analytics/analytics-target-aggregates.component.ts
  - webapp/src/ts/modules/analytics/analytics-target-aggregates-sidebar-filter.component.ts
  - webapp/src/ts/modules/analytics/analytics-target-aggregates-detail.component.ts
  - webapp/src/ts/components/filters/analytics-filter/analytics-filter.component.ts
  - webapp/src/ts/services/target-aggregates.service.ts
  - webapp/src/ts/services/user-settings.service.ts
  - webapp/src/ts/services/analytics-modules.service.ts
  - webapp/src/ts/services/calendar-interval.service.ts
  - webapp/src/ts/modules/analytics/analytics.routes.ts
  - shared-libs/calendar-interval/src/index.js
concepts:
  - target aggregates analytics
  - place/facility filtering
  - sidebar filter component
  - multi-facility users (facility_id as array)
  - conditional UI based on user settings
  - analytics module routing
  - facility/place hierarchy context
  - reporting period / calendar interval
  - LESS variable-based color theming
related_issues: []
stale: false
---

## Problem

The aggregate targets analytics page had no place filter, so a user assigned to multiple facilities (multiple facility_ids) could not narrow the aggregated target metrics to a single facility. The filtering affordance simply did not exist for the multi-facility case. Following the 4.9.0 changes that let users be assigned to multiple places/facilities, multi-facility users were in fact temporarily blocked from viewing aggregate targets at all, and there was no way to filter by facility or by past reporting periods (PR #9317). The aggregate targets list and details also gave no indication of which facility was currently selected, making the displayed data ambiguous when navigating the place hierarchy, and the report sidebar filter colors had regressed from the 4.9 styling (PR #9282).

## Root Cause

The analytics target-aggregates view was built without place filtering and did not account for users whose facility_id is an array. There was no mechanism to read multiple facilities from user settings or to surface a filter button/sidebar for them. When multi-place support landed in 4.9.0, the aggregate targets feature (which assumed a single facility and the current reporting period) was disabled for users with multiple facility_ids instead of being reworked, and the module/service had no place selector and no period filter (PR #9317). The list and detail components also rendered target data without surfacing the selected facility, and the sidebar filter CSS had drifted from the 4.9 LESS color variables/styles (PR #9282).

## Solution

Added a dedicated sidebar place filter (analytics-target-aggregates-sidebar-filter component) wired into the analytics-filter component and analytics routes. user-settings.service gains `getUserFacilities(): Promise<Place.v1.Place[]>` and `hasMultipleFacilities()` (the latter has no production caller at this commit); the Filter button comes from analytics-filter.component, whose `canDisplayFilterButton()` gates only on `!isAdmin`, on `authService.has([OLD_REPORTS_FILTER_PERMISSION, OLD_ACTION_BAR_PERMISSION])` resolving false, on the active module being `AGGREGATE_TARGETS_ID`, and on `targetAggregatesService.isEnabled()` — there is no facility-count term, so single-facility users get the button and the sidebar too. Only the facility radio group inside the sidebar (`*ngIf="userFacilities.length > 1"`) and the per-aggregate facility indicator (`this.userFacilities.length > 1 && this.facilityFilter?.name` in `formatAggregate` in analytics-target-aggregates.component.ts) are multi-facility-only. target-aggregates.service scopes aggregates to the selected place and period via `getAggregates(facilityId, reportingPeriod)`; analytics-modules.service only gains the exported `AGGREGATE_TARGETS_ID` constant. CSS (inbox.less, sidebar-filter.less, variables.less) styles the sidebar for desktop and mobile.

A follow-up added a facility indicator to the aggregate targets list and details by resolving the selected facility (via user-settings.service / target-aggregates.service) and rendering it in the component templates, and restored the report sidebar filter colors by aligning sidebar-filter.less, targets.less, inbox.less, and variables.less with the 4.9 styling (PR #9282). A subsequent PR added a sidebar filter for reporting period backed by the calendar-interval service and shared-lib, re-enabled aggregate targets for multi-facility users, and added new translation keys (api/resources/translations/messages-en.properties) plus unit and e2e coverage (PR #9317).

## Code Patterns

Gate UI affordances on user settings shape — render the filter button/sidebar only when facility_id resolves to multiple facilities (webapp/src/ts/modules/analytics/analytics-target-aggregates.component.ts). Reuse of the shared analytics-filter sidebar pattern (webapp/src/ts/components/filters/analytics-filter/analytics-filter.component.ts) for a new analytics sub-view, the same sidebar-filter pattern also used by Reports/Contacts. Resolve the user's selected place from user-settings.service.ts and thread it into analytics views to display contextual facility info; centralize filter/target colors as LESS variables in webapp/src/css/variables.less and consume them from sidebar-filter.less, targets.less, and inbox.less for consistent theming (PR #9282). calendar-interval.service plus shared-libs/calendar-interval compute reporting periods robustly across year boundaries and leap years; target-aggregates.service fetches aggregates scoped to a selected place and period (PR #9317).

## Design Choices

The Filter button and sidebar are shown to all non-admin users on the aggregate-targets module (single-facility users included), because the sidebar always offers the reporting-period filter; only the facility radio group inside the sidebar and the per-aggregate facility indicator are conditional on `userFacilities.length > 1`, so a single-facility user's data view is unchanged. The sidebar-filter pattern was reused for visual/interaction consistency with other analytics filters (and with Reports/Contacts) rather than building a bespoke filter, and the change was validated against the legacy filter design (`can_view_old_filter_and_search`, alongside `can_view_old_action_bar`) so the older UI still renders correctly. An explicit return type was added to the aggregate targets service method so callers know whether they receive an object, array, or null (PR #9282). Period math was delegated to the calendar-interval shared lib so year transitions and leap years are handled correctly (PR #9317).

## Related Files

- webapp/src/ts/modules/analytics/analytics-target-aggregates.component.ts
- webapp/src/ts/modules/analytics/analytics-target-aggregates.component.html
- webapp/src/ts/modules/analytics/analytics-target-aggregates-sidebar-filter.component.ts
- webapp/src/ts/modules/analytics/analytics-target-aggregates-sidebar-filter.component.html
- webapp/src/ts/modules/analytics/analytics-target-aggregates-detail.component.ts
- webapp/src/ts/modules/analytics/analytics-target-aggregates-detail.component.html
- webapp/src/ts/components/filters/analytics-filter/analytics-filter.component.ts
- webapp/src/ts/components/filters/analytics-filter/analytics-filter.component.html
- webapp/src/ts/services/target-aggregates.service.ts
- webapp/src/ts/services/user-settings.service.ts
- webapp/src/ts/services/analytics-modules.service.ts
- webapp/src/ts/services/calendar-interval.service.ts
- webapp/src/ts/services/rules-engine.service.ts
- webapp/src/ts/modules/analytics/analytics.routes.ts
- webapp/src/ts/modules/modules.module.ts
- shared-libs/calendar-interval/src/index.js
- api/resources/translations/messages-en.properties
- webapp/src/css/inbox.less
- webapp/src/css/sidebar-filter.less
- webapp/src/css/targets.less
- webapp/src/css/variables.less
- tests/page-objects/default/targets/target-aggregates.wdio.page.js
- tests/e2e/default/targets/target-aggregates.wdio-spec.js
- webapp/tests/karma/ts/modules/analytics/analytics-target-aggregates.component.spec.ts
- webapp/tests/karma/ts/modules/analytics/analytics-target-aggregates-sidebar-filter-component.spec.ts
- webapp/tests/karma/ts/components/filters/analytics-filter.component.spec.ts
- webapp/tests/karma/ts/services/user-settings.service.spec.ts

## Testing

Karma unit tests added/updated for the new and modified code: analytics-filter.component.spec.ts, analytics-target-aggregates-sidebar-filter-component.spec.ts, analytics-target-aggregates.component.spec.ts, analytics.component.spec.ts, target-aggregates.service.spec.ts, user-settings.service.spec.ts, and calendar-interval. Verification covered the view both with and without the feature, including the legacy design path (`can_view_old_filter_and_search`), and single-facility versus multi-facility users on desktop and mobile — both see the filter button and sidebar; only the facility radio group and the per-aggregate place indicator differ. The WebdriverIO target-aggregates page object was updated and e2e specs, page objects, helper functions, and config were added for place/period filtering (PRs #9282, #9317). Exploratory testing covered undefined handling, the January 2025 previous-period crossing, leap years, admin users, online vs offline users, and very long place names (PR #9317).

## Related Issues

- #9231: enable place filter aggregate targets for users with multiple facility_ids (tracking issue)
- #9267: Filter target aggregate data using sidebar filter
- #9283: Filter aggregate targets by period
- #9305: e2e tests for aggregate targets (place, period)

## Domain Rationale

**Fit:** strong

The PR adds place-based filtering to the aggregate targets analytics view; target aggregates and coverage analytics are squarely in the tasks-and-targets domain. Strong fit because it extends target functionality itself — the shared filter/sidebar components it reuses are just plumbing. The multi-facility angle is about feature availability, not roles/permissions, so it stays here rather than authentication.
