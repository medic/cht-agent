---
id: cht-core-8599
category: bug
domain: infrastructure
domainFit: strong
issueNumber: 8599
issueUrl: https://github.com/medic/cht-core/issues/8599
title: Support special characters in the CouchDB admin password in the CouchDB entrypoint, cluster set-up script, and haproxy-healthcheck
lastUpdated: '2026-10-01'
summary: "CouchDB's set-up script failed to create the system databases when the admin password contained special characters (issue #8599), because couchdb/set-up-cluster.sh (like couchdb/docker-entrypoint.sh) spliced raw credentials into curl URLs and, for `_cluster_setup`, into JSON bodies. The fix passes credentials to curl with `-u`, JSON-escapes the password, percent-encodes it in the haproxy-healthcheck `_membership` URL, and runs the reworked bats suite against a special-character password under a path-filtered CI workflow."
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
  - passing credentials with curl -u instead of URL userinfo
  - JSON-escaping secrets in hand-built request bodies
  - Docker container initialization scripts
  - haproxy-healthcheck CouchDB membership probe
  - shell-script credential handling
  - path-filtered CI test execution
related_issues: []
stale: true
---

> **Paths are as of this PR, not as of master.** On master, PR #9963 (`4fd02e6a2`, 2025-05-28) replaced the bats suite with couchdb/tests/couch-cluster.spec.js and deleted couchdb/tests/tests.bats, couchdb/tests/tests.sh, couchdb/tests/test_helper/ and .github/workflows/test_couchdb.yml; PR #10500 (`1c3277c4e`) removed the scripts/deploy/ directory, including scripts/deploy/README.md.

## Problem

Before this PR, a CouchDB admin password containing special characters broke the CouchDB image's set-up scripts. Issue #8599 reports a single-node deployment whose couchdb/set-up-cluster.sh failed silently when creating the system databases; the same raw-credential pattern ran through the cluster-setup calls in couchdb/set-up-cluster.sh, the `COUCHDB_SYNC_ADMINS_NODE` calls in couchdb/docker-entrypoint.sh, and the `_membership` URL built by haproxy-healthcheck/check.py.

## Root Cause

Before this PR, couchdb/docker-entrypoint.sh, couchdb/set-up-cluster.sh and haproxy-healthcheck/check.py embedded the raw username and password in CouchDB URLs — for example `curl -s http://$COUCHDB_USER:$COUCHDB_PASSWORD@$SVC_NAME:5984/_membership` (unquoted) in couchdb/set-up-cluster.sh and `return f"http://{username}:{password}@{couchdb_url}:5984/_membership"` in haproxy-healthcheck/check.py — so URL-reserved characters corrupted the URL and unquoted expansions were subject to word splitting and globbing. couchdb/set-up-cluster.sh also spliced the password unescaped into the JSON bodies it POSTs to `_cluster_setup` (`"password":"'$COUCHDB_PASSWORD'"`), so a `"` or `\` broke the JSON.

## Solution

couchdb/set-up-cluster.sh and couchdb/docker-entrypoint.sh now pass credentials to curl with `-u "$COUCHDB_USER:$COUCHDB_PASSWORD"`, keep them out of the URL (for example `check_if_couchdb_is_ready "http://$SVC_NAME:5984"`), and quote the URL and credential arguments. The `_cluster_setup` JSON bodies use `json_escaped_couchdb_password`, which escapes `\` and then `"` in the password (`${COUCHDB_PASSWORD//\\/\\\\}`, then `${json_escaped_couchdb_password//\"/\\\"}`). haproxy-healthcheck/check.py percent-encodes the password with `urllib.parse.quote(os.environ["COUCHDB_PASSWORD"])` before building its `_membership` URL; only the password is escaped or encoded, not the username. haproxy/entrypoint.sh only gained a `# shellcheck disable=SC2153` directive. couchdb/Dockerfile's test stage moved from `ghcr.io/ffurrer2/bats:1.6.0` to `alpine:3` with `apk --no-cache add bash bats curl jq openssl`, couchdb/README.md now documents `make test` in couchdb/tests, and scripts/deploy/README.md gained a link to the medic/helm-charts repository. The bats runner moved from couchdb/test.couchdb-cluster.yml, which was deleted, to the new couchdb/tests/compose.yml and couchdb/tests/Makefile (see Testing), and the new .github/workflows/test_couchdb.yml runs it only when files under couchdb/ change. The `COUCH_URL` helm-chart change was intentionally left out of this PR.

