---
id: cht-core-10040
category: feature
domain: forms-and-reports
domainFit: strong
issueNumber: 10040
issueUrl: https://github.com/medic/cht-core/issues/10040
title: Add report-create support to the cht-datasource local adapter
lastUpdated: '2026-08-14'
summary: The cht-datasource local (direct-database) adapter could read reports but had no way to create them. This PR added `createReport` to the local report adapter, taking a `ReportQualifier`; the #10083 epic squash reshaped that into `Local.Report.v1.create` taking an `Input.v1.ReportInput`, which is the form on master.
services:
  - api
  - webapp
techStack:
  - typescript
  - pouchdb
  - couchdb
tags:
  - report-create
  - cht-datasource
  - local-adapter
  - reports
  - data-access
  - input-validation
related_workflows:
  - form-submission
source_prs:
  - "medic/cht-core#10071"
  - "medic/cht-core#10099"
source_pr: medic/cht-core#10071
source_sha: d40e65bae79d6eaf60c29c6b529139a83579a92f
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - shared-libs/cht-datasource/src/local/report.ts
  - shared-libs/cht-datasource/src/qualifier.ts
concepts:
  - local data adapter
  - datasource abstraction
  - local vs remote data context
  - report creation
  - typed operation input and validation
  - epic-branch provenance
related_issues:
  - cht-core-10038
stale: false
---

## Provenance

PRs #10071 and #10099 were child PRs of the `9835-…` epic branch, so `git log --grep='(#10071)'` finds nothing on master. `source_sha` (`d40e65bae`) is this PR's own merge commit into that epic branch; it is reachable only if the clone has the epic branch's history, not from `master`. The work reaches master through the epic squash `f382785be` — `feat(#9835): add cht datasource apis for creation and update of contacts and reports (#10083)`.

**The epic reshaped this PR on the way in, so the two views differ and both are recorded below.** At `d40e65bae` this PR changed four files and added a flat `createReport` taking a `ReportQualifier`. In the squash that became `Report.v1.create` taking an `Input.v1.ReportInput`, which is what `master` has. Read the PR-era names as history, not as directions to master.

## Problem

The cht-datasource local data context could not create reports. Consumers operating against the local (direct-database/PouchDB) adapter could not create report documents through the datasource abstraction, leaving the local context behind the intended create capability. On the remote/API side the same gap existed: the report module exposed only read operations, with no remote create implementation, API controller method, or POST route for creating reports, even though person already had a full create path on the epic branch by the time this PR landed — `Person.v1.createPerson`, a `createPerson` handler in `api/src/controllers/person.js`, and a `postResource` call for the `api/v1/person` route in `shared-libs/cht-datasource/src/remote/person.ts` are all present at this PR's parent `cab214534`. Place had none yet; that half is tracked as #10038 (local PR #10065, API PR #10089).

## Root Cause

The local report adapter in cht-datasource implemented read operations only — there was no create export on the local report module at all, and no way for a consumer of the local data context to write a report document through the abstraction.

## Solution

As merged into the epic branch, this PR was a focused four-file change (`git diff-tree -r cab214534 d40e65bae7`): it added `createReport` to `shared-libs/cht-datasource/src/local/report.ts`, built on `createDoc` from `src/local/libs/doc.ts`, taking a `ReportQualifier` and rejecting a qualifier that carries `_rev` with an `InvalidArgumentError`. The accompanying change in `shared-libs/cht-datasource/src/qualifier.ts` was to export `ReportQualifier`, which had been module-private. Unit specs were updated in `test/local/report.spec.ts` and `test/local/person.spec.ts`.

On master this operation is `Report.v1.create` / `Local.Report.v1.create`, taking an `Input.v1.ReportInput` from `src/input.ts` — the epic squash replaced the qualifier-based signature and added that input module, so neither `input.ts` nor the `v1` namespacing is part of this PR's own diff. The API layer completes the create path (PR #10099): `Report.v1.create` on the domain module (src/report.ts) adapts between the local implementation and a remote adapter (`Remote.Report.v1.create = postResource('api/v1/report')` in src/remote/report.ts), wired to an API controller method (api/src/controllers/report.js) and the route `app.postJson('/api/v1/report', report.v1.create)` in api/src/routing.js, with shared input validation in src/libs/parameter-validators.ts; person and place create paths were touched to share/align validation logic.

Note the naming, because it is the trap here: `createReport` is real at this PR's own commit and absent from master. On master the operation is namespaced — `Report.v1.create`, `Local.Report.v1.create`, `Remote.Report.v1.create` — and `createReport` survives only as test-stub variable names. A search of master alone will suggest this draft invented the name; a search at `d40e65bae` will suggest master's name is wrong. Both are needed.

## Code Patterns

