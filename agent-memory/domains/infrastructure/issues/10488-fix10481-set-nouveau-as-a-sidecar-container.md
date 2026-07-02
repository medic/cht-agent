---
id: cht-core-10488
category: bug
domain: infrastructure
domainFit: strong
issueNumber: 10488
issueUrl: https://github.com/medic/cht-core/issues/10488
title: Run Nouveau search engine as a sidecar container in CHT Helm deployment templates
lastUpdated: '2026-06-22'
summary: Nouveau (CouchDB's Lucene full-text search engine) was deployed as a standalone Kubernetes Deployment/Service in the Helm chart; this PR co-locates it as a sidecar container with CouchDB and updates the dependent deployment templates, correcting the deployment topology.
services:
  - api
  - sentinel
techStack:
  - helm
  - kubernetes
  - couchdb
  - nouveau
  - lucene
  - yaml
  - docker
tags:
  - nouveau
  - sidecar
  - helm
  - kubernetes
  - deployment
  - couchdb-search
related_workflows:
  - nouveau-search
source_pr: medic/cht-core#10488
source_sha: 68f6d8beca3f60650be9f5c73f117048759d237d
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - scripts/build/helm/templates/nouveau/deployment.yaml
  - scripts/build/helm/templates/nouveau/service.yaml
  - scripts/build/helm/templates/couchdb/deployment.yaml
  - scripts/build/helm/templates/api/deployment.yaml
  - scripts/build/helm/templates/sentinel/deployment.yaml
  - scripts/build/helm/templates/haproxy/deployment.yaml
  - scripts/build/helm/templates/healthcheck/deployment.yaml
concepts:
  - sidecar container pattern
  - Kubernetes pod co-location
  - Helm chart templating
  - service discovery
  - deployment topology
  - CouchDB Nouveau full-text search
related_issues: []
stale: false
---

## Problem

In Helm/Kubernetes deployments, Nouveau (the CouchDB Lucene full-text search engine) ran as its own standalone Deployment and Service, decoupled from CouchDB. Because Nouveau is tightly coupled to CouchDB (shared lifecycle, 1:1 scaling, low-latency local communication), the separate-deployment topology was incorrect and risked search being unreliable or unreachable.

## Root Cause

The Helm chart modeled Nouveau as an independent templates/nouveau/deployment.yaml plus service.yaml rather than co-locating its container inside the CouchDB pod, breaking the required CouchDB↔Nouveau coupling (localhost communication, joint lifecycle and scaling).

## Solution

Run Nouveau as a sidecar container co-located with CouchDB (its container spec added to the CouchDB pod) instead of a standalone Deployment, and adjust the related Helm templates (nouveau service, plus the api, sentinel, haproxy, and healthcheck deployments) to reference Nouveau's new in-pod location. Also bumps the package/chart version (cascading the version string across the deployment templates).

## Code Patterns

Kubernetes sidecar pattern expressed in Helm: co-locate a tightly-coupled auxiliary process (Nouveau) in the same pod as its primary (CouchDB) so they share lifecycle/scaling and communicate over localhost, rather than a separate templates/<svc>/deployment.yaml. See scripts/build/helm/templates/couchdb/deployment.yaml and scripts/build/helm/templates/nouveau/.

## Design Choices

Sidecar over a standalone Deployment because Nouveau must scale 1:1 with CouchDB, share its lifecycle, and communicate with low latency; a separate Deployment/Service unnecessarily decoupled them and risked search outages and orphaned indexing.

## Related Files

- scripts/build/helm/templates/nouveau/deployment.yaml
- scripts/build/helm/templates/nouveau/service.yaml
- scripts/build/helm/templates/couchdb/deployment.yaml
- scripts/build/helm/templates/api/deployment.yaml
- scripts/build/helm/templates/sentinel/deployment.yaml
- scripts/build/helm/templates/haproxy/deployment.yaml
- scripts/build/helm/templates/healthcheck/deployment.yaml
- package.json
- package-lock.json

## Testing

No unit or e2e tests were added; the change is limited to Helm chart YAML templates and a version bump, so verification is via the Build CI pipeline and deploying the Helm chart to confirm Nouveau search functions as a CouchDB sidecar.

## Related Issues

- #10481: Run Nouveau as a sidecar container (Helm/Kubernetes deployment topology fix)

## Domain Rationale

**Fit:** strong

The change is entirely within Helm deployment templates, altering Kubernetes deployment topology (running Nouveau as a sidecar) plus a version bump — operational/deploy lifecycle work (Helm/Docker), not Nouveau's index design documents or application search behavior, which would be data-sync.
