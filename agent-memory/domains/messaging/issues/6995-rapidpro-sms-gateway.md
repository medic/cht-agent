---
id: cht-core-6995
category: feature
domain: messaging
subDomain: rapidpro
issueNumber: 6995
issueUrl: https://github.com/medic/cht-core/issues/6995
title: Adds RapidPro as an SMS Gateway
lastUpdated: 2021-04-09
summary: Integrated RapidPro as an SMS gateway option, enabling CHT to send and receive SMS messages through RapidPro's API in addition to existing gateway options.
services:
  - api
  - sentinel
techStack:
  - javascript
  - nodejs
  - couchdb
---

## Problem

CHT needed to support RapidPro as an SMS gateway option to enable deployments in regions where RapidPro is the preferred or available SMS provider. Prior to this integration, CHT only supported medic-gateway and Africa's Talking, limiting deployment flexibility.

## Root Cause

No RapidPro integration existed in the codebase. The messaging architecture needed to be extended to support RapidPro's API for both sending outbound messages and receiving inbound messages via webhooks.

## Solution

Implemented full RapidPro gateway integration:

1. **Created RapidPro service**: `api/src/services/rapidpro.js` to handle message sending via RapidPro API
2. **Added callback endpoints**: `api/src/controllers/rapidpro.js` to receive delivery receipts and inbound messages from RapidPro webhooks
3. **Integrated with messaging pipeline**: Connected RapidPro service to the existing message sending infrastructure
4. **Added configuration support**: Enabled RapidPro gateway selection in CHT configuration
5. **Implemented state tracking**: Mapped RapidPro message states (queued, sent, delivered, failed) to CHT message states
6. **Added comprehensive tests**: Unit tests for RapidPro service and e2e tests for full integration

The integration follows the same pattern as Africa's Talking and medic-gateway, ensuring consistency across gateway implementations.

## Code Patterns

- Implement gateway services with consistent interface: `send()`, `handleCallback()`, `getStatus()`
- Use environment variables for gateway credentials (RAPIDPRO_URL, RAPIDPRO_TOKEN)
- Map external gateway states to CHT states for consistency
- Pattern: `api/src/services/rapidpro.js` exports send and callback handling functions
- Pattern: `api/src/controllers/rapidpro.js` exposes webhook endpoints for RapidPro callbacks
- Use request-promise for HTTP calls to RapidPro API
- Handle RapidPro's specific response format and error codes

## Design Choices

Chose to implement RapidPro as a separate gateway module rather than modifying existing gateways because:
- Each gateway has unique API requirements and authentication
- Maintains separation of concerns
- Allows independent testing and deployment
- Follows the established pattern from Africa's Talking integration
- Enables deployments to choose their preferred gateway

## Related Files

- api/src/services/rapidpro.js
- api/src/controllers/rapidpro.js
- api/tests/mocha/services/rapidpro.spec.js
- tests/e2e/default/sms-gateway/rapidpro.wdio-spec.js

## Testing

- Added unit tests for RapidPro message sending
- Added unit tests for RapidPro callback handling
- Added e2e tests for full RapidPro integration flow
- Tested error handling for invalid phone numbers
- Tested state mapping from RapidPro to CHT states

## Related Issues

- #5717: Africa's Talking integration (similar gateway pattern)
- #9467: RapidPro API error handling bug fix
- #6532: Original issue for RapidPro integration
