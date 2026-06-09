---
id: cht-core-7034
category: bug
domain: data-sync
subDomain: meta-database
issueNumber: 7034
issueUrl: https://github.com/medic/cht-core/issues/7034
title: Meta database sync throws empty error message while offline
lastUpdated: 2021-09-08
summary: Meta database synchronization generated feedback documents containing empty error messages when users were offline. The fix improved offline error handling and prevented unnecessary feedback reports.
services:
  - webapp
techStack:
  - javascript
  - pouchdb
---

## Problem

When an offline user attempted synchronization, the meta database replication could fail and generate a feedback document containing an empty error message.

These feedback documents provided little diagnostic value and created unnecessary noise for developers investigating issues.

## Root Cause

Offline replication failures were not handled correctly for meta database synchronization.

The error object being processed sometimes lacked meaningful message content, resulting in feedback reports with empty messages.

## Solution

Improved error handling for meta database replication failures.

The fix ensured that expected offline synchronization failures are handled gracefully and do not generate misleading feedback reports with empty messages.

## Code Patterns

- Expected offline failures should not generate unnecessary error reports.
- Error messages should always contain useful diagnostic information.
- Replication code should distinguish between expected and unexpected failures.

## Design Choices

- Reduced noise in feedback reporting systems.
- Treated offline connectivity failures as expected operational conditions.
- Focused feedback documents on actionable failures.

## Related Files

- meta database replication code
- feedback document generation logic
- synchronization error handling code

## Testing

- Verified offline synchronization no longer generates empty feedback reports.
- Confirmed unexpected replication failures are still reported correctly.
- Tested meta database replication behavior while offline.

## Related Issues

- #9294: Feedback document creation during PouchDB failures
- #5207: Manual synchronization feedback