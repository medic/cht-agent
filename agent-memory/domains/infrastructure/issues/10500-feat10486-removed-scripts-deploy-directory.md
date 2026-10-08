---
id: cht-core-10486
category: improvement
domain: infrastructure
domainFit: strong
issueNumber: 10486
issueUrl: https://github.com/medic/cht-core/issues/10486
title: Remove unused and unmaintained scripts/deploy directory (Helm-based cht-deploy tooling)
lastUpdated: '2026-10-08'
summary: The scripts/deploy directory held an unused, unmaintained Helm-based cht-deploy script that by default deployed the external medic/cht-chart-4x chart; the issue called the script confusing and said it would launch instances from old Helm charts that the project no longer maintains or has deleted. It was deleted entirely to steer users toward official self-serve deployment paths.
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
  - root npm script and lint configuration cleanup
related_issues: []
stale: false
---

## Problem

Before this PR, the scripts/deploy directory contained the cht-deploy deployment script, which the issue describes as unused and unmaintained. Its continued existence was confusing because it would attempt to launch CHT instances using old helm charts that the issue says are no longer maintained or have already been deleted, misleading community members trying to self-deploy. At this PR's parent, scripts/deploy/src/config.js defaulted `CHT_CHART_NAME` to `'medic/cht-chart-4x'` and `MEDIC_REPO_URL` to `'https://docs.communityhealthtoolkit.org/helm-charts'`, the chart repository that scripts/deploy/README.md identified as medic/helm-charts, although cht-core had carried its own chart in-repo under scripts/build/helm since PR #10051. On master the CHT Helm chart still lives at scripts/build/helm.

## Root Cause

Legacy deployment tooling left in the repository after the project moved to pointing the community at official self-serve deployment paths, workflows and instructions. The script still defaulted to the external `medic/cht-chart-4x` chart, so it would launch instances from charts the issue says the project no longer maintains.

## Solution

Deleted the entire scripts/deploy directory — the scripts/deploy/cht-deploy entrypoint, the modules scripts/deploy/src/certificate.js, scripts/deploy/src/config.js, scripts/deploy/src/error.js, scripts/deploy/src/install.js and scripts/deploy/src/prepare.sh, the three mocha specs under scripts/deploy/tests/, and the seven kubectl troubleshooting helpers under scripts/deploy/troubleshooting/ (describe-deployment, get-all-logs, get-volume-binding, list-all-resources, list-deployments, restart-deployment, view-logs). Removed the now-dangling references: the `files: ['scripts/deploy/**/*']` override (setting `sourceType: 'module'`) in the root eslint.config.js, and, in the root package.json, the `unit-cht-deploy` npm script (`"cd scripts/deploy && npm test"`) together with its `npm run unit-cht-deploy` step in `ci-compile`.

## Code Patterns

When decommissioning a sub-package that is not an npm workspace (at this PR the root package.json `workspaces` list was only `./shared-libs/*`), remove the root npm scripts that invoke it and any path-scoped override in eslint.config.js, so lint and CI no longer target the deleted tree.

## Design Choices

Chose full decommissioning over the issue's alternative of bringing the script back to life, because the project is intentionally pushing users to official, documented self-serve deployment paths rather than maintaining an in-repo deploy script.

## Related Files

- scripts/deploy/cht-deploy (deleted)
- scripts/deploy/src/install.js (deleted)
- scripts/deploy/package.json (deleted)
- eslint.config.js
- package.json

## Testing

No tests were added for a removal. The directory's own specs (scripts/deploy/tests/helm.test.js, scripts/deploy/tests/package-json-validate.test.js, scripts/deploy/tests/validate-arguments.test.js) were deleted along with the rest, and with them the root `unit-cht-deploy` script that `ci-compile` used to run them.

## Related Issues

- #10486: "Remove scripts/deploy" — this draft's issue; it reported scripts/deploy as unused, unmaintained and launching instances from old or deleted helm charts, and asked for immediate decommissioning (reviving the script was the alternative considered).

## Domain Rationale

**Fit:** strong

The PR decommissions deployment tooling — the Helm/Kubernetes-based cht-deploy script and its kubectl troubleshooting helpers — which is squarely operational deploy lifecycle, the canonical infrastructure domain.
