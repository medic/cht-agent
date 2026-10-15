---
id: cht-core-9117
category: bug
domain: infrastructure
domainFit: strong
issueNumber: 9117
issueUrl: https://github.com/medic/cht-core/issues/9117
title: Use correct _users database name in API setup service to fix CHT upgrade failures
lastUpdated: '2026-10-08'
summary: The setup/upgrade service referenced an incorrect name for CouchDB's `_users` system database, breaking the upgrade process. The fix corrects the database name in the central database definitions so view indexing of the staged `_users` design documents during upgrade targets the right database.
services:
  - api
techStack:
  - javascript
  - node.js
  - couchdb
  - mocha
tags:
  - upgrade
  - _users
  - couchdb
  - setup-service
  - ddoc-staging
  - database-setup
  - system-database
related_workflows: []
source_pr: medic/cht-core#9119
source_sha: fed3e2b9d5723e059f8c95f6cfc0bb5fccbc0bf0
distilled_at: '2026-06-23'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - api/src/services/setup/databases.js
  - api/tests/mocha/services/setup/databases.spec.js
concepts:
  - upgrade tooling
  - design document staging
  - CouchDB system databases
  - database setup orchestration
related_issues: []
stale: false
---

## Problem

Upgrading a CHT instance (e.g. from 4.7.0) failed because the setup service used the wrong name for CouchDB's `_users` system database. The view-indexing step that follows ddoc staging therefore queried a database that does not exist and failed with a 404 ("Database does not exist."), breaking the upgrade almost immediately. The failure reproduces on a 4.7.0 instance.

## Root Cause

Before this PR, in api/src/services/setup/databases.js the `DATABASES` entry for the users database (`db: db.users`) had its `name` set to `${environment.db}-users` (e.g. medic-users) instead of CouchDB's literal `_users`. The entry arrived with PR #8928 (`5e9032d87`), which added the `users_by_field` view for `_users`. Staging saves ddocs through the entry's `db` handle, so it reached the right database, but the view indexer (api/src/services/setup/view-indexer.js) warms staged views through URLs built from `database.name`, so the request for the staged `users_by_field` view went to medic-users and failed.

## Solution

Corrected the database entry to use the literal `_users` name in api/src/services/setup/databases.js so the setup service indexes the staged design documents against the correct CouchDB system database, so upgrades that start from fixed code (4.7.1 or later) no longer fail. Staging and view warming run in the api of the installed version (api/src/services/setup/upgrade.js), so an upgrade that starts from 4.7.0 still requests the staged `_users` view under the wrong name (e.g. medic-users) and fails. Updated the corresponding mocha spec to assert the correct name.

## Code Patterns

CouchDB system databases must be referenced by their literal CouchDB names (e.g. `_users`). The database list in api/src/services/setup/databases.js is the single source of truth for which databases receive ddoc staging during setup/upgrade, so name corrections belong there rather than scattered special-casing. Each entry's `name` and `db` must point at the same database: staging uses `db`, while view warming uses `name`.

## Design Choices

Fix the name centrally in the setup service's database definitions rather than special-casing the users database elsewhere, keeping the database list authoritative for the upgrade flow.

## Related Files

- api/src/services/setup/databases.js
- api/tests/mocha/services/setup/databases.spec.js

## Testing

Updated the mocha unit spec (api/tests/mocha/services/setup/databases.spec.js) to assert the correct `_users` database name. That spec has one test, a deep-equal of the exported `DATABASES` array, so it does not exercise view warming. A reviewer tested the upgrade path manually with the cht docker helper: the bug reproduced on an instance running 4.7.0, and a separate instance running this branch upgraded successfully.

## Related Issues

- #9117: "Impossible to upgrade from 4.7.0" — upgrades from 4.7.0 failed while indexing the staged `_users` view, with a 404 for a database that does not exist

## Domain Rationale

**Fit:** strong

The change lives in the API setup/upgrade service (api/src/services/setup/databases.js) that orchestrates database and design-document staging during CHT installation/upgrade — operational lifecycle tooling. The `_users` database is auth-related, but the fix does not alter authentication behavior: it only changes which database the upgrade's view-warming requests address.
