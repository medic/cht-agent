---
id: cht-core-4278
category: improvement
domain: messaging
subDomain: sms-gateway
issueNumber: 4278
issueUrl: https://github.com/medic/cht-core/issues/4278
title: Add tests for SMS gateway API endpoint
lastUpdated: 2018-03-11
summary: Added comprehensive tests for the SMS gateway API endpoint to verify message receiving, validation, and storage functionality.
services:
  - api
techStack:
  - javascript
  - nodejs
---

## Problem

The SMS gateway API endpoint had no test coverage, making it risky to modify or extend. Without tests, bugs could be introduced in:

1. Message receiving and parsing
2. Phone number validation
3. Message storage
4. Error handling for invalid content
5. Duplicate message detection

## Root Cause

The SMS gateway endpoint (`api/src/controllers/sms-gateway.js`) was implemented without corresponding tests. This violated testing best practices and made the codebase fragile.

## Solution

Added comprehensive test suite for SMS gateway API endpoint:

1. **Created e2e tests**: Added tests in `tests/protractor/e2e/api/controllers/sms-gateway.spec.js`
2. **Implemented polling mechanism**: Used polling with 100ms intervals to wait for async operations:
   ```javascript
   function check() {
     utils.db.query('medic-client/messages_by_contact_date', { reduce: false })
     // ... assertion logic
   }
   ```
3. **Used changes listener approach**: Registered CouchDB changes listener to capture documents created by endpoint calls
4. **Tested message flow**: Verified messages sent to gateway endpoint are properly stored in database
5. **Validated error handling**: Tested endpoint behavior with invalid content

## Code Patterns

- Use polling with timeout for async test assertions (100ms intervals)
- Pattern: Register changes listener before API call to capture resulting documents
- Pattern: Use `utils.db.query()` to verify database state after API calls
- Pattern: `tests/protractor/e2e/api/controllers/sms-gateway.spec.js` for e2e API tests
- Use JSON comparison for deep equality checks: `JSON.stringify(actual) === JSON.stringify(expected)`
- Set reasonable timeouts (10s) for async operations to complete

## Design Choices

Chose changes listener approach over view polling because:
- Independent of view implementation (views can change without breaking tests)
- More reliable than polling views that might be refactored
- Captures documents directly as they're created
- Faster than waiting for view index updates

Reviewer (@garethbowen) specifically requested: "The best way may be to register a changes listener including docs before the endpoint is called and then assert the docs come through there within 10s"

## Related Files

- tests/protractor/e2e/api/controllers/sms-gateway.spec.js
- api/src/controllers/sms-gateway.js

## Testing

- Added e2e tests for SMS gateway endpoint
- Tested message receiving and storage
- Verified error handling for invalid content
- Tested with valid and invalid phone numbers
- Confirmed endpoint returns correct HTTP status codes

## Related Issues

- #3738: Original issue for SMS gateway testing
- #4374: Refuse duplicate SMS messages (builds on these tests)
- #4349: Don't save duplicates in SMS API (related improvements)
