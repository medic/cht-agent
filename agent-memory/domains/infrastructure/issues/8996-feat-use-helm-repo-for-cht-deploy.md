---
id: cht-core-8996
category: improvement
domain: infrastructure
domainFit: strong
issueNumber: 8996
issueUrl: https://github.com/medic/cht-core/issues/8996
title: Use a published Helm repository for cht-deploy instead of a vendored local chart
lastUpdated: '2026-06-23'
summary: cht-deploy bundled its own copy of the CHT Helm chart (templates plus a packaged cht-chart-4.x.tgz) inside cht-core; this PR reworks the deploy tooling to pull the chart from the shared medic/helm-charts Helm repository, removing the duplicated chart sources.
services:
  - api
  - sentinel
techStack:
  - helm
  - kubernetes
  - python
  - yaml
  - docker
tags:
  - helm
  - kubernetes
  - cht-deploy
  - deployment
  - helm-repo
  - k8s
  - eks
  - k3d
  - haproxy
related_workflows: []
source_pr: medic/cht-core#8996
source_sha: c6df0362cb6f3cae68bcb711c7bf1d1a5e5f4350
distilled_at: '2026-06-23'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - scripts/deploy/tasks.py
  - scripts/deploy/helm/cht-chart/
  - scripts/deploy/helm/cht-chart/values.yaml
  - scripts/deploy/helm/cht-chart/Chart.yaml
concepts:
  - helm chart
  - helm repository
  - kubernetes deployment
  - infrastructure-as-code
  - deployment tooling
  - chart versioning
related_issues: []
stale: false
---

## Problem

The CHT Helm chart was vendored directly into cht-core under scripts/deploy/helm/cht-chart — including a packaged cht-chart-4.x.tgz and every Kubernetes template manifest — duplicating chart sources that also live in the shared medic/helm-charts project. This made the chart hard to keep in sync and coupled chart versioning to cht-core.

## Root Cause

cht-deploy (scripts/deploy/tasks.py) referenced a local, checked-in copy of the Helm chart rather than installing a versioned chart published to a Helm repository.

## Solution

Update cht-deploy to install/upgrade the CHT chart from the published medic/helm-charts Helm repository and remove the vendored chart templates and packaged tarball from cht-core. Depends on companion PRs in medic/helm-charts (PR #5) that publish the chart, and is a prerequisite for cht-core #8908.

## Code Patterns

Reference Helm charts by repository + version in deploy tooling (helm repo add / helm install <release> <repo>/<chart> --version) instead of vendoring chart sources into the consuming repo; see scripts/deploy/tasks.py.

## Design Choices

Use a shared, versioned Helm repository as the single source of truth for the CHT chart rather than duplicating templates in each consuming repo. Reviewer (henokgetachew) suggested retaining a sample config or a README copy of the configuration in cht-core for reference.

## Related Files

- scripts/deploy/tasks.py
- scripts/deploy/helm/cht-chart/values.yaml
- scripts/deploy/helm/cht-chart/Chart.yaml
- scripts/deploy/helm/cht-chart/templates/api-deployment.yaml
- scripts/deploy/helm/cht-chart/templates/upgrade-service-deployment.yml

## Testing

No automated tests described in the PR; deployment changes of this kind are validated via staging compose/Kubernetes deploys and depend on the companion helm-charts repo publishing the chart.

## Related Issues

- medic/helm-charts#2: Related helm-charts work
- medic/helm-charts#5: Dependency that publishes the chart to the Helm repo
- #8908: Downstream cht-core PR for which this is a prerequisite

## Domain Rationale

**Fit:** strong

The PR only touches deployment tooling — the cht-deploy task script and the bundled Helm chart templates (api/sentinel/couchdb/haproxy/upgrade-service manifests) — switching cht-deploy to consume the chart from a shared Helm repository. This is operational deploy/Helm lifecycle, squarely infrastructure.
