---
id: cht-core-7105
category: improvement
domain: messaging
subDomain: monitoring
issueNumber: 7105
issueUrl: https://github.com/medic/cht-core/issues/7105
title: Adds failed and delivered WO messages count to monitoring API
lastUpdated: 2021-05-31
summary: Enhanced monitoring API to separately track failed and delivered outgoing work outlet messages, providing better visibility into message delivery success rates.
services:
  - api
techStack:
  - javascript
  - nodejs
  - couchdb
---

## Problem

The monitoring API only tracked total outgoing messages without distinguishing between successful deliveries and failures. This made it difficult for operators to:

1. Identify SMS delivery problems in real-time
2. Understand the success rate of outgoing messages
3. Debug message delivery issues
4. Monitor system health effectively

Operators had to manually query the database to understand message failure rates.

## Root Cause

The monitoring service indexed all outgoing messages together without separating them by state. The `monitoring.messaging.outgoing.state` counter only showed total counts, not broken down by delivery status (pending, sent, delivered, failed, muted).

## Solution

Enhanced the monitoring API to:

1. **Separate failed and delivered message counts**: Updated `medic-admin/message_queue` to separately index failed (`failed`) and delivered (`delivered` and `sent`) outgoing messages
2. **Added new monitoring counters**:
   - `monitoring.messaging.outgoing.state.delivered`
   - `monitoring.messaging.outgoing.state.failed`
3. **Created `/api/v2/monitoring` endpoint** with improvements:
   - Renamed `monitoring.messaging.outgoing.state.` to `monitoring.messaging.outgoing.total.`
   - Added `monitoring.messaging.outgoing.seven_days` section with same metrics for last 7 days only
   - Added `monitoring.messaging.outgoing.last_hundred` section grouping messages by status (pending, final, muted) with counts for last 100 updated messages per group
4. **Fixed `monitoring.sentinel.backlog`** to use the new metadata doc

## Code Patterns

- Use separate counters for different message states to enable better monitoring
- Pattern: Create time-windowed metrics (last 7 days) alongside total counts for trend analysis
- Pattern: Track last N items by status for recent activity visibility
- File: `api/src/services/monitoring.js` contains the monitoring logic
- File: `api/src/controllers/monitoring.js` exposes the monitoring endpoints
- Use CouchDB views to aggregate message counts by state efficiently

## Design Choices

Chose to create a new v2 endpoint rather than modifying v1 because:
- Maintains backward compatibility for existing monitoring dashboards
- Allows breaking changes in the response structure
- Provides opportunity to reorganize the API more logically
- Time-windowed metrics (7 days, last 100) provide more actionable insights than lifetime totals

## Related Files

- api/src/services/monitoring.js
- api/src/controllers/monitoring.js
- api/tests/mocha/services/monitoring.spec.js
- tests/e2e/default/monitoring/monitoring.wdio-spec.js

## Testing

- Added unit tests for new monitoring counters
- Added e2e tests to verify v2 endpoint returns correct structure
- Tested seven_days windowing logic
- Tested last_hundred grouping by status
- Verified sentinel backlog fix with new metadata doc

## Related Issues

- #6572: Original issue for SMS failure monitoring
- #7113: Related monitoring improvements
- #9467: RapidPro error handling (complementary messaging reliability improvement)
