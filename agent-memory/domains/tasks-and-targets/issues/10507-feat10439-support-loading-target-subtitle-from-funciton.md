---
id: cht-core-10439
category: feature
domain: tasks-and-targets
domainFit: strong
issueNumber: 10439
issueUrl: https://github.com/medic/cht-core/issues/10439
title: Support loading target card subtitle from a function for dynamic, reporting-period-aware labels
lastUpdated: '2026-08-07'
summary: Target cards displaying all-time metrics had a static 'All Time' subtitle that became misleading when users filtered targets to a reporting period (the value is really 'up to' that period). This PR adds support for loading the target subtitle from a function so it can be computed dynamically.
services:
  - webapp
techStack:
  - typescript
  - angular
  - mocha
  - karma
tags:
  - targets
  - target-subtitle
  - rules-engine
  - dynamic-configuration
  - function-based-config
related_workflows: []
source_pr: medic/cht-core#10507
source_sha: bc3d42c66f49bccb5e78a2c7b7beb10e78bf80e2
distilled_at: '2026-06-22'
reviewed_by: null
reviewed_at: null
confidence: medium
entities:
  - webapp/src/ts/libs/config.ts
  - webapp/src/ts/services/rules-engine.service.ts
concepts:
  - target cards
  - rules engine target evaluation
  - function-based configuration
  - reporting-period-aware display
related_issues: []
stale: false
---

## Problem

Target cards configured to show all-time metrics had a hardcoded 'All Time' subtitle. When a user filtered the targets to a specific reporting period (e.g. the previous month), the 'All Time' label became misleading because the displayed value is actually accumulated 'up to' that period. There was no way for config authors to make the subtitle reflect the selected reporting context.

## Root Cause

The target subtitle was treated as a static configuration value (a fixed translation key), so it could not adapt to the active reporting period or any dynamic context.

## Solution

Extended the target configuration handling so the subtitle can be supplied as a function that is evaluated at runtime, in addition to a static value. webapp/src/ts/libs/config.ts — a helper this PR added — resolves a function-typed subtitle, and webapp/src/ts/services/rules-engine.service.ts was updated to pass through/evaluate it when building target cards. Note `libs/config.ts` did not survive the epic: #10436 later deleted it and moved subtitle derivation into rules-engine.service.ts itself, where it sits on master (`getReportingMonth`, `subtitle_translation_key`, and the last-month subtitle at :594). package.json was bumped (rules-engine dependency) to enable the function-based subtitle support.

## Code Patterns

Configuration value that may be either a static value or a function evaluated at runtime — a reusable dynamic-config pattern. As of this PR it was centralized in webapp/src/ts/libs/config.ts and consumed by webapp/src/ts/services/rules-engine.service.ts; #10436, later in the epic, folded it into rules-engine.service.ts itself, so on master there is no separate helper (see Related Files).

## Design Choices

Allowing the subtitle to be a function (rather than just adding more fixed subtitle options) lets config authors compute the label from runtime context such as the active reporting period, solving the misleading 'All Time' label generically instead of with another hardcoded string.

## Related Files

> **Paths are as of this PR, not as of master.** This change merged into the `10140_previous-month-targets` feature branch and reached master only in that epic's squash, medic/cht-core#10423 (`622c625427`), which renamed and relocated several of the files below. webapp/src/ts/libs/config.ts, webapp/tests/mocha/tsconfig.mocha.json and webapp/tests/mocha/unit/libs/config.spec.ts are not on master — #10436 removed all three later in the epic.

- webapp/package.json
- webapp/src/ts/libs/config.ts
- webapp/src/ts/services/rules-engine.service.ts
- webapp/tests/karma/ts/services/rules-engine.service.spec.ts
- webapp/tests/mocha/.mocharc.js
- webapp/tests/mocha/tsconfig.mocha.json
- webapp/tests/mocha/unit/libs/config.spec.ts

## Testing

Added/updated karma unit tests for the rules engine service (rules-engine.service.spec.ts) and added mocha unit tests for the config lib (config.spec.ts), including new mocha test infrastructure for the libs (.mocharc.js and tsconfig.mocha.json) to cover the function-based subtitle resolution.

## Related Issues

- #10439: Static 'All Time' target subtitle is misleading when targets are filtered to a reporting period; needs a dynamic/function-derived subtitle

## Domain Rationale

**Fit:** strong

The PR enhances how target cards compute and display their subtitle, evaluated through the rules engine — targets are canonically the tasks-and-targets domain. Although it touches config.ts and the rules-engine service, this is a targets-display capability rather than an app-settings/config-schema change, so configuration is not a better fit.
