---
id: cht-core-9099
category: improvement
domain: tasks-and-targets
domainFit: strong
issueNumber: 9099
issueUrl: https://github.com/medic/cht-core/issues/9099
title: Disable target aggregates page for users associated with multiple facility_ids
lastUpdated: '2026-06-23'
summary: Target aggregates were shown (when can_aggregate_targets was enabled) to users with multiple associated facilities, where cross-facility aggregation isn't supported and produces incorrect results. The change gates the aggregate-targets analytics module so users whose facility_id is a multi-entry array no longer see the page.
services:
  - webapp
techStack:
  - typescript
  - angular
  - couchdb
tags:
  - target-aggregates
  - multi-facility
  - facility-id
  - analytics
  - can_aggregate_targets
  - feature-gating
related_workflows: []
source_pr: medic/cht-core#9099
source_sha: ce76404b004af707972cd51b5081f250edbb8bec
distilled_at: '2026-06-23'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - webapp/src/ts/services/target-aggregates.service.ts
  - webapp/src/ts/services/analytics-modules.service.ts
  - webapp/src/ts/components/filters/analytics-filter/analytics-filter.component.ts
concepts:
  - target aggregates
  - multi-facility users
  - analytics modules enablement
  - user facility association (facility_id as array)
  - conditional feature gating
related_issues: []
stale: false
---

## Problem

When the can_aggregate_targets permission was enabled, users associated with a single facility could view the target aggregates page, but users associated with multiple facilities (facility_id stored as an array of IDs) hit unsupported/broken behavior because the aggregation logic assumes a single facility. The feature was never meaningful for multi-facility users.

## Root Cause

The target-aggregates and analytics-modules services only checked the can_aggregate_targets permission and implicitly assumed a single facility_id; they did not account for users whose facility_id is an array with more than one entry, so the aggregate-targets analytics module was still enabled for multi-facility users.

## Solution

Added a check that detects when the user's facility_id is a multi-entry array and, in that case, disables/excludes the aggregate-targets analytics module so the page is not shown. Logic was added in target-aggregates.service.ts and analytics-modules.service.ts, with analytics-filter.component.ts updated to honor the gated module list. Unit tests and an e2e spec for multi-facility users were added.

## Code Patterns

Multi-facility detection by inspecting whether userCtx.facility_id is an array of length > 1, then using that result to conditionally include/exclude an analytics module in analytics-modules.service.ts (rather than only checking the can_aggregate_targets permission). The component consumes the already-filtered module list instead of re-deriving eligibility.

## Design Choices

Chose to fully disable target aggregates for multi-facility users instead of attempting cross-facility aggregation, since aggregation semantics across multiple sibling facilities are not well-defined. Gating is applied at the analytics-module/service layer so both the navigation/filter and the page respect a single source of truth.

## Related Files

- webapp/src/ts/services/target-aggregates.service.ts
- webapp/src/ts/services/analytics-modules.service.ts
- webapp/src/ts/components/filters/analytics-filter/analytics-filter.component.ts
- webapp/tests/karma/ts/services/analytics-modules.service.spec.ts
- webapp/tests/karma/ts/services/target-aggregates.service.spec.ts
- tests/e2e/default/targets/target-aggregates.wdio-spec.js
- tests/page-objects/default/targets/target-aggregates.wdio.page.js

## Testing

Added Karma unit tests for analytics-modules.service and target-aggregates.service covering the multi-facility gating, plus a WebdriverIO e2e spec (with page-object updates) in tests/e2e/default/targets/target-aggregates.wdio-spec.js verifying that users with multiple facility_ids cannot access the aggregates page while single-facility users still can. The e2e coverage for multiple facility IDs was added at reviewer (lorerod) request.

## Related Issues

- #6543: disable target aggregates for users with multiple facility_ids

## Domain Rationale

**Fit:** strong

The PR modifies the target aggregates feature (an aggregation view over targets/coverage metrics), which is canonically the tasks-and-targets domain. Although the gating condition reads user facility_id configuration, the behavior being changed is target-aggregate visibility, not authentication/permissions themselves.
