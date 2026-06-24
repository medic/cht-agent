---
id: cht-core-10663
category: feature
domain: data-sync
domainFit: strong
issueNumber: 10663
issueUrl: https://github.com/medic/cht-core/issues/10663
title: Add ui-extension caching to the generated service worker so UI Extension scripts are available to offline users (role-based offline filtering)
lastUpdated: '2026-06-22'
summary: 'UI Extension scripts exposed via the new API endpoints (#10630) were not included in the service worker precache, so offline users could not load them. Added an appendUiExtensions hook to the service worker generator that fetches all extensions and caches only those eligible offline — extensions with no roles, or with at least one role config marked offline: true.'
services:
  - api
  - webapp
techStack:
  - javascript
  - nodejs
  - service-worker
  - workbox
  - mocha
  - sinon
  - webdriverio
tags:
  - service-worker
  - offline
  - offline-first
  - caching
  - ui-extensions
  - precache
  - role-based-access
related_workflows:
  - ui-extensions
source_pr: medic/cht-core#10767
source_sha: ec2fbe3c56b859f6ee264355130dfd5c02a841a8
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - api/src/generate-service-worker.js
  - api/tests/mocha/generate-service-worker.spec.js
  - tests/e2e/default/service-worker/service-worker.wdio-spec.js
  - appendUiExtensions
  - uiExtensionService
concepts:
  - service worker precaching
  - offline-first architecture
  - role-based offline access filtering
  - extension resource caching
  - offline asset availability
related_issues: []
stale: false
---

## Problem

The newly introduced UI Extensions feature (custom scripts served by API endpoints added in #10630) was not registered in the generated service worker's precache list. As a result, offline users could not load custom UI extension scripts, since the resources were only retrievable while online.

## Root Cause

api/src/generate-service-worker.js had no hook to include UI extension endpoint URLs in the service worker cache manifest. Unlike extension-libs, UI extension resources were never appended to the precached resource list, so they were excluded from offline availability.

## Solution

Added an appendUiExtensions hook to generate-service-worker.js, closely following the existing extension-libs pattern. It retrieves all UI Extensions via uiExtensionService and appends to the cache only those that are offline-eligible: extensions with no roles defined (globally accessible) or that have at least one role configuration with offline: true. Online-only extensions are excluded from the precache.

## Code Patterns

Offline resource-append hook in api/src/generate-service-worker.js mirroring the extension-libs precaching pattern: fetch resources from a service, filter by offline-eligibility, append their URLs to the service worker precache manifest. Offline-eligibility rule: include when no roles are defined OR any role config has offline: true.

## Design Choices

Reused the established extension-libs service-worker caching pattern for consistency and predictability. Applied role-based offline filtering so the cache respects access control — only globally-accessible extensions or those explicitly flagged offline for a role are stored, avoiding caching resources offline users should not receive.

## Related Files

- api/src/generate-service-worker.js
- api/tests/mocha/generate-service-worker.spec.js
- tests/e2e/default/service-worker/service-worker.wdio-spec.js

## Testing

Added Mocha unit tests in api/tests/mocha/generate-service-worker.spec.js using sinon to mock uiExtensionService, verifying that offline-eligible extensions are cached while online-only extensions are ignored. Updated the WebdriverIO e2e test (tests/e2e/default/service-worker/service-worker.wdio-spec.js) to add the base /ui-extension URL to the expected initial cached resources list. npm run unit-api passes all generate-service-worker checks.

## Related Issues

- #10663: add support for generating the service worker with ui-extension endpoint data for offline users (fixed by this PR)
- #10630: introduced the ui-extension API endpoints this PR depends on
- extension-libs service worker caching: the established pattern this implementation follows

## Domain Rationale

**Fit:** strong

The service worker is CHT's offline-first asset-caching layer, and this PR's sole purpose is making UI Extension scripts available to offline users via the precache manifest. Offline availability is squarely the data-sync domain's concern; it's the asset-caching half of offline-first (alongside PouchDB/CouchDB replication), not a configuration or build/deploy change.
