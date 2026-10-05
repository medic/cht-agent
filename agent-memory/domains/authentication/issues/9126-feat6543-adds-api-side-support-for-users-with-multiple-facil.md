---
id: cht-core-6543
category: feature
domain: authentication
domainFit: strong
issueNumber: 6543
issueUrl: https://github.com/medic/cht-core/issues/6543
title: Support users with multiple facilities — v3 users API, authorization, and contact-list display
lastUpdated: '2026-10-05'
summary: 'CHT users could previously be associated with only a single facility (place). This adds multi-facility support in the API and webapp: a new /v3/users create endpoint (plus /v3/users/:username, which reuses the v1 update handler) taking an array of existing facility UUIDs, with more than one place allowed only when one of the user''s roles holds the new `can_have_multiple_places` permission; user-management library and authorization changes so a user''s doc download/upload permissions span all of their facilities (PR #9126); the webapp contact-list display branching for multi-facility users (PR #9094); and aggregate targets disabled for those users (PR #9099, a gate PR #9317 lifted on master). The Admin-app place multiselect is separate work (#9116).'
services:
  - api
  - sentinel
  - webapp
techStack:
  - javascript
  - nodejs
  - couchdb
  - express
  - mocha
  - typescript
  - angular
tags:
  - user-management
  - multiple-facilities
  - authorization
  - api-versioning
  - roles
  - replication-permissions
related_workflows:
  - user-registration
source_pr: medic/cht-core#9126
source_prs:
  - "medic/cht-core#9094"
  - "medic/cht-core#9099"
  - "medic/cht-core#9126"
source_sha: 2fdddd07194e104c3958646cc5db9251694c8353
distilled_at: '2026-06-23'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - api/src/controllers/users.js
  - api/src/routing.js
  - api/src/services/authorization.js
  - ddocs/users-db/users/views/users_by_field/map.js
  - shared-libs/user-management/src/users.js
  - shared-libs/user-management/src/roles.js
  - shared-libs/user-management/src/libs/facility.js
  - shared-libs/contacts/src/places.js
concepts:
  - multi-facility user model
  - API versioning (v3 endpoint)
  - authorization / replication doc-access scoping
  - user provisioning
  - CouchDB design-doc views (users_by_field)
  - facility-contact association constraints
  - backwards compatibility
related_issues:
  - cht-core-9116
  - cht-core-9231
  - cht-core-9433
stale: true
---

## Problem

Each CHT user could be linked to only a single facility. Health workers operating across more than one facility could not be represented as one account with access to documents from all their assigned facilities — the v1 users API accepted only one facility, and the authorization logic that computes a user's replicable (download/upload) document set was scoped to a single facility subtree.

## Root Cause

The user-management shared library (shared-libs/user-management/src/users.js, shared-libs/user-management/src/libs/facility.js), the api users controller, the authorization service, and the users_by_field CouchDB view all assumed a single facility_id per user. Doc download/upload permission computation unioned over only one facility's subtree, and the view indexed a single facility, so a user could not be authorized for documents across multiple places.

## Solution

