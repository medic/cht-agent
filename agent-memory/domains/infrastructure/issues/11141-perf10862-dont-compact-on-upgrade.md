---
id: cht-core-10862
category: improvement
domain: infrastructure
domainFit: strong
issueNumber: 10862
issueUrl: https://github.com/medic/cht-core/issues/10862
title: Skip CouchDB compaction during post-upgrade cleanup so upgrades only run cheap view and Nouveau cleanups
lastUpdated: '2026-10-01'
summary: The post-upgrade cleanup step started CouchDB compaction of every database, a space- and compute-intensive operation that kept large instances busy for an hour or more after an upgrade. It now performs only viewCleanup and nouveauCleanup — simple deletions of stale data sets that require no extra space or compute.
services:
  - api
techStack:
  - javascript
  - nodejs
  - couchdb
  - mocha
tags:
  - upgrade
  - couchdb
  - compaction
  - performance
  - post-upgrade-cleanup
  - view-cleanup
  - nouveau-cleanup
  - deploy
related_workflows: []
source_pr: medic/cht-core#11141
source_sha: 047f5c562e0a3eadf89e03af5e32a288dc0741fc
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - api/src/services/setup/upgrade-steps.js
  - api/src/services/setup/utils.js
concepts:
  - upgrade lifecycle
  - post-upgrade cleanup
  - CouchDB compaction
  - view cleanup
  - Nouveau index cleanup
  - deploy performance
related_issues: []
stale: false
---

## Problem

During CHT upgrades, the post-upgrade cleanup routine (also run when an upgrade is aborted) triggered CouchDB database compaction in addition to view and Nouveau cleanup. Compaction rewrites database files and is expensive in both disk space and compute; the issue reports a large instance still compacting an hour into an upgrade to 5.1.1, a release with no index or view changes.

## Root Cause

Before this PR, `cleanup` in api/src/services/setup/utils.js started a compaction of every database in `DATABASES` alongside its view cleanup, unconditionally, and both `finalize` and `abort` in api/src/services/setup/upgrade-steps.js call `cleanup` — so every upgrade compacted every database whether or not anything had changed, even though compaction provides no correctness benefit at upgrade time and only adds disk/CPU load.

## Solution

Removed the compaction call from post-upgrade cleanup so the step only runs viewCleanup and nouveauCleanup — both of which are deletions of old/stale data sets that need no additional space or compute. `finalize` and `abort` in api/src/services/setup/upgrade-steps.js now call `upgradeUtils.cleanup();` without awaiting it. API no longer requests database compaction anywhere, leaving compaction to CouchDB itself. Unit tests were updated to drop the compaction expectations.

## Code Patterns

Separate cheap cleanup operations (index/view deletions) from expensive maintenance operations (compaction) in the upgrade flow, and leave compaction to CouchDB instead of forcing it during a deploy. `cleanup` in api/src/services/setup/utils.js starts `viewCleanup()` for each database and `db.nouveauCleanup()` without awaiting them and logs their failures, so cleanup never blocks or fails an upgrade step.

## Design Choices

The issue proposed running compaction only when it is required (it noted compaction ran regardless of database changes or fragmentation); the PR instead dropped compaction from the upgrade path entirely, because at upgrade time it yields no correctness gain and only adds load. viewCleanup and nouveauCleanup were retained because they reclaim stale index data at effectively zero additional cost.

## Related Files

- api/src/services/setup/upgrade-steps.js
- api/src/services/setup/utils.js
- api/tests/mocha/services/setup/upgrade-steps.spec.js
- api/tests/mocha/services/setup/utils.spec.js

## Testing

In api/tests/mocha/services/setup/utils.spec.js the compaction stubs and expectations were dropped; 'should start view and nouveau cleanup for every database' checks that viewCleanup and nouveauCleanup are still invoked, and 'should catch view cleanup errors and log them' covers a failing viewCleanup. In api/tests/mocha/services/setup/upgrade-steps.spec.js the `finalize` and `abort` tests that expected a cleanup failure to propagate were removed, since `cleanup` is no longer awaited.

## Related Issues

- #10862: "Don't run database compaction on every version upgrade" — compaction ran on every upgrade regardless of changes, adding an hour or more of load on a large instance

## Domain Rationale

**Fit:** strong

This is upgrade-lifecycle work — skipping CouchDB compaction during the post-upgrade cleanup step in api/src/services/setup. The change alters which CouchDB maintenance operations `cleanup` in api/src/services/setup/utils.js starts after `finalize` or `abort` in api/src/services/setup/upgrade-steps.js, and stops awaiting that call, which returns nothing; no application behaviour changes.
