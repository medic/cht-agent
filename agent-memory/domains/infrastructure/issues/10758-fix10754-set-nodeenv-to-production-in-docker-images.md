---
id: cht-core-10754
category: bug
domain: infrastructure
domainFit: strong
issueNumber: 10754
issueUrl: https://github.com/medic/cht-core/issues/10754
title: Set NODE_ENV=production in api and sentinel Docker images so Secure cookies are enabled by default in production
lastUpdated: '2026-10-05'
summary: The api cookie service only sets the Secure flag when NODE_ENV=production, but that variable was never set in the Docker images, so production cookies were sent without the Secure attribute. Fixed by baking ENV NODE_ENV=production into the api/sentinel Dockerfiles (and Helm templates/values), with the test compose override and k3d test values setting NODE_ENV=development for test runs.
services:
  - api
  - sentinel
techStack:
  - docker
  - helm
  - kubernetes
  - docker-compose
  - nodejs
tags:
  - node-env
  - secure-cookies
  - docker-image
  - environment-variables
  - helm
  - session-security
  - production-defaults
related_workflows: []
source_pr: medic/cht-core#10758
source_sha: 33ec8cf409ba4226c904932dbf3f8a0b1b17cd59
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - api/Dockerfile
  - sentinel/Dockerfile
  - tests/cht-core-test.override.yml
  - scripts/build/helm/templates/api/deployment.yaml
  - scripts/build/helm/templates/sentinel/deployment.yaml
  - scripts/build/helm/values/base.yaml
  - api/src/services/cookie.js
concepts:
  - environment-based configuration
  - secure cookie (HTTPS-only) flag
  - Docker image environment defaults
  - test environment override layering
  - secure-by-default production hardening
related_issues:
  - cht-core-10357
  - cht-core-10815
stale: true
---

## Problem

Session cookies issued by the API were being sent without the `Secure` attribute even in production deployments, meaning they could be transmitted over plain HTTP — a session-security weakness affecting every deployment run from these images unless the operator set NODE_ENV separately.

## Root Cause

api/src/services/cookie.js gates the Secure cookie attribute on `NODE_ENV === 'production'`, but neither api/Dockerfile nor sentinel/Dockerfile (nor the Helm deployment manifests) set NODE_ENV, so deployed containers ran without it and defaulted to non-secure cookies.

## Solution

api/Dockerfile and sentinel/Dockerfile each gained `ENV NODE_ENV=production`, and the setting was propagated through the Helm deployment templates and base values, so production containers default to secure cookies. Test runs opt out: the existing tests/cht-core-test.override.yml (introduced by PR #10583) gained `NODE_ENV=development` for the api and sentinel containers, and scripts/build/helm/tests/integration-k3d-values.yaml.template gained `node_env: "development"` for both services. The PR description gives the reason as keeping the integration and E2E suites working in non-SSL environments.

## Code Patterns

Bake the safe production default into the container image: api/Dockerfile and sentinel/Dockerfile each contain `ENV NODE_ENV=production`. Opt out per environment rather than weakening the default; for Docker Compose test runs the opt-out lives in tests/cht-core-test.override.yml. Expose the value through the Helm deployment templates (scripts/build/helm/templates/api/deployment.yaml and scripts/build/helm/templates/sentinel/deployment.yaml read a per-service `node_env` value with a "production" default) and set it in scripts/build/helm/values/base.yaml so each deployment can override it.

## Design Choices

Made NODE_ENV=production a secure-by-default baseline in the image instead of relying on each deployment to set it; test environments explicitly opt out via an override file forcing NODE_ENV=development rather than relaxing the production default. The change reuses the layout PR #10583 introduced for LOG_LEVEL: the same Helm templates, scripts/build/helm/values/base.yaml blocks, k3d test values and test override file gained a NODE_ENV / `node_env` entry beside the LOG_LEVEL / `log_level` one.

## Related Files

- api/Dockerfile
- sentinel/Dockerfile
- tests/cht-core-test.override.yml
- scripts/build/helm/templates/api/deployment.yaml
- scripts/build/helm/templates/sentinel/deployment.yaml
- scripts/build/helm/tests/integration-k3d-values.yaml.template
- scripts/build/helm/values/base.yaml

## Testing

No spec file changed in this PR. The Secure-flag logic the variable drives is covered by the existing api/tests/mocha/services/cookie.spec.js, which stubs `process.env` with `NODE_ENV: 'production'` and expects `secure: true`; no test checks that the images set the variable. Test containers pick up NODE_ENV=development because tests/utils/index.js already passes tests/cht-core-test.override.yml as an extra `-f` file in `dockerComposeCmd`; that `-f` came in with PR #10583.

## Related Issues

- PR #10583: "fix(#10357): prevent DEBUG logs from appearing in production" — its per-service LOG_LEVEL Helm values and test override file are what this PR extends with NODE_ENV.
- #10357: "debug level messages printed on production instances" — the issue PR #10583 fixed; its root cause was the same unset NODE_ENV, which the shared logger used to pick the debug level before PR #10583.
- #10815: "Existing helm chart fails after recent changes on helm chart" — the `.Values.api.node_env` and `.Values.sentinel.node_env` reads this PR added failed `helm upgrade` renders for values files without `api:` or `sentinel:` blocks; a comment on #10754 said the fix "should not be shipped to 5.2.0 without fixing #10815", and PR #10826 made those reads nil-safe.

## Domain Rationale

**Fit:** strong

All seven changed files are Docker images (api/sentinel Dockerfiles), Helm deployment templates/values, and a docker-compose test override — the canonical infrastructure (build/deploy/image-config) domain; no authentication code was touched. The motivation is session-cookie security (an authentication concern), but every change is to how the images and deployments are configured.
