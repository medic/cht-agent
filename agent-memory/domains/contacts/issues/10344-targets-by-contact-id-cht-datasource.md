---
id: cht-core-10344
category: feature
domain: contacts
subDomain: cht-datasource
issueNumber: 10344
issueUrl: https://github.com/medic/cht-core/issues/10344
title: Support querying target intervals by contact IDs in cht-datasource
lastUpdated: 2026-03-16
summary: Added cht-datasource APIs to query target interval documents filtered by contact UUIDs, enabling the target aggregates service to fetch only supervised contacts' targets instead of all targets for a reporting period.
services:
  - api
  - webapp
  - shared-libs
techStack:
  - typescript
  - angular
  - couchdb
---

## Problem

The target aggregates functionality needed to load target docs from the current reporting period for supervised contacts. For offline users this was fine — they only had access to their supervised contacts' data. For online users, the same query returned target docs for all users across the entire system, which was a serious scalability and security issue.

## Root Cause

`target-aggregates.service.ts` made raw `dbService.allDocs` calls with a range query (`target~<tag>~` to `target~<tag>~\ufff0`) that fetched all target docs for a period without any contact-level filtering. This completely bypassed cht-datasource and had no path for online users to query only their supervised contacts' targets.

## Solution

PR #10432 implemented a five-layer change:
1. **New qualifier:** `ContactUuidsQualifier` interface with `byContactUuids()` factory in `qualifier.ts`
2. **ID-range helper:** `getDocUuidsByIdRange()` in `local/libs/doc.ts` calls `allDocs` with `include_docs: false` for efficient ID-only retrieval
3. **Local adapter:** Smart two-path logic — single contact UUID uses direct range query, multiple UUIDs fetch all IDs for the period then filter by splitting `id.split('~')[2]` against a Set of contact UUIDs
4. **Remote adapter:** `GET /api/v1/target-interval` with `contact_uuid` or `contact_uuids` query params
5. **Webapp refactor:** `TargetAggregatesService` replaced raw `dbService.allDocs` with `chtDatasourceService.bindGenerator(TargetInterval.v1.getAll)`

## Code Patterns

- Target doc IDs follow the format `target~<period>~<contact_uuid>~<user_id>` — the contact UUID is the 3rd segment
- For single contact: direct range query `target~<period>~<uuid>~` to `target~<period>~<uuid>~\ufff0` (exact, no filtering)
- For multiple contacts: fetch all IDs for period (cheap, no docs), filter by `Set` lookup on `id.split('~')[2]`
- File: `shared-libs/cht-datasource/src/qualifier.ts` — `ContactUuidsQualifier` and `byContactUuids()`
- File: `shared-libs/cht-datasource/src/local/target-interval.ts` — `getTargetIntervalIds()` with smart single/multi path
- File: `shared-libs/cht-datasource/src/local/libs/doc.ts` — `getDocUuidsByIdRange()` for ID-only allDocs
- File: `shared-libs/cht-datasource/src/remote/target-interval.ts` — `getPage()` via REST endpoint
- File: `webapp/src/ts/services/target-aggregates.service.ts` — refactored to use cht-datasource generator
- File: `webapp/src/ts/services/cht-datasource.service.ts` — new `bindGenerator()` method for `AsyncGenerator`-returning functions
- File: `api/src/controllers/target-interval.js` — new `getAll` handler

## Design Choices

- Exploits the structured `_id` format of target docs rather than creating a new CouchDB view index
- Two-path optimization: single contact avoids fetching all period IDs, multiple contacts batch-fetches IDs only (no docs) then filters client-side
- `bindGenerator()` added to `CHTDatasourceService` to support async generator functions alongside regular promises
- `moment().locale('en').format()` used instead of `moment().format()` to ensure consistent month tags regardless of user locale

## Related Files

- shared-libs/cht-datasource/src/qualifier.ts
- shared-libs/cht-datasource/src/target-interval.ts
- shared-libs/cht-datasource/src/local/target-interval.ts
- shared-libs/cht-datasource/src/local/libs/doc.ts
- shared-libs/cht-datasource/src/remote/target-interval.ts
- shared-libs/cht-datasource/src/index.ts
- api/src/controllers/target-interval.js
- api/src/routing.js
- webapp/src/ts/services/target-aggregates.service.ts
- webapp/src/ts/services/cht-datasource.service.ts

## Testing

- Unit tests for qualifier validation and type guards
- Unit tests for local adapter with single and multiple contact UUIDs
- Unit tests for remote adapter REST calls
- Unit tests for `bindGenerator()` in CHTDatasourceService
- Updated `TargetAggregatesService` tests to stub cht-datasource instead of dbService

## Related Issues

- #10343: Dependency — prerequisite work for target interval querying
