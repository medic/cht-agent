---
id: cht-core-10225
category: feature
domain: messaging
domainFit: strong
issueNumber: 10225
issueUrl: https://github.com/medic/cht-core/issues/10225
title: Add support for Nepal's centralized DoIT SMS gateway in the API messaging service
lastUpdated: '2026-06-22'
summary: CHT had no way to route outbound SMS through Nepal's mandated centralized government (DoIT) SMS gateway. This PR adds a dedicated nepal-doit-sms service and integrates it into the messaging service so messages can be delivered via that gateway.
services:
  - api
techStack:
  - javascript
  - nodejs
  - mocha
tags:
  - sms
  - sms-gateway
  - nepal
  - doit
  - outbound-messaging
  - integration
related_workflows:
  - message-processing
source_pr: medic/cht-core#10243
source_sha: b567b0a8a523d45c1cd1f12c60977556696e0f19
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - api/src/services/nepal-doit-sms.js
  - api/src/services/messaging.js
concepts:
  - SMS gateway integration
  - outbound message delivery
  - pluggable messaging provider
related_issues: []
stale: false
---

## Problem

CHT deployments in Nepal that are required to route SMS through the country's centralized DoIT government SMS gateway had no supported delivery path — the messaging service did not implement that gateway's protocol.

## Root Cause

Feature gap rather than a defect: the API messaging service supported existing gateway/transport options but had no module implementing the Nepal DoIT gateway's send protocol.

## Solution

Added a new api/src/services/nepal-doit-sms.js module implementing the DoIT gateway send logic and hooked it into api/src/services/messaging.js so outbound SMS can be dispatched through the Nepal gateway. Added a mocha unit-test spec for the new service. Merged as a cherry-pick of the upstream commit.

## Code Patterns

Per-gateway service module pattern: gateway-specific send logic isolated in its own file under api/src/services/ (nepal-doit-sms.js) and plugged into the central messaging.js dispatch, keeping each provider independently testable.

## Design Choices

Implemented the gateway as a dedicated, separately-tested service module rather than inlining provider-specific logic in messaging.js, preserving separation of concerns and allowing the new gateway to be unit-tested in isolation.

## Related Files

- api/src/services/nepal-doit-sms.js
- api/src/services/messaging.js
- api/tests/mocha/services/nepal-doit-sms.spec.js

## Testing

Added a new mocha unit-test spec (api/tests/mocha/services/nepal-doit-sms.spec.js) covering the new Nepal DoIT SMS service.

## Related Issues

- #10225: Support for centralized SMS gateway of Nepal
- #10230: Original PR cherry-picked into this 4.x backport (#10243)

## Domain Rationale

**Fit:** strong

The PR adds application code (a new nepal-doit-sms service wired into the central messaging.js dispatch) to send outbound SMS through Nepal's centralized government (DoIT) gateway. This is core message-delivery functionality, not a runtime config/setup issue, so it squarely belongs to the messaging domain.
