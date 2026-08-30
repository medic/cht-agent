---
id: cht-core-8599
category: bug
domain: infrastructure
domainFit: strong
issueNumber: 8599
issueUrl: https://github.com/medic/cht-core/issues/8599
title: Support special characters in the CouchDB admin password across Docker entrypoints, HAProxy, and setup scripts
lastUpdated: '2026-06-23'
summary: CouchDB failed to start, cluster, or proxy correctly when the admin password contained URL-reserved special characters because credentials were interpolated into connection URLs without escaping. The fix URL-encodes credentials in the CouchDB/HAProxy entrypoints and healthcheck and adds a bats test suite plus a path-filtered CI workflow.
services:
  - api
  - sentinel
techStack:
  - couchdb
  - docker
  - haproxy
  - bash
  - bats
  - github-actions
  - python
tags:
  - couchdb
  - password
  - special-characters
  - url-encoding
  - credentials
  - docker
  - haproxy
related_workflows: []
source_pr: medic/cht-core#8908
source_sha: 1c3fbfcbf5763b109dd1ab0f20cb1bb27ae3fc6b
distilled_at: '2026-06-23'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - couchdb/docker-entrypoint.sh
  - couchdb/set-up-cluster.sh
  - haproxy/entrypoint.sh
  - haproxy-healthcheck/check.py
  - couchdb/Dockerfile
  - .github/workflows/test_couchdb.yml
  - couchdb/tests/tests.bats
concepts:
  - URL-encoding of credentials in connection strings
  - CouchDB admin authentication via COUCH_URL
  - Docker container initialization scripts
  - HAProxy reverse-proxy backend authentication
  - shell-script credential handling
  - path-filtered CI test execution
related_issues: []
stale: false
---

## Problem

Deployments that set a CouchDB admin password containing special/URL-reserved characters (e.g. @ : / # &) broke during container startup, cluster set-up, and HAProxy proxying, because the username/password were spliced into connection URLs verbatim. A follow-up review also showed API's basic-auth connection to CouchDB throwing a node:internal/url parse error on such passwords.

## Root Cause

The CouchDB docker-entrypoint, cluster setup script, HAProxy entrypoint, and the Python healthcheck built CouchDB connection URLs by directly interpolating raw credentials without percent-encoding, so reserved characters corrupted URL parsing and authentication.

## Solution

URL-encode/escape the admin username and password wherever they are embedded into CouchDB connection URLs in couchdb/docker-entrypoint.sh, couchdb/set-up-cluster.sh, haproxy/entrypoint.sh, and haproxy-healthcheck/check.py, with supporting Dockerfile and README updates. Added a bats-based test suite (couchdb/tests/) with embedded bats-support/bats-assert helpers, a Makefile and compose.yml runner, and a dedicated test_couchdb.yml CI workflow gated to run only when the couchdb/ folder changes. The COUCH_URL helm-chart change was intentionally deferred to a versioned helm-charts repo.

## Code Patterns

Percent-encode credentials before embedding them in connection URLs inside shell/Python startup scripts (couchdb/docker-entrypoint.sh, haproxy/entrypoint.sh, haproxy-healthcheck/check.py); vendor a bats test harness by embedding bats-support/bats-assert under tests/test_helper to avoid an extra build step; gate an infrequent, slow CI job with a path filter (.github/workflows/test_couchdb.yml runs only on couchdb/** changes).

## Design Choices

Embedded the bats test_helper libraries directly rather than adding a dependency/build step, justified by their permissive license. Ran the CouchDB tests in CI only when the couchdb folder changes since it is a low-churn directory and the suite takes ~17s. Deferred the COUCH_URL helm chart update, considering chart changes belong in a versioned helm-charts repository.

## Related Files

- .github/workflows/test_couchdb.yml
- couchdb/Dockerfile
- couchdb/README.md
- couchdb/docker-entrypoint.sh
- couchdb/set-up-cluster.sh
- couchdb/test.couchdb-cluster.yml
- couchdb/tests/Makefile
- couchdb/tests/compose.yml
- couchdb/tests/tests.bats
- couchdb/tests/tests.sh
- haproxy-healthcheck/check.py
- haproxy/entrypoint.sh
- scripts/deploy/README.md

## Testing

Added a bats test suite under couchdb/tests/ (tests.bats, tests.sh) with a Makefile and compose.yml to run them in a container, plus embedded bats-support and bats-assert helper libraries. Added a dedicated .github/workflows/test_couchdb.yml CI workflow that executes the suite only when the couchdb/ folder changes. At review time the e2e tests were still failing on the branch, and the special-character password also broke API's basic-auth CouchDB connection.

## Related Issues

- #8599: Support special characters in CouchDB password

## Domain Rationale

**Fit:** strong

The change is confined to operational/deployment artifacts — CouchDB Docker entrypoints, HAProxy config and healthcheck, setup shell scripts, and a CI workflow — fixing how the CouchDB admin password is embedded in connection strings. This is deployment-lifecycle work (Docker/HAProxy/CI), not application-level auth, sessions, or permissions.
