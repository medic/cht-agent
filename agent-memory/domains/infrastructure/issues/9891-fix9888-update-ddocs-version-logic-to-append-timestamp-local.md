---
id: cht-core-9888
category: bug
domain: infrastructure
domainFit: strong
issueNumber: 9888
issueUrl: https://github.com/medic/cht-core/issues/9888
title: Append a timestamp to the ddocs version for non-tag builds so API auto-deploys local design doc changes in development
lastUpdated: '2026-10-01'
summary: 'A regression from PR #9674 left the local ddocs build emitting a static version string, so the API stopped detecting and redeploying local design document changes. The fix appends the current timestamp to the ddocs version for every build without a TAG (local and branch builds), forcing a unique version each build so auto-deploy works again.'
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
related_issues:
  - cht-core-9630
stale: false
---

## Problem

After PR #9674 altered the local versioning logic, running `npm run build-ddocs` produced a version string identical to the already-deployed one. Because the running API server compares ddoc versions to decide whether to redeploy, it saw no change and stopped auto-deploying updated design documents during local development (e.g. via `npm run dev-api`), breaking the developer feedback loop.

## Root Cause

Before this PR, `setDdocsVersion` in `scripts/build/index.js` wrote the value of `versions.getVersion()` unchanged into each ddoc's `version` file. At this PR's parent, `getVersion` in `scripts/build/versions.js` fell back to the current git branch name (`execSync('git branch --show-current', { encoding: 'utf-8' }).trim()`) for local builds, the fallback PR #9674 put in place of a timestamped dev version. With no unique component per build, the API's version comparison (`bundledDdoc.version !== uploadedDdoc.version` in `compareDdocs`, `api/src/services/setup/ddocs.js`) found no difference and skipped redeployment of the design documents.

## Solution

Modified `setDdocsVersion` so that whenever `process.env.TAG` is unset the current timestamp is appended to the base version returned by `versions.getVersion()`, yielding a unique version string on every `build-ddocs` run and prompting the API to detect the change and auto-deploy. That covers local builds and also CI branch builds; for release builds (TAG set), the version remains exactly as provided.

## Code Patterns

Branch on the `TAG` env var to distinguish release (tag) builds from all other builds, and append a timestamp to a version string to force downstream change detection — see `setDdocsVersion` in `scripts/build/index.js`.

## Design Choices

Appending a timestamp only when `TAG` is unset keeps release version strings deterministic and meaningful while restoring the dev auto-deploy workflow. The existing `TAG` env var was reused as the release-vs-non-release signal rather than introducing a new flag. The timestamp is appended in `setDdocsVersion` only, not in `getVersion` in `scripts/build/versions.js`, so locally built Docker image tags (`getImageTag`) keep the plain branch-name version — the image reuse that PR #9674 was after.

## Related Files

- scripts/build/index.js

## Testing

The diff touches only `scripts/build/index.js`; it contains no automated tests.

## Related Issues

- #9888: "Fix local ddoc versioning so changes to local ddocs are deployed during development" — this draft's issue.
- PR #9674: "chore(9630): update env var VERSION to use the branch name value" — changed the local fallback of `getVersion` in `scripts/build/versions.js` from a timestamped dev version to the branch name, which introduced this regression.
- #9630: "Create new commands that would build the docker images and run the e2e tests separately" — the issue PR #9674 addressed; it proposed dropping the build timestamp from the version so e2e runs on the same branch reuse the same Docker images.

## Domain Rationale

**Fit:** strong

The change is purely build-version computation inside the build script (scripts/build/index.js), part of the build/deploy operational lifecycle — squarely build tooling, not design-document internals.
