---
id: cht-core-6920
category: bug
domain: data-sync
subDomain: upwards-replication
issueNumber: 6920
issueUrl: https://github.com/medic/cht-core/issues/6920
title: Users might start upwards replication from zero after upgrade
lastUpdated: 2021-03-04
summary: Some users could restart upward replication from sequence zero after upgrading, causing previously synchronized documents to be uploaded again. The fix preserved replication checkpoints across upgrades.
services:
  - webapp
  - api
techStack:
  - javascript
  - pouchdb
  - couchdb
---

## Problem

After upgrading the application, some offline users could lose their upward replication checkpoint.

When this occurred, replication restarted from sequence zero and attempted to upload documents that had already been synchronized previously.

This increased replication load and wasted network resources.

## Root Cause

Replication checkpoint information was not always preserved correctly during upgrade scenarios.

Without a valid checkpoint, PouchDB assumed replication should begin from the start of the changes feed.

## Solution

Updated replication logic to preserve and correctly restore replication checkpoints after upgrades.

This ensured upward replication continued from the last synchronized sequence rather than restarting from the beginning.

## Code Patterns

- Replication checkpoints are critical for synchronization continuity.
- Upgrade procedures must preserve synchronization state.
- Replication should always resume from the last known checkpoint when possible.

## Design Choices

- Preserved existing synchronization state instead of rebuilding replication history.
- Minimized unnecessary network traffic after upgrades.
- Maintained backward compatibility with existing users.

## Related Files

- webapp/src/ts/services/db-sync.service.ts
- webapp/src/ts/services/migrations/target-checkpointer.migration.ts

## Testing

- Simulated application upgrades with offline users.
- Verified replication resumes from existing checkpoints.
- Confirmed previously synchronized documents are not re-uploaded.

## Related Issues

- #5235: seq_interval replication failure
- #6103: Retry upwards replication
- #8296: Nairobi replication protocol