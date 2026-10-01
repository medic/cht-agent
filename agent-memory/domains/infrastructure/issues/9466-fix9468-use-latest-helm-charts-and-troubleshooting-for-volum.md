---
id: cht-core-9468
category: bug
domain: infrastructure
domainFit: strong
issueNumber: 9468
issueUrl: https://github.com/medic/cht-core/issues/9468
title: Use latest helm-charts in deploy script and add get-volume-binding Kubernetes troubleshooting tool
lastUpdated: '2026-10-01'
summary: 'Mounting pre-existing CouchDB data into a Helm-deployed CHT came up as a fresh instance, and operators had no easy way to discover the PV/PVC/subPath needed to bind that data. This PR raised the default chart version that scripts/deploy/src/install.js requests from 1.0.* to 1.1.* of the medic/helm-charts cht-chart-4x chart, the release carrying the pre-existing-data fixes, and added a scripts/deploy/troubleshooting/get-volume-binding script that prints the volume bindings of a deployment as JSON. Both were removed on master with the rest of scripts/deploy by PR #10500; the Helm chart on master lives in-repo at scripts/build/helm.'
services:
  - api
techStack:
  - javascript
  - kubernetes
  - helm
  - couchdb
  - kubectl
tags:
  - helm-charts
  - kubernetes
  - persistent-volumes
  - pvc
  - subpath
  - deployment
  - troubleshooting
  - couchdb-volumes
related_workflows:
  - data-migration
source_pr: medic/cht-core#9466
source_sha: 3aec5310df424bf57d332dffa12029b01441432d
distilled_at: '2026-06-23'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - scripts/deploy/src/install.js
  - scripts/deploy/troubleshooting/get-volume-binding
concepts:
  - helm-chart deployment
  - kubernetes persistent volumes (PV)
  - persistent volume claims (PVC)
  - volume subPath binding
  - deployment troubleshooting tooling
  - couchdb data persistence
related_issues: []
stale: true
---

> **Paths are as of this PR, not as of master.** Both files below were deleted on master,
> with the rest of scripts/deploy, by PR #10500 (`1c3277c4e`, 2026-01-12). Before that,
> PR #9615 switched scripts/deploy/src/install.js to read its chart constants from
> scripts/deploy/src/config.js, whose default it widened to 1.*.*. The chart this tool
> installed, `cht-chart-4x` from the medic/helm-charts repository, is not what master ships:
> on master the CHT Helm chart lives in-repo at scripts/build/helm (added by PR #10051), where
> the CouchDB data `subPath` in scripts/build/helm/templates/couchdb/deployment.yaml is
> `{{ .Values.couchdb_data.dataPathOnDiskForCouchDB }}`.

## Problem

Mounting pre-existing CouchDB data into a Helm-deployed CHT brought up a fresh instance instead of the existing instance on disk (#9468). At this PR's parent, the deploy script scripts/deploy/src/install.js defaulted to the 1.0.* releases of the medic/helm-charts `cht-chart-4x` chart, and operators had no straightforward way to determine the volume binding details (PV, PVC, and especially the subPath) required to point a new deployment at pre-existing CouchDB data, making data-preserving deployments error-prone.

## Root Cause

At this PR's parent, scripts/deploy/src/install.js set `const DEFAULT_CHART_VERSION = '1.0.*';`, which predates medic/helm-charts#24, the chart change (released as `cht-chart-4x` 1.1.0) that fixed loading CHT with pre-existing data and with a non-standard `subPath`. There was also no tooling to introspect the existing Kubernetes PV/PVC/subPath bindings of a running deployment.

## Solution

At this PR, scripts/deploy/src/install.js was changed to `const DEFAULT_CHART_VERSION = '1.1.*';` (merged after medic/helm-charts#24 released that chart version), and added scripts/deploy/troubleshooting/get-volume-binding, a bash script that took `<namespace> <deployment>` and, using `kubectl` and `jq`, printed one JSON object per volume mount in the deployment (skipping mounts whose `mountPath` ends in `local.d`) — mountPath, name, subPath, volumeType, claimName and hostPath, plus pvName, pvSize, storageClass and pvAccessModes when the volume is a PVC bound to a PV — so operators could read the subPath of an existing deployment and reuse it for a clone with that data.

## Code Patterns

At this PR, scripts/deploy/troubleshooting/get-volume-binding showed a reusable Kubernetes introspection pattern: given (namespace, deployment), resolve the mounted PVC, follow it to the bound PV via `kubectl get pvc -n "$NAMESPACE" "$pvc_name" -o jsonpath='{.spec.volumeName}'`, and emit a structured machine-readable JSON descriptor (mountPath/subPath/claimName/pvName/pvSize/pvAccessModes); when no PV was bound it added nothing (`get_pv_details` printed `{}`). At this PR it sat beside the other kubectl helpers under scripts/deploy/troubleshooting/, a directory removed on master by PR #10500.

## Design Choices

Shipped a standalone JSON-emitting troubleshooting script rather than embedding the logic in the install flow, so operators could inspect the bindings of an existing deployment independently of an install; the scripts/deploy/src/install.js bump was deliberately held until the upstream helm-charts release merged, so the deploy script and chart version advanced together.

## Related Files

- scripts/deploy/src/install.js (present at this PR's anchor; removed on master by PR #10500, which deleted scripts/deploy)
- scripts/deploy/troubleshooting/get-volume-binding (added; removed on master by PR #10500)

## Testing

The diff touches only scripts/deploy/src/install.js and scripts/deploy/troubleshooting/get-volume-binding; it contains no tests.

## Related Issues

- #9468: "Failure when mounting pre-existing data to the CHT" — this draft's issue; mounting pre-existing data came up as a fresh instance, with reproduction steps in medic/cht-docs#1502.
- medic/helm-charts#24: "Fix pre-existing data issues" — the chart PR (cht-chart-4x 1.0.1 to 1.1.0) this PR waited on; it fixes loading CHT with pre-existing data and with a non-standard subPath.
- medic/cht-docs#1502: "Create section in EKS docs on how to clone an instance" — companion documentation PR; its EKS deployment page changes use get-volume-binding to find the subPath.

## Domain Rationale

**Fit:** strong

This PR changes CHT deploy tooling — bumping the default `cht-chart-4x` version to the then-latest release and adding a Kubernetes PV/PVC volume-binding troubleshooting script — which is operational deploy/upgrade lifecycle work, the canonical scope of the infrastructure domain.
