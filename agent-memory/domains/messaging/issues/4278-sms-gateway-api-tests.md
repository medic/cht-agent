---
id: cht-core-3738
category: improvement
domain: messaging
subDomain: sms-gateway
issueNumber: 3738
issueUrl: https://github.com/medic/cht-core/issues/3738
title: Add tests for SMS gateway API endpoint
lastUpdated: '2026-07-30'
source_pr: medic/cht-core#4278
source_prs:
  - "medic/cht-core#4278"
source_sha: d88f2e256ce684e17b07ead0531fc68f7a9630d5
summary: Added comprehensive tests for the SMS gateway API endpoint to verify message receiving, validation, and storage functionality.
services:
  - api
techStack:
  - javascript
  - nodejs
---

## Problem

The SMS gateway API endpoint had unit coverage and incidental browser-driven coverage, but no dedicated API-level e2e suite asserting the request/response contract and resulting database state, making it risky to modify or extend. The risk areas that suite could regress on were:

1. Message receiving and parsing
2. Phone number validation
3. Message storage
4. Error handling for invalid content
5. Duplicate message detection

## Root Cause

The SMS gateway endpoint (`api/controllers/sms-gateway.js` — the `api/src/` layout postdates this change) was not untested: `api/tests/unit/controllers/sms-gateway.js` covered it at the unit level, and `tests/protractor/e2e/sms-gateway.js` already POSTed to `/api/sms` as part of browser-driven UI assertions. What was missing was a dedicated API-level e2e suite asserting the `/api/sms` request/response contract and the resulting database state on their own, which made the endpoint risky to modify or extend.

## Solution

Added comprehensive test suite for SMS gateway API endpoint:

1. **Created e2e tests**: Added tests in `tests/protractor/e2e/api/controllers/sms-gateway.spec.js`
2. **Implemented polling mechanism**: Used polling with 100ms intervals to wait for async operations, re-running the view query behind `allMessageDocs()`:
   ```javascript
   function allMessageDocs() {
     return utils.db.query('medic-client/messages_by_contact_date',
         { reduce:false, include_docs:true })
       .then(res => res.rows.map(row => row.doc));
   }
   ```
3. **Polled a view, not a changes listener**: `allMessageDocs()` reads `medic-client/messages_by_contact_date` with `{ reduce: false, include_docs: true }` and maps `res.rows` to docs; no CouchDB changes listener is used
4. **Tested message flow**: Verified messages sent to gateway endpoint are properly stored in database

## Code Patterns

Note on paths: every path below is as of this 2018 change and none survives on current master. The `api/src/` layout postdates it, so the endpoint was `api/controllers/sms-gateway.js` with unit coverage at `api/tests/unit/controllers/sms-gateway.js`; and e2e suites lived under `tests/protractor/` before the WebdriverIO migration moved them to `tests/e2e/`, so both `tests/protractor/e2e/sms-gateway.js` and the spec this PR added, `tests/protractor/e2e/api/controllers/sms-gateway.spec.js`, are gone. The polling pattern below is the durable part; the locations are not.

- Use polling with timeout for async test assertions (100ms intervals)
- Pattern: after the API call, poll the view in a `check()` loop until the expected snapshot matches or a 10s deadline expires, then resolve/reject
- Pattern: Use `utils.db.query()` to verify database state after API calls
- Pattern: `tests/protractor/e2e/api/controllers/sms-gateway.spec.js` for e2e API tests
- Use JSON comparison for deep equality checks: `JSON.stringify(actual) === JSON.stringify(expected)`
- Set reasonable timeouts (10s) for async operations to complete

## Design Choices

Chose to poll a view rather than register a changes listener:
- `allMessageDocs()` queries the `medic-client/messages_by_contact_date` view with `{ reduce: false, include_docs: true }` and maps `res.rows` to docs
- `expectMessagesInDb` and `expectMessageStates` re-run that query via `setTimeout(check, 100)` until the JSON-stringified actual snapshot equals the expected one, or a 10s deadline (`const endTime = Date.now() + 10000`) expires, at which point they reject with an expected/actual diff

No CouchDB changes listener is registered anywhere in the spec.

## Related Files

- tests/protractor/e2e/api/controllers/sms-gateway.spec.js (added; the protractor tree was later replaced by tests/e2e/)
- api/controllers/sms-gateway.js (the endpoint under test; not modified — this commit adds only the spec)

## Testing

- Added e2e tests for SMS gateway endpoint
- Tested message receiving and storage

## Related Issues

- #3738: Original issue for SMS gateway testing
- PR #4374: Refuse duplicate SMS messages (builds on these tests)
- PR #4349: Don't save duplicates in SMS API (related improvements)
