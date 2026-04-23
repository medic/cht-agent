---
id: cht-core-10801
category: bug
domain: messaging
subDomain: sms-gateway
issueNumber: 10801
issueUrl: https://github.com/medic/cht-core/issues/10801
title: SMS delivery confirmation not being recorded in system
lastUpdated: 2026-04-12
summary: SMS delivery confirmations were not being properly recorded in the system, causing messages to appear as permanently pending even after successful delivery to recipients.
services:
  - api
  - sms-gateway
techStack:
  - javascript
  - nodejs
  - couchdb
---

## Problem

Health workers were unable to see whether their SMS messages were actually delivered to patients. The system would show messages as perpetually "pending" even after successful delivery, leading to uncertainty about whether critical health information reached recipients. This affected appointment reminders, medication alerts, and emergency notifications.

## Root Cause

The SMS delivery confirmation handler in the API was failing silently when processing delivery receipts from the SMS gateway. The issue occurred because:
1. The handler was expecting a specific JSON format from the gateway but receiving a slightly different structure
2. Missing error handling caused the confirmation processing to fail without logging
3. The message status field was not being properly updated in the database
4. Race conditions between message sending and confirmation processing caused some confirmations to be lost

This meant delivery confirmations were received but not recorded, leaving messages in an incorrect state.

## Solution

Fixed the delivery confirmation processing system:
- Updated the confirmation handler to match the actual gateway response format
- Added comprehensive error handling and logging for confirmation processing
- Implemented idempotent confirmation processing to handle race conditions
- Added proper message status transitions (pending → sent → delivered)
- Created retry logic for failed confirmation processing
- Added monitoring for confirmation processing failures

The key improvement was making the confirmation handler resilient to format variations and processing failures.

## Code Patterns

- Always validate incoming data structures: `validateConfirmationFormat(receipt)`
- Use idempotent processing: `processConfirmationOnce(messageId, status)`
- Implement proper status transitions: `pending → sent → delivered → failed`
- Handle gateway format variations: `normalizeReceiptFormat(rawReceipt)`
- Pattern: `const confirmation = processDeliveryReceipt(receipt); if (confirmation.valid) updateMessageStatus(confirmation.messageId, confirmation.status);`
- File: `api/src/controllers/sms-confirmations.js` contains the core confirmation processing logic
- The fix ensures accurate message delivery tracking

## Design Choices

Chose to fix at the confirmation processing level rather than in the gateway interface because the issue was in how we handled the gateway responses. This approach ensures we can handle variations in gateway responses while maintaining reliable delivery tracking.

## Related Files

- api/src/controllers/sms-confirmations.js
- sms-gateway/src/handlers/delivery-receipt.js
- api/src/services/message-status-service.js
- test/unit/sms-confirmations.test.js

## Testing

- Added comprehensive tests for various confirmation receipt formats
- Tested idempotent processing with duplicate confirmations
- Verified status transitions work correctly
- Tested race condition scenarios
- Integration testing with actual SMS gateway confirmations

## Related Issues

- #10802: Message processing state management
- #10797: Message status updates not propagating
- Multiple SMS delivery and confirmation issues