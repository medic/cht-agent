---
id: cht-core-9119
category: bug
domain: infrastructure
domainFit: strong
issueNumber: 9119
issueUrl: https://github.com/medic/cht-core/issues/9119
title: Use correct _users database name in API setup service to fix CHT upgrade failures
lastUpdated: '2026-06-23'
summary: The setup/upgrade service referenced an incorrect name for CouchDB's `_users` system database, breaking the upgrade process. The fix corrects the database name in the central database definitions so design-document staging during upgrade targets the right database.
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

Upgrading a CHT instance (e.g. from 4.7.0) failed because the setup service used the wrong name for CouchDB's `_users` system database. The upgrade/ddoc-staging step therefore targeted an incorrect database, breaking the upgrade. Reviewer m5r reproduced the failure on a 4.7.0 instance.

## Root Cause

In api/src/services/setup/databases.js the database definition used an incorrect identifier for the CouchDB `_users` system database instead of its literal name `_users`, so the setup routine staged/checked design documents against the wrong database during upgrade.

## Solution

Corrected the database entry to use the literal `_users` name in databases.js so the setup service stages design documents against the correct CouchDB system database, allowing upgrades to complete. Updated the corresponding mocha spec to assert the correct name.

## Code Patterns

CouchDB system databases must be referenced by their literal CouchDB names (e.g. `_users`). The database list in api/src/services/setup/databases.js is the single source of truth for which databases receive ddoc staging during setup/upgrade, so name corrections belong there rather than scattered special-casing.

## Design Choices

Fix the name centrally in the setup service's database definitions rather than special-casing the users database elsewhere, keeping the database list authoritative for the upgrade flow.

## Related Files

- api/src/services/setup/databases.js
- api/tests/mocha/services/setup/databases.spec.js

## Testing

Updated the mocha unit spec (databases.spec.js) to assert the correct `_users` database name. Manually verified by reviewer m5r using the cht docker helper: the bug was reproduced on a 4.7.0 instance, and a separate instance running this branch upgraded successfully.

## Related Issues

- #9117: incorrect _users database name in setup service causes CHT upgrade failure

## Domain Rationale

**Fit:** strong

The change lives in the API setup/upgrade service (api/src/services/setup/databases.js) that orchestrates database and design-document staging during CHT installation/upgrade — operational lifecycle tooling. The `_users` database is auth-related, but the fix does not alter authentication behavior; it corrects the upgrade flow, matching the canonical 'during API upgrade' → infrastructure pattern.
