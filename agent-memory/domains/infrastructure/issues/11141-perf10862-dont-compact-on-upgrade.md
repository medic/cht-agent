---
id: cht-core-11141
category: improvement
domain: infrastructure
domainFit: strong
issueNumber: 11141
issueUrl: https://github.com/medic/cht-core/issues/11141
title: Skip CouchDB compaction during post-upgrade cleanup so upgrades only run cheap view and Nouveau cleanups
lastUpdated: '2026-06-22'
summary: The post-upgrade cleanup step forced CouchDB compaction, a space- and compute-intensive operation that slowed deploys. It now performs only viewCleanup and nouveauCleanup — simple deletions of stale data sets that require no extra space or compute.
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

During CHT upgrades, the post-upgrade cleanup routine triggered CouchDB database compaction in addition to view and Nouveau cleanup. Compaction rewrites database files and is expensive in both disk space and compute, making upgrades/deploys slower and more resource-intensive than necessary.

## Root Cause

The setup/upgrade cleanup logic in api/src/services/setup (upgrade-steps.js and utils.js) invoked CouchDB compaction as part of post-upgrade cleanup, even though compaction provides no correctness benefit at upgrade time and only adds latency and disk/CPU pressure.

## Solution

Removed the compaction call from post-upgrade cleanup so the step only runs viewCleanup and nouveauCleanup — both of which are deletions of old/stale data sets that need no additional space or compute. Compaction is left to CouchDB's own background/automatic process rather than being forced synchronously during the upgrade. Unit tests were updated to assert compaction is no longer invoked.

## Code Patterns

Separate cheap, non-blocking cleanup operations (index/view deletions) from expensive maintenance operations (compaction) in the upgrade flow; defer compaction to CouchDB auto-compaction instead of forcing it during a deploy. Changes in api/src/services/setup/upgrade-steps.js and api/src/services/setup/utils.js.

## Design Choices

Compaction was dropped from the upgrade path rather than made optional/configurable because it yields no correctness gain at upgrade time and only adds wall-clock latency and resource pressure; viewCleanup and nouveauCleanup were retained because they reclaim stale index data at effectively zero additional cost.

## Related Files

- api/src/services/setup/upgrade-steps.js
- api/src/services/setup/utils.js
- api/tests/mocha/services/setup/upgrade-steps.spec.js
- api/tests/mocha/services/setup/utils.spec.js

## Testing

Updated Mocha unit tests in api/tests/mocha/services/setup/upgrade-steps.spec.js and api/tests/mocha/services/setup/utils.spec.js to reflect that compaction is no longer triggered during post-upgrade cleanup, while viewCleanup and nouveauCleanup are still invoked.

## Related Issues

- #10862: don't compact on upgrade — skip expensive CouchDB compaction during the upgrade lifecycle to speed up deploys

## Domain Rationale

**Fit:** strong

This is upgrade-lifecycle work — skipping CouchDB compaction during the post-upgrade cleanup step in api/src/services/setup — which canonically belongs to infrastructure (deploy/upgrade tooling), matching the 'skip CouchDB compaction during API upgrade' seed example exactly.
