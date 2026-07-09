---
id: cht-core-10398
category: improvement
domain: data-sync
domainFit: strong
issueNumber: 10398
issueUrl: https://github.com/medic/cht-core/issues/10398
title: Store pre-purge document counts per user in the replication limit log
lastUpdated: '2026-06-22'
summary: The replication limit log only stored post-purge doc counts, giving no visibility into pre-purge counts that drive server-side replication performance. The change passes and stores the pre-purge count and persists a new log entry when it changes by more than 100.
services:
  - api
techStack:
  - javascript
  - nodejs
  - couchdb
  - mocha
tags:
  - replication
  - doc-counts
  - purging
  - logging
  - performance-monitoring
  - medic-logs
  - observability
related_workflows:
  - observability
source_pr: medic/cht-core#10511
source_sha: 63eb9ae0840c7be1bd110a86723677c2786cf780
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - api/src/services/replication-limit-log.js
  - api/src/services/replication.js
concepts:
  - replication limit logging
  - document purging
  - doc-count performance tracking
  - observability/log persistence thresholds
related_issues: []
stale: false
---

## Problem

The replication limit log stored only post-purge document counts per user. There was no visibility into pre-purge doc counts, a number that impacts server-side replication performance, making it hard to assess the performance impact of large user document sets before purge filtering.

## Root Cause

The replication-limit-log service only received and stored the post-purge document count; replication.js never passed the pre-purge count (allowedIds.length) to the logging service, so it was never recorded in the medic-logs document.

## Solution

replication.js now passes allowedIds.length (the pre-purge count) to the logging service. replication-limit-log.js accepts a new prePurgeCount argument, stores it in the medic-logs document, and treats a significant change in prePurgeCount (diff > 100) as a trigger to persist a new log entry.

## Code Patterns

Threshold-based log persistence: only write a new medic-logs entry when the tracked count changes beyond a fixed delta (diff > 100), avoiding churn from minor fluctuations — in api/src/services/replication-limit-log.js.

## Design Choices

Used a diff > 100 threshold to decide when to persist a new log entry, balancing meaningful change capture against excessive writes. Adding prePurgeCount as a new optional field keeps the change backwards compatible with existing medic-logs documents.

## Related Files

- api/src/services/replication-limit-log.js
- api/src/services/replication.js
- api/tests/mocha/services/replication-limit-log.spec.js
- api/tests/mocha/services/replication.spec.js

## Testing

Unit tests added/updated in api/tests/mocha/services/replication-limit-log.spec.js and api/tests/mocha/services/replication.spec.js. Reviewer also spun it up locally and confirmed prePurgeCount is logged as expected, with values reflecting the purging differences.

## Related Issues

- #10398: Also store pre-purge doc counts per user (in addition to post-purge) for visibility into replication performance

## Domain Rationale

**Fit:** strong

The PR modifies the replication service and its replication-limit-log directly, tracking per-user document counts that drive replication/sync performance — replication is the core of CHT's data-sync domain.
