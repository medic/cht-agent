---
id: cht-core-10357
category: bug
domain: infrastructure
domainFit: strong
issueNumber: 10357
issueUrl: https://github.com/medic/cht-core/issues/10357
title: Prevent DEBUG logs in production by defaulting LOG_LEVEL to 'info' and adding per-service Helm log_level config
lastUpdated: '2026-10-01'
summary: DEBUG logs appeared in production API/sentinel pods because the shared logger chose 'debug' whenever NODE_ENV was unset or 'development', and the images and Helm templates never set NODE_ENV. Fixed by driving the level from LOG_LEVEL with an 'info' default in the shared logger, passing per-service log_level values through the Helm templates, and setting LOG_LEVEL=debug for CI, test and local dev runs.
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
related_issues:
  - cht-core-10754
stale: true
---

## Problem

Operators saw many DEBUG-level entries in production CHT API pod logs (the issue greps `kubectl` log output for DEBUG and shows the `Checking for a configured outgoing message service` debug message from api/src/services/messaging.js once a minute) despite the documented default log level of 'info'. Sentinel uses the same shared logger, so it was affected the same way. The verbose output bloated production logs and contradicted hosting documentation.

## Root Cause

Before this PR, shared-libs/logger/src/node-logger.js did not read LOG_LEVEL at all: it set `const env = process.env.NODE_ENV || 'development';` and gave the console transport `level: env === 'development' ? 'debug' : 'info'`. NODE_ENV was set in none of api/Dockerfile, sentinel/Dockerfile, the compose templates under scripts/build/ or the Helm templates, so production containers logged at debug. Neither Helm deployment template passed a LOG_LEVEL, and scripts/build/helm/values/base.yaml had no log_level values.

## Solution

shared-libs/logger/src/node-logger.js now uses `const logLevel = process.env.LOG_LEVEL || 'info';` as the console transport level, so NODE_ENV no longer affects logging. Both Helm deployment templates gained a LOG_LEVEL env entry: scripts/build/helm/templates/api/deployment.yaml reads the API's `log_level` value and scripts/build/helm/templates/sentinel/deployment.yaml reads sentinel's, each defaulting to "info". scripts/build/helm/values/base.yaml gained `log_level: "info"` under `api:` and a `sentinel:` block with the same default. Debug output is kept where it is wanted: the workflow-level `env:` block of .github/workflows/build.yml sets `LOG_LEVEL: 'debug'`, the `dev-api` and `dev-sentinel` scripts in package.json export `LOG_LEVEL=debug`, the added tests/cht-core-test.override.yml sets `LOG_LEVEL=debug` for the api and sentinel containers, and scripts/build/helm/tests/integration-k3d-values.yaml.template sets both services' `log_level` to "debug". The PR description's claims that it fixed the sentinel Helm values path and moved `LOG_LEVEL=debug` from npm scripts to the CI env describe changes relative to PR #10376; relative to master, the squash adds LOG_LEVEL to both templates (before this PR neither template had a LOG_LEVEL entry to correct) and adds `export LOG_LEVEL=debug` to the two dev scripts.

## Code Patterns

Default operational env vars at read time in the shared lib (e.g. `process.env.LOG_LEVEL || 'info'` in shared-libs/logger/src/node-logger.js) so safe behavior holds regardless of deployment. Set CI-wide test env vars once in the workflow-level `env:` block of .github/workflows/build.yml rather than in each npm test script. Give each service its own Helm values scope so each deployment template reads its own key: at this PR the templates read `.Values.api.log_level` and `.Values.sentinel.log_level`; on master they read `(default (dict) .Values.api).log_level` and `(default (dict) .Values.sentinel).log_level`, changed by PR #10826 (#10815) so a values file without an `api:` or `sentinel:` block still renders.

## Design Choices

Hardcoding the safe default in application code guarantees production gets 'info' even if Helm/env config is incomplete. Decoupling the log level from NODE_ENV means environments that want debug output must now set LOG_LEVEL explicitly, which is why CI, the test compose override, the k3d test values and the local dev scripts all set it to debug.

## Related Files

- .github/workflows/build.yml
- package.json
- scripts/build/helm/templates/api/deployment.yaml
- scripts/build/helm/templates/sentinel/deployment.yaml
- scripts/build/helm/tests/integration-k3d-values.yaml.template
- scripts/build/helm/values/base.yaml
- shared-libs/logger/src/node-logger.js
- shared-libs/logger/test/index.spec.js
- tests/cht-core-test.override.yml (added)
- tests/utils/index.js

## Testing

In shared-libs/logger/test/index.spec.js, the `uses info level in production environment` case was replaced by `defaults to info level when LOG_LEVEL is not set` and `uses LOG_LEVEL when set`, which reload the module with rewire and read `logLevel`. tests/utils/index.js now passes the added tests/cht-core-test.override.yml as an extra `-f` file in `dockerComposeCmd`, so test containers run with LOG_LEVEL=debug.

## Related Issues

- PR #10376: "fix(#10357): prevent DEBUG logs from appearing in production" — earlier, unmerged PR for the same issue that this PR's description says it is based on.
- #10754: "Cookies not being sent with `secure: true`" — the cookie counterpart of this change. `api/src/services/cookie.js` also keys off `NODE_ENV === 'production'`, which the containers never set; this PR stopped the logger depending on NODE_ENV, and PR #10758 fixed the cookie side by setting NODE_ENV next to LOG_LEVEL in the same Helm templates, values and test override.

## Domain Rationale

**Fit:** strong

Log-level control is a hosting/deploy operational concern, and the fix is predominantly in Helm deployment templates, Helm values defaults, and the CI workflow env (operational lifecycle). The supporting default in the shared logger lib backstops this operational behavior rather than changing a functional feature.
