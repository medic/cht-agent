---
id: cht-core-8965
category: bug
domain: infrastructure
domainFit: strong
issueNumber: 8965
issueUrl: https://github.com/medic/cht-core/issues/8965
title: Fix admin upgrade page version check comparing a version to a build identifier after deploy-info API change
lastUpdated: '2026-06-23'
summary: After the deploy-info API change (#8790), the admin upgrade page compared a plain version (4.6.0) against a build identifier (4.6.0.432424242), so it always reported the upgrade as not completed and showed an error card even on success. The version-check logic was corrected to compare the values consistently.
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
related_issues: []
stale: false
---

## Problem

On the admin app upgrade page, completed upgrades were incorrectly reported as not completed — an error card was shown even when the upgrade succeeded. This occurred because the page compared the target version string (e.g. 4.6.0) against a build identifier (e.g. 4.6.0.432424242), which never matched.

## Root Cause

The deploy-info API change in #8790 altered the shape of the version/build information returned to the admin app. The upgrade controller's completion check still compared a bare semantic version against a value that now carried a build-number suffix, so the equality check always failed and the upgrade was deemed incomplete.

## Solution

Updated the upgrade-completion comparison in admin/src/js/controllers/upgrade.js to reconcile with the new deploy-info format (normalizing/extracting the comparable version from the build identifier) so a successful upgrade is detected correctly. Unit tests were updated to cover the version-vs-build comparison.

## Code Patterns

When comparing deploy-info values, normalize a build identifier (version + build number suffix, e.g. 4.6.0.432424242) down to its semantic version before equality-checking against a target version, rather than comparing the raw strings — see admin/src/js/controllers/upgrade.js.

## Design Choices

Adapt the admin upgrade page's comparison to the new deploy-info API contract rather than reverting the upstream API change, keeping the fix localized to the consumer (admin controller) that broke.

## Related Files

- admin/src/js/controllers/upgrade.js
- admin/tests/unit/controllers/upgrade.spec.js

## Testing

Unit tests in admin/tests/unit/controllers/upgrade.spec.js were updated to exercise the corrected version-vs-build comparison. Reviewer jkuester also manually reproduced and verified the fix by spinning up a docker-helper instance, installing the 4.6.0-beta.4 build, upgrading to 4.6.0 via the admin app, and confirming the upgrade-completion behavior of the error card.

## Related Issues

- #8940: admin upgrade page always reports the upgrade as not completed
- #8790: deploy-info API change altered the returned version/build information format

## Domain Rationale

**Fit:** strong

The admin upgrade page is upgrade-lifecycle tooling (operators use it to move a deployment between CHT versions), which the domain rubric explicitly enumerates under infrastructure. The bug is in detecting whether a version upgrade completed, not in any functional application feature.