Introduced a new /v3/users API (create and update) that accepts an array of UUIDs of existing facilities, accepting the same payload shape as /v1/users. Only the create side is new code — `POST /api/v3/users` (`users.v3.create` → `createMultiFacilityUser`); `POST /api/v3/users/:username` (`users.v3.update`) calls the v1 update handler, so both update routes accept a `place` array. Updated the user-management shared library to model multiple facilities (`hydratePayload`/`getFacilityId` turn `place` into an array `facility_id`, which user create and update now write) and the authorization service so a user's downloadable/uploadable doc set is the union across all their facilities. More than one place is accepted only when one of the user's roles has the new `can_have_multiple_places` permission (`validateAllowedMultipleFacilities` in shared-libs/user-management/src/users.js — at this PR via a new `hasAllPermissions` in shared-libs/user-management/src/roles.js, which #10795 removed from master in favour of cht-datasource `hasPermissions`), and every listed facility must exist (`placesExist`, added to shared-libs/contacts/src/places.js). Updated the users_by_field view map to index multiple facilities and the `facility_id`/`contact_id` user lookup (`getUsers` in shared-libs/user-management/src/users.js) to match users whose `facility_id` array contains the queried facility. Constraints: when creating a multi-facility user the contact must fall within one of the facilities; v3 does not create facilities or contacts, only links existing facility UUIDs.

On the webapp side (PR #9094), the contacts UI branches on the user's facility count: multi-facility users see only their assigned homeplaces in the left-hand list when not searching (child places are loaded into the selected homeplace's 'places' card in the detail view instead — `shouldGetDescendants` in webapp/src/ts/effects/contacts.effects.ts — and the sort option (`isAllowedToSort`) and homeplace highlight (`isPrimaryContact`) are hidden), while single-facility users keep the existing homeplace-plus-children behavior. Aggregate targets were disabled for multi-facility users: `TargetAggregatesService.isEnabled()` returned false when the user has more than one facility, and `AnalyticsModulesService` switched from checking `can_aggregate_targets` directly to `isEnabled()` when deciding whether the target-aggregates module is available (PR #9099). That gate does not hold on master: PR #9317 (#9231, first released in 4.10.0) changed `isEnabled()` to `!facilityIds || facilityIds.length > 0`, re-enabling aggregate targets for multi-facility users.

## Code Patterns

New API version namespace (`users.v3`) registered in api/src/routing.js, delegating to api/src/controllers/users.js; single-vs-array `place` input is normalized to an array `facility_id` in shared-libs/user-management/src/users.js (`getFacilityId`). api/src/services/authorization.js (present at this PR's anchor; moved on master to api/src/services/replication/authorization.js by #10823) iterates over the user's facility list (`getContactsByDepthKeys`) to union allowed doc subtrees for replication. ddocs/users-db/users/views/users_by_field/map.js emits one index row per facility so multi-facility users are discoverable by any of their places. Facility validation lives in shared-libs/user-management/src/users.js (`validateUserFacility` → `validateAllowedMultipleFacilities`, then `places.placesExist`); shared-libs/user-management/src/libs/facility.js `list()` only gathers the ids — now every entry of an array `facility_id`, plus `contact_id` — for the bulk doc fetch that hydrates user responses.

## Design Choices

Multi-facility creation got its own v3 endpoint instead of changing v1/v2 create, which keep creating the place and contact from the payload; updates got no separate logic — `users.v3.update` delegates to the v1 handler, so `POST /api/v1/users/:username` accepts a `place` array too. v3 deliberately performs no side-effect creation (no facilities, no contact) and only links existing facility UUIDs, keeping the endpoint narrowly scoped. Validation that all facilities share the same contact type was intentionally deferred (called out in the PR as future work); it was later added only in the Admin app (`validateFacilityHierarchy` → `isSameContactType`, PR #9128), and the API still does not check it on master. Requiring the contact to live within one of the facilities preserves contact-facility consistency. From this PR on the API writes `facility_id` as an array whenever a user is created or updated with a place, but existing users can still hold a string, so the webapp normalizes both shapes to an array (`getUserFacilityId` in webapp/src/ts/modules/contacts/contacts.component.ts) and decides display differences (children, sort, highlight, places card) from the facility count (PR #9094).

## Related Files

- api/src/controllers/users.js
- api/src/routing.js
- api/src/services/authorization.js (present at this PR's anchor; moved on master to api/src/services/replication/authorization.js by #10823)
- ddocs/users-db/users/views/users_by_field/map.js
- shared-libs/user-management/src/users.js
- shared-libs/user-management/src/roles.js
- shared-libs/user-management/src/libs/facility.js
- shared-libs/contacts/src/places.js
- webapp/src/ts/modules/contacts/contacts.component.ts (PR #9094)
- webapp/src/ts/modules/contacts/contacts-content.component.ts (PR #9094)
- webapp/src/ts/modules/contacts/contacts.component.html (PR #9094)
- webapp/src/ts/effects/contacts.effects.ts (PR #9094)
- webapp/src/ts/services/target-aggregates.service.ts (PR #9099)
- webapp/src/ts/services/analytics-modules.service.ts (PR #9099)

## Testing

Updated the existing Mocha unit specs for the users controller, authorization service, user-management roles and users, and contacts places. Integration: replication (`should return all relevant ids with multiple facilities`, plus depth and sensitive-report cases for multiple facilities) and bulk-docs (`should filter offline user requests with multi facility`) cover multi-facility doc download/upload permissions; the users controller spec adds `POST api/v3/users` cases (create with multiple facilities, refusal without the permission, adding facilities on edit, malformed facilities); the sentinel create-user-for-contacts test now expects an array `facility_id`; tests/integration/api/controllers/login.spec.js only gains a random `X-Forwarded-For` header per request. In the wdio e2e suites, db-sync now syncs as a user with two facilities and replace-user expects an array `facility_id`, while edit-person-home-place, person-under-area, offline-user all-permissions and target-aggregates were set to `describe.skip` (PR #9099 re-enabled target-aggregates; PR #9128 re-enabled edit-person-home-place and person-under-area; PR #9258 re-enabled all-permissions; PR #9221 later removed tests/e2e/default/contacts/edit-person-home-place.wdio-spec.js from master, moving its one test into tests/e2e/default/contacts/edit.wdio-spec.js as `should sync and update the offline user's home place`). Karma specs for contacts.effects (child places loaded for a multi-facility user, not for a single-facility user's own place) and contacts.component (single vs multi-facility homeplaces) cover the display branching; contacts-content.component.spec only switches its `getUserFacilityId` selector fixture to an array (PR #9094). The target-aggregates.service spec covers `isEnabled()` returning false for more than one facility, analytics-modules.service.spec stubs `isEnabled()`, and the target-aggregates e2e adds `should disable content when user has many facilities associated` (PR #9099).

## Related Issues

- #6543: "Allow for multiple places to be assigned to users" — this draft's issue; PRs #9126, #9094 and #9099 are all stamped `feat(#6543)` on master (so is PR #9093, which restores breadcrumbs for multi-facility users and is not covered here)
- #9116: "Make place field in the user form a multiselect dropdown" — the Admin-app side of this API, shipped by PR #9128
- #9231: "Allow users to view aggregate targets and filter by facility_id and reporting period" — PR #9317 under this issue lifted the PR #9099 aggregate-targets gate
- #9433: "REST Endpoint `/api/v1/users/{{username}}` throwing Server error when updating `contact`" — a 4.9.0 regression in this PR's `validateUserContact`, which mapped over `data.facility_id` (undefined when no `place` is sent); fixed by PR #9437

## Domain Rationale

**Fit:** strong

The work adds user-account provisioning (a new v3 users API to create/update users), role handling, and authorization changes that govern which documents a multi-facility user may download/upload — user management, roles, and access control are canonically the authentication domain, even though the permissions ultimately gate replication. The webapp display facet (PR #9094) and the aggregate-targets gate (PR #9099) are recorded here with the rest of #6543 rather than split into contacts or tasks-and-targets.
