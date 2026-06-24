---
id: cht-core-9888
category: bug
domain: infrastructure
domainFit: strong
issueNumber: 9888
issueUrl: https://github.com/medic/cht-core/issues/9888
title: Append timestamp to ddocs version for local builds so API auto-deploys design doc changes in development
lastUpdated: '2026-06-22'
summary: 'A regression from PR #9674 left the local ddocs build emitting a static version string, so the API stopped detecting and redeploying local design document changes. The fix appends the current timestamp to the version for local (non-TAG) builds, forcing a unique version each build so auto-deploy works again.'
services:
  - api
techStack:
  - javascript
  - nodejs
  - couchdb
tags:
  - build
  - ddocs
  - design-documents
  - versioning
  - local-development
  - auto-deploy
  - regression
related_workflows: []
source_pr: medic/cht-core#9891
source_sha: b58c1a7de95577fa92a75397742bd3d412007106
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - scripts/build/index.js
  - setDdocsVersion
concepts:
  - design document versioning
  - build tooling
  - local development workflow
  - auto-deployment
  - version-change detection
related_issues: []
stale: false
---

## Problem

After PR #9674 altered the local versioning logic, running `npm run build-ddocs` produced a version string identical to the already-deployed one. Because the running API server compares ddoc versions to decide whether to redeploy, it saw no change and stopped auto-deploying updated design documents during local development (e.g. via `npm run dev-api`), breaking the developer feedback loop.

## Root Cause

The `setDdocsVersion` function in scripts/build/index.js returned the value from `versions.getVersion()` unchanged for local builds. With no unique component per build, the API's version-comparison check found no difference and skipped redeployment of the design documents.

## Solution

Modified `setDdocsVersion` so that for local builds (when the `TAG` environment variable is unset) the current timestamp is appended to the base version returned by `versions.getVersion()`, yielding a unique version string on every `build-ddocs` run and prompting the API to detect the change and auto-deploy. For release builds (TAG set), the version remains exactly as provided.

## Code Patterns

Branch on the `TAG` env var to distinguish release builds from local/dev builds, and append a timestamp to a version string to force downstream change detection — see `setDdocsVersion` in scripts/build/index.js.

## Design Choices

Appending a timestamp only for local builds keeps release version strings deterministic and meaningful while restoring the dev auto-deploy workflow. The existing `TAG` env var was reused as the release-vs-local signal rather than introducing a new flag.

## Related Files

- scripts/build/index.js

## Testing

No automated tests added; verified manually by reviewer jkuester following the reproduction steps in issue #9888, confirming local ddoc changes auto-deploy again.

## Related Issues

- #9888: local ddoc changes no longer auto-deployed during development after the versioning change
- #9674: earlier PR that changed local versioning logic and introduced the regression

## Domain Rationale

**Fit:** strong

The change is purely build-version computation inside the build script (scripts/build/index.js), part of the build/deploy operational lifecycle — directly matching the canonical 'Fix build version computation' infrastructure example. It is build tooling, not design-document internals, so the data-layer carve-out does not apply.
