---
id: cht-core-10317
category: feature
domain: tasks-and-targets
domainFit: strong
issueNumber: 10317
issueUrl: https://github.com/medic/cht-core/issues/10317
title: Support reporting periods in rules engine service to return targets for the previous month
lastUpdated: '2026-06-22'
summary: The rules engine service could only return targets for the current reporting period. This PR adds support for reporting periods so the service can return targets for the previous month, including handling of not-found targets.
services:
  - webapp
techStack:
  - typescript
  - angular
  - karma
tags:
  - rules-engine
  - targets
  - reporting-periods
  - previous-month
  - target-aggregates
related_workflows: []
source_pr: medic/cht-core#10337
source_sha: 1b5e6367a11d857622d720af679c1a960412c16c
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - webapp/src/ts/services/rules-engine.service.ts
concepts:
  - rules engine
  - reporting periods
  - target computation
  - monthly target aggregation
related_issues: []
stale: false
---

## Problem

The rules engine service computed and returned targets only for the current reporting period, with no way to retrieve targets for a prior month. This limited historical/retrospective target reporting for users who needed to view the previous month's coverage metrics.

## Root Cause

The target-fetching logic in rules-engine.service.ts was scoped to the current reporting period and lacked a parameter/code path for requesting targets belonging to an earlier period.

## Solution

Updated rules-engine.service.ts to support a reporting period so the service can return targets for the previous month, and added handling for cases where targets are not found for the requested period.

## Code Patterns

Thread a reporting-period selector through the rules engine target retrieval so callers can request current vs. previous period, with explicit not-found handling. File: webapp/src/ts/services/rules-engine.service.ts

## Design Choices

The final implementation explicitly accounts for periods where no targets exist rather than assuming a result is always present.

## Related Files

- webapp/src/ts/services/rules-engine.service.ts
- webapp/tests/karma/ts/services/rules-engine.service.spec.ts

## Testing

Karma unit tests added/updated in webapp/tests/karma/ts/services/rules-engine.service.spec.ts to cover returning targets for the previous reporting period and the not-found cases.

## Related Issues

- #10317: Update the rules engine service to support returning targets for the previous month

## Domain Rationale

**Fit:** strong

The rules engine service is the component that computes tasks and targets; this PR extends its target-computation behavior to support reporting periods (returning targets for the previous month), which is core tasks-and-targets functionality rather than a config or rules-engine-settings change.
