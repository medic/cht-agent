---
id: cht-interoperability-116
category: feature
domain: interoperability
subDomain: fhir-http-method-semantics
issueNumber: 116
issueUrl: https://github.com/medic/cht-interoperability/issues/116
title: Allow mediators to update resources with PUT requests
lastUpdated: 2025-01-07
summary: The issue tracked support and validation for correct HTTP update semantics (PUT for updates vs POST for creates) in mediator-driven FHIR flows. The discussion evolved with architecture changes, and the issue was ultimately closed after confirming update behavior in the current mediator approach.
services:
  - api
techStack:
  - typescript
  - javascript
---

## Problem

FHIR integrations expect create and update operations to use appropriate HTTP methods and endpoint semantics. The issue identified that update behavior needed clearer handling so existing remote resources are updated reliably instead of being treated as new creates.

## Root Cause

Initial mediator assumptions and earlier flow design favored `POST` behavior broadly. As interoperability logic evolved, method semantics and state-awareness needed explicit validation in the mediator path.

## Solution

Issue #116 became a tracking item for validating update semantics under the newer mediator architecture:

- Clarified expected behavior: existing resources should be handled with update semantics.
- Evaluated where this decision should live (mediator-side state/logic vs upstream assumptions).
- Closed after confirming behavior in the updated architecture and related implementation work.

## Code Patterns

- Route-level handling that can support distinct create/update logic:
  - `mediator/src/routes/patient.ts`
  - `mediator/src/routes/encounter.ts`
  - `mediator/src/routes/service-request.ts`
- Shared FHIR request utility where method/path behavior is centralized:
  - `mediator/src/utils/fhir.ts`
- Shared request wrapper pattern for consistent responses:
  - `mediator/src/utils/request.ts`

## Design Choices

- Preferred aligning with REST/FHIR semantics rather than relying on implicit upsert behavior.
- Kept discussion open while architecture was changing, then closed once behavior was validated in the new flow.
- Left room for future refinements where resource-specific behavior may require stricter method routing.

## Related Files

- mediator/src/routes/patient.ts
- mediator/src/routes/encounter.ts
- mediator/src/routes/service-request.ts
- mediator/src/utils/fhir.ts
- mediator/src/utils/request.ts
- mediator/src/controllers/service-request.ts

## Testing

- Route/controller unit tests validate request/response behavior for mediator endpoints:
  - mediator/src/routes/tests/patient.spec.ts
  - mediator/src/routes/tests/encounter.spec.ts
  - mediator/src/routes/tests/service-request.spec.ts
- FHIR utility tests cover helper behavior used by create/update paths:
  - mediator/src/utils/tests/fhir.spec.ts
- End-to-end flow checks in mediator integration test suite:
  - mediator/test/ltfu-flow.spec.ts

## Related Issues

- #141: OpenMRS sync creates duplicate resources
- #124: Decouple OpenMRS and CHT Endpoints
- #54: Make mediator endpoints FHIR compliant
