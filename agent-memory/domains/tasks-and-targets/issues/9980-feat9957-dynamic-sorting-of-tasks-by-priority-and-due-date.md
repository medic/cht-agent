---
id: cht-core-9957
category: feature
domain: tasks-and-targets
domainFit: strong
issueNumber: 9957
issueUrl: https://github.com/medic/cht-core/issues/9957
title: Dynamically sort tasks by priority score and then due date in the task list
lastUpdated: '2026-06-22'
summary: Tasks were previously sorted only by due date, forcing users to manually spot the most urgent ones. This adds a comparator that sorts primarily by priority (higher first), then by due date (earlier first) within equal priorities, with consistent handling of invalid/missing values.
services:
  - webapp
techStack:
  - typescript
  - angular
  - ngrx
  - javascript
  - karma
tags:
  - task-sorting
  - priority
  - due-date
  - comparator
  - tasks-list
  - sorting-algorithm
related_workflows:
  - task-scheduling
source_pr: medic/cht-core#9980
source_sha: aa0b0cb5f3ef75ee3e1720b90a4b234bd32bde81
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - webapp/src/ts/reducers/tasks.ts
  - config/default/tasks.js
  - webapp/src/ts/services/format-date.service.ts
concepts:
  - multi-key sorting
  - comparator function
  - task prioritization
  - ngrx reducer state
  - stable sort / original-order fallback
  - invalid-value handling
related_issues: []
stale: false
---

## Problem

The task list was sorted exclusively by due date, so higher-priority tasks could be buried below less important ones and users had to manually identify the most urgent work. There was no priority dimension in the sort.

## Root Cause

The sorting logic in the tasks reducer used due date as the sole sort key, with no notion of a task priority score and no defined ordering for tasks with missing or invalid priority/date values.

## Solution

Implemented a refined comparator in the tasks reducer that sorts primarily by priority descending (higher numbers first), then by due date ascending within the same priority. Invalid/missing priorities are pushed to the end, invalid dates are pushed to the end within the same priority, and tasks with both invalid retain their original relative order. Added supporting priority handling in config/default/tasks.js and date validation/formatting in format-date.service.ts.

## Code Patterns

Layered comparator pattern in webapp/src/ts/reducers/tasks.ts: compare priority (desc) first, fall back to due date (asc) on ties, and short-circuit invalid values to the end while preserving original order when both keys are invalid. Date parsing/validity guard centralized in webapp/src/ts/services/format-date.service.ts.

## Design Choices

Chose frontend recomputation of effective priority/order over Alternative 1 (storing priority as a precomputed [not-due, due, overdue] array on the task), keeping changes confined to the webapp and avoiding a task-schema change. Selected 'priority then due date' ordering over the alternative orderings (due date first, or split strategies for due vs not-due tasks) for predictable urgency-first ranking. Maintains backwards compatibility with existing task structures.

## Related Files

- webapp/src/ts/reducers/tasks.ts
- config/default/tasks.js
- webapp/src/ts/services/format-date.service.ts
- webapp/tests/karma/ts/reducers/tasks.spec.ts

## Testing

Added comprehensive Karma unit tests in webapp/tests/karma/ts/reducers/tasks.spec.ts covering edge cases: invalid date formats (null, false, undefined), invalid priority values (strings, negative numbers), duplicate priorities and dates, and missing fields, verifying both the priority→due-date ordering and the invalid-value-to-end / original-order fallback behavior. Reviewer also flagged a CI lint failure that had to be resolved before merge.

## Related Issues

- #9957: feature request to sort tasks by priority score in addition to due date so users see the most urgent tasks first

## Domain Rationale

**Fit:** strong

The core change is the task-list sorting algorithm in the tasks reducer plus task priority configuration — squarely task display and prioritization, which is canonically the tasks-and-targets domain. The config/default/tasks.js touch supports the same tasks feature rather than constituting a separate configuration concern.
