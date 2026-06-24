---
id: cht-core-10610
category: feature
domain: infrastructure
domainFit: strong
issueNumber: 10610
issueUrl: https://github.com/medic/cht-core/issues/10610
title: Add design document comparison during upgrades to show administrators which view indexing is required
lastUpdated: '2026-06-22'
summary: Administrators upgrading the CHT had no visibility into whether (or which) CouchDB view indexing an upgrade would trigger. This PR adds design-document comparison to the upgrade flow and admin upgrade page, surfacing visual indicators of ddoc changes so admins can distinguish quick no-index upgrades from slow reindexing ones.
services:
  - api
  - admin
  - webapp
techStack:
  - javascript
  - angularjs
  - nodejs
  - couchdb
  - less
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
  - async-blocking UI feedback
related_issues: []
stale: false
---

## Problem

A very frequent question during CHT upgrades is whether view indexing is required and which views are affected. Administrators had no way on the admin upgrade page to see whether a given upgrade would change design documents (and therefore trigger potentially slow view reindexing) or would be a quick no-index upgrade, making it hard to anticipate downtime/indexing cost.

## Root Cause

The upgrade services in api/src/services/setup did not expose any comparison between the currently deployed and staged design documents, and the admin upgrade page had no UI to display ddoc/view changes — so reindexing requirements were invisible until the upgrade was already underway.

## Solution

Added design-document comparison to the upgrade flow. New comparison logic in api/src/services/setup/upgrade.js and utils.js is exposed through a new upgrade compare controller endpoint (api/src/controllers/upgrade.js + api/src/routing.js, e.g. /api/v2/upgrade/compare). The admin upgrade controllers (upgrade.js, upgrade-confirm.js) and templates (upgrade.html, upgrade_confirm.html, release.html) were updated to render visual indicators of changed design documents, with a new bytes filter (admin/src/js/filters/bytes.js, registered in main.js) for human-readable sizes and styling in configuration.less. Per reviewer feedback, the blocking /upgrade/compare calls now show a spinner that disables buttons while the request is in flight. User-facing strings were internationalised across all locale .properties files and the webapp bootstrapper translator.

## Code Patterns

New AngularJS filter at admin/src/js/filters/bytes.js (registered in admin/src/js/main.js) for human-readable byte sizes; loading-spinner gating pattern in admin/src/js/controllers/upgrade.js that disables action buttons while the async compare call is pending; setup-service comparison helper in api/src/services/setup/utils.js consumed by api/src/services/setup/upgrade.js and surfaced via a controller route in api/src/routing.js.

## Design Choices

Enabled by default in the new navigation design while remaining backwards compatible with old navigation (can_view_old_navigation) and RTL. Compare calls were intentionally kept blocking but paired with an explicit spinner so admins get clear, unambiguous feedback rather than silently unresponsive buttons (direct response to reviewer feedback). Changes are surfaced visually so operators can immediately tell a quick (no-indexing) upgrade from a slow (reindex-required) one.

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

Unit tests added/updated across both services: admin/tests/unit/controllers/upgrade.spec.js for the admin controller behavior, and api/tests/mocha/controllers/upgrade.spec.js, api/tests/mocha/services/setup/upgrade.spec.js, api/tests/mocha/services/setup/utils.spec.js, and api/tests/mocha/services/upgrade.spec.js for the new comparison endpoint and setup-service logic. The author disclosed using Claude Code and JetBrains Junie to update unit tests as the source changed.

## Related Issues

- #10610: feature request to add visual indicators of design-document comparisons on the admin upgrade page so admins know which view indexing an upgrade requires (closed by this PR)
- #10383: parent/epic issue referenced in the PR title for the upgrade-page enhancement work

## Domain Rationale

**Fit:** strong

This is upgrade-lifecycle tooling: it adds a design-document comparison step to the admin upgrade flow and API setup/upgrade services so operators know whether view reindexing is required. Per the seeds, upgrade tooling and CouchDB-related upgrade operations (e.g. 'Skip CouchDB compaction during API upgrade') are canonically infrastructure; it does not modify the ddocs or index design themselves, so the data-sync exception for storage-engine internals does not apply.
