---
id: cht-core-4374
category: bug
domain: messaging
subDomain: sms-gateway
issueNumber: 4374
issueUrl: https://github.com/medic/cht-core/issues/4374
title: Refuse duplicate webapp-terminating SMS messages in SMS gateway endpoint
lastUpdated: 2018-04-05
summary: Fixed SMS gateway endpoint to reject duplicate incoming messages, preventing the same SMS from being processed multiple times and creating duplicate records.
services:
  - api
techStack:
  - javascript
  - nodejs
  - couchdb
---

## Problem

The SMS gateway endpoint accepted duplicate messages, causing the same incoming SMS to be processed multiple times. This led to:

1. Duplicate contact messages in the database
2. Duplicate form submissions from SMS
3. Confusion for health workers seeing repeated messages
4. Wasted storage and processing resources

When SMS gateways retried message delivery (due to network issues or timeouts), CHT would create new records instead of recognizing the duplicates.

## Root Cause

The SMS gateway endpoint (`api/src/controllers/sms-gateway.js`) did not check for duplicate messages before processing. It accepted every incoming message without verifying if an identical message (same sender, same content, same timestamp) had already been processed.

## Solution

Added duplicate detection logic to the SMS gateway endpoint:

1. **Generate message fingerprint**: Created a hash based on sender phone, message content, and timestamp
2. **Check for existing messages**: Before processing, query the database for messages with the same fingerprint
3. **Reject duplicates**: If a matching message exists, return success (to satisfy the gateway) but don't create a new record
4. **Log duplicate attempts**: Added logging to track duplicate message attempts for debugging

The fix ensures idempotent message processing - the same message can be sent multiple times by the gateway but will only be recorded once.

## Code Patterns

- Use content hashing for duplicate detection: `hash(sender + content + timestamp)`
- Check before write pattern: Query for existing records before creating new ones
- Return 200 for duplicates to prevent gateway retries while avoiding duplicate processing
- Pattern: `if (await isDuplicate(message)) { return res.sendStatus(200); }`
- File: `api/src/controllers/sms-gateway.js` handles incoming SMS from gateways
- File: `api/src/services/sms.js` contains message processing logic

## Design Choices

Chose to use content hashing rather than storing message IDs because:
- Some gateways don't provide unique message IDs
- Hash-based detection works across different gateway providers
- Handles cases where the same message is sent through different gateways
- More robust than relying on external ID systems

## Related Files

- api/src/controllers/sms-gateway.js
- api/src/services/sms.js
- api/tests/mocha/controllers/sms-gateway.spec.js

## Testing

- Added unit tests for duplicate detection logic
- Tested with identical messages sent multiple times
- Tested with similar but not identical messages (should not be treated as duplicates)
- Verified gateway receives 200 response for duplicates

## Related Issues

- #4355: Tests for bad SMS gateway status updates
- #4278: Tests for SMS gateway API endpoint
- #4349: Don't save duplicates in SMS API (related fix)
