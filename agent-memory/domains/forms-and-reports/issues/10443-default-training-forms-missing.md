---
id: cht-core-10443
category: bug
domain: forms-and-reports
subDomain: build
issueNumber: 10443
issueUrl: https://github.com/medic/cht-core/issues/10443
title: Default training forms not included in released Docker images
lastUpdated: 2026-08-09
summary: The default training form ("Welcome Guide" for new admins) was not included in the published CHT Docker images because the build script did not process training forms from the default config directory.
services:
  - api
techStack:
  - javascript
source_prs:
  - "medic/cht-core#10445"
---

## Problem

A training form was added to the default config (PR #10290) to show a "Welcome Guide" when admins first log in. However, the form was not appearing in fresh CHT instances started from published Docker images. The form existed in the source code but was missing from the built artifacts.

## Root Cause

The build script (`scripts/build/build-config.sh`) that packages the default config into Docker images did not include the training forms directory. Its `cht` invocation listed `upload-app-forms`, `upload-collect-forms`, `upload-contact-forms`, `upload-resources` and `upload-custom-translations` — every form type except training.

## Solution

The fix merged as PR #10445: `scripts/build/build-config.sh` gained an `upload-training-forms` step alongside the existing `upload-app-forms` / `upload-collect-forms` / `upload-contact-forms` steps, so the default training forms are packaged into the image.

Shipping the Welcome Guide by default then broke the e2e suites, because the card pops up for the admin user at the start of every run. PR #10445 handles that by seeding a *pre-completed* training doc: `tests/constants.js` gained `DEFAULT_USER_ADMIN_TRAINING_DOC` (`_id: training:admin:1234`, `form: training:admin_welcome`, deliberately typed `not_data_record` so it is not treated as a report), `tests/utils/index.js` writes it in `setUserContactDoc` during test setup, and adds its `_id` to `PROTECTED_DOCS` so `deleteAllDocs` leaves it alone between specs. The doc is protected from deletion, not re-created after it.

## Code Patterns

- When adding a new form type or directory to the default config, the build script must be updated to include it
- File: `scripts/build/build-config.sh` controls what config files are packaged into Docker images
- File: `tests/constants.js` holds the docs the e2e harness seeds, including `DEFAULT_USER_ADMIN_TRAINING_DOC`
- Pattern: shipping a training card in the default config changes what every e2e run sees on login — neutralize it by seeding a completed-training doc and adding that doc to `PROTECTED_DOCS`, rather than by dismissing the card in each spec
- Pattern: after adding new default config content, verify it appears in a fresh Docker image, not just in the development environment

## Design Choices

- Fixed the build script rather than changing how training forms are deployed, since the build script was simply missing the upload step
- Updated E2E tests to expect the training form so future omissions would be caught in CI
- Suppressed the now-default Welcome Guide in tests by seeding a completed-training doc rather than by special-casing the card in each spec, and protected that doc from the between-spec `deleteAllDocs` so the suppression survives the whole run

## Related Files

- scripts/build/build-config.sh
- tests/constants.js
- tests/utils/index.js
- tests/e2e/default/training-materials/training-materials.wdio-spec.js
- tests/e2e/default/db/initial-replication.wdio-spec.js

## Testing

- Rewrote the E2E training materials spec around the now-default Welcome Guide
- Updated the initial replication spec with a `getExpectedAttachments()` helper: every form is expected to replicate `['model.xml', 'form.html', 'xml']`, and `form:training:admin_welcome` additionally carries its three media images
- Added `DEFAULT_USER_ADMIN_TRAINING_DOC` to test constants and wired it into `setUserContactDoc` and `PROTECTED_DOCS`

## Related Issues

- #10208: Instruct new deployments how to add data (related admin onboarding work)
