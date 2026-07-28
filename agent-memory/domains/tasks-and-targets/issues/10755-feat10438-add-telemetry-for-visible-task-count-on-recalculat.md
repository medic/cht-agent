---
id: cht-core-10438
category: feature
domain: tasks-and-targets
domainFit: strong
issueNumber: 10438
issueUrl: https://github.com/medic/cht-core/issues/10438
title: Add `tasks:all-tasks` telemetry recorded on every task recalculation in TasksComponent
lastUpdated: '2026-06-22'
summary: There was no client-side way to know how many tasks a user can see without expensive server-side analysis of all user tasks and their statuses. This adds a `tasks:all-tasks` telemetry entry recorded in refreshTasks(), capturing the count on initial load and every recalculation.
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
  - monitoring
  - instrumentation
related_workflows:
  - observability
source_pr: medic/cht-core#10755
source_sha: 4048e3cea6b71ac4551cdda9cd63e83eaa5f1679
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - webapp/src/ts/modules/tasks/tasks.component.ts
  - TasksComponent
  - TelemetryService
concepts:
  - telemetry
  - observability
  - client-side instrumentation
  - metric recording
related_issues: []
stale: false
---

## Problem

Operators had no way to know how many tasks were visible to a user at a given time except by analyzing data on the server — querying all of a user's tasks, checking their statuses, and filtering to those visible in a given interval. This made diagnosing bloated or misconfigured task workflows difficult.

## Root Cause

TasksComponent.refreshTasks() recalculated and rendered the visible task list (tasksWithLineage) but did not emit any metric for the visible count, so the value existed only transiently on the client and was never captured for analysis.

## Solution

Injected TelemetryService into TasksComponent and added a telemetryService.record('tasks:all-tasks', tasksWithLineage.length) call after tasks are recalculated in refreshTasks(), so the visible count is recorded on initial load and on every subsequent recalculation triggered by data changes or rules engine updates.

## Code Patterns

Instrument a component metric by injecting TelemetryService and calling telemetryService.record('<namespaced:key>', value) at the single point where the value is computed (here, after tasksWithLineage is built in refreshTasks() in webapp/src/ts/modules/tasks/tasks.component.ts). Use a colon-namespaced key (tasks:all-tasks) consistent with existing telemetry conventions.

## Design Choices

Recording inside refreshTasks() rather than at a single load path was chosen deliberately because that method is the common funnel for both initial load and all recalculations (change feed and rules engine updates), so a single instrumentation point captures every state where the visible count changes. The count is taken from tasksWithLineage.length, the already-computed client-side list, avoiding any additional server query.

## Related Files

- webapp/src/ts/modules/tasks/tasks.component.ts
- webapp/tests/karma/ts/modules/tasks/tasks.component.spec.ts

## Testing

Added a Karma unit test in tasks.component.spec.ts asserting that TelemetryService.record is called with the key 'tasks:all-tasks' and the correct visible task count after recalculation.

## Related Issues

- #10438: feature request to add a telemetry entry storing how many tasks a user sees, to diagnose bloated/misconfigured workflows without server-side analysis

## Domain Rationale

**Fit:** strong

The change instruments the tasks feature specifically — counting how many tasks are visible to a user — and lives entirely in the tasks module (tasks.component.ts). Observability is the cross-domain workstream (relatedWorkflows), but the functional subject being measured is squarely tasks-and-targets.
