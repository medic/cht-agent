---
id: cht-core-10481
category: bug
domain: infrastructure
domainFit: strong
issueNumber: 10481
issueUrl: https://github.com/medic/cht-core/issues/10481
title: Run Nouveau as a sidecar container in the CouchDB pod and switch Helm deployment strategy to Recreate
lastUpdated: '2026-06-22'
summary: Upgrading the demo-cht instance to 5.x was blocked by the Helm chart configuration. The fix co-locates Nouveau as a sidecar container in the CouchDB pod (sharing storage) and changes the deployment strategy to Recreate across the affected deployments.
services:
  - api
  - sentinel
techStack:
  - helm
  - kubernetes
  - yaml
  - couchdb
  - nouveau
tags:
  - nouveau
  - helm
  - kubernetes
  - sidecar
  - deployment-strategy
  - recreate
  - couchdb
  - upgrade
related_workflows:
  - nouveau-search
source_pr: medic/cht-core#10482
source_sha: b6fea049f9dadd65753698291f5325c49eae1640
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - scripts/build/helm/templates/nouveau/deployment.yaml
  - scripts/build/helm/templates/nouveau/service.yaml
  - scripts/build/helm/templates/couchdb/deployment.yaml
  - scripts/build/helm/templates/api/deployment.yaml
  - scripts/build/helm/templates/haproxy/deployment.yaml
  - scripts/build/helm/templates/healthcheck/deployment.yaml
  - scripts/build/helm/templates/sentinel/deployment.yaml
concepts:
  - sidecar container pattern
  - pod co-location for shared storage
  - Kubernetes deployment strategy (Recreate vs RollingUpdate)
  - Helm chart templates
  - container orchestration topology
related_issues: []
stale: false
---

## Problem

While upgrading the demo-cht instance to CHT 5.x, the upgrade hit a roadblock caused by the Helm chart configuration. Nouveau was deployed as its own standalone deployment, and the existing deployment strategy/topology conflicted with the upgrade (the working branch was named '10481-same-storage-helm-charts', indicating Nouveau needed to share CouchDB's storage volume).

## Root Cause

Nouveau ran as a separate Kubernetes deployment rather than co-located with CouchDB, so it could not share CouchDB's storage and the rolling deployment strategy held volumes/resources in a way that blocked the upgrade.

## Solution

Reconfigured Nouveau to run as a sidecar container inside the CouchDB pod (on the first couchdb-1 pod) so it shares storage with CouchDB, and changed the deployment strategy to Recreate across the affected deployment templates to ensure clean recreation during upgrades.

## Code Patterns

Sidecar pattern in Helm: add the Nouveau container to the CouchDB pod spec (scripts/build/helm/templates/couchdb/deployment.yaml) instead of a standalone deployment, enabling shared storage volumes. Set `strategy.type: Recreate` in deployment specs (api, sentinel, haproxy, healthcheck, couchdb, nouveau) to force pod teardown-before-create during upgrades.

## Design Choices

Placing the Nouveau sidecar on the first CouchDB pod (couchdb-1) can leave a cluster unbalanced, but the reviewer (witash) deemed this acceptable as it likely won't matter in practice. Recreate strategy was chosen over RollingUpdate to avoid contention on read-write-once storage volumes during upgrades. Context references the original Nouveau Helm chart design in medic/helm-charts#42.

## Related Files

- scripts/build/helm/templates/nouveau/deployment.yaml
- scripts/build/helm/templates/nouveau/service.yaml
- scripts/build/helm/templates/couchdb/deployment.yaml
- scripts/build/helm/templates/api/deployment.yaml
- scripts/build/helm/templates/haproxy/deployment.yaml
- scripts/build/helm/templates/healthcheck/deployment.yaml
- scripts/build/helm/templates/sentinel/deployment.yaml

## Testing

No automated tests were added (code review checklist left unchecked); as a Helm manifest change it was validated via Build CI docker-compose artifacts and the 5.x upgrade path that originally surfaced the issue.

## Related Issues

- #10481: Helm chart configuration blocked upgrade of the demo-cht instance to 5.x

## Domain Rationale

**Fit:** strong

The PR exclusively modifies Helm deployment manifests (Kubernetes pod topology and deployment strategy) to unblock a 5.x upgrade — this is operational deploy/upgrade-lifecycle work, the canonical infrastructure domain. It touches how Nouveau is shipped/run, not Nouveau index design or search behavior, so it is not data-sync.
