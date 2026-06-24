---
id: cht-core-9974
category: feature
domain: tasks-and-targets
domainFit: strong
issueNumber: 9974
issueUrl: https://github.com/medic/cht-core/issues/9974
title: Support opening a contact edit form from a task action
lastUpdated: '2026-06-22'
summary: CHT tasks could create a new contact via a task action but not edit an existing one; this adds support for opening a contact's edit form directly from a task action, streamlining patient follow-up.
services:
  - webapp
techStack:
  - typescript
  - angular
  - webdriverio
tags:
  - tasks
  - task-actions
  - contact-edit
  - contact-forms
  - navigation
related_workflows:
  - contact-creation
  - form-submission
source_pr: medic/cht-core#9975
source_sha: 32e2288d3f6eb80779b31d2a6f97a04a41f84c0f
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - webapp/src/ts/modules/tasks/tasks-content.component.ts
  - webapp/src/ts/modules/tasks
concepts:
  - task action routing
  - contact edit forms
  - Angular navigation/routing
  - Enketo form launching
related_issues: []
stale: false
---

## Problem

Tasks supported creating a new contact based on type, but offered no way to edit an existing contact directly from a task entry. Users doing follow-up had to leave the task and manually locate the contact to update its information.

## Root Cause

The task-action handling in webapp/src/ts/modules/tasks/tasks-content.component.ts only built navigation for creating a new contact (parent_id + contact type) and had no branch for editing an existing contact referenced by the action's content. Additionally, a contact action with a parent_id but no content type produced a poor/broken experience.

## Solution

Extended tasks-content.component.ts to route contact-type task actions to the appropriate contact edit form when the action targets an existing contact, building on the existing create-contact-from-task mechanism. Added a guard (action.content?.type) so an action lacking a content type sends the user to the contact profile page instead of a broken create/edit flow.

## Code Patterns

In tasks-content.component.ts, branch contact action routing on whether the action targets an existing contact (edit) vs. creating a new one (parent_id + content.type), and guard the create/parent_id path with `action.content?.type`; otherwise fall back to the contact profile page.

## Design Choices

Reused the existing task-action contact-form mechanism rather than introducing a new action type. Per reviewer feedback, chose to redirect to the contact profile page (rather than open a create/edit form) when a contact action has no content type, avoiding a confusing experience.

## Related Files

- webapp/src/ts/modules/tasks/tasks-content.component.ts
- webapp/tests/karma/ts/modules/tasks/tasks-content.component.spec.ts
- tests/e2e/default/tasks/tasks.wdio-spec.js
- tests/e2e/default/tasks/config/tasks-contact-config.js

## Testing

Added an e2e test in tests/e2e/default/tasks/tasks.wdio-spec.js (with supporting config in tests/e2e/default/tasks/config/tasks-contact-config.js) exercising the edit-contact-from-task flow, and added/updated karma unit tests in webapp/tests/karma/ts/modules/tasks/tasks-content.component.spec.ts covering the new routing branches including the no-content-type guard.

## Related Issues

- #9974: Enable editing an existing contact directly from a task

## Domain Rationale

**Fit:** strong

The change lives entirely in the tasks module (tasks-content.component.ts and the tasks e2e/unit suites) and extends task action handling — i.e. what a task can do — so tasks-and-targets is the most specific fit even though the end result opens a contact form.
