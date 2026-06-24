---
id: cht-core-8838
category: bug
domain: tasks-and-targets
domainFit: strong
issueNumber: 8838
issueUrl: https://github.com/medic/cht-core/issues/8838
title: Fix Tasks component telemetry to record tasks:load on first load and tasks:refresh on subsequent visits
lastUpdated: '2026-06-23'
summary: The Tasks component was recording telemetry incorrectly, failing to distinguish a cold first load from a warm refresh. The fix records `tasks:load` on the initial load and `tasks:refresh` on subsequent visits to the Tasks tab.
services:
  - webapp
techStack:
  - typescript
  - angular
  - karma
tags:
  - telemetry
  - tasks
  - observability
  - bug-fix
  - performance-metrics
related_workflows:
  - observability
source_pr: medic/cht-core#8838
source_sha: bb058549d619b255ec71490324f875bd92f079b2
distilled_at: '2026-06-23'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - webapp/src/ts/modules/tasks/tasks.component.ts
concepts:
  - telemetry recording
  - component lifecycle (load vs refresh)
  - performance instrumentation
related_issues: []
stale: false
---

## Problem

The Tasks component emitted incorrect telemetry: it did not differentiate the first-time load of the Tasks tab from subsequent refreshes, so the recorded events did not accurately reflect cold-load versus warm-refresh performance, skewing the Tasks telemetry metrics.

## Root Cause

The component lacked state to track whether tasks had already been loaded, so its telemetry logic recorded the wrong/single event key regardless of load state instead of branching between an initial load and a refresh.

## Solution

Updated tasks.component.ts to track load state and record the `tasks:load` telemetry event on the first load and `tasks:refresh` on subsequent visits to the Tasks tab, and updated the Karma unit tests to assert the correct event keys (including fixing a failing test raised in review).

## Code Patterns

Track first-load vs refresh with a component-level flag and branch the telemetry key (tasks:load vs tasks:refresh) at the recording call site in webapp/src/ts/modules/tasks/tasks.component.ts; assert each key path in the corresponding *.component.spec.ts.

## Design Choices

Use two distinct telemetry keys so that cold-load and warm-refresh durations can be measured and analysed separately, rather than collapsing both into a single, ambiguous event.

## Related Files

- webapp/src/ts/modules/tasks/tasks.component.ts
- webapp/tests/karma/ts/modules/tasks/tasks.component.spec.ts

## Testing

Karma unit tests in webapp/tests/karma/ts/modules/tasks/tasks.component.spec.ts were added/modified to verify the correct telemetry key is recorded for first load versus refresh; a failing unit test flagged during review was fixed. The reviewer also requested manual test-evidence (a video) before merge.

## Related Issues

_none_

## Domain Rationale

**Fit:** strong

The change lives entirely in the Tasks component (tasks.component.ts) and corrects the telemetry emitted for the Tasks tab, which is squarely within tasks-and-targets. The observability concern is captured via relatedWorkflows rather than reclassifying to infrastructure, since this is in-application webapp code, not operational lifecycle.
