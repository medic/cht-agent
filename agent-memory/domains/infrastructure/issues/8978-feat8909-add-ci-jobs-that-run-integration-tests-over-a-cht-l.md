---
id: cht-core-8909
category: feature
domain: infrastructure
domainFit: strong
issueNumber: 8909
issueUrl: https://github.com/medic/cht-core/issues/8909
title: Add CI jobs that run the integration test suite against a CHT instance deployed in a K3D (Kubernetes) cluster via Helm charts
lastUpdated: '2026-06-23'
summary: CHT integration tests previously only ran against the Docker Compose deployment; this PR adds two new CI jobs that deploy CHT into a K3D Kubernetes cluster using new Helm charts (with local-path persistent storage) and run the existing integration specs against that architecture.
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
stale: false
---

## Problem

CHT's integration test suite only exercised the Docker Compose deployment architecture. The Kubernetes/Helm deployment path had no automated CI coverage, so regressions specific to running CHT on Kubernetes (Helm templating, K3D networking, persistent storage, multi-service orchestration) could ship undetected.

## Root Cause

Not a bug but a coverage gap: existing CI (build.yml) and the integration mocharc configs assumed a Docker Compose target, with no tooling to provision a Kubernetes cluster, render Helm charts, or point the integration specs at a K3D-deployed instance.

## Solution

Added two CI jobs to .github/workflows/build.yml that spin up a K3D cluster, deploy the full CHT stack (api, couchdb, sentinel, nginx, haproxy, healthcheck, credentials) via a new Helm chart under tests/helm/, and use local-path for persistent storage. Introduced K3D-specific mocha configs (.mocharc-k3d.js, .mocharc-sentinel-k3d.js) and test hooks (hooks-k3d.js) so the existing integration specs run unchanged against the cluster; updated tests/utils, tests/constants.js, and several specs (couch_chttpd, haproxy keep-alive, nginx, infodocs, sentinel outbound/transitions) to work in both environments.

## Code Patterns

The new Helm chart in tests/helm/ (Chart.yaml, values.yaml.template, templates/*.yaml) is a reusable harness for deploying CHT to Kubernetes for testing. The .mocharc-k3d.js / .mocharc-sentinel-k3d.js + hooks-k3d.js pattern shows how to run one integration spec suite across multiple deployment architectures by layering environment-specific mocha configs and hooks over a shared .mocharc-base.js rather than duplicating specs.

## Design Choices

Chose K3D (K3s-in-Docker) for a lightweight, disposable in-CI Kubernetes cluster and the local-path provisioner for simple node-local persistent volumes suited to ephemeral CI. Reused the existing integration specs via parallel mocharc configs instead of forking the test code. Reviewer (nydr) accepted the ~30-minute additional build step as a reasonable cost tradeoff and flagged flaky-test risk, with tagging/segregating flaky tests deferred as out of scope.

## Related Files

- .github/workflows/build.yml
- tests/helm/Chart.yaml
- tests/helm/values.yaml.template
- tests/helm/templates/api.yaml
- tests/helm/templates/couchdb.yaml
- tests/helm/templates/sentinel.yaml
- tests/helm/templates/nginx.yaml
- tests/helm/templates/haproxy.yaml
- tests/helm/templates/healthcheck.yaml
- tests/helm/templates/credentials.yaml
- tests/integration/.mocharc-k3d.js
- tests/integration/.mocharc-sentinel-k3d.js
- tests/integration/hooks-k3d.js
- tests/utils/index.js
- tests/constants.js
- tests/AUTOMATE_TEST_GUIDE.md

## Testing

The PR is itself test infrastructure: it runs the existing integration suite (couchdb chttpd, haproxy keep-alive, nginx, infodocs, sentinel outbound schedules and mark-for-outbound/error-log transitions) against a Helm-deployed K3D cluster as two new CI jobs. Existing specs and test utilities were adapted to run in both Docker Compose and K3D environments via shared base mocharc plus K3D-specific configs and hooks. Reviewer confirmed the suite ran locally with little effort; remaining failures attributed to pre-existing flaky tests.

## Related Issues

- #8909: Run CHT integration tests over a K3D/Kubernetes (Helm) deployment in CI

## Domain Rationale

**Fit:** strong

This is purely CI/build/deploy lifecycle work — it adds GitHub Actions CI jobs that stand up a K3D (Kubernetes) cluster via Helm charts to run the integration suite. It changes how the system is tested/deployed, not application behavior, which is the canonical infrastructure case.
