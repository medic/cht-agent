---
id: cht-core-10577
category: feature
domain: tasks-and-targets
domainFit: strong
issueNumber: 10577
issueUrl: https://github.com/medic/cht-core/issues/10577
title: Add task list filtering by due date, task type, and area; centralize lineage filtering in the message pipe
lastUpdated: '2026-06-22'
summary: CHWs struggled to find specific follow-up tasks while scrolling long task lists. This PR adds a sidebar filter to the tasks module — a due-date radio (overdue/due-today vs future), task-type checkboxes, and an area filter reused from Reports — and refactors duplicated per-component lineage filtering into the shared message pipe backed by the ngrx store of user facilities.
services:
  - webapp
  - api
techStack:
  - typescript
  - angular
  - ngrx
  - less
  - webdriverio
tags:
  - task-filtering
  - sidebar-filter
  - due-date-filter
  - task-type-filter
  - area-filter
  - lineage
  - component-reuse
  - i18n
related_workflows:
  - ui-extensions
source_pr: medic/cht-core#10623
source_sha: 2e64efc9e885c96e2164ef8763b37fda8f1c0a0a
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - webapp/src/ts/modules/tasks/tasks-sidebar-filter.component.ts
  - webapp/src/ts/components/filters/overdue-filter/overdue-filter.component.ts
  - webapp/src/ts/components/filters/task-type-filter/task-type-filter.component.ts
  - webapp/src/ts/pipes/message.pipe.ts
  - webapp/src/ts/services/user-contact.service.ts
  - webapp/src/ts/reducers/tasks.ts
  - webapp/src/ts/modules/tasks/tasks.component.ts
concepts:
  - sidebar filters
  - ngrx store state management
  - lineage filtering
  - component reuse
  - Angular pipe transformation
  - filter selectors and reducers
related_issues: []
stale: false
---

## Problem

When CHWs provide community services they face difficulty navigating the CHT app's task list; with numerous tasks listed it is hard to scroll through and identify specific follow-up tasks for each use case. The task list had no filtering capability. Separately, lineage filtering logic was duplicated across every component that renders items with lineage.

## Root Cause

The tasks module exposed no filter UI, forcing users to scroll the entire task list. Additionally, lineage-display filtering was implemented redundantly in each component (tasks, reports, messages) rather than in one shared location — a repeated code pattern.

## Solution

Added three filters to the tasks module via a tasks-sidebar-filter component, modeled on the existing Reports filters: a due-date radio (overdue/due-today vs future), task-type checkboxes generated from the available task types, and an area filter identical to the Reports area filter that filters by task owner lineage. Wired filtering through new/updated tasks reducer, global reducer, selectors and actions. Refactored lineage filtering out of individual components into the message pipe itself, sourcing user facilities from the store. Added translation keys across all locales (ar, en, es, fr, ne, pt, sw).

## Code Patterns

Reuse of the Reports filter components (overdue-filter, task-type-filter, area filter) for the tasks domain via a shared sidebar-filter component (webapp/src/ts/modules/tasks/tasks-sidebar-filter.component.ts). Centralizing cross-component transformation in an Angular pipe (webapp/src/ts/pipes/message.pipe.ts) that reads user facilities from the ngrx store instead of each consuming component (reports.component.ts, messages.component.ts) duplicating the filtering.

## Design Choices

Reused existing Reports filter components rather than building task-specific filters from scratch, keeping UI and behavior consistent. The area filter was deliberately kept lazy-loaded — during review the human reverted an AI change that had switched it to eager loading (to count places), preserving performance. Lineage filtering was moved into the pipe (DRY) so the store of user facilities is the single source rather than per-component logic.

## Related Files

- webapp/src/ts/modules/tasks/tasks-sidebar-filter.component.ts
- webapp/src/ts/modules/tasks/tasks-sidebar-filter.component.html
- webapp/src/ts/components/filters/overdue-filter/overdue-filter.component.ts
- webapp/src/ts/components/filters/task-type-filter/task-type-filter.component.ts
- webapp/src/ts/pipes/message.pipe.ts
- webapp/src/ts/services/user-contact.service.ts
- webapp/src/ts/reducers/tasks.ts
- webapp/src/ts/reducers/global.ts
- webapp/src/ts/selectors/index.ts
- webapp/src/ts/modules/tasks/tasks.component.ts
- api/resources/translations/messages-en.properties
- tests/e2e/default/tasks/sidebar-filter.wdio-spec.js

## Testing

Added/updated Karma+Jasmine unit tests for the new and changed code: overdue-filter, task-type-filter, tasks-sidebar-filter, tasks component, reducers (tasks, global), selectors, message pipe, user-contact service, and the reports/messages components affected by the lineage refactor. Added a WebdriverIO e2e spec (tests/e2e/default/tasks/sidebar-filter.wdio-spec.js) with supporting task config and page-object updates. Manually verified behavior across multiple user account types.

## Related Issues

- #10577: Feature request from the community forum to add a filter option to the task list so CHWs can more efficiently identify specific follow-up tasks

## Domain Rationale

**Fit:** strong

The PR's core feature is adding filters (due date, task type, area) to the task list in the tasks module to help CHWs navigate large task lists — squarely tasks-and-targets. The cross-cutting lineage-pipe refactor and translation additions are supporting changes, not the primary intent.
