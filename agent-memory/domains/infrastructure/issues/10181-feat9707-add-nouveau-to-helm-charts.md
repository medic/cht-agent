---
id: cht-core-10181
category: feature
domain: infrastructure
domainFit: strong
issueNumber: 10181
issueUrl: https://github.com/medic/cht-core/issues/10181
title: Add nouveau pod and service to Helm charts for Kubernetes deployment
lastUpdated: '2026-06-22'
summary: The Helm charts had no way to deploy the nouveau full-text search component on Kubernetes. This adds a nouveau Deployment and Service that reuse the first CouchDB node's persistent volume instead of provisioning a separate one.
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
related_issues: []
stale: false
---

## Problem

Nouveau, the new CouchDB full-text search backend, had no deployment definition in the Helm charts, so there was no pod or service to run it on Kubernetes clusters and freetext search could not be served by nouveau in Helm deployments.

## Root Cause

The Helm chart templates under scripts/build/helm/templates/ contained no nouveau pod or service definitions because nouveau is a newly introduced component in the CHT stack.

## Solution

Adds a Kubernetes Deployment (deployment.yaml) and Service (service.yaml) for nouveau under the Helm templates. Nouveau mounts the same persistent volume as the first CouchDB node (no separate volume), runs as a single pod/instance even when CouchDB is clustered, mounts data on a hardcoded subdirectory that ignores preexisting-data settings (so indexes rebuild on new deployments), and copies tolerations from the existing couchdb template. The tests/utils harness was updated to account for the new pod/service.

## Code Patterns

New Helm templates in scripts/build/helm/templates/nouveau/ (deployment.yaml + service.yaml) follow the existing couchdb template structure; the nouveau Deployment reuses the first CouchDB node's PVC for index storage and copies the couchdb template's tolerations.

## Design Choices

Reuses CouchDB's volume rather than provisioning a separate nouveau volume because nouveau is meant to be a transparent part of couchdb, its storage footprint is hard to estimate, and its purpose is to reduce storage — for multi-node CouchDB it uses the first node's volume, accepting storage/IO imbalance on node 1 (flagged for later verification). Uses a single separate nouveau pod (rather than a sidecar container per couchdb pod) serving all freetext searches even when couchdb is clustered (potential bottleneck flagged for verification). Uses a hardcoded subdirectory mount that ignores preexisting-data settings, deliberately accepting index rebuilds after a new deployment to avoid adding nouveau-specific data-path settings deployers would not understand or care about.

## Related Files

- scripts/build/helm/templates/nouveau/deployment.yaml
- scripts/build/helm/templates/nouveau/service.yaml
- scripts/build/helm/templates/couchdb/deployment.yaml
- tests/utils/index.js

## Testing

Updated the tests/utils/index.js test harness to account for the new nouveau pod and service; reviewer confirmed the nouveau Helm templates pass all validation tests across all deployment scenarios.

## Related Issues

- #9707: Add nouveau full-text search support to the CHT (Helm chart deployment)

## Domain Rationale

**Fit:** strong

The PR adds Helm Deployment and Service templates to deploy the nouveau pod — pure operational/deployment lifecycle work, and Helm is canonically infrastructure. It changes how the system is shipped and run rather than touching nouveau search-index design or application behavior, so it is a strong infrastructure fit (not the data-sync bucket reserved for nouveau index internals).
