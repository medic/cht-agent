---
id: cht-core-6299
category: bug
domain: data-sync
domainFit: strong
issueNumber: 6299
issueUrl: https://github.com/medic/cht-core/issues/6299
title: Trigger successive sync when changes remain unsynced and fix last-replicated sequence tracking in db-sync service
lastUpdated: '2026-06-23'
summary: Changes that occurred on the server during an already-in-progress sync were left unsynced and the sync status could display an error. The db-sync service now records the highest last_seq from replication responses and triggers up to 2 successive syncs when something is still left to replicate.
services:
  - webapp
techStack:
  - typescript
  - angular
  - pouchdb
  - couchdb
tags:
  - sync
  - replication
  - db-sync
  - sequence-number
  - checkpoint
  - successive-sync
related_workflows: []
source_pr: medic/cht-core#8773
source_sha: aef64d1b26b6899c97001910d7f2cfc3eb9bb62d
distilled_at: '2026-06-23'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - webapp/src/ts/services/db-sync.service.ts
concepts:
  - database replication
  - replication checkpointing
  - sequence-number tracking (current_seq vs last_seq)
  - bounded retry / successive sync
related_issues: []
stale: false
---

## Problem

When documents changed during a sync that was already running, those changes were not picked up by that sync cycle and remained unsynced, and the sync status could surface an error to the user. The last replicated sequence number was also not being set to the correct value from the replication response.

## Root Cause

The db-sync service did not record the highest last_seq returned across replication responses, and it had no mechanism to detect that new changes had arrived mid-sync (current_seq diverging from last_seq) and run a follow-up replication, so mid-sync changes were stranded until the next periodic or manual sync.

## Solution

Refactored db-sync.service.ts into smaller functions; set the last replicated sequence to the highest last_seq from the replication response; added logic to detect that something is still left to sync and trigger successive syncs, capped at a maximum of 2 extra successive syncs to avoid infinite loops; removed unused imports. The no-connection case is handled so it does not immediately retry.

## Code Patterns

Compare current_seq against the replicated last_seq to detect changes that landed during an in-progress sync, then trigger a follow-up replication bounded by a retry cap (max 2 extra syncs) to prevent infinite loops — in webapp/src/ts/services/db-sync.service.ts.

## Design Choices

Capped successive syncs at 2 extra cycles to reliably catch mid-sync changes without risking an unbounded sync loop, and used the highest last_seq across responses rather than a single response value for correct checkpointing. Deliberately avoids immediate retry when there is no connection to prevent hammering.

## Related Files

- webapp/src/ts/services/db-sync.service.ts
- webapp/tests/karma/ts/services/db-sync.service.spec.ts
- tests/page-objects/default/common/common.wdio.page.js

## Testing

Added/updated Karma unit tests in db-sync.service.spec.ts covering: sync with no changes yields equal current_seq and last_seq; changes occurring during an in-progress sync are subsequently replicated (the core fix); and a no-connection scenario does not retry immediately. Updated the common WebdriverIO page object for e2e support; manually verified reproduction on master and the fix on the branch.

## Related Issues

- #6299: sync does not capture changes that occur during an in-progress sync, leaving data unsynced and showing a sync error

## Domain Rationale

**Fit:** strong

The PR exclusively modifies the webapp's db-sync service replication logic — sequence-number checkpointing and triggering follow-up syncs when changes remain. This is core sync/replication behavior, the canonical data-sync domain.
