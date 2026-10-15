---
id: cht-core-11198
category: bug
domain: infrastructure
domainFit: strong
issueNumber: 11198
issueUrl: https://github.com/medic/cht-core/issues/11198
title: Patch node-fetch 2.7.0 to prevent false ERR_STREAM_PREMATURE_CLOSE errors under Node.js 22.23
lastUpdated: '2026-10-01'
summary: Node.js 22.23.0 (and 24.17.0) shipped a security fix that made node-fetch 2.7.0 throw spurious ERR_STREAM_PREMATURE_CLOSE errors on chunked HTTP responses that had completed, which stopped API from starting. The fix adds a patch-package patch to node-fetch 2.7.0 that also checks whether the response emitted its end event, while keeping the upstream Node security fix.
services:
  - api
  - sentinel
techStack:
  - nodejs
  - node-fetch
  - patch-package
  - javascript
tags:
  - node-fetch
  - patch-package
  - node-22
  - dependency-patch
  - http-streams
  - ERR_STREAM_PREMATURE_CLOSE
  - runtime-compatibility
related_workflows: []
source_pr: medic/cht-core#11202
source_sha: 808eee984e1f6c87beaa10a598495af14967d4a0
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - patches/node-fetch+2.7.0.patch
concepts:
  - dependency patching via patch-package
  - HTTP response stream lifecycle
  - Node.js runtime version compatibility
  - premature stream close detection
related_issues: []
stale: false
---

## Problem

After Node.js 22.23.0 was released with a security fix, node-fetch began emitting false ERR_STREAM_PREMATURE_CLOSE errors on chunked HTTP responses (no `content-length`) that had actually completed normally. In CHT this made API startup fail with `Fatal error initialising API` on a CouchDB `_all_docs` request through `haproxy`, and every CI run failed. The issue suspects the new Node arrived through the `node:22-alpine` base image of the api and sentinel images, and says no released CHT version is affected.

## Root Cause

Node's CVE-2026-48931 fix (commit 0a22d40180, shipped in 22.23.0 and 24.17.0) keeps the socket `'data'` listener attached after a clean response. node-fetch 2.7.0's `fixResponseChunkedTransferBadEnding` treats a still-attached `data` listener at the response's `close` event, without `hadError`, as a truncated chunked response and raises `Premature close` with code `ERR_STREAM_PREMATURE_CLOSE`. The bug originates in the Node runtime change, surfaced through node-fetch's listener-count heuristic.

## Solution

Added a patch-package patch (`patches/node-fetch+2.7.0.patch`) that edits `fixResponseChunkedTransferBadEnding`: it records the response's own `end` event (`let responseEnded = false;`, set to true in `response.once('end', function () {`) and changes the check to `if (hasDataListener && !hadError && !responseEnded) {`. A response that emitted `end` is no longer reported as a premature close, while one that closes before `end` still is, restoring correct behavior on Node 22.23 without forgoing the runtime's security fix.

## Code Patterns

Work around an upstream dependency bug in place using patch-package: drop a diff at `patches/<package>+<version>.patch` (here `patches/node-fetch+2.7.0.patch`, next to the existing `patches/prometheus-api-metrics+4.0.0.patch`). The root package.json runs `patch-package` as its `postinstall` script, and `buildServiceImages` in scripts/build/index.js copies `./patches` with the root package.json and package-lock.json into a temp directory, runs `npm ci` with `--omit=dev` there and copies the resulting node_modules into the api and sentinel directories before building their images, so the patch ships in both images. Reusable whenever a third-party package needs a hotfix faster than an upstream release.

## Design Choices

At this PR, api/Dockerfile and sentinel/Dockerfile stay on the unpinned `node:22-alpine` base image, so the Node security fix stays in; node-fetch is patched in place at its existing 2.7.0 version rather than upgraded or replaced. The patch adds an end-of-response check rather than removing the listener-count heuristic, so genuinely truncated chunked responses are still reported.

## Related Files

- patches/node-fetch+2.7.0.patch

## Testing

No automated tests were added or modified in the PR — the sole change is the dependency patch file. The regression surfaced as API failing to start across CI, so API startup in the existing CI suites exercises the patched code.

## Related Issues

- node-fetch upstream: node-fetch/node-fetch#1576, "Getting `Premature close` errors unexpectedly but very reliably in specific circumstances" — an upstream report of the same `Premature close` error, linked as related in #11198's discussion.

## Domain Rationale

**Fit:** strong

This is a build-tooling dependency patch (patch-package format `patches/node-fetch+2.7.0.patch`) addressing a regression introduced by the Node.js 22.23 runtime in the api and sentinel base image. The only file is a patch applied to node_modules at install time and shipped in the service images; no CHT application code changed.
