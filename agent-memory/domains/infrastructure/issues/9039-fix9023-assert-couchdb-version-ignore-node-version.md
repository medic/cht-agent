---
id: cht-core-9023
category: improvement
domain: infrastructure
domainFit: strong
issueNumber: 9023
issueUrl: https://github.com/medic/cht-core/issues/9023
title: Assert CouchDB version compatibility and stop enforcing Node version in server startup checks
lastUpdated: '2026-10-01'
summary: The startup server checks exited the process on a Node.js major version below 16, which the published Docker images already fix, while only logging the CouchDB version; this change adds a minimum CouchDB version check (3.3) and keeps the Node version as log output only.
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
  - retry-until-ready startup checks
  - version compatibility enforcement
related_issues:
  - cht-core-9069
stale: true
---

## Problem

Before this PR, the server checks that api and sentinel run at startup (`shared-libs/server-checks/src/checks.js`) exited the process with `process.exit(1)` when the Node.js major version was below `MIN_MAJOR` (16), but only logged the CouchDB version without comparing it to any minimum. Issue #9023 pointed out that the Node check should never fail in production because CHT publishes Docker images with a Node dependency (and its minimum had not been bumped when CHT moved to Node 20), whereas the CouchDB version is defined in a separate Docker image and is more likely to get out of sync.

## Root Cause

The startup checks in `shared-libs/server-checks/src/checks.js` gated boot on the Node.js version, which the published images already fix, and never compared the CouchDB version against a minimum, so the dependency more likely to drift was the one left unchecked.

## Solution

`shared-libs/server-checks/src/checks.js` gained `MIN_COUCHDB_VERSION = { major: 3, minor: 3 }`, and the CouchDB version check now throws an error whose message starts `CouchDB Version ${version} is not supported, minimum is` when the reported version is below it. That check runs inside the CouchDB retry loop together with the admin-party and cluster checks, so an unsupported CouchDB version is logged and retried every second rather than aborting startup. The Node check still logs (now as separate `Node Version:`, `Node Mode:` and `Node Environment Options:` lines) but no longer compares against a minimum; `MIN_MAJOR` was removed. The promise chains in `check`, `getCouchDbVersion` and the CouchDB version check were rewritten with `async`/`await`.

## Code Patterns

The server-checks library runs the environment checks (Node version, `COUCH_URL` shape) once, then runs the CouchDB checks in a loop that logs each error and retries after a second until all pass. A CouchDB check that throws therefore holds startup until CouchDB becomes acceptable instead of exiting. To enforce a CouchDB dependency, compare the reported version against a minimum and throw; to stop gating on a dependency while keeping its diagnostics, remove the comparison and keep the log lines, as this PR did for Node. The comparison `major < MIN_COUCHDB_VERSION.major || minor < MIN_COUCHDB_VERSION.minor` tests the minor version independently of the major, so a release such as 4.0 would be rejected; the line is unchanged on master. On master the loop lives in `shared-libs/server-checks/src/index.js` rather than `shared-libs/server-checks/src/checks.js` (moved by PR #9073 for #9069).

## Design Choices

Added a CouchDB minimum-version check because the CouchDB version is defined in a separate Docker image and is the dependency more likely to get out of sync, and dropped the Node minimum because the published images carry their own Node dependency. The Node version is still logged at startup, as the issue asked, alongside the `NODE_ENV` mode and `NODE_OPTIONS`. The issue's alternative, keeping the Node check as a sanity check for developers running outside Docker and bumping its minimum to Node 20, was not taken.

## Related Files

- shared-libs/server-checks/src/checks.js
- shared-libs/server-checks/test/checks.js

## Testing

In this PR, the existing `shared-libs/server-checks/test/checks.js` dropped the `too old` Node test, was changed to expect the Node check to log three lines (`Node Version: 16.11.1`, `Node Mode: "development"`, then the `Node Environment Options` line), and changed the stubbed CouchDB versions (`'2'`, `'2.2.0'`) to `'3.3.3'`. The case it added as `unsupported version should throw` stubbed version `'2.4.1'` but called `check` with a three-segment `COUCH_URL` and asserted the `must have only one path segment` error, so it never reached the version comparison; no test in this PR asserts the `is not supported` error. PR #9073 (for #9069) later added a test that expects `Error: CouchDB Version 3.2.0 is not supported, minimum is 3.3.0`.

## Related Issues

- #9069: "Server checks test is emitting 10k lines to the console" — its fix, PR #9073 (`42a4b28a9`), split `shared-libs/server-checks/src/checks.js` into individually exported checks, renamed them (`checkNodeVersion`, `checkCouchDbVersion`), moved the retry loop into `shared-libs/server-checks/src/index.js`, and added the first test of the CouchDB version error.

## Domain Rationale

**Fit:** strong

The server-checks shared library validates the runtime environment at api and sentinel boot (`COUCH_URL` shape, CouchDB version, admin-party mode, cluster membership; after this PR the Node version is only logged). Asserting/relaxing runtime-dependency versions is operational lifecycle / runtime-dependency maintenance — it governs how the system is deployed and run, not application behavior — which is canonically the infrastructure domain.
