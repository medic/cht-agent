---
id: cht-core-8775
category: improvement
domain: infrastructure
domainFit: strong
issueNumber: 8775
issueUrl: https://github.com/medic/cht-core/issues/8775
title: Read the CHT builds-server URL from an environment variable instead of hardcoding it in the API and admin upgrade controllers
lastUpdated: '2026-06-23'
summary: The builds-server URL used by the in-app upgrade feature to discover available CHT versions was hardcoded; this change reads it from an environment variable so the build source can be configured per deployment.
services:
  - api
  - admin
techStack:
  - javascript
  - nodejs
  - angularjs
  - express
tags:
  - upgrade
  - environment-variable
  - builds-url
  - configuration
  - self-upgrade
  - env-var
related_workflows: []
source_pr: medic/cht-core#8775
source_sha: 4513f419d7db06d79baa3f38316b26e4be23b04f
distilled_at: '2026-06-23'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - api/src/controllers/upgrade.js
  - admin/src/js/controllers/upgrade.js
concepts:
  - environment-variable configuration
  - upgrade tooling
  - builds server URL
  - self-upgrade
  - configurable external service endpoint
related_issues: []
stale: false
---

## Problem

The URL of the CHT builds server — used by the in-app upgrade feature to list and fetch available versions/builds — was hardcoded in the API and admin upgrade controllers, so the build source could not be pointed elsewhere (e.g. a test or self-hosted builds server) without changing code.

## Root Cause

The builds-server URL was embedded as a hardcoded value in api/src/controllers/upgrade.js and the corresponding admin controller rather than being sourced from an environment variable / configuration.

## Solution

Updated the upgrade controllers to read the builds URL from an environment variable instead of the hardcoded constant, so operators can override the build source per deployment while preserving the existing default behaviour.

## Code Patterns

Source an external-service endpoint from process.env (with a sensible default) rather than hardcoding it — applied in api/src/controllers/upgrade.js and propagated to admin/src/js/controllers/upgrade.js so the admin UI resolves the same configured URL.

## Design Choices

An environment variable was chosen so the default builds source is unchanged for existing installs while allowing operators to override it (testing, staging, or self-hosted builds) without code changes — preferable to a hardcoded constant or a new persisted setting.

## Related Files

- api/src/controllers/upgrade.js
- admin/src/js/controllers/upgrade.js
- api/tests/mocha/controllers/upgrade.spec.js
- api/tests/mocha/routing.spec.js
- admin/tests/unit/controllers/upgrade.spec.js

## Testing

Unit tests were added/updated for both the API upgrade controller (api/tests/mocha/controllers/upgrade.spec.js) and the admin upgrade controller (admin/tests/unit/controllers/upgrade.spec.js), plus routing coverage in api/tests/mocha/routing.spec.js, to verify the builds URL is resolved from the environment variable.

## Related Issues

- #8038: use builds url from env var

## Domain Rationale

**Fit:** strong

This changes the upgrade tooling — specifically how the app discovers available CHT builds for self-upgrade — by sourcing the builds-server URL from configuration. Upgrade lifecycle and build/deploy tooling are explicitly infrastructure concerns, not application behavior, so this is a strong fit.
