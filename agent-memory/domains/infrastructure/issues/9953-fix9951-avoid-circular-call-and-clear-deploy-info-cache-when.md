---
id: cht-core-9951
category: bug
domain: infrastructure
domainFit: strong
issueNumber: 9951
issueUrl: https://github.com/medic/cht-core/issues/9951
title: Avoid circular call and clear deploy info cache when finalizing a CHT version upgrade
lastUpdated: '2026-10-01'
summary: Upgrade e2e tests were failing because finalizing an upgrade left stale cached deploy info. The fix refreshes the deploy info cache at finalization so the newly deployed version's info is re-read, and breaks a circular call between shared-libs/couch-request and shared-libs/environment by adding the user-agent only to external requests.
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
stale: true
---

> **Paths are as of this PR, not as of master.** On master, `getDeployInfo`, `getVersion` and
> the `deployInfoCache` live in shared-libs/server-info/src/index.js, moved out of
> shared-libs/environment/src/index.js by PR #9909 (`1b0ed339d`, 2025-05-22). On master,
> `finalize` in api/src/services/setup/upgrade-steps.js calls `serverInfo.getDeployInfo(true)`,
> and `getUserAgent` in shared-libs/couch-request/src/couch-request.js lazy-loads
> `@medic/server-info`. The `isInternalRequest` guard added here is still on master.

## Problem

Upgrade end-to-end tests (performing an upgrade from the current branch to master) were failing. Finalizing a CHT version upgrade never refreshed the cached deploy info, so the API (at this PR, api/src/services/deploy-info.js returns `environment.getDeployInfo()`) kept serving the pre-upgrade deploy/version information after the upgrade completed.

## Root Cause

The deploy info cache held in shared-libs/environment was not invalidated when an upgrade was finalized. Before this PR, every outgoing request that lacked a user-agent also looked up deploy info: `setRequestOptions` in shared-libs/couch-request/src/couch-request.js set the header via `getUserAgent`, which awaits `environment.getVersion()` and so `getDeployInfo()` — and `getDeployInfo` in shared-libs/environment/src/index.js fetches the ddoc through `@medic/couch-request` itself. At this PR's parent, that circular call was kept from recursing only because `getDeployInfo` passed a hard-coded `'user-agent': 'Community Health Toolkit'` header. Both behaviours arrived with PR #9937 (`9b4546714`), which the diagnosis on #9951 names as the likely cause.

## Solution

At this PR, `getDeployInfo` in shared-libs/environment/src/index.js gained a `refresh = false` parameter that bypasses the cache (`if (deployInfoCache && !refresh)`), and `finalize` in api/src/services/setup/upgrade-steps.js ends with `await environment.getDeployInfo(true);`, so the newly deployed version's deploy info is re-read and re-cached. The circular call was broken in shared-libs/couch-request/src/couch-request.js: a new `isInternalRequest` helper compares the request URL's hostname with `environment.host`, and the user-agent is added only to external requests, so internal CouchDB requests no longer carry one and `getDeployInfo` dropped its hard-coded user-agent header. The affected unit tests were updated.

## Code Patterns

Tie cache invalidation to a lifecycle event: refresh the deploy info cache (`getDeployInfo(true)`, shared-libs/environment at this PR) from api/src/services/setup/upgrade-steps.js at upgrade finalization rather than disabling caching. Break a circular call between shared libs by narrowing when it happens: at this PR, couch-request asks environment for the version (for the user-agent) only on external requests, so internal CouchDB requests, including `getDeployInfo`'s own ddoc fetch, never call back into environment.

## Design Choices

Explicitly refreshing the cache at the finalization point preserves the performance benefit of caching deploy info while guaranteeing freshness immediately after an upgrade; skipping the user-agent for internal requests removes the circular call for every CouchDB request instead of relying on each caller (as `getDeployInfo` did) to pre-set a user-agent header.

## Related Files

- api/src/services/setup/upgrade-steps.js
- api/tests/mocha/services/setup/upgrade-steps.spec.js
- shared-libs/couch-request/src/couch-request.js
- shared-libs/couch-request/test/couch-request.js
- shared-libs/environment/src/index.js
- shared-libs/environment/test/index.spec.js
- tests/e2e/default/sms/rapidpro.wdio-spec.js

## Testing

In api/tests/mocha/services/setup/upgrade-steps.spec.js the `finalize` test asserts `environment.getDeployInfo.calledOnceWithExactly(true)`; shared-libs/environment/test/index.spec.js gained 'should clear cache when requested' (the cached value is served until `getDeployInfo(true)` re-fetches); shared-libs/couch-request/test/couch-request.js dropped the user-agent from its internal-request expectations and gained 'should add user-agent header to external requests'. The existing tests/e2e/default/sms/rapidpro.wdio-spec.js gained an assertion that outgoing RapidPro requests carry a `Community Health Toolkit/` user-agent. The change targets the previously failing upgrade e2e suite (upgrade from current branch to master).

## Related Issues

- #9951: "Upgrade e2e tests are failing" — the upgrade-from-current-branch-to-master e2e spec timed out waiting for "Deployment complete"; the issue's diagnosis is deploy info cached right after the upgrade
- PR #9937: "feat(#9936): add user-agent for all outgoing RapidPro requests" — added the couch-request user-agent lookup and the hard-coded header in `getDeployInfo` that this PR replaced
- PR #9909: "feat(#9885): adds new meta audit database" — later moved `getDeployInfo` into shared-libs/server-info

## Domain Rationale

**Fit:** strong

This is CHT upgrade tooling — the api upgrade-steps service that finalizes a version upgrade plus the deploy-info plumbing in shared libs. The fix lands in `finalize` (api/src/services/setup/upgrade-steps.js), the step that completes an upgrade, and in the deploy-info cache that api/src/services/deploy-info.js serves; the couch-request change only decides which requests carry a user-agent header.
