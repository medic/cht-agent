---
id: cht-core-9747
category: bug
domain: interoperability
domainFit: strong
issueNumber: 9747
issueUrl: https://github.com/medic/cht-core/issues/9747
title: Throw an error on invalid outbound push mapping config instead of silently embedding the whole document
lastUpdated: '2026-06-22'
summary: Outbound push mappings whose value was neither a string nor an object with an `expr` property silently included the entire source document in the payload field; the fix now throws an explicit error for such misconfigurations.
services:
  - sentinel
techStack:
  - javascript
  - nodejs
tags:
  - outbound-push
  - config-validation
  - error-handling
  - fail-fast
  - integration
related_workflows: []
source_pr: medic/cht-core#9748
source_sha: 00af9340d22ef3ebb88914bf1e3a21a3386bd1dc
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - shared-libs/outbound/src/outbound.js
concepts:
  - outbound push
  - payload mapping
  - configuration validation
  - fail-fast error handling
related_issues: []
stale: false
---

## Problem

Misconfigurations in an outbound push config produced undefined/unexpected behavior: when a mapping value was neither a string nor an object with an `expr` property, the code did not error but instead silently included the entire source document in the mapped payload field, sending malformed payloads to the external system.

## Root Cause

The mapping logic in shared-libs/outbound/src/outbound.js lacked validation of mapping value shapes; unrecognized mapping types fell through to a permissive default that embedded the whole document rather than failing.

## Solution

Added validation in the outbound mapping path so that any mapping value that is not a string and not an object with an `expr` property causes an explicit error to be thrown, making misconfigurations fail loudly instead of producing incorrect payloads.

## Code Patterns

Fail-fast config validation in shared-libs/outbound/src/outbound.js — explicitly assert each mapping value is either a string or an object with an `expr` property and throw a descriptive error otherwise, instead of relying on a permissive fall-through default.

## Design Choices

Chose to fail fast by throwing on misconfiguration rather than silently defaulting, so operators discover bad outbound config early instead of pushing malformed payloads to downstream systems.

## Related Files

- shared-libs/outbound/src/outbound.js
- shared-libs/outbound/test/outbound.spec.js

## Testing

Added/updated unit tests in shared-libs/outbound/test/outbound.spec.js to assert that invalid mapping configurations now throw the expected error.

## Related Issues

- #9747: Misconfigured outbound push mapping silently includes the entire document instead of erroring

## Domain Rationale

**Fit:** strong

The shared-libs/outbound module is CHT's mechanism for pushing data to external/third-party web services (the canonical interoperability feature); this fix hardens how that integration handles its payload-mapping config.
