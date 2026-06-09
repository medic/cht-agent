---
id: cht-core-7813
category: improvement
domain: data-sync
subDomain: pouchdb
issueNumber: 7813
issueUrl: https://github.com/medic/cht-core/issues/7813
title: Close ephemeral PouchDB instances to prevent memory leaks
lastUpdated: 2022-09-29
summary: API memory usage increased during offline user synchronization because temporary PouchDB instances were not always closed. The fix ensured all opened databases are properly closed, including non-existent databases.
services:
  - api
techStack:
  - javascript
  - pouchdb
---

## Problem

When offline users synchronized with the server, the API sometimes opened temporary PouchDB databases that did not exist. These temporary database instances were not always closed afterwards.

Repeated synchronization operations caused unused PouchDB objects to remain in memory, resulting in increasing memory consumption and potential memory leaks.

## Root Cause

The synchronization process created ephemeral PouchDB instances to check purging-related databases.

When a requested database did not exist, the code path exited without properly calling `db.close()`. As a result, PouchDB objects remained allocated in memory even though they were no longer needed.

## Solution

Updated the API to close every PouchDB instance that it opens, regardless of whether the database exists.

The fix ensured cleanup logic runs for both existing and non-existent databases, preventing unused PouchDB objects from accumulating in memory.

## Code Patterns

- Always close temporary database connections after use.
- Resource cleanup should occur even when operations fail.
- Missing databases should follow the same cleanup path as successful database access.
- Temporary PouchDB instances should never remain open after synchronization completes.

## Design Choices

- Fixed the issue by improving resource management instead of changing replication behavior.
- Applied cleanup consistently across all database-opening paths.
- Prioritized preventing long-running API memory growth during repeated sync operations.

## Related Files

- api synchronization and purging database handling code
- PouchDB database initialization utilities

## Testing

- Recorded API memory profiles before and after multiple sync operations.
- Compared the number of created and deleted PouchDB objects.
- Verified that after the fix the number of deleted objects matched the number of created objects, resulting in no memory leak.

## Related Issues

- #6106: Investigation of memory growth during synchronization
- #7814: Implementation PR for closing non-existent databases