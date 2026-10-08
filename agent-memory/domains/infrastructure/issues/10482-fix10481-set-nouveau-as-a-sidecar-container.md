---
id: cht-core-10481
category: bug
domain: infrastructure
domainFit: strong
issueNumber: 10481
issueUrl: https://github.com/medic/cht-core/issues/10481
title: Run Nouveau as a sidecar container in the CouchDB pod and switch Helm deployment strategy to Recreate
lastUpdated: '2026-10-05'
summary: 'Upgrading the demo-cht instance to 5.x was blocked by the Helm chart configuration, which had CouchDB and a separate Nouveau pod attach the same persistent volume — something most AWS EBS volume types cannot do. The fix co-locates Nouveau as a sidecar container in the CouchDB pod (sharing storage) and changes the deployment strategy to Recreate across the affected deployments; the same Helm change was cherry-picked to 5.0.x as PR #10488 and released in 5.0.1.'
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
source_prs:
  - "medic/cht-core#10482"
  - "medic/cht-core#10488"
source_sha: b6fea049f9dadd65753698291f5325c49eae1640
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
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
related_issues:
  - cht-core-9707
  - cht-core-11125
stale: true
---

> **Superseded after landing (`stale-as-written`):** in a CouchDB cluster this PR gives only node 1
> the sidecar (`{{- if eq $nodeNumber 1 }}`) and points the single `nouveau` Service at
> `cht.service: couchdb-1`. On master, PR #11126 (`de91ec432`, 2026-08-12) removed that condition so
> every CouchDB node runs its own `cht-couchdb-nouveau` sidecar, gave each node a `NOUVEAU_URL` of
> `http://nouveau-{{ $nodeNumber }}:5987`, and replaced the clustered Service with one
> `nouveau-{{ $nodeNumber }}` Service per node. The single-node sidecar and the `Recreate`
> strategies are still on master as this PR wrote them. Cluster topology below is as of this PR.

## Problem

While upgrading the demo-cht instance to CHT 5.x, the upgrade hit a roadblock caused by the Helm chart configuration. Before this PR, Nouveau was deployed as its own standalone deployment whose pod attached the same persistent volume as CouchDB; #10481 notes that on AWS this requires EBS Multi-Attach, which most volume types cannot do. Its pod listing shows the new `cht-couchdb` and `cht-couchdb-nouveau` pods stuck in the ContainerCreating state while the old CouchDB pod kept running, after which the instance crashed or Nouveau-dependent features (replication, online user search) stopped working.

## Root Cause

At this PR's parent, Nouveau ran as a separate Kubernetes Deployment (scripts/build/helm/templates/nouveau/deployment.yaml) rather than co-located with CouchDB: a second pod mounting CouchDB's `ReadWriteOnce` claim (`couchdb-claim0`, or `couchdb-1-claim0` in a cluster). The api and couchdb Deployments used `type: RollingUpdate` and haproxy, healthcheck and sentinel an empty `strategy: {}` (Kubernetes then defaults to rolling updates), so on an upgrade the replacement CouchDB pod was started while the old one still held its volume.

## Solution

Reconfigured Nouveau to run as a sidecar container inside the CouchDB pod so it shares storage with CouchDB: the PR deleted scripts/build/helm/templates/nouveau/deployment.yaml, and the existing scripts/build/helm/templates/couchdb/deployment.yaml gained a `cht-couchdb-nouveau` container mounting `/data/nouveau` with `subPath: data` from `couchdb-claim0` in the single-node Deployment and, in a cluster, only in node 1's pod (`{{- if eq $nodeNumber 1 }}`) from `couchdb-1-claim0`. scripts/build/helm/templates/nouveau/service.yaml keeps the `nouveau` Service but now selects `cht.service: couchdb-1` when `.Values.couchdb.clusteredCouchEnabled` is set and `cht.service: couchdb` otherwise. It also changed the deployment strategy to Recreate across the affected deployment templates to ensure clean recreation during upgrades: api, couchdb (single-node and clustered), haproxy, healthcheck and sentinel now declare `type: Recreate` under `strategy:`. The same Helm diff was cherry-picked to the `5.0.x` branch as PR #10488 (`68f6d8bec`), which also bumped `version` in package.json and package-lock.json from 5.0.0 to 5.0.1; the cherry-pick shipped in 5.0.1 and this master commit in 5.1.0.

## Code Patterns

Sidecar pattern in Helm: add the Nouveau container to the CouchDB pod spec (scripts/build/helm/templates/couchdb/deployment.yaml) instead of a standalone deployment, enabling shared storage volumes. Set `type: Recreate` under `strategy:` in the Deployment specs (api, sentinel, haproxy, healthcheck, couchdb) to force pod teardown-before-create during upgrades; the deleted standalone nouveau Deployment already used `Recreate`.

## Design Choices

Of the three fixes #10481 weighed — a sidecar sharing the CouchDB pod's storage, a separate PVC for Nouveau, or a ReadWriteMany EFS volume — the sidecar was chosen because it does not require deployments to provision extra disk for Nouveau. Placing the Nouveau sidecar on the first CouchDB pod (couchdb-1) can leave a cluster unbalanced, with node 1 carrying Nouveau's storage and IO; this only applies to multi-node deployments. `Recreate` stops the old pod before starting its replacement, so no `ReadWriteOnce` volume is needed by two pods at once during an upgrade. The standalone-pod design being replaced came from PR #10181; the same design notes appear in the unmerged medic/helm-charts PR #42 ("40 add template for nouveau").

## Related Files

- scripts/build/helm/templates/nouveau/deployment.yaml (deleted)
- scripts/build/helm/templates/nouveau/service.yaml
- scripts/build/helm/templates/couchdb/deployment.yaml
- scripts/build/helm/templates/api/deployment.yaml
- scripts/build/helm/templates/haproxy/deployment.yaml
- scripts/build/helm/templates/healthcheck/deployment.yaml
- scripts/build/helm/templates/sentinel/deployment.yaml

## Testing

No test files changed; all seven files in this PR are Helm templates under scripts/build/helm/templates/. When asking for review, the PR author reported having already verified the fix by upgrading https://demo-cht.dev.medicmobile.org.

## Related Issues

- #10481: "Cannot upgrade to 5.x in AWS due to Persistent Volume settings" — this PR's issue (milestone 5.0.1); PR #10488 carried the same fix to 5.0.x
- PR #10488: "fix(#10481): set nouveau as a sidecar container" — the `5.0.x` cherry-pick of this PR (same Helm diff plus the 5.0.1 version bump)
- #9707: "Helm Charts: Support Nouveau in CHT Deploy script and upgrades and docs" — its PR #10181 added the standalone Nouveau Deployment this PR deletes
- #11125: "Distribute nouveau across all couch nodes in multi-node deployments" — its PR #11126 replaced this PR's node-1-only sidecar with one per CouchDB node

## Domain Rationale

**Fit:** strong

The PR exclusively modifies Helm deployment manifests (Kubernetes pod topology and deployment strategy) to unblock a 5.x upgrade: all seven files are under scripts/build/helm/templates/, and they decide which pod runs the Nouveau container, which volume it mounts and how each Deployment is replaced during an upgrade. It touches how Nouveau is shipped/run, not Nouveau index design or search behavior.
