---
id: cht-core-9951
category: bug
domain: infrastructure
domainFit: strong
issueNumber: 9951
issueUrl: https://github.com/medic/cht-core/issues/9951
title: Avoid circular call and clear deploy info cache when finalizing a CHT version upgrade
lastUpdated: '2026-06-22'
summary: Upgrade e2e tests were failing because finalizing an upgrade hit a circular call and left stale cached deploy info. The fix breaks the circular call and clears the deploy info cache at finalization so the newly deployed version's info is re-read.
services:
  - api
techStack:
  - javascript
  - nodejs
  - couchdb
tags:
  - upgrade
  - deploy-info
  - cache-invalidation
  - circular-dependency
  - couch-request
  - environment-lib
related_workflows: []
source_pr: medic/cht-core#9953
source_sha: 27e7c08d12983b50d5014b1352347eb1f407e8fe
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - api/src/services/setup/upgrade-steps.js
  - shared-libs/couch-request/src/couch-request.js
  - shared-libs/environment/src/index.js
concepts:
  - upgrade finalization lifecycle
  - deploy info caching and cache invalidation
  - circular dependency between shared libraries
  - CouchDB-backed deploy_info metadata
related_issues: []
stale: false
---

## Problem

Upgrade end-to-end tests (performing an upgrade from the current branch to master) were failing. When finalizing a CHT version upgrade, the finalization path triggered a circular call and the cached deploy info was never refreshed, leaving the system holding stale deploy/version information after the upgrade completed.

## Root Cause

The deploy info cache held in shared-libs/environment was not invalidated when an upgrade was finalized, and the finalization path produced a circular call between the deploy-info lookup in shared-libs/environment and shared-libs/couch-request calling back into each other, breaking the upgrade flow.

## Solution

Broke the circular call in the upgrade finalization path and explicitly cleared the deploy info cache in shared-libs/environment when finalizing the upgrade so the newly deployed version's deploy info is re-read. Adjusted shared-libs/couch-request accordingly and updated the affected unit tests.

## Code Patterns

Tie cache invalidation to a lifecycle event: clear the deploy info cache (shared-libs/environment) from api/src/services/setup/upgrade-steps.js at upgrade finalization rather than disabling caching. Decouple shared libs (couch-request <-> environment) to avoid circular require/call chains.

## Design Choices

Explicitly clearing the cache at the finalization point preserves the performance benefit of caching deploy info while guaranteeing freshness immediately after an upgrade; restructuring the call path eliminates the circular dependency at its source instead of suppressing the symptom.

## Related Files

- api/src/services/setup/upgrade-steps.js
- api/tests/mocha/services/setup/upgrade-steps.spec.js
- shared-libs/couch-request/src/couch-request.js
- shared-libs/couch-request/test/couch-request.js
- shared-libs/environment/src/index.js
- shared-libs/environment/test/index.spec.js
- tests/e2e/default/sms/rapidpro.wdio-spec.js

## Testing

Updated mocha unit tests for upgrade-steps, couch-request, and the environment lib to cover the cache-clearing and non-circular finalization behavior; also adjusted the rapidpro SMS e2e spec. The change targets the previously failing upgrade e2e suite (upgrade from current branch to master).

## Related Issues

- #9951: Upgrade e2e tests failing when performing an upgrade from the current branch to master

## Domain Rationale

**Fit:** strong

This is CHT upgrade tooling — the api upgrade-steps service that finalizes a version upgrade plus the deploy-info plumbing in shared libs. Per the classification seeds, upgrade/deploy lifecycle work is canonically infrastructure, not application behavior.
