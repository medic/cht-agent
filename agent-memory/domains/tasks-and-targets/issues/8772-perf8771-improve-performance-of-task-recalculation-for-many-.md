---
id: cht-core-8771
category: improvement
domain: tasks-and-targets
domainFit: strong
issueNumber: 8771
issueUrl: https://github.com/medic/cht-core/issues/8771
title: Improve task recalculation performance by short-circuiting large keyed PouchDB view queries
lastUpdated: '2026-08-01'
summary: Task recalculation for users with many contacts issued PouchDB view queries with thousands of keys, which took minutes and sometimes crashed PouchDB (IndexedDB). The fix short-circuits to fetching all rows and filtering them in memory when the key count reaches 500 (the guard bypasses only `length < MAX_QUERY_KEYS`), cutting average query time from ~283s to ~63s with no crashes.
services:
  - webapp
techStack:
  - javascript
  - pouchdb
  - couchdb
tags:
  - performance
  - rules-engine
  - task-recalculation
  - pouchdb
  - query-optimization
  - view-query
related_workflows:
  - task-scheduling
source_pr: medic/cht-core#8772
source_sha: 2c4745985cd1009785205bb0008bd88ad3808390
distilled_at: '2026-06-23'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - shared-libs/rules-engine/src/pouchdb-provider.js
concepts:
  - PouchDB map-reduce view querying
  - query strategy short-circuit / fallback
  - in-memory filtering
  - threshold-based optimization
  - task recalculation
related_issues: []
stale: false
---

## Problem

PouchDB is notoriously slow at querying views with a large number of keys. During task recalculation for users with large numbers of contacts, the keyed view queries became so heavy they took minutes to complete (~283s average) and sometimes crashed PouchDB / IndexedDB entirely.

## Root Cause

The pouchdb-provider issued a single view query passing all contact keys via the `keys` parameter. PouchDB handles large `keys` arrays very inefficiently, so as the number of contacts grew the query degraded to minutes-long runtimes and intermittent IndexedDB crashes.

## Solution

Added a `dbQuery(view, params)` wrapper in pouchdb-provider.js that every rules-engine view call now routes through. When `params.keys` is present and `params.keys.length >= MAX_QUERY_KEYS`, the wrapper deletes `params.keys`, runs the unkeyed query, and filters the returned rows against a `Set` of the original keys in memory. `MAX_QUERY_KEYS` is a hard-coded module-level constant set to 500 — it is not exported and not settings-driven, so changing it means editing the source.

## Code Patterns

Threshold-based query strategy switch in shared-libs/rules-engine/src/pouchdb-provider.js: when key count reaches a hard-coded `MAX_QUERY_KEYS` limit (500), abandon the `keys` query parameter and fetch-all-rows-then-filter client-side. Useful wherever PouchDB views are queried with potentially large key sets.

## Design Choices

Benchmarked three approaches at 6661 contacts / 10000 reports: keyed query (current, ~283s avg, 3 IDB crashes), fetch-all-rows + filter (chosen, ~63s avg, 0 crashes), and start_key + end_key range (~95s avg, 0 crashes). Fetch-all-rows + filter was selected as the fastest and crash-free option. The 500-key threshold was chosen because at ~10000 reports the all-rows fetch took roughly the same time as a 500-key query, making it the sensible switchover point.

## Related Files

- shared-libs/rules-engine/src/pouchdb-provider.js
- shared-libs/rules-engine/test/pouchdb-provider.spec.js

## Testing

Unit tests added/modified in shared-libs/rules-engine/test/pouchdb-provider.spec.js to cover the new short-circuit behavior. Performance was validated manually by benchmarking the three query strategies across multiple runs (6661 contacts, 10000 reports), documented in the PR description's comparison table.

## Related Issues

- #8771: Poor performance of task recalculation for users with many contacts, causing minutes-long queries and PouchDB crashes

## Domain Rationale

**Fit:** strong

The rules-engine is the core engine that computes tasks and targets, and this PR directly improves the performance of task recalculation. Although it touches PouchDB view-query internals (a data-layer concern), the functional purpose is task computation, making tasks-and-targets the closest and most principled functional domain rather than the data-sync data-layer bucket.
