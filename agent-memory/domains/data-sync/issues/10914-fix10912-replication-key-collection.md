---
id: cht-core-10912
category: bug
domain: data-sync
domainFit: strong
issueNumber: 10912
issueUrl: https://github.com/medic/cht-core/issues/10912
title: Fix replication key collection in API authorization service
lastUpdated: '2026-06-22'
summary: The API authorization service collected replication keys incorrectly (#10912), risking documents being wrongly included in or excluded from offline replication. The fix corrects the key-collection logic and adds unit tests.
services:
  - api
techStack:
  - javascript
  - nodejs
  - couchdb
  - mocha
tags:
  - replication
  - replication-keys
  - authorization
  - offline-users
  - changes-feed
related_workflows: []
source_pr: medic/cht-core#10914
source_sha: 671fbef7efc6c9dc4f34f551e5767aef54cd7811
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - api/src/services/authorization.js
concepts:
  - replication keys
  - offline replication
  - document authorization
  - changes feed filtering
  - CouchDB view results
related_issues: []
stale: false
---

## Problem

Per issue #10912, the API authorization service gathered replication keys incorrectly. Because these keys drive which documents replicate to offline users' devices, the defect risked documents being wrongly included in or excluded from an offline user's replicated dataset.

## Root Cause

A flaw in the replication-key collection path within api/src/services/authorization.js — the logic that assembles the set of replication keys for a document from its view results did not collect the keys correctly.

## Solution

Corrected the replication key collection logic in the authorization service and, at the reviewer's request, added unit tests in api/tests/mocha/services/authorization.spec.js exercising the fixed behavior.

## Code Patterns

Replication keys are derived from CouchDB view results inside the authorization service and accumulated into the set used to filter the changes feed for offline users; ensure every applicable key for a document is collected. See api/src/services/authorization.js.

## Design Choices

Kept the change narrowly scoped to the authorization service's key-collection path and added focused unit tests (explicitly requested in review) to lock the corrected behavior rather than relying on integration coverage.

## Related Files

- api/src/services/authorization.js
- api/tests/mocha/services/authorization.spec.js

## Testing

Unit tests added in api/tests/mocha/services/authorization.spec.js (mocha) at the reviewer's request, covering the corrected replication key collection behavior.

## Related Issues

- #10912: replication key collection bug in the API authorization service

## Domain Rationale

**Fit:** strong

Replication keys are the mechanism that decides which documents replicate to an offline user's device, so collecting them correctly is squarely a data-sync (replication) concern. The code lives in api/src/services/authorization.js, which makes it authentication-adjacent, but the bug is in the replication filtering algorithm rather than login/session/RBAC, so data-sync is the principled bin.
