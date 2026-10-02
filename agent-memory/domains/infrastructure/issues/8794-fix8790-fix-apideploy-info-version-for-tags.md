---
id: cht-core-8790
category: bug
domain: infrastructure
domainFit: strong
issueNumber: 8790
issueUrl: https://github.com/medic/cht-core/issues/8790
title: Force api/deploy-info version to be valid semver for tag builds
lastUpdated: '2026-10-01'
summary: The api/deploy-info endpoint returned an invalid semver version for tag builds (e.g. `4.5.1.4327432`) while branch builds were fine; the fix makes the deploy-info version prefer a semver-valid value, which for a tag build is the tag itself.
services:
  - api
techStack:
  - nodejs
  - javascript
  - semver
  - mocha
tags:
  - semver
  - deploy-info
  - versioning
  - build
  - monitoring
  - tags
  - release
related_workflows:
  - observability
source_pr: medic/cht-core#8794
source_sha: e16f5df6dfdf6437d9deb14a25f96f77cb84eb10
distilled_at: '2026-06-23'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - api/src/services/deploy-info.js
  - api/src/services/monitoring.js
  - scripts/build/index.js
concepts:
  - semantic versioning
  - build version computation
  - deploy info
  - monitoring endpoint
  - staging ddoc
related_issues:
  - cht-core-8940
stale: true
---

> **Paths are as of this PR, not as of master.** The `getVersion` helper that
> api/src/services/deploy-info.js gained in this PR moved, with the deploy-info cache, into
> shared-libs/environment/src/index.js as `getVersionFromDdoc` by PR #9818 (`9bcc58a5b`), and
> from there into shared-libs/server-info/src/index.js by PR #9909 (`1b0ed339d`), whose master
> version ends in an `'unknown'` fallback. On master, api/src/services/deploy-info.js only delegates to
> `serverInfo.getDeployInfo()`; api/src/services/monitoring.js still reads the version through
> `deployInfoService.get()`.

## Problem

The `api/deploy-info` endpoint returned a valid semver string for branch builds (e.g. `4.5.1-branch-name.4324242`) but an invalid semver string for tag builds (e.g. `4.5.1.4327432`). cht-conf, which checks the instance version with semver, failed to upload documents to instances because of the invalid version (fixed on the cht-conf side by medic/cht-conf#597).

## Root Cause

For tag builds the version was assembled by appending the build number after the patch segment with a `.` separator, producing a four-segment string that is not valid semver. Before this PR, `getTagVersion` in scripts/build/versions.js returned `${TAG}.${BUILD_NUMBER}` unless its `release` argument was set; `setDdocsVersion` in scripts/build/index.js called `versions.getVersion()` without it and wrote the result into each ddoc's `version`, and api/src/services/deploy-info.js returned `version: ddoc.version`. Branch builds put the branch name after a `-` pre-release separator (`${packageJson.version}-${BRANCH}`), which is semver-valid for branch names made of letters, digits and hyphens, so tag builds were the path that always emitted an invalid version.

## Solution

Force the `version` field of the `/api/deploy-info` response to be valid semver, including for tags. At this PR, api/src/services/deploy-info.js gained a `getVersion` helper that returns the first semver-valid value among `ddoc.build_info?.version` and `ddoc.deploy_info?.build`, falling back to `ddoc.version`: `semver.valid(ddoc.build_info?.version) || semver.valid(ddoc.deploy_info?.build) || ddoc.version`. A tag build's `build_info.version` is the tag itself, so tag builds now report e.g. `4.6.0`. `getAppVersion` in api/src/services/monitoring.js now reads the version through `deployInfoService.get()` instead of fetching `_design/medic` itself. At this PR the existing api/package.json and api/package-lock.json gained a `semver` dependency (`"semver": "^7.5.4"`), and commit `918d8e1b4` (#9106) later moved npm dependencies to the root, removing api/package-lock.json; the only change in scripts/build/index.js makes `exec` reject with an `Error` object instead of a bare string. The change is deliberately limited to the deploy-info version string rather than restructuring how versions are derived everywhere.

## Code Patterns

Validate version strings with `semver.valid` and fall back through candidate fields before exposing them via API; centralize version normalization in api/src/services/deploy-info.js (at this PR; on master in shared-libs/server-info/src/index.js) so downstream consumers (api/src/services/monitoring.js) inherit a valid semver value rather than each re-deriving it.

## Design Choices

The fix was intentionally scoped narrowly to only force the `/api/deploy-info` `version` field to valid semver. Branch-name-based versions and the staging ddoc name were left unchanged because they are consumed in many places (admin app, staging ddoc naming), so standardizing them would be much more complicated.

## Related Files

- api/src/services/deploy-info.js
- api/src/services/monitoring.js
- scripts/build/index.js
- api/package.json
- api/package-lock.json
- api/tests/mocha/services/deploy-info.spec.js
- api/tests/mocha/services/monitoring.spec.js
- tests/integration/api/routing.spec.js
- tests/e2e/upgrade/upgrade.wdio-spec.js

## Testing

api/tests/mocha/services/deploy-info.spec.js now uses a tag-shaped fixture (`version: '4.6.0.6922454971'` with a `build_info` version of `'4.6.0'`) and expects `version: '4.6.0'`; in api/tests/mocha/services/monitoring.spec.js, `sinon.stub(deployInfo, 'get')` replaces the `db.medic` stub for `_design/medic`. tests/integration/api/routing.spec.js asserts `semver.valid(deployInfoOnline.version)` and `semver.valid(deployInfoOffline.version)` and expects `ddoc.build_info.build` on branch builds and `ddoc.build_info.version` otherwise; tests/e2e/upgrade/upgrade.wdio-spec.js checks `semver.valid(deployInfo.version)` after upgrading to the current branch and adds a skipped `xit('should have valid semver after installing'` case, to be enabled after 4.6.0 is released.

## Related Issues

- #8790: "`/api/deploy-info.version` is not semver valid for final releases" — deploying 4.5.1 returned a `version` like `4.5.0.7180278601`
- #8940: "Admin app shows error after successful upgrade" — regression from this change: the admin upgrade page compared the target build with the now-semver deploy-info `version`; fixed by PR #8965

## Domain Rationale

**Fit:** strong

The version string it fixes is produced by the build pipeline — for tag builds `getTagVersion` in scripts/build/versions.js yields `${TAG}.${BUILD_NUMBER}` and `setDdocsVersion` in scripts/build/index.js writes it into every ddoc — and is surfaced through the deploy-info endpoint and the monitoring API, which operators and tooling read to identify the running release. The fix lives in api/src/services/deploy-info.js and routes api/src/services/monitoring.js through it; no user-facing workflow changes.
