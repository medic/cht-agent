---
id: cht-core-9714
category: improvement
domain: tasks-and-targets
domainFit: strong
issueNumber: 9714
issueUrl: https://github.com/medic/cht-core/issues/9714
title: Remove rules-engine interval turnover to address incorrect target document values
lastUpdated: '2026-06-22'
summary: 'The rules-engine''s interval turnover — which saved a snapshot of the last calculation when a reporting interval (e.g. month) rolled over — was implicated in producing incorrect values in target docs. This PR removes the turnover logic and relies on accurate recalculation (improved by #9486) instead.'
services:
  - webapp
techStack:
  - javascript
  - couchdb
tags:
  - rules-engine
  - interval-turnover
  - target-documents
  - data-quality
  - targets
related_workflows: []
source_pr: medic/cht-core#9718
source_sha: cfa682f4eca373366d58fd260d024de7a4b485d2
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - shared-libs/rules-engine/src/provider-wireup.js
  - shared-libs/rules-engine
concepts:
  - interval turnover
  - target document calculation
  - rules engine recalculation
  - reporting intervals
  - target snapshots
related_issues: []
stale: false
---

## Problem

Evidence from #9714 indicated that the rules-engine's interval turnover was likely causing incorrect values in target documents. At each reporting-interval boundary the engine persisted a snapshot of the previous interval's last calculation, which could leave inaccurate/stale figures in target docs rather than reflecting an accurate recalculation.

## Root Cause

The interval turnover mechanism in provider-wireup.js snapshotted the last calculation at interval boundaries instead of recalculating. After recalculation accuracy was improved by #9486, that snapshot became both unnecessary and a source of incorrect target values.

## Solution

Removed the interval turnover logic from shared-libs/rules-engine/src/provider-wireup.js so the engine no longer snapshots the last calculation when an interval rolls over, depending instead on the now-accurate recalculation. Integration and provider-wireup unit tests were updated to match the removed behavior.

## Code Patterns

Rules-engine wireup/refresh cycle in provider-wireup.js: removing the boundary-snapshot step shows how the engine's interval handling and target-doc update path are structured; tests in provider-wireup.spec.js and integration.spec.js demonstrate asserting on rules-engine recalculation behavior across interval boundaries.

## Design Choices

Chose to remove interval turnover outright (the PR's 'option 1'), accepting that it reopens the gap documented in #6209 — though that gap should now be significantly smaller after #9486. Tradeoff: projects may miss one recalculation immediately after upgrade. A residual concern: turnover previously preserved a snapshot of the last calculation, so this may not fully resolve the data-quality issue.

## Related Files

- shared-libs/rules-engine/src/provider-wireup.js
- shared-libs/rules-engine/test/integration.spec.js
- shared-libs/rules-engine/test/provider-wireup.spec.js

## Testing

Updated existing rules-engine tests — test/integration.spec.js and test/provider-wireup.spec.js — to reflect the removal of interval turnover behavior.

## Related Issues

- #9714: Evidence that interval turnover causes incorrect values in target docs (the motivating issue)
- #9486: Prior work improving recalculation that suggests interval turnover is no longer needed and shrinks the reopened gap
- #6209: Documents the recalculation gap that removing interval turnover reopens

## Domain Rationale

**Fit:** strong

The change is internal to the rules-engine and specifically governs target-document recalculation across reporting intervals ('interval turnover'), which is squarely the tasks-and-targets domain (the rules-engine computes both tasks and targets).
