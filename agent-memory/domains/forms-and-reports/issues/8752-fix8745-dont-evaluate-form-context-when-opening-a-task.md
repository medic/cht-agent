---
id: cht-core-8745
category: bug
domain: forms-and-reports
domainFit: strong
issueNumber: 8745
issueUrl: https://github.com/medic/cht-core/issues/8745
title: Don't evaluate the form `context` expression when opening a form from a task
lastUpdated: '2026-06-23'
summary: When opening a form via a task, the Enketo service unnecessarily evaluated the form's `context` expression (meant for the contact 'new action' list), which could error or prevent the form from opening. The fix skips context evaluation on the task-launch path.
services:
  - webapp
techStack:
  - typescript
  - angular
  - enketo
  - webdriverio
  - karma
tags:
  - tasks
  - forms
  - enketo
  - form-context
  - bug-fix
related_workflows:
  - form-submission
  - task-scheduling
source_pr: medic/cht-core#8752
source_sha: f67e9d0c854a9cfbe076659ae503e6c1ef7a9abf
distilled_at: '2026-06-23'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - webapp/src/ts/services/enketo.service.ts
  - tests/e2e/default/tasks/forms/home-visit.properties.json
concepts:
  - form context evaluation
  - Enketo form rendering/loading
  - task-to-form navigation
  - form properties (context expression)
related_issues: []
stale: false
---

## Problem

When a user opened a task that launches a form, the webapp's Enketo service still evaluated the form's `context` expression. That `context` (person/place/expression) is intended to gate whether a form appears in a contact's 'new action' list — not the task flow. Evaluating it on the task path was unnecessary and could throw or interfere with the form opening correctly from a task.

## Root Cause

The form-loading path in enketo.service.ts evaluated the form's `context` expression unconditionally, without distinguishing forms launched from a task (where the task has already determined applicability) from forms launched via a contact's action list.

## Solution

Updated enketo.service.ts to skip evaluation of the form `context` when the form is opened from a task, so the task-launch path no longer runs the context expression. Added/updated karma unit tests and tasks e2e specs (plus a home-visit form properties fixture) to lock in the behavior.

## Code Patterns

Branching form-render behavior on the launch origin (task vs. contact action) inside enketo.service.ts — bypassing `context` expression evaluation for task-launched forms while preserving it for forms opened from a contact's action list.

## Design Choices

Scoped the change to the Enketo service rather than altering form `context` definitions or task configuration, preserving `context` semantics for the contact action list while fixing only the task-launch flow.

## Related Files

- webapp/src/ts/services/enketo.service.ts
- webapp/tests/karma/ts/services/enketo.service.spec.ts
- tests/e2e/default/tasks/tasks.wdio-spec.js
- tests/e2e/default/tasks/tasks-breadcrumbs.wdio-spec.js
- tests/e2e/default/tasks/forms/home-visit.properties.json

## Testing

Karma unit tests in webapp/tests/karma/ts/services/enketo.service.spec.ts updated to assert the form context is not evaluated when opening from a task; WebdriverIO e2e specs (tasks.wdio-spec.js, tasks-breadcrumbs.wdio-spec.js) updated, with a new home-visit.properties.json form-properties fixture added under the tasks e2e suite.

## Related Issues

- #8745: bug where the form `context` was incorrectly evaluated when opening a task (the issue fixed by this PR; this PR is a cherry-pick of commit 34edb11 for the 4.5.x branch)

## Domain Rationale

**Fit:** strong

The fix lives in the webapp Enketo form service (enketo.service.ts) and concerns how a form's `context` expression is evaluated during form loading — a forms-and-reports concern. The task-opening flow is the scenario where the regression surfaces (so tasks-and-targets is a defensible alternative), but the corrected behavior is in form handling, mirroring the seed-3 principle of classifying by the primary technical mechanism over the surface trigger.
