---
id: cht-core-8160
category: bug
domain: interoperability
subDomain: outbound-reliability
issueNumber: 8160
issueUrl: https://github.com/medic/cht-core/issues/8160
title: Duplicate outbound requests are sent when a document matches multiple config options
lastUpdated: 2023-05-18
summary: The outbound push schedule process would sometimes crash when multiple simultaneous outbound processes attempted to write state to the same infodoc concurrently. The logic was updated in PR #8231 to use infinite document-update retries via recursion when saving infodocs within the outbound service.
services:
  - sentinel
techStack:
  - javascript
  - nodejs
  - couchdb
---

## Problem
In environments with heavy out-going traffic, concurrent outbound push tasks trying to process different triggers on the same source document simultaneously caused a problem. When a webhook or OpenHIM mediator is successfully triggered, the CHT's sentinel service writes an update to the underlying infodoc to mark the task complete for that payload. However, concurrent writes from parallel outgoing requests caused CouchDB 409 Document update conflict errors. The existing single-retry implementation was insufficient, and the outbound process would fail and the task document would get stuck.

## Root Cause
Prior to the fix, singlePush in sentinel/src/schedule/outbound.js would do a db.sentinel.put(infoDoc) after successfully pushing data via the outbound.send() helper. If it got a 409, it would fetch fresh and retry once. If CouchDB rejected the second put too because another concurrent webhook was completing, the error propagated, leaving the outbound task un-cleaned.

## Solution
Instead of explicitly handling raw CouchDB insert calls and limited retries, the Sentinel outbound process was refactored in PR #8231 to leverage the shared infodocLib engine. infodocLib added a saveCompletedTasks helper, which under the hood uses recursion (saveProperty) to retry infinitely: if a HTTP 409 conflict fires, the exact infodoc state is refreshed from the database, the specific outbound update payload is re-applied over it, and saved again until successful.

## Code Patterns
*   Delegating document state management: Outbound moved away from handling the infoDoc .put() call manually. Instead of db.sentinel.put(infoDoc) inside of outbound.js, it delegates exclusively to infodocLib.saveCompletedTasks(medicDoc._id, infoDoc).
*   Idempotent State Management (completed_tasks): The data sent to saveCompletedTasks provides the infodoc to extract completed_tasks from. The recursive saveProperty helper safely merges that.

## Design Choices
*   Infinite Retries for Critical State: infodoc updates regarding outbound completion use a recursive 409 retry loop with no backoff or limit. This tradeoff accepts that the worker node might poll and merge under severe pressure, but ensures we never lose the state flag.
*   Centralizing Infodoc Logic: Pushing this into shared-libs/infodoc prevents sentinel/src/schedule/outbound.js from diverging in how it treats CouchDB 409 errors.

## Related Files
*   sentinel/src/schedule/outbound.js
*   shared-libs/infodoc/src/infodoc.js
*   sentinel/tests/unit/schedule/outbound.spec.js
*   shared-libs/infodoc/test/infodoc.spec.js

## Testing
*   The sentinel/tests/unit/schedule/outbound.spec.js mocks were updated in PR #8231. The mock db.sentinel.put assertions were replaced with infodocLib.saveCompletedTasks stubs.
*   Integration test coverage (tests/integration/sentinel/schedules/outbound.spec.js) was added to ensure multiple concurrent infodoc updates succeed without a 409 error crashing the test runner.

## Related Issues
*   Closes #8160 (DB conflicts on outbound push) 
*   Refines earlier outbound stability work (#5842)
