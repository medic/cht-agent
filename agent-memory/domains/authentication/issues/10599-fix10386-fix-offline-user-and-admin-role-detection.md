---
id: cht-core-10386
category: bug
domain: authentication
domainFit: strong
issueNumber: 10386
issueUrl: https://github.com/medic/cht-core/issues/10386
title: Fix offline-user/admin role detection so the online `admin` role no longer gets a purge database
lastUpdated: '2026-09-29'
summary: Purge databases (e.g. `medic-purged-role-…`) were being created for the online `admin` role, wasting >6GB and daily processing time. The fix makes sentinel's purging call `roles.isOffline` from `@medic/user-management` instead of its own copy in `purging-utils`, and makes the user-management role checks treat `admin` as well as `_admin` as a DB admin role; `isOffline` also now returns false for an empty roles array.
services:
  - sentinel
  - api
techStack:
  - javascript
  - nodejs
  - couchdb
tags:
  - purging
  - offline-roles
  - admin-role
  - role-detection
  - isOffline
  - purge-databases
related_workflows: []
source_pr: medic/cht-core#10599
source_sha: d38cb4a56dd9110662186aec321cf78986c055fc
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - shared-libs/user-management/src/roles.js
  - shared-libs/user-management/src/users.js
  - sentinel/src/lib/purging.js
  - shared-libs/purging-utils/src/index.js
concepts:
  - role-based user classification
  - offline-first replication
  - document purging
  - online vs offline users
  - centralized role detection
related_issues: []
stale: true
---

## Problem

On the Nairobi instance, purge databases such as `medic-purged-role-6ed8e2e23ed4cf28156a7cd33ccc3f94` were being created for the `admin` role, which is an online role and should have no purge database. This wasted over 6GB of disk space and significant daily processing time, and purging was already struggling to complete on the instance.

## Root Cause

Offline detection was duplicated. Sentinel's purge setup (`getRoles()` in `sentinel/src/lib/purging.js`) used the `isOffline` in `shared-libs/purging-utils/src/index.js` (`const isOffline = (configured, roles) =>`). Its online check (`isOnlineOnly`) recognised only `mm-online` and `_admin`, and a user with no role defined in `app_settings.roles` counted as offline. Admins now carry an `admin` role in their user doc instead of `_admin`, and `admin` is not a configured role, so admin users were classed as offline and got a purge database. The separate `isOffline` in `shared-libs/user-management/src/roles.js` (`isOffline: roles => {`, called as `roles.isOffline`; the commit message writes `user-management.roles.isOffline`) excluded only `_admin`, via `isDbAdmin`, and returned true for an empty roles array.

## Solution

- `sentinel/src/lib/purging.js`: `getRoles()`, rewritten as an async function, now takes `roles` from `require('@medic/user-management')(config, db, dataContext)` and calls `roles.isOffline(userRoles)`. It still skips users whose roles are missing or empty.
- `shared-libs/purging-utils/src/index.js`: its `isOffline`, `isOnlineOnly` and `DB_ADMIN_ROLE = '_admin'` were deleted, and the module no longer exports `isOffline`.
- `shared-libs/user-management/src/roles.js`: `isDbAdmin()` and `hasOnlineRole()` treat both `admin` and `_admin` as DB admin roles. At this PR that is a local `DB_ADMIN_ROLES = ['admin', '_admin']`; on master the list is imported from `@medic/constants`, where PR #10795 moved it. `isOffline` returns `false` for an empty array. It now excludes any online-only user (`isOnlineOnly`, meaning an `admin`, `_admin` or `mm-online` role) rather than only `_admin`. Otherwise a user is still offline when none of their roles is configured or any configured role has `offline: true`. lodash was dropped from the file.
- `shared-libs/user-management/src/users.js`: `missingFields()` now reports `type or roles` as missing for an empty roles array. Before, it treated such a user as offline and required `place` and `contact`.

`isDbAdmin()` also backs api's admin checks: `auth.isDbAdmin` and `hasAllPermissions()` in `api/src/auth.js`, plus the couch-config, credentials, login and replication-limit-log controllers. Those checks now accept the `admin` role as well.

## Code Patterns

Keep cross-cutting role checks in `shared-libs/user-management/src/roles.js` (e.g. `isOffline`, `isDbAdmin`). Consumers such as `sentinel/src/lib/purging.js` get them via `const { roles } = require('@medic/user-management')(config, db, dataContext)` instead of keeping their own copy; the copy in `shared-libs/purging-utils` was deleted. Treat empty roles and online-only roles (`admin`, `_admin`, `mm-online`) as not offline.

## Design Choices

Offline detection was consolidated into a single implementation in user-management roles instead of a separate purging-specific copy, so the two cannot diverge. Inside `isOffline`, the separate `_admin` check was replaced by `isOnlineOnly`, so `isOffline` and `isOnlineOnly` share one definition of online roles (`hasOnlineRole`).

## Related Files

- sentinel/src/lib/purging.js
- sentinel/tests/unit/lib/purging.spec.js
- shared-libs/purging-utils/src/index.js
- shared-libs/purging-utils/test/index.js
- shared-libs/user-management/src/roles.js
- shared-libs/user-management/src/users.js
- shared-libs/user-management/test/unit/roles.spec.js
- shared-libs/user-management/test/unit/users.spec.js

## Testing

All four test files were modified; none were added.

- `shared-libs/user-management/test/unit/roles.spec.js` replaces "should return true for an empty array and for roles that are not configured" with separate `isOffline` cases: "should return false empty array", "should return true for roles that are not configured", "should return false for empty roles", "should return false for db admins" (both `_admin` and `admin`), and "should return false for mm-online role".
- `shared-libs/user-management/test/unit/users.spec.js` replaces the catch-all `config.get.returns(...)` stubs with `config.get.withArgs('roles')` and `config.get.withArgs('permissions')`, and at this PR its admin fixtures carry `['admin', 'mm-online']` (on master they are spelled `[ADMIN, ONLINE]`, from the role constants PR #10747 added).
- `sentinel/tests/unit/lib/purging.spec.js` now stubs `roles.isOffline` instead of `purgingUtils.isOffline`; no purge-database assertions were added.
- `shared-libs/purging-utils/test/index.js` drops its `isOffline` cases along with the function.

## Related Issues

- #10386: "Purge database created for admin role" (this draft's issue)

## Domain Rationale

**Fit:** strong

The fix is to role classification in `shared-libs/user-management/src/roles.js`: which roles count as DB admin (`isDbAdmin`), as online (`hasOnlineRole`/`isOnlineOnly`) and as offline (`isOffline`). The `isDbAdmin` change also widens api's admin checks to the `admin` role. Purging is where the bug showed; sentinel's change there only swaps its private copy of the check for the shared one.
