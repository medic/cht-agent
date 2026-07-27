---
id: cht-core-11018
category: feature
domain: configuration
domainFit: strong
issueNumber: 11018
issueUrl: https://github.com/medic/cht-core/issues/11018
title: Rebuild service worker automatically when ui-extension docs change in CouchDB
lastUpdated: '2026-06-22'
summary: UI extension doc changes weren't triggering a service worker rebuild, so logged-in users never received new or modified extensions without a server restart. Added a `ui-extension:` prefix check in the config-watcher that calls `updateServiceWorker()` on create/update.
services:
  - api
techStack:
  - javascript
  - nodejs
  - couchdb
  - service-worker
  - mocha
tags:
  - ui-extensions
  - service-worker
  - config-watcher
  - changes-feed
  - couchdb
  - pwa
related_workflows:
  - ui-extensions
source_pr: medic/cht-core#11021
source_sha: 4609a68a1aa53c2761a2c6123f4ab021c85bcd3c
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - api/src/services/config-watcher.js
  - api/src/services/ui-extension.js
concepts:
  - changes-feed monitoring
  - configuration change propagation
  - service worker regeneration
  - offline-first/PWA cache invalidation
  - event-driven config reaction
related_issues: []
stale: false
---

## Problem

When a `ui-extension:*` document was created or updated in CouchDB, the service worker was not rebuilt. As a result the webapp was never reloaded to pick up the changes, so new or modified UI extensions were never loaded for already-logged-in users unless the server was restarted.

## Root Cause

`config-watcher.listen()` — which watches the medic database changes feed and reacts to config-document changes by triggering rebuilds — had no branch for `ui-extension:`-prefixed documents, so those changes never invoked `updateServiceWorker()`.

## Solution

Added a `ui-extension:` doc-id prefix check in `config-watcher.listen()` that calls `updateServiceWorker()` whenever a UI extension doc is created or updated, reusing the existing changes-feed watch and service-worker rebuild infrastructure. Added unit tests covering create, update, and unrelated-doc scenarios.

## Code Patterns

In `api/src/services/config-watcher.js`, the changes-feed listener dispatches side effects by matching `change.id` against known doc-id prefixes; a new reaction is added by checking the UI-extension doc-id prefix and invoking `updateServiceWorker()`, which is defined and exported in that same file (`config-watcher.js`, definition line 140, export line 208) alongside `handleBrandingChanges`/`handleLibsChanges`, which already call it. The `ui-extension:` prefix constant itself lives in `api/src/services/ui-extension.js`. Pattern: extend the config-watcher dispatch with a doc-id prefix branch to trigger downstream rebuilds.

## Design Choices

Reused the pre-existing config-watcher changes-feed monitoring and its own `updateServiceWorker()` flow rather than introducing a separate watcher, keeping all config-doc reactions in one place. The linked issue explicitly notes the watch/rebuild logic already existed and that only an additional prefix branch was required.

## Related Files

- api/src/services/config-watcher.js
- api/src/services/ui-extension.js
- api/tests/mocha/services/config-watcher.spec.js
- api/tests/mocha/services/ui-extension.spec.js

## Testing

Added Mocha unit tests in config-watcher.spec.js and ui-extension.spec.js verifying that creating a `ui-extension:*` doc triggers a service worker rebuild, updating one triggers a rebuild, and unrelated doc changes do not. Run via the repo's own script, `npm run unit-api`, which sets `UNIT_TEST_ENV=1` (required — `api/src/db.js` gates its PouchDB stubbing on it, and `@medic/environment` calls `process.exit(1)` when `COUCH_URL` is unset). To run just this file: `COUCH_URL=http://admin:pass@localhost:5984/medic-test UNIT_TEST_ENV=1 npx mocha api/tests/mocha/services/config-watcher.spec.js`. Manual test plan covered creating/updating ui-extension docs and confirming regeneration.

## Related Issues

- #11018: rebuild the service-worker file whenever ui-extension docs change so updates load for logged-in users

## Domain Rationale

**Fit:** strong

The change extends `config-watcher.listen()` — the service that reacts to configuration-document changes on the CouchDB changes feed — to handle `ui-extension:*` docs, which are app configuration. Watching config docs and reacting is canonically the configuration domain (not infrastructure, since this is runtime API logic, not CI/build/deploy tooling).
