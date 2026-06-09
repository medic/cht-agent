---
id: cht-core-9294
category: bug
domain: data-sync
subDomain: pouchdb
issueNumber: 9294
issueUrl: https://github.com/medic/cht-core/issues/9294
title: Feedback document generation fails when PouchDB database crashes
lastUpdated: 2024-03-01
summary: Feedback documents could not be generated when the main PouchDB database connection was unavailable because crash reporting depended on information stored in that database. The fix moved required metadata outside the database dependency.
services:
  - webapp
techStack:
  - javascript
  - pouchdb
---

## Problem

When the main PouchDB database became unavailable or crashed, the application attempted to generate a feedback document describing the failure.

However, the feedback generation process itself depended on information stored in the same database that had already failed.

As a result:

- Feedback documents were not created.
- Crash information was lost.
- Developers could not investigate the root cause of failures.
- Offline users could experience failures without useful diagnostics being recorded.

## Root Cause

Feedback document generation required deployment and version information that was retrieved through the main PouchDB database connection.

A code path similar to the following was executed:

```js
const { version } = await this.versionService.getLocal();
```

When the database connection had already crashed or been closed, retrieving this information failed.

Since feedback generation depended on that metadata, the feedback document could not be created.

## Solution

Moved the deployment and version metadata required for feedback generation outside the main database dependency.

The information was exposed through the service worker so it remained available even when the primary PouchDB database was unavailable.

This allowed feedback documents to be generated independently of database state and ensured crash information could still be recorded.

## Code Patterns

- Error reporting systems should not depend on the component that failed.
- Critical diagnostics should remain available even when the primary database is unavailable.
- Metadata required for crash reporting should come from independent sources whenever possible.
- Service workers can expose deployment metadata without requiring database access.

## Design Choices

- Moved deployment metadata access away from PouchDB to improve reliability.
- Used the service worker as a lightweight source of application information.
- Prioritized preserving crash reports over minimizing code changes.
- Kept the solution focused on feedback generation rather than modifying broader synchronization logic.

## Related Files

- webapp/src/ts/services/version.service.ts
- webapp/src/ts/services/feedback.service.ts
- service worker deployment metadata handling
- feedback document generation logic

## Testing

- Simulated PouchDB database failures.
- Verified feedback documents could still be generated.
- Confirmed deployment and version information remained available.
- Tested feedback synchronization after application recovery.
- Verified no regression in normal feedback document creation.

## Related Issues

- #7034: Meta database sync throws empty message error when offline
- #7813: Close ephemeral PouchDB instances to avoid memory leaks