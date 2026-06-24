---
id: cht-core-9039
category: bug
domain: infrastructure
domainFit: strong
issueNumber: 9039
issueUrl: https://github.com/medic/cht-core/issues/9039
title: Assert CouchDB version compatibility and stop enforcing Node version in server startup checks
lastUpdated: '2026-06-23'
summary: The startup server checks enforced a Node.js version requirement that was causing problems while not reliably asserting CouchDB compatibility; this change makes the checks assert the CouchDB version and ignore (no longer enforce) the Node version.
services:
  - api
  - sentinel
techStack:
  - nodejs
  - javascript
  - couchdb
tags:
  - server-checks
  - preflight-checks
  - couchdb-version
  - node-version
  - version-compatibility
  - startup
  - runtime-dependency
related_workflows: []
source_pr: medic/cht-core#9039
source_sha: 1bfc16c07a3aa63839d972dd05fe23537c3901ae
distilled_at: '2026-06-23'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - shared-libs/server-checks/src/checks.js
  - shared-libs/server-checks/test/checks.js
concepts:
  - preflight startup checks
  - runtime dependency version assertion
  - fail-fast boot validation
  - version compatibility enforcement
related_issues: []
stale: false
---

## Problem

On service startup the server-checks module enforced a Node.js version requirement (issue #9024/#9023), which was problematic — likely rejecting otherwise-supported Node runtimes or being out of date — while the CouchDB version compatibility was not being reliably asserted. This could block or misvalidate boot of API/backend services depending on the runtime environment.

## Root Cause

The version-validation logic in shared-libs/server-checks/src/checks.js coupled startup to a Node.js version assertion and did not (or did not robustly) assert the required CouchDB version, so the wrong dependency was being gated at boot.

## Solution

Updated checks.js to assert the CouchDB version (fail fast if the live CouchDB does not meet the required version) and to remove/ignore the Node.js version check, treating the Node runtime as the operator's responsibility. Unit tests in test/checks.js were updated to cover the new CouchDB assertion and the removal of the Node check.

## Code Patterns

Preflight runtime-dependency checks live in shared-libs/server-checks/src/checks.js and fail fast at boot. To enforce a dependency, compare the live reported version against required bounds and throw; to stop gating on a dependency, drop its check function and its corresponding unit tests in test/checks.js.

## Design Choices

Kept a hard assertion on the CouchDB version because CouchDB compatibility is critical to data integrity and API behavior, while dropping the Node version gate because the Node runtime is an operator/deployment concern that should not block service startup.

## Related Files

- shared-libs/server-checks/src/checks.js
- shared-libs/server-checks/test/checks.js

## Testing

Modified unit tests in shared-libs/server-checks/test/checks.js to verify that the CouchDB version is asserted and that the Node version is no longer checked.

## Related Issues

- #9024: assert couchdb version, ignore node version (PR title issue reference)
- #9023: update server checks (branch/body issue reference)

## Domain Rationale

**Fit:** strong

The server-checks shared library performs preflight runtime-environment validation (CouchDB version compatibility, Node version) at service boot. Asserting/relaxing runtime-dependency versions is operational lifecycle / runtime-dependency maintenance — it governs how the system is deployed and run, not application behavior — which is canonically the infrastructure domain.
