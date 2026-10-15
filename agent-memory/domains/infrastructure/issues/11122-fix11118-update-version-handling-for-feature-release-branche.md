---
id: cht-core-11118
category: bug
domain: infrastructure
domainFit: strong
issueNumber: 11118
issueUrl: https://github.com/medic/cht-core/issues/11118
title: Stop doubling the version prefix on feature-release branch builds and align the deploy-info routing integration test with the API version rule
lastUpdated: '2026-10-01'
summary: 'On feature-release (FR) branches such as 5.1.2-FR-attachments-for-subcontacts, the build script prefixed the package.json version onto a branch name that already carried it, and the deploy-info routing integration test expected that doubled build string while the API reported the branch name. The fix uses FR branch names as the version base in scripts/build/versions.js and makes the test expect the semver-valid build_info.version first, as the API does.'
services:
  - api
techStack:
  - javascript
  - nodejs
  - mocha
  - github-actions
tags:
  - versioning
  - build-scripts
  - feature-release
  - deploy-info
  - ci
  - upgrade-lifecycle
related_workflows: []
source_pr: medic/cht-core#11122
source_sha: 95d32ce5ad6d0b11fcc271d715c17d91e5f91a05
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - scripts/build/versions.js
  - tests/integration/api/routing.spec.js
concepts:
  - version computation
  - feature-release branches
  - build pipeline
  - deploy-info
  - semantic versioning
related_issues: []
stale: false
---

## Problem

The integration test 'routing > unauthenticated routing > should display deploy-info to authenticated users' in `tests/integration/api/routing.spec.js` failed in CI on the feature-release branch "5.1.2-FR-attachments-for-subcontacts". In the AssertionError quoted in issue #11118 (a chai "+ expected - actual" diff), the API returned version "5.1.2-FR-attachments-for-subcontacts" while the test expected "5.1.2-5.1.2-FR-attachments-for-subcontacts.26500616089-1779871558803"; the issue's own prose names the two values the other way round.

## Root Cause

Two things combined. At this PR's parent, `getBranchVersion` in `scripts/build/versions.js` always used ``const base = `${packageJson.version}-${branch}`;``, so a branch already named "5.1.2-FR-attachments-for-subcontacts" got the base "5.1.2-5.1.2-FR-attachments-for-subcontacts"; branch builds then append `.` plus `BUILD_NUMBER`, `setDdocsVersion` in `scripts/build/index.js` appends a timestamp, and that string is copied into `build_info.build`. Meanwhile the API's `getVersionFromDdoc` in `shared-libs/server-info/src/index.js` reports `semver.valid(ddoc.build_info?.version)` first, and for branch builds `build_info.version` is the escaped branch name, which for an FR branch is itself valid semver. The test, at this PR's parent, always expected `build_info.build` for branch builds (`version: isBranchBuild ? ddoc.build_info.build : ddoc.build_info.version`), which only agrees with the API when the branch name is not valid semver.

## Solution

`scripts/build/versions.js` gains `const FEATURE_RELEASE_BRANCH_PATTERN = /^\d+\.\d+\.\d+-FR-.+/;` and `isFeatureReleaseBranch`, and `getBranchVersion` now uses ``const base = isFeatureReleaseBranch(branch) ? branch : `${packageJson.version}-${branch}`;``, so an FR branch is versioned from its own name without the doubled prefix. `tests/integration/api/routing.spec.js` now expects `const branchVersion = semver.valid(ddoc.build_info.version) || ddoc.build_info.build;` for branch builds, mirroring the first check in `getVersionFromDdoc`.

## Code Patterns

Detect branch names that already carry a semver version (`FEATURE_RELEASE_BRANCH_PATTERN` in `scripts/build/versions.js`) and use them as the version base instead of prefixing the `package.json` version again. In `tests/integration/api/routing.spec.js`, derive the expected deploy-info version with the same semver-first rule the API applies rather than hardcoding which `build_info` field a branch build reports.

## Design Choices

The PR changed both sides: the build script stops producing the doubled "5.1.2-5.1.2-FR-attachments-for-subcontacts" version for FR branches, and the test expectation now follows the API's semver-first rule. The API code in `shared-libs/server-info/src/index.js` was not changed. The removed test comment ("for historical reasons, for a branch the version in the ddoc is the branch name.") was replaced by one explaining that tags report the tag, and branches report the escaped branch name when it is valid semver (e.g. feature-release branches like `5.1.2-FR-foo`) and otherwise `build_info.build`.

## Related Files

- scripts/build/versions.js
- tests/integration/api/routing.spec.js

## Testing

The existing integration test in `tests/integration/api/routing.spec.js` ('should display deploy-info to authenticated users') now computes the expected branch-build version as `semver.valid(ddoc.build_info.version) || ddoc.build_info.build`. No unit test was added for `isFeatureReleaseBranch`.

## Related Issues

- #11118: "Routing test fails for feature release branches" — this draft's issue.

## Domain Rationale

**Fit:** strong

The PR modifies release/build tooling (scripts/build/versions.js) that computes version strings during the build/deploy pipeline; CI/build/deploy and upgrade-lifecycle work is canonically infrastructure, not configuration.
