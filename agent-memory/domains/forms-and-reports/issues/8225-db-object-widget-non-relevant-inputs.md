---
id: cht-core-8225
category: bug
domain: forms-and-reports
subDomain: enketo
issueNumber: 8225
issueUrl: https://github.com/medic/cht-core/issues/8225
title: db-object-widget fails to load contact data when inputs group is never relevant
lastUpdated: '2026-08-12'
summary: The select-contact feature from the db-object-widget could not load contact data into a sub-group of the inputs group when that group had relevant="false()". Fixed via a patch to enketo-core's relevance evaluation that keeps a non-relevant `inputs` branch enabled and merely marks it `disabled`.
services:
  - webapp
techStack:
  - javascript
source_prs:
  - "medic/cht-core#9382"
related_issues:
  - cht-core-9915
---

## Problem

Forms using the `select-contact` appearance with `db-object-widget` to pre-load contact data failed when the `inputs` group had `relevant="false()"`. This is a common pattern where the inputs group is hidden but used to pass context data into the form. The contact data was simply not loaded, causing blank fields downstream.

## Root Cause

Enketo Core's relevance processing disabled the whole branch for a group that is not relevant, so nothing inside it was evaluated. Since the `inputs` group was set to never be relevant (`relevant="false()"`), the db-object-widget's backing calculation inside it never ran, and the contact data was never loaded into the form fields. More broadly, whenever `inputs` was non-relevant, any calculations, widgets, and logic depending on `inputs` fields also stopped working — even though CHT relies on `inputs` data always being available regardless of whether those fields are displayed (PR #9382).

## Solution

Applied a patch to enketo-core (`webapp/patches/enketo-core+7.2.5.patch`) that special-cases the `inputs` group in enketo-core's own relevance module: when a `/<form>/inputs` branch evaluates to non-relevant, the patch keeps it *enabled* — so its calculations and widgets, including the db-object-widget, still run — and only adds the `disabled` class so it stays hidden. A companion hunk in enketo-core's form module keeps `/inputs` out of `getDataStrWithoutIrrelevantNodes`. Nothing in the patch touches widget initialization; the fix works entirely through relevance/branch processing, guaranteeing that contact-data loading, calculations, and widgets involving `inputs` always work even when the inputs fields are hidden (PR #9382). PR #9382 was a targeted fix with 6 files, mostly test updates.

## Code Patterns

- The CHT uses enketo-core patches (via `patch-package`) for fixes that cannot wait for upstream releases
- Patches are stored in `webapp/patches/` and applied automatically during `npm install`
- File: `webapp/patches/enketo-core+7.2.5.patch` contains the fix; its `inputs` hunks patch enketo-core's relevance and form modules (the same patch file also carries unrelated date/datetime picker hunks)
- Pattern: to keep a branch's logic running while hiding it, enable the branch and add the `disabled` class rather than letting relevance processing tear it down
- Pattern: when Enketo Core behavior needs changing, first check if a patch is viable before forking or working around it in CHT code
- The `inputs` group with `relevant="false()"` is a standard CHT pattern for passing context into forms without displaying it

## Design Choices

- Used a patch-package patch rather than a fork or workaround, to keep the fix minimal and trackable
- Preferred patching enketo-core over a workaround in CHT widget code because relevance is evaluated inside enketo-core, so that is the only layer where the branch can be kept enabled. The patch is not a general upstream fix: it is labelled `// CHT-CORE PATCH` and hard-codes the CHT `inputs` convention (`/^\/[^/]+\/inputs$/`), which is why it lives in webapp/patches rather than going upstream

## Related Files

- webapp/patches/enketo-core+7.2.5.patch
- tests/e2e/default/enketo/db-object-widget.wdio-spec.js
- tests/e2e/default/enketo/forms/db-object-form.xlsx
- tests/e2e/default/enketo/forms/db-object-form.xml
- tests/e2e/default/enketo/forms/db-object-widget.xml (deleted — replaced by `db-object-form.xlsx`/`.xml`)
- tests/e2e/default/enketo/pregnancy-complete-a-delivery.wdio-spec.js

## Testing

- Added E2E test specifically for db-object-widget with non-relevant inputs group
- Added form fixture (db-object-form.xlsx/xml) for the test scenario
- Updated existing pregnancy delivery E2E test

## Related Issues

- #9915: Replace usage of db-object appearance with select-contact (follow-up migration)
