---
id: cht-core-11118
category: bug
domain: infrastructure
domainFit: strong
issueNumber: 11118
issueUrl: https://github.com/medic/cht-core/issues/11118
title: Fix build version computation for feature-release branches (broke deploy-info routing integration test)
lastUpdated: '2026-06-22'
summary: The build version script produced incorrect version strings for feature-release (FR) branches, causing the deploy-info served by API to be wrong and breaking an integration test; the fix corrects the version-handling logic in scripts/build/versions.js and aligns the test expectations.
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

The integration test 'routing > unauthenticated routing > should display deploy-info to authenticated users' was failing in CI on feature-release branches. The deploy-info object (including the upgrade_log_id with an embedded version like '5.1.2-...') did not match the expected shape, producing an AssertionError (expected vs actual deploy-info objects differed).

## Root Cause

scripts/build/versions.js did not correctly derive the version string for feature-release (FR) branches, so an incorrect/unexpected version propagated into the build and into the deploy-info reported by the API, diverging from what the routing integration test asserted.

## Solution

Updated the branch-name-based version-handling logic in scripts/build/versions.js so feature-release branches compute the correct version string, and updated tests/integration/api/routing.spec.js so the deploy-info expectations match the corrected version handling.

## Code Patterns

Centralized version derivation in scripts/build/versions.js: distinguish feature-release branches from standard release branches when computing the build version so all downstream consumers (deploy-info, upgrade_log) receive a consistent value.

## Design Choices

Fix the version derivation at its source in the build script rather than patching individual consumers (deploy-info / upgrade log), ensuring every consumer of the build version is correct and keeping the test as a guard against regressions in FR-branch versioning.

## Related Files

- scripts/build/versions.js
- tests/integration/api/routing.spec.js

## Testing

Updated the existing integration test tests/integration/api/routing.spec.js ('should display deploy-info to authenticated users'), which had been failing in CI on feature-release branches, to assert the corrected deploy-info/version output so it passes and guards against regressions.

## Related Issues

- #11118: routing integration test 'should display deploy-info to authenticated users' failing on feature-release branches due to incorrect version handling in the build script

## Domain Rationale

**Fit:** strong

The PR modifies release/build tooling (scripts/build/versions.js) that computes version strings during the build/deploy pipeline; per the seeds, CI/build/deploy and upgrade-lifecycle work is canonically infrastructure, not configuration.
