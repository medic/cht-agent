---
id: cht-core-9954
category: feature
domain: infrastructure
domainFit: strong
issueNumber: 9954
issueUrl: https://github.com/medic/cht-core/issues/9954
title: Add API endpoint to detect the Docker upgrade service and hide the 1-click upgrade button in the admin app on Kubernetes deployments
lastUpdated: '2026-06-22'
summary: Kubernetes-hosted instances use a limited upgrade-service-kubernetes that cannot perform full deployments, so offering the 1-click upgrade button there is misleading. This PR adds an API endpoint that reports whether the upgrade service is the Docker upgrade service, and the admin app hides the upgrade button when it is not.
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

For instances hosted in Kubernetes, 1-click upgrades rely on the separate upgrade-service-kubernetes, which lacks critical functions (it cannot perform a fresh deployment on its own and cannot add new services/containers). Despite this, the admin app always presented the 1-click upgrade button, offering an action the k8s upgrade service cannot properly perform.

## Root Cause

The admin app rendered the upgrade button unconditionally, with no mechanism to detect whether the deployment was backed by the full-featured Docker upgrade service or the limited Kubernetes upgrade service.

## Solution

Added an API endpoint (wired in api/src/routing.js via api/src/controllers/upgrade.js) that queries the upgrade service through api/src/services/setup/upgrade.js and utils.js and returns a truthy value only when the upgrade service is the Docker upgrade service. The admin app's upgrade controller and release directive call this endpoint and hide the upgrade button (release.html / upgrade.html) when the response indicates a non-Docker (Kubernetes) upgrade service.

## Code Patterns

Server-side capability detection consumed by the client to gate UI: new route in api/src/routing.js → controller in api/src/controllers/upgrade.js → service logic in api/src/services/setup/upgrade.js + utils.js; admin app (admin/src/js/controllers/upgrade.js, admin/src/js/directives/release.js) fetches the flag and conditionally renders the upgrade button in the templates.

## Design Choices

Detection is performed server-side by querying the actual upgrade service rather than relying on a static client-side flag or configuration, so the UI reflects real deployment capability. The endpoint deliberately returns truthy only for the Docker upgrade service, defaulting to hiding the button for the limited Kubernetes service.

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

Unit tests added/updated on both tiers: API mocha specs for the controller (api/tests/mocha/controllers/upgrade.spec.js) and setup services (api/tests/mocha/services/setup/upgrade.spec.js, utils.spec.js) covering the upgrade-service detection logic, and an admin app unit spec (admin/tests/unit/controllers/upgrade.spec.js) covering the button-hiding behavior based on the endpoint response.

## Related Issues

- #9954: Kubernetes upgrade service lacks critical functions (no fresh deployment, no adding new services), so 1-click upgrade should be disabled for k8s-hosted instances

## Domain Rationale

**Fit:** strong

The PR concerns the 1-click upgrade/deployment lifecycle tooling — detecting whether the backend upgrade service is the Docker or Kubernetes variant and gating the upgrade UI accordingly. This is operational upgrade tooling, which canonically belongs to infrastructure.
