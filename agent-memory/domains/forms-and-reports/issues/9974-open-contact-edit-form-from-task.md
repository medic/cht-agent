---
id: cht-core-9974
category: feature
domain: forms-and-reports
subDomain: tasks-forms-integration
issueNumber: 9974
issueUrl: https://github.com/medic/cht-core/issues/9974
title: Support opening contact edit form from task
lastUpdated: 2025-06-13
summary: Enabled tasks to open a contact edit form by setting the action type to "contact", allowing follow-up workflows to update existing contact data directly from task actions.
services:
  - webapp
techStack:
  - typescript
  - angular
---

## Problem

Tasks could trigger creation of new contacts but could not open an edit form for an existing contact. Follow-up workflows that needed to update patient information (e.g. after a visit) required the user to manually navigate to the contact, find the edit option, and fill out the form separately from the task.

## Root Cause

The task action handler only supported opening app forms. There was no code path for action type "contact" that would load the existing contact's data into a contact edit form.

## Solution

Added support for action type "contact" in the task resolution flow. When a task action has `type: "contact"`, the system loads the linked contact's full data and opens the appropriate contact edit form with the contact's current values pre-populated. PR #9975 implemented this with minimal changes to 4 files.

## Code Patterns

- Task actions use a `type` field to determine what happens when the user clicks the action button
- For contact edit actions, the contact's existing data is unpacked into the form's `content` variable via `modifyContent`
- Pattern: extend task action types by adding a new case in the action handler rather than creating parallel code paths
- File: `webapp/src/ts/services/form.service.ts` handles action type routing

## Design Choices

- Reused the existing contact edit form infrastructure rather than creating a task-specific edit flow
- The contact's full contents are loaded and made available so the form has complete context

## Related Files

- webapp/src/ts/services/form.service.ts
- webapp/src/ts/modules/tasks/

## Testing

- Unit tests verifying that contact edit forms are opened correctly from task actions
- E2E tests for the full task-to-contact-edit workflow

## Related Issues

- #9601: Prevent duplicate sibling contact capture (related contact form work)
