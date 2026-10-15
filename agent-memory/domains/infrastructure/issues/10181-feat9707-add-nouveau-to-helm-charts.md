---
id: cht-core-9707
category: feature
domain: infrastructure
domainFit: strong
issueNumber: 9707
issueUrl: https://github.com/medic/cht-core/issues/9707
title: Add nouveau pod and service to Helm charts for Kubernetes deployment
lastUpdated: '2026-10-08'
summary: 'The Helm charts had no way to deploy the nouveau full-text search component on Kubernetes. This adds a nouveau Deployment and Service that reuse the first CouchDB node''s persistent volume instead of provisioning a separate one. On master the standalone Deployment was later removed by PR #10482, which moved Nouveau into the CouchDB pod; see the stale-as-written banner.'
services:
  - api
techStack:
  - helm
  - kubernetes
  - nouveau
  - couchdb
  - yaml
tags:
  - nouveau
  - helm
  - kubernetes
  - deployment
  - freetext-search
  - couchdb
related_workflows:
  - nouveau-search
source_pr: medic/cht-core#10181
source_sha: f1efb12c0b2f91a889bdf95f7578f5f6212bd33b
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - scripts/build/helm/templates/nouveau/deployment.yaml
  - scripts/build/helm/templates/nouveau/service.yaml
  - tests/utils/index.js
concepts:
  - Helm chart templating
  - Kubernetes Deployment and Service
  - shared CouchDB persistent volume
  - single centralized nouveau instance for clustered CouchDB
  - freetext search backend deployment
related_issues:
  - cht-core-10481
  - cht-core-9542
stale: true
---

