---
id: cht-core-6306
category: improvement
domain: interoperability
subDomain: outbound-push
issueNumber: 6306
issueUrl: https://github.com/medic/cht-core/issues/6306
title: Send outbound push without delay
lastUpdated: 2020-05-19
summary: Sentinel's outbound push ran on a fixed 5-minute scheduler, causing unacceptable latency for RapidPro messaging and VMMC workflows. PR #6372 (shipped in CHT 3.9.0) solved this by running outbound as both a transition and a scheduler — the transition attempts the push immediately when a document is processed, while the scheduler retries on a fixed interval if the first attempt fails.
services:
  - sentinel
techStack:
  - javascript
  - nodejs
---

## Problem

Sentinel's outbound push ran on a fixed schedule every five minutes. For workflows that depend on near-real-time messaging — such as triggering a RapidPro SMS workflow the moment a CHW submits a report, or phone-number verification for VMMC workflows — a five-minute delay was unacceptable. At least four funded deployments (COVID response, VMMC in Zimbabwe and South Africa) were blocked on this. Manually reducing the scheduler interval below 2 minutes caused errors and outbound pushes stopped working; setting it to 1 minute caused outright failures.

## Root Cause

The outbound push system was implemented as a pure polling scheduler in `sentinel/src/schedule/outbound.js`. There was no mechanism to trigger an attempt when a document was first processed by sentinel's transition pipeline — every push had to wait for the next scheduler tick, regardless of how time-sensitive the integration was.

## Solution

PR #6372 (merged May 19, 2020, shipped in 3.9.0) refactored outbound push to run as **both a transition and a scheduler**:

1. **Transition (immediate path)**: When sentinel processes a document and passes `relevant_to`, the outbound push is attempted immediately in-process, before the scheduler next runs. On success, the `-info` doc is updated in the same way the scheduler does (recording the sent state). On failure for any reason (bad config, server down, timeout), the transition succeeds and moves on — but a task is created in the queue for retry.

2. **Scheduler (retry path)**: The scheduler continues to run on its default 5-minute interval. It processes any queued tasks (those that failed the immediate attempt) and retries them until they succeed.

This required extracting the outbound push logic from the scheduler into a shared location callable by both the transition pipeline and the scheduler.

Additionally, this PR introduced the **send-once per record/config** semantic: outbound messages only send once per `(document, outbound-config-key)` combination regardless of later edits to the document. This was a deliberate simplification to avoid sending on every sentinel write. (This behavior was later made configurable in #6419.)

## Code Patterns

- The outbound logic was extracted from `sentinel/src/schedule/outbound.js` so it can be called by the `mark_for_outbound` transition in `shared-libs/transitions/src/transitions/mark_for_outbound.js`
- The immediate push path runs inside `mark_for_outbound`; the scheduler path runs in `sentinel/src/schedule/outbound.js` — both call the same underlying send logic
- On failure in the transition, the code creates a queue entry in the `-info` doc and returns success (does not throw), so sentinel continues processing other transitions
- The send-once state is tracked per `(doc._id, outbound-config-key)` in the `-info` doc; on the next scheduler run, already-pushed docs are skipped

## Design Choices

- Chose transition + scheduler (dual-path) rather than just reducing the scheduler interval: lowering the interval caused server load issues and errors at <2 minutes; the transition path has no such constraint since it runs once per document change
- The scheduler was kept at 5 minutes rather than removed: it handles retries for failed immediate attempts (server down, transient errors) and is the appropriate mechanism for delayed/retry scenarios
- Send-once semantics were introduced alongside this change to prevent the immediate path from firing on every sentinel write to the same document; configurers who need re-send behavior should use the `cron`-scheduled approach or wait for #6419

## Related Files

- sentinel/src/schedule/outbound.js
- shared-libs/transitions/src/transitions/mark_for_outbound.js
- sentinel/tests/mocha/schedule/outbound.spec.js

## Testing

- AT confirmed on desktop browser and Android app (by @brad1905 on May 19, 2020) before merge
- Verified: outbound push attempts immediately when a document passes `relevant_to`, without waiting for the scheduler
- Verified: on failure (server down), a task is created and retried on the next scheduler run at 5 minutes
- Verified: subsequent edits to the same document do not re-trigger an outbound push (send-once semantics)

## Related Issues

- #6419: Allow configuring outbound to send the same record multiple times (the send-once behavior introduced here was later revisited)
- #6339: Provide an API endpoint for fetching a contact by phone number (complementary inbound integration for RapidPro)
- #6024: The outbound error response logging is needlessly verbose (raised during testing of this feature)
