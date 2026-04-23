---
id: cht-interoperability-141
category: bug
domain: interoperability
subDomain: openmrs-sync-deduplication
issueNumber: 141
issueUrl: https://github.com/medic/cht-interoperability/issues/141
title: OpenMRS sync creates duplicate resources
lastUpdated: 2024-11-11
summary: OpenMRS synchronization could create duplicate resources because uniqueness checks around identifiers and create/update paths were not reliable enough. Follow-up implementation (including PR #146) strengthened identifier-based checks and reduced duplicate creation behavior.
services:
  - api
techStack:
  - typescript
  - javascript
---

## Problem

OpenMRS synchronization occasionally created duplicate resources in the interop flow. Duplicate behavior was observed around patient synchronization and, in related discussion, around conditions where repeated create behavior could occur if matching did not correctly detect existing resources.

A temporary time-window workaround (`SYNC_PERIOD` logic offset by `2 * SYNC_INTERVAL`) reduced symptoms but did not address the core defect.

## Root Cause

The synchronization path depended on imperfect existence checks. If matching by identifiers did not correctly detect an existing FHIR resource, the flow could attempt create operations again, leading to duplicates.

The time-window workaround masked race/boundary conditions but was not a true deduplication guarantee.

## Solution

Issue #141 was resolved by removing reliance on the workaround and strengthening deduplication logic with identifier checks (tracked in linked follow-up PR #146):

- Matching logic was improved to use identifier-based checks before create behavior.
- Resource handling was tightened so duplicate create calls are less likely when a logically identical resource already exists.
- Discussion also clarified neighboring setup concerns (for example channel/config behavior) vs the core duplication defect.

## Code Patterns

- Identifier-based resource lookup pattern before create:
  - `mediator/src/utils/fhir.ts` (resource retrieval helpers)
- Service-request/controller orchestration for create/update decisions:
  - `mediator/src/controllers/service-request.ts`

## Design Choices

- Chose fixing identity checks over extending time-window heuristics.
- Kept deduplication anchored to interoperable identifiers (for example OpenMRS/CHT IDs) rather than only timing assumptions.
- Preferred deterministic identifier matching because sync scheduling can be delayed or interrupted in real deployments.

## Related Files

- mediator/src/utils/fhir.ts
- mediator/src/controllers/service-request.ts
- mediator/test/ltfu-flow.spec.ts

## Testing

- Reproduction and validation were done through sync flow testing and branch-level checks discussed in the issue.
- Follow-up implementation merged via PR #146 and closed the issue.
- Integration scenarios continue to be covered in mediator flow tests:
  - mediator/test/ltfu-flow.spec.ts

## Related Issues

- #116: Allow mediators to update resources with PUT requests
- #54: Make mediator endpoints FHIR compliant
- #138: allow OpenMRS sync to be configureable
