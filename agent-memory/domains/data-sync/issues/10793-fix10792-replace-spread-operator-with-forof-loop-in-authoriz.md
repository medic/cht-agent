---
id: cht-core-10792
category: bug
domain: data-sync
domainFit: strong
issueNumber: 10792
issueUrl: https://github.com/medic/cht-core/issues/10792
title: Replace spread-operator Array.push with a for..of loop in the authorization service to fix replication get-ids failure for users with >150k docs
lastUpdated: '2026-06-22'
summary: Offline users with more than ~150,000 replicable documents got a 500 from `api/replication/get-ids` because `Array.push(...spread)` throws a RangeError (max call stack exceeded) on very large arrays. The fix replaces the spread-based push with a for..of loop that appends elements one at a time.
services:
  - api
techStack:
  - javascript
  - nodejs
  - couchdb
  - pouchdb
tags:
  - replication
  - get-ids
  - rangerror
  - call-stack
  - spread-operator
  - array-push
  - scalability
  - offline-users
  - 500-error
related_workflows: []
source_pr: medic/cht-core#10793
source_sha: 97e3d45456613262c3e27ccb4816399e5c7e9709
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - api/src/services/authorization.js
concepts:
  - document replication
  - allowed-doc-ids computation
  - offline-first sync
  - JavaScript call-stack argument limits
  - large-array assembly
related_issues: []
stale: false
---

## Problem

Offline users at facility level (no replication depth) with more than ~150,000 documents to replicate received a 500 error from `GET api/replication/get-ids` and could not sync at all. The underlying failure is `RangeError: Maximum call stack size exceeded`, reproducible via `[].push(...Array.from({ length: 130000 }).map(() => 2))`. Observed on large CHT 5.x deployments.

## Root Cause

The authorization service appended doc IDs to an array using the spread operator (`array.push(...items)`). Each spread element becomes a separate function argument placed on the call stack, so once the source array reaches on the order of 130k+ elements the engine exceeds the maximum call-stack size and throws a RangeError, aborting the get-ids response with a 500.

## Solution

Replaced the spread-operator push with a `for..of` loop that pushes each element individually, removing the per-call argument-count limit so the doc-ID list scales to arbitrarily large sizes. The change is confined to `api/src/services/authorization.js`.

## Code Patterns

Never use `targetArray.push(...sourceArray)` (or spreading the result of `Array.from(...).map(...)`) when the source can be large — it puts every element on the call stack as an argument. Instead iterate: `for (const item of sourceArray) { targetArray.push(item); }`. Applies anywhere replication doc-ID lists or change sets are assembled in `api/src/services/authorization.js`.

## Design Choices

A for..of loop was chosen over chunked/batched spread pushes or `Array.prototype.concat` because it is the minimal change that eliminates the call-stack limit entirely with predictable memory behavior and no intermediate arrays.

## Related Files

- api/src/services/authorization.js

## Testing

Not evident from the PR: the diff lists only `api/src/services/authorization.js` with no accompanying test file, and the 'Tested' checklist item is unchecked. The triggering condition is directly reproducible with `[].push(...Array.from({ length: 130000 }).map(() => 2))`, and end-to-end via a large 5.x deployment syncing an offline facility-level user with >150k docs.

## Related Issues

- #10792: api/replication/get-ids returns 500 (RangeError: Maximum call stack size exceeded) for users with >150,000 documents because of spread-operator Array.push on a very large array

## Domain Rationale

**Fit:** strong

The bug lives in the authorization service but manifests in the `api/replication/get-ids` endpoint that assembles the doc-ID list an offline user must replicate; the user-facing symptom is sync failing entirely with a 500. Per the 'sync/replication failure trumps the surface component' rule (cf. Seed 4), replication is data-sync — a reviewer could re-bin to authentication since the code is the authz service, but the endpoint and failure mode are squarely replication.
