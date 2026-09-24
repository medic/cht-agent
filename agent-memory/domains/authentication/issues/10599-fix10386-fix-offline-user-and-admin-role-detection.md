---
id: cht-core-10386
category: bug
domain: authentication
domainFit: strong
issueNumber: 10386
issueUrl: https://github.com/medic/cht-core/issues/10386
title: Fix offline-user/admin role detection so online `admin` and empty roles no longer get purge databases
lastUpdated: '2026-06-22'
summary: Purge databases (e.g. `medic-purged-role-…`) were being created for the online `admin` role and for users with no roles, wasting >6GB and daily processing time. The fix centralizes offline detection in `user-management.roles.isOffline` (now returning false for `admin` and empty roles) and makes purging delegate to it instead of duplicating the logic.
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
stale: false
---

## Problem

On the Nairobi instance, purge databases such as `medic-purged-role-6ed8e2e23ed4cf28156a7cd33ccc3f94` were being created for the `admin` role, which is an online role and should have no purge database. This wasted over 6GB of disk space and significant daily processing time, and purging was already struggling to complete on the instance.

## Root Cause

Offline detection was split across implementations: the purging code carried its own `isOffline` logic, and the centralized `user-management.roles.isOffline` did not correctly handle the modern admin representation. Admins used to be `_admin` but are now the `admin` role or have no role at all; the role-detection logic treated the `admin` role and empty roles as offline, so purge databases were generated for these online users.

## Solution

Removed the purging-specific `isOffline` implementation and had `sentinel/src/lib/purging.js` and `shared-libs/purging-utils/src/index.js` delegate to `user-management.roles.isOffline`. Updated `roles.isOffline` to return `false` for empty roles and for the `admin` role so online admins no longer get purge databases, and (per review feedback) moved the dbAdmin check to a more central location.

## Code Patterns

Centralize cross-cutting role checks in `shared-libs/user-management/src/roles.js` (e.g. `isOffline`) and have consumers like `sentinel/src/lib/purging.js` and `shared-libs/purging-utils/src/index.js` call it rather than duplicating role logic — preventing drift between parallel implementations. Treat empty roles and the `admin` role as online (non-offline).

## Design Choices

Consolidated offline detection into a single source of truth in user-management roles instead of maintaining a separate purging-specific copy, eliminating divergence. The dbAdmin check was moved to a central location.

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

Unit tests were updated/added across all touched modules: `shared-libs/user-management/test/unit/roles.spec.js` and `users.spec.js` cover `isOffline` returning false for empty roles and the `admin` role; `sentinel/tests/unit/lib/purging.spec.js` and `shared-libs/purging-utils/test/index.js` verify purging now delegates to the centralized check and does not create purge databases for online/admin/empty-role users.

## Related Issues

- #10386: Purge database being created for the online `admin` role, wasting >6GB of space and daily processing time

## Domain Rationale

**Fit:** strong

The bug and fix live in role-detection logic (`user-management.roles.isOffline`) — classifying users as offline vs online based on their roles — which is a roles/permissions concern and per the classification guidance belongs to authentication even though the symptom surfaced in purging (a data-sync mechanism). The primary changed files are in `shared-libs/user-management` (roles/users), making user/role management the squarely correct home.
