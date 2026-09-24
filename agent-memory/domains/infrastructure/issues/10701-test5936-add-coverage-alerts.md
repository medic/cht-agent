---
id: cht-core-5936
category: improvement
domain: infrastructure
domainFit: strong
issueNumber: 5936
issueUrl: https://github.com/medic/cht-core/issues/5936
title: Add nyc code-coverage thresholds (alerts) for API, Sentinel, and shared-libs and backfill missing unit tests
lastUpdated: '2026-06-22'
summary: There was no enforcement of test-coverage levels and many shared-libs lacked unit tests, so coverage regressions slipped through CI unnoticed. This PR adds per-service nyc coverage thresholds for API, Sentinel, and a blanket 95% for shared-libs, and backfills unit tests across shared-libs to satisfy them.
services:
  - api
  - sentinel
techStack:
  - javascript
  - typescript
  - nyc
  - istanbul
  - mocha
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
concepts:
  - code-coverage enforcement
  - CI quality gates
  - unit test coverage
  - separation of concerns
related_issues: []
stale: false
---

## Problem

There was no automated way to tell which code was well tested or whether a change was raising or lowering coverage, and numerous shared-libs modules had little or no unit-test coverage, so coverage regressions passed CI silently.

## Root Cause

The build had no coverage thresholds configured in nyc, so there was no CI gate on coverage levels, and many shared-libs lacked unit tests entirely. The tasks orderBy logic also lived in shared-libs/task-utils, which is intended for report-attached SMS tasks (tasks and scheduled-tasks properties) rather than rules-engine tasks.

## Solution

Added nyc coverage thresholds (alerts): API (branches 90 / lines 95 / functions 94 / statements 95), Sentinel (branches 92 / lines 97 / functions 97 / statements 97), and a blanket 95% for shared-libs, then backfilled unit tests across the shared-libs (cht-datasource, contacts, lineage, transitions, rules-engine, search, task-utils, message-utils, outbound, infodoc, environment, logger, server-checks, phone-number, etc.) to meet them. Also moved the tasks orderBy function out of shared-libs/task-utils into the task reducer where rules-engine task ordering belongs.

## Code Patterns

Per-service nyc.config.js threshold config (check-coverage with branches/lines/functions/statements floors) — see api/nyc.config.js, sentinel/nyc.config.js, shared-libs/nyc.config.js. Mocha .spec.js/.spec.ts unit tests colocated under each lib's test/ directory.

## Design Choices

API and Sentinel thresholds were pinned to current measured coverage to lock in a no-regression ratchet without forcing an immediate large jump, while shared-libs use a single blanket 95% floor. Relocating orderBy clarifies the boundary: task-utils handles report-attached SMS tasks/scheduled-tasks, while rules-engine task ordering is the task reducer's responsibility. AI (Claude) was used to generate the additional shared-libs tests, with the author validating each line against coding standards.

## Related Files

- api/nyc.config.js
- sentinel/nyc.config.js
- shared-libs/nyc.config.js
- shared-libs/task-utils/src/task-utils.js
- shared-libs/task-utils/test/order-by-due-date-and-priority.js
- shared-libs/search/src/freetext-query.js

## Testing

The PR is itself a coverage-improvement effort: it backfills unit tests across all shared-libs and updates existing specs, then enforces nyc coverage thresholds in CI for API, Sentinel, and shared-libs.

## Related Issues

- #5936: No easy way to tell which code is well tested or whether a change improves/reduces coverage; wanted coverage reporting and CI-published diffs

## Domain Rationale

**Fit:** strong

This is CI/test-tooling work — it adds nyc (Istanbul) code-coverage thresholds ('coverage alerts') as CI quality gates and backfills unit tests to meet them. CI/build/quality-gate tooling belongs to infrastructure, not configuration; the touched files are nyc.config.js coverage configs and test specs, not domain logic.
