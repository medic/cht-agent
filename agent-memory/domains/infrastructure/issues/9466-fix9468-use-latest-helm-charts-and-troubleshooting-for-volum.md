---
id: cht-core-9466
category: feature
domain: infrastructure
domainFit: strong
issueNumber: 9466
issueUrl: https://github.com/medic/cht-core/issues/9466
title: Use latest helm-charts in deploy script and add get-volume-binding Kubernetes troubleshooting tool
lastUpdated: '2026-06-23'
summary: CHT's Helm-based deploy script lagged the latest helm-charts and operators had no easy way to discover the PV/PVC/subPath needed to bind pre-existing CouchDB data. This PR updates install.js to use the latest helm-charts and adds a get-volume-binding troubleshooting script that emits volume binding details as JSON.
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
stale: false
---

## Problem

When deploying CHT with Helm, the deploy script referenced an older helm-charts release, and operators had no straightforward way to determine the volume binding details (PV, PVC, and especially the subPath) required to point a new deployment at pre-existing CouchDB data, making data-preserving deployments error-prone.

## Root Cause

scripts/deploy/src/install.js pinned an older helm-charts version that lacked the needed volume/subPath configuration, and there was no tooling to introspect the existing Kubernetes PV/PVC/subPath bindings of a running deployment.

## Solution

Updated scripts/deploy/src/install.js to consume the latest helm-charts release (gated on medic/helm-charts#24), and added scripts/deploy/troubleshooting/get-volume-binding which takes a namespace and deployment name and prints a JSON object describing the bound volume — mountPath, name, subPath, volumeType, claimName, hostPath, pvName, pvSize, storageClass, and pvAccessModes — so operators can determine the correct subPath for their pre-existing data.

## Code Patterns

scripts/deploy/troubleshooting/get-volume-binding shows a reusable Kubernetes introspection pattern: given (namespace, deployment), resolve the mounted PVC, follow it to the bound PV, and emit a structured machine-readable JSON descriptor (mountPath/subPath/claimName/pvName/pvSize/pvAccessModes). A good template for further k8s helpers under scripts/deploy/troubleshooting/.

## Design Choices

Shipped a standalone JSON-emitting troubleshooting script rather than embedding the logic in the install flow, so operators can inspect bindings independently before/after deployment; the install.js bump was deliberately gated on the upstream helm-charts release so the deploy script and chart version advance together.

## Related Files

- scripts/deploy/src/install.js
- scripts/deploy/troubleshooting/get-volume-binding

## Testing

No automated tests added; validated manually — reviewer mrjones-plip ran get-volume-binding against a production cluster and confirmed it surfaced the expected subPath deltas before approving the merge.

## Related Issues

- #9468: deploy tooling needs latest helm-charts and a way to discover volume subPath for pre-existing data
- medic/helm-charts#24: upstream helm-charts release this PR depends on (must merge first)
- medic/cht-docs#1502: companion documentation PR for the volume-binding troubleshooting workflow

## Domain Rationale

**Fit:** strong

This PR changes CHT deploy tooling — bumping to the latest Helm charts and adding a Kubernetes PV/PVC volume-binding troubleshooting script — which is operational deploy/upgrade lifecycle work, the canonical scope of the infrastructure domain.
