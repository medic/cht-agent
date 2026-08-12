---
id: cht-core-10344
category: feature
domain: contacts
subDomain: cht-datasource
issueNumber: 10344
issueUrl: https://github.com/medic/cht-core/issues/10344
title: Support querying target intervals by contact IDs in cht-datasource
lastUpdated: '2026-08-12'
summary: 'UNLANDED (PR #10432 merged into a since-deleted epic branch, then dropped before that epic squashed to master): cht-datasource APIs to query target interval documents filtered by contact UUIDs, so the target aggregates service could fetch only supervised contacts'' targets instead of all targets for a reporting period. The contact-UUID filtering described here reached the epic branch and was renamed away before the squash, so it is on no branch but the PR''s own. One piece did survive: the bindGenerator method on CHTDatasourceService originated in this PR and is on master because the epic squash carried it — but master binds it to Target.v1.getAll, which is the epic''s own work, not the TargetInterval.v1.getAll this draft describes.'
services:
  - api
  - webapp
techStack:
  - typescript
  - angular
  - couchdb
source_prs:
  - "medic/cht-core#10432"
stale: true
---

> **Describes work that reached an epic branch but not master.** PR #10432 *was*
> merged, on 2025-12-19, but into the `10140_previous-month-targets` epic branch
> rather than into master, landing there as the squash commit `db9694ef0`. Its
> contact-UUID vocabulary was then renamed away *on that branch* by `09d8c8024`
> ("Change UUID to Id") before the epic itself squashed to master as #10423
> (`622c62542`), which is why none of that vocabulary reached master. The epic
> branch has since been deleted from the remote; the code survives at the PR's own
> head and at `db9694ef0`, still reachable via `refs/pull/10423/head`. So "not on
> master" is right while "not merged" would be wrong: `git merge-base
> --is-ancestor` answers the first question, not the second — use `gh api
> repos/medic/cht-core/pulls/10432` for merge state.
>
> The contact-UUID filtering vocabulary — `ContactUuidsQualifier`, `byContactUuids()`,
> `getTargetIntervalIds()`, `getDocUuidsByIdRange()`, `local/target-interval.ts`,
> `remote/target-interval.ts`, `api/src/controllers/target-interval.js` — is on
> neither master nor the epic head. On master the module is `local/target.ts`.
>
> **One piece did land — and it came from this PR, not from a separate one.**
> `bindGenerator()` is on master in six files. `db9694ef0` is the only commit that
> introduces it on the epic branch, and the epic squash `622c62542` is what carried
> it to master, where its body is identical to `db9694ef0`'s. So `bindGenerator` is
> real on master *because of* #10432; what was dropped is the target-interval
> binding around it. Master's `target-aggregates.service.ts:35` binds
> `Target.v1.getAll`, not the `TargetInterval.v1.getAll` this draft names. Read the
> `bindGenerator` mechanism below as landed and everything about target intervals
> as unshipped. Verify with:
>
> ```sh
> git -C $CORE fetch origin refs/pull/10432/head:refs/verify/pr10432 \
>   refs/pull/10423/head:refs/verify/pr10423
> gh api repos/medic/cht-core/pulls/10432 --jq '.merged, .merged_at, .base.ref'
>                          # true, 2025-12-19, 10140_previous-month-targets
> git -C $CORE merge-base --is-ancestor refs/verify/pr10432 origin/master; echo $?   # 1 = not on master
> git -C $CORE merge-base --is-ancestor db9694ef0 refs/verify/pr10423; echo $?       # 0 = it DID reach the epic
> git -C $CORE grep -c byContactUuids origin/master                                  # no output
> git -C $CORE grep -l byContactUuids db9694ef0 | wc -l                              # 12 — present when it merged
> git -C $CORE grep -l byContactUuids refs/verify/pr10423 | wc -l                    # 0 — renamed away by 09d8c8024
> git -C $CORE grep -l bindGenerator origin/master | wc -l                           # 6 — it IS on master
> git -C $CORE log --oneline --reverse refs/verify/pr10423 -S bindGenerator \
>   -- webapp/src/ts/services/cht-datasource.service.ts | head -1                    # db9694ef0 (#10432)
> ```
>
> Kept because the design it records (target `_id` segment layout, the ID-only
> `allDocs` two-path query) is the reasoning behind work that never shipped. Everything
> below describes that unshipped work, except where this banner says
> otherwise.

## Problem

The target aggregates functionality needed to load target docs from the current reporting period for supervised contacts. For offline users this was fine — they only had access to their supervised contacts' data. For online users, the same query returned target docs for all users across the entire system, which was a serious scalability and security issue.

## Root Cause

`target-aggregates.service.ts` made raw `dbService.allDocs` calls with a range query (`target~<tag>~` to `target~<tag>~\ufff0`) that fetched all target docs for a period without any contact-level filtering. This completely bypassed cht-datasource and had no path for online users to query only their supervised contacts' targets.

## Solution

PR #10432 proposes a five-layer change:
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
- File: `webapp/src/ts/services/cht-datasource.service.ts` — `bindGenerator()` for `AsyncGenerator`-returning functions. This PR introduced it; it is on master because epic #10423's squash carried it across
- File: `api/src/controllers/target-interval.js` — new `getAll` handler

## Design Choices

- Exploits the structured `_id` format of target docs rather than creating a new CouchDB view index
- Two-path optimization: single contact avoids fetching all period IDs, multiple contacts batch-fetches IDs only (no docs) then filters client-side
- `bindGenerator()` on `CHTDatasourceService` supports async generator functions alongside regular promises. It originated in this PR (`db9694ef0`) and reached master only because epic #10423's squash carried it — see the banner
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
