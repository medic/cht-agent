---
id: cht-core-9467
category: bug
domain: messaging
subDomain: rapidpro
issueNumber: 9467
issueUrl: https://github.com/medic/cht-core/issues/9467
title: RapidPro API changes result in mishandling of errors
lastUpdated: '2026-07-30'
source_pr: medic/cht-core#9559
source_prs:
  - "medic/cht-core#9559"
source_sha: da4b50f71468b2576636e4c588c0c962c76689bc
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
3. Separately, on a 200 whose body carried no (or an unmapped) `status`, `remoteStatusToLocalState()` returned `undefined` and `getStateUpdate()` threw `TypeError: Cannot read property 'state' of undefined` at `rapidpro.js:79` (`state: status.state`). This is a different code path from the 400 above, which rejects into `.catch` and never reaches line 79.

This caused message flooding and filled logs with repeated errors.

Separately, a distinct duplication facet: when the RapidPro broadcasts endpoint (`/api/v2/broadcasts.json`) returned a 200 *without* a status update, valid messages were re-sent and duplicated in TextIt/RapidPro (PR #9559; forum report t/4047/19).

## Root Cause

The service read the RapidPro status as `result.status` and mapped it through `STATUS_MAP` (`const remoteStatusToLocalState = (result) => result.status && STATUS_MAP[result.status];`). Two independent failures followed:

- **400 (invalid URN):** `request.post` rejects, and the pre-fix `.catch` only logged (`// ignore error, sending the message will be retried later`) and returned `undefined`. Because `send()` pushes only truthy results, no state update was recorded and the task stayed in `pending`, so the next `checkDbForMessagesToSend` sweep — which queries `medic/messages_by_state` for the `pending-or-forwarded` key — picked the message up and re-sent it, unbounded.
- **200 without a usable `status`:** `remoteStatusToLocalState` returned `undefined`, so `getStateUpdate(undefined, ...)` threw at `api/src/services/rapidpro.js:79`, which is `state: status.state` — `status` is the STATUS_MAP entry, not an HTTP response. There is no `response.state` symbol anywhere in rapidpro.js.

## Solution

Updated the RapidPro error handling to:

1. In `sendMessage`'s existing `.catch`, test exactly `err?.statusCode === 400` (the added comment cites https://rapidpro.io/api/v2/ — "Do not retry with the same values"). `statusCode` is the property shape at the time of this fix; current master reads `err?.status === 400` (api/src/services/rapidpro.js:109), and the Testing bullet's `.rejects({ statusCode: 400 })` stub is of the same vintage
2. Return `getStateUpdate(STATUS_MAP.failed, message.id, undefined)` so the message becomes `state: 'failed'`, `details: 'Failed'`, with no gatewayRef — the error body (the `urns` validation detail) is never parsed, only logged verbatim by the pre-existing `logger.error('Error thrown when trying to send message: %o', err)` that was moved above the new branch
3. Once the task state is `failed` it no longer matches the `pending-or-forwarded` key of `medic/messages_by_state` that `getOutgoingMessages()` uses, so the outgoing sweep stops re-sending it; and because `STATUS_MAP.failed` carries `final: true`, it also drops out of `NON_FINAL_STATES` so the `gateway_messages_by_state` status poll skips it
4. Give the status mapper a default: `(result.status && STATUS_MAP[result.status]) || STATUS_MAP.queued`, so a 200 without a usable status no longer yields `undefined` (which threw in `getStateUpdate`) and no longer leaves the message eligible for re-broadcast

The fix ensures that when RapidPro returns validation errors, the message transitions to a failed state rather than remaining in scheduled/pending state and being retried indefinitely.

For the duplication facet, a 200 broadcast response lacking an explicit status update is mapped to `queued` (rather than being treated as unsent), which prevents re-broadcasting while still allowing a later status update to arrive (PR #9559).

## Code Patterns

- Always check HTTP status codes before accessing response body fields
- Handle validation errors (400) differently from server errors (500)
- Pattern: give a lookup/mapping helper a safe default (`(result.status && STATUS_MAP[result.status]) || STATUS_MAP.queued`) rather than guarding every consumer — `getStateUpdate()` then never receives `undefined`. The property actually dereferenced is `status.state`, where `status` is a STATUS_MAP entry, not an HTTP response.
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

- Extended the existing `it('should catch errors and handle empty results')` case in api/tests/mocha/services/rapidpro.spec.js with two stubs: a `request.post` that `.rejects({ statusCode: 400 })`, asserted to yield `{ messageId: 'five', gatewayRef: undefined, state: 'failed', details: 'Failed' }`; and one that resolves `{ id: 'broadcast6' }` with no `status`, asserted to yield `{ messageId: 'six', gatewayRef: 'broadcast6', state: 'received-by-gateway', details: 'Queued' }` (post callCount 4 -> 6). The stub is a bare status code — no invalid-phone-number payload, no logging assertion, and no retry-loop test were added, and no new `it(...)` block was created.
- End-to-end coverage extended in tests/e2e/default/sms/rapidpro.wdio-spec.js: a 6th pending scheduled message with an `undefined` broadcast status, asserted to land on `received-by-gateway` (`verifyGatewayRefAndState(report.scheduled_tasks[3], 'broadcast6', 'received-by-gateway')`).

## Related Issues

- #10428: Send message state clearing improvement
- PR #9559: fix(#9467): better handling of RapidPro error codes
- Forum discussion: https://forum.communityhealthtoolkit.org/t/duplication-of-messages-in-text-it/4047/6
