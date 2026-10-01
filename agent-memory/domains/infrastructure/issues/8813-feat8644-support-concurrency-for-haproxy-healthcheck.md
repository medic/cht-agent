---
id: cht-core-8644
category: bug
domain: infrastructure
domainFit: strong
issueNumber: 8644
issueUrl: https://github.com/medic/cht-core/issues/8644
title: Add concurrency support and build-time frozen dependencies to the haproxy-healthcheck service
lastUpdated: '2026-10-01'
summary: "The haproxy-healthcheck service could stop answering HAProxy for good after a ConnectionResetError (issue #8644) and installed an unpinned Python dependency at startup; this PR rewrites haproxy-healthcheck/check.py on `asyncio` and `httpx` so connections are served concurrently, and bundles frozen, version-pinned dependencies into the container image at build time."
services:
  - api
  - sentinel
techStack:
  - python
  - docker
  - docker-compose
  - haproxy
  - couchdb
  - pytest
tags:
  - haproxy
  - healthcheck
  - concurrency
  - dependency-freezing
  - docker
  - python
  - load-balancer
  - reproducible-builds
related_workflows:
  - observability
source_pr: medic/cht-core#8813
source_sha: 3c3accebdfba8db7ad2c5261eeb75da79e7ad56c
distilled_at: '2026-06-23'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - haproxy-healthcheck/check.py
  - haproxy-healthcheck/logger.py
  - haproxy-healthcheck/Dockerfile
  - haproxy-healthcheck/compose.yml
  - haproxy-healthcheck/pyproject.toml
  - haproxy-healthcheck/requirements/base-freeze.txt
  - haproxy-healthcheck/check-entrypoint.sh
concepts:
  - load balancer health check
  - concurrent connection handling
  - dependency pinning/freezing
  - build-time vs runtime dependency installation
  - reproducible container builds
  - deployment resilience
related_issues: []
stale: true
---

## Problem

Issue #8644 reported the healthcheck staying down after it hit a ConnectionResetError while couchdb.1 was down for an extended period, which left HAProxy treating the CouchDB cluster as down and API reporting no connection to a server. Before this PR, the haproxy-healthcheck service handled only a single connection at a time and could hang indefinitely if a connection wasn't closed properly. It also installed its Python dependency at container startup (haproxy-healthcheck/check-entrypoint.sh ran an unpinned `pip install requests`), so a PyPI outage or an incompatible upstream dependency release could prevent an already-deployed service from starting.

## Root Cause

Before this PR, `Main()` in haproxy-healthcheck/check.py called `print_lock.acquire()` after each accept and handed the connection to `start_new_thread(threaded, (conn,))`; the worker released the lock only at its end. Connections were therefore served one at a time, and when `conn.send` raised inside the worker's `finally` block (the ConnectionResetError in the issue's traceback), the worker exited before `print_lock.release()`, so the next `print_lock.acquire()` in `Main()` blocked forever and no further checks were answered. Dependencies were not baked into the image — they were resolved and installed unpinned at startup, making service availability dependent on PyPI reachability and whatever 'latest' versions happened to be published.

## Solution

Rewrote haproxy-healthcheck/check.py on `asyncio`: `await asyncio.start_server(` serves port 5555 and runs each connection in its own `handle_healthcheck` coroutine with no shared lock, and `is_healthy` queries `_membership` through `httpx.AsyncClient` (replacing `requests`), returning `False` on any exception. Log output now goes through the `log` object from the new haproxy-healthcheck/logger.py, except the exception message in `is_healthy`, which still uses `print`. haproxy-healthcheck/Dockerfile now installs the frozen runtime requirements at image build (`COPY requirements/base-freeze.txt /app/requirements.txt`, then `RUN pip install -r /app/requirements.txt`), moves the base image from `python:3.10.5-slim` to `python:${PYTHON_VERSION}-alpine` (`ARG PYTHON_VERSION=3.10.13`), and runs `CMD "/app/check.py"` as `USER nobody`; haproxy-healthcheck/check-entrypoint.sh was deleted. The PR also added haproxy-healthcheck/pyproject.toml (runtime dependency `httpx<1` plus test extras), haproxy-healthcheck/requirements/test-freeze.txt, the haproxy-healthcheck/requirements/update.sh regeneration script, haproxy-healthcheck/Makefile, haproxy-healthcheck/compose.yml with a mock CouchDB, and basic unit tests.

