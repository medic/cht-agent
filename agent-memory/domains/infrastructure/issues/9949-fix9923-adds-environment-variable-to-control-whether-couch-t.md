---
id: cht-core-9923
category: bug
domain: infrastructure
domainFit: strong
issueNumber: 9923
issueUrl: https://github.com/medic/cht-core/issues/9923
title: Add environment variable to control whether CouchDB overrides the system ulimit on container startup
lastUpdated: '2026-10-01'
summary: CouchDB failed to start in environments that do not allow setting `ulimit` because the Docker entrypoint unconditionally tried to override the system ulimit. The fix gates this behavior behind the `DEFAULT_ULIMIT` environment variable (defaulting to existing behavior) and adds remediation-oriented logging.
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

On hosts/systems that do not allow setting `ulimit` (e.g. locked-down or restricted environments), the CouchDB container failed to start, blocking deployment and upgrades. The issue reproduces it with the 4.17 CouchDB compose file on an EC2 t2.micro, where the container exits with `ulimit: error setting limit (Operation not permitted)`.

## Root Cause

Before this PR, couchdb/docker-entrypoint.sh unconditionally ran `su -c "ulimit -n 100000 && exec $@" couchdb` to raise the open-file-descriptor limit on startup; when the system forbade modifying ulimit, that command failed and aborted CouchDB container startup.

## Solution

Introduced the `DEFAULT_ULIMIT` environment variable in couchdb/docker-entrypoint.sh. When `"$DEFAULT_ULIMIT" = true`, the entrypoint reassigns `DEFAULT_ULIMIT=$(ulimit)`, logs `WARNING: Starting CouchDb using system default ulimit of $DEFAULT_ULIMIT` (so the message shows that `$(ulimit)` value) and starts CouchDB with `su -c "exec $*" couchdb`, keeping the system-provided limits instead of failing. Otherwise it still runs `su -c "ulimit -n 100000 && exec $*" couchdb`, and on a non-zero exit prints "CouchDb failed to start. If the reported error is 'ulimit: error setting limit (Operation not permitted)', set the DEFAULT_ULIMIT environment variable to true and restart the service." before exiting with the same code. The other three files carry upgrade-flow diagnostics unrelated to the variable: admin/src/js/controllers/upgrade.js now logs `$log.error('expected version', expectedVersion, 'does not match current version', deployInfo.build);` before reporting a deploy error, tests/e2e/upgrade/wdio.conf.js calls `await utils.saveLogs();` in `tearDownServices`, and tests/utils/index.js exports its existing `saveLogs`.

## Code Patterns

Gate optional, environment-specific startup behavior behind an environment variable in couchdb/docker-entrypoint.sh instead of running it unconditionally, and emit actionable operator-facing log messages describing the error and the fix. Note that the warning prints `$(ulimit)`, the shell's default (file-size) limit, not the `ulimit -n` open-files value the other branch sets.

## Design Choices

Implemented as an environment-variable toggle that preserves the existing ulimit-override behavior by default, so current deployments are unaffected while constrained environments can opt out — backwards compatible with no data/config migration required. No compose template or Helm chart in the repo sets `DEFAULT_ULIMIT`, at this PR or on master; operators add it to the CouchDB container environment themselves.

## Related Files

- couchdb/docker-entrypoint.sh
- admin/src/js/controllers/upgrade.js
- tests/e2e/upgrade/wdio.conf.js
- tests/utils/index.js

## Testing

No test exercises `DEFAULT_ULIMIT`. The changes to the e2e upgrade WebdriverIO config (tests/e2e/upgrade/wdio.conf.js) and shared test utilities (tests/utils/index.js) only save the services' logs (per container, or per pod under K3D) when the upgrade suite tears down its services.

## Related Issues

- #9923: "CouchDb fails to start when system does not allow setting `ulimit`" — this draft's issue; the CouchDB container exits with `ulimit: error setting limit (Operation not permitted)` on hosts that forbid raising the limit.

## Domain Rationale

**Fit:** strong

The change modifies the CouchDB Docker entrypoint script to control container runtime behavior (whether to override the system ulimit), and adds upgrade-flow diagnostics in the admin upgrade controller and the e2e upgrade teardown — operational/deployment lifecycle (Docker runtime + upgrade tooling), which is the canonical infrastructure domain.
