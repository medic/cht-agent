---
id: cht-core-8940
category: bug
domain: infrastructure
domainFit: strong
issueNumber: 8940
issueUrl: https://github.com/medic/cht-core/issues/8940
title: Fix admin upgrade page version check comparing a version to a build identifier after deploy-info API change
lastUpdated: '2026-10-01'
summary: After the deploy-info change for #8790 made its `version` a plain semver (4.6.0), the admin upgrade page still compared it with the target build identifier (4.6.0.432424242), so upgrades to tagged releases were reported as not completed and showed an error card even on success. The check now compares the target build with the deploy-info `build` field.
services:
  - admin
techStack:
  - javascript
  - angularjs
tags:
  - upgrade
  - version-check
  - deploy-info
  - semver
  - admin-app
  - regression
related_workflows: []
source_pr: medic/cht-core#8965
source_sha: dbc697f042396ecd6175ca15bb7718d2cab69a86
distilled_at: '2026-06-23'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - admin/src/js/controllers/upgrade.js
concepts:
  - semantic versioning
  - build vs version identifier
  - upgrade completion detection
  - deploy-info API contract
related_issues:
  - cht-core-8790
stale: false
---

## Problem

On the admin app upgrade page, completed upgrades were incorrectly reported as not completed — an error card was shown even when the upgrade succeeded. This occurred because the page compared the target build identifier (`$scope.upgradeDoc.to.build`, e.g. 4.6.0.432424242) against the `version` returned by `/api/deploy-info`, which since the #8790 fix is a plain version (e.g. 4.6.0), so the two never matched for a tagged release.

## Root Cause

Since the #8790 fix (PR #8794), `/api/deploy-info` returns as `version` the first semver-valid value of `ddoc.build_info?.version` and `ddoc.deploy_info?.build` (in api/src/services/deploy-info.js at this PR; on master in shared-libs/server-info/src/index.js) — for a tag build, the bare tag — while the build identifier is returned in `build`. Before this PR, the completion check in `getExistingDeployment` (admin/src/js/controllers/upgrade.js) still compared `expectedVersion`, taken from `$scope.upgradeDoc.to.build`, with `deployInfo.version`, so the equality check failed and the page logged `instance.upgrade.error.deploy` instead of treating the upgrade as complete.

## Solution

A one-line fix in admin/src/js/controllers/upgrade.js. Before this PR, the completion check was `expectedVersion === deployInfo.version`; it is now `expectedVersion === deployInfo.build`, comparing the target build with the deployed build so a successful upgrade is detected and `reloadPage` runs. Unit tests were updated so their deploy-info and upgrade-doc fixtures carry `build` values distinct from `version`.

## Code Patterns

When checking whether an upgrade landed, compare like with like: the target's `build` from the upgrade doc against the deploy-info `build`, not against its `version`, which has been normalized to semver since the #8790 fix and, for tag builds, no longer carries the build-number suffix — see admin/src/js/controllers/upgrade.js.

## Design Choices

Adapt the admin upgrade page's comparison to the new deploy-info API contract rather than reverting the upstream API change, keeping the fix localized to the consumer (admin controller) that broke.

## Related Files

- admin/src/js/controllers/upgrade.js
- admin/tests/unit/controllers/upgrade.spec.js

## Testing

Unit tests in admin/tests/unit/controllers/upgrade.spec.js were updated to exercise the corrected build-to-build comparison: the upgrade-doc and deploy-info fixtures now carry build identifiers (e.g. `build: '4.2.0.134'`) alongside plain versions. The check runs in the admin app that was loaded before the upgrade (on success `reloadPage` only re-enters the `upgrade` state), so a fix to it is only visible on upgrades started from a version that already contains it. The PR author published 4.7.0 and 4.8.0 builds to a local staging server: starting from 4.6.0, the upgrade to 4.7.0 still showed the error, and the next upgrade, to 4.8.0, did not. A reviewer saw the error card after upgrading a docker-helper instance from 4.6.0-beta.4 to 4.6.0 in the admin app. The reviewer then disabled the image pull in a local build of the upgrade service, retagged this PR's branch images as 4.6.0-beta.4, re-created the instance, and saw the same upgrade complete without the error card.

## Related Issues

- #8940: "Admin app shows error after successful upgrade" — upgrading to the 4.6.0 beta tags showed the installation error card even though the installation succeeded
- #8790: "`/api/deploy-info.version` is not semver valid for final releases" — its fix (PR #8794) made the deploy-info `version` a plain semver, which broke this check

## Domain Rationale

**Fit:** strong

The admin upgrade page is upgrade-lifecycle tooling (operators use it to move a deployment between CHT versions). The bug is in detecting whether a version upgrade completed — comparing the upgrade doc's target build with what `/api/deploy-info` reports once the new version is running — not in any functional application feature.
