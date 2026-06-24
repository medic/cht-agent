---
id: cht-core-8947
category: bug
domain: interoperability
domainFit: strong
issueNumber: 8947
issueUrl: https://github.com/medic/cht-core/issues/8947
title: 'Fix outbound push clearing valid not-yet-due tasks: distinguish missing configs from configs whose cron is not due yet'
lastUpdated: '2026-06-23'
summary: Outbound push tasks whose config cron was not yet due were incorrectly cleared with an 'outbound config no longer exists' error. The fix filters out these valid-but-not-due tasks so they stay queued instead of being deleted as orphaned.
services:
  - sentinel
techStack:
  - javascript
  - node.js
  - couchdb
  - cron
tags:
  - outbound
  - outbound-push
  - cron
  - scheduling
  - sentinel
  - bug-fix
related_workflows: []
source_pr: medic/cht-core#9425
source_sha: 4fc268d1d3c82ff116b176dcddb559e52519042e
distilled_at: '2026-06-23'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - sentinel/src/schedule/outbound.js
concepts:
  - outbound push
  - cron scheduling
  - sentinel scheduled jobs
  - task queue reconciliation
  - orphaned task cleanup
related_issues: []
stale: false
---

## Problem

Outbound push tasks were being deleted with the error 'Unable to push ***** for ped_benchmark_outbound because this outbound config no longer exists, clearing task'. This hit tasks whose outbound config was still valid but whose cron schedule meant they were not yet due, so legitimately queued pushes were lost.

## Root Cause

In sentinel/src/schedule/outbound.js, queued outbound tasks were matched only against configs that were currently due per their cron setting. A config that was not due was excluded, leaving the task with an empty set of applicable configs, which the code interpreted as 'the config no longer exists' and cleared the task — conflating 'config absent' with 'config present but not due yet'.

## Solution

The not-yet-due case is separated from the orphaned case: tasks that end up with empty configs only because their cron is not due are filtered out of the current push cycle and left queued, while genuinely config-less (orphaned) tasks are still cleared.

## Code Patterns

In sentinel/src/schedule/outbound.js, before the orphan-cleanup step that clears tasks with no matching config, filter out tasks whose config exists but is not due per cron — i.e. separate 'no config -> clear' from 'config not due -> skip and keep'.

## Design Choices

Kept the existing cron-based due-filtering rather than redesigning scheduling; the minimal fix excludes not-due tasks from the cleanup path so they survive for a future run when they become due.

## Related Files

- sentinel/src/schedule/outbound.js
- sentinel/tests/unit/schedule/outbound.spec.js

## Testing

Unit tests in sentinel/tests/unit/schedule/outbound.spec.js were added/updated to cover a task with a valid config that is not yet due per cron, asserting the task is preserved (not cleared) and not pushed in the current cycle.

## Related Issues

- #8947: Outbound push tasks failing with 'outbound config no longer exists, clearing task' caused by cron-based config filtering

## Domain Rationale

**Fit:** strong

Outbound push is CHT's canonical mechanism for sending document data to external third-party systems (e.g. DHIS2) on a schedule, and the fix lives in the sentinel outbound scheduler that performs those pushes. Strong fit because the feature exists specifically to integrate CHT with external systems.