Local adapter create-operation pattern in cht-datasource: implement the create operation in `src/local/<entity>.ts` mirroring the datasource abstraction. This PR passed a `ReportQualifier` and guarded against `_rev`; the epic then moved the surface to a typed input object from `src/input.ts` (`Input.v1.ReportInput`), which is the shape to follow today — qualifiers identify existing docs for reads, so a create path taking one was the thing the epic corrected. Establishes the template for adding further local create operations and keeping local/remote contexts at parity. The corresponding remote/API pattern (PR #10099): domain module (src/report.ts) exposes `create` → adapts to the remote adapter (src/remote/report.ts) for the HTTP POST → API controller (api/src/controllers/report.js) handles the request → route registered in api/src/routing.js → shared argument validation in src/libs/parameter-validators.ts, mirroring person.ts and place.ts, both of whose create paths were already standing on the epic branch by the time #10099 landed — place's via #10065 (local, 169a02355) and #10089 (API, 98a687a80), with #10094 moving the create surface to `Input`. #10099 aligned their validation while adding the report path.

## Design Choices

Implements report creation in the local adapter so the local data context exposes the same create operation as the datasource abstraction — the remote half had no create either and was added in the same epic, so this is one side of a paired addition, not a catch-up with an existing remote capability, delivered as incremental work toward the report half (#10040) of the datasource create/update effort whose place half is #10038. This PR named the operation flatly, `createReport`; the epic renamed it to `create` inside the `Report.v1` namespace to match `Person.v1.create` and `Place.v1.create`, which is the convention on master. On the API side (PR #10099), reused the person create architecture already standing on the epic branch (domain module + remote adapter + controller + shared validators) for API and naming consistency across the datasource surface rather than a bespoke report-only path, and centralized validation in parameter-validators.ts to avoid duplication.

## Related Files

The four files PR #10071 itself changed, at `d40e65bae`:

- shared-libs/cht-datasource/src/local/report.ts
- shared-libs/cht-datasource/src/qualifier.ts
- shared-libs/cht-datasource/test/local/report.spec.ts
- shared-libs/cht-datasource/test/local/person.spec.ts

Everything below is as it stands in the #10083 epic squash, not in this PR's diff. `shared-libs/cht-datasource/src/input.ts` in particular was added by the epic.

API and remote adapter (PR #10099):

- api/src/controllers/report.js
- api/src/controllers/person.js
- api/src/controllers/place.js
- api/src/routing.js
- api/tests/mocha/controllers/report.spec.js
- api/tests/mocha/controllers/person.spec.js
- api/tests/mocha/controllers/place.spec.js
- shared-libs/cht-datasource/src/report.ts
- shared-libs/cht-datasource/src/remote/report.ts
- shared-libs/cht-datasource/src/person.ts
- shared-libs/cht-datasource/src/place.ts
- shared-libs/cht-datasource/src/index.ts
- shared-libs/cht-datasource/src/libs/parameter-validators.ts
- shared-libs/cht-datasource/test/remote/report.spec.ts
- shared-libs/cht-datasource/test/person.spec.ts
- shared-libs/cht-datasource/test/place.spec.ts
- shared-libs/cht-datasource/test/index.spec.ts
- tests/integration/api/controllers/report.spec.js
- tests/integration/shared-libs/cht-datasource/report.spec.js

## Testing

Added and updated unit specs (shared-libs/cht-datasource/test/local/report.spec.ts and test/local/person.spec.ts) to cover the new local `create` behavior. The API layer (PR #10099) added Mocha unit tests for the API controllers (report, person, place spec files), cht-datasource unit tests (report, person, place, index, and remote/report specs), and end-to-end integration tests for both the API controller (tests/integration/api/controllers/report.spec.js) and the datasource library (tests/integration/shared-libs/cht-datasource/report.spec.js).

## Related Issues

- #10040: "To have API that can create reports" — the issue these PRs implement, via local and API support for report creation
- #10038: "To have API that can create places" — the sibling issue covering the place-creation half of the same cht-datasource create work
- PR #10083: "feat(#9835): add cht datasource apis for creation and update of contacts and reports" — the epic PR whose squash (`f382785be`) is the only commit carrying this work on master

## Domain Rationale

**Fit:** strong

The entity created is the report, and reports are canonically forms-and-reports; the work is the create half of the datasource's report API rather than a cross-cutting storage concern.

Its files, though, are entirely `shared-libs/cht-datasource` — this is library extension, not consumption. Review on #122 asked for `data-access` as the primary domain with `secondaryDomains: [forms-and-reports]`. That re-key is deliberately **not** made here: neither the `data-access` enum value nor the `secondaryDomains` field exists in the schema yet, and the recommendation on that same PR is to ship both as one coordinated taxonomy change rather than through a content PR. Recorded here so the decision is visible in the draft rather than only in the review thread. Same for the sibling extenders `10064` and `10180`.
