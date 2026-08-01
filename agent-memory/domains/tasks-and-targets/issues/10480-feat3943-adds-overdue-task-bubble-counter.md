---
id: cht-core-3943
category: feature
domain: tasks-and-targets
domainFit: strong
issueNumber: 3943
issueUrl: https://github.com/medic/cht-core/issues/3943
title: Add overdue task bubble counter to the navigation bar (counts Overdue + due Today tasks)
lastUpdated: '2026-08-01'
summary: The nav bar had unread counters for reports and messages but no equivalent indicator for tasks needing attention. This PR adds a bubble counter in the tasks nav item that shows the number of overdue and due-today tasks, generalising the existing unread-count flow to carry either count rather than duplicating it.
services:
  - webapp
techStack:
  - typescript
  - angular
  - ngrx
  - javascript
tags:
  - overdue-tasks
  - task-counter
  - nav-bar
  - bubble-counter
  - rules-engine
  - header
  - unread-count
related_workflows:
  - ui-extensions
source_pr: medic/cht-core#10480
source_sha: bed4546523931f90dc92c93bc6e55a1c3a3de495
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - webapp/src/ts/components/header/header.component.ts
  - webapp/src/ts/services/rules-engine.service.ts
  - shared-libs/rules-engine/src/index.js
  - webapp/src/ts/reducers/tasks.ts
  - webapp/src/ts/actions/tasks.ts
  - webapp/src/ts/selectors/index.ts
  - webapp/src/ts/modules/tasks/tasks.component.ts
concepts:
  - NgRx state management (actions/reducers/selectors)
  - rules engine task computation
  - navigation header tabs
  - UI badge/bubble counter
  - due-date filtering (overdue + today)
related_issues: []
stale: false
---

## Problem

Health workers had no at-a-glance indicator in the navigation bar of how many tasks required action. Reports and messages already showed unread-count bubbles, but the tasks nav item had no counter, so users could not see how many tasks were overdue or due today without opening the tasks list.

## Root Cause

Feature gap rather than a defect: the existing nav-bar bubble pattern only covered unread reports and messages. There was no mechanism in the rules engine or webapp state to compute and store a count of actionable (overdue + due-today) tasks for display in the header.

## Solution

Added a single `showTask(taskDoc)` predicate to the rules engine (shared-libs/rules-engine/src/index.js) returning `taskDoc.state === taskStates.states.Ready` — the rules engine does not compute the count. In rules-engine.service.ts the background freshness debounce was shortened from 120s to 1s (ENSURE_FRESHNESS_MILLIS) and now calls fetchOverdueTasksForAllContacts(), which pulls all task docs and dispatches setTasksList with their emissions; it also registers a changes watcher (monitorTaskChanges) filtered by `change.doc.type === 'task' && this.rulesEngineCore.showTask(change.doc)` that dispatches setOverdueTasks with the hydrated task docs. hydrateTaskDocs sets `emission.overdue = dueDate.isBefore(moment())`; reducers/tasks.ts keeps an `overdue` array of those emissions; and the count is derived in the selector, `Selectors.getBubbleCounter` returning `task: taskState.overdue?.length || 0`. The header component reads the selected count and renders a bubble next to the tasks tab, reusing the existing unread-count bubble pattern. Tasks due after today are intentionally excluded from the count; a task due later today still counts.

## Code Patterns

The PR generalises the existing unread-count flow rather than mirroring it: Actions.setUnreadCount/updateUnreadCount became setBubbleCounter/updateBubbleCounter, GlobalState.unreadCount became bubbleCounter, Selectors.getUnreadCount became getBubbleCounter, and HeaderComponent.unreadCount became bubbleCount. The header renders one generic badge keyed by `bubbleCount[tab.typeName]`, so a new nav-bar counter is added by (a) giving the tab a `typeName` in header-tabs.service.ts (here `typeName: 'task'`) and (b) making getBubbleCounter supply that key's value. Reports and messages still push their counts in from a service (UnreadRecordsService -> GlobalActions.setBubbleCounter in app.component.ts), but nothing dispatches a *task* count: the task actions (setTasksList with emissions, setOverdueTasks with hydrated task docs) carry tasks, the reducer stores the filtered `overdue` array, and getBubbleCounter derives `task: taskState.overdue?.length || 0`.

## Design Choices

The bubble counts only 'Overdue' and due 'Today' tasks (not tasks due tomorrow or later), per the UX requirement in issue #3943 that the indicator should tell the user what needs doing today regardless of whether items are late or on-time. The existing unread-counter bubble UI was reused for visual consistency with the reports and messages counters.

## Related Files

- shared-libs/rules-engine/src/index.js
- shared-libs/rules-engine/test/integration.spec.js
- webapp/src/ts/components/header/header.component.ts
- webapp/src/ts/components/header/header.component.html
- webapp/src/ts/services/rules-engine.service.ts
- webapp/src/ts/services/header-tabs.service.ts
- webapp/src/ts/reducers/tasks.ts
- webapp/src/ts/actions/tasks.ts
- webapp/src/ts/reducers/global.ts
- webapp/src/ts/actions/global.ts
- webapp/src/ts/selectors/index.ts
- webapp/src/ts/modules/tasks/tasks.component.ts
- webapp/src/ts/effects/reports.effects.ts
- webapp/src/ts/app.component.ts
- tests/e2e/default/tasks/overdue-bubble.wdio-spec.js

## Testing

Added Karma unit tests covering the header component, tasks component, tasks and global reducers, selectors, rules-engine.service, header-tabs.service, reports.effects, and app.component. Added an integration test in shared-libs/rules-engine/test/integration.spec.js (+37 lines) for the `showTask` predicate the counter relies on; the count itself is computed in the webapp. Added WDIO e2e coverage (tests/e2e/default/tasks/overdue-bubble.wdio-spec.js) with dedicated configs for overdue tasks (overdue-bubble-config.js) and the no-overdue case (no-overdue-tasks-config.js), plus the pre-existing targets analytics e2e spec and configs, which were not added or edited but moved unchanged (three 100% renames) from tests/e2e/default/analytics/ to tests/e2e/default/targets/, with the now-dead `./analytics/**/*.wdio-spec.js` glob dropped from tests/e2e/default/suites.js to follow.

## Related Issues

- #3943: Add an overdue tasks counter bubble in the nav bar, like the unread counters for reports and messages, limited to Overdue and due-Today tasks

## Domain Rationale

**Fit:** strong

The PR's primary subject is tasks — computing and surfacing the count of overdue and due-today tasks. Even though it touches the nav-bar header UI and the rules engine, the feature is fundamentally about exposing task state, which squarely belongs to tasks-and-targets.
