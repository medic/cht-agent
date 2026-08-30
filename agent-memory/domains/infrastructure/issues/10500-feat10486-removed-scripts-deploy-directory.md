---
id: cht-core-10486
category: improvement
domain: infrastructure
domainFit: strong
issueNumber: 10486
issueUrl: https://github.com/medic/cht-core/issues/10486
title: Remove unused and unmaintained scripts/deploy directory (Helm-based cht-deploy tooling)
lastUpdated: '2026-06-22'
summary: The scripts/deploy directory held an unused, unmaintained Helm-based cht-deploy script that tried to launch instances from old/deleted helm charts and confused community deployers. It was deleted entirely to steer users toward official self-serve deployment paths.
services:
  - api
techStack:
  - javascript
  - nodejs
  - bash
  - helm
  - kubernetes
tags:
  - deployment
  - helm
  - kubernetes
  - decommission
  - dead-code-removal
  - cht-deploy
  - cleanup
related_workflows: []
source_pr: medic/cht-core#10500
source_sha: 1c3277c4e5963be97501e60a1445dd16dd35710d
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - scripts/deploy/
  - scripts/deploy/cht-deploy
  - scripts/deploy/src/install.js
  - eslint.config.js
  - package.json
concepts:
  - deployment tooling
  - Helm chart deployment
  - Kubernetes orchestration
  - dead code removal
  - monorepo workspace configuration
related_issues: []
stale: false
---

## Problem

The scripts/deploy directory contained the cht-deploy deployment script which was unused and unmaintained. Its continued existence was confusing because it would attempt to launch CHT instances using old helm charts that are no longer maintained or have already been deleted, misleading community members trying to self-deploy.

## Root Cause

Legacy deployment tooling left in the repository after the project shifted to official self-serve deployment workflows and documentation on cht-docs. The script still referenced deprecated/removed helm charts, so it could no longer produce a working deployment.

## Solution

Deleted the entire scripts/deploy directory — the cht-deploy entrypoint, src modules (certificate.js, config.js, error.js, install.js, prepare.sh), helm/argument-validation tests, and the kubectl troubleshooting helpers (get-all-logs, restart-deployment, view-logs, etc.). Cleaned up the now-dangling references in the root eslint.config.js and package.json (workspace/lint configuration).

## Code Patterns

When decommissioning a sub-package in a monorepo, remove its workspace entry from the root package.json and any path references from eslint.config.js so lint/build no longer target the deleted tree.

## Design Choices

Chose full decommissioning over updating the script to current helm charts, because the project is intentionally pushing users to official, documented self-serve deployment paths rather than maintaining an in-repo deploy script.

## Related Files

- scripts/deploy/cht-deploy
- scripts/deploy/src/install.js
- scripts/deploy/package.json
- eslint.config.js
- package.json

## Testing

No new tests were required for a removal; the directory's own tests (helm.test.js, package-json-validate.test.js, validate-arguments.test.js) were deleted along with the rest. Correctness is confirmed by the monorepo continuing to lint/build after the workspace and eslint references were removed.

## Related Issues

- #10486: scripts/deploy (cht-deploy) is unused, unmaintained, and references deleted helm charts; requested immediate decommissioning

## Domain Rationale

**Fit:** strong

The PR decommissions deployment tooling — the Helm/Kubernetes-based cht-deploy script and its kubectl troubleshooting helpers — which is squarely operational deploy lifecycle, the canonical infrastructure domain.
