---
id: cht-core-137
category: feature
domain: tasks-and-targets
domainFit: strong
issueNumber: 137
issueUrl: https://github.com/medic/cht-core/issues/137
title: Enable place filter for aggregate targets for users with multiple facility_ids
lastUpdated: '2026-06-23'
summary: Users assigned to multiple facilities had no way to scope the aggregate targets analytics view by place. Added a sidebar place filter that appears only for multi-facility users, letting them filter aggregate targets to a selected facility while single-facility users see no change.
services:
  - webapp
techStack:
  - typescript
  - angular
  - less
  - karma
tags:
  - target-aggregates
  - place-filter
  - analytics
  - multi-facility
  - sidebar-filter
  - facility_ids
related_workflows:
  - ui-extensions
source_pr: medic/cht-core#9232
source_sha: 06646f756fdbe0c71d738d59d86dafcf23499064
distilled_at: '2026-06-23'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - webapp/src/ts/modules/analytics/analytics-target-aggregates.component.ts
  - webapp/src/ts/modules/analytics/analytics-target-aggregates-sidebar-filter.component.ts
  - webapp/src/ts/components/filters/analytics-filter/analytics-filter.component.ts
  - webapp/src/ts/services/target-aggregates.service.ts
  - webapp/src/ts/services/user-settings.service.ts
  - webapp/src/ts/services/analytics-modules.service.ts
  - webapp/src/ts/modules/analytics/analytics.routes.ts
concepts:
  - target aggregates analytics
  - place/facility filtering
  - sidebar filter component
  - multi-facility users (facility_id as array)
  - conditional UI based on user settings
  - analytics module routing
related_issues: []
stale: false
---

## Problem

The aggregate targets analytics page had no place filter, so a user assigned to multiple facilities (multiple facility_ids) could not narrow the aggregated target metrics to a single facility. The filtering affordance simply did not exist for the multi-facility case.

## Root Cause

The analytics target-aggregates view was built without place filtering and did not account for users whose facility_id is an array. There was no mechanism to read multiple facilities from user settings or to surface a filter button/sidebar for them.

## Solution

Added a dedicated sidebar place filter (analytics-target-aggregates-sidebar-filter component) wired into the analytics-filter component and analytics routes. user-settings.service exposes the user's facility_id(s); the target-aggregates component shows the Filter button and sidebar only when the user has multiple facility_ids, and target-aggregates.service / analytics-modules.service compute aggregates scoped to the selected place. CSS (inbox.less, sidebar-filter.less, variables.less) styles the sidebar for desktop and mobile.

## Code Patterns

Gate UI affordances on user settings shape — render the filter button/sidebar only when facility_id resolves to multiple facilities (webapp/src/ts/modules/analytics/analytics-target-aggregates.component.ts). Reuse of the shared analytics-filter sidebar pattern (webapp/src/ts/components/filters/analytics-filter/analytics-filter.component.ts) for a new analytics sub-view.

## Design Choices

Filter button is hidden entirely for single-facility users so their experience is unchanged; only multi-facility users get the new control. The sidebar-filter pattern was reused for visual/interaction consistency with other analytics filters, and the change was validated against the legacy filter design (can_view_old_filter) so the older UI still renders correctly.

## Related Files

- webapp/src/ts/modules/analytics/analytics-target-aggregates.component.ts
- webapp/src/ts/modules/analytics/analytics-target-aggregates.component.html
- webapp/src/ts/modules/analytics/analytics-target-aggregates-sidebar-filter.component.ts
- webapp/src/ts/modules/analytics/analytics-target-aggregates-sidebar-filter.component.html
- webapp/src/ts/modules/analytics/analytics-target-aggregates-detail.component.html
- webapp/src/ts/components/filters/analytics-filter/analytics-filter.component.ts
- webapp/src/ts/components/filters/analytics-filter/analytics-filter.component.html
- webapp/src/ts/services/target-aggregates.service.ts
- webapp/src/ts/services/user-settings.service.ts
- webapp/src/ts/services/analytics-modules.service.ts
- webapp/src/ts/modules/analytics/analytics.routes.ts
- webapp/src/ts/modules/modules.module.ts
- webapp/src/css/inbox.less
- webapp/src/css/sidebar-filter.less
- webapp/src/css/variables.less

## Testing

Karma unit tests added/updated for the new and modified code: analytics-filter.component.spec.ts, analytics-target-aggregates-sidebar-filter-component.spec.ts, analytics-target-aggregates.component.spec.ts, analytics.component.spec.ts, target-aggregates.service.spec.ts, and user-settings.service.spec.ts. Reviewer (latin-panda) explicitly requested unit tests for the new code and verification of the view both with and without the feature, including the legacy design path (can_view_old_filter). Manual verification documented via screenshots/video for single-facility (no filter button) and multi-facility (filter button + sidebar) users on desktop and mobile.

## Related Issues

- #9231: enable place filter aggregate targets for users with multiple facility_ids (tracking issue from PR title)
- #137 (care-teams): direction/design for filtering aggregate targets
- #138 (care-teams): aggregate targets place filter
- #139 (care-teams): aggregate targets place filter

## Domain Rationale

**Fit:** strong

The PR adds place-based filtering to the aggregate targets analytics view; target aggregates and coverage analytics are squarely in the tasks-and-targets domain. Strong fit because it extends target functionality itself — the shared filter/sidebar components it reuses are just plumbing.
