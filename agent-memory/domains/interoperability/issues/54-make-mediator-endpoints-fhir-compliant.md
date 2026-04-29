---
id: cht-interoperability-54
category: feature
domain: interoperability
subDomain: mediator-fhir-endpoints
issueNumber: 54
issueUrl: https://github.com/medic/cht-interoperability/issues/54
title: Make mediator endpoints FHIR compliant
lastUpdated: 2023-04-28
summary: The interoperability mediator endpoints were aligned to HL7 FHIR request/response expectations. The implementation in PR #76 added stricter resource validation, standardized route behavior, and broader unit/integration test coverage so CHT↔OpenHIM↔FHIR flows use consistent FHIR semantics.
services:
  - api
techStack:
  - typescript
  - javascript
---

## Problem

The mediator accepted payloads for FHIR resources, but endpoint behavior and validation were not consistently aligned with FHIR expectations across all routes. That made integration behavior harder to reason about when external systems (through OpenHIM/FHIR server) relied on predictable resource handling.

This surfaced as interoperability friction in core mediator workflows (patient, encounter, endpoint, organization, service-request), where API shape consistency matters for upstream and downstream systems.

## Root Cause

FHIR validation and route-level schema validation were present in parts of the mediator, but not applied in a fully consistent pattern across all resources and handlers. The project also needed better route/controller test coverage to lock in behavior.

## Solution

Issue #54 was closed via PR #76, which standardized endpoint behavior and validation approach across mediator routes:

- Route handlers consistently pass through a shared request wrapper and validation middleware.
- FHIR resource validation is applied per route/resource type.
- Resource-specific Joi schemas are used where needed.
- Endpoint and controller tests were expanded to protect behavior and avoid regressions.

This made the mediator endpoints more predictable for external systems and for future enhancements.

## Code Patterns

- Route-level FHIR validation pattern:
  - `mediator/src/routes/patient.ts`
  - `mediator/src/routes/encounter.ts`
  - `mediator/src/routes/endpoint.ts`
  - `mediator/src/routes/organization.ts`
  - `mediator/src/routes/service-request.ts`
- Shared response handling pattern:
  - `mediator/src/utils/request.ts` (`requestHandler`)
- Shared FHIR utility pattern:
  - `mediator/src/utils/fhir.ts` (`validateFhirResource`, resource helpers)
- Middleware composition pattern for request validation:
  - `mediator/src/middlewares/index.ts`

## Design Choices

- Chose central validation/util wrappers (instead of per-route custom logic) to keep behavior consistent and maintainable.
- Kept resource-specific schema checks where domain constraints differ (for example `ServiceRequest` and `Endpoint`) while reusing common FHIR validation.
- Prioritized strong automated tests to stabilize mediator behavior as the interop surface grows.

## Related Files

- mediator/src/routes/patient.ts
- mediator/src/routes/encounter.ts
- mediator/src/routes/endpoint.ts
- mediator/src/routes/organization.ts
- mediator/src/routes/service-request.ts
- mediator/src/middlewares/index.ts
- mediator/src/utils/fhir.ts
- mediator/src/utils/request.ts

## Testing

- Unit tests for route validation and handler behavior:
  - mediator/src/routes/tests/patient.spec.ts
  - mediator/src/routes/tests/encounter.spec.ts
  - mediator/src/routes/tests/endpoint.spec.ts
  - mediator/src/routes/tests/service-request.spec.ts
- Unit tests for schema and FHIR utility behavior:
  - mediator/src/middlewares/schemas/tests/*.spec.ts
  - mediator/src/utils/tests/fhir.spec.ts
  - mediator/src/utils/tests/request.spec.ts
- Integration/e2e path for mediator flow:
  - mediator/test/ltfu-flow.spec.ts

## Related Issues

- #124: Decouple OpenMRS and CHT Endpoints
- #116: Allow mediators to update resources with PUT requests
- #141: OpenMRS sync creates duplicate resources
