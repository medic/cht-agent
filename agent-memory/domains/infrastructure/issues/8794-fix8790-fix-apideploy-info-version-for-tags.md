---
id: cht-core-8794
category: bug
domain: infrastructure
domainFit: strong
issueNumber: 8794
issueUrl: https://github.com/medic/cht-core/issues/8794
title: Force api/deploy-info version to be valid semver for tag builds
lastUpdated: '2026-06-23'
summary: The api/deploy-info endpoint returned an invalid semver version for tag builds (e.g. `4.5.1.4327432`) while branch builds were fine; the fix normalizes the deploy-info version so it is always semver-valid.
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
related_issues: []
stale: false
---

## Problem

The `api/deploy-info` endpoint returned a valid semver string for branch builds (e.g. `4.5.1-branch-name.4324242`) but an invalid semver string for tag builds (e.g. `4.5.1.4327432`). Consumers that expect valid semver — the admin app, the `/api/v2/monitoring` endpoint, and upgrade tooling — could misbehave when handed the malformed version.

## Root Cause

For tag builds the version was assembled by appending the build number after the patch segment with a `.` separator, producing a four-segment string that is not valid semver. Branch builds used a `-` pre-release separator (which is semver-valid), so only the tag code path emitted an invalid version.

## Solution

Normalize the `api/deploy-info.version` response to always be valid semver, including for tags, adding the `semver` dependency (api/package.json / api/package-lock.json) and updating the build version computation in scripts/build/index.js plus the deploy-info and monitoring services. The change is deliberately limited to the deploy-info version string rather than restructuring how versions are derived everywhere.

## Code Patterns

Validate/coerce version strings to valid semver before exposing them via API; centralize version normalization in api/src/services/deploy-info.js so downstream consumers (api/src/services/monitoring.js) inherit a valid semver value rather than each re-deriving it.

## Design Choices

The fix was intentionally scoped narrowly to only force `api/deploy-info.version` to valid semver. Branch-name-based versions and the staging ddoc name were left unchanged because they are consumed in many places (admin app, staging ddoc naming), so standardizing them would be far more invasive and risky.

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

Unit tests updated in api/tests/mocha/services/deploy-info.spec.js and api/tests/mocha/services/monitoring.spec.js to assert the corrected semver-valid version; integration coverage in tests/integration/api/routing.spec.js and the e2e upgrade test tests/e2e/upgrade/upgrade.wdio-spec.js adjusted to expect the normalized version format.

## Related Issues

- #8790: api/deploy-info returns an invalid semver version for tag builds

## Domain Rationale

**Fit:** strong

This fixes build/deploy version computation (semver normalization for tag builds) across the build script and the deploy-info/monitoring API services — operational release and upgrade-lifecycle work, which is canonically the infrastructure domain (mirrors the 'Fix build version computation for release branches' seed example).
