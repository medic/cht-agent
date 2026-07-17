---
id: cht-core-8745
category: bug
domain: forms-and-reports
domainFit: strong
issueNumber: 8745
issueUrl: https://github.com/medic/cht-core/issues/8745
title: Skip form context expression evaluation when opening a form from a task
lastUpdated: '2026-07-16'
summary: When opening a task's form, the Enketo service was still evaluating the form's context expression (which is meant to gate form visibility in the action launcher/contact form lists), causing incorrect behavior on the task-launch path. The fix bypasses context evaluation when a form is opened from a task.
services:
  - webapp
techStack:
  - typescript
  - angular
  - enketo
  - webdriverio
tags:
  - form-context
  - task-opening
  - enketo-service
  - form-rendering
  - context-expression
related_workflows:
  - form-submission
  - task-scheduling
source_pr: medic/cht-core#8746
source_prs:
  - "medic/cht-core#8746"
  - "medic/cht-core#8748"
  - "medic/cht-core#8752"
source_sha: 34edb11f7f5b9a2f945945387e70a762098c8148
distilled_at: '2026-06-23'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - webapp/src/ts/services/enketo.service.ts
  - webapp/tests/karma/ts/services/enketo.service.spec.ts
concepts:
  - form context expression evaluation
  - Enketo form rendering/loading
  - task-to-form navigation
  - form properties context gating
related_issues: []
stale: false
---

## Problem

Opening a task that launches a form triggered evaluation of the form's context expression. That expression exists to decide whether a form is offered in contact/action-launcher contexts and is irrelevant when a task has already selected the form. Evaluating it on the task path produced incorrect behavior (e.g. failures or the form not opening as expected) because the context expression can reference data not available in the task-launch scenario.

## Root Cause

enketo.service.ts evaluated the form's context expression unconditionally during the form open/render path, without distinguishing forms launched from a task. Since a task has already determined the applicable form, re-evaluating the context is redundant and can break when the expression depends on contact/launcher state absent in the task flow.

## Solution

Updated enketo.service.ts so the task-launch path skips evaluation of the form context expression, while preserving context evaluation for other launch paths (action launcher / contact form lists). Backed by a new/updated unit test in enketo.service.spec.ts and e2e coverage in the tasks suite, using a home-visit.properties.json fixture that defines a context expression to reproduce the scenario. The fix was cherry-picked from commit 34edb11 to both the 4.4.x (PR #8748) and 4.5.x (PR #8752) release lines.

## Code Patterns

Guard context-specific evaluation by launch source: thread a flag indicating the form was opened from a task into the Enketo render path and only evaluate the context expression when it is meaningful (webapp/src/ts/services/enketo.service.ts).

## Design Choices

Suppress context evaluation only on the task path rather than removing context evaluation globally — the context expression is still required to gate form availability in the action launcher and contact form lists. Tasks already determine which form applies, so re-evaluating context there is redundant and error-prone.

## Related Files

- webapp/src/ts/services/enketo.service.ts
- webapp/tests/karma/ts/services/enketo.service.spec.ts
- tests/e2e/default/tasks/tasks.wdio-spec.js
- tests/e2e/default/tasks/tasks-breadcrumbs.wdio-spec.js
- tests/e2e/default/tasks/forms/home-visit.properties.json

## Testing

Added/updated a Karma unit test in enketo.service.spec.ts asserting the form context expression is not evaluated when opening from a task; added/updated WebdriverIO e2e tests in tests/e2e/default/tasks/tasks.wdio-spec.js and tasks-breadcrumbs.wdio-spec.js, with a supporting home-visit.properties.json fixture that supplies a context expression to exercise the task-open path.

## Related Issues

- #8745: form context expression incorrectly evaluated when opening a task

## Domain Rationale

**Fit:** strong

The defect and its fix live entirely in the Enketo form-rendering service (enketo.service.ts) and concern when a form's context expression is evaluated — a core forms-and-reports concept. The task-opening scenario is only the trigger that exposed it (tasks-and-targets is the secondary, cross-cutting domain, hence the relatedWorkflows entry); the corrected behavior is in form handling, so this is forms-and-reports.
