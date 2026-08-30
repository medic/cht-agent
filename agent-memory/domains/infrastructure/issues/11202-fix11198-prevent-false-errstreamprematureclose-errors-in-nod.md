---
id: cht-core-11198
category: bug
domain: infrastructure
domainFit: strong
issueNumber: 11198
issueUrl: https://github.com/medic/cht-core/issues/11198
title: Patch node-fetch 2.7.0 to prevent false ERR_STREAM_PREMATURE_CLOSE errors under Node.js 22.23
lastUpdated: '2026-06-22'
summary: Node.js 22.23 shipped a security fix containing a known regression that caused node-fetch to throw spurious ERR_STREAM_PREMATURE_CLOSE errors on otherwise-successful HTTP requests. The fix adds a patch-package patch to node-fetch 2.7.0 that neutralizes the false stream-close detection while keeping the upstream Node security fix.
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

After Node.js 22.23.0 was released with a security fix, node-fetch began emitting false ERR_STREAM_PREMATURE_CLOSE errors on HTTP requests that actually completed normally. This caused server-side outbound HTTP calls (e.g. to CouchDB and external endpoints) to fail spuriously, affecting any code path relying on node-fetch.

## Root Cause

The Node 22.23 security patch altered stream-close/destroy behavior in a way that interacts badly with node-fetch 2.7.0's response body stream handling, tripping its premature-close guard even when the response was fully and successfully delivered. The bug originates in the Node runtime change, surfaced through node-fetch's stream lifecycle logic.

## Solution

Added/updated a patch-package patch (`patches/node-fetch+2.7.0.patch`) that modifies node-fetch 2.7.0's stream handling so it no longer raises the false ERR_STREAM_PREMATURE_CLOSE on completed responses, restoring correct behavior on Node 22.23 without forgoing the runtime's security fix.

## Code Patterns

Work around an upstream dependency bug in place using patch-package: drop a diff at `patches/<package>+<version>.patch` (here `patches/node-fetch+2.7.0.patch`) that is applied automatically at install/build time. Reusable whenever a third-party package needs a hotfix faster than an upstream release.

## Design Choices

Patching node-fetch via patch-package was preferred over pinning Node to a pre-22.23 version (which would drop the security fix) or waiting for an upstream node-fetch release. The patch surgically suppresses the false error while preserving both the Node security fix and the existing node-fetch dependency version.

## Related Files

- patches/node-fetch+2.7.0.patch

## Testing

No automated tests were added or modified in the PR — the sole change is the dependency patch file. Verification was effectively manual/integration-level, confirming that node-fetch HTTP requests no longer throw false ERR_STREAM_PREMATURE_CLOSE errors under Node.js 22.23.

## Related Issues

- #11198: Node.js 22.23 security fix introduces a known bug causing false ERR_STREAM_PREMATURE_CLOSE errors in node-fetch

## Domain Rationale

**Fit:** strong

This is a build-tooling dependency patch (patch-package format `patches/node-fetch+2.7.0.patch`) addressing a regression introduced by the Node.js 22.23 runtime. Runtime/dependency maintenance and upgrade-lifecycle compatibility work canonically belong to infrastructure, not configuration.
