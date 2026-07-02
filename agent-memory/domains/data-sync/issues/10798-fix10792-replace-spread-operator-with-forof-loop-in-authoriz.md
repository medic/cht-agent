---
id: cht-core-10792
category: bug
domain: data-sync
domainFit: strong
issueNumber: 10792
issueUrl: https://github.com/medic/cht-core/issues/10792
title: Replace spread-operator push with for..of loop in authorization service to fix replication get-ids 500s for users with >150k documents
lastUpdated: '2026-06-22'
summary: Offline users with more than ~150,000 documents could not sync because `api/replication/get-ids` threw a RangeError when the authorization service pushed the allowed-doc-id list with a spread operator. The fix swaps the spread pushes for explicit for..of loops so arbitrarily large id arrays no longer overflow the call stack.
services:
  - api
techStack:
  - javascript
  - nodejs
  - couchdb
  - pouchdb
  - webdriverio
tags:
  - replication
  - authorization
  - scalability
  - spread-operator
  - rangeerror
  - offline-sync
  - get-ids
  - large-arrays
related_workflows: []
source_pr: medic/cht-core#10798
source_sha: 5aafe0e82a80dfeec7c9f4fb29b84b9ff949c09a
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - api/src/services/authorization.js
concepts:
  - offline-first replication
  - authorization document-id filtering
  - JavaScript call-stack / argument-count limits
  - large-array accumulation
related_issues: []
stale: false
---

## Problem

Offline users at facility level (no replication depth) in large CHT 5.x deployments could not sync. With more than ~150,000 authorized documents, `api/replication/get-ids` returned HTTP 500 with 'RangeError: Maximum call stack size exceeded'. Reproduced by creating such an offline user and attempting to sync, which errored out.

## Root Cause

The authorization service assembled the list of replicable document ids using spread-operator pushes (e.g. `target.push(...ids)`). Spreading passes every array element as a separate function argument, so on arrays of order 10^5 elements it exceeds the JS engine's maximum argument count / call-stack size and throws RangeError. The same throw is demonstrated by `[].push(...Array.from({ length: 130000 }))` in issue #10792.

## Solution

In api/src/services/authorization.js the spread-operator pushes were replaced with explicit `for..of` loops that push one element per iteration. Iterating element-by-element has no argument-count/call-stack ceiling, so get-ids can now return very large id arrays without overflowing the stack and sync succeeds for high-document-count users.

## Code Patterns

Never use spread push (`target.push(...largeArray)`) for arrays that may grow large — each element becomes a separate function argument and overflows the call stack at ~10^5 elements. Accumulate with a loop instead: `for (const item of largeArray) { target.push(item); }` (or use `concat`/batched chunks). Pattern applied in api/src/services/authorization.js.

## Design Choices

A for..of loop was chosen over batched/chunked spread pushes or Array.concat because it is the minimal, allocation-light change that removes the call-stack limit while preserving the existing accumulator semantics. Chunked spreading would also avoid the limit but adds tuning/complexity; the loop is the clearest and most obviously correct fix.

## Related Files

- api/src/services/authorization.js
- tests/e2e/default/analytics/analytics.wdio-spec.js
- tests/e2e/default/tasks/tasks.wdio-spec.js
- package.json
- package-lock.json

## Testing

Two e2e WebdriverIO specs were touched (tests/e2e/default/analytics/analytics.wdio-spec.js and tests/e2e/default/tasks/tasks.wdio-spec.js), and package.json/package-lock.json were updated (accompanying dependency change). The defect is a scale condition (>150k docs) that is hard to assert in a unit test, so verification leans on the existing e2e suites exercising replication/sync paths rather than a dedicated large-array regression test. This is a cherry-pick onto the 5.0.x branch (from commit 97e3d45).

## Related Issues

- #10792: api/replication/get-ids returns 500 with 'RangeError: Maximum call stack size exceeded' for offline users with more than ~150,000 documents, breaking sync

## Domain Rationale

**Fit:** strong

The failure surfaces on the `api/replication/get-ids` endpoint and the user-facing symptom is that offline users cannot sync — squarely a replication/sync concern (cf. seed #4: sync failures are data-sync even when another subsystem is the surface). The code lives in the authorization service (`authorization.js`), which could tempt an authentication binning, but the bug is a scaling defect in how replicable doc IDs are assembled, not a permissions/roles problem; a reviewer who bins by owning subsystem could re-file under authentication.
