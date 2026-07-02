---
id: cht-core-9255
category: feature
domain: tasks-and-targets
domainFit: strong
issueNumber: 9255
issueUrl: https://github.com/medic/cht-core/issues/9255
title: 'Add in-app task notifications to remind users of pending tasks (feat #9255)'
lastUpdated: '2026-06-22'
summary: Users could only learn about pending tasks by opening the app's Tasks tab, so critical updates were missed. This PR adds a task-notifications service that surfaces notifications for pending tasks (ordered by due date and priority), wired into the rules engine and task state, with localized notification text and a default app_settings toggle.
services:
  - webapp
  - api
techStack:
  - typescript
  - angular
  - javascript
  - ngrx
tags:
  - task-notifications
  - notifications
  - tasks
  - rules-engine
  - due-date-priority-ordering
related_workflows:
  - task-scheduling
source_pr: medic/cht-core#10362
source_sha: 8d8d1ea66068a58cfed3330b2c4e03dc284052d9
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - webapp/src/ts/services/task-notifications.service.ts
  - webapp/src/ts/reducers/tasks.ts
  - webapp/src/ts/services/rules-engine.service.ts
  - shared-libs/task-utils/src/task-utils.js
  - webapp/src/ts/app.component.ts
concepts:
  - device/local notifications
  - task lifecycle surfacing
  - rules engine task computation
  - NgRx task state
  - ordering tasks by due date and priority
  - internationalization of user-facing text
  - feature configuration via app_settings
related_issues: []
stale: false
---

## Problem

Users frequently missed critical app updates such as pending tasks because the app had no proactive reminder mechanism — they had to open the Tasks tab to discover outstanding work. There was no service to alert users about pending tasks outside the app's task list.

## Root Cause

Feature gap rather than a defect: the webapp had no notification subsystem listening to task updates. Tasks produced by the rules engine and held in the tasks reducer were only rendered in-tab, with no path to push a user-facing notification about pending/upcoming tasks.

## Solution

Introduced a new webapp task-notifications.service.ts that integrates with the rules-engine.service and the tasks reducer to detect pending tasks and raise notifications for the user. Added an order-by-due-date-and-priority utility in shared-libs/task-utils so the most urgent tasks surface first, wired the service into app.component.ts, added localized notification strings across all supported language properties files, and added a default app_settings.json entry to configure/enable the feature.

## Code Patterns

A dedicated Angular service (webapp/src/ts/services/task-notifications.service.ts) that reacts to rules-engine output / NgRx task state changes to emit user notifications; reusable task ordering via shared-libs/task-utils/src/task-utils.js order-by-due-date-and-priority for prioritizing what to surface.

## Design Choices

Implemented as a dedicated client-side webapp service (consuming rules-engine and task state) rather than a server-side push pipeline; tasks are ordered by due date and then priority so the most urgent items are surfaced; the feature is driven by a default app_settings.json entry (configurable) and all notification text is internationalized across the supported locales.

## Related Files

- webapp/src/ts/services/task-notifications.service.ts
- webapp/src/ts/reducers/tasks.ts
- webapp/src/ts/services/rules-engine.service.ts
- webapp/src/ts/app.component.ts
- shared-libs/task-utils/src/task-utils.js
- config/default/app_settings.json
- api/resources/translations/messages-en.properties
- eslint.config.js

## Testing

Unit tests added/updated: webapp/tests/karma/ts/services/task-notification.service.spec.ts (new service), rules-engine.service.spec.ts and app.component.spec.ts (integration of the service), and shared-libs/task-utils/test/order-by-due-date-and-priority.js for the ordering utility. Review notes indicate additional Sonar cleanup and unit tests were requested and addressed before merge.

## Related Issues

- #9255: feature request for app notifications to remind/inform users of activity such as pending tasks and incoming messages without opening the app

## Domain Rationale

**Fit:** strong

The PR adds local/device notifications for pending tasks; the implementation centers on the task pipeline (new task-notifications service, tasks reducer, rules-engine integration, ordering by due date and priority). This is in-app notification of task state, not SMS communication (the messaging domain), so tasks-and-targets is the squarely correct domain.
