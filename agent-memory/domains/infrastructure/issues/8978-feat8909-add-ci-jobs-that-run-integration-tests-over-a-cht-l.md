---
id: cht-core-8909
category: feature
domain: infrastructure
domainFit: strong
issueNumber: 8909
issueUrl: https://github.com/medic/cht-core/issues/8909
title: Add CI jobs that run the integration test suite against a CHT instance deployed in a K3D (Kubernetes) cluster via Helm charts
lastUpdated: '2026-10-01'
summary: 'CHT integration tests previously only ran against the Docker Compose deployment. With this PR, .github/workflows/build.yml gained a `tests-k3d` job whose matrix runs two commands that deploy CHT into a K3D Kubernetes cluster from a test-only Helm chart under tests/helm/ (with local-path persistent storage) and run the existing integration specs against it, skipping tests tagged `@docker`. On master the job still runs, but tests/helm/ is gone (deleted by PR #10051) and the suite installs the in-repo chart at scripts/build/helm instead.'
services:
  - api
  - sentinel
techStack:
  - kubernetes
  - k3d
  - helm
  - github-actions
  - mocha
  - couchdb
  - nginx
  - haproxy
  - docker
  - javascript
tags:
  - ci
  - integration-testing
  - kubernetes
  - k3d
  - helm
  - e2e-testing
  - persistent-storage
  - build-pipeline
related_workflows: []
source_pr: medic/cht-core#8978
source_sha: c8985c111d2d3ab1e5724fa187dd70467d16d7c7
distilled_at: '2026-06-23'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - .github/workflows/build.yml
  - tests/helm/Chart.yaml
  - tests/helm/values.yaml.template
  - tests/helm/templates/
  - tests/integration/.mocharc-k3d.js
  - tests/integration/.mocharc-sentinel-k3d.js
  - tests/integration/hooks-k3d.js
concepts:
  - Kubernetes-based ephemeral test environment
  - Helm chart deployment of the CHT stack
  - CI integration testing across deployment architectures
  - local-path persistent storage provisioning
  - parameterizing one spec suite across multiple environments via separate mocha configs
related_issues: []
stale: true
---

> **Paths are as of this PR, not as of master.** The test-only Helm chart under tests/helm/ was
> removed on master by PR #10051 (`49b909968`, 2025-07-11), which added the in-repo chart at
> scripts/build/helm (four of the old templates moved into it) and switched tests/utils/index.js to install it (layering
> scripts/build/helm/values/base.yaml, scripts/build/helm/values/deployment-multi.yaml and
> scripts/build/helm/values/platform-k3s-k3d.yaml under a generated test values file). The CI job,
> mocha configs and hooks this PR added are still on master.

## Problem

CHT's integration test suite only exercised the Docker Compose deployment architecture. The Kubernetes/Helm deployment path had no automated CI coverage, so regressions specific to running CHT on Kubernetes (Helm templating, K3D networking, persistent storage, multi-service orchestration) could ship undetected. Issue #8909 notes that docker-compose is no longer supported for production and asked for at least one e2e test over a k8s-deployed CHT.

## Root Cause

Not a bug but a coverage gap: existing CI (.github/workflows/build.yml) and the integration mocharc configs assumed a Docker Compose target, with no tooling to provision a Kubernetes cluster, render Helm charts, or point the integration specs at a K3D-deployed instance.

## Solution

The existing .github/workflows/build.yml gained a `tests-k3d` job with a matrix of `'ci-integration-all-k3d'` and `'ci-integration-sentinel-k3d'`; it sets up K3D, Helm and kubectl (`nolar/setup-k3d-k3s@v1`, `azure/setup-helm@v4.1.0`, `azure/setup-kubectl@v4`) and runs the root package.json scripts `ci-integration-all-k3d` (`mocha --config tests/integration/.mocharc-k3d.js`) and `ci-integration-sentinel-k3d` (`mocha --config tests/integration/.mocharc-sentinel-k3d.js`). At this PR, the test run deployed the full CHT stack (api, couchdb, sentinel, nginx, haproxy, healthcheck, credentials) into a K3D cluster via a test-only Helm chart under tests/helm/, whose CouchDB volumes used `storageClassName: local-path`. New K3D-specific mocha configs (tests/integration/.mocharc-k3d.js, tests/integration/.mocharc-sentinel-k3d.js) and hooks (tests/integration/hooks-k3d.js, whose `beforeAll` calls `utils.prepK3DServices(true)`) run the existing spec globs, now shared through tests/integration/specs.js, against the cluster. Tests that only work under Docker Compose were tagged `@docker` and are skipped there by `grep: '@docker'` with `invert: true`; other specs were adapted for both environments (for example the CouchDB node names in tests/integration/couchdb/couch_chttpd.spec.js switch on `utils.isK3D()`, nginx and CouchDB URLs use `constants.API_HOST`, and sentinel specs await `utils.getSentinelDate()`), alongside changes to tests/utils/index.js and tests/constants.js.

