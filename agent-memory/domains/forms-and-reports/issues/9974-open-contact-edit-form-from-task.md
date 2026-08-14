---
id: cht-core-9974
category: feature
domain: forms-and-reports
subDomain: tasks-forms-integration
issueNumber: 9974
issueUrl: https://github.com/medic/cht-core/issues/9974
title: Support opening a contact edit form from a task by routing on an edit_id in the action content
lastUpdated: '2026-08-13'
summary: Task actions of type "contact" could only route to contact creation. This adds an `edit_id` branch so a task whose config sets `content.edit_id` navigates to that contact's edit route, letting follow-up workflows update existing contact data directly from a task.
services:
  - webapp
techStack:
  - typescript
  - angular
source_prs:
  - "medic/cht-core#9975"
related_issues:
  - cht-core-9601
---

## Problem

Tasks could trigger creation of new contacts by type but could not open an edit form for an existing contact. Follow-up workflows that needed to update patient information (e.g. after a visit) required the user to manually navigate to the contact, find the edit option, and fill out the form separately from the task.

## Root Cause

The `action.type === 'contact'` branch in the task action handler already existed, but every path through it routed to contact *creation* — `/contacts/:parent_id/add/:type` when the action content carried a `parent_id`, otherwise `/contacts/add/:type`. There was no branch that routed to an existing contact's edit form.

## Solution

Added an `edit_id` branch to the existing `type === 'contact'` handling: when a task action's `content` carries `edit_id`, the handler navigates to `/contacts/<edit_id>/edit`, which loads the existing contact into the standard contact edit form. Config authors populate `edit_id` from their task's `modifyContent(content, { contact })` callback. The creation branches were also tightened to require `content.type`, and a final fallback navigates to `/contacts/<content.contact._id>` (the contact's profile page) when neither `type` nor `edit_id` is present. PR #9975 implemented this with minimal changes to 4 files.

## Code Patterns

- Task actions use a `type` field to determine what happens when the user clicks the action button; within `type: 'contact'`, the *shape of `content`* selects the destination route (`parent_id` + `type` → add under a parent, `type` → add, `edit_id` → edit, otherwise → the contact's profile)
- `content` is shaped by the partner-authored `modifyContent(content, { contact })` callback in the project's `tasks.js` — it is task configuration, not cht-core code. For a contact edit action it sets `content.edit_id = contact._id`; only that id is threaded through, not the contact document
- Pattern: extend task action behaviour by adding a branch in the existing handler rather than creating parallel code paths
- File: `webapp/src/ts/modules/tasks/tasks-content.component.ts` (`performAction`) handles action-type routing

## Design Choices

- Reused the existing contact edit route and form infrastructure rather than creating a task-specific edit flow
- Passed only the contact `_id` through the action content and let the edit route load the document, so no contact data is duplicated into the task
- Preferred over the workaround described in the issue — an intermediary app form with a `dynamic-url` anchor to `contacts/<id>/edit` — which was hard to train, cluttered the reports list with intermediary submissions, and lost the use of `modifyContent`

## Related Files

- webapp/src/ts/modules/tasks/tasks-content.component.ts
- webapp/tests/karma/ts/modules/tasks/tasks-content.component.spec.ts
- tests/e2e/default/tasks/config/tasks-contact-config.js
- tests/e2e/default/tasks/tasks.wdio-spec.js

## Testing

- Karma unit tests in `tasks-content.component.spec.ts` asserting the route each `content` shape produces, including the `edit_id` → `/contacts/<id>/edit` case
- E2E coverage in `tasks.wdio-spec.js` driven by a new `tasks-contact-config.js` fixture containing both an add-household-member task and an edit-person task whose `modifyContent` sets `edit_id`

## Related Issues

- #9601: Prevent duplicate sibling contact capture (related contact form work)
