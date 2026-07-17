---
id: cht-core-10443
category: bug
domain: infrastructure
domainFit: strong
issueNumber: 10443
issueUrl: https://github.com/medic/cht-core/issues/10443
title: Include default training forms in the build-config script so the admin Welcome Guide ships in published Docker images
lastUpdated: '2026-06-22'
summary: The 'Welcome Guide' training form added to the default config was not appearing on fresh CHT instances because the build-config script did not package the default training forms into the published Docker images. The build script was updated to include them, and the e2e test harness was adjusted to bootstrap the training report during login so the now-present form does not disrupt admin-user tests.
services:
  - api
  - webapp
techStack:
  - bash
  - javascript
  - webdriverio
  - couchdb
tags:
  - build-script
  - default-config
  - training-forms
  - welcome-guide
  - docker-images
  - e2e-tests
related_workflows: []
source_pr: medic/cht-core#10445
source_sha: a981665a8af1c88f540650fc0a66095852968c0f
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - scripts/build/build-config.sh
  - tests/utils/index.js
  - tests/e2e/default/training-materials/training-materials.wdio-spec.js
  - api/src/public/login/lib-bowser.js
concepts:
  - build-time default-config packaging
  - default config shipped in Docker images
  - training forms (Welcome Guide)
  - e2e test user bootstrapping
  - PROTECTED_DOCS
related_issues: []
stale: false
---

## Problem

After PR #10290 added a 'Welcome Guide' training form to the default config for first-run admins, the form did not appear. Starting a fresh CHT instance on master/5.0.0-beta and logging in as admin showed no Welcome Guide, because the training form was not being included as part of the default config in the published CHT Docker images.

## Root Cause

The build configuration script (scripts/build/build-config.sh) did not include the default training forms when assembling the default config bundled into the published Docker images, so the training form files were omitted from the shipped default config.

## Solution

Updated scripts/build/build-config.sh to include the default training forms in the built default config. To keep the now-present Welcome Guide form from popping up and disrupting admin-user e2e/integration tests, setupUserDoc in tests/utils/index.js was extended to also write the default user's training report doc alongside the user-settings doc in a single DB round-trip during login/cookieLogin. Supporting constants (tests/constants.js) and the training-materials and initial-replication wdio specs were updated accordingly.

## Code Patterns

tests/utils/index.js setupUserDoc writes both the user-settings doc and the training report doc for the default user in one DB round-trip during login/cookieLogin; the training report is scoped to the default-user webapp login only (not leaked into integration tests or other users), and tests that don't want it can delete it — it is automatically re-created on the next login.

## Design Choices

Three options for handling the training form in e2e tests were weighed: (1) complete/cancel the training in cookieLogin after each login — rejected for poor performance (form loaded/unloaded every test); (2) write the training report once in setUserContactDoc and add it to PROTECTED_DOCS — rejected because it leaves a permanent extra report that also leaks into integration tests; (3) write the training doc in setupUserDoc alongside user-settings during login — chosen because it touches only the default-user webapp login, writes both docs in one round-trip, and lets tests delete the report (auto re-added next login).

## Related Files

- scripts/build/build-config.sh
- tests/utils/index.js
- tests/constants.js
- tests/e2e/default/training-materials/training-materials.wdio-spec.js
- tests/e2e/default/db/initial-replication.wdio-spec.js
- api/src/public/login/lib-bowser.js

## Testing

Modified e2e specs: tests/e2e/default/training-materials/training-materials.wdio-spec.js and tests/e2e/default/db/initial-replication.wdio-spec.js. Updated tests/utils/index.js (setupUserDoc) and tests/constants.js so the default user's training report is bootstrapped during login, preventing the Welcome Guide training form from interfering with admin-user e2e and integration tests.

## Related Issues

- #10443: 'Welcome Guide' training form not included in the default config of published CHT Docker images
- #10290: PR that added the Welcome Guide training form to the default config

## Domain Rationale

**Fit:** strong

The fix is in scripts/build/build-config.sh — the build tooling that packages the default config into the published Docker images — which is canonically the build/packaging lifecycle (infrastructure). The training forms already existed as config (added in #10290); the bug was purely that the build step omitted them, so this is a build fix, not a configuration change.