## Code Patterns

At this PR, the test-only Helm chart in tests/helm/ (tests/helm/Chart.yaml, tests/helm/values.yaml.template, tests/helm/templates/*.yaml) was the harness for deploying CHT to Kubernetes for testing; on master that role belongs to the in-repo chart at scripts/build/helm. Still on master: the tests/integration/.mocharc-k3d.js / tests/integration/.mocharc-sentinel-k3d.js + tests/integration/hooks-k3d.js pattern, which runs one integration spec suite across two deployment architectures by layering environment-specific mocha configs and hooks over the shared tests/integration/.mocharc-base.js and the spec lists in tests/integration/specs.js; tests/integration/.mocharc-k3d.js excludes architecture-specific tests by tag (`grep: '@docker'`, `invert: true`) rather than duplicating specs, and tests/integration/.mocharc-sentinel-k3d.js inherits that by spreading `...k3dBaseConfig`.

## Design Choices

Chose K3D (K3s-in-Docker) for a lightweight, disposable in-CI Kubernetes cluster and the local-path provisioner for simple node-local persistent volumes suited to ephemeral CI. Reused the existing integration specs via parallel mocharc configs instead of forking the test code. The integration suites were picked because they cover most of the server-side complexity (scaling containers, following logs), which is where Kubernetes-specific bottlenecks would surface.

## Related Files

- .github/workflows/build.yml
- tests/helm/Chart.yaml (added at this PR; deleted on master by PR #10051)
- tests/helm/values.yaml.template (added at this PR; deleted on master by PR #10051)
- tests/helm/templates/api.yaml (added at this PR; deleted on master by PR #10051)
- tests/helm/templates/couchdb.yaml (added at this PR; deleted on master by PR #10051)
- tests/helm/templates/sentinel.yaml (added at this PR; moved on master by PR #10051 into scripts/build/helm)
- tests/helm/templates/nginx.yaml (added at this PR; moved on master by PR #10051 into scripts/build/helm)
- tests/helm/templates/haproxy.yaml (added at this PR; moved on master by PR #10051 into scripts/build/helm)
- tests/helm/templates/healthcheck.yaml (added at this PR; moved on master by PR #10051 into scripts/build/helm)
- tests/helm/templates/credentials.yaml (added at this PR; deleted on master by PR #10051)
- tests/integration/.mocharc-k3d.js (added)
- tests/integration/.mocharc-sentinel-k3d.js (added)
- tests/integration/hooks-k3d.js (added)
- tests/integration/specs.js (added)
- tests/utils/index.js
- tests/constants.js
- tests/AUTOMATE_TEST_GUIDE.md

## Testing

The PR is itself test infrastructure: its two K3D commands run the same spec globs as the Docker Compose suites — `require('./specs').all` (every integration directory except cht-conf and sentinel, then cht-conf last) for `ci-integration-all-k3d` and `require('./specs').sentinel` for `ci-integration-sentinel-k3d` — minus the tests tagged `@docker`. At this PR those were five: the two docker-network access tests in tests/integration/couchdb/couch_chttpd.spec.js, 'should allow logins @docker' in tests/integration/haproxy/keep-alive.spec.js, and the two plain-HTTP tests in tests/integration/nginx/nginx.spec.js. On master the tag also marks later tests, for example 'should work after restarting CouchDb @docker' in tests/integration/api/server.spec.js. The root package.json also gained `integration-all-k3d-local` and `integration-sentinel-k3d-local`, which build the service images before running the K3D suites locally.

## Related Issues

- #8909: "Run e2e tests  over k8s architecture instead of Docker Compose" — this draft's issue; it asked for at least one e2e test over a k8s-deployed CHT, and this PR answered with the integration suites.

## Domain Rationale

**Fit:** strong

This is purely CI/build/deploy lifecycle work — it adds GitHub Actions CI jobs that stand up a K3D (Kubernetes) cluster via Helm charts to run the integration suite. It changes how the system is tested/deployed, not application behavior, which is the canonical infrastructure case.