## Code Patterns

Freeze Python dependencies into version-pinned requirements files (haproxy-healthcheck/requirements/base-freeze.txt for runtime, haproxy-healthcheck/requirements/test-freeze.txt for tests) regenerated from haproxy-healthcheck/pyproject.toml by haproxy-healthcheck/requirements/update.sh, and install only the runtime freeze at image-build time in haproxy-healthcheck/Dockerfile rather than at container startup, so deployments are independent of PyPI availability and upstream 'latest' churn. Serve the TCP health agent with `asyncio.start_server` so each connection gets its own coroutine; a lock held for a worker thread's whole lifetime, as the old haproxy-healthcheck/check.py did, turns one failed send into a permanently blocked listener.

## Design Choices

Kept the service in Python to reuse existing code rather than rewriting in another language. Pinned and bundled dependencies at build time for resilience against PyPI outages and incompatible releases. Test coverage is basic; the PR description cites the service's limited expected lifetime when asking whether more tests were needed. haproxy-healthcheck/logger.py reads `HEALTHCHECK_LOG_LEVEL` with a default of `"WARNING"`. In haproxy-healthcheck/check.py the per-connection `log.info("Response: %r", message)` line therefore stays out of the logs unless the level is lowered, while the startup line is logged with `log.warning(f"Serving on {addrs}")` so it still appears by default.

## Related Files

- haproxy-healthcheck/check.py
- haproxy-healthcheck/logger.py (added)
- haproxy-healthcheck/Dockerfile
- haproxy-healthcheck/Makefile (added)
- haproxy-healthcheck/compose.yml (added)
- haproxy-healthcheck/check-entrypoint.sh (deleted)
- haproxy-healthcheck/pyproject.toml (added)
- haproxy-healthcheck/requirements/base-freeze.txt (added)
- haproxy-healthcheck/requirements/test-freeze.txt (added)
- haproxy-healthcheck/requirements/update.sh (added)
- haproxy-healthcheck/test/test_check.py (added)
- haproxy-healthcheck/mock-config/initializerJson.json (present at this PR's anchor; removed on master by PR #8870, which replaced the mockserver mock with nginx)
- haproxy/tests/compose.yml (present at this PR's anchor; renamed on master to haproxy/tests/compose-cluster.yml by PR #10006)
- package.json

## Testing

Added basic Python unit tests (haproxy-healthcheck/test/test_check.py, haproxy-healthcheck/test/__init__.py) with test dependencies frozen in haproxy-healthcheck/requirements/test-freeze.txt. The four async cases patch `httpx.AsyncClient.get` and assert `check.is_healthy()` for an unexpected JSON body, all nodes up, one node missing, and mismatched `cluster_nodes`; none exercises the connection handling. `make test` in haproxy-healthcheck/Makefile runs `.venv/bin/pytest --mypy --ruff`, and the root package.json gained a `unit-haproxy-healthcheck` script (`cd haproxy-healthcheck && make test`) appended to `ci-compile`. At this PR, haproxy-healthcheck/compose.yml runs the service against a `mockserver/mockserver:5.15.0` mock CouchDB seeded from haproxy-healthcheck/mock-config/initializerJson.json (an nginx mock on master since PR #8870), and haproxy/tests/compose.yml gained published ports for its mock CouchDB (`127.0.0.1:5985:5984`) and healthcheck (`127.0.0.1:5555:5555`).

## Related Issues

- #8644: "cht-healthcheck stays down after ConnectionRestError" — the issue this PR references; its ConnectionResetError traceback from the thread worker is the failure the rewrite removes
- PR #8733: "feat(#8644): Support concurrency for haproxy-healthcheck (Moved to #8813)" — the original PR, closed unmerged and re-opened as PR #8813 to update the branch name

## Domain Rationale

**Fit:** strong

The haproxy-healthcheck is an operational support service for the HAProxy load balancer that fronts CouchDB; the PR changes container packaging, dependency freezing, and connection handling — squarely operational/deploy lifecycle work (Docker/HAProxy), not application behavior.
