---
id: cht-core-10341
category: bug
domain: authentication
domainFit: strong
issueNumber: 10341
issueUrl: https://github.com/medic/cht-core/issues/10341
title: Revoke permissions when a user's role is deleted from app_settings by filtering effective roles against configured roles
lastUpdated: '2026-06-22'
summary: Users kept permissions granted by a role even after that role was deleted in Admin, because permission checks never verified the role still existed in app_settings.roles. Fixed by filtering a user's effective roles down to only configured roles before evaluating permissions across all three permission-checking codepaths.
services:
  - api
  - webapp
  - admin
  - sentinel
techStack:
  - javascript
  - typescript
  - angular
  - angularjs
  - couchdb
tags:
  - permissions
  - roles
  - authorization
  - access-control
  - app_settings
  - role-deletion
  - rbac
  - security
related_workflows: []
source_pr: medic/cht-core#10795
source_sha: 058554e4d34702a7918bab261bf07dc550c09e53
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - shared-libs/cht-datasource/src/auth.js
  - shared-libs/user-management/src/roles.js
  - api/src/auth.js
  - webapp/src/ts/services/cht-datasource.service.ts
  - shared-libs/constants/src/index.js
concepts:
  - role-based access control
  - permission evaluation
  - centralized authorization logic
  - passive (side-effect-free) permission functions
  - backwards-compatible config defaults
related_issues: []
stale: false
---

## Problem

When an admin deleted a role via Admin > Roles & Permissions, the role was removed from app_settings.roles but its entries in app_settings.permissions remained. Permission checks honored those stale entries, so a user assigned the deleted role retained its permissions indefinitely — e.g. after syncing/reloading, the user could still view the contacts tab even though the role granting that access had been deleted (issue #10341).

## Root Cause

All three permission-checking codepaths (shared-libs/cht-datasource/src/auth.js, shared-libs/user-management/src/roles.js, api/src/auth.js) evaluated a user's roles only against app_settings.permissions and never cross-referenced app_settings.roles. Deleting a role removed it from roles but left dangling references in permissions that were still treated as valid.

## Solution

Before evaluating any permission, filter the user's effective roles to only those still present in app_settings.roles. Added filterRolesByConfigured() in cht-datasource and an optional chtRolesSettings param to hasPermissions()/hasAnyPermission(); user-management hasPermission() reads config.get('roles') and filters; api hasPermission() applies the same filtering; webapp cht-datasource.service.ts now extracts and forwards roles from app settings alongside permissions. An empty or absent roles config falls back to no filtering for backwards compatibility. The duplicated logic was consolidated toward cht-datasource.

## Code Patterns

filterRolesByConfigured() helper in shared-libs/cht-datasource/src/auth.js filters assigned roles against configured roles prior to permission lookup. Configured roles are passed in via an optional chtRolesSettings parameter (rather than fetched internally) to keep hasPermissions()/hasAnyPermission() passive. Backwards-compat guard: empty/absent roles config short-circuits to no filtering. user-management/src/roles.js obtains configured roles via config.get('roles').

## Design Choices

The logic was centralized in cht-datasource instead of maintaining three near-identical copies. Critically, the cht-datasource permission functions MUST remain passive (pure, no side effects / no internal config fetch) because they are reused in custom tasks/targets/contact-summary configurations — failing e2e tests revealed that fetching config inside them broke those consumers, so configured roles are injected as an optional argument. Empty/absent roles config means no filtering, preserving existing deployments.

## Related Files

- shared-libs/cht-datasource/src/auth.js
- shared-libs/user-management/src/roles.js
- shared-libs/user-management/src/users.js
- api/src/auth.js
- webapp/src/ts/services/cht-datasource.service.ts
- shared-libs/constants/src/index.js
- admin/src/js/controllers/edit-user.js
- admin/src/js/services/auth.js
- shared-libs/cht-datasource/src/local/libs/data-context.ts
- shared-libs/cht-datasource/src/remote/libs/data-context.ts

## Testing

Unit tests added/updated across all touched modules: shared-libs/cht-datasource/test/auth.spec.js, shared-libs/user-management/test/unit/roles.spec.js & users.spec.js, api/tests/mocha/auth.spec.js plus bulk-docs and settings controller specs, admin specs (edit-user, auth, data-context), and webapp karma specs (auth.service, cht-datasource.service). Integration tests for cht-datasource (contact/person/place/report/target) and the users controller were updated, and the e2e purge spec (tests/e2e/default/purge/purge.wdio-spec.js) — failing e2e tests are what surfaced the requirement to keep the permission functions passive.

## Related Issues

- #10341: user retains permissions (e.g. contacts-tab access) after the role granting them is deleted from app_settings

## Domain Rationale

**Fit:** strong

The PR is entirely about role-based permission evaluation and revocation — per the rule that roles/permissions work belongs to authentication, this is the canonical, strong fit (not contacts, even though the visible symptom was contacts-tab access).
