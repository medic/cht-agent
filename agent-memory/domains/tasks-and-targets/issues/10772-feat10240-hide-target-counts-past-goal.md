---
id: cht-core-10240
category: feature
domain: tasks-and-targets
domainFit: strong
issueNumber: 10240
issueUrl: https://github.com/medic/cht-core/issues/10240
title: 'Hide target count past goal: show the goal as the big number when count reaches/exceeds goal, and fix count/goal-label layout overlap'
lastUpdated: '2026-06-22'
summary: Large target counts (e.g. currency figures) overlapped the 'Goal X' label once the count exceeded the goal, making the analytics targets tiles unreadable. Fixed by centering the goal/count in a stacked flex layout and adding an opt-in target field that displays the goal as the big number once the count reaches or exceeds it.
services:
  - webapp
techStack:
  - typescript
  - angular
  - less
  - javascript
tags:
  - targets
  - analytics
  - target-count
  - goal
  - ui-layout
  - rules-engine
related_workflows:
  - ui-extensions
source_pr: medic/cht-core#10772
source_sha: d406c6343b7b5cd6b232581b1910a2e2b3e6d9c3
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - shared-libs/rules-engine/src/target-state.js
  - webapp/src/ts/modules/analytics/analytics-targets.component.ts
  - webapp/src/ts/modules/analytics/analytics-targets.component.html
  - webapp/src/css/targets.less
concepts:
  - target state computation
  - rules-engine target display
  - flex column layout
  - opt-in target field with backward-compatible default
  - analytics targets/aggregates view
related_issues: []
stale: false
---

## Problem

When target counts are very large (e.g. tracking currency), once a target's count exceeded its goal, the count number overlapped the absolutely-positioned 'Goal X' label in the analytics targets tiles (and the target aggregates page), rendering the text unintelligible.

## Root Cause

The goal label was absolutely positioned over the target tile, so a large count number rendered on top of / colliding with it. There was also no mechanism to suppress or substitute the count once it surpassed the goal.

## Solution

Replaced the absolute-positioned goal label with a centered stacked flex column layout (`.count` becomes display:flex/flex-direction:column/align-items:center) so the goal label sits above the count, both centered. Added a per-target opt-in field that, when set, makes the UI show the goal value as the big number (goal shown as the small label) once pass >= goal; targets lacking the field or with it false keep the existing always-show-count behavior. Display logic added in shared-libs/rules-engine/src/target-state.js and consumed by the analytics-targets component.

## Code Patterns

Stacked-centering via flex column in webapp/src/css/targets.less (`.count { display: flex; flex-direction: column; align-items: center }`) to avoid overlap from absolute positioning; opt-in target-object field with backward-compatible default (absent/false => prior behavior) computed in shared-libs/rules-engine/src/target-state.js and read in webapp/src/ts/modules/analytics/analytics-targets.component.ts.

## Design Choices

Chose the centered stacked flex layout over right-padding the count number, because padding leaves the number off true center and relies on a fragile magic number that can't guarantee no overlap for arbitrarily large values. Implemented as a per-target opt-in field (default preserves existing behavior) rather than a global permission/feature flag — the original `can_hide_target_count_past_goal` permission approach was superseded. Decided to substitute the goal as the big number rather than hiding the count entirely, since an empty count looked like missing data or an unmet goal.

## Related Files

- shared-libs/rules-engine/src/target-state.js
- webapp/src/ts/modules/analytics/analytics-targets.component.ts
- webapp/src/ts/modules/analytics/analytics-targets.component.html
- webapp/src/css/targets.less
- webapp/tests/karma/ts/modules/analytics/analytics-targets.component.spec.ts
- tests/e2e/default/targets/analytics.wdio-spec.js
- tests/e2e/default/targets/config/targets-limit-count-config.js
- package-lock.json

## Testing

Updated Karma unit tests for the analytics-targets component (webapp/tests/karma/ts/modules/analytics/analytics-targets.component.spec.ts) and added a WebdriverIO e2e spec (tests/e2e/default/targets/analytics.wdio-spec.js) backed by a dedicated target config (tests/e2e/default/targets/config/targets-limit-count-config.js) to exercise the limit-count-past-goal behavior.

## Related Issues

- #10240: Large target counts overlap the goal label once the count exceeds the goal (also affects the target aggregates page); request to limit the display to the goal when reached/exceeded

## Domain Rationale

**Fit:** strong

The PR changes how target counts and goals are rendered in the analytics targets view and adds a per-target field controlling display once the count passes the goal — both are core tasks-and-targets concerns (target display and the rules-engine target-state). The added field is a target-object property, not an app-settings/rules-engine config change, so it does not fall under configuration.
