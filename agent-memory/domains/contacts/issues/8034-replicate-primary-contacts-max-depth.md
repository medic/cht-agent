---
id: cht-core-8034
category: feature
domain: contacts
subDomain: replication
issueNumber: 8034
issueUrl: https://github.com/medic/cht-core/issues/8034
title: Replicate primary contacts for places at max replication depth
lastUpdated: 2026-03-16
summary: Added a replicate_primary_contacts config flag that causes primary contact persons for places at max replication depth to be replicated along with their reports and targets, solving the problem of supervisors not seeing CHW person records.
services:
  - api
techStack:
  - javascript
  - couchdb
---

## Problem

When `replication_depth` is configured, places at the maximum depth are replicated but their primary contact (person) is not. For example, a CHW Supervisor with `depth: 1` sees CHW Areas but not the CHW person contacts linked to those areas. This meant supervisors had no information about the people they were monitoring. The only workaround was increasing `replication_depth`, which also replicated all other child contacts (households), causing performance issues.

## Root Cause

The `contacts_by_depth` CouchDB view only emits contacts by their position in the hierarchy. At max depth, only the place document is included in the replication set. The primary contact (a person document that is a child of the place) is one level deeper and excluded. There was no mechanism to selectively include primary contacts without increasing the full replication depth.

## Solution

PR #9593 added a `replicate_primary_contacts: true` config option per role in `replication_depth`. When enabled:
1. The `contacts_by_depth` view value was changed from a scalar shortcode to `{ shortcode, primary_contact }`, emitting the primary contact ID alongside each place
2. A new `contacts_by_primary_contact` view indexes which places have a given person as their primary contact
3. `authorization.js` was extended to collect primary contact IDs from max-depth places and add them to the allowed `subjectIds`, enabling their reports and targets to also replicate
4. `allowedContact()` gained a secondary check that allows a contact through if it's in the primary contacts subject set
5. `getScopedAuthorizationContext()` queries the new view to handle scoped access checks

## Code Patterns

- Config: `{ "role": "supervisor", "depth": 1, "replicate_primary_contacts": true }` in `replication_depth` array
- The `contacts_by_depth` view value shape change is breaking — all consumers must read `row.value.shortcode` instead of `row.value`
- File: `ddocs/medic-db/medic/views/contacts_by_depth/map.js` — view emits `{ shortcode, primary_contact }`
- File: `ddocs/medic-db/medic/views/contacts_by_primary_contact/map.js` — new view indexing contacts by their primary contact
- File: `api/src/services/authorization.js` — `addPrimaryContactsSubjects()` collects and adds primary contact IDs to allowed subjects
- File: `api/src/services/authorization.js` — `getDepth()` reads `replicate_primary_contacts` from config, most permissive setting wins across roles
- File: `api/src/services/authorization.js` — `allowedContact()` secondary path checks `subjectIds.includes(docId)` for primary contacts

## Design Choices

- Opt-in per role via `replicate_primary_contacts: true` rather than making it default, to avoid unexpected replication changes for existing deployments
- Primary contacts' reports and targets replicate automatically because their subject IDs are added to the allowed set — no separate mechanism needed
- The view value shape change was accepted as a breaking change rather than adding a separate view, to avoid maintaining two views for the same data
- When multiple roles have the same depth, `replicate_primary_contacts: true` from any matching role enables it (most permissive wins)
- `getScopedAuthorizationContext` uses a `do...while` loop to handle chains where a primary contact is itself the primary contact of another place

## Related Files

- api/src/services/authorization.js
- ddocs/medic-db/medic/views/contacts_by_depth/map.js
- ddocs/medic-db/medic/views/contacts_by_primary_contact/map.js
- api/src/services/bulk-docs.js
- api/src/services/db-doc.js

## Testing

- Extensive integration tests for authorization with primary contacts enabled/disabled
- Unit tests for `getDepth()` with multiple roles and `replicate_primary_contacts` combinations
- Tests for `allowedContact()` secondary check path
- Tests for `getScopedAuthorizationContext()` with primary contact view queries

## Related Issues

- None directly referenced
