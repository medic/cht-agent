---
id: cht-core-5207
category: improvement
domain: data-sync
subDomain: manual-sync
issueNumber: 5207
issueUrl: https://github.com/medic/cht-core/issues/5207
title: Provide user feedback when manually syncing the database
lastUpdated: 2021-11-30
summary: Added snackbar notifications to inform users when manual synchronization starts, succeeds, or fails, improving visibility into offline replication status.
services:
  - webapp
techStack:
  - javascript
  - angular
  - pouchdb
---

## Problem

When users pressed the "Sync Now" option from the hamburger menu, synchronization started in the background but there was little indication of what happened afterward.

Users could not easily tell:

- Whether synchronization actually started
- Whether synchronization completed successfully
- Whether synchronization failed
- What to do when a failure occurred

This was especially confusing for offline users who depend on manual synchronization to upload and download data.

## Root Cause

The manual synchronization flow triggered database replication but did not provide sufficient user-facing feedback about replication state changes.

The existing UI only displayed limited sync information and offered no immediate confirmation after a manual sync request.

## Solution

Implemented snackbar-based synchronization feedback.

The new flow:

1. User clicks "Sync Now"
2. Snackbar appears indicating synchronization is in progress
3. On success, a success snackbar is displayed
4. On failure, an error snackbar is displayed with a Retry action
5. Retry allows users to attempt synchronization again without reopening menus

The implementation reused the existing snackbar component instead of introducing a dedicated synchronization dialog.

## Code Patterns

- Use snackbars for lightweight feedback about background operations
- Long-running replication processes should communicate state transitions to users
- Recoverable synchronization failures should expose retry actions
- Queue snackbar messages when multiple sync states occur rapidly

## Design Choices

- Chose snackbar notifications instead of modal dialogs to avoid blocking user interaction
- Did not implement synchronization cancellation because the use case was considered uncommon
- Followed Material Design guidelines for transient notifications
- Added retry functionality to simplify recovery from temporary network issues

## Related Files

- webapp/src/ts/services/db-sync.service.ts
- webapp/src/ts/components/snackbar/snackbar.component.ts
- webapp/tests/karma/ts/components/snackbar.component.spec.ts
- webapp/tests/e2e/

## Testing

- Added unit tests for snackbar behavior
- Added E2E tests covering synchronization notifications
- Verified success notifications after completed sync
- Verified failure notifications when offline
- Verified Retry action successfully triggers another sync attempt
- Tested snackbar queueing and timeout behavior

## Related Issues

- #3976: Trigger a database sync when clicking sync status
- #3977: Improve sync status UI
- #7385: Implementation PR for manual sync feedback