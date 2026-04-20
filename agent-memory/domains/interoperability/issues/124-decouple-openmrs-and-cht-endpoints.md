---
id: cht-interoperability-124
category: improvement
domain: interoperability
subDomain: openmrs-fhir-mediation
issueNumber: 124
issueUrl: https://github.com/medic/cht-interoperability/issues/124
title: Decouple OpenMRS and CHT Endpoints
lastUpdated: 2024-06-06
summary: The interoperability flow was updated so CHT and OpenMRS communicate through FHIR mediation instead of depending on each other’s direct endpoint availability. This reduced synchronous coupling and enabled more resilient message flow through OpenHIM/FHIR server patterns.
services:
  - api
techStack:
  - typescript
  - javascript
---

## Problem

The integration path required direct endpoint dependence between CHT and OpenMRS in both directions. If either side was unavailable, synchronization requests could fail immediately.

That coupling increased operational risk and made interop less resilient during outages or transient errors.

## Root Cause

Integration flow design was too endpoint-coupled: outbound behavior assumed direct system availability rather than using mediator/FHIR routing patterns to isolate systems.

## Solution

Issue #124 tracked decoupling work (linked implementation in PR #115 and related commits), shifting the architecture toward mediated FHIR flow:

- CHT/OpenMRS interactions are mediated through the interoperability stack instead of tight direct dependencies.
- Mapping logic for CHT/OpenMRS-facing resources was improved to support this mediated model.
- The resulting flow better fits OpenHIM + FHIR architecture, reducing brittleness when one side is temporarily unavailable.

## Code Patterns

- FHIR-first mediation pattern:
  - `mediator/src/utils/fhir.ts`
  - `mediator/src/controllers/service-request.ts`
- OpenHIM channel/bootstrap pattern:
  - `configurator/index.js`
  - `configurator/libs/generators.js`
- CHT API handoff pattern for mediator-created records:
  - `mediator/src/utils/cht.ts`

## Design Choices

- Chose architectural decoupling over ad-hoc retries at direct endpoints.
- Used mediator/configurator responsibilities to keep OpenHIM/FHIR routing concerns outside CHT core configuration.
- Kept changes aligned with existing LTFU flow conventions to avoid introducing a separate parallel architecture.

## Related Files

- mediator/src/controllers/service-request.ts
- mediator/src/utils/fhir.ts
- mediator/src/utils/cht.ts
- mediator/config/index.ts
- mediator/config/mediator.ts
- configurator/index.js
- configurator/libs/generators.js

## Testing

- Existing and updated integration flow verification:
  - mediator/test/ltfu-flow.spec.ts
- Unit coverage for mediator FHIR/controller utilities:
  - mediator/src/controllers/tests/service-request.spec.ts
  - mediator/src/utils/tests/fhir.spec.ts
- Config/bootstrap verification through configurator flow:
  - configurator/index.js execution path and test pipeline usage

## Related Issues

- #54: Make mediator endpoints FHIR compliant
- #141: OpenMRS sync creates duplicate resources
- #116: Allow mediators to update resources with PUT requests
