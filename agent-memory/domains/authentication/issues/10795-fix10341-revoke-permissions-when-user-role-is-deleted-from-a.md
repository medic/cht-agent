---
id: cht-core-10341
category: bug
domain: authentication
domainFit: strong
issueNumber: 10341
issueUrl: https://github.com/medic/cht-core/issues/10341
title: Revoke permissions when a user's role is deleted from app_settings by filtering effective roles against configured roles
lastUpdated: '2026-09-29'
summary: Users kept permissions granted by a role even after that role was deleted in Admin, because permission checks never verified the role still existed in app_settings.roles. Fixed in cht-datasource's `hasPermissions`/`hasAnyPermission`, which now read settings from the data context and drop any role missing from `app_settings.roles` (DB admin roles are always kept) before evaluating permissions; api's and user-management's own permission lookups were replaced by calls to these functions.
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
  - passive (backwards-compatible) permission-check signatures
  - restrictive default when roles config is absent
related_issues: []
stale: true
---

## Problem

When an admin deleted a role via Admin > Roles & Permissions, the role was removed from app_settings.roles but its entries in app_settings.permissions remained. Permission checks honored those stale entries, so a user assigned the deleted role retained its permissions indefinitely — e.g. after syncing/reloading, the user could still view the contacts tab even though the role granting that access had been deleted (issue #10341).

## Root Cause

All three permission-checking codepaths evaluated a user's roles only against app_settings.permissions and never cross-referenced app_settings.roles. Before this PR those were cht-datasource's `hasPermissions()`/`hasAnyPermission()` in shared-libs/cht-datasource/src/auth.js, and the private `hasPermission()` helpers behind `hasAllPermissions()` in shared-libs/user-management/src/roles.js and api/src/auth.js, both of which read `config.get('permissions')`. Deleting a role removed it from roles but left dangling references in permissions that were still treated as valid.

## Solution

The filtering lives in cht-datasource, and the other two codepaths now delegate to it.

- `shared-libs/cht-datasource/src/auth.js`: the internal `hasPermissions` and `hasAnyPermission` became curried on the data context, `(ctx) => (permissions, userRoles, chtPermissionsSettings)`, and read settings internally with `ctx.settings.getAll()`. Permissions come from `settings.permissions` unless the caller passes `chtPermissionsSettings`, which is now a deprecated override. Roles always come from `settings.roles`. For a non-admin user, the new internal helper `filterRolesByConfigured` (`const filterRolesByConfigured = (userRoles, chtRolesSettings = {}) =>`) keeps only roles that are keys of `settings.roles` or in `DB_ADMIN_ROLES`, and does so before any permission lookup. `isAdmin()` now accepts any role in `DB_ADMIN_ROLES` (`admin` and `_admin`), where before it accepted only `_admin`.
- Public API: `v1.hasPermissions` and `v1.hasAnyPermission` on the object `getDatasource` returns keep their argument order (shared-libs/cht-datasource/src/index.ts: `ctx.bind(hasPermissions)(permissions, userRoles, chtPermissionsSettings)` and `ctx.bind(hasAnyPermission)(permissionsGroupList, userRoles, chtPermissionsSettings)`) and call the curried functions through `ctx.bind`, so existing two- and three-argument callers still work. `DataContext` must now carry a `settings` service, and `getRemoteDataContext` takes that service as a new first parameter (`export const getRemoteDataContext = (settings: SettingsService, url = '')`). The `SettingsService` type moved to `shared-libs/cht-datasource/src/libs/data-context.ts`.
- `api/src/auth.js`: its private `hasPermission(userCtx, permission)` was removed. `assertPermissions()` now calls `datasource.v1.hasPermissions(hasAll, userCtx.roles)` and `datasource.v1.hasAnyPermission(hasAny.map(perm => [perm]), userCtx.roles)`, and the exported `hasAllPermissions` calls `getDatasource(dataContext).v1.hasPermissions(permissions, userCtx.roles)`.
- `shared-libs/user-management/src/roles.js`: the private `hasPermission()` and the exported `hasAllPermissions()` were removed, and `DB_ADMIN_ROLES` moved to `@medic/constants` (`shared-libs/constants/src/index.js`). `shared-libs/user-management/src/users.js` now checks `can_skip_password_change` (in `isPasswordChangeRequired`) and `can_have_multiple_places` (in `validateAllowedMultipleFacilities`) through `getDatasource(dataContext).v1.hasPermissions`.
- `webapp/src/ts/services/cht-datasource.service.ts`: online-only users now get `getRemoteDataContext(settingsService)`, backed by the same settings service as the local context. The `getChtPermissionsFromSettings()` helper was removed, and the `hasPermissions`/`hasAnyPermission` wrappers forward only `chtSettings?.permissions` as the override.
- Admin app: the `DataContext` service (`admin/src/js/services/data-context.js`) now resolves to a promise. It loads `Settings()` first and refreshes its cached settings whenever the settings doc changes. `Auth` (`admin/src/js/services/auth.js`), `admin/src/js/controllers/edit-user.js` and `admin/src/js/services/search.js` wait on that promise, and no longer pass `settings.permissions` in.

## Code Patterns

Data-context-bound permission checks: define the function curried on the data context, as in `const hasPermissions = (ctx) => (permissions, userRoles, chtPermissionsSettings) =>`, read current settings synchronously with `ctx.settings.getAll()`, and expose it from `getDatasource` through `ctx.bind(hasPermissions)(permissions, userRoles, chtPermissionsSettings)`. Keep a legacy settings argument as an optional override (`chtPermissionsSettings ?? settings.permissions`) so older call sites keep working. Apply `filterRolesByConfigured` after the admin short-circuit and before the permission lookup. In api and user-management, call `getDatasource(dataContext).v1.hasPermissions` rather than re-implementing the lookup.

## Design Choices

- One implementation instead of three: the private permission lookups in api and user-management were deleted, and those checks now route through cht-datasource, so the role filter is applied in one place.
- Passive changes to the permission functions: the cht-datasource permission functions are also called by deployment config code (contact-summary, and tasks/targets through the rules engine's `cht` API) and by purge functions that sentinel runs. The public `v1.hasPermissions`/`v1.hasAnyPermission` signatures therefore stayed compatible, and the settings they now need come from the data context's `SettingsService` rather than from a new parameter. Sentinel still passes `config.get('permissions')` to purge functions, which may forward it as the override.
- Restrictive default: when `settings.roles` is absent or `{}`, `filterRolesByConfigured` keeps only DB admin roles, so non-admin users get no permissions. The spec "should return false when no roles are configured and user is not admin" pins this behaviour. The PR description still says an empty or absent `roles` config falls back to no filtering; the merged code does not.

## Related Files

- shared-libs/cht-datasource/src/auth.js
- shared-libs/cht-datasource/src/index.ts
- shared-libs/cht-datasource/src/libs/core.ts
- shared-libs/cht-datasource/src/libs/data-context.ts
- shared-libs/cht-datasource/src/local/libs/data-context.ts
- shared-libs/cht-datasource/src/remote/libs/data-context.ts
- shared-libs/user-management/src/roles.js
- shared-libs/user-management/src/users.js
- api/src/auth.js
- webapp/src/ts/services/cht-datasource.service.ts
- shared-libs/constants/src/index.js
- admin/src/js/controllers/edit-user.js
- admin/src/js/services/auth.js
- admin/src/js/services/data-context.js
- admin/src/js/services/search.js

## Testing

All touched test files were modified; none were added.

- cht-datasource: `shared-libs/cht-datasource/test/auth.spec.js` builds a fake context (`makeCtx(settings)`). It adds cases for a deleted role ("should return false when the user role has been deleted from the configured roles"), a still-configured role, no roles configured (`{}` or `undefined`, where a non-admin gets no permissions), each role in `DB_ADMIN_ROLES`, and the `chtPermissionsSettings` override (used when given, otherwise `settings.permissions`). `shared-libs/cht-datasource/test/index.spec.ts`, `shared-libs/cht-datasource/test/libs/core.spec.ts`, `shared-libs/cht-datasource/test/libs/data-context.spec.ts` and `shared-libs/cht-datasource/test/remote/libs/data-context.spec.ts` cover the settings-carrying data context.
- user-management: the `hasAllPermissions` cases were removed from `shared-libs/user-management/test/unit/roles.spec.js`, and `shared-libs/user-management/test/unit/users.spec.js` was updated.
- api: `api/tests/mocha/auth.spec.js`, plus the bulk-docs and settings controller specs.
- admin: the edit-user, auth and data-context specs; the data-context spec covers the refresh on settings-doc changes.
- webapp karma: `webapp/tests/karma/ts/services/auth.service.spec.ts` and `webapp/tests/karma/ts/services/cht-datasource.service.spec.ts`, whose mock settings now include `roles`.
- sentinel: `sentinel/tests/unit/lib/purging.spec.js` now calls `chtScript.v1.hasPermissions`/`hasAnyPermission` from a purge function without a settings argument.
- Integration: the cht-datasource contact/person/place/report/target specs pass a settings service to `getRemoteDataContext`, and `tests/integration/api/controllers/users.spec.js` configures a `program_officer` role.
- e2e: the purge spec (`tests/e2e/default/purge/purge.wdio-spec.js`) dropped the settings argument from its purge function's `hasPermissions` call. That spec is present at this PR's anchor but was removed on master by PR #11139 ("adds archiving").

## Related Issues

- #10341: "Deleting roles does not result in users with those roles losing permission" (this draft's issue)

## Domain Rationale

**Fit:** strong

The PR changes how permission checks resolve a user's roles: roles no longer present in `app_settings.roles` stop granting permissions, and the api and user-management checks now share cht-datasource's implementation. That is role-based access control. The contacts tab in the issue's repro is only the symptom.
