---
id: cht-core-10443
category: bug
domain: forms-and-reports
subDomain: build
issueNumber: 10443
issueUrl: https://github.com/medic/cht-core/issues/10443
title: Default training forms not included in released Docker images
lastUpdated: 2025-11-12
summary: The default training form ("Welcome Guide" for new admins) was not included in the published CHT Docker images because the build script did not process training forms from the default config directory.
services:
  - api
techStack:
  - javascript
---

## Problem

A training form was added to the default config (PR #10290) to show a "Welcome Guide" when admins first log in. However, the form was not appearing in fresh CHT instances started from published Docker images. The form existed in the source code but was missing from the built artifacts.

## Root Cause

The build script (`scripts/build/build-config.sh`) that packages the default config into Docker images did not include the training forms directory. It processed app forms and contact forms but skipped the training forms folder.

## Solution

Updated the build configuration script to include default training forms in the build output. PR #10445 also updated test constants and E2E test utilities to account for the training form.

## Code Patterns

- When adding a new form type or directory to the default config, the build script must be updated to include it
- File: `scripts/build/build-config.sh` controls what config files are packaged into Docker images
- File: `tests/constants.js` maintains lists of expected default forms for tests
- Pattern: after adding new default config content, verify it appears in a fresh Docker image, not just in the development environment

## Design Choices

- Fixed the build script rather than changing how training forms are deployed, since the build script was simply missing the new directory
- Updated E2E tests to expect the training form so future omissions would be caught in CI

## Related Files

- scripts/build/build-config.sh
- tests/constants.js
- tests/utils/index.js
- tests/e2e/default/training-materials/training-materials.wdio-spec.js
- tests/e2e/default/db/initial-replication.wdio-spec.js

## Testing

- Updated E2E training materials test to verify the Welcome Guide form loads
- Updated initial replication test to include the training form in expected documents
- Updated test constants with the new form reference

## Related Issues

- #10208: Instruct new deployments how to add data (related admin onboarding work)
