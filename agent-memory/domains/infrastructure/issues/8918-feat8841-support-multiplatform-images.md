---
id: cht-core-8841
category: bug
domain: infrastructure
domainFit: strong
issueNumber: 8841
issueUrl: https://github.com/medic/cht-core/issues/8841
title: Build multi-platform (linux/amd64 + linux/arm64/v8) Docker images in the CI build pipeline for internal builds
lastUpdated: '2026-10-08'
summary: 'CHT Docker images were built for a single architecture, so Apple Silicon hosts ran them under qemu emulation, where the CouchDB container crashed. For internal-contributor CI builds this PR builds and pushes every service and infrastructure image for linux/amd64 and linux/arm64/v8 with docker buildx, and retags release images with regctl instead of docker pull/tag/push.'
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
  - regctl
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

CHT service Docker images were only built for a single architecture (linux/amd64), so they could not run natively on arm64 hosts such as Apple Silicon Macs and ran under qemu emulation instead. Issue #8841 reports the CouchDB container crashing there with a segmentation fault, leaving Docker Helper returning 502 Bad Gateway on CHT 4.5.1.

## Root Cause

Before this PR, `buildServiceImages` and `buildImages` in `scripts/build/index.js` ran a plain docker build with no platform list, `pushServiceImages` pushed those single-architecture images, and `scripts/ci/tag-docker-images.js` retagged release images with `dockerCmd('pull', existentTag)`, `dockerCmd('image', 'tag', existentTag, releaseTag)` and `dockerCmd('push', releaseTag)`.

## Solution

`scripts/build/index.js` gains `const BUILD_PLATFORMS = ['linux/amd64', 'linux/arm64/v8'];`. When `INTERNAL_CONTRIBUTOR` is set, `buildServiceImages` (api, sentinel) and the new `buildInfrastructureImages` (couchdb, haproxy, haproxy-healthcheck, nginx at this PR) run docker buildx build with `'--provenance=false'`, `'--platform=' + BUILD_PLATFORMS.join(',')` and `'--push'`, building and pushing each image in one step; otherwise they keep the single-platform docker build, and `publishServiceImages` saves the images as tar files with docker save. `pushServiceImages` is removed, and `scripts/build/build-service-images.sh` now calls `node scripts/build/cli buildInfrastructureImages` in place of `buildImages`. In `.github/workflows/build.yml` the build job gains `Setup QEMU` (docker/setup-qemu-action) and `Setup Buildx` (docker/setup-buildx-action) steps, and the publish job an `Install regctl` step, all gated on `env.INTERNAL_CONTRIBUTOR`. `scripts/ci/tag-docker-images.js` now retags each release image with `await regctlCmd('image', 'copy', existentTag, releaseTag);` instead of pulling, tagging and pushing it with docker.

## Code Patterns

`BUILD_PLATFORMS` in `scripts/build/index.js` is joined into buildx's `--platform` argument, and the image is pushed by buildx itself (`'--push'`); builds without push credentials keep the single-platform docker build plus docker save path. Release retagging goes through regctl image copy in `scripts/ci/tag-docker-images.js`, so no local copy of the image is pulled: `docker pull` on the amd64 CI runner fetches only the linux/amd64 image, so the previous pull, tag and push retagging would have published release tags without arm64.

## Design Choices

Multi-platform builds run only when `INTERNAL_CONTRIBUTOR` is set, the same condition that gates the Docker Hub and Amazon ECR logins earlier in the build job (`INTERNAL_CONTRIBUTOR: ${{ secrets.AUTH_MARKET_URL && 'true' }}` in `.github/workflows/build.yml`). Other builds keep single-platform images and upload `images/` as the `cht-images` artifact. The arm64 target is spelled with its variant, `linux/arm64/v8`, at a reviewer's request in the PR review. Before the switch to `linux/arm64/v8`, a reviewer's check of the images published from the PR's branch found cht-api and cht-sentinel listed for linux/amd64 only. The same check listed linux/arm64 for cht-couchdb, cht-nginx, cht-haproxy and cht-haproxy-healthcheck, which were built with the same plain `linux/arm64` spelling, and until commit 5352e5fb5b the PR built api and sentinel with a single-platform docker build, so the record does not show that the spelling caused the api and sentinel result.

## Related Files

- .github/workflows/build.yml
- scripts/build/build-service-images.sh
- scripts/build/index.js
- scripts/ci/tag-docker-images.js

## Testing

The diff touches only `.github/workflows/build.yml`, `scripts/build/build-service-images.sh`, `scripts/build/index.js` and `scripts/ci/tag-docker-images.js`; it contains no unit or e2e tests. The PR thread records the checks instead: the author linked two demo CI runs, one for the external-contributor path and one for the internal-contributor path, and after the switch to `linux/arm64/v8` reported that all six images (cht-api, cht-sentinel, cht-couchdb, cht-haproxy, cht-haproxy-healthcheck, cht-nginx) support linux/amd64 and linux/arm64. A reviewer reported no regressions in local tests on Linux.

## Related Issues

- #8841: "Docker Helper error on macOS Apple Silicon: "qemu: uncaught target signal 11 (Segmentation fault)"" — this draft's issue: the CouchDB container crashing under qemu emulation on Apple Silicon.

## Domain Rationale

**Fit:** strong

The PR modifies CI workflow and Docker build/tag scripts to produce multi-architecture container images — purely build/release/deploy lifecycle work, which is canonically the infrastructure domain.
