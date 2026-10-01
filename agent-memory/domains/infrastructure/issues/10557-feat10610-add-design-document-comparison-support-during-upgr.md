---
id: cht-core-10610
category: feature
domain: infrastructure
domainFit: strong
issueNumber: 10610
issueUrl: https://github.com/medic/cht-core/issues/10610
title: Add design document comparison during upgrades to show administrators which view indexing is required
lastUpdated: '2026-10-01'
summary: Administrators upgrading the CHT had no visibility into whether (or which) CouchDB view indexing an upgrade would trigger. This PR adds design-document comparison to the upgrade flow and admin upgrade page, surfacing visual indicators of ddoc changes so admins can distinguish quick no-index upgrades from slow reindexing ones.
services:
  - api
  - admin
techStack:
  - javascript
  - angularjs
  - nodejs
  - couchdb
tags:
  - upgrade
  - design-documents
  - ddoc-comparison
  - view-indexing
  - view-reindexing
  - admin-ui
  - couchdb-views
related_workflows:
  - data-migration
source_pr: medic/cht-core#10557
source_sha: c4fa13bd3f443360488e2d364561d51022c89e68
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - api/src/services/setup/upgrade.js
  - api/src/services/setup/utils.js
  - api/src/controllers/upgrade.js
  - api/src/routing.js
  - admin/src/js/controllers/upgrade.js
  - admin/src/js/controllers/upgrade-confirm.js
  - admin/src/js/filters/bytes.js
concepts:
  - upgrade lifecycle
  - design document comparison
  - CouchDB view indexing/reindexing detection
  - admin upgrade flow
  - ddoc definition caching
related_issues:
  - cht-core-10383
stale: false
---

## Problem

A very frequent question during CHT upgrades is whether view indexing is required and which views are affected. Administrators had no way on the admin upgrade page to see whether a given upgrade would change design documents (and therefore trigger potentially slow view reindexing) or would be a quick no-index upgrade, making it hard to anticipate downtime/indexing cost.

## Root Cause

The upgrade services in api/src/services/setup did not expose any comparison between the running version's bundled design documents and those of a target build, and the admin upgrade page had no UI to display ddoc/view changes — so reindexing requirements were invisible until the upgrade was already underway.

## Solution

Added design-document comparison to the upgrade flow. `compareBuildVersions` in api/src/services/setup/upgrade.js loads the running version's bundled ddocs (`getLocalDdocDefinitions`) and the target build's ddocs from the staging server (`downloadDdocDefinitions`), both exported from api/src/services/setup/utils.js, and reports per database and ddoc whether views changed (`areViewsDifferent`: view presence, count, names and `map` functions), Nouveau indexes changed (`areIndexesDifferent`: `index`, `field_analyzers`, `default_analyzer`) or the ddoc is new in the target build (`added`). Changed ddocs carry the current on-disk size of their local indexes, read by `getDdocInfo` (view index) and `getNouveauInfo` (Nouveau indexes). The comparison is exposed as `app.all('/api/v2/upgrade/compare', jsonParser, upgrade.compare);` in api/src/routing.js, backed by `compareUpgrade` in api/src/controllers/upgrade.js, which requires a `build` in the request body and answers 400 without one.

In the admin app, admin/src/js/controllers/upgrade.js posts each release and beta to the compare endpoint in series once the page has loaded (`loadBuildsCompare`), and compares again before opening the Stage/Install confirmation (`compareReleases`, which reuses a cached result). admin/src/templates/release.html shows a "No indexing." label next to releases and betas that need none, and admin/src/templates/upgrade_confirm.html lists the differences (database, design document, reason, size) in a table that is collapsed by default, with a disk-space warning. Sizes are formatted by the `bytes` filter, which admin/src/js/main.js now requires; the filter file admin/src/js/filters/bytes.js is new in this PR. Seven of the ten locale files under api/resources/translations/ (ar, en, es, fr, ne, pt, sw) gained the new strings. The edits to admin/src/css/configuration.less (one blank line removed) and webapp/src/js/bootstrapper/translator.js (one ESLint suppression comment removed) change no behaviour.

## Code Patterns

The `bytes` AngularJS filter at admin/src/js/filters/bytes.js (registered in admin/src/js/main.js) formats human-readable byte sizes. Compare results are cached on the build object (`build.compare`, `build.requiresIndexing`) and stripped from the copy sent to the upgrade call (`delete upgradeBuild.compare;`). api/src/services/setup/utils.js caches ddoc definitions (`localDdocDefinitionsCache`, and `remoteDdocDefinitionsCache` keyed by `buildInfo.version`) and hands callers copies via `deepCopy`, because the install path passes those definitions to `setStagingData`, which rewrites each ddoc `_id` to its staged name. The comparison itself (`compareBuildVersions`) lives in api/src/services/setup/upgrade.js and is surfaced via a controller route in api/src/routing.js.

## Design Choices

The compare call is made without a loading indicator on the Stage/Install buttons; it is treated as a cheap request in an online-only admin app. A failed compare is logged (`Failed to compare releases`) and the confirmation modal still opens, so comparison never blocks an upgrade. Ddocs present locally but missing from the target build are not reported, and view contents are compared by `map` function only, so a change to a view's `reduce` alone is not flagged. Changes are surfaced visually so operators can immediately tell a quick (no-indexing) upgrade from a slow (reindex-required) one.

## Related Files

- api/src/services/setup/upgrade.js
- api/src/services/setup/utils.js
- api/src/controllers/upgrade.js
- api/src/routing.js
- admin/src/js/controllers/upgrade.js
- admin/src/js/controllers/upgrade-confirm.js
- admin/src/js/filters/bytes.js
- admin/src/js/main.js
- admin/src/templates/upgrade.html
- admin/src/templates/upgrade_confirm.html
- admin/src/templates/release.html
- admin/src/css/configuration.less
- webapp/src/js/bootstrapper/translator.js
- api/resources/translations/messages-en.properties

## Testing

The existing specs admin/tests/unit/controllers/upgrade.spec.js (compare failures still open the modal), api/tests/mocha/controllers/upgrade.spec.js (`compare`: auth, 400 without a build, service errors), api/tests/mocha/services/setup/upgrade.spec.js (`compareBuildVersions`: ddocs only in the target build, view and Nouveau differences, sizes) and api/tests/mocha/services/setup/utils.spec.js (definition caching per version, 'should not mutate the local ddoc definitions cache', `getDdocInfo`, `getNouveauInfo`) gained the new cases. The PR also deleted the empty placeholder api/tests/mocha/services/upgrade.spec.js.

## Related Issues

- #10610: "Show design document comparison on the admin upgrade page" — closed by this PR; asked for visual indicators of ddoc comparisons so admins know whether, and which, view indexing an upgrade requires
- #10383: "Selectively only index specific / necessary ddocs when upgrading to a new version" — still open; this PR's title names it, but the PR only reports which ddocs differ and does not change which ddocs an upgrade indexes

## Domain Rationale

**Fit:** strong

This is upgrade-lifecycle tooling: it adds a design-document comparison step to the admin upgrade flow and API setup/upgrade services so operators know whether view reindexing is required. The comparison reads the same bundled and staging-server ddoc definitions (api/src/services/setup/utils.js) that the upgrade stages and pre-indexes, and only reports on them; it does not modify the ddocs, the views, or what the upgrade indexes.
