---
id: cht-core-10792
category: bug
domain: data-sync
domainFit: strong
issueNumber: 10792
issueUrl: https://github.com/medic/cht-core/issues/10792
title: Replace spread-operator push with a for..of loop in the authorization service to fix replication get-ids crash for offline users with very large doc-id arrays
lastUpdated: '2026-06-22'
summary: Offline users with more than ~150,000 replicable documents got an HTTP 500 from api/replication/get-ids and could not sync because pushing a huge array via the spread operator throws a RangeError (max call stack exceeded); fixed by replacing the spread push with an iterative for..of loop.
services:
  - api
techStack:
  - javascript
  - nodejs
  - couchdb
  - webdriverio
tags:
  - replication
  - offline-users
  - spread-operator
  - rangeerror
  - scalability
  - get-ids
  - array-push
  - call-stack-limit
related_workflows: []
source_pr: medic/cht-core#10799
source_sha: e2b27d329e03536507c62ba64a4bcb14b7b28a7e
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - api/src/services/authorization.js
concepts:
  - selective offline document replication
  - authorization-driven doc-id computation
  - JavaScript spread/argument-count call-stack limit
  - unbounded array accumulation
related_issues: []
stale: false
---

## Problem

Offline users with more than ~150,000 replicable documents (e.g., a facility-level user with no replication depth limit on a large 5.x deployment) received an HTTP 500 from api/replication/get-ids and could not sync. The underlying error was 'RangeError: Maximum call stack size exceeded', reproducible via patterns like [].push(...Array.from({length: 130000})).

## Root Cause

The authorization service assembled the list of allowed document IDs using Array.prototype.push with the spread operator (arr.push(...bigArray)). Spreading expands each array element into a separate function argument, and the V8 engine enforces a maximum argument/call-stack count (~10^5); with well over 100k elements the call throws RangeError: Maximum call stack size exceeded, crashing the get-ids request and the user's sync.

## Solution

In api/src/services/authorization.js the spread-operator push was replaced with a plain for..of loop that appends one element at a time, so arbitrarily large doc-id arrays are accumulated with constant call-stack usage and no argument-count ceiling. The change also bumped dependencies (package.json/package-lock.json) and adjusted a few e2e specs. The fix was cherry-picked (from commit 97e3d45) onto the 5.1.x release line.

## Code Patterns

Never use `arr.push(...largeArray)` (or Function.prototype.apply with a large array) on arrays that can grow unbounded — each element becomes a separate call argument and exceeds the JS engine's max-arguments/stack limit (~10^5 elements). Instead iterate: `for (const x of source) { target.push(x); }`. Reference: api/src/services/authorization.js.

## Design Choices

A for..of loop was chosen over chunked spread pushes or `target = target.concat(source)`: it is O(n) with constant stack usage, allocates no intermediate arrays, and is the minimal safe change. Chunked spreads still risk the limit if a chunk is large and add branching complexity; concat creates new arrays and extra GC pressure on already-large datasets.

## Related Files

- api/src/services/authorization.js
- package.json
- package-lock.json
- tests/e2e/default/targets/analytics.wdio-spec.js
- tests/e2e/default/tasks/tasks.wdio-spec.js
- tests/e2e/default-mobile/old-navigation/old-navigation.wdio-spec.js

## Testing

Several WebdriverIO e2e specs were touched (default/targets/analytics, default/tasks, default-mobile/old-navigation/old-navigation). The changed-file set does not show a dedicated unit test reproducing the >150k-doc RangeError; the fix is a direct, low-risk iterative replacement of the spread push, validated primarily through the existing/adjusted e2e suites and the reproduction described in the linked issue.

## Related Issues

- #10792: api/replication/get-ids returns 500 (RangeError: Maximum call stack size exceeded) for offline users with more than 150,000 documents, causing sync to fail

## Domain Rationale

**Fit:** strong

Although the file is named authorization.js, its role is computing the set of document IDs replicated to offline users, and the bug manifests as a 500 from the api/replication/get-ids endpoint that breaks sync — per the guidance that sync/replication failures belong to data-sync rather than the surface that triggered them.
