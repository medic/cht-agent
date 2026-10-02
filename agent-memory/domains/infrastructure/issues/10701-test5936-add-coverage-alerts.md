---
id: cht-core-5936
category: improvement
domain: infrastructure
domainFit: strong
issueNumber: 5936
issueUrl: https://github.com/medic/cht-core/issues/5936
title: Add code-coverage thresholds (alerts) for API, Sentinel and shared-libs, tighten cht-form's, and backfill missing shared-libs unit tests
lastUpdated: '2026-10-01'
summary: API, Sentinel and shared-libs ran their unit tests under nyc without coverage thresholds, and many shared-libs had coverage gaps, so coverage in those packages could drop without failing CI. This PR sets nyc coverage thresholds for API and Sentinel (from their current coverage) and a blanket 95% for shared-libs, gives cht-form its own, stricter Karma thresholds, and backfills unit tests across shared-libs to satisfy them.
services:
  - api
  - sentinel
  - webapp
techStack:
  - javascript
  - typescript
  - nyc
  - istanbul
  - mocha
  - karma
tags:
  - test-coverage
  - unit-tests
  - ci
  - nyc
  - code-quality
  - quality-gate
related_workflows: []
source_pr: medic/cht-core#10701
source_sha: 48f9a520708920c1d1ed852558eb9ef1a55b4827
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - api/nyc.config.js
  - sentinel/nyc.config.js
  - shared-libs/nyc.config.js
  - shared-libs/task-utils/src/task-utils.js
  - webapp/src/ts/reducers/tasks.ts
  - orderByDueDateAndPriority
concepts:
  - code-coverage enforcement
  - CI quality gates
  - unit test coverage
  - separation of concerns
related_issues: []
stale: false
---

## Problem

Issue #5936 described having no easy way to tell which code was well tested or whether a change was raising or lowering coverage. Before this PR, `api/nyc.config.js`, `sentinel/nyc.config.js` and `shared-libs/nyc.config.js` set `reporter: 'text-summary'` but no coverage thresholds, so coverage in API, Sentinel and the shared-libs could fall without failing CI (the webapp Karma suite, and cht-form through `...baseConfig.coverageReporter`, already enforced global thresholds in `webapp/tests/karma/karma-unit.base.conf.js`), and numerous shared-libs modules had missing coverage.

## Root Cause

Before this PR, none of the three nyc configs set `checkCoverage`, so nyc reported API, Sentinel and shared-libs coverage without enforcing it, and some shared-libs modules had no test file at all. The tasks orderBy logic also lived in shared-libs/task-utils (moved there from the webapp tasks reducer by PR #10362), which is intended for report-attached SMS tasks (tasks and scheduled-tasks properties) rather than rules-engine tasks.

## Solution

Set nyc coverage thresholds (alerts), `checkCoverage: true` plus floors, in the existing `api/nyc.config.js`, `sentinel/nyc.config.js` and `shared-libs/nyc.config.js`: API (branches 90 / lines 95 / functions 94 / statements 95), Sentinel (branches 92 / lines 97 / functions 97 / statements 97), and a blanket 95% for shared-libs, then backfilled unit tests across the shared-libs (cht-datasource, contacts, lineage, transitions, rules-engine, search, task-utils, message-utils, outbound, infodoc, environment, logger, server-checks, phone-number, etc.) to meet them; four test files are new (`shared-libs/search/test/freetext-query.js`, `shared-libs/transitions/test/unit/date.js`, `shared-libs/validation/test/parser_lexer.js`, `shared-libs/validation/test/validation_utils.js`). On the Karma side, the webapp `functions` threshold in `webapp/tests/karma/karma-unit.base.conf.js` rises from 85 to 86, and `webapp/web-components/cht-form/tests/karma/karma-unit.conf.js` gets its own `check` block with `global` thresholds (statements 98, lines 98, branches 100, functions 93). Also moved `orderByDueDateAndPriority` out of `shared-libs/task-utils/src/task-utils.js` into `webapp/src/ts/reducers/tasks.ts` (as `export const orderByDueDateAndPriority`), where rules-engine task ordering belongs; `webapp/src/ts/services/task-notifications.service.ts` now imports it from `@mm-reducers/tasks`. `shared-libs/search/src/freetext-query.js` now calls `chtDatasource.getDatasource(dataContext)` instead of a destructured `getDatasource` import.

## Code Patterns

Per-service nyc threshold config (`checkCoverage: true` with `branches`/`lines`/`functions`/`statements` floors) — see api/nyc.config.js, sentinel/nyc.config.js, shared-libs/nyc.config.js. Shared libs' test scripts run `nyc --nycrcPath='../nyc.config.js'` (all but `constants` and `memdown`) over Mocha unit tests in its `test/` directory, a mix of `*.spec.js`, `*.spec.ts` and plain `*.js` files.

## Design Choices

API and Sentinel thresholds were set from their current coverage reports, a no-regression floor that avoids forcing an immediate large jump, while shared-libs use a single blanket 95% floor. Relocating orderBy clarifies the boundary: task-utils handles report-attached SMS tasks/scheduled-tasks, while rules-engine task ordering is the task reducer's responsibility.

## Related Files

- api/nyc.config.js
- sentinel/nyc.config.js
- shared-libs/nyc.config.js
- shared-libs/task-utils/src/task-utils.js
- shared-libs/task-utils/test/order-by-due-date-and-priority.js (deleted)
- shared-libs/search/src/freetext-query.js
- webapp/src/ts/reducers/tasks.ts
- webapp/src/ts/services/task-notifications.service.ts
- webapp/tests/karma/ts/reducers/tasks.spec.ts
- webapp/tests/karma/karma-unit.base.conf.js
- webapp/web-components/cht-form/tests/karma/karma-unit.conf.js

## Testing

The PR is itself a coverage-improvement effort: it backfills or updates unit tests in 19 of the 31 shared-libs packages, moves the `orderByDueDateAndPriority` tests from the deleted `shared-libs/task-utils/test/order-by-due-date-and-priority.js` into the existing `webapp/tests/karma/ts/reducers/tasks.spec.ts`, then enforces nyc coverage thresholds in CI for API, Sentinel, and shared-libs.

## Related Issues

- #5936: "Record test coverage" — this draft's issue. It asked for coverage reports, publishing them during CI and diffing a branch against master; this PR instead enforces coverage thresholds.

## Domain Rationale

**Fit:** strong

This is CI/test-tooling work — it adds nyc (Istanbul) code-coverage thresholds ('coverage alerts') as CI quality gates and backfills unit tests to meet them. CI/build/quality-gate tooling belongs to infrastructure, not configuration; apart from relocating `orderByDueDateAndPriority` and an import-style change in `shared-libs/search/src/freetext-query.js`, the touched files are coverage configs (nyc and Karma) and test specs, not domain logic.
