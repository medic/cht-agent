---
id: cht-core-3406
category: feature
domain: messaging
subDomain: delivery-status
issueNumber: 3406
issueUrl: https://github.com/medic/cht-core/issues/3406
title: Message delivery statuses
lastUpdated: 2017-04-26
summary: Implemented gateway message delivery statuses, enabling CHT to track SMS message states (sent, delivered, failed) from SMS gateways and expose them via API endpoints.
services:
  - api
  - sentinel
techStack:
  - javascript
  - nodejs
  - couchdb
---

## Problem

CHT had no way to track SMS delivery statuses from gateways. Once a message was sent to an SMS gateway, CHT couldn't determine if it was actually delivered to the recipient's phone. This made it impossible to:

1. Monitor SMS delivery success rates
2. Identify failed messages for retry
3. Provide visibility to health workers about message status
4. Debug messaging issues

## Root Cause

No message delivery status tracking existed in the codebase. The CouchDB views didn't index messages by state, and the API had no endpoints to query or update message states.

## Solution

Implemented comprehensive message delivery status tracking:

1. **Added state tracking to views**: Updated `lib/views.js` to index messages by state and timestamp:
   ```javascript
   emit([task.state, when], val);
   emit(task.state, val);
   ```
2. **Created API endpoints**:
   - `GET /api/v1/messages/:id` - Get single message by ID
   - `PUT /api/v1/messages/state/:id` - Update message state
3. **Added state management**: API uses `sms-gateway.js` controller internally to update states (line 47)
4. **Implemented sorting**: Messages sorted by due date for oldest-first processing
5. **Added integration tests**: Comprehensive test coverage for state transitions

## Code Patterns

- Use compound keys in CouchDB views for state-based queries: `emit([task.state, when], val)`
- Pattern: Keep timestamp in view values for sorting results by age
- Pattern: `api/controllers/sms-gateway.js` handles state updates from gateway callbacks
- Pattern: Views support both specific message lookup (`emit(msg.uuid, val)`) and state queries
- Use string keys instead of array keys for better CouchDB performance
- Maintain backward compatibility with existing API contracts

## Design Choices

Kept the `when` (timestamp) value in views because:
- Enables sorting by age to process oldest messages first
- Critical for FIFO message processing
- Allows time-based queries and reporting
- API documentation states "Returns list of messages, oldest first based on timestamp or due date"

Chose to emit both compound key and simple key for flexibility:
- Compound key `[state, when]` for sorted queries
- Simple key `state` for filtering by state only

## Related Files

- lib/views.js (CouchDB view definitions)
- api/controllers/sms-gateway.js
- api/db-pouch.js

## Testing

- Added integration tests for message state updates
- Added e2e tests for state tracking flow
- Tested view queries for state-based filtering
- Verified API endpoints return correct states

## Related Issues

- #3073: Original issue for gateway message delivery statuses
- #7105: Message delivery monitoring (builds on this foundation)
