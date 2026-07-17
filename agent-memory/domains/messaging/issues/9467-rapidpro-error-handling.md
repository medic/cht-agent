---
id: cht-core-9467
category: bug
domain: messaging
subDomain: rapidpro
issueNumber: 9467
issueUrl: https://github.com/medic/cht-core/issues/9467
title: RapidPro API changes result in mishandling of errors
lastUpdated: '2026-07-16'
source_prs:
  - "medic/cht-core#9559"
summary: Fixed error handling for RapidPro SMS gateway when it returns 400 errors for invalid phone numbers, preventing infinite message retry loops.
services:
  - api
techStack:
  - javascript
  - nodejs
---

## Problem

When RapidPro SMS gateway responded with a 400 error for invalid phone numbers (e.g., missing country codes), the CHT API didn't handle the error properly. Instead of marking the message as failed, the system:

1. Continuously retried sending the same message over and over
2. Threw `StatusCodeError: 400 - {"urns":{"0":["Invalid URN: tel:********. Ensure phone numbers contain country codes."]}}`
3. Then crashed with `TypeError: Cannot read property 'state' of undefined` at `getStateUpdate()` in `rapidpro.js:79`

This caused message flooding and filled logs with repeated errors. One deployment reported needing to manually clear 62,000 scheduled messages.

Separately, a distinct duplication facet: when the RapidPro `api/v2/broadcast` endpoint returned a 200 *without* a status update, valid messages were re-sent and duplicated in TextIt/RapidPro (PR #9559; forum report t/4047/19).

## Root Cause

The RapidPro service code expected the API to always return a response with a `state` field indicating message status. However, when RapidPro encountered validation errors (like invalid phone numbers), it returned a 400 error with a different JSON structure containing `urns` validation errors instead of the expected `state` field.

The code at `rapidpro.js:79` tried to access `response.state` without checking if `response` was defined or if the request had failed, causing `Cannot read property 'state' of undefined`.

## Solution

Updated the RapidPro error handling to:

1. Catch 400-level HTTP errors from RapidPro API
2. Parse the error response structure (which contains `urns` validation errors)
3. Mark the message as `failed` instead of leaving it in a retryable state
4. Log the validation error clearly for debugging
5. Prevent further retry attempts for messages with invalid recipient phone numbers

The fix ensures that when RapidPro returns validation errors, the message transitions to a failed state rather than remaining in scheduled/pending state and being retried indefinitely.

For the duplication facet, a 200 broadcast response lacking an explicit status update is mapped to `queued` (rather than being treated as unsent), which prevents re-broadcasting while still allowing a later status update to arrive (PR #9559).

## Code Patterns

- Always check HTTP status codes before accessing response body fields
- Handle validation errors (400) differently from server errors (500)
- Pattern: Check if response exists before accessing properties like `response.state`
- File: `api/src/services/rapidpro.js` contains the RapidPro integration logic
- Use try-catch blocks around external API calls with proper error type checking
- Mark messages as failed when recipient validation fails, not when infrastructure errors occur

## Design Choices

Chose to mark messages as failed rather than retrying because:
- Phone number validation errors won't resolve on retry
- Prevents message flooding and system overload
- Allows operators to identify and fix the root cause (invalid phone numbers)
- Aligns with RapidPro's documented behavior for invalid URNs
- Reduces manual intervention needed to clear stuck messages

## Related Files

- api/src/services/rapidpro.js
- api/tests/mocha/services/rapidpro.spec.js
- tests/e2e/default/sms/rapidpro.wdio-spec.js (PR #9559)

## Testing

- Added unit tests for 400 error handling from RapidPro
- Tested with invalid phone numbers to verify messages transition to failed state
- Verified no infinite retry loops occur
- Tested error logging to ensure validation errors are clearly reported
- End-to-end coverage added/updated for the 200-without-status → queued behavior (PR #9559, tests/e2e/default/sms/rapidpro.wdio-spec.js)

## Related Issues

- #10428: Send message state clearing improvement
- #9559: fix(#9467): better handling of RapidPro error codes
- Forum discussion: https://forum.communityhealthtoolkit.org/t/duplication-of-messages-in-text-it/4047/6
