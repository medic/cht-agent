---
id: cht-core-10754
category: bug
domain: infrastructure
domainFit: strong
issueNumber: 10754
issueUrl: https://github.com/medic/cht-core/issues/10754
title: Set NODE_ENV=production in api and sentinel Docker images so Secure cookies are enabled by default in production
lastUpdated: '2026-06-22'
summary: The api cookie service only sets the Secure flag when NODE_ENV=production, but that variable was never set in the Docker images, so production cookies were sent without the Secure attribute. Fixed by baking ENV NODE_ENV=production into the api/sentinel Dockerfiles (and Helm templates/values), with a test override forcing NODE_ENV=development so non-SSL CI/E2E suites still run.
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
related_issues: []
stale: false
---

## Problem

Session cookies issued by the API were being sent without the `Secure` attribute even in production deployments, meaning they could be transmitted over plain HTTP — a session-security weakness affecting all deployed instances.

## Root Cause

api/src/services/cookie.js gates the Secure cookie attribute on `NODE_ENV === 'production'`, but neither api/Dockerfile nor sentinel/Dockerfile (nor the Helm deployment manifests) set NODE_ENV, so deployed containers ran without it and defaulted to non-secure cookies.

## Solution

Added `ENV NODE_ENV=production` to api/Dockerfile and sentinel/Dockerfile and propagated the setting through the Helm deployment templates and base values, so production containers default to secure cookies. To keep non-SSL integration/E2E suites working, added tests/cht-core-test.override.yml that forces NODE_ENV=development during test execution, layered onto the Docker orchestration.

## Code Patterns

Bake the safe production default into the container image (`ENV NODE_ENV=production` in api/Dockerfile and sentinel/Dockerfile) and opt out per-environment with a compose override (tests/cht-core-test.override.yml) rather than weakening the default. Expose the value through Helm deployment templates (scripts/build/helm/templates/{api,sentinel}/deployment.yaml) and centralize it in scripts/build/helm/values/base.yaml so it is tunable per release.

## Design Choices

Made NODE_ENV=production a secure-by-default baseline in the image instead of relying on each deployment to set it; test environments explicitly opt out via an override file forcing NODE_ENV=development rather than relaxing the production default. Followed the environment-configuration pattern being established in PR #10583.

## Related Files

- api/Dockerfile
- sentinel/Dockerfile
- tests/cht-core-test.override.yml
- scripts/build/helm/templates/api/deployment.yaml
- scripts/build/helm/templates/sentinel/deployment.yaml
- scripts/build/helm/tests/integration-k3d-values.yaml.template
- scripts/build/helm/values/base.yaml
- api/src/services/cookie.js

## Testing

Ran the existing unit suite api/tests/mocha/services/cookie.spec.js (18/18 passing) to verify the Secure-flag logic; confirmed the test utilities correctly layer the override file during Docker orchestration so integration/E2E suites run in non-SSL environments; linted all modified files with eslint. No dedicated automated test was added for the new env-var behavior.

## Related Issues

- #10754: Secure cookie attribute not applied in production because NODE_ENV was unset in the Docker images
- #10583: PR establishing the environment-configuration pattern this change follows

## Domain Rationale

**Fit:** strong

All seven changed files are Docker images (api/sentinel Dockerfiles), Helm deployment templates/values, and a docker-compose test override — the canonical infrastructure (build/deploy/image-config) domain; no authentication code was touched. The motivation is session-cookie security (an authentication concern), but the change is classified by the setup/deploy nature of the files it touches.
