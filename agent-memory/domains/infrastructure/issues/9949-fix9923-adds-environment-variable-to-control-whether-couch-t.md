---
id: cht-core-9923
category: bug
domain: infrastructure
domainFit: strong
issueNumber: 9923
issueUrl: https://github.com/medic/cht-core/issues/9923
title: Add environment variable to control whether CouchDB overrides the system ulimit on container startup
lastUpdated: '2026-06-22'
summary: CouchDB failed to start in environments that do not permit running the `ulimit` command because the Docker entrypoint unconditionally tried to override the system ulimit. The fix gates this behavior behind an environment variable (defaulting to existing behavior) and adds remediation-oriented logging.
services:
  - admin
techStack:
  - couchdb
  - docker
  - bash
  - javascript
  - webdriverio
tags:
  - ulimit
  - couchdb-startup
  - docker-entrypoint
  - environment-variable
  - file-descriptor-limit
  - container-startup
  - upgrade
related_workflows: []
source_pr: medic/cht-core#9949
source_sha: 6af6906eeaed8396f823bbe326a46a1d14d1bf72
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - couchdb/docker-entrypoint.sh
  - admin/src/js/controllers/upgrade.js
concepts:
  - Docker container entrypoint/startup
  - system resource limits (ulimit / open-file-descriptor limits)
  - environment-variable feature gating
  - CouchDB deployment runtime
  - upgrade tooling
  - backwards-compatible opt-out configuration
related_issues: []
stale: false
---

## Problem

On hosts/systems that disallow running the `ulimit` command (e.g. locked-down or restricted environments), the CouchDB container failed to start, blocking deployment and upgrades.

## Root Cause

couchdb/docker-entrypoint.sh unconditionally invoked `ulimit` to raise the open-file-descriptor limit on startup; when the system forbade modifying ulimit, that command failed and aborted CouchDB container startup.

## Solution

Introduced an environment variable that controls whether the entrypoint attempts to override the system ulimit. When disabled, CouchDB starts using the system-provided limits instead of failing. Added clear logging that explains the failure and how to remediate it, and updated the admin upgrade controller plus e2e upgrade test config/utilities to account for the new variable.

## Code Patterns

Gate optional, environment-specific startup behavior behind an environment variable in docker-entrypoint.sh instead of running it unconditionally, and emit actionable operator-facing log messages describing the error and the fix (couchdb/docker-entrypoint.sh).

## Design Choices

Implemented as an environment-variable toggle that preserves the existing ulimit-override behavior by default, so current deployments are unaffected while constrained environments can opt out — backwards compatible with no data/config migration required.

## Related Files

- couchdb/docker-entrypoint.sh
- admin/src/js/controllers/upgrade.js
- tests/e2e/upgrade/wdio.conf.js
- tests/utils/index.js

## Testing

Updated the e2e upgrade WebdriverIO config (tests/e2e/upgrade/wdio.conf.js) and shared test utilities (tests/utils/index.js) to support/exercise the new environment variable through the upgrade flow.

## Related Issues

- #9923: CouchDB fails to start when the system does not allow running the `ulimit` command

## Domain Rationale

**Fit:** strong

The change modifies the CouchDB Docker entrypoint script and the upgrade tooling/e2e upgrade tests to control container runtime behavior (whether to override the system ulimit) — pure operational/deployment lifecycle (Docker runtime + upgrade tooling), which is the canonical infrastructure domain.
