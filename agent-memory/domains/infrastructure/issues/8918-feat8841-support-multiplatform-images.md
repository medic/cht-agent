---
id: cht-core-8918
category: feature
domain: infrastructure
domainFit: strong
issueNumber: 8918
issueUrl: https://github.com/medic/cht-core/issues/8918
title: Build multi-platform (linux/amd64 + linux/arm64) Docker images in the CI build pipeline
lastUpdated: '2026-06-23'
summary: CHT Docker images were built for a single CPU architecture, forcing emulation on ARM hardware; this PR updates the build scripts and GitHub Actions build workflow to build and tag multi-platform images for both linux/amd64 and linux/arm64.
services:
  - api
  - webapp
  - sentinel
  - admin
techStack:
  - docker
  - docker-buildx
  - github-actions
  - bash
  - nodejs
  - javascript
tags:
  - multi-platform
  - multi-arch
  - docker
  - buildx
  - arm64
  - amd64
  - ci
  - image-build
related_workflows: []
source_pr: medic/cht-core#8918
source_sha: 448c700b55a2d708a6bdd50509e554ebb3656e84
distilled_at: '2026-06-23'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - .github/workflows/build.yml
  - scripts/build/build-service-images.sh
  - scripts/build/index.js
  - scripts/ci/tag-docker-images.js
concepts:
  - multi-platform container images
  - docker buildx
  - cross-architecture builds
  - CI build/release pipeline
  - image tagging
related_issues: []
stale: false
---

## Problem

CHT service Docker images were only built for a single architecture (linux/amd64), so they could not run natively on arm64 hosts (e.g. Apple Silicon, ARM servers) and depended on slower emulation.

## Root Cause

The build scripts and the GitHub Actions build workflow produced single-architecture images only; there was no buildx-driven multi-platform configuration or list of target platforms.

## Solution

Introduced a BUILD_PLATFORMS list (linux/amd64, linux/arm64) and wired the build scripts (build-service-images.sh, index.js) and the build.yml CI workflow to use docker buildx for multi-platform builds, with tag-docker-images.js updated to tag the resulting multi-arch images.

## Code Patterns

BUILD_PLATFORMS = ['linux/amd64', 'linux/arm64'] constant in scripts/build/index.js drives docker buildx --platform multi-arch builds; scripts/build/build-service-images.sh builds each service image across platforms; scripts/ci/tag-docker-images.js tags the multi-platform manifests.

## Design Choices

Targets the two most common platforms (amd64 and arm64). Review discussion (mrjones-plip) flagged a possible need to express arm64 as 'linux/arm64/v8' for correct variant matching; merged with amd64/arm64 pending that follow-up.

## Related Files

- .github/workflows/build.yml
- scripts/build/build-service-images.sh
- scripts/build/index.js
- scripts/ci/tag-docker-images.js

## Testing

No unit/e2e tests added (Tested checkbox left unchecked); validated through the CI build pipeline producing the multi-platform Docker compose artifacts referenced in the PR.

## Related Issues

- #8841: Support multiplatform images

## Domain Rationale

**Fit:** strong

The PR modifies CI workflow and Docker build/tag scripts to produce multi-architecture container images — purely build/release/deploy lifecycle work, which is canonically the infrastructure domain.
