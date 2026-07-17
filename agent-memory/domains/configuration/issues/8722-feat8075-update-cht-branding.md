---
id: cht-core-8075
category: feature
domain: configuration
domainFit: strong
issueNumber: 8075
issueUrl: https://github.com/medic/cht-core/issues/8075
title: Update default app branding from legacy Medic to current CHT imagery (logos, favicon, login/about pages) plus a CHT branding doc migration
lastUpdated: '2026-06-23'
summary: The webapp shipped with outdated Medic Mobile branding; this PR refreshes the default look to current Community Health Toolkit (CHT) branding by swapping logo/favicon/icon assets, updating the branding service and login/about styling, adjusting English strings, and adding a migration that installs the CHT branding doc into CouchDB.
services:
  - api
  - webapp
techStack:
  - javascript
  - couchdb
  - css
  - less
  - angular
  - mocha
tags:
  - branding
  - cht-branding
  - logo
  - favicon
  - login-page
  - about-page
  - migration
  - static-assets
  - translations
related_workflows:
  - data-migration
  - ui-extensions
source_pr: medic/cht-core#8722
source_sha: d93b9162e21b180b1c920d58a6890812ae3ea9e7
distilled_at: '2026-06-23'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - api/src/services/branding.js
  - api/src/migrations/add-cht-branding-doc.js
  - api/src/migrations/add-branding-doc.js
  - api/src/public/login/style.css
  - webapp/src/ts/modules/about/about.component.html
  - webapp/src/css/about.less
concepts:
  - branding service
  - couchdb settings/branding doc
  - database migrations
  - static asset bundling
  - login and about page theming
related_issues: []
stale: false
---

## Problem

The CHT webapp's default branding (logos, favicon, app icon, login page, and about page) still used legacy Medic Mobile imagery and text rather than the current Community Health Toolkit (CHT) brand, so out-of-the-box deployments displayed outdated branding.

## Root Cause

Default branding artifacts and the branding doc consumed by the branding service pointed at the old Medic logo/icon assets; the bundled static images, login/about styling, and the migration that seeds the branding doc had not been updated to the CHT brand.

## Solution

Replaced the bundled logo, light logo, favicon, and app icon assets with CHT versions; updated api/src/services/branding.js and the login (style.css) and about (about.less, about.component.html) styling; refreshed English translations; and added a new migration api/src/migrations/add-cht-branding-doc.js that installs/updates the CHT branding doc in CouchDB so existing deployments pick up the new branding on upgrade. The static-file copy build script (scripts/build/copy-static-files.sh) was adjusted to ship the new assets.

## Code Patterns

CHT migration pattern: a migration module under api/src/migrations/ (add-cht-branding-doc.js) that creates/updates a settings-style branding doc in CouchDB on upgrade, paired with a mocha spec (api/tests/mocha/migrations/add-cht-branding-doc.spec.js). The branding service (api/src/services/branding.js) resolves logo/icon resources from that doc, falling back to bundled defaults under api/src/resources/logo and api/src/resources/ico.

## Design Choices

Delivered the brand change as a CouchDB migration rather than only swapping static files, so already-deployed instances get the updated branding doc on upgrade while remaining backwards compatible. A new migration (add-cht-branding-doc.js) was added alongside the existing add-branding-doc.js instead of mutating the original, preserving migration history idempotency.

## Related Files

- api/resources/translations/messages-en.properties
- api/src/migrations/add-branding-doc.js
- api/src/migrations/add-cht-branding-doc.js
- api/src/public/login/style.css
- api/src/resources/ico/favicon.ico
- api/src/resources/logo/cht-logo-light.png
- api/src/resources/logo/cht-logo.png
- api/src/resources/logo/medic-logo-light-full.svg
- api/src/services/branding.js
- scripts/build/copy-static-files.sh
- webapp/src/css/about.less
- webapp/src/img/icon.png
- webapp/src/ts/modules/about/about.component.html

## Testing

Added a mocha unit test for the new migration (api/tests/mocha/migrations/add-cht-branding-doc.spec.js) and updated branding service unit tests (api/tests/mocha/services/branding.spec.js). Updated the service-worker e2e spec (tests/e2e/default/service-worker/service-worker.wdio-spec.js) and the cht-conf integration spec (tests/integration/cht-conf/cht-conf-actions.spec.js) to reflect the new branded assets. The migration output and branding visually match the issue screenshots.

## Related Issues

- #8075: update cht branding

## Domain Rationale

**Fit:** strong

Branding assets (logos, favicon), default styling, translations, and the branding settings doc are canonically the configuration domain per the project's classification. The CouchDB migration and build-script tweak are mechanisms for delivering that branding config, not infrastructure/ops lifecycle work, so this remains a clean, strong configuration fit.
