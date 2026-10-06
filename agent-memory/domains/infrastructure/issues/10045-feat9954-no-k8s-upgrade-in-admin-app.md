---
id: cht-core-9954
category: feature
domain: infrastructure
domainFit: strong
issueNumber: 9954
issueUrl: https://github.com/medic/cht-core/issues/9954
title: Add API endpoint to detect the Docker upgrade service and hide the 1-click upgrade button in the admin app on Kubernetes deployments
lastUpdated: '2026-10-05'
summary: Kubernetes-hosted instances use a limited upgrade-service-kubernetes that cannot perform full deployments, so offering the 1-click upgrade button there is misleading. This PR adds an API endpoint that reports whether the upgrade service is the Docker upgrade service, and the admin app hides its Install buttons when it is not, while the Stage buttons stay available.
services:
  - api
  - admin
techStack:
  - javascript
  - nodejs
  - angularjs
  - docker
  - kubernetes
  - mocha
tags:
  - upgrade
  - 1-click-upgrade
  - upgrade-service
  - kubernetes
  - docker
  - admin-app
  - deployment
related_workflows: []
source_pr: medic/cht-core#10045
source_sha: 9dcd227143dfab40a6bf9834d1d181c88f8e2045
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - api/src/services/setup/upgrade.js
  - api/src/services/setup/utils.js
  - api/src/controllers/upgrade.js
  - api/src/routing.js
  - admin/src/js/controllers/upgrade.js
  - admin/src/js/directives/release.js
concepts:
  - upgrade service detection
  - deployment lifecycle
  - capability/backend detection via API
  - conditional UI rendering
related_issues: []
stale: false
---

## Problem

For instances hosted in Kubernetes, 1-click upgrades rely on the separate upgrade-service-kubernetes, which lacks critical functions: it cannot perform a fresh deployment on its own, cannot add new services/containers, does not keep versions in sync with the original deployment tool, and has no clear upgrade path of its own. Issue #9954 records two failures: an instance redeployed with the original deployment tool after an upgrade, without updating the version in its values files, was downgraded to an older version, and the CouchDB Nouveau deployment that newer CHT versions require would need manual upgrades. Despite this, the admin app always presented the 1-click upgrade button, offering an action the k8s upgrade service cannot properly perform.

## Root Cause

The admin app rendered the upgrade button unconditionally, with no mechanism to detect whether the deployment was backed by the full-featured Docker upgrade service or the limited Kubernetes upgrade service.

## Solution

Added `app.get('/api/v2/upgrade/can-upgrade', upgrade.canUpgrade);` in api/src/routing.js. The `canUpgrade` controller in api/src/controllers/upgrade.js checks auth and responds `{ ok: await service.canUpgrade() }`; `canUpgrade` in api/src/services/setup/upgrade.js delegates to `isDockerUpgradeServiceRunning` in api/src/services/setup/utils.js, which sends a GET to `UPGRADE_SERVICE_URL` and returns `!!response.ok`, so a response without `ok` (another upgrade service) or a failed request yields false. The admin upgrade controller (admin/src/js/controllers/upgrade.js) starts with `$scope.canUpgrade = false;`, sets it from the endpoint's `ok` field during page setup (`getCanUpgrade`), and passes it to each release row through a `canUpgrade` binding that the release directive (admin/src/js/directives/release.js) gained. admin/src/templates/release.html renders the Install button only when `canUpgrade` is set, and the Install button shown after staging completes in admin/src/templates/upgrade.html uses `ng-show="canUpgrade"`. The Stage buttons stay visible, so k8s-hosted instances can still stage upgrades, as the issue asked.

## Code Patterns

Server-side capability detection consumed by the client to gate UI: a route in api/src/routing.js → controller in api/src/controllers/upgrade.js → service logic in api/src/services/setup/upgrade.js and api/src/services/setup/utils.js; the admin controller (admin/src/js/controllers/upgrade.js) fetches the flag and hands it to the release directive (admin/src/js/directives/release.js) through a `canUpgrade` binding, and the templates conditionally render the Install buttons.

## Design Choices

Detection is performed server-side by querying the actual upgrade service rather than relying on a static client-side flag or configuration, so the UI reflects real deployment capability. The endpoint deliberately returns truthy only for the Docker upgrade service, defaulting to hiding the Install buttons for the limited Kubernetes service; the check fails closed, since `$scope.canUpgrade` starts false and an unreachable upgrade service also yields false. Only the Install actions are gated, so staging remains available everywhere.

## Related Files

- admin/src/js/controllers/upgrade.js
- admin/src/js/directives/release.js
- admin/src/templates/release.html
- admin/src/templates/upgrade.html
- admin/tests/unit/controllers/upgrade.spec.js
- api/src/controllers/upgrade.js
- api/src/routing.js
- api/src/services/setup/upgrade.js
- api/src/services/setup/utils.js
- api/tests/mocha/controllers/upgrade.spec.js
- api/tests/mocha/services/setup/upgrade.spec.js
- api/tests/mocha/services/setup/utils.spec.js

## Testing

The existing unit specs gained cases on both tiers: API mocha specs for the controller (api/tests/mocha/controllers/upgrade.spec.js, `canUpgrade` including the auth error) and setup services (api/tests/mocha/services/setup/upgrade.spec.js and api/tests/mocha/services/setup/utils.spec.js, where `isDockerUpgradeServiceRunning` returns false for a `{ message: 'ok' }` response from another upgrade service and for a failed connection), and the admin app unit spec (admin/tests/unit/controllers/upgrade.spec.js) covering how `canUpgrade` is set from the endpoint response and a failing can-upgrade request.

## Related Issues

- #9954: "Hide upgrade button in admin app for k8s deployments, while still allowing staging upgrades" — the Kubernetes upgrade service lacks critical functions (no fresh deployment, no adding new services, no version sync with the original deployment tool, no upgrade path of its own), so 1-click upgrade should be disabled for k8s-hosted instances

## Domain Rationale

**Fit:** strong

The PR concerns the 1-click upgrade/deployment lifecycle tooling — detecting whether the backend upgrade service is the Docker or Kubernetes variant and gating the upgrade UI accordingly. The api side probes the upgrade service at `UPGRADE_SERVICE_URL`, whose answer depends on how the instance is hosted (Docker vs Kubernetes); the admin side only decides whether the Install actions appear, and the Stage flow is untouched.
