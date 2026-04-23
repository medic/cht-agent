---
id: cht-interoperability-138
category: feature
domain: interoperability
subDomain: mediator-configuration
issueNumber: 138
issueUrl: https://github.com/medic/cht-interoperability/issues/138
title: allow OpenMRS sync to be configureable
lastUpdated: 2024-10-25
summary: The mediator was previously automatically starting the OpenMRS sync process on startup. Because not all interoperability projects use OpenMRS, the sync process needed to be decoupled from the core mediator startup. The fix moved polling configuration to the OpenHIM channel config and exposed it via an endpoint, ensuring sync is only started when explicitly configured.
services:
  - mediator
techStack:
  - typescript
  - nodejs
  - openhim
---

## Problem

The mediator was starting the OpenMRS sync on startup automatically. However, not all interoperability projects involve OpenMRS. Starting the OpenMRS sync unconditionally blocked merging OpenMRS-specific features back to the `main` branch, because the core mediator deployment should be agnostic and not hardcode assumptions about external systems like OpenMRS.

## Root Cause

The OpenMRS sync loop (`startOpenmrsSync`) was invoked globally during the mediator's execution lifecycle regardless of environment variables or OpenHIM channel configuration, making the mediator tightly coupled to OpenMRS rather than being a generic routing middleware.

## Solution

The solution (implemented in PR #139) decoupled the OpenMRS sync behavior from the mediator startup sequence. It introduced an explicit `POST /openmrs/sync` endpoint that starts the openmrs sync using the `openmrs_sync.ts` utility. The OpenHIM channel configuration was updated to trigger this polling route, making the behavior opt-in and controlled by configuration rather than hardcoded logic.

## Code Patterns

- Expose a dedicated route `POST /openmrs/sync` managed by an `openmrs` controller, rather than invoking sync on startup.
- Read external synchronization configurations (like polling intervals) from OpenHIM channels or explicit requests, keeping the mediator process stateless and generic by default.
- Utility function `startOpenmrsSync` is exported and used within the new controller when explicitly invoked.

## Design Choices

- Making PRs against an OpenMRS specific mediator branch instead of pushing directly, to ensure that the core mediator remains generic.
- Moving the polling trigger completely outside of the mediator's startup sequence and relying on OpenHIM's configuration to orchestrate scheduled polling or syncing tasks via HTTP calls.

## Related Files

- mediator/src/routes/openmrs.ts
- mediator/src/controllers/openmrs.ts
- mediator/config/openmrs_mediator.ts
- mediator/src/utils/openmrs_sync.ts

## Testing

- Added `mediator/src/routes/tests/openmrs.spec.ts` to test that the `/openmrs/sync` route integrates correctly and triggers the OpenMRS sync workflow when called.
- End-to-end checks to ensure the mediator still starts properly without OpenMRS syncing unless requested.

## Related Issues

- #54: Make mediator endpoints FHIR compliant
- #141: OpenMRS sync creates duplicate resources
- #116: Allow mediators to update resources with PUT requests
