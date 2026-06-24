---
id: cht-core-8693
category: feature
domain: infrastructure
domainFit: strong
issueNumber: 8693
issueUrl: https://github.com/medic/cht-core/issues/8693
title: Add Kubernetes manifests, Helm chart templates, and a one-shot cht-deploy script for local clustered CHT deployment on k3d
lastUpdated: '2026-06-23'
summary: CHT had no standardized Kubernetes/Helm deployment path; this PR adds a cht-chart Helm chart (api, sentinel, single + clustered CouchDB, HAProxy, healthcheck, upgrade-service, RBAC, ingress) and a one-shot cht-deploy script that provisions and installs a distributed/clustered CHT onto a local k3d cluster.
services:
  - api
  - sentinel
techStack:
  - kubernetes
  - helm
  - k3d
  - couchdb
  - haproxy
  - docker
  - bash
  - python
  - yaml
tags:
  - kubernetes
  - helm
  - k3d
  - deployment
  - clustering
  - devops
  - infrastructure-as-code
  - couchdb
related_workflows: []
source_pr: medic/cht-core#8693
source_sha: 71e98ea80ee8424a8b265ded26cbc3b4f806a2f7
distilled_at: '2026-06-23'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - scripts/deploy/cht-deploy
  - scripts/deploy/helm/cht-chart/
  - scripts/deploy/helm/cht-chart/values.yaml
  - scripts/deploy/helm/cht-chart/templates/
  - scripts/deploy/tasks.py
  - scripts/deploy/prepare.sh
  - scripts/deploy/troubleshooting/
concepts:
  - Kubernetes deployment
  - Helm chart templating
  - infrastructure-as-code
  - clustered CouchDB topology
  - container orchestration
  - RBAC service accounts
  - local development cluster (k3d)
related_issues: []
stale: false
---

## Problem

CHT lacked Kubernetes deployment artifacts and tooling — there was no standardized, parameterized way to deploy a distributed/clustered CHT to a Kubernetes cluster, and no easy one-command path to stand one up locally for development or testing.

## Root Cause

Architectural gap rather than a bug: the project shipped Docker Compose deployment paths but had no Helm chart or Kubernetes manifests, so cluster/cloud-oriented deployments had to be hand-rolled.

## Solution

Introduced a cht-chart Helm chart under scripts/deploy/helm with templates for the api deployment/service, sentinel, single-node and clustered CouchDB (deployments, services, persistent volumes/claims, servers configmap, credentials), HAProxy, healthcheck, upgrade-service (deployment, service, service account), deployment-manager RBAC role + rolebinding, and environment-specific ingress (k3d-api-ingress.yaml and eks-api-ingress.yaml). Added a cht-deploy one-shot bash script plus prepare.sh and a Python tasks.py helper to provision a local k3d cluster and install the chart into a namespace, along with kubectl troubleshooting helper scripts (view-logs, describe-deployment, list/restart deployments).

## Code Patterns

Helm values.yaml driving all deployment parameters (scripts/deploy/helm/cht-chart/values.yaml); separate templates for single vs clustered CouchDB (couchdb-single-deployment.yaml vs couchdb-n-deployment.yaml + couchdb-n-persistentvolume.yaml); environment-targeted ingress selection (k3d-api-ingress.yaml vs eks-api-ingress.yaml); RBAC role + rolebinding + dedicated service account for the upgrade-service (deployment-manager.role.yml, deployment-manager.rolebinding.yml, upgrade-service.svcaccounts.yaml); pre-deployment-job-n.yaml init pattern.

## Design Choices

Chose Helm for parameterized, reusable manifests over raw kubectl YAML; used k3d for a lightweight local Kubernetes target; provided distinct single-node and clustered CouchDB templates to support both topologies; shipped both k3d and EKS ingress templates to cover local and AWS deployments. Note: this PR is a clean-merge clone of the original #8263, re-created to attribute credit to @henokgetachew and pass builds.

## Related Files

- scripts/deploy/cht-deploy
- scripts/deploy/README.md
- scripts/deploy/prepare.sh
- scripts/deploy/tasks.py
- scripts/deploy/helm/cht-chart/values.yaml
- scripts/deploy/helm/cht-chart/Chart.yaml
- scripts/deploy/helm/cht-chart/templates/api-deployment.yaml
- scripts/deploy/helm/cht-chart/templates/couchdb-single-deployment.yaml
- scripts/deploy/helm/cht-chart/templates/couchdb-n-deployment.yaml
- scripts/deploy/helm/cht-chart/templates/haproxy-deployment.yaml
- scripts/deploy/helm/cht-chart/templates/upgrade-service-deployment.yml
- scripts/deploy/helm/cht-chart/templates/k3d-api-ingress.yaml
- scripts/deploy/helm/cht-chart/templates/eks-api-ingress.yaml

## Testing

Validated manually rather than via automated tests: per the PR, run ./cht-deploy to stand up the local k3d cluster, then `kubectl -n cht-dev-namespace get all` to confirm CHT resources were created. The clone was made specifically to achieve a clean merge with passing CI builds.

## Related Issues

- #8263: Original PR for the Kubernetes/Helm CHT deployment work; closed, reopened, and ultimately merged under @henokgetachew to credit the author
- #8695: Related issue referenced in the PR body

## Domain Rationale

**Fit:** strong

This is pure operational-lifecycle/deployment work — Kubernetes manifests, Helm chart templates, and a one-shot k3d deploy script. Helm/k8s/deploy tooling is canonically the infrastructure domain (no application behavior changes).