> **Epic child.** PR #10181 was squash-merged into the feature branch `9542_freetext_tco`
> (`f1efb12c0`, 2025-08-05), not into master. That branch reached master as PR #10201
> (`f1bdfc07c`, 2025-08-22). Its own PR number is stamped nowhere on master, and this
> draft's `source_sha` is not on master. To resolve it, run
> `git fetch origin +refs/pull/10201/head:refs/verify/pr10201` — the epic PR's head ref.
>
> **Superseded after landing (`stale-as-written`):** both templates reached master unchanged in
> `f1bdfc07c`, but PR #10482 (`b6fea049f`, 2025-11-26) deleted
> scripts/build/helm/templates/nouveau/deployment.yaml and put the `cht-couchdb-nouveau` container
> into the CouchDB pod (in a cluster, only the `couchdb-1` pod) in
> scripts/build/helm/templates/couchdb/deployment.yaml — a separate pod attaching the CouchDB volume
> blocked 5.x upgrades on AWS, where most EBS volume types cannot multi-attach (#10481) — and repointed the `nouveau` Service's selector at the CouchDB pod. PR #11126 (`de91ec432`) then
> gave every CouchDB node its own sidecar and a `nouveau-{{ $nodeNumber }}` Service. So the separate single
> Nouveau pod, its Deployment and the Service selector `cht.service: nouveau` shipped in release 5.0.0 and were removed from master by PR #10482 and from the 5.0.x line, as of 5.0.1, by its backport
> PR; on master only scripts/build/helm/templates/nouveau/service.yaml remains, rewritten.

## Problem

Before this PR, Nouveau, the new CouchDB full-text search backend, had no deployment definition in the Helm charts, so there was no pod or service to run it on Kubernetes clusters and freetext search could not be served by nouveau in Helm deployments.

## Root Cause

At this PR's parent, the Helm chart templates under scripts/build/helm/templates/ contained no nouveau pod or service definitions because nouveau is a newly introduced component in the CHT stack.

## Solution

Adds a Kubernetes Deployment (scripts/build/helm/templates/nouveau/deployment.yaml: `name: cht-couchdb-nouveau`, `replicas: 1`, strategy `type: Recreate`) and Service (scripts/build/helm/templates/nouveau/service.yaml: `name: nouveau`, port 5987, selector `cht.service: nouveau`) for nouveau under the Helm templates; the Service name matches the `url = http://nouveau:5987` that couchdb/10-docker-default.ini gives CouchDB. The container runs `{{ .Values.upstream_servers.docker_registry }}/cht-couchdb-nouveau:{{ .Values.cht_image_tag }}` and mounts `/data/nouveau` from the first CouchDB node's claim, `couchdb-1-claim0` when `couchdb.clusteredCouchEnabled` is true and otherwise `couchdb-claim0`, and adds no PVC of its own. On a `k3s-k3d` cluster it instead mounts the `preExistingDiskPath-1` hostPath directly. The chart binds that path to the first CouchDB node's claim only when `couchdb_data.preExistingDataAvailable` is true; the k3d CI values (scripts/build/helm/tests/integration-k3d-values.yaml.template) set it to `false`, so there CouchDB's claim gets a `local-path` volume and Nouveau's index data is not on CouchDB's volume. It runs as a single pod/instance even when CouchDB is clustered, mounts data on the hardcoded `subPath: data` in scripts/build/helm/templates/nouveau/deployment.yaml (at this PR; PR #10482 deleted that file) instead of CouchDB's `couchdb_data.dataPathOnDiskForCouchDB` setting (so indexes rebuild after a fresh deployment even with preexisting data). It copies the `tolerations` block from scripts/build/helm/templates/couchdb/deployment.yaml. In tests/utils/index.js, the `SERVICES` map gained `'couchdb-nouveau': 'couchdb-nouveau'`.

## Code Patterns

At this PR, the Helm templates scripts/build/helm/templates/nouveau/deployment.yaml and scripts/build/helm/templates/nouveau/service.yaml follow the existing couchdb template structure; the nouveau Deployment reuses the first CouchDB node's PVC (on `k3s-k3d` it mounts the `preExistingDiskPath-1` hostPath directly, which backs that PVC only when `couchdb_data.preExistingDataAvailable` is true) for index storage and copies the couchdb template's tolerations.

## Design Choices

Reuses CouchDB's volume rather than provisioning a separate nouveau volume because nouveau is meant to be a transparent part of couchdb, its storage footprint is hard to estimate, and its purpose is to reduce storage — for multi-node CouchDB it uses the first node's volume, accepting storage/IO imbalance on node 1 (flagged for later verification). Uses a single separate nouveau pod (rather than a sidecar container per couchdb pod) serving all freetext searches even when couchdb is clustered (potential bottleneck flagged for verification). Uses a hardcoded subdirectory mount that ignores preexisting-data settings, deliberately accepting index rebuilds after a new deployment to avoid adding nouveau-specific data-path settings deployers would not understand or care about.

## Related Files

- scripts/build/helm/templates/nouveau/deployment.yaml (added; removed on master by PR #10482)
- scripts/build/helm/templates/nouveau/service.yaml (added; rewritten on master by PR #10482 and PR #11126)
- tests/utils/index.js
- scripts/build/helm/templates/couchdb/deployment.yaml (not changed by this PR; source of the copied `tolerations` block; on master PR #10743 moved that block into the `couchdb.securityContextAndTolerations` helper in scripts/build/helm/templates/_helpers.tpl)

## Testing

No test specs changed. In the tests/utils/index.js harness, the new `SERVICES` key makes the k3d setup's `importImages` push `cht-couchdb-nouveau:<tag>` to the k3d registry that the Helm install pulls from, so the new Deployment's image is present in k3d runs. Outside Docker `getContainerName` (`` isDocker() ? `${project}-${service}-1` : `deployment/cht-${service}` ``) would give `deployment/cht-couchdb-nouveau`, the new Deployment's name, but only Docker runs call `updateContainerNames`, so only they fill `CONTAINER_NAMES`. Under Docker the same entry resolves to `<project>-couchdb-nouveau-1`, which does not match the compose service `nouveau`; PR #11162 later mapped it to `nouveau` so Nouveau's CI logs are saved. The approving review reported that the nouveau Helm templates pass all validation tests across all deployment scenarios.

## Related Issues

- #9707: "Helm Charts: Support Nouveau in CHT Deploy script and upgrades and docs" — this PR's issue; it asked that new Kubernetes deployments and upgrades of existing ones account for Nouveau, possibly through Helm chart additions
- #10481: "Cannot upgrade to 5.x in AWS due to Persistent Volume settings" — the separate Nouveau pod mounting CouchDB's volume blocked 5.x upgrades on AWS, where most EBS volume types cannot multi-attach; its fix, PR #10482, replaced this PR's Deployment with a sidecar in the CouchDB pod
- #9542: "Reduce disk space with CouchDB Nouveau (TCO v1)" — the Nouveau epic this PR was delivered under

## Domain Rationale

**Fit:** strong

The PR adds two Helm templates, scripts/build/helm/templates/nouveau/deployment.yaml and scripts/build/helm/templates/nouveau/service.yaml, plus one test-harness mapping: it defines how the Nouveau server is scheduled on Kubernetes, which volume it mounts and how CouchDB reaches it. It changes how the system is shipped and run rather than Nouveau index definitions or application behavior.
