---
id: cht-core-9231
category: feature
domain: tasks-and-targets
domainFit: strong
issueNumber: 9231
issueUrl: https://github.com/medic/cht-core/issues/9231
title: Add selected-facility indicator to aggregate targets list/details and restore report sidebar filter colors
lastUpdated: '2026-06-23'
summary: The aggregate targets list and details gave no indication of which facility was selected, and the report sidebar filter colors had regressed from the 4.9 styling. This PR adds a facility indicator to the aggregate targets views and restores the sidebar filter colors.
services:
  - webapp
techStack:
  - typescript
  - angular
  - less
  - karma
  - webdriverio
tags:
  - target-aggregates
  - facility-indicator
  - analytics
  - sidebar-filter
  - ui
  - css-theming
related_workflows:
  - ui-extensions
source_pr: medic/cht-core#9282
source_sha: 0f0e0741cf8027893be4fae6c78fede43294b0bc
distilled_at: '2026-06-23'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - webapp/src/ts/modules/analytics/analytics-target-aggregates.component.ts
  - webapp/src/ts/modules/analytics/analytics-target-aggregates-sidebar-filter.component.ts
  - webapp/src/ts/services/target-aggregates.service.ts
  - webapp/src/ts/services/user-settings.service.ts
  - webapp/src/ts/components/filters/analytics-filter/analytics-filter.component.ts
  - webapp/src/css/sidebar-filter.less
concepts:
  - target aggregates
  - analytics module
  - facility/place hierarchy context
  - user settings facility association
  - sidebar filter UI
  - LESS variable-based color theming
  - Angular component/service composition
related_issues: []
stale: false
---

## Problem

Users viewing aggregate targets had no visual indication of which facility was currently selected in the list or details view, making the displayed data ambiguous when navigating the place hierarchy. Separately, the report's sidebar filter rendered with incorrect colors that no longer matched the intended 4.9 branch styling.

## Root Cause

The aggregate targets list and detail components rendered target data without surfacing the selected facility (no facility name/indicator was wired through from user/place settings). The sidebar filter CSS had drifted from the 4.9 LESS color variables/styles, producing the wrong colors.

## Solution

Added a facility indicator to the aggregate targets list and details by resolving the selected facility (via user-settings.service / target-aggregates.service) and rendering it in the component templates. Updated the analytics target-aggregates and sidebar-filter components plus the analytics-filter component to pass facility context through. Restored the report sidebar filter colors by aligning sidebar-filter.less, targets.less, inbox.less, and variables.less with the 4.9 styling. Per review feedback, added an explicit return type to the aggregate targets service method so callers know the returned shape.

## Code Patterns

Resolve the user's selected place from user-settings.service.ts and thread it into analytics views (analytics-target-aggregates.component.ts / target-aggregates.service.ts) to display contextual facility info. Centralize filter/target colors as LESS variables in webapp/src/css/variables.less and consume them from sidebar-filter.less, targets.less, and inbox.less for consistent theming.

## Design Choices

Reviewer (jkuester) requested an explicit return type for the aggregate targets method (e.g. a typed array rather than implicit any) so callers can tell whether they receive an object, array, or null — improving type safety over leaving the shape untyped.

## Related Files

- webapp/src/ts/modules/analytics/analytics-target-aggregates.component.ts
- webapp/src/ts/modules/analytics/analytics-target-aggregates.component.html
- webapp/src/ts/modules/analytics/analytics-target-aggregates-detail.component.html
- webapp/src/ts/modules/analytics/analytics-target-aggregates-sidebar-filter.component.ts
- webapp/src/ts/modules/analytics/analytics-target-aggregates-sidebar-filter.component.html
- webapp/src/ts/components/filters/analytics-filter/analytics-filter.component.ts
- webapp/src/ts/services/target-aggregates.service.ts
- webapp/src/ts/services/user-settings.service.ts
- webapp/src/ts/services/rules-engine.service.ts
- webapp/src/css/sidebar-filter.less
- webapp/src/css/targets.less
- webapp/src/css/inbox.less
- webapp/src/css/variables.less
- tests/page-objects/default/targets/target-aggregates.wdio.page.js
- webapp/tests/karma/ts/modules/analytics/analytics-target-aggregates.component.spec.ts
- webapp/tests/karma/ts/modules/analytics/analytics-target-aggregates-sidebar-filter-component.spec.ts
- webapp/tests/karma/ts/components/filters/analytics-filter.component.spec.ts
- webapp/tests/karma/ts/services/user-settings.service.spec.ts

## Testing

Updated Karma unit specs for the affected components and services (analytics-target-aggregates, analytics-target-aggregates-sidebar-filter, analytics-filter, user-settings.service) and updated the WebdriverIO target-aggregates page object to support e2e coverage of the facility indicator.

## Related Issues

- #9231: Add facility indicator in aggregate targets
- medic/care-teams#144: Care-teams tracking issue for facility indicator in aggregate targets

## Domain Rationale

**Fit:** strong

The PR enhances the aggregate targets feature (analytics target-aggregates module), which is canonically part of the tasks-and-targets domain; the secondary sidebar-filter color fix is just supporting UI styling for the same views.