## Code Patterns

Keep credentials out of URLs in shell scripts: pass them with `curl -u "$COUCHDB_USER:$COUCHDB_PASSWORD"` and quote the URL (couchdb/set-up-cluster.sh, couchdb/docker-entrypoint.sh). When a secret must go into a hand-built JSON body, escape `\` and `"` first (`json_escaped_couchdb_password` in couchdb/set-up-cluster.sh). When a client needs userinfo in a URL, percent-encode it (`urllib.parse.quote` in haproxy-healthcheck/check.py). Test with a deliberately hostile password exported by couchdb/tests/Makefile. At this PR, the bats helpers were vendored under couchdb/tests/test_helper/ to avoid an extra build step, and .github/workflows/test_couchdb.yml gated the slow suite on `couchdb/**` paths.

## Design Choices

At this PR, embedded the bats test_helper libraries directly rather than adding a dependency/build step, justified by their permissive license. Ran the CouchDB tests in CI only when the couchdb folder changes, since it is a low-churn directory and the suite took around 17 seconds on the author's machine. Deferred the COUCH_URL helm chart update, considering chart changes belong in a versioned helm-charts repository; PR #8996, this PR's prerequisite, merged the same day and deleted the in-repo scripts/deploy/helm/cht-chart so cht-deploy used the medic/helm-charts repository. On master the chart is back in this repository under scripts/build/helm (PR #10051), and scripts/build/helm/templates/couchdb/credentials.yaml builds `COUCH_URL` with `{{ .Values.couchdb.password | urlquery }}`.

The PR does not change how api and sentinel receive credentials: at this PR, scripts/build/cht-core.yml.template still builds their `COUCH_URL` from the raw `COUCHDB_PASSWORD`, and api/src/environment.js parses it with `new URL(couchUrl)`, so api still failed to start with a password containing such characters, and the PR merged with that limitation acknowledged.

## Related Files

- .github/workflows/test_couchdb.yml (present at this PR's anchor; removed on master by PR #9963)
- couchdb/Dockerfile
- couchdb/README.md
- couchdb/docker-entrypoint.sh
- couchdb/set-up-cluster.sh
- couchdb/test.couchdb-cluster.yml (deleted)
- couchdb/tests/Makefile (added)
- couchdb/tests/compose.yml (added)
- couchdb/tests/tests.bats (present at this PR's anchor; removed on master by PR #9963, which replaced the bats suite with couchdb/tests/couch-cluster.spec.js)
- couchdb/tests/tests.sh (present at this PR's anchor; removed on master by PR #9963)
- haproxy-healthcheck/check.py
- haproxy/entrypoint.sh
- scripts/deploy/README.md (present at this PR's anchor; removed on master with scripts/deploy/ by PR #10500)

## Testing

The existing bats suite in couchdb/tests/tests.bats and couchdb/tests/tests.sh was reworked: every curl call in couchdb/tests/tests.bats switched to passing credentials with `-u` instead of URL userinfo, the helpers were loaded from the vendored couchdb/tests/test_helper/bats-support and couchdb/tests/test_helper/bats-assert instead of `/opt/`, the `cluster set up state shows finshed` case was dropped, and couchdb/tests/tests.sh waits for the cluster by running `verify_membership` from couchdb/set-up-cluster.sh. The new couchdb/tests/Makefile exports `COUCHDB_USER := medic-test-admin` and a `COUCHDB_PASSWORD` containing `~`, `!`, `@`, `#`, `$`, `%`, `^`, `&`, `*`, a backtick, a backslash, both quote characters and brackets, brings up three CouchDB nodes from the new couchdb/tests/compose.yml, and runs the suite in its `sut` container. The new .github/workflows/test_couchdb.yml runs `make test` in couchdb/tests on pushes and pull requests that touch `couchdb/**`.

## Related Issues

- #8599: "CouchDB single-node set-up script fails at creating system db's if admin pw contains special characters" — the issue this PR resolves
- PR #8996: "feat: Use helm repo for cht-deploy" — the prerequisite that moved the cht-deploy chart out of this repository before this PR merged

## Domain Rationale

**Fit:** strong

The change is confined to operational/deployment artifacts — the CouchDB image's entrypoint and cluster set-up script, the haproxy-healthcheck, their tests, and a CI workflow — fixing how the CouchDB admin password is passed to curl and embedded in connection strings. This is deployment-lifecycle work (Docker/HAProxy/CI), not application-level auth, sessions, or permissions.
