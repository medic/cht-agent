---
id: cht-core-10357
category: bug
domain: infrastructure
domainFit: strong
issueNumber: 10357
issueUrl: https://github.com/medic/cht-core/issues/10357
title: Prevent DEBUG logs in production by defaulting LOG_LEVEL to 'info' and correcting per-service Helm log_level config
lastUpdated: '2026-06-22'
summary: DEBUG logs appeared in production API/sentinel pods despite NODE_ENV=production because LOG_LEVEL was never defaulted and the sentinel Helm template read the wrong values path. Fixed by defaulting LOG_LEVEL to 'info' in the shared logger, correcting the Helm templates/values, and centralizing LOG_LEVEL=debug in the CI workflow.
services:
  - api
  - sentinel
techStack:
  - nodejs
  - javascript
  - helm
  - kubernetes
  - github-actions
  - yaml
tags:
  - logging
  - log-level
  - debug-logs
  - production
  - helm
  - ci
  - observability
  - environment-variables
related_workflows:
  - observability
source_pr: medic/cht-core#10583
source_sha: 3f71ecd503b3871c84246fd91fcd65014ddf2a28
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - shared-libs/logger/src/node-logger.js
  - scripts/build/helm/templates/sentinel/deployment.yaml
  - scripts/build/helm/templates/api/deployment.yaml
  - scripts/build/helm/values/base.yaml
  - .github/workflows/build.yml
concepts:
  - log level configuration
  - environment-variable defaults
  - Helm template values resolution
  - per-service deployment config
  - CI environment configuration
related_issues: []
stale: false
---

## Problem

Operators saw many DEBUG-level entries in production CHT API (and sentinel) pod logs (e.g. `kubectl logs ... | grep DEBUG`) despite NODE_ENV=production and the documented default log level of 'info'. The verbose output bloated production logs and contradicted hosting documentation.

## Root Cause

The shared logger did not default LOG_LEVEL to 'info' when the env var was unset, so logging fell through to a more verbose level. Compounding this, the sentinel Helm deployment template referenced .Values.api.log_level instead of .Values.sentinel.log_level, and base.yaml provided no log_level defaults for either service, so deployments never reliably set 'info'.

## Solution

Default LOG_LEVEL to 'info' in shared-libs/logger/src/node-logger.js when not explicitly set; fix the sentinel Helm template to read .Values.sentinel.log_level; add api.log_level and sentinel.log_level defaults to base.yaml; and refactor LOG_LEVEL=debug out of individual npm scripts into a single CI workflow env block.

## Code Patterns

Default operational env vars at read time in the shared lib (e.g. `process.env.LOG_LEVEL || 'info'` in shared-libs/logger/src/node-logger.js) so safe behavior holds regardless of deployment. Centralize test/dev env vars in the CI workflow `env:` block rather than repeating them per npm script in package.json. Use per-service Helm values paths (.Values.sentinel.log_level vs .Values.api.log_level) so each deployment template reads its own scope.

## Design Choices

Hardcoding the safe default in application code guarantees production gets 'info' even if Helm/env config is incomplete. LOG_LEVEL=debug was centralized in the CI workflow env instead of duplicated across npm scripts for maintainability; hardcoding the value in dev/test scripts rather than reading the host LOG_LEVEL envar was suggested to reduce future confusion, left optional. A companion cht-docs PR was requested to update the hosting log-level documentation.

## Related Files

- .github/workflows/build.yml
- package.json
- scripts/build/helm/templates/api/deployment.yaml
- scripts/build/helm/templates/sentinel/deployment.yaml
- scripts/build/helm/tests/integration-k3d-values.yaml.template
- scripts/build/helm/values/base.yaml
- shared-libs/logger/src/node-logger.js
- shared-libs/logger/test/index.spec.js
- tests/cht-core-test.override.yml
- tests/utils/index.js

## Testing

Updated unit tests in shared-libs/logger/test/index.spec.js to cover the default-to-'info' behavior when LOG_LEVEL is unset; adjusted tests/utils/index.js and tests/cht-core-test.override.yml, and set LOG_LEVEL=debug in the CI workflow env so test/e2e runs retain verbose logging.

## Related Issues

- #10357: DEBUG logs appearing in production API/sentinel logs despite default 'info' level
- #10376: original contribution by @AmirSaudagar55 that this PR builds on (merge-conflict resolution, sentinel Helm values fix, CI env refactor)

## Domain Rationale

**Fit:** strong

Log-level control is a hosting/deploy operational concern, and the fix is predominantly in Helm deployment templates, Helm values defaults, and the CI workflow env (operational lifecycle). The supporting default in the shared logger lib backstops this operational behavior rather than changing a functional feature.
