---
id: cht-core-8745
category: bug
domain: forms-and-reports
domainFit: strong
issueNumber: 8745
issueUrl: https://github.com/medic/cht-core/issues/8745
title: Skip form context expression evaluation when a form is opened from a task
lastUpdated: '2026-06-23'
summary: Opening a form from a task caused the Enketo service to unnecessarily evaluate the form's context expression, risking errors or incorrect behavior. The fix skips context evaluation in the task-opening flow and adds unit + e2e regression coverage.
services:
  - webapp
techStack:
  - typescript
  - angular
  - enketo
  - wdio
tags:
  - form-context
  - enketo
  - tasks
  - form-loading
  - context-evaluation
  - backport
related_workflows:
  - form-submission
source_pr: medic/cht-core#8748
source_sha: 2b5cd23dd889cb8da7dbd512e8f96c2213f0e06b
distilled_at: '2026-06-23'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - webapp/src/ts/services/enketo.service.ts
  - EnketoService
concepts:
  - form context expression evaluation
  - Enketo form rendering
  - task-driven form opening
  - form properties (context)
related_issues: []
stale: false
---

## Problem

When users opened a form by tapping a task, the webapp evaluated the form's `context` expression — the same expression normally used to decide whether a form should appear in a contact's form list. Evaluating this context during the task-opening flow was unnecessary and could lead to errors or incorrect form behavior, since the task itself already determines which form and contact are involved.

## Root Cause

The Enketo service's form-loading code path evaluated the form's context expression unconditionally, without distinguishing forms opened from a task (where the form/contact are already fixed) from forms opened via a contact's form list (where context decides visibility). See webapp/src/ts/services/enketo.service.ts.

## Solution

Updated enketo.service.ts so that the form context expression is not evaluated when the form is opened from a task. Added Karma unit tests and WebdriverIO e2e regression tests, including a context expression on the home-visit task test form to exercise the scenario.

## Code Patterns

Gate side-effectful/expensive form-context evaluation on the form's entry point (task vs. contact form list) inside EnketoService rather than always evaluating it — webapp/src/ts/services/enketo.service.ts.

## Design Choices

The fix bypasses context evaluation only in the task-opening path instead of altering the meaning of form context or task definitions, because a task already pins the target form and contact, making context re-evaluation redundant; this is the smallest, lowest-risk change and is suitable for backport to the 4.4.x release line.

## Related Files

- webapp/src/ts/services/enketo.service.ts
- webapp/tests/karma/ts/services/enketo.service.spec.ts
- tests/e2e/default/tasks/forms/home-visit.properties.json
- tests/e2e/default/tasks/tasks-breadcrumbs.wdio-spec.js
- tests/e2e/default/tasks/tasks.wdio-spec.js

## Testing

Added/updated Karma unit tests in webapp/tests/karma/ts/services/enketo.service.spec.ts asserting that form context is not evaluated for task-opened forms; updated e2e specs tests/e2e/default/tasks/tasks.wdio-spec.js and tasks-breadcrumbs.wdio-spec.js, and added a context expression in tests/e2e/default/tasks/forms/home-visit.properties.json to reproduce and guard against the regression.

## Related Issues

- #8745: form context was incorrectly evaluated when opening a task (the bug being fixed)
- #8746: original PR; #8748 is its cherry-pick/backport to the 4.4.x release branch

## Domain Rationale

**Fit:** strong

The fix modifies form context-expression evaluation inside the Enketo form-rendering service (webapp/src/ts/services/enketo.service.ts) and touches a form properties file — both core forms-and-reports mechanisms. Tasks are only the trigger/entry point: as with the 'SMS-not-sent-when-tasks-overdue → messaging' seed, the broken mechanism (form context evaluation), not the trigger (opening a task), sets the domain.
