---
id: cht-core-7121
category: improvement
domain: data-sync
subDomain: meta-database
issueNumber: 7121
issueUrl: https://github.com/medic/cht-core/issues/7121
title: Sync Now should synchronize meta database when pressed
lastUpdated: 2021-09-16
summary: Manual synchronization only synced the primary database and ignored the user's meta database. The fix ensured that pressing Sync Now triggers synchronization for both databases.
services:
  - webapp
techStack:
  - javascript
  - pouchdb
---

## Problem

When users manually triggered synchronization using the "Sync Now" button, only the main database replication was executed.

Changes stored in the user's meta database were not synchronized immediately, causing inconsistencies between user expectations and actual synchronization behavior.

## Root Cause

The manual synchronization workflow initiated replication for the primary database but did not include the meta database replication process.

As a result, users could complete a manual sync while some user-specific data remained unsynchronized.

## Solution

Updated the Sync Now action to trigger synchronization for both the primary database and the meta database.

This ensured that manual synchronization behaved consistently with the application's overall replication strategy.

## Code Patterns

- Manual synchronization should include all databases required by the application.
- User-facing sync actions should produce predictable synchronization results.
- Related databases should be synchronized together when consistency is required.

## Design Choices

- Reused the existing synchronization infrastructure rather than creating a separate meta sync process.
- Kept synchronization behavior consistent between automatic and manual replication.

## Related Files

- webapp/src/ts/services/db-sync.service.ts

## Testing

- Verified Sync Now triggers primary database synchronization.
- Verified Sync Now also synchronizes the meta database.
- Confirmed metadata changes are replicated after manual synchronization.

## Related Issues

- #5207: User feedback for manual synchronization
- #8296: Nairobi replication protocol